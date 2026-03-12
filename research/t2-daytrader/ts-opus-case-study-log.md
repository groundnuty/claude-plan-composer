# Case Study Log: DayTrader T2 Migration — TS SDK Pipeline (Opus)

## Overview

**Task:** Use claude-plan-composer-ts (TypeScript SDK) to generate a comprehensive migration plan for the DayTrader 7 monolith-to-microservices migration.

**Experiment:** T2-DayTrader, corrected configuration (Opus generation + merge, 3-pass evaluation, two merge strategies tested)

**Key findings:**
1. **TeamCreate works headlessly** via Agent SDK `query()` — not limited to interactive mode
2. **Simple merge achieves 4/4 verification gates** — first perfect score across all runs
3. **Agent-teams adds debate richness but introduces factual errors** — 3/4 gates (Derby CDC caught by verify)

## Configuration

- **Mode:** Multi-file (4 prompts + shared context)
- **Model:** Opus (generation + merge), Sonnet (evaluation + verify)
- **Generation config:** `projects/daytrader-t2/config.yaml` — opus, 80 turns, 3600000ms timeout
- **Merge config:** `projects/daytrader-t2/merge-config.yaml` — opus, 60 turns, 5400000ms timeout, pairwise comparison, 5 weighted dimensions
- **Evaluation:** 3 passes, majority consensus, binary scoring (Sonnet)
- **Lenses:** Maintainability, Reliability, Security, Performance Efficiency (all ISO 25010)
- **Shared context:** `prompts/00-common-context.md`
- **Additional dir:** `/tmp/sample.daytrader7`
- **MCP:** None (`strict_mcp: true`)
- **Tools:** Read, Glob, Bash, Write, WebFetch, WebSearch

## Artifact Inventory

All artifacts in `generated-plans/multi-120621/20260312-120621/`:

| File | Size | Description |
|------|------|-------------|
| `plan-01-maintainability.md` | 34KB | DDD analysis, hexagonal architecture |
| `plan-02-reliability.md` | 39KB | SPOF analysis, saga compensation, rollback |
| `plan-03-security.md` | 39KB | GDPR architecture, security hardening |
| `plan-04-performance.md` | 33KB | Hot-path analysis, CQRS, benchmarks |
| `evaluation-sonnet.json` | 7.1KB | Coverage matrix (3-pass majority) |
| `evaluation-sonnet.md` | 2.3KB | Evaluation summary |
| `merged-plan-simple.md` | 71KB | Merged plan (simple strategy) |
| `merged-plan.md` | — | Merged plan (agent-teams strategy) |
| `verification-report-simple.json` | 6.8KB | Verify: 4/4 PASS |
| `verification-report.json` | — | Verify: 3/4 PASS (FACTUAL_ACCURACY FAIL) |
| `pre-mortem-simple.md` | 9.1KB | Pre-mortem (simple): 5 scenarios |
| `pre-mortem.md` | — | Pre-mortem (agent-teams): 5 scenarios |

---

## Step 1: Generation (4 lenses, parallel, Opus)

**Date:** 2026-03-12 12:06
**Duration:** 379 seconds (~6.3 minutes)

### Per-lens metrics

| Lens | Plan size | Turns | Tools | Cost |
|------|----------|-------|-------|------|
| 01-maintainability | 34KB | 44 | 35 | $1.17 |
| 02-reliability | 39KB | 43 | 35 | $1.25 |
| 03-security | 39KB | 49 | 40 | $1.23 |
| 04-performance | 33KB | 45 | 38 | $1.29 |
| **Totals** | **145KB** | **181** | **148** | **$4.94** |

**Observations:**
- All lenses completed within ~6 minutes (well within 3600s timeout)
- Security lens most thorough (49 turns), performance most efficient but highest cost ($1.29)
- Plan sizes match bash Opus run closely (145KB vs 145KB)

---

## Step 2: Evaluation (Jaccard + LLM binary scoring, 3-pass)

**Date:** 2026-03-12 ~12:15
**Model:** Sonnet (but see note below)
**Cost:** $0.09

### Jaccard similarity

All 6 pairs: **0%** overlap (rounded to nearest integer). Mean Jaccard: 0.7%.

### Evaluation summary

- **Convergence:** 75% (3/4 dimensions universally covered)
- **Gaps found:** 6 (data consistency verification, GitOps pipeline, GDPR DSAR orchestration, user cohort migration, timeline contingency, integration testing strategy)
- **Per-plan strengths:** All 4 plans converge on same 4-service decomposition. Differ in optimization criteria.

**Note:** The TS evaluate format differs from bash — it produces a convergence score + gap analysis rather than a binary coverage matrix. This is because the TS evaluator uses a different prompt template.

---

## Step 3: Merge — Two Strategies Compared

### Run A: Simple (headless, single session)

**Date:** 2026-03-12 ~12:20
**Duration:** ~8 minutes
**Strategy:** simple (pairwise comparison)

| Metric | Value |
|--------|-------|
| Turns | 5 |
| Tools | 2 (Glob, Write) |
| Cost | $1.13 |
| Output | 71KB |

### Run B: Agent-Teams (headless via Agent SDK)

**Date:** 2026-03-12 ~12:30
**Duration:** ~10 minutes
**Strategy:** agent-teams (TeamCreate via `query()`)

| Metric | Value |
|--------|-------|
| Turns | 35 |
| Tools | 23 — TeamCreate(1), SendMessage(10), Read(4), Glob(3), Write(1), TeamDelete(1) |
| Cost | $1.61 |
| Output | — |

**Critical finding: TeamCreate works headlessly.** The Agent SDK `query()` with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env var and `TeamCreate`/`SendMessage`/`TeamDelete` in the tools list enables real multi-agent team debate without interactive mode.

**Tool fingerprint:**
- Turn 12: TeamCreate (team of 4 advocates created)
- Turns 14-25: SendMessage ×10 (inter-agent debate)
- Turn 27: Write (merged plan)
- Turns 29-32: SendMessage ×4 (shutdown notifications)
- Turn 34: TeamDelete (cleanup)

---

## Step 4: Verification + Pre-Mortem

### Simple strategy: 4/4 PASS

| Gate | Result |
|------|--------|
| CONSISTENCY | **PASS** — No contradictions. Extraction order, timeline, technology choices all consistent. |
| COMPLETENESS | **PASS** — All major content from all 4 source plans present. Detailed traceability provided. |
| ACTIONABILITY | **PASS** — Deployable YAML, compilable Java, numeric SLOs, phase task breakdowns with owners. |
| FACTUAL ACCURACY | **PASS** — All tech claims verified (Kafka CooperativeStickyAssignor, PgBouncer transaction mode, lz4). |

**Pre-mortem (simple):** 5 scenarios

| # | Failure | Core Issue |
|---|---------|------------|
| 1 | PgBouncer breaks Hibernate prepared statement caching | Transaction pooling + PreparedStatement cache incompatibility |
| 2 | KEYGENEJB not replaced before Phase 1 → PK collisions | Risk register mentions it but Phase 0 checklist omits it |
| 3 | JMS-to-Kafka cutover can't achieve complete drain | Live system receives continuous messages; 847 orders orphaned |
| 4 | MirrorMaker 2 topic prefixing breaks EU/APAC consumers | Default `source-cluster.topic` naming not configured |
| 5 | Saga compensation race with `updateQuotePriceVolume()` | Step 9 fires before compensation detected; volume data diverges |

### Agent-teams strategy: 3/4 PASS

| Gate | Result |
|------|--------|
| CONSISTENCY | **PASS** — 5-service decomposition consistent. 24-week timeline verified. |
| COMPLETENESS | **PASS** — All major content present. 6 secondary omissions noted but judged non-substantive. |
| ACTIONABILITY | **PASS** — YAML manifests, Java code, per-phase task breakdowns with owners and durations. |
| FACTUAL ACCURACY | **FAIL** — (1) Debezium does not support Derby; (2) MiFID II is 5 years, not 7. |

**Pre-mortem (agent-teams):** 5 scenarios

| # | Failure | Core Issue |
|---|---------|------------|
| 1 | **Derby has no Debezium connector** — CDC strategy impossible | Same as bash Opus finding; verify also caught it |
| 2 | Saga compensation loop creates permanently locked accounts | Circuit breaker opens during compensation; no dead-letter mechanism |
| 3 | Redis OOM kills Market Data Service CQRS state | 128Mi limit + stale ZSET entries; 1h Kafka retention insufficient for rebuild |
| 4 | KEYGENEJB not in Phase 0 task list → PK collisions | Same issue as simple pre-mortem scenario 2 |
| 5 | BCrypt dual-mode replicates plaintext to PostgreSQL via CDC | Plaintext passwords copied by CDC; dormant accounts never migrated |

---

## Cross-Strategy Comparison

| Metric | Simple | Agent-Teams |
|--------|--------|-------------|
| Used TeamCreate? | No | **Yes (headless)** |
| Turns | 5 | 35 |
| Tools | 2 | 23 |
| Cost | $1.13 | $1.61 |
| Duration | ~8 min | ~10 min |
| Output size | 71KB | — |
| **CONSISTENCY** | PASS | PASS |
| **COMPLETENESS** | PASS | PASS |
| **ACTIONABILITY** | PASS | PASS |
| **FACTUAL ACCURACY** | **PASS** | **FAIL** |
| **Total** | **4/4** | **3/4** |
| Pre-mortem top finding | PgBouncer/Hibernate | Derby CDC |

**Analysis:**
- **Simple merge produced the only 4/4 verification in the entire experiment** (across both tools, all runs)
- Agent-teams introduced factual claims (Derby CDC, MiFID II 7yr) that the verify gate caught — debate adds content but also adds risk of inaccurate claims
- Both strategies found the KEYGENEJB issue in pre-mortem
- Agent-teams pre-mortem found the Derby CDC issue independently (corroborating bash Opus pre-mortem)
- Simple pre-mortem found unique operational issues (PgBouncer, MirrorMaker 2 prefixing, JMS drain)

---

## Pipeline Summary

| Phase | Duration | Model | Turns | Tools | Cost | Output |
|-------|----------|-------|-------|-------|------|--------|
| Generate (4 parallel) | 379s | opus | 181 | 148 | $4.94 | 145KB |
| Evaluate (3-pass) | ~65s | sonnet | 2 | 0 | $0.09 | 9KB |
| Merge (simple) | ~498s | opus | 5 | 2 | $1.13 | 71KB |
| Verify+PM (simple) | ~250s | sonnet | 7 | 2 | $0.60 | 16KB |
| Merge (agent-teams) | ~603s | opus | 35 | 23 | $1.61 | — |
| Verify+PM (agent-teams) | ~293s | sonnet | 15 | 8 | $0.89 | — |
| **Total** | **~35 min** | | | | **$9.26** | |

---

## Key Observations

1. **TeamCreate works headlessly via Agent SDK `query()`.** This is a new finding — previous assumption was that agent-teams required interactive mode. The TS tool proves headless multi-agent debate is possible.

2. **Simple merge can achieve 4/4 verification.** The only perfect score across all runs (bash and TS). Suggests that a single capable agent (Opus) with all plans in context can synthesize more accurately than a team that introduces claims during debate.

3. **Agent-teams adds debate richness but also factual risk.** The debate introduces content (Derby CDC reference, MiFID II details) that wouldn't appear in a simple single-pass merge — but this content can be inaccurate.

4. **Pre-mortem findings are consistent across tools.** Derby CDC and KEYGENEJB issues appear in both bash and TS runs. BCrypt migration risk appears in all runs across both tools.

5. **TS pipeline cost is trackable.** Total: $9.26 for both merge strategies. Per-strategy: $6.76 (simple path) vs $7.44 (agent-teams path).

6. **`...process.env` bug (FIXED).** The TS evaluate, verify, and pre-mortem sessions were missing `...process.env` in query options, causing the Agent SDK to fail finding the `claude` executable. Fixed by spreading `process.env` in all `query()` calls.
