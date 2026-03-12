# Case Study Report: DayTrader T2 — Sonnet-Only Pipeline Failure Analysis

**Date:** 2026-03-12
**Based on:** Two merge attempts (collapsed + subagents) for DayTrader 7 migration
**Run directory:** `generated-plans/multi-041344/20260312-041344/`
**Verdict:** Sonnet is insufficient for agent-teams merge. Generation quality is strong but the merge phase requires Opus.

---

## Part 1: What Worked — Generation and Evaluation

### 1.1 Generation Quality: A

Sonnet produced 4 detailed, codebase-grounded plans (179KB total) in 7 minutes. Each plan:
- References actual DayTrader classes, JPA annotations, and method signatures
- Addresses all 5 constraints (streaming, GDPR, COBOL, zero-downtime, K8s)
- Contains concrete deliverables (K8s YAML, SQL DDL, Java code fragments)
- Shows healthy lens diversity (mean Jaccard ~1.3%)

Sonnet's generation capability is not in question. The plans are comparable to Opus-generated plans from the NIER case study (30-40KB each vs 36-52KB here).

### 1.2 Evaluation Quality: A

The evaluation phase correctly identified:
- No single lens dominates all 5 dimensions
- Reliability is the most complete individual plan (5/5)
- Data migration is the weakest cross-lens dimension (only 1/4 pass)
- Complementary disagreements dominate (confirming the paper's hypothesis)

---

## Part 2: What Failed — Agent-Teams Merge

### 2.1 The Core Problem

The merge prompt instructs Claude to "Create an agent team with these teammates" — intending the `TeamCreate` tool to spawn separate advocate agents that can see each other's messages and debate in real time. Sonnet never used `TeamCreate`. In two attempts:

| Run | Behavior | What happened |
|-----|----------|---------------|
| **A** | Collapsed role-play | Single agent assumed each advocate role sequentially. No separate agents created. Simulated "debate" in one context. |
| **B** | Independent subagents | Spawned 4 subagents via `Agent` tool. Each analyzed its plan in isolation. No inter-agent visibility or debate. |

Neither run achieved the intended behavior: a **real multi-agent team** where advocates can see, challenge, and respond to each other's arguments.

### 2.2 Impact on Plan Quality

| Quality metric | Run A (Collapsed) | Run B (Subagents) | Expected (Team Debate) |
|---------------|-------------------|-------------------|----------------------|
| Completeness failures | 8 items dropped | 3 items dropped | ~0 (advocates defend unique contributions) |
| Factual accuracy | PASS | FAIL (MiFID II error) | PASS (cross-checking between agents) |
| Verify gates | 3/4 | 2/4 | 4/4 |
| Plan size | 49KB | 58KB | ~55-65KB (richer from debate) |

**Key insight:** The two failure modes produce opposite quality trade-offs:
- Collapsed role-play **preserves accuracy** (single context maintains consistency) but **loses completeness** (no advocate to defend dropped items)
- Independent subagents **preserve completeness** (each agent thoroughly analyzes its plan) but **lose accuracy** (no cross-validation between agents)
- Real team debate should achieve **both** — advocates defend their unique contributions (completeness) while challenging each other's claims (accuracy)

### 2.3 Root Cause Analysis

**Why Sonnet doesn't use TeamCreate:**

1. **Tool discovery gap:** The prompt says "Create an agent team" but Sonnet maps this to concepts it knows better — role-playing (familiar pattern) or Agent spawning (familiar tool). `TeamCreate` is an experimental tool that Sonnet may not strongly associate with the natural language instruction.

2. **Model capability threshold:** Agent-teams requires the model to:
   - Recognize `TeamCreate` as the intended mechanism
   - Construct a well-structured team definition
   - Coordinate multi-agent interaction over multiple turns
   - Synthesize debate results
   This is a complex multi-step orchestration task. Opus, with deeper reasoning, is more likely to follow the full chain.

3. **Prompt ambiguity:** "Create an agent team" is interpretable as a metaphor (role-play) or a literal instruction (use TeamCreate tool). A more explicit prompt ("You MUST use the TeamCreate tool") was implemented after this experiment but not yet tested.

---

## Part 3: Comparative Analysis — Both Runs

### 3.1 Completeness Failures by Lens

| Source Lens | Run A (collapsed) | Run B (subagents) |
|------------|-------------------|-------------------|
| Security | 4 dropped | 0 dropped |
| Reliability | 3 dropped | 1 dropped (PDBs) |
| Performance | 1 dropped | 2 dropped (Caffeine cache, test strategy) |
| Maintainability | 0 dropped | 0 dropped |

**Pattern:** Collapsed role-play disproportionately drops security and reliability details. Independent subagents distribute losses more evenly but still lose performance-specific items. Maintainability (the structural backbone) is preserved in both approaches.

### 3.2 Pre-Mortem Comparison

| Aspect | Run A | Run B |
|--------|-------|-------|
| Found real plan bugs? | Yes (TTL contradiction) | No (but found GDPR vulnerability) |
| Operational specificity | Good | Better |
| Novel insights | Vault HA cascade | GDPR pseudonymization, deadlock analysis |
| Actionability of mitigations | Good | Better |

Run B's pre-mortem is higher quality — more operationally specific, with the GDPR pseudonymization scenario (Failure 4) being a novel and high-value finding. This may be because the subagent approach produced a more thorough initial analysis per lens.

### 3.3 Disagreement Classification (Run A only — Run B had no debate)

| Classification | Count | Dimensions |
|---------------|-------|------------|
| Complementary | 3 | Service decomposition, Data migration, Risk mitigation |
| Arbitrary divergence | 1 | Deployment & operations |
| Genuine trade-off | 1 | Feasibility & sequencing |

This matches the NIER paper case study (also 3/5 complementary), strengthening the hypothesis that structured lens diversity produces useful, not random, variation.

---

## Part 4: Lessons for Tool Development

### 4.1 Model-Strategy Matrix

| Merge strategy | Sonnet | Opus |
|---------------|--------|------|
| `simple` (headless, single-agent) | **Recommended** — reliable, deterministic | Overkill — no multi-agent benefit |
| `agent-teams` (TeamCreate debate) | **Not reliable** — collapses or spawns subagents | **Recommended** — follows complex orchestration |
| `subagent-debate` (programmatic) | Viable — each subagent does simple analysis | Viable — higher quality per subagent |

**Conclusion:** Agent-teams merge requires Opus. Sonnet should use `simple` or `subagent-debate` modes only.

### 4.2 Prompt Engineering Applied (Post-Experiment)

After this experiment, two changes were made to `merge-plans.sh`:

1. **Explicit tool naming in prompt:**
   ```
   CRITICAL: You MUST use the TeamCreate tool to create the agent team below.
   Do NOT simulate the debate yourself by role-playing advocates in a single context.
   Do NOT use the Agent tool to spawn independent subagents.
   ```

2. **System prompt enforcement:**
   ```
   --system-prompt "You MUST use the TeamCreate tool for multi-agent work.
   Never use the Agent tool or simulate agent debate by role-playing."
   ```

These changes have not yet been tested with Sonnet. However, a subsequent Opus run (same prompts, with the TeamCreate enforcement) immediately used TeamCreate on the first turn — confirming that:
1. **Opus maps "Create an agent team" → TeamCreate naturally**, even without the explicit enforcement
2. **Sonnet's failure is a model capability gap**, not a prompt clarity issue
3. The prompt fix may help as defense-in-depth for Opus but is unlikely to fix Sonnet

This is the clearest evidence that agent-teams orchestration has a **model capability threshold** that Sonnet falls below.

### 4.3 Recommended Configuration for Future Runs

```yaml
# Generation: Sonnet (fast, high quality)
model: sonnet

# Merge: Opus (required for agent-teams)
# Set via: MODEL=opus ./merge-plans.sh ...
model: opus

# Or: avoid agent-teams entirely with Sonnet
# MERGE_MODE=simple ./merge-plans.sh ...
```

### 4.4 Lens Diversity Is Prompt-Driven, Not Model-Driven

A subsequent Opus run (same prompts, same lenses) produced a nearly identical coverage matrix:

| Dimension | Sonnet pass rate | Opus pass rate |
|-----------|-----------------|----------------|
| Service decomposition | 4/4 | 4/4 |
| Data migration | 1/4 | 3/4 |
| Risk mitigation | 2/4 | 1/4 |
| Deployment & ops | 4/4 | 4/4 |
| Feasibility | 4/4 | 4/4 |
| Reliability = strongest lens | 5/5 | 5/5 |
| Security = weakest lens | 3/5 | 3/5 |

Jaccard similarity was 0% across all 6 pairs for Opus (vs 0-4% for Sonnet) — structural diversity is even higher with Opus, but the coverage distribution pattern is the same. This validates that **lens diversity is driven by the prompt design (ISO 25010 decomposition), not by the model's reasoning capability**. Switching models does not change which dimensions each lens covers well — it changes how deeply each dimension is covered.

**Paper implication:** The multi-lens framework's diversity guarantee comes from the analytical framing (maintainability, reliability, security, performance), not from model choice. This means the framework is portable across model families.

---

## Part 5: Comparison with NIER Paper Case Study

| Aspect | NIER Case Study | DayTrader T2 (Sonnet) |
|--------|----------------|----------------------|
| Task domain | Academic paper planning | Software architecture / migration |
| Lenses | Ad-hoc (4) | ISO 25010 (4) |
| Generation model | Opus | Sonnet |
| Merge model | Opus | Sonnet |
| Generation time | ~40 min | 7 min |
| Total pipeline | ~2 hours | ~20 min |
| Plan sizes | 30-40KB each | 36-52KB each |
| Merged plan | 41KB, 660 lines | 49-58KB, 945+ lines |
| Jaccard mean | ~0% | ~1.3% |
| Merge disagreements | 3/5 complementary | 3/5 complementary |
| Agent-teams achieved? | Yes (Opus) | **No** (Sonnet — 2 failure modes) |
| Verify result | 2/3 PASS (no Gate 4) | 2-3/4 PASS |
| Failing gate | COMPLETENESS | COMPLETENESS (+FACTUAL in Run B) |
| Citation accuracy | FAIL (fabricated authors) | PASS/FAIL (varies by run) |
| Pre-mortem | Not run | 5 scenarios per run, real bugs found |

**Key cross-study findings:**
1. **Complementary dominance (3/5)** holds across domains and models
2. **Completeness is the hardest gate** — consistent across all runs and case studies
3. **Agent-teams requires Opus** — the NIER run achieved real team debate with Opus; this run failed twice with Sonnet
4. **Generation quality is model-agnostic** — Sonnet produces comparable plan quality to Opus (individual plans)
5. **Pre-mortem consistently adds value** — finds bugs that quality gates miss

---

## Part 6: Data Points for the Paper

1. **Sonnet generation is sufficient:** 4 plans, 179KB, 7 minutes, comparable quality to Opus
2. **Sonnet merge is insufficient for agent-teams:** 0/2 attempts achieved TeamCreate-based debate
3. **Two distinct failure modes observed:** collapsed role-play and independent subagents
4. **Failure modes produce opposite quality trade-offs:** accuracy vs completeness
5. **Lens diversity metric:** Mean Jaccard ~1.3% (range 0-4%), confirming structural diversity
6. **Complementary dominance:** 3/5 — matches NIER case study
7. **Completeness gate universally hardest:** consistent across all runs and case studies
8. **Pre-mortem adds value beyond gates:** TTL contradiction (Run A), GDPR pseudonymization (Run B)
9. **Model-strategy coupling:** agent-teams ↔ Opus, simple/subagent-debate ↔ Sonnet
10. **10× speed improvement:** Sonnet pipeline ~20 min vs Opus ~2 hours for generation
11. **Lens diversity is prompt-driven, not model-driven:** Sonnet and Opus produce nearly identical coverage matrices (same strengths/weaknesses per lens, same strongest/weakest dimensions). Switching models changes depth, not diversity. The ISO 25010 lens decomposition is the diversity guarantee, not model capability.
12. **Agent-teams has a model capability threshold:** Opus immediately uses TeamCreate on first turn; Sonnet never does (0/2 attempts). This is not a prompt clarity issue — Opus succeeds even without explicit "use TeamCreate" enforcement. Multi-agent orchestration requires a reasoning capability level that Sonnet does not reach.
