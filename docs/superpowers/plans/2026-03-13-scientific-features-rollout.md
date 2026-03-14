# Scientific Features Rollout Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 13 research-driven features from the ASE 2026 RT paper spec, with regression testing gating every merge to main.

**Architecture:** Each feature goes through a full cycle: spec → plan → review → implement → eval gate → merge. Features are ordered by dependency and regression risk. The eval harness must have grounded metrics before any behavioral changes (measure first, change second).

**Tech Stack:** TypeScript, Claude Agent SDK, Vitest eval harness, word-level Jaccard + Shannon entropy + dimension coverage metamorphic tests.

**Source spec:** `/Users/orzech/Dropbox/home/repos/papers/claude-plan-composer-paper/research/feature-implementation-scientific-plan.md`

---

## Pipeline Impact Map

| Pipeline stage | Features | Regression risk |
|---|---|---|
| **Generate** | I1 (grounded lenses), I4 (dynamic selection), I5 (self-reflection), I13 (iterative amplification) | Medium — changes what plans contain |
| **Evaluate** | I2 (diversity thermostat), I6 (quality weighting) | Low — mostly additive measurement |
| **Merge** | I9 (formalization), I11 (two-stage), I15 (per-type strategies), I7 (atomic decomposition), I14 (tournament) | **High** — restructures core merge logic |
| **Verify** | I12 (content retention gate) | Low — adds a new gate, doesn't change existing ones |

## Eval Harness Coverage

**Diversity test** (`test/eval/diversity.test.ts`) guards: I1, I4, I5, I13
**Coverage test** (`test/eval/coverage.test.ts`) guards: I11, I15, I7, I14

## Per-Feature Lifecycle (MANDATORY)

Every feature follows this cycle. Each step is a checkpoint — do not skip any.

```
1. Write spec       — brainstorm, design doc, spec review
2. Write plan       — detailed implementation plan, plan review
3. Save baseline    — make -f dev.mk eval-save NAME=pre-I<N>
4. Create branch    — git checkout -b feat/I<N>-<name>
5. Implement (TDD)  — tests first, then code
6. Static gate      — make -f dev.mk check
7. Eval gate        — make -f dev.mk eval-compare NAME=pre-I<N>
8. Merge to main    — only after steps 6 + 7 pass
9. Post-baseline    — make -f dev.mk eval-save NAME=post-I<N>
```

---

## Feature 0: Eval Harness Grounded Metrics

**Branch:** `feat/eval-grounded-metrics`
**Risk:** None — adds metrics to eval harness, no pipeline behavior change
**Principle:** Measure first, change second. Shannon entropy and retention scoring must be in place before any behavioral changes to lenses or merge logic.

**What it delivers:**
- Shannon entropy metric (n-gram based, from MIMIC paper) in diversity test
- Content retention metric in coverage test
- Both stored in baselines for before/after comparison

**Files:**
- Modify: `test/eval/helpers/metrics.ts` — add `computeShannonEntropy(texts, ngramSizes)`
- Modify: `test/eval/helpers/metrics.test.ts` — Shannon entropy unit tests
- Modify: `test/eval/diversity.test.ts` — log entropy alongside Jaccard
- Create: `test/eval/helpers/retention.ts` — `computeRetentionScore(sourcePlans, mergedPlan)`
- Create: `test/eval/helpers/retention.test.ts` — retention unit tests
- Modify: `test/eval/coverage.test.ts` — log retention score, store in baseline

**Steps:**
- [ ] Write spec and plan (lightweight — this is tooling, not a scientific feature)
- [ ] Create branch: `git checkout -b feat/eval-grounded-metrics`
- [ ] TDD: Shannon entropy (unit tests → implement → wire into diversity test)
- [ ] TDD: Retention score (unit tests → implement → wire into coverage test)
- [ ] `make -f dev.mk check`
- [ ] Merge to main
- [ ] Save initial baseline with grounded metrics: `make -f dev.mk eval-save NAME=baseline-with-grounded-metrics`

---

## Feature 1: I9 — Formalized Merge Operations

**Branch:** `feat/I9-formalized-merge-ops`
**Risk:** Low — types/interfaces only, no behavioral change
**Eval guard:** Diversity + coverage (should be unchanged)
**Depends on:** nothing
**Scientific basis:** EditFusion (Wang et al., ASE 2025 RT) §3 Definitions 1-4; BSM (Saha et al., NAACL 2024) §2

**What it delivers:**
- TypeScript types mirroring formal Definitions 1-6: `Recommendation`, `QualityDimension`, `Disagreement`, `TypedResolution`
- Foundation types consumed by I11, I15, I7

**Steps:**
- [ ] Write spec (formal definitions → TypeScript type mapping)
- [ ] Write plan (files, types, tests)
- [ ] Review spec + plan
- [ ] Save baseline: `make -f dev.mk eval-save NAME=pre-I9`
- [ ] Create branch: `git checkout -b feat/I9-formalized-merge-ops`
- [ ] Implement with TDD
- [ ] `make -f dev.mk check` + `make -f dev.mk eval-compare NAME=pre-I9`
- [ ] Merge to main, save post-baseline

---

## Feature 2: I2 — Diversity Thermostat

**Branch:** `feat/I2-diversity-thermostat`
**Risk:** Low — measurement only, no behavior change (warning is informational)
**Eval guard:** Should be neutral (adds metrics, doesn't change output)
**Depends on:** Feature 0 (Shannon entropy in eval harness)
**Why before I1:** Wires Shannon entropy into the pipeline as runtime measurement. When I1 changes lenses, this is already reporting the effect.
**Scientific basis:** MIMIC (Chen et al., ASE 2025 RT) §4.3 Shannon Entropy; Song et al. (ASE 2025 NIER) Structural Entropy

**What it delivers:**
- `measureDiversity(plans)` returning Jaccard distance + Shannon entropy (2 local/cheap metrics)
- Configurable threshold with low-diversity warning
- Diversity scores stored in run output as pipeline artifacts
- **Scope note:** Remaining 2 metrics from source spec (embedding cosine distance, decision-space coverage) deferred to I4 where those capabilities are needed for dynamic lens selection

**Steps:**
- [ ] Write spec (which metrics, threshold logic, warning behavior)
- [ ] Write plan (files, functions, config schema changes)
- [ ] Review spec + plan
- [ ] Save baseline: `make -f dev.mk eval-save NAME=pre-I2`
- [ ] Create branch: `git checkout -b feat/I2-diversity-thermostat`
- [ ] Implement with TDD
- [ ] `make -f dev.mk check` + `make -f dev.mk eval-compare NAME=pre-I2`
- [ ] Merge to main, save post-baseline

---

## Feature 3: I1 — Empirically Grounded Lens Design

**Branch:** `feat/I1-grounded-lenses`
**Risk:** Medium — changes lens content, which affects plan diversity
**Eval guard:** Diversity test (Jaccard + Shannon entropy both in place), coverage test
**Depends on:** Feature 0 (grounded metrics), Feature 2 (I2 — diversity measurement wired in)
**Why this order:** First feature that changes actual pipeline behavior. By now, eval harness has Shannon entropy AND the pipeline reports diversity metrics — richest possible before/after comparison.
**Scientific basis:** ISO/IEC 25010:2023; ATAM (Kazman et al., 2000); MIMIC §3.1 PathOS grounding

**What it delivers:**
- Lens library with 8 ISO 25010 lenses + 2-4 supplementary lenses
- Each lens: name, ISO mapping, system prompt suffix, default weight
- Existing 4 case study lenses mapped to ISO equivalents

**Steps:**
- [ ] Write spec (lens definitions, ISO mappings, prompt suffixes)
- [ ] Write plan (files, tests, eval config updates)
- [ ] Review spec + plan
- [ ] Save baseline: `make -f dev.mk eval-save NAME=pre-I1` (includes Shannon entropy + Jaccard)
- [ ] Create branch: `git checkout -b feat/I1-grounded-lenses`
- [ ] Implement with TDD
- [ ] `make -f dev.mk check` + `make -f dev.mk eval-compare NAME=pre-I1` — diversity must not regress on either metric
- [ ] Merge to main, save post-baseline

---

## Feature 4: I11 — Analysis-Then-Judgment Merge (Two-Stage)

**Branch:** `feat/I11-two-stage-merge`
**Risk:** HIGH — restructures the core merge pipeline
**Eval guard:** Coverage test is critical (dimensions must still be covered)
**Depends on:** Feature 1 (I9 — formal types)
**Scientific basis:** iCodeReviewer (Peng et al., ASE 2025) §3.2 analysis/determination separation

**What it delivers:**
- Split single-pass merge into: analysis prompt → structured comparison table → judgment prompt
- Intermediate comparison tables stored as auditable artifacts
- Ablation toggle: `merge_stages: 1 | 2`

**Steps:**
- [ ] Write spec (two-stage flow, prompt designs, comparison table format, ablation toggle)
- [ ] Write plan (files, prompt builders, integration, tests)
- [ ] Review spec + plan
- [ ] Save baseline: `make -f dev.mk eval-save NAME=pre-I11`
- [ ] Create branch: `git checkout -b feat/I11-two-stage-merge`
- [ ] Implement with TDD
- [ ] `make -f dev.mk check` + `make -f dev.mk eval-compare NAME=pre-I11` — coverage MUST pass
- [ ] Merge to main, save post-baseline

---

## Feature 5: I15 — Per-Type Merge Strategies

**Branch:** `feat/I15-per-type-merge`
**Risk:** HIGH — changes merge behavior based on disagreement classification
**Eval guard:** Coverage test (strategies must not drop content)
**Depends on:** Feature 1 (I9 — Definition 5), Feature 4 (I11 — Stage 2 classification)
**Scientific basis:** EditFusion (Wang et al., ASE 2025 RT) §4.1 per-category handling, §5.1 Table 3

**What it delivers:**
- 4 distinct prompt templates: complementary (union), trade-off (argumentative), arbitrary (selection), uncontested (adopt)
- Disagreement classification drives strategy routing
- Each resolution tagged with type + strategy
- Ablation toggle: uniform vs per-type routing

**Steps:**
- [ ] Write spec (4 strategy definitions, routing logic, output tagging)
- [ ] Write plan (files per strategy, router, tests)
- [ ] Review spec + plan
- [ ] Save baseline: `make -f dev.mk eval-save NAME=pre-I15`
- [ ] Create branch: `git checkout -b feat/I15-per-type-merge`
- [ ] Implement with TDD
- [ ] `make -f dev.mk check` + `make -f dev.mk eval-compare NAME=pre-I15`
- [ ] Merge to main, save post-baseline

---

## Feature 6: I7 — Atomic Decision Decomposition

**Branch:** `feat/I7-atomic-decomposition`
**Risk:** HIGH — changes merge granularity from dimension-level to recommendation-level
**Eval guard:** Coverage test (finer granularity must not lose content)
**Depends on:** Feature 1 (I9 — Definition 2), Feature 4 (I11 — Stage 1.5 insertion), Feature 5 (I15 — recommendation-level resolution)
**Scientific basis:** EditFusion §3.1 atomic edit decomposition; DPPM (Lu et al., arXiv 2506.02683)

**What it delivers:**
- Recommendation extraction step (Stage 1.5) between analysis and judgment
- Cross-variant matching: agreement / disagreement / unique classification
- Merge at recommendation level within each dimension
- Ablation toggle: dimension-level vs recommendation-level

**Steps:**
- [ ] Write spec (extraction format, matching algorithm, classification)
- [ ] Write plan (files, extractor, matcher, pipeline integration)
- [ ] Review spec + plan
- [ ] Save baseline: `make -f dev.mk eval-save NAME=pre-I7`
- [ ] Create branch: `git checkout -b feat/I7-atomic-decomposition`
- [ ] Implement with TDD
- [ ] `make -f dev.mk check` + `make -f dev.mk eval-compare NAME=pre-I7`
- [ ] Merge to main, save post-baseline

---

## Feature 7: I5 — Self-Reflection Step

**Branch:** `feat/I5-self-reflection`
**Risk:** Medium — changes plan content by adding self-assessment appendix
**Eval guard:** Diversity test (reflection must not homogenize plans)
**Depends on:** nothing (independent)
**Scientific basis:** SE-Jury (Zhou et al., ASE 2025 RT) §3.2 Strategy S2 "Rethink"; Self-Refine (Madaan et al., NeurIPS 2023)

**What it delivers:**
- Reflection prompt with contrasting lens after each plan generation
- Self-assessment appendix: blind spots, low-confidence areas, suggestions
- Appendix consumed by merge phase for gap awareness
- Ablation toggle: with/without reflection

**Steps:**
- [ ] Write spec (reflection prompt design, contrasting lens selection, appendix format)
- [ ] Write plan (files, prompt template, session integration)
- [ ] Review spec + plan
- [ ] Save baseline: `make -f dev.mk eval-save NAME=pre-I5`
- [ ] Create branch: `git checkout -b feat/I5-self-reflection`
- [ ] Implement with TDD
- [ ] `make -f dev.mk check` + `make -f dev.mk eval-compare NAME=pre-I5`
- [ ] Merge to main, save post-baseline

---

## Feature 8: I4 — Dynamic Lens Selection

**Branch:** `feat/I4-dynamic-lens-selection`
**Risk:** Medium — wrong lens selection could weaken diversity
**Eval guard:** Diversity test is the key guard
**Depends on:** Feature 3 (I1 — expanded lens library)
**Scientific basis:** SE-Jury §3.3 dynamic team selection

**What it delivers:**
- `selectLenses(taskDescription, lensLibrary, K)` using cheap Haiku call
- Constraints: ≥1 adversarial lens, ≥3 ISO 25010 characteristics
- Selection rationale logged for reproducibility
- Ablation toggle: fixed vs dynamic selection
- **Also adds:** Embedding cosine distance + decision-space coverage metrics to `measureDiversity()` (deferred from I2 — requires API calls suitable for lens selection context)

**Steps:**
- [ ] Write spec (selection algorithm, constraints, cost analysis)
- [ ] Write plan (files, selector function, prompt, integration)
- [ ] Review spec + plan
- [ ] Save baseline: `make -f dev.mk eval-save NAME=pre-I4`
- [ ] Create branch: `git checkout -b feat/I4-dynamic-lens-selection`
- [ ] Implement with TDD
- [ ] `make -f dev.mk check` + `make -f dev.mk eval-compare NAME=pre-I4`
- [ ] Merge to main, save post-baseline

---

## Feature 9: I12 — Verification Pass (Content Retention)

**Branch:** `feat/I12-retention-verification`
**Risk:** Low — adds a new verification gate, doesn't change existing ones
**Eval guard:** Should be neutral to existing metrics
**Depends on:** Feature 4 (I11 — comparison tables as input)
**Scientific basis:** iCodeReviewer §3.3 aggregation and re-confirmation; Huang et al. (ICLR 2024)

**What it delivers:**
- 5th quality gate: content retention verification
- Retention report: insight coverage, disagreement resolution audit, source attribution
- Retention rate + minority preservation rate metrics
- Catches the failure mode where merge claims inclusion but actually drops content

**Steps:**
- [ ] Write spec (gate design, report format, metrics definitions)
- [ ] Write plan (files, gate implementation, integration with verify pipeline)
- [ ] Review spec + plan
- [ ] Save baseline: `make -f dev.mk eval-save NAME=pre-I12`
- [ ] Create branch: `git checkout -b feat/I12-retention-verification`
- [ ] Implement with TDD
- [ ] `make -f dev.mk check` + `make -f dev.mk eval-compare NAME=pre-I12`
- [ ] Merge to main, save post-baseline

---

## Feature 10: I13 — Iterative Diversity Amplification

**Branch:** `feat/I13-diversity-amplification`
**Risk:** Medium — wraps generate phase in an adaptive loop
**Eval guard:** Diversity test (amplification must actually increase diversity)
**Depends on:** Feature 2 (I2 — diversity metrics for gap detection)
**Scientific basis:** AdaBoost (Freund & Schapire, 1997); MIMIC §4.3; DivSampling (Zheng et al., 2025)

**What it delivers:**
- Gap detection prompt analyzing existing variants
- Targeted generation for identified gaps
- Stopping criterion: entropy plateau or max N
- Ablation toggle: fixed-N vs adaptive-N

**Steps:**
- [ ] Write spec (gap detection, targeted generation, stopping criteria)
- [ ] Write plan
- [ ] Review spec + plan
- [ ] Full eval gate workflow (baseline → branch → implement → check → eval-compare → merge)

---

## Feature 11: I6 — Quality-Weighted Merging

**Branch:** `feat/I6-quality-weighted-merge`
**Risk:** Medium — changes how variants influence the merge
**Eval guard:** Coverage test
**Depends on:** nothing (independent, uses existing evaluate phase scores)
**Scientific basis:** SE-Jury §3.3 weighted team selection; ensemble learning (Dietterich, 2000)

**What it delivers:**
- Per-dimension variant ranking from evaluation scores
- Primary source designation per dimension in merge prompt
- Ablation toggle: uniform vs quality-weighted

**Steps:**
- [ ] Write spec (weighting algorithm, primary source designation, prompt changes)
- [ ] Write plan
- [ ] Review spec + plan
- [ ] Full eval gate workflow

---

## Feature 12: I14 — Hierarchical Tournament Merge

**Branch:** `feat/I14-tournament-merge`
**Risk:** High — alternative merge structure (pairwise reduction)
**Eval guard:** Coverage test + diversity test
**Depends on:** Feature 4 (I11), Feature 5 (I15), Feature 2 (I2 — for pairing)
**Scientific basis:** Scaling Test-time Compute (tree-based merging); tournament selection in evolutionary algorithms

**What it delivers:**
- `tournamentMerge(plans[], rounds)` with pairwise reduction
- Pairing by maximum diversity (embedding distance)
- Intermediate merge results stored as artifacts
- Ablation toggle: flat (N→1) vs tournament (N→2→1)

**Steps:**
- [ ] Write spec (pairing strategy, round structure, token usage analysis)
- [ ] Write plan
- [ ] Review spec + plan
- [ ] Full eval gate workflow

---

## Feature 13: I8 — Selection Ceiling Analysis

**Branch:** `feat/I8-selection-ceiling`
**Risk:** None — analysis task, no code behavioral change
**Depends on:** Feature 5 (I15 — disagreement classification logs from multiple runs)
**Scientific basis:** EditFusion §4.1 Table 2 (94.18% selection ceiling)

**What it delivers:**
- Aggregated disagreement type counts across evaluation runs
- Selection ceiling: (complementary + arbitrary + uncontested) / total
- Per-task and per-dimension breakdowns
- Comparison with EditFusion's 94.18% for the paper

**Steps:**
- [ ] Write spec (data collection requirements, statistical analysis)
- [ ] Write plan
- [ ] Review spec + plan
- [ ] Implement analysis scripts
- [ ] Run on accumulated evaluation data

---

## Dependency Graph (Implementation Order)

```
Feature 0: Eval Grounded Metrics (Shannon entropy + retention)
    │
    ▼
Feature 1: I9 Formalization (types only)
    │
    ▼
Feature 2: I2 Diversity Thermostat (wires metrics into pipeline)
    │
    ▼
Feature 3: I1 Grounded Lenses (first behavioral change — fully measured)
    │
    ├──────────────────────────────┐
    ▼                              ▼
Feature 4: I11 Two-Stage Merge    Feature 7: I5 Self-Reflection
    │                              Feature 8: I4 Dynamic Selection (needs I1)
    ▼
Feature 5: I15 Per-Type Strategies
    │
    ├──────────────────────────────┐
    ▼                              ▼
Feature 6: I7 Atomic Decomp.      Feature 9: I12 Retention Gate (needs I11)
    │
    ▼
Feature 10: I13 Amplification (needs I2)
Feature 11: I6 Quality-Weighted (independent)
Feature 12: I14 Tournament Merge (needs I11, I15, I2)
Feature 13: I8 Selection Ceiling (needs I15 + data)
```

## Success Criteria

- [ ] Every feature goes through: spec → plan → review → implement → eval gate
- [ ] All features have ablation toggles (can be enabled/disabled independently)
- [ ] Every feature-branch merge passes: `make -f dev.mk check` + `make -f dev.mk eval-compare`
- [ ] No dimension coverage regressions (coverage test passes throughout)
- [ ] No diversity regressions (diversity test delta ≥ 0.01 throughout)
- [ ] Baseline chain: pre-I9 → post-I9 → pre-I2 → post-I2 → pre-I1 → post-I1 → ... → final
- [ ] All features are ablation-testable for the ASE 2026 RT paper evaluation
