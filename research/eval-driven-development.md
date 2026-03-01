# Eval-Driven Development for claude-plan-composer

Research survey: benchmarks, tools, scientific literature, and industry practices
for systematically evaluating the quality of LLM-generated implementation plans.

## The problem: how do you know if changes improve plan quality?

When you change a merge prompt, add a new variant lens, or switch models, the only
feedback loop today is manual review. That doesn't scale:

- Did `--sequential-diversity` actually reduce convergence?
- Does switching from Opus to Sonnet for generation degrade plan quality?
- Did refactoring the merge prompt lose important details?
- Are auto-generated lenses better than the default config variants?

Without systematic measurement, changes are guided by vibes.

## Part 1: Landscape survey

### 1.1 Planning benchmarks — what exists and what doesn't

Several benchmarks evaluate LLM planning, but none target free-form implementation plans:

**PlanBench** ([Valmeekam et al., NeurIPS 2023](https://arxiv.org/abs/2206.10498)).
Evaluates classical planning using PDDL domains from the International Planning Competition.
Plans are verified against formal specifications (blocksworld, logistics). **Not applicable**
to free-form text plans — requires well-defined goal states with ground-truth solutions.

**NATURAL PLAN** ([Google DeepMind, 2024](https://arxiv.org/abs/2406.04520)).
Benchmarks trip/meeting/calendar planning in natural language with constraint satisfaction.
GPT-4 achieves only 31.1% solve rate on trip planning. **Conceptually relevant** — isolates
planning reasoning from tool use. The constraint satisfaction approach maps to "does the plan
address all stated requirements?"

**TravelPlanner** ([Xie et al., 2024](https://arxiv.org/abs/2402.01622)).
Real-world travel itineraries with budget/dietary/transport constraints across 1,225 intents.
GPT-4 achieves 0.6% success rate. **Medium relevance** — multi-constraint nature mirrors
implementation planning, but domain-specific and requires structured tool outputs.

**PlanGenLLMs** ([ACL 2025 survey](https://arxiv.org/abs/2502.11221)).
The most useful conceptual framework. Defines six plan quality criteria:
1. **Completeness** — are all requirements/constraints addressed?
2. **Executability** — can the plan actually be carried out?
3. **Optimality** — does it minimize unnecessary steps/resources?
4. **Representation** — is it clearly structured and readable?
5. **Generalization** — does it handle edge cases and variations?
6. **Efficiency** — are resources used wisely?

These map well to implementation plan quality, even though the survey covers
classical planning domains.

**The gap**: No benchmark evaluates free-form implementation plans — the kind of
structured markdown documents that architects produce and developers implement from.
This is fundamentally different from constraint-satisfaction planning (where
ground truth exists) or code generation (where tests verify correctness). Our plans
exist in a space where quality is multi-dimensional and inherently subjective.

### 1.2 LLM-as-judge: what the research says

Using one LLM to evaluate another's output is the most practical approach for
free-form text, but comes with well-documented limitations.

**G-Eval** ([Liu et al., EMNLP 2023](https://arxiv.org/abs/2303.16634)).
Chain-of-thought evaluation framework. You define criteria and a task introduction;
the LLM auto-generates evaluation steps, then scores using probability-weighted
aggregation. Achieves 0.514 Spearman correlation with human judgment on summarization.
**Directly applicable** — criterion-based, customizable, available in promptfoo and
DeepEval.

**LLM-Rubric** ([Microsoft, ACL 2024](https://aclanthology.org/2024.acl-long.745/)).
Multi-dimensional evaluation with a calibration neural network that learns judge-specific
and judge-independent parameters. 9 rubric dimensions. Achieves RMSE 0.422 (2x improvement
over uncalibrated). **Key finding: unaided LLM scoring performed worse than random guessing
on overall satisfaction** — only multidimensional calibration unlocked predictive power.
This is the most rigorous approach but requires human annotation for calibration.

**MT-Bench** ([Zheng et al., 2023](https://arxiv.org/abs/2306.05685)).
Pairwise comparison methodology validated against 3K expert votes: GPT-4 matches
human agreement at >80%. **Pairwise comparison is more reliable than absolute scoring**.
This is directly relevant — our merge step already does pairwise tournament comparison.

**Comprehensive bias survey** ([arXiv:2411.15594](https://arxiv.org/abs/2411.15594),
[arXiv:2412.05579](https://arxiv.org/html/2412.05579v2)). Documented biases:

| Bias | Description | Mitigation |
|------|-------------|------------|
| Position bias | Favors first/last response in comparisons | Randomize presentation order |
| Verbosity bias | Prefers longer responses regardless of quality | Normalize by length or penalize padding |
| Self-enhancement | Models prefer their own outputs | Ensemble across model families |
| Anchoring | Influenced by prior scores or examples | Independent scoring per dimension |
| Authority | Favors attributed sources | Anonymize plan sources |

**Aggregate reliability**: GPT-4 matches human agreement ~80% overall, but drops to
60-68% in expert domains (dietetics, mental health). For implementation plans, expect
similar degradation in specialized technical domains.

**Ensemble approach** ([Doshi et al., 2024, Strategic Management Journal](https://doi.org/10.1002/smj.3677)).
"Single LLM evaluations are often inconsistent and biased, but when aggregating evaluations
across LLMs, prompts, and roles, the resulting evaluations tend to resemble those of human
experts." This directly validates claude-plan-composer's multi-perspective approach and
suggests the same principle should apply to evaluation.

### 1.3 The Hamel Husain / Shreya Shankar methodology

[Hamel Husain](https://hamel.dev/blog/posts/llm-judge/) and
[Shreya Shankar](https://arxiv.org/abs/2404.12272) have trained 3,000+ engineers
at 500+ companies (including Anthropic and OpenAI) on practical LLM evaluation.
Their key findings challenge several assumptions in our initial design:

**Binary pass/fail, not Likert scales.**
> "If your evaluations consist of a bunch of metrics that LLMs score on a 1-5 scale,
> you're doing it wrong." — Hamel Husain

The reasoning: a score of 3 or 4 is not actionable. Binary forces clarity about what
actually matters. Each pass/fail must include a detailed critique explaining why.
This contradicts our initial design of 1-5 quality dimensions.

**Criteria drift** (Shankar, [UIST 2024](https://dl.acm.org/doi/10.1145/3654777.3676450)).
> "Some criteria appear dependent on the specific LLM outputs observed rather than being
> independently definable a priori."

Users need criteria to grade outputs, but grading outputs helps define criteria. This means
you **cannot define a perfect rubric upfront**. Plan for iterative refinement: generate plans,
review them, discover failure modes, refine criteria, re-evaluate.

**The "tools trap"** ([Hamel Husain, O'Reilly Radar, 2025](https://hamel.dev/blog/posts/field-guide/)).
> "Generic metrics are worse than useless — they actively impede progress."

Teams celebrate improving a "helpfulness score" by 10% while users still struggle with
basic tasks. Start by examining actual plan data, not by selecting tools.

**Process**: (1) Manually label 100+ outputs with domain expertise, (2) Build taxonomy of
failure modes from the data, (3) Create LLM judges with binary pass/fail + critiques,
(4) Validate judges against human labels using precision/recall (not raw agreement —
imbalanced datasets distort accuracy).

### 1.4 Eval-driven development (EDD) — is it real?

Yes. Multiple independent sources formalize it:

**Academic**: [EDDOps](https://arxiv.org/abs/2411.13768) (Xia et al., CSIRO Data61, 2024).
Formal process model and reference architecture. Treats evaluation as a "continuous,
governing function rather than a terminal checkpoint." Three-layered architecture embedding
evaluation in a closed feedback loop between development and operations.

**Industry**:
- [Braintrust](https://www.braintrust.dev/articles/eval-driven-development): "Evaluations
  serve as the working specification for LLM applications."
- [Vercel/v0](https://vercel.com/blog/eval-driven-development-build-better-ai-faster):
  Iterates on prompts daily, uses evals to prevent regressions.
- [Fireworks AI](https://fireworks.ai/blog/eval-driven-development-with-claude-code):
  "Write evals first, then use Claude Code to build the agent to pass them."
- [evaldriven.org](https://evaldriven.org/): "Build evals first. Code is generated.
  Evals are engineered."

**Anthropic's own approach**:
- [Statistical approach to model evals](https://www.anthropic.com/research/statistical-approach-to-model-evals):
  Always report SEM alongside eval scores. Use power analysis for sample sizes.
  Cluster standard errors for dependent questions (can be 3x larger than naive estimates).
  Analyze paired differences between models (eliminates question-difficulty variance for free).
- [Bloom](https://alignment.anthropic.com/2025/bloom-auto-evals/): Open-source tool for
  automated behavioral evals. Claude Opus 4.1 as judge achieves 0.86 Spearman correlation
  with human labels.
- [Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):
  "Start with 20-50 tasks drawn from real failures. Don't wait for hundreds."

### 1.5 Evaluation tools landscape

| Tool | Type | Long-form plan support | Cost | Key strength |
|------|------|----------------------|------|-------------|
| [promptfoo](https://www.promptfoo.dev/) | OSS CLI | High (llm-rubric, JS assertions) | Free + API | Declarative YAML, CI/CD, red-teaming |
| [Braintrust](https://www.braintrust.dev/) | Platform | High (custom scorers, A/B) | Freemium | GitHub Action posts eval diffs on PRs |
| [DeepEval](https://deepeval.com/) | OSS Python | High (G-Eval metric, custom) | Free + API | Pytest-like, 50+ metrics |
| [Langfuse](https://langfuse.com/) | OSS Platform | Medium (custom evaluators) | Self-host | Full control, no vendor lock-in |
| [Arize Phoenix](https://phoenix.arize.com/) | OSS Observability | Medium (drift detection) | Self-host | Embedding analysis for plan diversity |
| [LangSmith](https://www.langchain.com/evaluation) | Platform | Medium-High (annotation queues) | Freemium | LangChain ecosystem integration |
| [OpenAI Evals API](https://platform.openai.com/docs/guides/evals/) | API | Medium (structured grading) | API costs | model_grader on 1-7 rubric scales |
| [Patronus AI](https://patronus.ai/) | Platform | Medium (hallucination detection) | Commercial | Lynx model for factual accuracy |

**For our use case** (bash scripts, shell-based pipeline, tracking quality over time):
promptfoo is the natural fit — YAML config, CLI-based, custom providers via shell scripts,
no Python or SDK required.

### 1.6 Long-form text evaluation

Two recent papers address our specific challenge of evaluating long, structured documents:

**LongEval** ([arXiv:2502.19103](https://arxiv.org/abs/2502.19103), Feb 2025).
Plan-based evaluation framework for long-text generation. Evaluates content quality,
structural coherence, and information density. Found that **plan-based generation
(outline first, then sections) produces superior quality** — validates our
generate-then-merge architecture.

**HALF-Eval** (Amazon Science, 2025). Human-Aligned Long-Form Evaluation.
Automates assessment through structured checklists and regression modeling. Uses
checklists (not scales) as the primary evaluation unit — aligns with the binary
pass/fail recommendation from Hamel Husain.

### 1.7 Prompt regression in production

The industry pattern for tracking LLM quality over time is now well-established:

1. **Golden dataset** of test inputs with quality criteria (not exact outputs)
2. **Automated evals on every prompt change** (CI/CD gate)
3. **LLM-as-judge** scoring per dimension
4. **Regression thresholds**: no dimension drops more than X% below baseline
5. **Section-level tracking** — overall averages mask regressions ([Statsig](https://www.statsig.com/perspectives/slug-prompt-regression-testing): "a 2% overall dip can mask a 15% collapse in a single category")
6. **Tiered runs**: fast structural checks on every change, full LLM eval weekly
7. **Model version monitoring** — [(Why) Is My Prompt Getting Worse?](https://arxiv.org/abs/2311.11123) documented that model API updates silently degrade prompt performance

### 1.8 Current model landscape (as of March 2026)

The LLM landscape has advanced significantly since many of the papers cited above were
published (2023-2024). Current frontier models for generation and evaluation:

| Provider | Model | Role | Pricing (per MTok) | Context | Notes |
|----------|-------|------|--------------------|---------|-------|
| **Anthropic** | Claude Opus 4.6 | Generation + merge | $5 / $25 | 1M | Our pipeline's default. Deep reasoning, multi-agent. |
| **Anthropic** | Claude Sonnet 4.6 | Generation (cost-optimized) | $3 / $15 | 200K | First Sonnet preferred over prior Opus in coding evals. |
| **Anthropic** | Claude Haiku 4.5 | Evaluation, cheap judge | $1 / $5 | 200K | 4-5x faster than Sonnet. Good for binary pass/fail. |
| **OpenAI** | GPT-5.2 | Cross-model judge | $1.75 / $14 | 400K | Current flagship. Replaced GPT-4o (retired Feb 2026). |
| **OpenAI** | GPT-5.2 Pro | Deep reasoning judge | $21 / $168 | 400K | Extended thinking variant. |
| **OpenAI** | GPT-5.3-Codex | Code-specific evaluation | TBD | TBD | Coding-focused. |
| **Google** | Gemini 3.1 Pro | Cross-model judge | $2 / $12 | 1M | Latest Google flagship. 77.1% on ARC-AGI-2. |
| **Google** | Gemini 2.5 Pro | Stable alternative | $1.25 / $5 | 1M | Mature, well-tested. |

**Key changes from the papers cited above:**
- GPT-4, GPT-4o, GPT-4.1, and o4-mini were **retired on February 13, 2026**. References to
  "GPT-4 as judge" in the LLM-as-judge literature (MT-Bench, G-Eval, bias surveys) used
  models that no longer exist. Their successors (GPT-5.2) are substantially more capable.
- Google's Gemini 3.1 Pro (Feb 2026) provides a third independent model family for
  cross-model ensemble judging — reducing correlated biases further than two-family ensembles.
- Pricing has dropped ~2-4x across all providers since 2023-2024, making cross-model ensemble
  judging (3 model families) cost-effective for evaluation.

**Recommended judge configuration for the paper:**
1. **Primary judge**: GPT-5.2 ($1.75/$14) — different model family from the pipeline (Claude),
   avoids self-enhancement bias.
2. **Secondary judge**: Gemini 3.1 Pro ($2/$12) — third independent family, flags where
   GPT-5.2 and Claude agree due to shared training data patterns.
3. **Validation judge**: Claude Sonnet 4.6 ($3/$15) — same family as pipeline, used only to
   detect cases where cross-model judges are harsher than warranted.
4. **Cheap screening**: Claude Haiku 4.5 ($1/$5) — for routine regression checks.

---

## Part 2: What we got wrong (and right) in v1

### Correct intuitions

- Test prompts spanning different scopes and domains ✓
- Structural checks (deterministic, free) as a first layer ✓
- promptfoo as the evaluation harness (good fit for our shell-based workflow) ✓
- Git-tracked results for comparison over time ✓
- Tiered evaluation (cheap structural + expensive LLM-as-judge) ✓
- Phased implementation starting with manual review ✓

### Needs revision

**1-5 Likert scales → Binary pass/fail + critique.**
Our v1 rubric used `Rate 1-5` for quality dimensions. Hamel Husain, enterprise best
practices (Maharaj et al., 2025, [AI Magazine](https://doi.org/10.1002/aaai.70028)),
and the HALF-Eval framework all converge on the same recommendation: binary pass/fail
with detailed critiques. The reasoning is that a 3 vs 4 distinction is ambiguous and
not actionable. A fail-because-X is.

**Static rubric → Iterative criteria development.**
Our v1 assumed we could define the scoring rubric upfront. Shreya Shankar's criteria
drift finding (UIST 2024) shows this doesn't work — criteria emerge from reviewing actual
outputs. Phase 1 must include systematic plan review to discover failure modes before
locking down evaluation criteria.

**Single-judge → Ensemble or cross-model judging.**
Our v1 used a single LLM-as-judge. The bias survey (arXiv:2411.15594) and the
self-enhancement bias (arXiv:2410.21819) show that Claude judging Claude plans has
correlated biases. Mitigation: ensemble across model families (Claude + GPT-5.2 + Gemini 3.1 Pro),
positional randomization, or use structural checks as the primary signal with
LLM-as-judge as supplementary.

**Missing: statistical rigor.**
Anthropic's own research recommends reporting SEM, using paired differences, and
conducting power analysis. With our 4-variant pipeline producing different plans each run,
we need to distinguish real quality differences from noise. Running the same configuration
2-3 times and averaging is not sufficient — we need confidence intervals.

**Missing: section-level granularity.**
Our v1 scored plans as a whole. Statsig's insight about category-level regressions means
we should evaluate per-section (architecture quality, implementation steps, error handling,
testing approach, deployment) to catch targeted degradations.

---

## Part 3: Revised approach

### 3.1 Evaluation dimensions

Based on the PlanGenLLMs taxonomy ([arXiv:2502.11221](https://arxiv.org/abs/2502.11221)),
adapted for free-form implementation plans. Six dimensions, initially defined below, but
expected to evolve through criteria drift discovery (Shankar et al.,
[UIST 2024](https://dl.acm.org/doi/10.1145/3654777.3676450)):

| Dimension | Definition | Check type | Grounding |
|-----------|------------|------------|-----------|
| Completeness | All requirements from the prompt are addressed | Binary + critique | PlanGenLLMs criterion 1; NATURAL PLAN constraint satisfaction ([arXiv:2406.04520](https://arxiv.org/abs/2406.04520)) |
| Actionability | A developer could start implementing without clarifying questions | Binary + critique | PlanGenLLMs "executability" criterion 2 |
| Coherence | Steps are logically ordered, no internal contradictions | Binary + critique | LongEval "structural coherence" dimension ([arXiv:2502.19103](https://arxiv.org/abs/2502.19103)) |
| Concreteness | Specific examples, exact commands, not generic advice | Binary + critique | PlanGenLLMs "representation" criterion 4 |
| Trade-off awareness | Acknowledges alternatives, justifies choices | Binary + critique | Doshi et al. finding that aggregated diverse perspectives improve quality ([doi:10.1002/smj.3677](https://doi.org/10.1002/smj.3677)) |
| Structural quality | Proper headings, logical flow, readable | Deterministic | HALF-Eval checklist approach (Amazon Science, 2025) |

**Binary pass/fail with critique, not Likert scales.** Per Hamel Husain's methodology
([LLM-as-Judge guide](https://hamel.dev/blog/posts/llm-judge/)), each binary judgment
requires a 2-3 sentence critique explaining the reasoning. These critiques serve dual
purpose: (1) actionable feedback on what to improve, (2) few-shot examples for the judge
prompt itself. Enterprise best practices converge on the same recommendation (Maharaj et al.,
2025, [AI Magazine](https://doi.org/10.1002/aaai.70028): "binary classification over Likert
scales for LLM judges").

**Section-level granularity.** Evaluating at the plan-section level (architecture, implementation
steps, error handling, testing, deployment) rather than whole-plan, per industry regression
testing practice ([Statsig](https://www.statsig.com/perspectives/slug-prompt-regression-testing):
"a 2% overall dip can mask a 15% collapse in a single category"). promptfoo's JavaScript
assertions can parse markdown headings to extract and score individual sections.

### 3.2 Three-tier evaluation architecture

**Tier 1 — Structural checks (free, deterministic, every run)**

Deterministic assertions that run without LLM calls. Catch format regressions for zero cost.
Based on HALF-Eval's checklist approach and industry CI/CD practice
([Traceloop](https://www.traceloop.com/blog/automated-prompt-regression-testing-with-llm-as-a-judge-and-ci-cd)):

```yaml
# promptfoo Tier 1 assertions — structural checks
tests:
  - assert:
      - type: javascript
        value: "output.startsWith('# ')"
        metric: starts_with_heading

      - type: javascript
        value: "(output.match(/^## /gm) || []).length >= 3"
        metric: has_minimum_sections

      - type: javascript
        value: "(output.match(/```/g) || []).length >= 2"
        metric: has_code_blocks

      - type: javascript
        value: "output.length > 2000"
        metric: minimum_length

      # Section-level: extract and check each major section
      - type: javascript
        value: |
          const sections = output.split(/^## /m).slice(1);
          const sectionNames = sections.map(s => s.split('\n')[0].toLowerCase());
          const required = ['requirements', 'structure', 'implementation', 'test'];
          return required.some(r => sectionNames.some(s => s.includes(r)));
        metric: has_required_sections

      # Requirement coverage: check prompt bullets appear in plan
      - type: javascript
        value: |
          const prompt = context.vars.prompt || '';
          const bullets = prompt.match(/^[-*] .+/gm) || [];
          const covered = bullets.filter(b => {
            const keywords = b.replace(/^[-*] /, '').split(/\s+/).filter(w => w.length > 4);
            return keywords.some(kw => output.toLowerCase().includes(kw.toLowerCase()));
          });
          return bullets.length === 0 || covered.length / bullets.length >= 0.7;
        metric: requirement_coverage
```

**Tier 2 — Binary pass/fail with LLM judge (per-dimension, moderate cost)**

For each dimension, the judge receives the original prompt (requirements), the generated plan,
the dimension definition, pass/fail criteria, and 2-3 few-shot examples of pass and fail
judgments with critiques. This follows Husain's 7-step process
([LLM-as-Judge guide](https://hamel.dev/blog/posts/llm-judge/)): identify domain expert →
build dataset → obtain binary judgments with critiques → iterate judge prompt → measure
precision/recall against held-out labels.

The judge prompt uses G-Eval's chain-of-thought approach ([arXiv:2303.16634](https://arxiv.org/abs/2303.16634))
to auto-generate evaluation steps before rendering a verdict:

```yaml
# promptfoo Tier 2 assertions — binary LLM judges
tests:
  - assert:
      - type: llm-rubric
        value: |
          You are evaluating an implementation plan for COMPLETENESS.

          ## Original prompt (requirements):
          {{prompt}}

          ## Pass criteria:
          The plan addresses ALL requirements listed in the original prompt.
          Every bullet point from the requirements section has a corresponding
          section, subsection, or explicit discussion in the plan.

          ## Fail criteria:
          One or more requirements from the original prompt are missing,
          only superficially mentioned, or deferred without explanation.

          ## Few-shot examples:

          EXAMPLE 1 (PASS):
          Prompt required: file input, stdin, --output flag, nested JSON, streaming.
          Plan has: "Input handling" section covering files and stdin, "CLI flags"
          section with --output, "Nested JSON" section with dot-notation parser,
          "Streaming architecture" section with chunked reader.
          Verdict: PASS. All five requirements have dedicated plan sections with
          concrete implementation details.

          EXAMPLE 2 (FAIL):
          Prompt required: file input, stdin, --output flag, nested JSON, streaming.
          Plan has: "Input handling" section covering files, "CLI" section mentioning
          flags briefly, "JSON output" section without nested/dot-notation discussion.
          Verdict: FAIL. Missing: stdin support not mentioned, nested JSON via
          dot-notation not addressed, streaming not discussed. Three of five
          requirements absent.

          ## Your evaluation:
          First, list each requirement from the original prompt.
          Then check whether the plan addresses each one.
          Finally, render PASS or FAIL with a 2-3 sentence critique.
        metric: completeness

      - type: llm-rubric
        value: |
          You are evaluating an implementation plan for ACTIONABILITY.

          ## Pass criteria:
          A mid-level developer could start implementing from this plan without
          asking clarifying questions. The plan includes: specific file paths or
          module names, function signatures or API contracts, concrete CLI commands
          or configuration examples, version numbers for dependencies.

          ## Fail criteria:
          The plan uses vague language ("set up the database," "implement the API,"
          "add error handling") without specifying what to create, where, or how.
          A developer would need to make significant design decisions not covered
          by the plan.

          ## Few-shot examples:

          EXAMPLE 1 (PASS):
          Plan says: "Create src/parser.py with function parse_csv(stream: IO[bytes],
          delimiter: str = ',') -> Iterator[dict]. Use csv.reader with
          quoting=csv.QUOTE_ALL for RFC 4180 compliance."
          Verdict: PASS. Specific file path, function signature with types, library
          choice with exact parameter, and standards reference.

          EXAMPLE 2 (FAIL):
          Plan says: "The parser module should handle CSV parsing with proper
          error handling and support for edge cases."
          Verdict: FAIL. No file path, no function signature, no library choice,
          "proper error handling" and "edge cases" are unspecified.

          ## Your evaluation:
          Identify 3-5 key implementation decisions in the plan. For each, assess
          whether the plan provides enough specificity to implement without guessing.
          Render PASS or FAIL with a 2-3 sentence critique.
        metric: actionability

      - type: llm-rubric
        value: |
          You are evaluating an implementation plan for TRADE-OFF AWARENESS.

          ## Pass criteria:
          The plan acknowledges at least one alternative approach for a key design
          decision and explains why the chosen approach is preferred. The explanation
          references concrete trade-offs (performance, complexity, maintainability,
          team familiarity, ecosystem maturity).

          ## Fail criteria:
          The plan presents every choice as the only reasonable option. No
          alternatives mentioned. No "we chose X over Y because Z" reasoning.

          Render PASS or FAIL with a 2-3 sentence critique.
        metric: trade_off_awareness
```

**Judge model selection.** Per the self-enhancement bias finding ([arXiv:2410.21819](https://arxiv.org/abs/2410.21819)),
Claude judging Claude-generated plans has correlated biases. Two mitigations:

1. **Cross-model ensemble**: Run the same judge prompt through Claude, GPT-5.2, and/or
   Gemini 3.1 Pro — flag disagreements for manual review. promptfoo supports multiple
   providers per assertion natively. Doshi et al. ([doi:10.1002/smj.3677](https://doi.org/10.1002/smj.3677))
   showed aggregating across different LLMs produces evaluations resembling human experts.

2. **Structural-first strategy**: Use Tier 1 (deterministic) as the primary regression gate.
   Reserve Tier 2 (LLM judge) for qualitative dimensions where structural checks can't reach.
   This reduces the surface area exposed to judge bias.

```yaml
# promptfoo provider config for cross-model judging
defaultTest:
  options:
    provider:
      id: openai:gpt-5.2          # judge model (cross-model)
      # Alternative: use multiple judges and flag disagreements
      # id: [openai:gpt-5.2, anthropic:claude-sonnet-4-6, google:gemini-3.1-pro]
```

**Tier 3 — Pairwise comparison (highest signal, highest cost)**

For targeted A/B comparisons (e.g., Opus vs Sonnet generation, with vs without
`--sequential-diversity`): present two plans side-by-side and ask the judge to pick the
better one per dimension. MT-Bench ([arXiv:2306.05685](https://arxiv.org/abs/2306.05685))
validated that pairwise comparison is more reliable than absolute scoring, with GPT-4
matching human agreement at >80%.

**Critical: randomize presentation order** to mitigate position bias. The bias survey
([arXiv:2411.15594](https://arxiv.org/abs/2411.15594)) found most LLMs favor the first
response; only GPT-4 was consistent >60% of cases. Run each comparison twice with swapped
order and discard cases where the judge contradicts itself.

Our merge step already implements pairwise tournament comparison (`comparison_method: pairwise`
in `merge-config.yaml`). The same methodology extends naturally to evaluation: the merge
decides which plan elements to keep; the eval decides which pipeline configuration
produces better plans.

### 3.3 Tooling decision: promptfoo

**Why promptfoo over alternatives.** The research changed our methodology (binary scoring,
ensemble judging, iterative criteria) but not the tool choice. promptfoo accommodates
every research-backed change:

| Research finding | promptfoo capability | Citation |
|-----------------|---------------------|----------|
| Binary pass/fail + critique | `llm-rubric` with custom pass/fail prompt | Husain ([LLM-as-Judge guide](https://hamel.dev/blog/posts/llm-judge/)) |
| Structural checks as primary gate | JavaScript assertions (`type: javascript`) | HALF-Eval (Amazon, 2025) |
| Cross-model ensemble judging | Multiple providers per assertion | Doshi et al. ([doi:10.1002/smj.3677](https://doi.org/10.1002/smj.3677)) |
| Section-level granularity | JS assertions parse markdown, score per-section | [Statsig](https://www.statsig.com/perspectives/slug-prompt-regression-testing) |
| Iterative criteria refinement | YAML config is version-controlled, diffable | Shankar ([UIST 2024](https://dl.acm.org/doi/10.1145/3654777.3676450)) |
| CI/CD regression gates | Native GitHub Action, CLI exit codes | [Traceloop](https://www.traceloop.com/blog/automated-prompt-regression-testing-with-llm-as-a-judge-and-ci-cd) |
| Custom pipeline wrapping | `exec:` provider runs arbitrary shell commands | — |
| Pairwise comparison | `model-graded-closedqa` with two-response template | MT-Bench ([arXiv:2306.05685](https://arxiv.org/abs/2306.05685)) |

**Why not the alternatives:**

- **Braintrust** ([braintrust.dev](https://www.braintrust.dev/)): Richer dashboard, posts eval
  diffs on GitHub PRs automatically. But commercial platform with vendor lock-in. Its key
  advantage (GitHub Action integration) is also available in promptfoo. Best fit for teams
  with a web product where production monitoring and A/B testing justify the platform cost.
  Not needed for an offline plan-generation pipeline.

- **DeepEval** ([deepeval.com](https://deepeval.com/)): Pytest-like interface with G-Eval metric
  built in. Strong Python integration. But our pipeline is bash scripts — introducing a Python
  test framework adds an unnecessary dependency layer. DeepEval's G-Eval implementation could
  be replicated in promptfoo's `llm-rubric` with a chain-of-thought prompt.

- **Langfuse** ([langfuse.com](https://langfuse.com/)): Open-source, self-hostable observability.
  Good for tracing multi-step LLM pipelines. But focused on observability, not evaluation —
  would need custom evaluation logic on top. More infrastructure than we need.

- **OpenAI Evals API** ([platform.openai.com](https://platform.openai.com/docs/guides/evals/)):
  `structured_output_grader` is relevant for rubric-based scoring
  ([Cookbook example](https://cookbook.openai.com/examples/evaluation/use-cases/structured_outputs_evaluation)).
  But OpenAI-specific — only runs OpenAI models as judges. For evaluating Claude-generated plans,
  we'd be limited to using it only for grading, not generation. promptfoo supports both
  OpenAI and Anthropic models as judge providers.

- **Custom scripts**: Lower barrier but less battle-tested. promptfoo's comparison views,
  caching, and parallel execution are non-trivial to reimplement. The YAML declarative config
  is also easier to version-control and diff than procedural test scripts.

**What promptfoo does NOT provide (and we layer on top):**

- **Statistical rigor**: promptfoo outputs raw scores per test case. SEM, paired differences,
  and confidence intervals require a thin wrapper script that reads promptfoo's JSON output
  and computes statistics. See §3.4.

- **Criteria drift tracking**: promptfoo doesn't track how rubrics evolve. We version-control
  the YAML config and tag eval runs with the rubric version. See §3.5.

- **Hallucination detection**: For plans referencing specific APIs or libraries, Patronus AI's
  Lynx model ([patronus.ai](https://patronus.ai/)) could supplement promptfoo's judges.
  Not critical for initial phases.

### 3.4 Custom provider: wrapping the pipeline

The custom exec provider runs our full pipeline (generate → merge) for each test prompt:

```bash
#!/usr/bin/env bash
# evals/provider.sh — Custom promptfoo provider.
# Runs the full claude-plan-composer pipeline for one prompt.
# stdin: prompt text from promptfoo
# stdout: merged plan text
# Config vars: PROMPTFOO_CONFIG_model, PROMPTFOO_CONFIG_merge_mode, etc.

set -euo pipefail

MODEL="${PROMPTFOO_CONFIG_model:-sonnet}"
MERGE_MODE="${PROMPTFOO_CONFIG_merge_mode:-simple}"
SEQ_DIV="${PROMPTFOO_CONFIG_sequential_diversity:-false}"

PROMPT_FILE=$(mktemp /tmp/eval-prompt-XXXXXX.md)
trap 'rm -f "$PROMPT_FILE"' EXIT
cat > "$PROMPT_FILE"

EXTRA_FLAGS=""
[[ "$SEQ_DIV" == "true" ]] && EXTRA_FLAGS="--sequential-diversity"

# Unset CLAUDECODE to allow nested sessions (see e2e test fix)
unset CLAUDECODE

MODEL="$MODEL" \
  ./generate-plans.sh $EXTRA_FLAGS "$PROMPT_FILE"

RUN_DIR="generated-plans/$(basename "$PROMPT_FILE" .md)/latest"

MODEL="$MODEL" MERGE_MODE="$MERGE_MODE" \
  ./merge-plans.sh "$RUN_DIR"

cat "$RUN_DIR/merged-plan.md"
```

Multiple provider configurations test different pipeline settings:

```yaml
# promptfooconfig.yaml
providers:
  - id: "exec:./evals/provider.sh"
    label: "sonnet-4v-holistic"
    config:
      model: sonnet
      merge_mode: simple

  - id: "exec:./evals/provider.sh"
    label: "sonnet-4v-sequential"
    config:
      model: sonnet
      merge_mode: simple
      sequential_diversity: "true"

  - id: "exec:./evals/provider.sh"
    label: "opus-4v-holistic"
    config:
      model: opus
      merge_mode: simple
```

### 3.5 Statistical methodology

Anthropic's statistical recommendations ([Statistical Approach to Model Evaluations](https://www.anthropic.com/research/statistical-approach-to-model-evals))
apply directly. Their key finding: "clustered standard errors can be over three times as large
as naive standard errors" when questions are related. In our case, multiple dimensions scored
from the same plan are dependent observations — they share the same generation context.

**1. Standard error of the mean (SEM).**
Report SEM alongside all aggregate pass rates. For binary pass/fail, SEM for a proportion
p from n observations: `SEM = sqrt(p * (1-p) / n)`. With 5 test prompts and a 60% pass rate
on actionability: `SEM = sqrt(0.6 * 0.4 / 5) = 0.22` — a wide interval reflecting that
5 prompts cannot distinguish 60% from 38-82%.

**2. Paired differences for A/B comparisons.**
When comparing two pipeline configurations (e.g., with vs without `--sequential-diversity`),
both run on the same test prompts. Use paired differences to eliminate prompt-difficulty
variance. Anthropic notes model score correlations on the same questions are "between 0.3
and 0.7" — making this a "free" variance reduction technique.

**3. Cluster standard errors by prompt.**
Multiple dimensions from the same plan (completeness, actionability, coherence) are not
independent — a bad plan fails on multiple dimensions simultaneously. Cluster by prompt
when computing aggregate statistics.

**4. Power analysis before large eval runs.**
Determine sample size needed before spending $100+ on a full eval. For detecting a 20
percentage-point difference (e.g., 60% → 80% pass rate) with 80% power at α=0.05:
need ~25 observations per configuration. With 5 test prompts, that means 5 repeated runs
per configuration — each run generates 4 variants + merge, so 25 pipeline executions total.

**5. Implementation**: a thin `evals/analyze.sh` script reads promptfoo's JSON output and
computes SEM, paired differences, and confidence intervals. This does not require promptfoo
changes — it operates on the output files.

### 3.6 Iterative criteria development

Shankar et al. ([UIST 2024](https://dl.acm.org/doi/10.1145/3654777.3676450)) showed that
evaluation criteria shift after reviewing model outputs — "criteria drift." The EvalGen system
demonstrated that generating candidate evaluators and having humans grade a subset to select
the best-aligned ones is more effective than defining criteria top-down.

Husain's process ([Field Guide](https://hamel.dev/blog/posts/field-guide/)) operationalizes
this: "Start by looking at actual data. Write open-ended notes on failures. Use an LLM to
build a taxonomy of failure modes. Map each case to specific failure labels and count
frequencies. Let metrics emerge from data, not from generic frameworks."

**Our iterative process:**

1. **Generate** plans with current pipeline (3-5 prompts × 4 variants × 2-3 runs = ~30-60 plans).
2. **Review** ~50 plans. Write free-form notes on each: what's good, what's missing, what's
   wrong. Don't use a rubric — discover the rubric from the data.
3. **Cluster** failure notes into a taxonomy using an LLM. Expected categories might include:
   "missing error handling details," "no concrete commands," "contradictory architecture
   choices," "unnecessary abstractions," "missing testing strategy."
4. **Map** taxonomy to binary pass/fail criteria. Each criterion becomes a dimension with
   explicit pass/fail definitions and few-shot examples drawn from the reviewed plans.
5. **Build** judge prompt using expert critiques as few-shot examples.
6. **Validate** judge against 20+ held-out manually-labeled plans. Measure precision and recall
   separately (per Husain: "don't rely on raw agreement rates for imbalanced datasets").
   Target: >80% agreement. If below, iterate the judge prompt (step 5), not the criteria.
7. **Version-tag** the criteria in git. Each eval run records which criteria version was used.
8. **Repeat quarterly** or after significant pipeline changes. New failure modes emerge as
   prompts, models, and merge strategies change.

---

## Part 4: Implementation phases

### Phase 1 — Manual baseline (current priority)

Generate plans with the current pipeline for 3-5 diverse test prompts. Manually review
all outputs (~30-60 plans). Write free-form notes on quality — don't use a rubric yet.
Build a taxonomy of failure modes from the notes.

Following Anthropic's guidance ([Demystifying Evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)):
"Start with 20-50 tasks drawn from real failures. Don't wait for hundreds." And Husain's
warning ([Field Guide](https://hamel.dev/blog/posts/field-guide/)): "The single most
impactful investment is building a customized interface that lets anyone examine what your
AI is actually doing" — for us this is simply reading the markdown plan files, but a
structured spreadsheet (prompt → plan → notes → pass/fail per dimension) accelerates review.

**Output**: failure mode taxonomy, initial dimension definitions, 20+ labeled plans.

### Phase 2 — Structural checks (free, immediate value)

Add deterministic checks (Tier 1) to the existing pipeline. These can be a standalone
`eval-plans.sh` script or integrated into `verify-plan.sh`. They run without LLM calls
and catch format regressions for zero cost.

Per the tiered CI/CD practice ([Traceloop](https://www.traceloop.com/blog/automated-prompt-regression-testing-with-llm-as-a-judge-and-ci-cd)):
"fast smoke evals on every commit, comprehensive suites nightly." Structural checks are
the smoke evals.

**Output**: structural check script, baseline pass rates per prompt.

### Phase 3 — Binary judges with promptfoo (moderate cost)

Build LLM judge prompts for 3-4 key dimensions using few-shot examples from Phase 1.
Validate judges against held-out manually-labeled plans (precision/recall > 80%).
Integrate with promptfoo.

Use cross-model judging (Claude Sonnet 4.6 + GPT-5.2 + Gemini 3.1 Pro) for at least the
initial calibration round to identify dimensions where self-enhancement bias is strongest.
Per the bias survey ([arXiv:2411.15594](https://arxiv.org/abs/2411.15594)), position bias and
self-enhancement are the most impactful biases for our use case. Where judges from different
model families disagree, investigate the specific plan and refine the judge prompt.

Run the first full eval suite. Compute SEM and confidence intervals.

**Output**: `promptfooconfig.yaml`, judge prompts per dimension, baseline scores with SEM,
judge validation report (precision/recall vs human labels).

### Phase 4 — Continuous tracking (ongoing)

Run the eval suite before and after significant changes (model upgrades, merge prompt
refactoring, new variant lenses). Git-track results as JSON. Compare configurations
using paired differences and confidence intervals.

Per the model version monitoring finding (Chen et al., 2023,
[(Why) Is My Prompt Getting Worse?](https://arxiv.org/abs/2311.11123)): model API updates
can silently degrade prompt performance. Re-run the eval suite after each Claude model
update, even if our code hasn't changed.

Refine judge prompts and criteria as new failure modes emerge (§3.6).

**Output**: score history directory, regression gates, quarterly criteria refresh.

---

## Cost considerations

| Configuration | Per prompt | 5 prompts | 10 prompts |
|--------------|-----------|-----------|------------|
| Tier 1 only (structural) | $0 | $0 | $0 |
| Tier 1 + Tier 2 (binary judge, Haiku) | ~$0.10 | ~$0.50 | ~$1 |
| Tier 1 + Tier 2 (binary judge, Sonnet) | ~$0.50 | ~$2.50 | ~$5 |
| Tier 1 + Tier 2 (cross-model: Sonnet + GPT-5.2) | ~$1.00 | ~$5 | ~$10 |
| Full pipeline (Sonnet gen) + Tier 2 | ~$5.50 | ~$27.50 | ~$55 |
| Full pipeline (Opus gen) + Tier 2 | ~$20.50 | ~$102.50 | ~$205 |
| Full pipeline + Tier 3 pairwise | ~$25 | ~$125 | ~$250 |

Note: Tier 2 costs are for judging already-generated plans. Full pipeline costs include
generation + merge. The tiered approach means most changes only need Tier 1 (free) + Tier 2
on cached plans (~$1-5 with Haiku/Sonnet judge). Full pipeline re-generation is only needed
when testing generation-level changes (model, variants, sequential diversity).

**Cost mitigation strategies:**

- **Tiered evaluation**: Structural checks on every commit, binary judges weekly, full
  pipeline monthly (Traceloop CI/CD pattern).
- **Judge model cascade**: Use Haiku for routine regression checks, Sonnet 4.6/GPT-5.2/Gemini 3.1 Pro
  for initial calibration and disputed cases. Anthropic's Bloom found Claude Opus achieves
  0.86 Spearman correlation as judge — but Haiku may suffice for binary pass/fail where
  precision requirements are lower.
- **Subset testing**: Use 2-3 representative prompts for quick checks, full suite for releases.
- **Cache baselines**: Only re-run the configuration that changed, compare against cached results.

---

## References

### Planning benchmarks

1. Valmeekam, K. et al. (2023). "PlanBench: An Extensible Benchmark for Evaluating Large Language Models on Planning and Reasoning about Change." NeurIPS 2023. [arXiv:2206.10498](https://arxiv.org/abs/2206.10498). [GitHub](https://github.com/karthikv792/LLMs-Planning)
2. Zheng, B. et al. (2024). "NATURAL PLAN: Benchmarking LLMs on Natural Language Planning." Google DeepMind. [arXiv:2406.04520](https://arxiv.org/abs/2406.04520). [GitHub](https://github.com/google-deepmind/natural-plan)
3. Xie, J. et al. (2024). "TravelPlanner: A Benchmark for Real-World Planning with Language Agents." [arXiv:2402.01622](https://arxiv.org/abs/2402.01622). [GitHub](https://github.com/OSU-NLP-Group/TravelPlanner)
4. PlanGenLLMs (2025). Comprehensive survey of LLM planning capabilities. ACL 2025. [arXiv:2502.11221](https://arxiv.org/abs/2502.11221). [ACL Anthology](https://aclanthology.org/2025.acl-long.958/)
5. PLANET (2025). Meta-benchmark of planning benchmarks across five categories. [arXiv:2504.14773](https://arxiv.org/abs/2504.14773)

### LLM-as-judge methodology

6. Liu, Y. et al. (2023). "G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment." EMNLP 2023. [arXiv:2303.16634](https://arxiv.org/abs/2303.16634)
7. Zheng, L. et al. (2023). "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena." [arXiv:2306.05685](https://arxiv.org/abs/2306.05685)
8. Doosterlinck, K. et al. (2024). "LLM-Rubric: A Multidimensional, Calibrated Approach to Automated Evaluation of Natural Language Texts." ACL 2024. [ACL Anthology](https://aclanthology.org/2024.acl-long.745/). [GitHub](https://github.com/microsoft/LLM-Rubric). Extended version: [arXiv:2501.00274](https://arxiv.org/abs/2501.00274)

### LLM-as-judge bias and limitations

9. Li, D. et al. (2024). "A Survey on LLM-as-a-Judge." [arXiv:2411.15594](https://arxiv.org/abs/2411.15594). [Project page](https://awesome-llm-as-a-judge.github.io/)
10. Haitao, C. et al. (2024). "LLMs-as-Judges: A Comprehensive Survey on LLM-based Evaluation Methods." [arXiv:2412.05579](https://arxiv.org/html/2412.05579v2). [GitHub](https://github.com/CSHaitao/Awesome-LLMs-as-Judges)
11. Panickssery, A. et al. (2024). "Self-Preference Bias in LLM-as-a-Judge." [arXiv:2410.21819](https://arxiv.org/abs/2410.21819)
12. Ye, S. et al. (2024). "Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge." [arXiv:2410.02736](https://arxiv.org/abs/2410.02736)
13. (2025). "Evaluating Scoring Bias in LLM-as-a-Judge." [arXiv:2506.22316](https://arxiv.org/abs/2506.22316)
14. (2025). "An Empirical Study of LLM-as-a-Judge: How Design Choices Impact Evaluation Reliability." [arXiv:2506.13639](https://arxiv.org/abs/2506.13639)

### Ensemble evaluation and aggregation

15. Doshi, A. R. et al. (2024). "Generative AI, Expertise, and the Evaluation of Strategic Decisions." Strategic Management Journal. [doi:10.1002/smj.3677](https://doi.org/10.1002/smj.3677)
16. Maharaj, A. V. et al. (2025). "Evaluation and incident prevention in an enterprise AI assistant." AI Magazine, 46(3). [doi:10.1002/aaai.70028](https://doi.org/10.1002/aaai.70028)
17. Kranzle, T. & Sharratt, K. (2025). "Evaluating Creative Output With Generative Artificial Intelligence: Comparing GPT Models and Human Experts in Idea Evaluation." Creativity and Innovation Management, 34(4), 991-1012. [doi:10.1111/caim.70007](https://doi.org/10.1111/caim.70007)

### Long-form text evaluation

18. (2025). "LongEval: A Comprehensive Analysis of Long-Text Generation Through a Plan-based Paradigm." [arXiv:2502.19103](https://arxiv.org/abs/2502.19103)
19. (2025). "HALF-Eval: Human-Aligned Long-Form Evaluation Framework for Assessing AI-Generated Content." Amazon Science. [PDF](https://assets.amazon.science/4a/de/85b797d4482a80bcbc9d6151167a/human-aligned-long-form-evaluation-half-eval-framework-for-assessing-ai-generated-content-and-improvement.pdf)
20. (2025). "Benchmarking Long-Form Generation in Long Context LLMs." ICLR 2025. [PDF](https://proceedings.iclr.cc/paper_files/paper/2025/file/141304a37d59ec7f116f3535f1b74bde-Paper-Conference.pdf)

### Eval-driven development

21. Xia, L. et al. (2024). "Evaluation-Driven Development and Operations of LLM Agents: A Process Model and Reference Architecture." CSIRO Data61. [arXiv:2411.13768](https://arxiv.org/abs/2411.13768)
22. Braintrust (2025). "What is Eval-Driven Development." [Article](https://www.braintrust.dev/articles/eval-driven-development)
23. Vercel (2025). "Eval-Driven Development: Build Better AI Faster." [Blog](https://vercel.com/blog/eval-driven-development-build-better-ai-faster)
24. Fireworks AI (2025). "LLM Eval Driven Development with Claude Code." [Blog](https://fireworks.ai/blog/eval-driven-development-with-claude-code)
25. Newell, G. evaldriven.org. [Manifesto](https://evaldriven.org/). [awesome-eval-driven-development](https://github.com/itsderek23/awesome-eval-driven-development)

### Practical evaluation methodology

26. Husain, H. (2024). "Your AI Product Needs Evals." [Blog](https://hamel.dev/blog/posts/evals/)
27. Husain, H. (2024). "Using LLM-as-a-Judge For Evaluation: A Complete Guide." [Blog](https://hamel.dev/blog/posts/llm-judge/)
28. Husain, H. (2025). "A Field Guide to Rapidly Improving AI Products." O'Reilly Radar. [Blog](https://hamel.dev/blog/posts/field-guide/)
29. Husain, H. & Shankar, S. "AI Evals For Engineers & PMs." Maven course. [Course](https://maven.com/parlance-labs/evals)
30. Shankar, S. et al. (2024). "Who Validates the Validators? Aligning LLM-Assisted Evaluation of LLM Outputs with Human Preferences." UIST 2024. [ACM](https://dl.acm.org/doi/10.1145/3654777.3676450). [arXiv:2404.12272](https://arxiv.org/abs/2404.12272)
31. Yan, E. (2024). "An LLM-as-Judge Won't Save the Product — Fixing Your Process Will." [Blog](https://eugeneyan.com/writing/eval-process/)
32. Shankar, S. et al. (2025). "DocETL: Agentic Query Rewriting and Evaluation for Complex Document Processing." VLDB 2025. [arXiv:2410.12189](https://arxiv.org/abs/2410.12189)

### Statistical rigor in evaluation

33. Anthropic (2024). "A Statistical Approach to Model Evaluations." [Blog](https://www.anthropic.com/research/statistical-approach-to-model-evals). [arXiv:2411.00640](https://arxiv.org/abs/2411.00640)
34. Anthropic (2025). "Demystifying Evals for AI Agents." [Engineering Blog](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
35. Anthropic (2025). "Bloom: An Open Source Tool for Automated Behavioral Evaluations." [Blog](https://alignment.anthropic.com/2025/bloom-auto-evals/)
36. Chen, L. et al. (2023). "(Why) Is My Prompt Getting Worse? Rethinking Regression Testing for Evolving LLM APIs." [arXiv:2311.11123](https://arxiv.org/abs/2311.11123)

### Prompt regression testing in practice

37. Traceloop (2025). "Automated Prompt Regression Testing with LLM-as-a-Judge and CI/CD." [Blog](https://www.traceloop.com/blog/automated-prompt-regression-testing-with-llm-as-a-judge-and-ci-cd)
38. Statsig (2025). "Prompt Regression Testing." [Blog](https://www.statsig.com/perspectives/slug-prompt-regression-testing)
39. Evidently AI (2025). "LLM Regression Testing Tutorial." [Blog](https://www.evidentlyai.com/blog/llm-regression-testing-tutorial)
40. Braintrust (2025). "Best AI Evals Tools for CI/CD in 2025." [Article](https://www.braintrust.dev/articles/best-ai-evals-tools-cicd-2025)

### Evaluation tools

41. promptfoo. Open-source LLM eval CLI. [Docs](https://www.promptfoo.dev/docs/intro/). [GitHub](https://github.com/promptfoo/promptfoo). [CI/CD Integration](https://www.promptfoo.dev/docs/integrations/ci-cd/)
42. Braintrust. Eval platform with CI/CD. [Site](https://www.braintrust.dev/)
43. DeepEval. Pytest-like LLM testing with G-Eval. [Site](https://deepeval.com/). [GitHub](https://github.com/confident-ai/deepeval)
44. Langfuse. Open-source LLM observability. [Site](https://langfuse.com/)
45. Arize Phoenix. Open-source AI observability. [Site](https://phoenix.arize.com/). [GitHub](https://github.com/Arize-ai/phoenix)
46. OpenAI Evals API. [Docs](https://platform.openai.com/docs/guides/evals/). [Structured Outputs Cookbook](https://cookbook.openai.com/examples/evaluation/use-cases/structured_outputs_evaluation)
47. Patronus AI. Hallucination detection with Lynx model. [Site](https://patronus.ai/)
48. Bloom (Anthropic). Open-source behavioral evals. [Blog](https://alignment.anthropic.com/2025/bloom-auto-evals/)
