#!/usr/bin/env bash
set -uo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Experiment: test --output-format stream-json with the Write tool pattern.
#
# Tests:
#   1. Write tool creates the output file (not broken by stream-json)
#   2. stream-json log is valid NDJSON (parseable with jq)
#   3. Tool calls are visible in the stream (observability works)
#   4. No truncation — output matches expected size
#   5. Compare with --output-format text baseline
#
# Cost: ~$0.01 (2 haiku calls, minimal tokens)
# Duration: ~30 seconds
# Run:  ./test/experiment-stream-json.sh
# ─────────────────────────────────────────────────────────────────────────────

unset CLAUDECODE 2>/dev/null || true

TMPDIR_EXP=$(mktemp -d)
trap 'rm -rf "${TMPDIR_EXP}"' EXIT

TIMEOUT_SECS=30
MODEL=haiku
PASS=0
FAIL=0

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

if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: claude CLI not found on PATH."
  exit 1
fi

echo "── Experiment: --output-format stream-json ──"
echo "   Model: ${MODEL} | Timeout: ${TIMEOUT_SECS}s"
echo ""

# ─── Test A: baseline with --output-format text ─────────────────────────────

text_outfile="${TMPDIR_EXP}/plan-text.md"
text_log="${TMPDIR_EXP}/text.log"

PROMPT_TEXT="Write a 10-line markdown document about testing. Use the Write tool to save it to ${text_outfile}. Start with '# Testing Guide'. After writing, say DONE."

echo -n "  Running A: text baseline..."
timeout --foreground --verbose "${TIMEOUT_SECS}" \
  claude -p "${PROMPT_TEXT}" \
  --model "${MODEL}" \
  --output-format text \
  --max-turns 3 \
  --permission-mode dontAsk \
  --allowedTools "Write" \
  --setting-sources project,local \
  --disable-slash-commands \
  >"${text_log}" 2>&1 || true
echo -ne "\r                                    \r"

if [[ -f "${text_outfile}" ]]; then
  text_size=$(wc -c <"${text_outfile}" | tr -d ' ')
  _result "PASS" "text: Write tool created file (${text_size} bytes)"
else
  text_size=0
  _result "FAIL" "text: Write tool did NOT create file" "Log: $(head -c 200 "${text_log}")"
fi

# ─── Test B: stream-json with Write tool ────────────────────────────────────

sj_outfile="${TMPDIR_EXP}/plan-stream.md"
sj_log="${TMPDIR_EXP}/stream.log"

PROMPT_SJ="Write a 10-line markdown document about testing. Use the Write tool to save it to ${sj_outfile}. Start with '# Testing Guide'. After writing, say DONE."

echo -n "  Running B: stream-json..."
timeout --foreground --verbose "${TIMEOUT_SECS}" \
  claude -p "${PROMPT_SJ}" \
  --model "${MODEL}" \
  --output-format stream-json \
  --max-turns 3 \
  --permission-mode dontAsk \
  --allowedTools "Write" \
  --setting-sources project,local \
  --disable-slash-commands \
  >"${sj_log}" 2>&1 || true
echo -ne "\r                                    \r"

# Test B1: Write tool still works
if [[ -f "${sj_outfile}" ]]; then
  sj_size=$(wc -c <"${sj_outfile}" | tr -d ' ')
  _result "PASS" "stream-json: Write tool created file (${sj_size} bytes)"
else
  sj_size=0
  _result "FAIL" "stream-json: Write tool did NOT create file" "Log size: $(wc -c <"${sj_log}" | tr -d ' ') bytes"
fi

# Test B2: Log is valid NDJSON (each line parses as JSON)
sj_log_lines=$(wc -l <"${sj_log}" | tr -d ' ')
if [[ "${sj_log_lines}" -gt 0 ]]; then
  bad_lines=$(while IFS= read -r line; do
    echo "${line}" | jq . >/dev/null 2>&1 || echo "bad"
  done <"${sj_log}" | wc -l | tr -d ' ')

  if [[ "${bad_lines}" -eq 0 ]]; then
    _result "PASS" "stream-json: log is valid NDJSON (${sj_log_lines} lines)"
  else
    _result "FAIL" "stream-json: ${bad_lines}/${sj_log_lines} lines are not valid JSON"
  fi
else
  _result "FAIL" "stream-json: log is empty (0 lines)"
fi

# Test B3: Tool calls visible in stream
tool_events=$(jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | .name' "${sj_log}" 2>/dev/null | head -5)
if [[ -z "${tool_events}" ]]; then
  # Try stream_event format
  tool_events=$(jq -r '
    select(.type == "stream_event")
    | select(.event.type == "content_block_start")
    | select(.event.content_block.type == "tool_use")
    | .event.content_block.name
  ' "${sj_log}" 2>/dev/null | head -5)
fi

if [[ -n "${tool_events}" ]]; then
  _result "PASS" "stream-json: tool calls visible (${tool_events})"
else
  # Check what event types exist
  event_types=$(jq -r '.type // empty' "${sj_log}" 2>/dev/null | sort -u | head -10)
  _result "FAIL" "stream-json: no tool calls found in log" "Event types: ${event_types}"
fi

# Test B4: Output sizes comparable
if [[ "${text_size}" -gt 0 ]] && [[ "${sj_size}" -gt 0 ]]; then
  # Both should produce similar-sized files (within 5x)
  ratio=$((sj_size * 100 / text_size))
  if [[ "${ratio}" -gt 20 ]] && [[ "${ratio}" -lt 500 ]]; then
    _result "PASS" "stream-json: output size comparable (text=${text_size}, stream=${sj_size}, ratio=${ratio}%)"
  else
    _result "FAIL" "stream-json: output size mismatch" "text=${text_size}, stream=${sj_size}, ratio=${ratio}%"
  fi
fi

# ─── Test C: stream-json with larger output (truncation check) ──────────────

trunc_outfile="${TMPDIR_EXP}/plan-large.md"
trunc_log="${TMPDIR_EXP}/trunc.log"

PROMPT_TRUNC="Write a detailed 50-line markdown document about software testing best practices. Cover unit tests, integration tests, e2e tests, TDD, and mocking. Use the Write tool to save it to ${trunc_outfile}. Start with '# Software Testing Best Practices'. After writing, say DONE."

echo -n "  Running C: truncation check..."
timeout --foreground --verbose 60 \
  claude -p "${PROMPT_TRUNC}" \
  --model "${MODEL}" \
  --output-format stream-json \
  --max-turns 3 \
  --permission-mode dontAsk \
  --allowedTools "Write" \
  --setting-sources project,local \
  --disable-slash-commands \
  >"${trunc_log}" 2>&1 || true
echo -ne "\r                                    \r"

if [[ -f "${trunc_outfile}" ]]; then
  trunc_size=$(wc -c <"${trunc_outfile}" | tr -d ' ')
  trunc_lines=$(wc -l <"${trunc_outfile}" | tr -d ' ')
  if [[ "${trunc_size}" -gt 500 ]]; then
    _result "PASS" "stream-json: larger output not truncated (${trunc_lines} lines, ${trunc_size} bytes)"
  else
    _result "FAIL" "stream-json: larger output may be truncated" "${trunc_lines} lines, ${trunc_size} bytes"
  fi
else
  _result "FAIL" "stream-json: larger output file not created" "Log size: $(wc -c <"${trunc_log}" | tr -d ' ') bytes"
fi

# ─── Summary ────────────────────────────────────────────────────────────────

echo ""
echo "── Results: ${PASS} passed, ${FAIL} failed ──"
echo ""

if [[ ${FAIL} -gt 0 ]]; then
  echo "Artifacts for debugging:"
  echo "  ${TMPDIR_EXP}/"
  ls -la "${TMPDIR_EXP}/"
  echo ""
  echo "Parse stream-json log:"
  echo "  jq . ${sj_log} | head -50"
  echo "  jq -r '.type' ${sj_log} | sort | uniq -c"
  # Don't delete tmpdir on failure
  trap - EXIT
  exit 1
fi

echo "stream-json is safe to use with the Write tool pattern."
echo ""
echo "To adopt in generate-plans.sh:"
echo "  --output-format stream-json"
echo ""
echo "To monitor a running session:"
echo "  tail -f \${logfile} | jq -r 'select(.type==\"assistant\") | .message.content[]? | select(.type==\"tool_use\") | .name'"
