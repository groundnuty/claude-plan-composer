#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Verify a merged plan against quality gates.
#
# Three quality gates:
#   Gate 1: CONSISTENCY — internal contradictions in the merged plan
#   Gate 2: COMPLETENESS — content lost from source plans during merge
#   Gate 3: ACTIONABILITY — each section has concrete next steps
#
# Optionally runs a pre-mortem analysis (--pre-mortem flag).
#
# Output:
#   $RUN_DIR/verification-report.md  — gate results
#   $RUN_DIR/pre-mortem.md           — failure scenarios (if --pre-mortem)
#
# Exit codes:
#   0  — all gates pass
#   1  — one or more gates fail
#
# Usage:
#   ./verify-plan.sh generated-plans/my-prompt/latest
#   ./verify-plan.sh --pre-mortem generated-plans/latest
#   VERIFY_MODEL=haiku ./verify-plan.sh generated-plans/latest
# ─────────────────────────────────────────────────────────────────────────────

# ─── Parse arguments ─────────────────────────────────────────────────────

PRE_MORTEM=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pre-mortem)
      PRE_MORTEM=true
      shift
      ;;
    -*)
      echo "ERROR: Unknown flag: $1"
      echo "Usage: $0 [--pre-mortem] <plans-directory>"
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

RUN_DIR="${1:?Usage: $0 [--pre-mortem] <plans-directory>}"
RUN_DIR=$(cd "${RUN_DIR}" && pwd)

# ─── Validate inputs ────────────────────────────────────────────────────

merge_md="${RUN_DIR}/merged-plan.md"
if [[ ! -f "${merge_md}" ]]; then
  echo "ERROR: No merged-plan.md in ${RUN_DIR}/"
  echo "  Run ./merge-plans.sh first."
  exit 1
fi

# Find source plans
plans=()
for f in "${RUN_DIR}"/plan-*.md; do
  [[ -f "${f}" ]] || continue
  size=$(wc -c <"${f}" | tr -d ' ')
  if [[ "${size}" -gt 1000 ]]; then
    plans+=("${f}")
  fi
done

if [[ ${#plans[@]} -lt 2 ]]; then
  echo "ERROR: Need at least 2 source plan files in ${RUN_DIR}/"
  exit 1
fi

# ─── Configuration ───────────────────────────────────────────────────────

VERIFY_MODEL="${VERIFY_MODEL:-sonnet}"
TIMEOUT_SECS="${TIMEOUT_SECS:-600}"
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Verifying merged plan (${VERIFY_MODEL})"
echo "║  Merged plan: $(basename "${merge_md}")"
echo "║  Source plans: ${#plans[@]}"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Build verification prompt ───────────────────────────────────────────

VERIFY_PROMPT="You are a plan quality reviewer. Verify the merged plan against three quality gates.

## Gate 1: CONSISTENCY
Check for internal contradictions in the merged plan:
- Does any section contradict another?
- Are there conflicting recommendations?
- Are priorities inconsistent across sections?

## Gate 2: COMPLETENESS
Compare the merged plan against the source plans below:
- Are there significant insights from source plans that were lost?
- Were important risks or trade-offs dropped?
- Did any source plan cover a dimension that the merged plan ignores?

## Gate 3: ACTIONABILITY
Check that each section is executable:
- Does every section have a concrete next step?
- Are there purely aspirational sections with no actionable guidance?
- Are recommendations specific enough to act on?

## Output format

Output ONLY the following markdown structure:

# Verification Report

## Gate 1: CONSISTENCY
**Result: PASS/FAIL**
[If FAIL, list each contradiction found]

## Gate 2: COMPLETENESS
**Result: PASS/FAIL**
[If FAIL, list each lost insight with the source plan it came from]

## Gate 3: ACTIONABILITY
**Result: PASS/FAIL**
[If FAIL, list each non-actionable section]

## Summary
Gates passed: X/3
Overall: PASS/FAIL

## Merged plan to verify

$(cat "${merge_md}")

## Source plans for comparison

"

for plan_file in "${plans[@]}"; do
  variant_name=$(basename "${plan_file}" .md | sed 's/plan-//')
  VERIFY_PROMPT+="
═══════════════════════════════════════════════════════════════
SOURCE: ${variant_name}
═══════════════════════════════════════════════════════════════

$(cat "${plan_file}")

"
done

# ─── Run verification ────────────────────────────────────────────────────

echo "── Quality gates ──"

logfile="${RUN_DIR}/verify.log"
report_md="${RUN_DIR}/verification-report.md"

verify_raw=$(timeout "${TIMEOUT_SECS}" \
  claude -p "${VERIFY_PROMPT}" \
  --model "${VERIFY_MODEL}" \
  --output-format text \
  --max-turns 5 \
  --dangerously-skip-permissions \
  2>"${logfile}") || true

if [[ -n "${verify_raw}" ]]; then
  echo "${verify_raw}" >"${report_md}"
  echo "  Report: ${report_md}"

  # Parse results
  gate_failures=0
  for gate_num in 1 2 3; do
    gate_name=""
    case ${gate_num} in
      1) gate_name="CONSISTENCY" ;;
      2) gate_name="COMPLETENESS" ;;
      3) gate_name="ACTIONABILITY" ;;
      *) gate_name="UNKNOWN" ;;
    esac

    if echo "${verify_raw}" | grep -qi "Gate ${gate_num}.*FAIL"; then
      echo "  ✗ Gate ${gate_num} (${gate_name}): FAIL"
      ((gate_failures++)) || true
    elif echo "${verify_raw}" | grep -qi "Gate ${gate_num}.*PASS"; then
      echo "  ✓ Gate ${gate_num} (${gate_name}): PASS"
    else
      echo "  ? Gate ${gate_num} (${gate_name}): unclear"
    fi
  done

  echo ""
else
  echo "  ⚠ Verification failed — no response from model"
  echo "    Check: ${logfile}"
  gate_failures=1
fi

# ─── Pre-mortem analysis (optional) ──────────────────────────────────────

if [[ "${PRE_MORTEM}" = "true" ]]; then
  echo "── Pre-mortem analysis ──"

  PREMORTEM_PROMPT="Imagine it is 6 months from now. The team followed this plan exactly, and it FAILED.

Generate 5 specific, realistic failure scenarios. For each:
1. **What went wrong?** — Be specific about the failure mode
2. **Which section was responsible?** — Point to the exact section
3. **What should be added to prevent this?** — Concrete mitigation

Output as a markdown document titled '# Pre-Mortem Analysis'.

## The plan

$(cat "${merge_md}")
"

  premortem_log="${RUN_DIR}/pre-mortem.log"
  premortem_md="${RUN_DIR}/pre-mortem.md"

  premortem_raw=$(timeout "${TIMEOUT_SECS}" \
    claude -p "${PREMORTEM_PROMPT}" \
    --model "${VERIFY_MODEL}" \
    --output-format text \
    --max-turns 5 \
    --dangerously-skip-permissions \
    2>"${premortem_log}") || true

  if [[ -n "${premortem_raw}" ]]; then
    echo "${premortem_raw}" >"${premortem_md}"
    echo "  ✓ Pre-mortem: ${premortem_md}"
  else
    echo "  ⚠ Pre-mortem failed — no response from model"
    echo "    Check: ${premortem_log}"
  fi

  echo ""
fi

# ─── Exit code ────────────────────────────────────────────────────────────

if [[ "${gate_failures}" -gt 0 ]]; then
  echo "  ✗ Verification FAILED (${gate_failures} gate(s) failed)"
  exit 1
else
  echo "  ✓ All gates passed"
fi
