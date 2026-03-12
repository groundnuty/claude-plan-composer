# Case Study Report: DayTrader T2 — TypeScript SDK Pipeline (Opus)

**Date:** 2026-03-12
**Based on:** TS SDK pipeline with both merge strategies (simple + agent-teams)
**Run directory:** `generated-plans/multi-120621/20260312-120621/`
**Verdict:** Simple merge achieves the only 4/4 verification across all runs. Agent-teams works headlessly via Agent SDK `query()` but introduces factual risk. TeamCreate is not limited to interactive mode.

---

## Part 1: Pipeline Quality

### 1.1 Overall Assessment

The TS pipeline produced comparable results to the bash pipeline in less time and with clearer cost tracking. Two merge strategies were tested on the same generated plans:

| Metric | Simple | Agent-Teams |
|--------|--------|-------------|
| Verify gates | **4/4 PASS** | 3/4 PASS |
| Pre-mortem quality | High (operational) | High (architectural) |
| Cost | $1.13 | $1.61 |
| Duration | ~8 min | ~10 min |

**Simple merge grade: A** — only perfect verification score across all runs (bash and TS).
**Agent-teams merge grade: A-** — real debate achieved headlessly, but factual errors introduced.

### 1.2 Generation (4 lenses, parallel)

| Lens | Plan size | Turns | Tools | Cost |
|------|----------|-------|-------|------|
| 01-maintainability | 34KB | 44 | 35 | $1.17 |
| 02-reliability | 39KB | 43 | 35 | $1.25 |
| 03-security | 39KB | 49 | 40 | $1.23 |
| 04-performance | 33KB | 45 | 38 | $1.29 |
| **Totals** | **145KB** | **181** | **148** | **$4.94** |

Generation is nearly identical to bash Opus (145KB vs 145KB, 379s vs 395s). The Agent SDK `query()` produces equivalent results to CLI `claude -p`.

### 1.3 Evaluation

- **Convergence:** 75% (3/4 dimensions universally covered)
- **6 gaps identified:** data consistency verification, GitOps pipeline, GDPR DSAR orchestration, user cohort migration, timeline contingency, integration testing strategy
- **Cost:** $0.09

Note: TS evaluator uses a different prompt template than bash — produces convergence score + gap analysis rather than binary coverage matrix.

---

## Part 2: Simple Merge — The 4/4 Result

### 2.1 Why It Worked

The simple merge uses a single Opus session with all 4 plans in context. With 145KB of source material, Opus synthesized a 71KB merged plan that:
- Preserved content from all lenses (COMPLETENESS: PASS)
- Maintained internal consistency (CONSISTENCY: PASS)
- Included deployable YAML, compilable Java, numeric SLOs (ACTIONABILITY: PASS)
- Made no fabricated technical claims (FACTUAL ACCURACY: PASS)

**Key insight:** A single capable agent (Opus) with all plans in context can synthesize more accurately than a team that introduces claims during debate. The simplicity of the approach — no inter-agent communication, no debate overhead — eliminates the risk of claims being introduced that aren't grounded in the source plans.

### 2.2 Pre-Mortem Findings

| # | Failure | Core Issue |
|---|---------|------------|
| 1 | PgBouncer breaks Hibernate prepared statement caching | Transaction pooling + PreparedStatement cache incompatibility |
| 2 | KEYGENEJB not replaced before Phase 1 → PK collisions | Risk register mentions it but Phase 0 checklist omits it |
| 3 | JMS-to-Kafka cutover can't achieve complete drain | Live system receives continuous messages; 847 orders orphaned |
| 4 | MirrorMaker 2 topic prefixing breaks EU/APAC consumers | Default `source-cluster.topic` naming not configured |
| 5 | Saga compensation race with `updateQuotePriceVolume()` | Step 9 fires before compensation detected; volume data diverges |

**Character:** Predominantly operational — PgBouncer config, JMS drain, MirrorMaker prefixing. These are issues that would surface during deployment, not during design. This contrasts with the agent-teams pre-mortem which found architectural issues (Derby CDC, BCrypt CDC).

---

## Part 3: Agent-Teams Merge — Headless TeamCreate

### 3.1 The Headline Finding

**TeamCreate works headlessly via Agent SDK `query()`.** Previous assumption was that agent-teams required interactive mode. The TS tool proved this wrong:

- Turn 12: TeamCreate (team of 4 advocates created)
- Turns 14-25: SendMessage ×10 (inter-agent debate)
- Turn 27: Write (merged plan)
- Turns 29-32: SendMessage ×4 (shutdown notifications)
- Turn 34: TeamDelete (cleanup)

Configuration required:
```typescript
env: {
  ...process.env,
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
  CLAUDECODE: "",
}
tools: ["TeamCreate", "SendMessage", "TeamDelete", "Read", "Glob", "Write"]
```

### 3.2 Factual Accuracy Failure

Two errors introduced during debate:

1. **Debezium does not support Derby** — The plan assumes CDC from Derby to PostgreSQL via Debezium, but Derby has no Debezium connector and no accessible transaction log.
2. **MiFID II retention is 5 years, not 7** — A regulatory detail was inflated during the debate.

These claims were not in any of the 4 source plans. They were introduced during the multi-agent debate, likely from an advocate adding domain knowledge that wasn't verified against the source material.

### 3.3 Pre-Mortem Findings

| # | Failure | Core Issue |
|---|---------|------------|
| 1 | **Derby has no Debezium connector** — CDC strategy impossible | Corroborates bash Opus finding |
| 2 | Saga compensation loop creates permanently locked accounts | No dead-letter mechanism for failed compensations |
| 3 | Redis OOM kills Market Data Service CQRS state | 128Mi limit + stale ZSET entries; insufficient Kafka retention |
| 4 | KEYGENEJB not in Phase 0 task list → PK collisions | Same issue as simple pre-mortem scenario 2 |
| 5 | BCrypt dual-mode replicates plaintext to PostgreSQL via CDC | Dormant accounts never migrated; GDPR Article 32 breach |

**Character:** Predominantly architectural — Derby CDC (Scenario 1) and BCrypt CDC (Scenario 5) are design-level flaws. The Derby CDC finding corroborates the bash Opus pre-mortem, providing cross-tool validation.

---

## Part 4: Cross-Strategy Analysis

### 4.1 Debate Adds Richness but Also Risk

| Aspect | Simple | Agent-Teams |
|--------|--------|-------------|
| Content source | Only source plans | Source plans + debate-generated claims |
| Factual risk | Low (no new claims) | **Higher (claims introduced during debate)** |
| Completeness | PASS | PASS |
| Consistency | PASS | PASS |
| Factual accuracy | **PASS** | **FAIL** |
| Pre-mortem character | Operational | Architectural |
| Pre-mortem novelty | PgBouncer, MirrorMaker (unique) | Derby CDC (corroborated), BCrypt CDC (unique) |

### 4.2 Neither Strategy Is Strictly Better

- **Simple** is safer: no factual risk, faster, cheaper, achieved the only 4/4 score
- **Agent-teams** is richer: real debate, architectural pre-mortem findings, cross-agent validation

The choice depends on the use case:
- **For production migration plans:** Use simple (accuracy > richness)
- **For research/exploration:** Use agent-teams (novel findings > safety)
- **For maximum quality:** Run both, take the simple plan but incorporate agent-teams pre-mortem findings

### 4.3 Cost Breakdown

| Phase | Simple path | Agent-teams path |
|-------|------------|-----------------|
| Generate (shared) | $4.94 | $4.94 |
| Evaluate (shared) | $0.09 | $0.09 |
| Merge | $1.13 | $1.61 |
| Verify + Pre-mortem | $0.60 | $0.89 |
| **Total** | **$6.76** | **$7.53** |

Agent-teams is 11% more expensive ($0.77 delta) — modest for the additional debate richness.

---

## Part 5: Key Findings for the Paper

### Finding 1: TeamCreate Works Headlessly via Agent SDK

The Agent SDK `query()` with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` enables real multi-agent team debate without interactive mode. This is the first confirmed headless agent-teams usage. The TS SDK proves it's a programmatic capability, not limited to the interactive CLI.

### Finding 2: Simple Merge Can Achieve Perfect Verification

4/4 PASS — the only perfect score across all runs (3 bash merges + 2 TS merges). A single capable model with all source material in context synthesizes more accurately than a team that introduces debate-generated claims.

### Finding 3: Agent-Teams Adds Content but Also Factual Risk

The debate introduces content (Derby CDC reference, MiFID II retention period) that wouldn't appear in a simple single-pass merge. This content can be inaccurate because it's generated during debate rather than grounded in source plans.

### Finding 4: Pre-Mortem Character Differs by Strategy

Simple pre-mortem finds operational issues (PgBouncer, JMS drain, MirrorMaker). Agent-teams pre-mortem finds architectural issues (Derby CDC, BCrypt CDC). Both find the KEYGENEJB issue. Running both strategies yields complementary pre-mortem coverage.

### Finding 5: Derby CDC Is Validated Cross-Tool

The Derby CDC impossibility finding appears in:
- Bash Opus pre-mortem (Scenario 1)
- TS agent-teams verify (FACTUAL_ACCURACY FAIL)
- TS agent-teams pre-mortem (Scenario 1)

Three independent discovery paths across two tools. This is the strongest cross-tool validation of any finding.

### Finding 6: TS Pipeline Matches Bash Pipeline Quality

Generation, evaluation, and merge produce equivalent results. The TS implementation is a valid alternative to the bash toolkit with better cost tracking and programmatic control.

---

## Part 6: Data Points for the Paper

1. **TeamCreate works headlessly:** Agent SDK `query()` + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` enables real multi-agent debate without interactive mode.
2. **Simple merge achieves 4/4:** Only perfect verification score across 5 merge runs (3 bash + 2 TS).
3. **Agent-teams factual risk:** 2 factual errors introduced during debate (Derby CDC, MiFID II) — not present in any source plan.
4. **Pre-mortem strategy complementarity:** Simple finds operational issues; agent-teams finds architectural issues. Both find KEYGENEJB.
5. **Derby CDC cross-tool validation:** Same finding across 3 independent paths in 2 tools.
6. **TS pipeline parity:** 145KB generation (matching bash Opus exactly), comparable merge quality, equivalent verify results.
7. **Cost tracking:** Full pipeline costs trackable per-phase — $6.76 (simple path) vs $7.53 (agent-teams path).
8. **Agent-teams cost premium:** 11% more expensive ($0.77 delta) for debate richness.
9. **Strategy trade-off:** Simple = accuracy (4/4); Agent-teams = richness (architectural pre-mortem). Neither is strictly better.
10. **`...process.env` requirement:** Agent SDK `query()` must spread `process.env` in env options — stripping PATH prevents finding the claude executable.
