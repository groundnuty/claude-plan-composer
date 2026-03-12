# Case Study Log: DayTrader T2 Migration — Opus Pipeline (Bash Tool)

## Overview

**Task:** Use claude-plan-composer (bash) to generate a comprehensive migration plan for the DayTrader 7 monolith-to-microservices migration.

**Experiment:** T2-DayTrader, corrected configuration (Opus generation + merge, 3-pass evaluation, agent-teams merge)

**Key finding:** Opus immediately uses TeamCreate for real multi-agent team debate. The agent-teams merge strategy works as designed with Opus, confirming that the Sonnet failures were a model capability gap.

## Configuration

- **Mode:** Multi-file (4 prompts + shared context)
- **Model:** Opus (generation + merge), Sonnet (evaluation + verify)
- **Generation config:** `projects/daytrader-t2/config.yaml` — opus, 80 turns, 3600s timeout
- **Merge config:** `projects/daytrader-t2/merge-config.yaml` — opus, 60 turns, 5400s timeout, pairwise comparison, 5 weighted dimensions
- **Evaluation:** 3 passes, majority consensus, binary scoring (Sonnet)
- **Lenses:** Maintainability (ISO 25010), Reliability (ISO 25010), Security (ISO 25010), Performance Efficiency (ISO 25010)
- **Shared context:** `prompts/00-common-context.md` (task description, codebase instructions, 5 constraints)
- **Additional dir:** `/tmp/sample.daytrader7` (cloned DayTrader 7 codebase)
- **MCP:** None (`strict_mcp: true`)
- **Tools:** Read, Glob, Bash, Write, WebFetch, WebSearch
- **Merge prompt enhancement:** Explicit TeamCreate enforcement + system prompt (applied after Sonnet experiment)

## Artifact Inventory

All artifacts in `generated-plans/multi-052706/20260312-052706/`:

| File | Size | Lines | Description |
|------|------|-------|-------------|
| `plan-01-maintainability.md` | 34KB | 673 | DDD analysis, aggregate roots, bounded contexts |
| `plan-01-maintainability.log` | 870KB | — | Full session log (NDJSON) |
| `plan-02-reliability.md` | 39KB | 713 | SPOF analysis, saga compensation, rollback architecture |
| `plan-02-reliability.log` | 435KB | — | Full session log |
| `plan-03-security.md` | 39KB | 686 | GDPR architecture, Vault HA, security headers |
| `plan-03-security.log` | 828KB | — | Full session log |
| `plan-04-performance.md` | 33KB | 662 | Hot-path analysis, HPA, CQRS, benchmark methodology |
| `plan-04-performance.log` | 639KB | — | Full session log |
| `evaluation-sonnet.json` | 7.1KB | — | Structured coverage matrix (binary, 3-pass majority) |
| `evaluation-sonnet.md` | 2.3KB | — | Human-readable evaluation summary |
| `merge-prompt.md` | ~5.5KB | — | Generated agent-teams merge prompt (with TeamCreate enforcement) |
| `merged-plan.md` | 57KB | — | Final merged plan (real team debate + synthesis) |
| `verification-report.md` | 2.8KB | — | 4-gate results (run twice — see note) |
| `pre-mortem.md` | ~8KB | — | 5 failure scenarios |
| **Total plans** | **145KB** | **2,734** | (4 individual plans) |
| **Total logs** | **2.8MB** | — | (4 generation logs) |

---

## Step 1: Generation (4 lenses, parallel, Opus)

**Date:** 2026-03-12 05:27
**Duration:** 395 seconds (~6.5 minutes)
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
| 01-maintainability | 34KB | 673 | 62 | 55 | 155 | 418 | 483K | 1.7M | 2.2M | 93K (46%) |
| 02-reliability | 39KB | 713 | 49 | 46 | 219 | 132 | 250K | 2.3M | 2.5M | 38K (19%) |
| 03-security | 39KB | 686 | 109 | 102 | 23K | 430 | 426K | 4.5M | 5.0M | 62K (30%) |
| 04-performance | 33KB | 662 | 38 | 28 | 48 | 255 | 366K | 1.8M | 2.1M | 104K (52%) |
| **Totals** | **145KB** | **2,734** | **258** | **231** | **24K** | **1K** | **1.5M** | **10.3M** | **11.8M** | |

### Tool usage per lens

| Lens | Read | Bash | Glob | Grep | Agent | Write |
|------|------|------|------|------|-------|-------|
| 01-maintainability | 37 | 11 | 4 | — | 2 | 1 |
| 02-reliability | 26 | 15 | 3 | — | 1 | 1 |
| 03-security | 53 | 29 | 15 | — | 2 | 1 |
| 04-performance | 19 | 7 | — | 1 | — | 1 |

**Observations:**
- All 4 lenses completed well within the 3600s timeout (395s total)
- Security lens was again most thorough (109 turns, 102 tools) — consistent with Sonnet run
- Performance lens was again most efficient (38 turns, 28 tools) — consistent with Sonnet run
- Opus generation is comparable speed to Sonnet (395s vs 427s) — surprising, likely due to caching
- Plan sizes slightly smaller than Sonnet (145KB vs 179KB) but similar line counts and depth
- All lenses used Read(19-53) — confirms codebase exploration as instructed

**Cross-model comparison (generation):**

| Metric | Sonnet | Opus |
|--------|--------|------|
| Duration | 427s | 395s |
| Total plans | 179KB, 4,016 lines | 145KB, 2,734 lines |
| Total turns | 190 | 258 |
| Total tools | 174 | 231 |
| Total tokens | 8.8M | 11.8M |
| Security turns | 57 | 109 |

Opus uses more turns and tools (deeper exploration) but produces slightly more concise plans. The additional exploration is visible in the security lens (109 vs 57 turns).

---

## Step 2: Evaluation (Jaccard + LLM binary scoring, 3-pass)

**Date:** 2026-03-12 ~05:35
**Model:** Sonnet (3 passes, majority consensus)

### Jaccard similarity (section headings)

| Pair | Overlap |
|------|---------|
| 01-maintainability ↔ 02-reliability | 0% |
| 01-maintainability ↔ 03-security | 0% |
| 01-maintainability ↔ 04-performance | 0% |
| 02-reliability ↔ 03-security | 0% |
| 02-reliability ↔ 04-performance | 0% |
| 03-security ↔ 04-performance | 0% |

**Mean Jaccard:** 0% — completely distinct section structures across all lenses.

### Coverage matrix (binary scoring, 5 dimensions × 4 plans, 3-pass majority)

| Dimension (weight) | 01-maintainability | 02-reliability | 03-security | 04-performance |
|---------------------|:--:|:--:|:--:|:--:|
| Service decomposition (0.25) | PASS | PASS | PASS | PASS |
| Data migration (0.20) | PASS | PASS | FAIL | PASS |
| Risk mitigation (0.20) | FAIL | PASS | FAIL | FAIL |
| Deployment & ops (0.20) | PASS | PASS | PASS | PASS |
| Feasibility (0.15) | PASS | PASS | PASS | PASS |
| **Pass rate** | **4/5** | **5/5** | **3/5** | **4/5** |

### Per-plan strengths

| Plan | Strongest dimensions |
|------|---------------------|
| 01-maintainability | Service decomposition, Data migration |
| 02-reliability | Service decomposition, Data migration |
| 03-security | Service decomposition, Deployment & ops |
| 04-performance | Service decomposition, Data migration |

**Key finding — Lens diversity is prompt-driven, not model-driven:**
The coverage matrix is nearly identical to the Sonnet run:
- Reliability is again the only 5/5 plan
- Security is again the weakest (3/5)
- Risk mitigation is again the weakest dimension
- Service decomposition and feasibility are again universally strong

This validates that lens diversity comes from the ISO 25010 analytical framing, not from model reasoning capability.

---

## Step 3: Merge (agent-teams, Opus — real TeamCreate debate)

**Date:** 2026-03-12 ~05:40–05:48 (7m 27s)
**Mode:** agent-teams with real TeamCreate
**Model:** Opus

### Critical finding: Opus uses TeamCreate immediately

On the first turn, the Opus merge agent:
1. Fetched the TeamCreate tool schema
2. Created a real 4-advocate team
3. Assigned tasks via TaskUpdate
4. Coordinated debate via SendMessage

This is the **first successful agent-teams merge** in the DayTrader T2 experiment, after two Sonnet failures (collapsed role-play and independent subagents).

### Merge metrics

| Metric | Value |
|--------|-------|
| Duration | 7m 27s |
| Turns | 70 |
| Tools | 31 — TaskUpdate(8), Read(6), SendMessage(5), Agent(+) |
| Output | 57KB |

### Team debate structure

The merge executed 3 tasks in sequence:
1. **Task 1: Advocate presentations** — each advocate read their plan and presented strengths/weaknesses
2. **Task 2: Structured debate** — dimension-by-dimension debate with real inter-agent messages
3. **Task 3: Comparison table + merged plan** — synthesis and Write to output file

All 4 advocates shut down gracefully after the plan was written.

### Dimension-by-dimension debate resolution

| Dimension | Resolution |
|-----------|------------|
| Service decomposition | 6 services (5 core + Market Data). Keycloak/Vault/Audit are infrastructure, not custom services. |
| Saga pattern | **Orchestration won 3-1** (auditability for SEC/MiFID II compliance). Reliability's idempotency/DLQ patterns adopted. |
| Inter-service protocol | **Hybrid** — gRPC for hot path (Quote, saga calls), REST at API Gateway edge. |
| Data migration | Denormalize userID, CQRS/Redis for Quote, even/odd IDs during transition → Snowflake post-migration. |
| Sequencing | **28 weeks** — Phase 0 security hardening → Quote+MktData → Account → Order+Orchestrator → Portfolio → Settlement+Decom. |

**Notable:** The saga debate (orchestration vs choreography) produced a **3-1 vote** — a genuine resolution that could not have emerged from single-agent role-play. The losing advocate (choreography) had its idempotency patterns adopted despite losing the vote — demonstrating real debate synthesis.

### Merged plan structure

The merged plan (57KB) includes:
- Full debate summary with per-advocate positions and vote counts
- 6-service decomposition with class-to-service mapping
- Orchestrated saga design with idempotency/DLQ from reliability
- Hybrid gRPC/REST protocol with explicit hot-path rationale
- CQRS for Quote Service with Redis L1 + PostgreSQL L2
- GDPR compliance architecture (erasure saga, Vault transit, audit trail)
- COBOL adapter design for settlement system
- Kubernetes deployment specs (HPA, PDB, resource limits)
- 28-week implementation sequence across 5 phases
- Risk register with likelihood/impact/mitigation
- `[Source: variant-name]` attributions

---

## Step 4: Verification (4 gates)

**Important note:** Verify was run twice (once standalone, once with --pre-mortem). The two runs gave different results, demonstrating Sonnet verify variance.

### Verify Run 1 (standalone)

**Date:** 2026-03-12 ~05:50

| Gate | Result | Summary |
|------|--------|---------|
| 1. CONSISTENCY | **PASS** | No contradictions. Orchestration pattern used consistently. Circuit breaker thresholds match. |
| 2. COMPLETENESS | **FAIL** | 3 dropped items |
| 3. ACTIONABILITY | **PASS** | All 17 sections have concrete next steps, owner assignments, effort estimates. |
| 4. FACTUAL ACCURACY | **PASS** | No citation errors. Technology references verified correct. |

**Completeness failures (Run 1 — 3 items):**

| # | Dropped Item | Source Lens |
|---|-------------|-------------|
| 1 | CSRF tokens + CSP/security headers (Phase 0) | Security |
| 2 | API versioning & backward compatibility rules | Maintainability |
| 3 | Performance testing methodology (baseline + scaling) | Performance |

### Verify Run 2 (with --pre-mortem)

**Date:** 2026-03-12 ~06:00

| Gate | Result | Summary |
|------|--------|---------|
| 1. CONSISTENCY | **PASS** | Same as Run 1 |
| 2. COMPLETENESS | **FAIL** | 4 dropped items (added XSS mitigation, CompleteOrderThread race condition) |
| 3. ACTIONABILITY | **PASS** | Same as Run 1 |
| 4. FACTUAL ACCURACY | **FAIL** | Confluent Cluster Linking "synchronous mode" claim flagged as incorrect |

**Completeness failures (Run 2 — 4 items):**

| # | Dropped Item | Source Lens |
|---|-------------|-------------|
| 1 | CSRF tokens + CSP/security headers (Phase 0) | Security |
| 2 | XSS mitigation (toHTML() methods) | Security |
| 3 | `CompleteOrderThread` race condition | Reliability |
| 4 | API versioning & backward compatibility rules | Maintainability |

**Factual accuracy failure (Run 2):**
- "Confluent Cluster Linking synchronous mode" — the verify agent claims this feature doesn't exist. This may or may not be a valid finding (requires external verification).

### Verify variance analysis

Two runs of the same verification on the same merged plan produced:
- Run 1: 3/4 PASS (3 completeness failures)
- Run 2: 2/4 PASS (4 completeness failures + 1 factual accuracy failure)

This demonstrates that **Sonnet verify is non-deterministic**. The completeness gate found different items in each run, and the factual accuracy gate flipped from PASS to FAIL. This is the same variance issue that motivated 3-pass majority for evaluation — the verify phase should also use multi-pass consensus in future versions.

---

## Step 5: Pre-mortem (5 failure scenarios)

**Date:** 2026-03-12 ~06:05

| # | Failure | Responsible Section | Core Issue |
|---|---------|-------------------|------------|
| 1 | **Derby has no CDC support — Debezium can't tap it** | Section 2.5 (Data Migration) | Plan assumes Debezium CDC but Derby is an embedded DB with no binlog/WAL |
| 2 | Partial saga enablement creates financial split-brain | Section 10 (Sequencing) + Section 17 (Feature Flags) | No flag compatibility matrix; partial flag states create inconsistent balances |
| 3 | GDPR erasure fails on non-user-keyed Kafka topics | Section 5.3 (Right to Erasure) | Tombstones only work when partition key = userId; order/audit topics use other keys |
| 4 | Idempotency key collision after orchestrator pod restart | Section 4.3 (Orchestrator Design) | Order ID assigned too late; no client-side idempotency key |
| 5 | BCrypt "on next login" leaves 34% accounts plaintext for months | Section 10 Phase 0 Task 1 | Lazy migration creates indefinite vulnerability window |

### Pre-mortem quality assessment

**Scenario 1 (Derby CDC) is the highest-value finding across all runs.** It identifies a fundamental architectural assumption error: the entire dual-write/CDC strategy assumes a database that supports WAL-based change data capture, but DayTrader uses Apache Derby — an embedded Java database with no WAL, no binlog, and no Debezium connector. This would halt Phase 3 entirely. No previous run (Sonnet collapsed, Sonnet subagents) found this.

**Scenario 2 (flag compatibility matrix)** is novel — identifies that feature flag combinations can create invalid states during canary rollout.

**Scenario 3 (Kafka GDPR)** is technically sophisticated — correctly identifies that log compaction + non-user partition keys = permanent PII retention, and proposes crypto-shredding as the mitigation.

**Scenario 4 (idempotency key)** identifies a subtle timing issue in the orchestration pattern that the debate's 3-1 vote for orchestration didn't surface.

**Scenario 5 (BCrypt)** is consistent across all runs — the "migrate on next login" pattern is universally identified as dangerous.

---

## Pipeline Summary

| Phase | Duration | Model | Turns | Tools | Output |
|-------|----------|-------|-------|-------|--------|
| Generate (4 parallel) | 395s | opus | 258 | 231 | 145KB (4 plans) |
| Evaluate (3-pass) | ~3 min | sonnet | — | — | 9KB (JSON + MD) |
| Merge (agent-teams) | 447s | opus | 70 | 31 | 57KB (merged plan) |
| Verify (2 runs) | ~4 min | sonnet | — | — | 3KB (report) |
| Pre-mortem | ~2 min | sonnet | — | — | 8KB |
| **Total** | **~22 min** | | **328+** | **262+** | **222KB** |

### Token usage (generation phase only — from monitor)

| Metric | Value |
|--------|-------|
| Input tokens | 24K |
| Output tokens | 1K |
| Cache write | 1.5M |
| Cache read | 10.3M |
| **Total** | **11.8M** |

---

## Key Observations

1. **Opus uses TeamCreate immediately.** On the first turn, Opus fetched the TeamCreate tool and created a real 4-advocate team. This is the behavior the prompt intended. Sonnet never achieved this in 2 attempts.

2. **Real team debate produces genuine resolutions.** The saga pattern vote (orchestration 3-1, with choreography's idempotency patterns adopted) is a resolution that single-agent role-play cannot produce. The losing advocate's contributions were preserved — this is the debate's core value.

3. **Lens diversity is prompt-driven, not model-driven.** Coverage matrices are nearly identical between Sonnet and Opus runs. Same strongest lens (reliability 5/5), same weakest lens (security 3/5), same weakest dimension (risk mitigation). The ISO 25010 decomposition drives diversity, not model capability.

4. **Sonnet verify is non-deterministic.** Two runs on the same plan produced different results (3/4 vs 2/4). Completeness items and factual accuracy judgments vary between runs. Multi-pass consensus (like evaluation) should be applied to verification.

5. **Pre-mortem quality improves with real team debate.** The Derby CDC finding (Scenario 1) is the most architecturally significant pre-mortem result across all runs. It identifies a fundamental assumption error that would halt the migration.

6. **Completeness remains the hardest gate.** 3-4 items dropped even with real team debate. Consistent across all runs (Sonnet collapsed: 8, Sonnet subagents: 3, Opus teams: 3-4) and both case studies (NIER, DayTrader).

7. **Opus generation is surprisingly fast.** 395s vs Sonnet's 427s — comparable speed despite being the more capable model. Token usage is higher (11.8M vs 8.8M) but wall-clock time is similar, likely due to caching efficiency.
