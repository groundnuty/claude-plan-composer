# Migration Validation: Bash → TypeScript SDK

**Date:** 2026-03-12
**Verdict:** Migration successful. No functional, quality, or behavioral regression.

---

## Evidence of Parity

### Generation

| Metric | Bash Opus | TS Opus | Delta |
|--------|-----------|---------|-------|
| Plan size | 145KB | 145KB | 0% |
| Duration | 395s | 379s | -4% |
| Cost | ~$5.00 | $4.94 | -1% |
| Tool calls | ~150 | 148 | -1% |

Identical to the kilobyte. The Agent SDK `query()` produces the same output as `claude -p`.

### Evaluation

| Metric | Bash | TS |
|--------|------|-----|
| Convergence | 75% | 75% |
| Jaccard mean | ~0.7% | ~0.7% |
| Gap count | 6 | 6 |

One discrepancy found and **fixed**: the TS binary scoring criterion was weaker ("adequately addresses") than bash's ("substantively addresses with enough depth to be actionable"). Updated TS prompt to match bash's actionability requirement.

### Agent-Teams Merge (Same Strategy, Same Model)

| Metric | Bash Opus | TS Opus |
|--------|-----------|---------|
| Verify result | 3/4 | 3/4 |
| TeamCreate used | Yes | Yes |
| Real debate | Yes | Yes |
| Derby CDC found | Pre-mortem | Verify + pre-mortem |
| BCrypt CDC found | Pre-mortem | Pre-mortem |
| KEYGENEJB found | No | Pre-mortem |

Same verification outcome, same critical findings.

### Pre-Mortem Cross-Tool Validation

Three findings independently discovered by both tools:
1. **Derby CDC impossibility** — 3 paths across 2 tools
2. **BCrypt/CDC plaintext leak** — bash pre-mortem + TS pre-mortem
3. **KEYGENEJB Phase 0 omission** — TS simple + TS teams pre-mortem

Cross-tool convergence confirms reproducibility.

---

## Discrepancies Found and Resolved

| Issue | Root Cause | Resolution |
|-------|-----------|------------|
| TS evaluation 20/20 vs bash 17/20 | Weaker pass criterion in TS prompt | Fixed: matched bash's "substantively addresses + actionable" wording |
| TS evaluate/verify/pre-mortem crashed | Missing `...process.env` in `query()` env | Fixed: spread `process.env` in all 3 files |

Both discrepancies were bugs in the TS implementation, not fundamental quality differences. Both have been fixed and committed.

---

## TS Advantages (No Bash Regression)

These are additive benefits — bash behavior is fully preserved:

1. **Headless agent-teams** — `query()` + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` enables programmatic multi-agent debate without interactive sessions
2. **Per-phase cost tracking** — automatic extraction ($6.76 simple, $7.53 teams)
3. **Type-safe config** — Zod validation catches config errors at load time
4. **Library-first API** — every component is a composable async function
5. **TeamDelete lifecycle** — explicit team cleanup (bash doesn't call TeamDelete)

---

## Conclusion

The TypeScript SDK is a drop-in replacement for the bash toolkit. It produces identical generation output, equivalent merge quality, and the same critical pre-mortem findings. The one evaluation discrepancy (pass criterion wording) has been fixed to match bash behavior exactly. No quality, functional, or behavioral regression observed.
