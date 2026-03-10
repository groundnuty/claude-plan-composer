# Methodology Improvements — Research Synthesis

> Research conducted 2026-02-28. Covers 50+ papers across LLM ensembles, prompt diversity,
> merge/synthesis methods, multi-agent orchestration, and cost optimization.

## Executive Summary

The current pipeline (parallel generation with prompt variation → structured merge) is well-grounded in research. The main improvement opportunities are:

1. **Add an evaluation phase** between generation and merge (new)
2. **Auto-generate task-specific lenses** instead of fixed generic ones
3. **Add quality gates** after merge with optional refinement loop
4. **Use model cascading** to cut costs 50-60% without quality loss
5. **Improve the merge step** with pairwise comparison, conflict classification, and minority insight preservation

The research confirms: **prompt variation > model variation > temperature variation** for producing structurally different outputs. N=3-4 variants remains the sweet spot.

---

## Architecture: Current vs. Proposed

```
CURRENT:
  Prompt → [4 parallel sessions] → [merge] → merged-plan.md

PROPOSED:
  Prompt → [auto-generate lenses] → [4 parallel sessions] → [evaluate] → [merge] → [verify] → merged-plan.md
                 (new)                                          (new)                   (new)
```

Three new phases: **lens generation**, **pre-merge evaluation**, and **post-merge verification**. Each is optional and independently valuable.

---

## 1. Generation Phase: Better Diversity

### 1.1 Auto-Generate Task-Specific Lenses (Meta-Prompting)

**Problem**: Fixed lenses (baseline, simplicity, depth, breadth) work generically but miss domain-specific perspectives. A database migration plan needs different lenses than a product strategy.

**Solution**: Before generation, ask an LLM to generate the optimal set of lenses for the specific prompt.

```
Given this planning task: [user prompt summary]
Generate 4 maximally different analytical perspectives to approach it from.
Each perspective should force genuinely different trade-offs and priorities.
Output: a name and 2-3 sentence guidance for each perspective.
```

**Research basis**: Meta-Prompting (Suzgun & Kalai, ICLR 2024, [arXiv:2401.12954](https://arxiv.org/abs/2401.12954)) — a conductor LLM that decomposes tasks and generates specialized expert prompts outperformed comparison methods by 15-17%. The key insight: the LLM knows what dimensions matter for a given task better than a fixed lens set.

**Implementation**: Add a `--auto-lenses` flag to `generate-plans.sh`. Run a cheap Haiku call to generate variant guidance, then use those as the variant prompts. Falls back to config.yaml variants if disabled.

**Cost**: One Haiku call (~$0.05). Negligible.

**Variant**: EvoPrompt (ICLR 2024, [arXiv:2309.08532](https://arxiv.org/abs/2309.08532)) — evolve a population of lenses across multiple runs using evolutionary algorithms. Higher effort, useful for teams that run the pipeline repeatedly on similar domains.

---

### 1.2 Role/Persona-Based Lenses

**Problem**: Current lenses shift "how to think" (simplicity vs. depth) but not "who is thinking." Research shows these are orthogonal diversity dimensions.

**Solution**: Combine analytical lenses with expert personas.

```yaml
# Example: domain-adaptive persona variants
variants:
  architect:
    guidance: "You are a senior systems architect. Prioritize scalability, maintainability, and clean interfaces."
  pragmatist:
    guidance: "You are a staff engineer who ships. Prioritize the shortest path to production."
  skeptic:
    guidance: "You are a security-minded tech lead. Question every assumption, find failure modes."
  visionary:
    guidance: "You are a research engineer. Explore unconventional approaches and emerging patterns."
```

**Research basis**: "Diversity of Thought Elicits Stronger Reasoning Capabilities in Multi-Agent Debate" (Hegazy, 2024, [arXiv:2410.12853](https://arxiv.org/abs/2410.12853)) — diverse personas outperformed GPT-4 on GSM-8K (91% vs 82%). "Two Tales of Persona in LLMs" (EMNLP 2024) confirms personas shift framing and priority ordering, not just surface text.

**Implementation**: Config change only. Provide example persona variants in config.yaml alongside the existing analytical variants.

---

### 1.3 Constraint-Based Variation

**Problem**: All variants operate in the same solution space. Different constraints force genuinely different architectures.

**Solution**: Give variants different operating constraints.

```yaml
variants:
  fast-and-cheap:
    guidance: "Assume a 2-week deadline and $5K budget. What's the minimal viable approach?"
  unlimited-time:
    guidance: "Assume unlimited time but a team of 1. What's the most thorough approach?"
  scale-first:
    guidance: "Assume this needs to serve 10x current load within 6 months."
```

**Research basis**: "Effects of Diversity Incentives on Sample Diversity" (Cegin et al., ACL 2024, [aclanthology.org/2024.acl-long.710](https://aclanthology.org/2024.acl-long.710/)) — constraint-based incentives (taboo words, boundary conditions) produced the most structurally diverse outputs.

**Implementation**: Config change only. Document as an alternative lens strategy alongside analytical and persona-based.

---

### 1.4 Adversarial/Contrarian Lens

**Problem**: All lenses are constructive — they build a plan. None actively challenges assumptions.

**Solution**: Add a "devil's advocate" lens that must argue against the obvious approach.

```yaml
contrarian:
  guidance: |
    Before writing your plan, identify the most obvious/conventional approach
    to this task. Then deliberately propose an alternative that avoids the
    conventional approach's weaknesses. Your plan MUST differ structurally
    from the naive solution.
```

**Research basis**: MAD framework (Liang et al., EMNLP 2024) addresses "Degeneration-of-Thought" — once an LLM commits to an approach, simple reflection can't generate alternatives. Adversarial framing forces exploration of non-obvious solutions.

---

### 1.5 Sequential Diversity Conditioning (G2-Inspired)

**Problem**: Parallel sessions can't see each other's outputs, so they may converge on similar plans despite different lenses.

**Solution**: Make generation partially sequential. After the first variant finishes, pass its skeleton to remaining variants with "your plan must differ structurally from this."

**Research basis**: G2 (EMNLP 2025, [aclanthology.org/2025.emnlp-main.713](https://aclanthology.org/2025.emnlp-main.713/)) — a Center Selection Strategy selects representative prior generations to condition future ones away from. Directly addresses mode collapse in parallel generation.

**Trade-off**: Breaks full parallelism. Could be implemented as a hybrid: generate 2 in parallel → extract skeletons → generate remaining 2 conditioned on first pair. Adds ~5 min latency.

**Implementation**: Medium effort. New flag `--sequential-diversity` in `generate-plans.sh`.

---

## 2. Evaluation Phase (NEW)

### 2.1 Pre-Merge Scoring

**Problem**: All N plans enter the merge with equal weight, even if one is clearly weaker or if all miss a dimension.

**Solution**: Add `evaluate-plans.sh` — a quick analysis step between generation and merge.

```bash
# evaluate-plans.sh <plans-directory>
# Uses Haiku (~$0.10) to:
# 1. Extract a coverage matrix: which dimensions each plan addresses
# 2. Score each plan per dimension (binary: covers/doesn't cover)
# 3. Identify dimensions NO plan covers (gaps)
# 4. Compute pairwise similarity (are plans diverse enough?)
# Output: $RUN_DIR/evaluation.json
```

**Research basis**: LLM-as-Judge surveys ([arXiv:2411.15594](https://arxiv.org/abs/2411.15594), [arXiv:2412.05579](https://arxiv.org/abs/2412.05579)) — binary scoring (covers/doesn't) is more reliable than Likert scales. Enterprise LLM evaluation research (Maharaj et al., AI Magazine, 2025) confirms binary classification over Likert-style scales.

**Usage**:
- Feed coverage matrix into merge prompt → merge agent knows which plan is strongest where
- If gaps found → trigger one targeted re-generation variant (Section 2.2)
- If plans too similar (>80% overlap) → warn user that prompt variation may be insufficient

---

### 2.2 Gap-Aware Re-Generation

**Problem**: If all N variants miss a dimension (e.g., none discusses rollback strategy), the merge can't fix what's not there.

**Solution**: After evaluation identifies gaps, generate one additional targeted variant.

```bash
# In evaluate-plans.sh or as a flag:
if [ ${#gaps[@]} -gt 0 ]; then
    echo "Gaps found: ${gaps[*]}"
    echo "Generating targeted variant to fill gaps..."
    gap_guidance="Focus specifically on: ${gaps[*]}.
      The existing plans are weak in these areas."
    # Run one additional claude -p session with gap-specific prompt
fi
```

**Research basis**: Multi-agent feedback loops (RGD framework, RefAgent) show that targeted repair prompts significantly improve coverage. The key: re-generation is focused on specific gaps, not a general "try again."

**Cost**: One additional session only when gaps are detected. Most runs won't trigger it.

---

### 2.3 Convergence Check

**Problem**: No way to know if variants are diverse enough or too divergent before merging.

**Solution**: Cheap convergence detection (bash-level, no LLM needed).

```bash
# Extract section headings from each plan
# Compute pairwise Jaccard similarity on headings
# Alert thresholds:
#   >80% overlap: plans too similar, need more diverse lenses
#   <30% overlap: plans may address different problems, merge will be hard
```

**Cost**: Zero (pure bash text processing).

---

## 3. Merge Phase Improvements

### 3.1 Pairwise Tournament Per Dimension

**Problem**: Asking an LLM to identify "the winner per dimension" across all N plans simultaneously suffers from position bias and cognitive overload.

**Solution**: Compare plans 2 at a time per dimension, then tally results.

```yaml
# New merge-config.yaml field
comparison_method: pairwise  # options: holistic (current default), pairwise
```

For N=4 plans and D=6 dimensions: C(4,2) × 6 = 36 focused pairwise comparisons. Each is a simple, reliable judgment. Results feed into synthesis as a structured bracket.

**Research basis**: AHP-Powered LLM Reasoning (Lu et al., EMNLP 2024 Findings, [arXiv:2410.01246](https://arxiv.org/abs/2410.01246)) — pairwise comparison under each criterion, then AHP synthesis, outperformed 4 baselines including direct LLM scoring.

---

### 3.2 Conflict Classification

**Problem**: The merge treats all disagreements the same — it picks a winner. But disagreements have different natures.

**Solution**: Before synthesis, classify each disagreement.

```
For each dimension where plans disagree, classify:

1. GENUINE TRADE-OFF: Legitimate alternatives with different strengths.
   → Present both options with trade-off analysis.

2. COMPLEMENTARY: Plans address different aspects that can coexist.
   → Merge both contributions.

3. ARBITRARY DIVERGENCE: No substantive reason for the difference.
   → Pick the more specific/actionable version.
```

**Implementation**: Add to the merge prompt template. Low effort.

---

### 3.3 Preserve Minority Insights

**Problem**: Standard merge gravitates toward consensus, dropping unique points raised by only one variant.

**Solution**: Instruct the merge to explicitly capture minority insights.

```
After synthesizing the majority view, scan each source plan for insights
that appear in ONLY that plan. For each such insight:
- If it's genuinely valuable, include it in the merged plan with a note
  "[Single source: variant-name]"
- If it's not valuable, explain why it was excluded
```

**Research basis**: FREE-MAD (2025, [arXiv:2509.11035](https://arxiv.org/abs/2509.11035)) and Consensus-Diversity Tradeoff research (EMNLP 2025) — teams with moderate diversity outperform both homogeneous and maximally diverse teams. Preserving minority viewpoints is key.

**Implementation**: Add to merge prompt template. Zero effort.

---

### 3.4 Split Analysis from Synthesis

**Problem**: The simple merge asks the LLM to compare AND synthesize in one pass, increasing cognitive load.

**Solution**: Two-phase merge.

```
Phase 1 (Analysis): Produce a JSON comparison matrix
  (plan × dimension → score + evidence + key quotes)

Phase 2 (Synthesis): Take the matrix as input, produce the merged plan.
```

Creates an auditable intermediate artifact (`comparison-matrix.json`).

---

### 3.5 Weighted Dimensions

**Problem**: All dimensions are treated equally. "Actionability" may matter more than "risk assessment" for a quick prototype plan.

**Solution**: Optional weights in merge-config.yaml.

```yaml
dimensions:
  - name: "Approach and strategy"
    weight: 0.25
  - name: "Actionability and next steps"
    weight: 0.25
  - name: "Technical depth"
    weight: 0.20
  - name: "Risk assessment"
    weight: 0.15
  - name: "Architecture"
    weight: 0.10
  - name: "Scope"
    weight: 0.05
```

**Implementation**: Backward compatible. If weights are absent, treat all as equal.

---

## 4. Post-Merge Verification (NEW)

### 4.1 Quality Gates

**Problem**: No automated check that the merged plan is internally consistent, complete, or actionable.

**Solution**: Three-gate verification after merge.

```
Gate 1: CONSISTENCY — Does any section contradict another?
Gate 2: COMPLETENESS — Was significant content from source plans lost?
Gate 3: ACTIONABILITY — Can someone execute each section without guessing?
```

**Research basis**: Huang et al. (ICLR 2024, [arXiv:2310.01798](https://arxiv.org/abs/2310.01798)) — "Large Language Models Cannot Self-Correct Reasoning Yet." Intrinsic self-correction doesn't work. But correction with **external feedback** (source plans for completeness, structured checklists for consistency) does work. The key: refinement rounds must inject new information.

**Implementation**: New `--verify` flag on `merge-plans.sh`, or standalone `verify-plan.sh` script. Run with Haiku for cost efficiency.

**Output**: `$RUN_DIR/merge-quality-report.md`

---

### 4.2 Refinement Round (Driven by Quality Gate Failures)

**Problem**: If quality gates fail, currently there's no automated fix.

**Solution**: When gates fail, run one refinement round with specific failures as the critique.

```
merge → quality gates → [FAIL] → refine(with failures) → quality gates → [PASS]
```

**Research basis**: Self-Refine (Madaan et al., NeurIPS 2023, [arXiv:2303.17651](https://arxiv.org/abs/2303.17651)) — the largest gains come in rounds 1-2, with ~3 iterations as the practical sweet spot. CRITIC (Gou et al., ICLR 2024, [arXiv:2305.11738](https://arxiv.org/abs/2305.11738)) — tool-interactive critiquing (external feedback) yields 5-8% improvements.

**Implementation**: Add `REFINE_ROUNDS` env var (default: 0 or 1). Cap at 2 rounds.

---

### 4.3 Pre-Mortem Analysis

**Problem**: Plans are evaluated for what they include, not for what could go wrong.

**Solution**: After merge, run a pre-mortem pass.

```
Imagine it is 6 months from now. The team followed this plan exactly,
and it FAILED. Generate 5 specific, plausible failure scenarios.
For each: what went wrong? Which section was responsible?
What should be added to prevent this?
```

**Research basis**: Pre-mortem technique (Klein, 1998) — prospective hindsight consistently surfaces risks that conventional analysis misses. Devil's Advocate (Wang et al., EMNLP 2024 Findings, [arXiv:2405.16334](https://arxiv.org/abs/2405.16334)) — anticipatory reflection improved task success by 3.5% while reducing trials by 45%.

**Implementation**: Add to merge-config.yaml as an option. Append pre-mortem results to the merged plan as a "Risks and Failure Modes" section.

---

### 4.4 Constitutional Principles

**Problem**: Quality is subjective — what makes a "good" merged plan?

**Solution**: Configurable principles in merge-config.yaml that the merge must satisfy.

```yaml
constitution:
  - "Every trade-off must be explicitly acknowledged with pros and cons"
  - "No section should be purely aspirational — each needs a concrete next step"
  - "Risks from any source plan must appear in the merged plan"
  - "The plan must be self-consistent — no section contradicts another"
```

After the initial merge, run a constitutional review:

```
For each principle: does the merged plan satisfy it? (YES/NO)
If NO: cite the violation and suggest a fix.
Then revise.
```

**Research basis**: Constitutional AI (Bai et al., 2022, [arXiv:2212.08073](https://arxiv.org/abs/2212.08073)) — principle-driven self-critique and revision. Works best when principles are specific and testable.

**Implementation**: Low effort. New config field + addition to merge prompt.

---

## 5. Cost Optimization

### 5.1 Model Cascading

**Problem**: 4 Opus sessions + 1 Opus merge = ~$60-75 per run.

**Solution**: Use cheaper models for generation, reserve Opus for merge.

```yaml
# Recommended cost-optimized config:
variants:
  architect:
    model: sonnet    # ~$3/session
    guidance: "..."
  pragmatist:
    model: sonnet
    guidance: "..."
  skeptic:
    model: sonnet
    guidance: "..."
  visionary:
    model: opus      # ~$15/session — one Opus for highest creativity
    guidance: "..."
# Merge: MODEL=opus (default)
```

**Estimated costs**:
- 3 Sonnet + 1 Opus generation + 1 Opus merge = ~$9 + $15 + $15 = ~$39
- vs. 4 Opus + 1 Opus = ~$75
- **~48% savings**

**Research basis**: Cascade routing (arXiv:2410.10347) — 60-70% of queries can be handled by cheaper models without quality loss. Self-MoA (arXiv:2502.00674) — multiple runs of the single best model outperforms mixing weaker models. So use the best model (Opus) for the merge where quality matters most.

**Implementation**: Already supported. Document as a recommended cost-saving config.

---

### 5.2 Adaptive Variant Count

**Problem**: Always generating 4 variants wastes resources when plans converge after 2-3.

**Solution**: Start with 2-3 variants, check convergence, generate more only if needed.

**Research basis**: Reasoning-Aware Self-Consistency (RASC, [arXiv:2408.17017](https://arxiv.org/abs/2408.17017)) — dynamically determines how many samples are needed based on agreement. Consistent with the finding that N=3-4 captures ~80% of gains.

**Trade-off**: Partially serializes the pipeline. May not be worth the complexity for a CLI tool.

---

### 5.3 Batch API for Non-Urgent Runs

Anthropic's Batch API offers **50% cost reduction** with results within 24 hours. Suitable for batch processing multiple prompts overnight.

**Trade-off**: Loses Claude Code's tool use, MCP, and file access. Only viable for prompts that don't need codebase access (non-technical plans, strategy documents).

---

## 6. Debate/Merge Frameworks from Research

### 6.1 Mixture-of-Agents (MoA) — Layered Architecture

**What**: Each "layer" of LLM agents receives ALL outputs from the previous layer as context. Exploits "collaborativeness" — LLMs generate better responses when presented with outputs from other models.

**How it maps**: The current pipeline is a 2-layer MoA (generate → merge). Research suggests 3 layers is the sweet spot: generate → refine-with-cross-context → synthesize.

**Reference**: Wang et al., 2024, ICLR 2025 ([arXiv:2406.04692](https://arxiv.org/abs/2406.04692)) — achieved 65.1% on AlpacaEval 2.0 vs. GPT-4o's 57.5%.

---

### 6.2 Iterative Consensus Ensemble (ICE)

**What**: Multiple LLMs iteratively critique each other's outputs and converge over multiple rounds. Each model sees all others' current answers plus explanations.

**Results**: Up to 27% improvement over single-model, 7-15% over best single model. Convergence in 3-5 rounds.

**How it maps**: Instead of single-round merge, have each variant's "agent" see all other plans and refine its own before final merge. The agent-teams mode already approximates this — but with a single debate round.

**Reference**: ICE, 2025, Computers in Biology and Medicine, 196.

---

### 6.3 Adversarial Debate (Safety via Debate)

**What**: Two AI agents engage in a zero-sum debate. The truthful debater theoretically always wins.

**How it maps**: After merge, assign a "Red Team" agent to attack the plan and a "Defense" agent to revise. Surfaces weaknesses that cooperative merging misses.

**Reference**: Irving et al., 2018 ([arXiv:1805.00899](https://arxiv.org/abs/1805.00899)); Kenton et al., NeurIPS 2024 ([arXiv:2407.04622](https://arxiv.org/abs/2407.04622))

---

### 6.4 Specialized Debate Roles (A-HMAD)

**What**: Agents have specialized roles (Verifier, Solver, etc.) with a dynamic routing strategy and confidence-weighted consensus.

**How it maps**: Replace generic variant names with task-specific critic roles. Skip irrelevant roles dynamically.

**Reference**: A-HMAD, 2025, Journal of King Saud University.

---

## 7. What Doesn't Work

### 7.1 Temperature Variation Alone
Produces lexical diversity but minimal structural diversity. Research confirms: prompt variation >> temperature variation for plan-level differences. (Liu et al., 2025; Paleyes & Sendyka, 2025)

### 7.2 Same-Prompt Repetition
Correlated errors (arXiv:2506.07962): models agree on 60% of their errors. After 3-4 runs of the same prompt, structural diversity is exhausted (PNAS structural diversity study).

### 7.3 Intrinsic Self-Correction
"Large Language Models Cannot Self-Correct Reasoning Yet" (Huang et al., ICLR 2024). Self-correction without external feedback doesn't improve and can degrade quality. All refinement must inject new information (source plans, checklists, tool results).

### 7.4 Token-Level Probability Fusion (DeePEn)
Requires access to logprobs and model weights. Not API-compatible. Irrelevant for a CLI-based tool.

### 7.5 Activation-Level Steering (STARS)
Highest structural diversity, but requires model internals access. Not available via API.

---

## 8. Prioritized Implementation Roadmap

### Tier 1: Quick Wins (config/prompt changes, <1 hour each)

| # | Improvement | Effort | Impact | Change |
|---|-------------|--------|--------|--------|
| 1 | Persona-based variant examples in config.yaml | Config | High | Document alternative lens strategies |
| 2 | Conflict classification in merge prompt | Prompt | Medium | Add to merge prompt template |
| 3 | Minority insight preservation in merge prompt | Prompt | Medium | Add to merge prompt template |
| 4 | Constitutional principles in merge-config.yaml | Config | Medium | New config field, append to prompt |
| 5 | Model cascade documentation | Docs | High | Document cost-saving config patterns |

### Tier 2: New Scripts (~50-150 lines each)

| # | Improvement | Effort | Impact | Deliverable |
|---|-------------|--------|--------|-------------|
| 6 | Pre-merge evaluation | New script | High | `evaluate-plans.sh` |
| 7 | Post-merge quality gates | New script | High | `verify-plan.sh` or `--verify` flag |
| 8 | Auto-generated lenses | Flag | High | `--auto-lenses` in generate-plans.sh |
| 9 | Pre-mortem pass | Flag | Medium | `--pre-mortem` in merge-plans.sh |
| 10 | Convergence check | Addition | Medium | Heading similarity check in generate-plans.sh |

### Tier 3: Architectural Changes

| # | Improvement | Effort | Impact | Change |
|---|-------------|--------|--------|--------|
| 11 | Pairwise tournament merge | Refactor | High | New comparison_method in merge-config |
| 12 | Split analysis/synthesis merge | Refactor | Medium | Two-phase merge with intermediate JSON |
| 13 | Sequential diversity conditioning | New mode | High | `--sequential-diversity` flag |
| 14 | Refinement loop | Addition | Medium | `REFINE_ROUNDS` env var |
| 15 | Gap-aware re-generation | Addition | Medium | After evaluation, targeted re-gen |

### Tier 4: Major Effort, Highest Potential

| # | Improvement | Effort | Impact | Change |
|---|-------------|--------|--------|--------|
| 16 | Evolutionary lens optimization | Framework | High | Evolve lenses across runs |
| 17 | A/B testing harness | Framework | High | Merged plan vs. single-session comparison |
| 18 | API-direct generation (prompt caching) | Major refactor | Medium | Replace claude -p with API calls |

---

## Key Research References

### LLM Ensembles
- Chen et al. (2025). "Harnessing Multiple LLMs: A Survey on LLM Ensemble." [arXiv:2502.18036](https://arxiv.org/abs/2502.18036)
- Wang et al. (2024). "Mixture-of-Agents Enhances LLM Capabilities." [arXiv:2406.04692](https://arxiv.org/abs/2406.04692) (ICLR 2025)
- Li et al. (2025). "Self-MoA: Rethinking Mixture-of-Agents." [arXiv:2502.00674](https://arxiv.org/abs/2502.00674)
- Tekin et al. (2024). "LLM-TOPLA: Efficient Ensemble by Maximising Diversity." EMNLP 2024 Findings.
- ICE (2025). "Iterative Consensus Ensemble." Computers in Biology and Medicine, 196.

### Prompt Diversity
- Hegazy (2024). "Diversity of Thought Elicits Stronger Reasoning." [arXiv:2410.12853](https://arxiv.org/abs/2410.12853)
- Cegin et al. (2024). "Effects of Diversity Incentives on Sample Diversity." ACL 2024.
- G2 (EMNLP 2025). "Guided Generation for Enhanced Output Diversity." [aclanthology.org/2025.emnlp-main.713](https://aclanthology.org/2025.emnlp-main.713/)
- EMNLP 2024. "Two Tales of Persona in LLMs." [aclanthology.org/2024.findings-emnlp.969](https://aclanthology.org/2024.findings-emnlp.969/)

### Automatic Prompt Generation
- Suzgun & Kalai (2024). "Meta-Prompting." ICLR 2024. [arXiv:2401.12954](https://arxiv.org/abs/2401.12954)
- EvoPrompt (ICLR 2024). [arXiv:2309.08532](https://arxiv.org/abs/2309.08532)
- Zhou et al. (2023). "APE: Large Language Models Are Human-Level Prompt Engineers." ICLR 2023.
- PromptBreeder (2023). "Self-Referential Self-Improvement." [arXiv:2309.16797](https://arxiv.org/abs/2309.16797)

### Merge & Refinement
- Madaan et al. (2023). "Self-Refine." NeurIPS 2023. [arXiv:2303.17651](https://arxiv.org/abs/2303.17651)
- Huang et al. (2024). "LLMs Cannot Self-Correct Reasoning Yet." ICLR 2024. [arXiv:2310.01798](https://arxiv.org/abs/2310.01798)
- Gou et al. (2024). "CRITIC: Tool-Interactive Critiquing." ICLR 2024. [arXiv:2305.11738](https://arxiv.org/abs/2305.11738)
- Lu et al. (2024). "AHP-Powered LLM Reasoning." EMNLP 2024 Findings. [arXiv:2410.01246](https://arxiv.org/abs/2410.01246)
- Wang (2024). "Devil's Advocate: Anticipatory Reflection." EMNLP 2024.

### Debate Frameworks
- Du et al. (2024). "Multiagent Debate." ICML 2024. [arXiv:2305.14325](https://arxiv.org/abs/2305.14325)
- Irving et al. (2018). "AI Safety via Debate." [arXiv:1805.00899](https://arxiv.org/abs/1805.00899)
- FREE-MAD (2025). "Consensus-Free Multi-Agent Debate." [arXiv:2509.11035](https://arxiv.org/abs/2509.11035)
- EMNLP 2025. "Consensus-Diversity Tradeoff in Adaptive Multi-Agent Systems."

### Evaluation
- Li et al. (2024). "A Survey on LLM-as-a-Judge." [arXiv:2411.15594](https://arxiv.org/abs/2411.15594)
- Maharaj et al. (2025). "Evaluation in an Enterprise AI Assistant." AI Magazine, 46(3).
- LLM-Rubric (Microsoft, ACL 2024). [arXiv:2501.00274](https://arxiv.org/abs/2501.00274)

### Diversity & Correlated Errors
- Kim et al. (2025). "Correlated Errors in Large Language Models." [arXiv:2506.07962](https://arxiv.org/abs/2506.07962)
- PNAS (2025). "Structural Diversity in LLM Outputs." [doi:10.1073/pnas.2504966122](https://www.pnas.org/doi/10.1073/pnas.2504966122)
- STARS (ICLR 2026). "Activation Steering for Diverse Generation." [arXiv:2601.22010](https://arxiv.org/abs/2601.22010)

### Multi-Agent Practice
- Anthropic (2025). "Building a C Compiler with Parallel Claudes." [anthropic.com](https://www.anthropic.com/engineering/building-c-compiler)
- incident.io (2025). "Shipping Faster with Claude Code and Git Worktrees." [incident.io](https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees)
- Schoenegger et al. (2024). "Wisdom of the Silicon Crowd." Science Advances.

### Cost Optimization
- Cascade routing (2024). [arXiv:2410.10347](https://arxiv.org/abs/2410.10347)
- Anthropic prompt caching docs. [platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
