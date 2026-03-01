# Eval-Driven Development for claude-plan-composer

## The problem: how do you know if changes improve plan quality?

When you change a merge prompt, add a new variant lens, or switch models, the only
feedback loop today is manual review. That doesn't scale:

- Did the new `--sequential-diversity` flag actually reduce convergence?
- Does switching from Opus to Sonnet for generation degrade plan quality?
- Did refactoring the merge prompt lose important details?
- Are auto-generated lenses better than the default config variants?

Without systematic measurement, changes are guided by vibes.

## The approach: test prompts + scoring rubric + tracked results

### 1. Test prompt suite

A curated set of 5-10 prompts that exercise different aspects of the pipeline.
Each prompt has known characteristics that make quality measurable:

```
evals/
  prompts/
    csv-to-json-cli.md          # small scope, clear requirements
    distributed-task-queue.md    # architecture-heavy, many trade-offs
    legacy-api-migration.md      # constraints-heavy, backward compat
    ml-pipeline-deployment.md    # operational depth, infra details
    mobile-app-offline-sync.md   # cross-cutting concerns, edge cases
  expected/
    csv-to-json-cli.yaml         # scoring rubric for this prompt
    distributed-task-queue.yaml
    ...
```

Prompts should span:
- **Scope**: small (CLI tool) to large (distributed system)
- **Domain**: backend, frontend, infra, data, mobile
- **Constraint density**: few constraints to heavily constrained
- **Trade-off richness**: single obvious approach to many viable alternatives

### 2. Scoring rubric per prompt

Each prompt gets a YAML rubric defining what "good" looks like:

```yaml
# evals/expected/csv-to-json-cli.yaml
structural_checks:
  - name: has_project_structure
    check: "sections matching /project structure|module|layout/i"
    weight: 1.0
  - name: has_error_handling
    check: "sections matching /error handling|edge cases/i"
    weight: 1.0
  - name: has_testing_approach
    check: "sections matching /test|testing/i"
    weight: 1.0
  - name: has_code_example
    check: "contains at least one fenced code block"
    weight: 0.5

quality_dimensions:
  - name: actionability
    prompt: |
      Rate 1-5: Could a developer start implementing from this plan
      without asking clarifying questions? Look for: specific file paths,
      function signatures, concrete commands, version numbers.
    weight: 2.0
  - name: completeness
    prompt: |
      Rate 1-5: Does the plan cover all requirements from the original
      prompt? Check each requirement bullet point.
    weight: 1.5
  - name: concreteness
    prompt: |
      Rate 1-5: Does the plan use specific examples, exact commands,
      and concrete patterns rather than generic advice?
    weight: 1.5
  - name: trade_off_awareness
    prompt: |
      Rate 1-5: Does the plan acknowledge alternatives and explain
      why the chosen approach is preferred? Or does it present one
      option as the only viable path?
    weight: 1.0
```

### 3. promptfoo integration

[promptfoo](https://github.com/promptfoo/promptfoo) provides the evaluation harness.
A custom provider wraps the full claude-plan-composer pipeline:

```yaml
# promptfooconfig.yaml
description: "claude-plan-composer quality tracking"

providers:
  - id: "exec:./evals/provider.sh"
    label: "pipeline-opus-4-variants"
    config:
      model: opus
      variants: 4
      merge_mode: simple
  - id: "exec:./evals/provider.sh"
    label: "pipeline-sonnet-4-variants"
    config:
      model: sonnet
      variants: 4
      merge_mode: simple
  - id: "exec:./evals/provider.sh"
    label: "pipeline-sonnet-sequential"
    config:
      model: sonnet
      variants: 4
      merge_mode: simple
      sequential_diversity: true

prompts:
  - file://evals/prompts/csv-to-json-cli.md
  - file://evals/prompts/distributed-task-queue.md

tests:
  - vars: {}
    assert:
      # Structural checks (deterministic, free)
      - type: contains
        value: "# "
        metric: has_heading
      - type: javascript
        value: "output.split('```').length >= 3"
        metric: has_code_blocks
      - type: javascript
        value: "output.length > 2000"
        metric: minimum_length

      # LLM-as-judge (costs per eval, high signal)
      - type: llm-rubric
        value: |
          Rate the actionability of this implementation plan.
          Could a developer start coding from this without asking
          clarifying questions? Score 1-5.
        metric: actionability
      - type: llm-rubric
        value: |
          Rate the trade-off awareness. Does the plan acknowledge
          alternatives and justify choices? Score 1-5.
        metric: trade_off_awareness
```

The custom provider (`evals/provider.sh`) runs the pipeline:

```bash
#!/usr/bin/env bash
# Custom promptfoo provider — runs the full pipeline for one prompt.
# Input: prompt text on stdin (or via $PROMPT_FILE)
# Output: merged plan text to stdout

set -euo pipefail

MODEL="${PROMPTFOO_CONFIG_model:-sonnet}"
VARIANTS="${PROMPTFOO_CONFIG_variants:-4}"
MERGE_MODE="${PROMPTFOO_CONFIG_merge_mode:-simple}"
SEQ_DIV="${PROMPTFOO_CONFIG_sequential_diversity:-false}"

# Write prompt to temp file
PROMPT_FILE=$(mktemp /tmp/eval-prompt-XXXXXX.md)
cat > "$PROMPT_FILE"

# Run pipeline
EXTRA_FLAGS=""
[[ "$SEQ_DIV" == "true" ]] && EXTRA_FLAGS="--sequential-diversity"

MODEL="$MODEL" \
  ./generate-plans.sh $EXTRA_FLAGS "$PROMPT_FILE"

RUN_DIR="generated-plans/$(basename "$PROMPT_FILE" .md)/latest"

MODEL="$MODEL" MERGE_MODE="$MERGE_MODE" \
  ./merge-plans.sh "$RUN_DIR"

# Output merged plan
cat "$RUN_DIR/merged-plan.md"
```

### 4. Tracking results over time

promptfoo outputs JSON results that can be git-tracked:

```
evals/
  results/
    2025-03-01-opus-4v.json
    2025-03-01-sonnet-4v.json
    2025-03-05-sonnet-4v-seq-div.json   # after adding sequential diversity
    2025-03-10-sonnet-4v-new-merge.json # after refactoring merge prompt
```

Each result file records scores per prompt × per dimension:

```json
{
  "timestamp": "2025-03-01T14:00:00Z",
  "git_sha": "abc1234",
  "provider": "pipeline-opus-4-variants",
  "scores": {
    "csv-to-json-cli": {
      "actionability": 4.2,
      "completeness": 3.8,
      "concreteness": 4.0,
      "trade_off_awareness": 3.5,
      "has_code_blocks": true,
      "minimum_length": true
    },
    "distributed-task-queue": {
      "actionability": 3.5,
      "completeness": 4.0,
      "concreteness": 3.2,
      "trade_off_awareness": 4.5
    }
  }
}
```

### 5. Comparison workflow

With git-tracked results, changes become measurable:

```bash
# Run eval suite after a code change
promptfoo eval --output evals/results/$(date +%Y-%m-%d)-description.json

# Compare against previous baseline
promptfoo eval --compare evals/results/baseline.json

# View HTML comparison report
promptfoo view
```

The comparison table shows at a glance:

| Prompt | Dimension | Before | After | Delta |
|--------|-----------|--------|-------|-------|
| csv-to-json-cli | actionability | 4.2 | 4.5 | +0.3 |
| csv-to-json-cli | trade_offs | 3.5 | 4.0 | +0.5 |
| distributed-task-queue | concreteness | 3.2 | 3.0 | -0.2 |

This tells you: "sequential diversity improved trade-off awareness across the board
but slightly reduced concreteness on architecture-heavy prompts."

## Cost considerations

Running the full eval suite is expensive because each evaluation runs the full pipeline:

| Configuration | Per prompt | 5 prompts | 10 prompts |
|--------------|-----------|-----------|------------|
| Sonnet 4-variants + simple merge | ~$5 | ~$25 | ~$50 |
| Opus 4-variants + simple merge | ~$20 | ~$100 | ~$200 |
| Opus 4-variants + agent-team merge | ~$40 | ~$200 | ~$400 |

Mitigation strategies:
- **Tiered evaluation**: Run cheap structural checks on every commit, LLM-as-judge weekly
- **Subset testing**: Use 2-3 representative prompts for quick checks, full suite for releases
- **Model cascade**: Generate with Sonnet, merge with Sonnet, judge with Haiku
- **Cache baselines**: Only re-run the configuration that changed, compare against cached results

## Limitations

- **LLM-as-judge bias**: The same model family evaluating its own output has correlated biases.
  Mitigated by using structural checks (free, deterministic) alongside LLM scoring.
- **Prompt sensitivity**: Small changes to scoring rubric prompts can shift scores.
  Pin rubric versions and track changes.
- **Cost**: Full eval suite costs $25-200+ per run. Not suitable for CI on every commit.
- **Variance**: Same pipeline configuration can produce different quality plans across runs.
  Run 2-3 times and average for reliable comparisons.
- **Plan quality ≠ implementation quality**: A plan that scores 5/5 on actionability
  might still lead to bad code. Eval measures plan quality, not downstream outcomes.

## Implementation phases

**Phase 1 — Manual baseline** (now):
Run the existing e2e test (`make test-e2e`), manually review plans, build intuition
for what "good" and "bad" look like on different prompt types.

**Phase 2 — Structural checks** (low cost):
Add deterministic checks (section headings present, code blocks exist, minimum length,
required keywords) that run without LLM calls. These catch regressions for free.

**Phase 3 — promptfoo integration** (moderate effort):
Write the custom provider, create 3-5 test prompts with rubrics, run first baseline
evaluation. Git-track results.

**Phase 4 — Continuous tracking** (ongoing):
Run eval suite before/after significant changes. Build a history of scores that
informs whether changes are improvements or regressions.
