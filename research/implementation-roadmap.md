# Plan: Methodology Improvements — Implementation Roadmap

## Context

Deep research across 50+ papers identified concrete improvements to the generate-merge pipeline.
The current pipeline is well-grounded (prompt variation > model/temperature variation, N=3-4 sweet spot),
but has gaps: no evaluation between generation and merge, no post-merge verification, fixed generic lenses,
and a single-pass merge with no conflict classification. Full research in `research/methodology-improvements.md`.

This plan breaks improvements into 7 PRs, ordered by dependency and impact. Each PR is independently
shippable and testable.

---

## PR 1: Smarter merge prompts + constitutional principles

**Goal**: Improve merge quality with zero code risk — pure prompt template and config changes.

**Changes**:

### 1a. Conflict classification in merge prompt (`merge-plans.sh`)

In the simple merge prompt (line ~252) and agent-teams merge prompt (line ~194), add conflict
classification instructions before the synthesis step:

```
For each dimension where plans disagree, classify the disagreement:
1. GENUINE TRADE-OFF: Legitimate alternatives with different strengths.
   → Present both options with trade-off analysis in the merged plan.
2. COMPLEMENTARY: Plans address different sub-aspects that can coexist.
   → Merge both contributions.
3. ARBITRARY DIVERGENCE: No substantive reason for the difference.
   → Pick the more specific/actionable version.
```

### 1b. Minority insight preservation in merge prompt (`merge-plans.sh`)

Add to the merge synthesis instructions:

```
After synthesizing the majority view, scan each source plan for insights
that appear in ONLY that plan. For each unique insight:
- If genuinely valuable, include it with a note: "[Source: variant-name]"
- If not valuable, briefly note why it was excluded in the comparison table
```

### 1c. Constitutional principles in `merge-config.yaml`

Add a new `constitution` field with default principles:

```yaml
# Quality principles the merged plan must satisfy.
# After synthesis, the merge verifies each principle and revises if needed.
constitution:
  - "Every trade-off must be explicitly acknowledged with pros and cons"
  - "No section should be purely aspirational — each needs a concrete next step"
  - "Risks identified in any source plan must appear in the merged plan"
  - "The plan must be self-consistent — no section contradicts another"
```

Parse in Python alongside other merge config fields. Append to merge prompt:

```
After producing the merged plan, verify it against these principles:
[list principles]
For each principle: does the merged plan satisfy it? If not, revise.
```

### 1d. Split analysis from synthesis in simple merge (`merge-plans.sh`)

Currently the simple merge asks Claude to compare AND synthesize in one instruction.
Split into two explicit steps in the prompt:

```
Step 1 — ANALYSIS: For each dimension, produce a comparison table showing
  each plan's approach, strengths, and weaknesses.
Step 2 — SYNTHESIS: Using the analysis above, produce the merged plan.
```

This reduces cognitive load and creates a more structured output.

**Files**: `merge-plans.sh`, `merge-config.yaml`, `AGENTS.md`

**Verification**: Run `MERGE_MODE=simple ./merge-plans.sh` on existing test plans and verify:
- Merged plan contains conflict classifications
- Unique insights from individual plans are preserved or explicitly excluded
- Constitutional principles are checked

---

## PR 2: Variant strategy expansion + cost documentation

**Goal**: Document and exemplify alternative lens strategies (persona, constraint, adversarial)
and cost-saving model cascade patterns. Config and docs only.

**Changes**:

### 2a. Alternative lens examples in `config.yaml`

Add commented examples of three lens strategies below the existing variants:

```yaml
# ─── Alternative lens strategies ──────────────────────────────────────────
# The default analytical lenses (baseline/simplicity/depth/breadth) are
# domain-agnostic. For better results, consider domain-specific alternatives:
#
# PERSONA-BASED (who is thinking):
#   architect:
#     guidance: "You are a senior systems architect. Prioritize scalability..."
#   pragmatist:
#     guidance: "You are a staff engineer who ships. Shortest path to production..."
#   skeptic:
#     guidance: "You are a security-minded tech lead. Question every assumption..."
#   visionary:
#     guidance: "You are a research engineer. Explore unconventional approaches..."
#
# CONSTRAINT-BASED (different operating conditions):
#   fast-and-cheap:
#     guidance: "Assume a 2-week deadline and $5K budget."
#   unlimited-time:
#     guidance: "Assume unlimited time but a team of 1."
#   scale-first:
#     guidance: "Assume this needs to serve 10x current load within 6 months."
#
# ADVERSARIAL (contrarian perspective):
#   contrarian:
#     guidance: |
#       Identify the most obvious approach to this task, then propose a
#       fundamentally different alternative. Your plan MUST differ structurally.
#
# COST-OPTIMIZED (model cascade):
# Use cheaper models for generation, reserve Opus for merge where quality
# matters most. ~48% savings vs. all-Opus. Research: Self-MoA shows quality
# of the aggregator matters more than quality of proposers.
#   architect:
#     model: sonnet
#     guidance: "..."
#   pragmatist:
#     model: sonnet
#     guidance: "..."
#   skeptic:
#     model: sonnet
#     guidance: "..."
#   visionary:
#     model: opus
#     guidance: "..."
```

### 2b. Update README "Adapting to your own project" section

Add a "Lens strategies" paragraph explaining:
- Analytical lenses (default): simplicity vs. depth vs. breadth
- Persona lenses: shift "who is thinking" (research: 91% vs 82% accuracy with diverse personas)
- Constraint lenses: force different solution spaces
- Adversarial lens: challenge assumptions, avoid Degeneration-of-Thought
- Model cascade: Sonnet for generation, Opus for merge (~48% savings)

### 2c. Update AGENTS.md configuration section

Document all lens strategy options in the config reference.

**Files**: `config.yaml`, `README.md`, `AGENTS.md`

**Verification**: Review that examples are clear and the config parser still handles them
correctly: `./generate-plans.sh --debug test-prompt.md`

---

## PR 3: Pre-merge evaluation (`evaluate-plans.sh`)

**Goal**: New script that analyzes generated plans before merging — coverage matrix, convergence
check, gap detection. Feeds results into the merge step.

**Changes**:

### 3a. New `evaluate-plans.sh` script (~100-150 lines)

```bash
# evaluate-plans.sh <plans-directory>
#
# Analyzes generated plans before merging:
# 1. Coverage matrix: which dimensions each plan addresses (binary)
# 2. Convergence: pairwise similarity of plan structures
# 3. Gaps: dimensions NO plan covers adequately
# 4. Strengths: per-plan strongest dimensions
#
# Output: $RUN_DIR/evaluation.json + human-readable summary
#
# Usage:
#   ./evaluate-plans.sh generated-plans/my-prompt/latest
#   EVAL_MODEL=haiku ./evaluate-plans.sh generated-plans/latest
```

The script:
1. Finds plan-*.md files in the directory (same logic as merge-plans.sh)
2. Loads dimensions from merge-config.yaml (same resolution logic)
3. Sends all plans + dimensions to a cheap model (default: haiku) with a structured prompt
4. Asks for JSON output: `{plans: [{name, dimensions: [{name, covered: bool, strength: 1-5}]}], gaps: [...], similarity_matrix: [...]}`
5. Writes `evaluation.json` and prints a human-readable summary
6. Exit code 0 if no critical gaps, 1 if gaps found (enables `evaluate && merge` chaining)

### 3b. Bash-level convergence check (zero-cost, no LLM)

Before the LLM evaluation, extract section headings from each plan (`grep '^##'`) and compute
pairwise Jaccard similarity. Warn if:
- \>80% overlap: "Plans are very similar — consider more diverse lenses"
- <30% overlap: "Plans diverge significantly — merge may need manual guidance"

### 3c. Feed evaluation into merge

If `evaluation.json` exists in the plans directory, `merge-plans.sh` reads it and appends
a summary to the merge prompt:

```
## Pre-merge evaluation
Coverage strengths per plan:
- plan-baseline: strongest on "Approach" and "Architecture"
- plan-depth: strongest on "Technical depth"
Gaps: No plan adequately covers "Risk assessment"
```

This helps the merge agent weight plans appropriately and flag gaps.

### 3d. Update pipeline documentation

Update AGENTS.md and README quick start to show the evaluate step:

```bash
./generate-plans.sh my-prompt.md
./evaluate-plans.sh generated-plans/my-prompt/latest   # NEW
./merge-plans.sh generated-plans/my-prompt/latest
```

**Files**: New `evaluate-plans.sh`, `merge-plans.sh` (read evaluation.json), `AGENTS.md`, `README.md`

**Verification**:
1. Run on existing generated plans — verify JSON output is valid
2. Verify merge-plans.sh picks up evaluation.json when present
3. Verify merge-plans.sh works unchanged when evaluation.json is absent
4. Test convergence check with plans that have similar/different headings

---

## PR 4: Auto-generate task-specific lenses (`--auto-lenses`)

**Goal**: Instead of fixed generic lenses, have the LLM generate 4 optimal perspectives
for the specific prompt. Based on Meta-Prompting research (15-17% improvement).

**Changes**:

### 4a. New `--auto-lenses` flag in `generate-plans.sh`

When `--auto-lenses` is passed (or `AUTO_LENSES=1` env var):

1. Before launching parallel sessions, run a cheap model call (haiku by default, `LENS_MODEL` env var):

```bash
LENS_PROMPT="Given this planning task, generate exactly 4 maximally different
analytical perspectives to approach it from. Each perspective should force
genuinely different trade-offs, priorities, and reasoning paths.

For each perspective, output:
- name: a short kebab-case identifier (e.g., 'risk-first', 'user-centric')
- guidance: 2-3 sentences of specific guidance for that perspective

Output as YAML:
perspectives:
  - name: ...
    guidance: ...

The task:
$(cat "$PROMPT_FILE")"
```

2. Parse the YAML output to populate `VARIANTS` (replacing config variants)
3. Continue with normal parallel generation

### 4b. Fallback behavior

- If the lens generation call fails, fall back to config.yaml variants with a warning
- `--auto-lenses` is incompatible with multi-file mode (multi-file already defines its own variants)
- In debug mode, `--auto-lenses` still generates all 4 lenses but only runs the first one

### 4c. Save generated lenses

Write the generated lens definitions to `$RUN_DIR/auto-lenses.yaml` for reproducibility
and debugging.

**Files**: `generate-plans.sh`, `AGENTS.md`

**Verification**:
1. `./generate-plans.sh --auto-lenses --debug test-prompt.md` — verify lenses are generated and plan is produced
2. Verify fallback works when lens generation fails (e.g., `LENS_MODEL=nonexistent`)
3. Verify `auto-lenses.yaml` is saved in the run directory
4. Verify `--auto-lenses` is rejected in multi-file mode

---

## PR 5: Post-merge verification + refinement

**Goal**: Quality gates after merge with optional auto-refinement. Based on Self-Refine and
CRITIC research. Critical finding: refinement must inject external feedback (source plans,
checklists), not just "improve this" (intrinsic self-correction doesn't work).

**Changes**:

### 5a. New `verify-plan.sh` script (~80-120 lines)

```bash
# verify-plan.sh <plans-directory>
#
# Three quality gates on the merged plan:
# Gate 1: CONSISTENCY — internal contradictions
# Gate 2: COMPLETENESS — content lost from source plans
# Gate 3: ACTIONABILITY — each section is executable
#
# Output: $RUN_DIR/verification-report.md
#
# Usage:
#   ./verify-plan.sh generated-plans/my-prompt/latest
#   VERIFY_MODEL=haiku ./verify-plan.sh generated-plans/latest
```

The script:
1. Reads `merged-plan.md` and all `plan-*.md` source plans
2. Sends them to a model (default: sonnet, configurable via `VERIFY_MODEL`) with three gate prompts
3. Outputs a structured verification report
4. Exit code: 0 if all gates pass, 1 if any fail

### 5b. `--verify` flag on `merge-plans.sh` (simple mode only)

After the simple merge completes successfully, if `--verify` is passed:
1. Run verify-plan.sh automatically
2. If gates fail and `REFINE_ROUNDS > 0`, trigger refinement

### 5c. Refinement loop (`REFINE_ROUNDS` env var)

When verification fails and `REFINE_ROUNDS` is set (default: 0):

```bash
for round in $(seq 1 "$REFINE_ROUNDS"); do
    REFINE_PROMPT="You are revising a merged plan. The following quality issues were found:
    $(cat verification-report.md)

    Source plans for reference:
    [inline all source plans]

    Read the current merged plan at $merge_md and produce a REVISED version
    that fixes the identified issues. Write to the same path."

    claude -p "$REFINE_PROMPT" --model "$MODEL" ...

    # Re-verify
    ./verify-plan.sh "$RUN_DIR"
    if [ $? -eq 0 ]; then break; fi
done
```

Cap at 2 rounds maximum (research shows diminishing returns after 2-3 iterations).

### 5d. Pre-mortem analysis (`--pre-mortem` flag or config)

Optional pass after merge (can combine with `--verify`):

```
Imagine it is 6 months from now. The team followed this plan exactly,
and it FAILED. Generate 5 specific failure scenarios. For each:
1. What went wrong?
2. Which section was responsible?
3. What should be added to prevent this?
```

Append results to the merged plan as a "## Risks and Failure Modes" section,
or write to `$RUN_DIR/pre-mortem.md` separately.

Add `pre_mortem: false` to merge-config.yaml.

**Files**: New `verify-plan.sh`, `merge-plans.sh` (add --verify, REFINE_ROUNDS), `merge-config.yaml`, `AGENTS.md`

**Verification**:
1. `./verify-plan.sh` on a known-good merged plan — should pass
2. `./verify-plan.sh` on a deliberately incomplete merged plan — should fail
3. `MERGE_MODE=simple REFINE_ROUNDS=1 ./merge-plans.sh --verify generated-plans/latest`
4. Pre-mortem output is appended correctly

---

## PR 6: Pairwise tournament merge + weighted dimensions

**Goal**: More reliable comparison method. Research shows pairwise comparison outperforms
holistic "pick the winner across all plans" due to position bias and cognitive overload.

**Changes**:

### 6a. New `comparison_method` field in `merge-config.yaml`

```yaml
# How to compare plans across dimensions.
# holistic (default): LLM evaluates all plans per dimension simultaneously
# pairwise: Compare plans 2 at a time, then tally results (more reliable, slower)
comparison_method: holistic
```

### 6b. Pairwise tournament implementation in `merge-plans.sh`

When `comparison_method: pairwise` in simple mode:

Phase 1 — Pairwise comparisons:
For N=4 plans and D=6 dimensions, generate C(4,2) × 6 = 36 focused prompts:
```
Compare Plan A vs Plan B on dimension "Technical depth":
Which plan is stronger on this dimension? Why? (1-2 sentences)
Winner: [A/B/tie]
```

Run these as a single prompt (all 36 comparisons in one call to avoid 36 API calls).

Phase 2 — Tally results:
Count wins per plan per dimension. Feed the tournament bracket into the synthesis prompt.

Phase 3 — Synthesis:
```
Based on the pairwise tournament results:
[dimension → winner table]
Produce a merged plan favoring each dimension's winner.
```

### 6c. Weighted dimensions

Support optional weights in merge-config.yaml:

```yaml
dimensions:
  - name: "Approach and strategy"
    weight: 0.25
  - name: "Actionability and next steps"
    weight: 0.25
  # or simple form (backward compatible):
  - "Technical depth"  # weight defaults to equal
```

Parse in Python: if dimension is a string, use equal weight. If dict, extract name and weight.
Apply weights to tournament scoring and synthesis instructions.

**Files**: `merge-plans.sh`, `merge-config.yaml`, `AGENTS.md`

**Verification**:
1. `comparison_method: holistic` (default) — behavior unchanged
2. `comparison_method: pairwise` — verify pairwise comparisons appear in output
3. Weighted dimensions — verify weights are mentioned in merge prompt
4. Backward compatibility — simple string dimensions still work

---

## PR 7: Sequential diversity conditioning (`--sequential-diversity`)

**Goal**: Reduce convergence between parallel sessions by conditioning later variants
on earlier ones. Based on G2 research (Guided Generation for Enhanced Output Diversity).

**Changes**:

### 7a. New `--sequential-diversity` flag in `generate-plans.sh`

When enabled, generation runs in two waves instead of all-parallel:

```
Wave 1: Launch variants 1-2 in parallel
         Wait for completion
         Extract skeletons (section headings + key decisions) from completed plans

Wave 2: Launch variants 3-4 in parallel
         Each variant's prompt includes:
         "The following plan outlines have already been generated.
          Your plan MUST differ structurally — use different approaches,
          different technology choices, or different prioritization:
          [skeleton summaries from wave 1]"
```

### 7b. Skeleton extraction

Simple bash-level extraction (no LLM needed):
```bash
# Extract skeleton: headings + first sentence of each section
grep -E '^#{1,3} ' plan.md  # headings
```

Or for richer context, use Haiku to summarize each plan in 3-5 bullet points.

### 7c. Trade-offs

- Adds ~5-10 min latency (wave 1 must complete before wave 2 starts)
- Reduces parallelism from N to N/2 per wave
- Only valuable when default lenses produce too-similar plans

### 7d. Hybrid with `--auto-lenses`

Can combine: `--auto-lenses --sequential-diversity`
- Auto-generate 4 lenses
- Run first 2, extract skeletons
- Run remaining 2 conditioned on first pair's skeletons

**Files**: `generate-plans.sh`, `AGENTS.md`

**Verification**:
1. Without flag: behavior unchanged (all parallel)
2. With flag: verify wave 1 completes before wave 2 starts
3. Verify wave 2 prompts contain skeleton summaries
4. Verify final output is the same structure (plan-*.md files)

---

## PR dependency graph

```
PR 1 (merge prompts)     ─── independent
PR 2 (variant strategies) ─── independent
PR 3 (evaluate-plans.sh)  ─── independent
PR 4 (auto-lenses)        ─── independent
PR 5 (verify + refine)    ─── depends on PR 1 (constitutional principles in merge-config)
PR 6 (pairwise merge)     ─── depends on PR 1 (merge-plans.sh changes)
PR 7 (sequential diversity)─── independent (but best after PR 4)
```

Recommended order: PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7

PRs 1-4 can be done in any order. PR 5 builds on PR 1's merge-config changes.
PR 6 builds on PR 1's merge-plans.sh prompt structure. PR 7 is independent but
benefits from PR 4's auto-lenses.

---

## Updated architecture after all PRs

```
                          ┌─────────────────────┐
                          │   Your prompt file   │
                          └──────────┬──────────┘
                                     │
                    ┌────────────────┤ (PR 4)
                    ▼                │
            ┌──────────────┐        │
            │ Auto-generate │        │
            │ task-specific │        │
            │   lenses     │        │
            └──────┬───────┘        │
                   │                │
              ┌────┴────┐     ┌────┴────┐
              ▼         ▼     ▼         ▼       (PR 7: wave 1 → wave 2)
        ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ variant 1│ │ variant 2│ │ variant 3│ │ variant 4│
        └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
              │            │            │            │
              └────────────┴──────┬─────┴────────────┘
                                  ▼
                    ┌─────────────────────────┐
                    │  Evaluate (PR 3)        │
                    │  coverage, gaps,        │
                    │  convergence            │
                    └────────────┬────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │  Merge (PR 1, 6)        │
                    │  conflict classification│
                    │  pairwise tournament    │
                    │  minority insights      │
                    │  constitutional check   │
                    └────────────┬────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │  Verify + Refine (PR 5) │
                    │  consistency gate       │
                    │  completeness gate      │
                    │  actionability gate     │
                    │  pre-mortem             │
                    └────────────┬────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │    merged-plan.md       │
                    │    (human review)       │
                    └─────────────────────────┘
```

---

## Estimated effort per PR

| PR | Scope | New files | Modified files | Est. effort |
|----|-------|-----------|----------------|-------------|
| 1  | Merge prompts + constitution | — | merge-plans.sh, merge-config.yaml, AGENTS.md | Small |
| 2  | Variant docs + cost examples | — | config.yaml, README.md, AGENTS.md | Small |
| 3  | evaluate-plans.sh | evaluate-plans.sh | merge-plans.sh, AGENTS.md, README.md | Medium |
| 4  | Auto-generate lenses | — | generate-plans.sh, AGENTS.md | Medium |
| 5  | Verify + refine | verify-plan.sh | merge-plans.sh, merge-config.yaml, AGENTS.md | Medium |
| 6  | Pairwise merge + weights | — | merge-plans.sh, merge-config.yaml, AGENTS.md | Medium |
| 7  | Sequential diversity | — | generate-plans.sh, AGENTS.md | Medium |
