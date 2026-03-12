# Case Study Log: DayTrader T2 Migration — Sonnet-Only Pipeline (Bash Tool)

## Overview

**Task:** Use claude-plan-composer (bash) to generate a comprehensive migration plan for the DayTrader 7 monolith-to-microservices migration.

**Experiment:** T2-DayTrader, C4 configuration (Sonnet-only, 4 ISO 25010 lenses, pairwise comparison, 5 weighted dimensions)

**Key finding:** Sonnet cannot reliably execute agent-teams merge. Two attempts produced two different failure modes (collapsed role-play, independent subagents) — neither achieved the intended multi-agent team debate. This establishes Sonnet as insufficient for the agent-teams merge strategy.

**Why this is a good case study:**
- Real software architecture task — migrating an actual open-source Java EE benchmark application
- Demonstrates all 4 pipeline phases (generate, evaluate, merge, verify + pre-mortem)
- ISO 25010-grounded lenses — scientifically defensible, not ad-hoc perspectives
- 5 custom constraints (streaming, GDPR, COBOL, zero-downtime, K8s) force genuine planning
- Codebase-grounded — agents must read actual DayTrader source code
- Two merge attempts reveal model capability limits for multi-agent orchestration

## Configuration

- **Mode:** Multi-file (4 prompts + shared context)
- **Model:** Sonnet (all phases — generation, evaluation, merge, verify)
- **Generation config:** `projects/daytrader-t2/config.yaml` — sonnet, 80 turns, 3600s timeout
- **Merge config:** `projects/daytrader-t2/merge-config.yaml` — sonnet, 60 turns, 5400s timeout, pairwise comparison, 5 weighted dimensions
- **Lenses:** Maintainability (ISO 25010), Reliability (ISO 25010), Security (ISO 25010), Performance Efficiency (ISO 25010)
- **Shared context:** `prompts/00-common-context.md` (task description, codebase instructions, 5 constraints)
- **Additional dir:** `/tmp/sample.daytrader7` (cloned DayTrader 7 codebase)
- **Work dir:** (temp — no persistent work dir)
- **MCP:** None (`strict_mcp: true`)
- **Tools:** Read, Glob, Bash, Write, WebFetch, WebSearch

## Artifact Inventory

All artifacts in `generated-plans/multi-041344/20260312-041344/`:

| File | Size | Lines | Description |
|------|------|-------|-------------|
| `plan-01-maintainability.md` | 36KB | 724 | FK-grounded service decomposition, bounded contexts |
| `plan-01-maintainability.log` | 417KB | — | Full session log (NDJSON) |
| `plan-02-reliability.md` | 46KB | 955 | SPOF analysis, saga compensation, rollback triggers |
| `plan-02-reliability.log` | 476KB | — | Full session log |
| `plan-03-security.md` | 52KB | 1275 | GDPR architecture, Vault HA, Keycloak, OPA policies |
| `plan-03-security.log` | 425KB | — | Full session log |
| `plan-04-performance.md` | 45KB | 1062 | Hot-path analysis, HPA, connection pool budgeting |
| `plan-04-performance.log` | 441KB | — | Full session log |
| `evaluation-sonnet.json` | 7.7KB | — | Structured coverage matrix (binary scoring) |
| `evaluation-sonnet.md` | 2.4KB | — | Human-readable evaluation summary |
| `merge-prompt-collapsed.md` | 5.5KB | 94 | Merge prompt for Run A |
| `merged-plan-collapsed.md` | 49KB | 945 | Merged plan — Run A (collapsed role-play) |
| `verification-report-collapsed.md` | 4.1KB | 43 | Verify Run A: 3/4 PASS |
| `pre-mortem-collapsed.md` | 12KB | — | Pre-mortem Run A: 5 scenarios |
| `merge-prompt-subagents.md` | 5.5KB | 94 | Merge prompt for Run B |
| `merged-plan-subagents.md` | 58KB | — | Merged plan — Run B (independent subagents) |
| `verification-report-subagents.md` | 3.6KB | — | Verify Run B: 2/4 PASS |
| `pre-mortem-subagents.md` | 11KB | — | Pre-mortem Run B: 5 scenarios |
| **Total plans** | **179KB** | **4,016** | (4 individual plans) |
| **Total logs** | **1.76MB** | — | (4 generation logs) |

---

## Step 1: Generation (4 lenses, parallel)

**Date:** 2026-03-12 04:13
**Duration:** 427 seconds (~7 minutes)
**Command:**
```bash
CONFIG=projects/daytrader-t2/config.yaml \
  ./generate-plans.sh \
  --context=projects/daytrader-t2/prompts/00-common-context.md \
  projects/daytrader-t2/prompts/01-maintainability.md \
  projects/daytrader-t2/prompts/02-reliability.md \
  projects/daytrader-t2/prompts/03-security.md \
  projects/daytrader-t2/prompts/04-performance.md
```

### Per-lens metrics

| Lens | Plan size | Lines | Turns | Tools | Input | Output | Cache+ | Cache→ | Total | Ctx |
|------|----------|-------|-------|-------|-------|--------|--------|--------|-------|-----|
| 01-maintainability | 36KB | 724 | 51 | 47 | 79 | 415 | 209K | 2.3M | 2.5M | 35K (17%) |
| 02-reliability | 46KB | 955 | 43 | 39 | 26K | 113 | 215K | 1.8M | 2.1M | 44K (22%) |
| 03-security | 52KB | 1275 | 57 | 53 | 253 | 90 | 199K | 2.2M | 2.4M | 38K (18%) |
| 04-performance | 45KB | 1062 | 39 | 35 | 41 | 359 | 196K | 1.6M | 1.8M | 40K (19%) |
| **Totals** | **179KB** | **4,016** | **190** | **174** | **26K** | **977** | **819K** | **7.9M** | **8.8M** | |

### Tool usage per lens

| Lens | Read | Bash | Glob | Grep | Agent | Write |
|------|------|------|------|------|-------|-------|
| 01-maintainability | 27 | 18 | — | — | 1 | 1 |
| 02-reliability | 21 | 16 | — | — | 1 | 1 |
| 03-security | 20 | 15 | 13 | 3 | 1+ | — |
| 04-performance | 20 | 13 | — | — | 1 | 1 |

**Observations:**
- All 4 lenses completed well within the 3600s timeout (max ~400s)
- Security lens was most thorough (57 turns, 53 tools, 1275 lines) — heaviest Glob usage (13) for searching codebase patterns
- Performance lens was most efficient (39 turns, 35 tools, 1062 lines)
- All lenses used Read(20+) — confirms agents explored the actual DayTrader codebase as instructed
- All lenses used Bash — likely for `find`, `wc`, directory exploration
- Plan sizes are substantial (36-52KB) — these are detailed engineering plans, not summaries

---

## Step 2: Evaluation (Jaccard + LLM binary scoring)

**Date:** 2026-03-12 ~04:22
**Model:** Sonnet

### Jaccard similarity (section headings)

| Pair | Overlap |
|------|---------|
| 01-maintainability ↔ 02-reliability | 4% |
| 01-maintainability ↔ 03-security | 0% |
| 01-maintainability ↔ 04-performance | 0% |
| 02-reliability ↔ 03-security | 0% |
| 02-reliability ↔ 04-performance | 0% |
| 03-security ↔ 04-performance | 4% |

**Mean Jaccard:** ~1.3% — near-zero overlap as expected for multi-file/multi-lens mode. Different analytical lenses produce structurally different plans.

### Coverage matrix (binary scoring, 5 dimensions × 4 plans)

| Dimension (weight) | 01-maintainability | 02-reliability | 03-security | 04-performance |
|---------------------|:--:|:--:|:--:|:--:|
| Service decomposition (0.25) | PASS | PASS | PASS | PASS |
| Data migration (0.20) | FAIL | PASS | FAIL | FAIL |
| Risk mitigation (0.20) | PASS | PASS | FAIL | FAIL |
| Deployment & ops (0.20) | PASS | PASS | PASS | PASS |
| Feasibility (0.15) | PASS | PASS | PASS | PASS |
| **Pass rate** | **4/5** | **5/5** | **3/5** | **3/5** |

### Per-plan strengths

| Plan | Strongest dimensions |
|------|---------------------|
| 01-maintainability | Service decomposition, Feasibility & sequencing |
| 02-reliability | Risk mitigation & rollback, Data migration |
| 03-security | Deployment & operations, Service decomposition |
| 04-performance | Deployment & operations, Feasibility & sequencing |

**Key findings:**
- **02-reliability is the only plan that passes all 5 dimensions** — most complete individual plan
- **Data migration is the weakest dimension** — only 02-reliability passes (expand-contract pattern with Debezium CDC)
- **Risk mitigation** splits: maintainability and reliability pass (risk registers with triggers), security and performance fail (no per-phase rollback)
- **Service decomposition and deployment are universally strong** — all 4 lenses produce good results for these
- **No single lens dominates all dimensions in strength** — even reliability (5/5 pass) is not the strongest in every dimension

**C4 hypothesis check:** The spec predicted "no single variant dominates all dimensions" and "complementary disagreements." The evaluation confirms this.

---

## Step 3: Merge — Two Runs, Two Failure Modes

The agent-teams merge was attempted twice. Both failed to achieve the intended multi-agent team debate, but in different ways.

### Run A: Collapsed Role-Play

**Date:** 2026-03-12 ~04:24–04:33 (~9 minutes)
**Behavior:** Agent collapsed the 4-advocate debate into single-pass role-play — one agent sequentially assumed each advocate role rather than creating actual separate teammate agents via TeamCreate.

#### Merge metrics (Run A)

| Metric | Value |
|--------|-------|
| Turns | 23 |
| Tools | 10 — Read(8), Agent(1), Bash(1) |
| Output | 49KB, 945 lines |

#### Dimension-by-dimension resolution (Run A)

| Dimension | Classification | Resolution |
|-----------|---------------|------------|
| Service decomposition | **COMPLEMENTARY** | Plan 01 FK-grounded boundaries + Plan 02 extraction sequencing |
| Data migration | **COMPLEMENTARY** | Plan 02 expand-contract + Plan 04 outbox/Debezium |
| Risk mitigation | **COMPLEMENTARY** | All 4 plans — merged into unified register with Plan 02 triggers |
| Deployment & ops | **ARBITRARY DIVERGENCE** | Plan 04 pod sizing + Plan 02 PDB/HPA (more specific) |
| Feasibility | **GENUINE TRADE-OFF** | Plan 01 (Q→A→P→O sequential) vs Plan 02 (Q→A+P→O simultaneous) — **Winner: Plan 01** (safer) |

**Disagreement distribution:** 3 complementary, 1 arbitrary divergence, 1 genuine trade-off.

#### Verification (Run A): 3/4 PASS

| Gate | Result | Summary |
|------|--------|---------|
| 1. CONSISTENCY | **PASS** | No contradictions. BCrypt vs Argon2id divergence explicitly documented. |
| 2. COMPLETENESS | **FAIL** | 8 dropped items (4 security, 3 reliability, 1 performance) |
| 3. ACTIONABILITY | **PASS** | All sections contain concrete next steps. K8s YAML, SQL DDL, Java code. |
| 4. FACTUAL ACCURACY | **PASS** | No external citations. GDPR/SEC/MiFID II references verified correct. |

**Completeness failures (8 items):**

| # | Dropped Item | Source Lens | Severity |
|---|-------------|-------------|----------|
| 1 | CSRF protection (Phase 0) | Security | Medium |
| 2 | GDPR data portability API (Article 20) | Security | High |
| 3 | DPIA and consent management | Security | High |
| 4 | Per-phase rollback drill requirement | Reliability | High |
| 5 | 72-hour clean-metrics phase gate | Reliability | High |
| 6 | Per-phase chaos engineering scenarios | Reliability | Medium |
| 7 | Performance acceptance criteria table | Performance | Medium |
| 8 | DDoS protection / rate limiting | Security | Medium |

#### Pre-mortem (Run A): 5 scenarios

| # | Failure | Core Issue |
|---|---------|------------|
| 1 | Debezium WAL accumulation kills account-service | Missing WAL accumulation limits in outbox pattern |
| 2 | BCrypt migration causes 14-hour auth outage | No live migration strategy for plaintext→BCrypt |
| 3 | Saga compensation cascading failure (4,200 orders stuck) | Compensation handlers make synchronous cross-service calls |
| 4 | Vault HA failure kills all 4 services simultaneously | **TTL contradiction (1h vs 24h)** — real bug in plan |
| 5 | Phase 4 slips 8 weeks during MiFID II audit | Zero schedule buffer + missing audit record migration |

**Notable:** Scenario 4 found a real contradiction that the CONSISTENCY gate missed (1h vs 24h credential TTL).

---

### Run B: Independent Subagents (Not a Team)

**Date:** 2026-03-12 ~04:50–05:00 (~10 minutes)
**Behavior:** Agent spawned 4 independent subagents (via Agent tool), one per plan. Each subagent read and analyzed its assigned plan in isolation. The lead then synthesized their outputs. This is **not** the intended agent-teams behavior — subagents could not see each other's arguments or debate in real time.

#### Merge metrics (Run B)

| Metric | Value |
|--------|-------|
| Turns | 30 |
| Tools | Agent(4), Read (unknown), Write(1) |
| Output | 58KB |

#### Verification (Run B): 2/4 PASS

| Gate | Result | Summary |
|------|--------|---------|
| 1. CONSISTENCY | **PASS** | Balance reservation pattern applied uniformly. Debezium deployment staging consistent. |
| 2. COMPLETENESS | **FAIL** | 3 dropped items (see below) |
| 3. ACTIONABILITY | **PASS** | All sections have concrete next steps. Per-phase Definition of Done criteria. |
| 4. FACTUAL ACCURACY | **FAIL** | MiFID II 7-year retention cited as general rule; actual base requirement is 5 years |

**Completeness failures (3 items):**

| # | Dropped Item | Source Lens | Impact |
|---|-------------|-------------|--------|
| 1 | Caffeine L1 cache for quote-service | Performance | p50 <5ms target unachievable without in-process cache |
| 2 | Performance testing strategy + acceptance criteria | Performance | No testable definition of "performance requirements met" |
| 3 | PodDisruptionBudgets for account/order services | Reliability | Zero-downtime node maintenance requires PDBs |

**Factual accuracy failure:** The merged plan cites "MiFID II / SEC Rule 17a-4 7-year retention" as the general MiFID II standard. The base MiFID II Article 25 requirement is 5 years; 7 years applies only with national authority extension.

#### Pre-mortem (Run B): 5 scenarios

| # | Failure | Core Issue |
|---|---------|------------|
| 1 | Saga dead-letter queue overwhelms manual reconciliation (1,400 orders) | No automated re-drive, runbook assumes 10-20 stuck orders |
| 2 | BCrypt rehash-on-login leaves 60% accounts vulnerable for months | No offline batch migration, no completion tracking |
| 3 | `balance_reservations` deadlock under concurrent buy orders | Serializable isolation + same-userId contention not analyzed |
| 4 | GDPR opaque hash is pseudonymization, not anonymization — DPA finding | Deterministic HMAC allows re-identification via hash correlation |
| 5 | Debezium CDC lag invalidates saga TTL under 2× load | No polling interval SLO, no latency budget analysis |

**Notable:** Run B's pre-mortem scenarios are more detailed and operationally specific than Run A's. Scenario 4 (GDPR pseudonymization) is a novel and high-value finding not present in Run A.

---

## Comparison: Run A vs Run B

| Aspect | Run A (Collapsed) | Run B (Subagents) |
|--------|-------------------|-------------------|
| Agent behavior | Single-pass role-play | 4 independent subagents |
| Achieved team debate? | **No** | **No** |
| Merged plan size | 49KB, 945 lines | 58KB |
| Verify gates passed | 3/4 | 2/4 |
| Completeness failures | 8 items | 3 items |
| Factual accuracy | PASS | FAIL (MiFID II 5yr vs 7yr) |
| Pre-mortem quality | Good (found 1 real bug) | Better (more operationally specific) |
| Debate structure | Simulated but documented | No debate — parallel analysis only |

**Analysis:**
- **Neither run achieved agent-teams debate.** The intended behavior (TeamCreate → advocates see each other → real-time debate → synthesis) never occurred.
- **Run B produced fewer completeness failures** (3 vs 8) — independent subagent analysis was more thorough than simulated role-play.
- **Run B introduced a factual error** — the MiFID II 5yr→7yr mistake suggests less careful fact-checking without inter-agent validation.
- **Run B's pre-mortem was higher quality** — more operationally specific scenarios (GDPR pseudonymization finding is novel).
- **Neither approach is clearly superior.** Run A preserves accuracy, Run B preserves completeness. A real agent-teams debate should achieve both.

---

## Pipeline Summary

| Phase | Duration | Model | Turns | Tools | Output |
|-------|----------|-------|-------|-------|--------|
| Generate (4 parallel) | 427s | sonnet | 190 | 174 | 179KB (4 plans) |
| Evaluate | ~2 min | sonnet | — | — | 10KB (JSON + MD) |
| Merge Run A (collapsed) | ~9 min | sonnet | 23 | 10 | 49KB |
| Verify+PM Run A | ~2 min | sonnet | — | — | 16KB |
| Merge Run B (subagents) | ~10 min | sonnet | 30 | 5+ | 58KB |
| Verify+PM Run B | ~2 min | sonnet | — | — | 15KB |
| **Total (both runs)** | **~32 min** | | | | |

### Token usage (generation phase only — from monitor)

| Metric | Value |
|--------|-------|
| Input tokens | 26K |
| Output tokens | 977 |
| Cache write | 819K |
| Cache read | 7.9M |
| **Total** | **8.8M** |

---

## Key Observations

1. **Sonnet cannot reliably execute agent-teams merge.** Two attempts produced two different failure modes. The prompt says "Create an agent team" but Sonnet interprets this as either (a) role-playing advocates sequentially in one context, or (b) spawning independent subagents via the Agent tool. Neither achieves the intended TeamCreate-based multi-agent debate.

2. **Generation quality is excellent with Sonnet.** Plans are detailed (36-52KB), reference actual DayTrader classes and JPA annotations, and show healthy lens diversity (mean Jaccard ~1.3%). Sonnet's limitation is specifically in multi-agent orchestration, not in individual plan generation.

3. **Lens diversity produces complementary coverage.** Near-zero Jaccard confirms structurally different plans. No single lens covers all dimensions — 02-reliability is closest (5/5) but each lens contributes unique strengths.

4. **Disagreement classification is dominated by complementary (3/5).** Matches the NIER paper case study pattern. Only 1 genuine trade-off and 1 arbitrary divergence out of 5 dimensions.

5. **Pre-mortem catches what verify misses.** Run A found a TTL contradiction missed by CONSISTENCY gate. Run B found a GDPR pseudonymization vulnerability. Both add genuine value beyond the 4 quality gates.

6. **Completeness gate remains the hardest to pass.** Same pattern as the NIER paper case study — merge compression drops domain-specific details. This is consistent across both merge approaches and across both case studies.

7. **Independent subagents produce different trade-offs than collapsed role-play.** Subagents preserve more content (fewer completeness failures) but lose inter-agent validation (factual accuracy error). Neither is a substitute for genuine debate.
