#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Integration test — validates Claude Code permission modes.
#
# Can be run from inside Claude Code (unsets CLAUDECODE env var).
# Also works in a regular terminal.
#
# Requires: claude CLI on PATH, ANTHROPIC_API_KEY set.
# Cost: ~$0.02 (4 haiku calls, ~100 tokens each).
# Run:  ./test/validate-permissions.sh
#
# What this validates:
#   1. --permission-mode dontAsk: text-only works, tools are auto-denied
#   2. --permission-mode acceptEdits: Write tool auto-approved, Bash blocked
#
# These results determine whether we can safely replace
# --dangerously-skip-permissions in the production scripts.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# Allow running from within a Claude Code session.
unset CLAUDECODE 2>/dev/null || true

PASS=0
FAIL=0
TMPDIR_BASE=$(mktemp -d)
TIMEOUT_SECS=30

cleanup() {
  rm -rf "${TMPDIR_BASE}"
}
trap cleanup EXIT

_result() {
  local status="$1" name="$2"
  if [[ "${status}" == "PASS" ]]; then
    echo "  ✓ ${name}"
    ((PASS++))
  else
    echo "  ✗ ${name}"
    shift 2
    echo "    $*"
    ((FAIL++))
  fi
}

# ─── Preflight ────────────────────────────────────────────────────────────────

if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: claude CLI not found on PATH."
  exit 1
fi

echo "── Permission mode validation tests ──"
echo "   Model: haiku | Timeout: ${TIMEOUT_SECS}s per test"
echo ""

# ─── Test 1: dontAsk mode — text-only completion works ────────────────────────
# Validates: invocations 1, 5, 6, 7 can use dontAsk instead of bypass.
# dontAsk auto-denies tools but text completion still works.
# Expected: succeeds, output contains "HELLO".

test1_name="dontAsk: text-only completion works"
test1_stdout="${TMPDIR_BASE}/test1.out"
echo -n "  Running test 1/4..."
timeout --foreground "${TIMEOUT_SECS}" \
  claude -p "Reply with exactly one word: HELLO. No other text." \
  --model haiku \
  --output-format text \
  --max-turns 1 \
  --permission-mode dontAsk \
  >"${test1_stdout}" 2>/dev/null || true
echo -ne "\r                       \r"

if grep -qi "HELLO" "${test1_stdout}" 2>/dev/null; then
  _result "PASS" "${test1_name}"
else
  _result "FAIL" "${test1_name}" "Expected HELLO, got: $(head -c 200 "${test1_stdout}" 2>/dev/null)"
fi

# ─── Test 2: dontAsk mode — Write tool is auto-denied ─────────────────────────
# Validates: in dontAsk mode, Claude cannot write files.
# Expected: file is NOT created, Claude responds with text instead.

test2_file="${TMPDIR_BASE}/test2-write-blocked.txt"
test2_name="dontAsk: Write tool is auto-denied"
echo -n "  Running test 2/4..."
timeout --foreground "${TIMEOUT_SECS}" \
  claude -p "Use the Write tool to create ${test2_file} with content TEST. If you cannot, say BLOCKED." \
  --model haiku \
  --output-format text \
  --max-turns 2 \
  --permission-mode dontAsk \
  >"${TMPDIR_BASE}/test2.out" 2>/dev/null || true
echo -ne "\r                       \r"

if [[ ! -f "${test2_file}" ]]; then
  _result "PASS" "${test2_name}"
else
  rm -f "${test2_file}"
  _result "FAIL" "${test2_name}" "File was created — Write tool was NOT blocked"
fi

# ─── Test 3: acceptEdits mode — Write tool auto-approved ──────────────────────
# Validates: invocation 4 (simple merge) can use --permission-mode acceptEdits.
# Expected: file created with content.

test3_file="${TMPDIR_BASE}/test3-accept-edits.txt"
test3_name="acceptEdits: Write tool auto-approved"
echo -n "  Running test 3/4..."
timeout --foreground "${TIMEOUT_SECS}" \
  claude -p "Use the Write tool to create the file ${test3_file} with the content: ACCEPT_EDITS_WORKS" \
  --model haiku \
  --output-format text \
  --max-turns 3 \
  --permission-mode acceptEdits \
  >"${TMPDIR_BASE}/test3.out" 2>/dev/null || true
echo -ne "\r                       \r"

if [[ -f "${test3_file}" ]] && grep -q "ACCEPT_EDITS_WORKS" "${test3_file}"; then
  _result "PASS" "${test3_name}"
elif [[ -f "${test3_file}" ]]; then
  _result "FAIL" "${test3_name}" "File created but missing expected content"
else
  _result "FAIL" "${test3_name}" "File not created. Output: $(head -c 200 "${TMPDIR_BASE}/test3.out" 2>/dev/null)"
fi

# ─── Test 4: acceptEdits mode — Bash is NOT auto-approved ─────────────────────
# Validates: acceptEdits only covers file operations, not arbitrary Bash.
# Expected: Claude cannot run the command (auto-denied in headless mode).

test4_file="${TMPDIR_BASE}/test4-bash-blocked.txt"
test4_name="acceptEdits: Bash is NOT auto-approved"
echo -n "  Running test 4/4..."
timeout --foreground "${TIMEOUT_SECS}" \
  claude -p "Run this bash command: echo BASH_WAS_ALLOWED > ${test4_file}" \
  --model haiku \
  --output-format text \
  --max-turns 2 \
  --permission-mode acceptEdits \
  >"${TMPDIR_BASE}/test4.out" 2>/dev/null || true
echo -ne "\r                       \r"

if [[ ! -f "${test4_file}" ]]; then
  _result "PASS" "${test4_name}"
else
  rm -f "${test4_file}"
  _result "FAIL" "${test4_name}" "Bash command was executed — should have been blocked"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "── Results: ${PASS} passed, ${FAIL} failed ──"

if [[ ${FAIL} -gt 0 ]]; then
  echo ""
  echo "WARNING: Some tests failed. Review before applying permission changes."
  echo ""
  echo "Fallback: If dontAsk or acceptEdits don't work as expected,"
  echo "keep --dangerously-skip-permissions but add sandbox config."
  exit 1
fi

echo ""
echo "All tests passed — permission mode changes are safe to apply."
echo ""
echo "Permission strategy validated:"
echo "  • Text-only sessions (lens, eval, verify, pre-mortem):"
echo "      --permission-mode dontAsk"
echo "  • Write-only sessions (simple merge):"
echo "      --permission-mode acceptEdits"
echo "  • Full-access sessions (plan generation):"
echo "      --dangerously-skip-permissions (keep as-is)"
