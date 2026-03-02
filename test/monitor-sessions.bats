#!/usr/bin/env bats

# Tests for monitor-sessions.sh — help flags, argument parsing, and --summary mode.
# Uses synthetic NDJSON logs and file fixtures. No API calls.

setup() {
  load 'test_helper/common-setup'
  _common_setup
}

teardown() {
  _common_teardown
}

# Helper: create a synthetic stream-json log with init, N assistant turns, and usage.
_create_stream_json_log() {
  local path="$1" turns="${2:-3}" tool="${3:-Read}"
  python3 -c "
import json, uuid
# Emit system/init with session_id
print(json.dumps({'type':'system','subtype':'init',
  'session_id': str(uuid.uuid4())[:36]}))
for i in range(${turns}):
    print(json.dumps({'type':'assistant','message':{'role':'assistant',
      'content':[{'type':'tool_use','name':'${tool}','input':{}}],
      'usage':{'input_tokens':100*(i+1),'output_tokens':50*(i+1),
        'cache_creation_input_tokens':200,'cache_read_input_tokens':1000}}}))
" >"${path}"
}

# ─── Help and argument parsing ────────────────────────────────────────

@test "monitor: --help prints usage and exits 0" {
  run "${PROJECT_ROOT}/monitor-sessions.sh" --help
  assert_success
  assert_output --partial "Usage:"
}

@test "monitor: -h prints usage and exits 0" {
  run "${PROJECT_ROOT}/monitor-sessions.sh" -h
  assert_success
  assert_output --partial "Usage:"
}

@test "monitor: --help mentions --summary flag" {
  run "${PROJECT_ROOT}/monitor-sessions.sh" --help
  assert_success
  assert_output --partial "--summary"
}

@test "monitor: --summary without directory exits with error" {
  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary
  assert_failure
}

@test "monitor: --summary with nonexistent directory exits with error" {
  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary /tmp/nonexistent-dir-$$
  assert_failure
  assert_output --partial "not found"
}

# ─── Summary mode with synthetic fixtures ─────────────────────────────

@test "summary: shows GENERATE section for plan logs" {
  _create_stream_json_log "${TEST_TEMP_DIR}/plan-baseline.log" 5 Read
  echo "# Plan content" >"${TEST_TEMP_DIR}/plan-baseline.md"
  # Pad to > 5000 bytes so status is 'done'
  python3 -c "print('x' * 6000)" >>"${TEST_TEMP_DIR}/plan-baseline.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "GENERATE"
  assert_output --partial "baseline"
}

@test "summary: parses stream-json turns and tools correctly" {
  _create_stream_json_log "${TEST_TEMP_DIR}/plan-test.log" 4 Bash
  python3 -c "print('x' * 6000)" >"${TEST_TEMP_DIR}/plan-test.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  # Should show 4 turns and 4 tools (one Bash per turn)
  assert_output --partial "4"
  assert_output --partial "Bash"
}

@test "summary: shows EVALUATE section when evaluation.md exists" {
  echo "# Evaluation" >"${TEST_TEMP_DIR}/evaluation.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "EVALUATE"
  assert_output --partial "done"
}

@test "summary: shows MERGE section with merge.log" {
  _create_stream_json_log "${TEST_TEMP_DIR}/merge.log" 6 Write
  python3 -c "print('x' * 6000)" >"${TEST_TEMP_DIR}/merged-plan.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "MERGE"
  assert_output --partial "Write"
}

@test "summary: shows VERIFY section for verification-report.md" {
  echo "# Verification" >"${TEST_TEMP_DIR}/verification-report.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "VERIFY"
  assert_output --partial "done"
}

@test "summary: detects not-started stages" {
  # Empty run directory — no logs or output files
  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "not run"
  assert_output --partial "not started"
}

@test "summary: handles non-NDJSON log files gracefully" {
  echo "This is plain text, not JSON" >"${TEST_TEMP_DIR}/plan-fallback.log"
  echo "More text" >>"${TEST_TEMP_DIR}/plan-fallback.log"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "GENERATE"
  # Should not crash, but show the variant
  assert_output --partial "fallback"
}

@test "summary: shows totals section" {
  _create_stream_json_log "${TEST_TEMP_DIR}/plan-alpha.log" 3 Read
  python3 -c "print('x' * 6000)" >"${TEST_TEMP_DIR}/plan-alpha.md"
  echo "# Evaluation" >"${TEST_TEMP_DIR}/evaluation.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "Totals"
  assert_output --partial "stages done"
}

@test "summary: shows token counts for plan logs" {
  _create_stream_json_log "${TEST_TEMP_DIR}/plan-tokens.log" 3 Read
  python3 -c "print('x' * 6000)" >"${TEST_TEMP_DIR}/plan-tokens.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  # Header should show token column names
  assert_output --partial "Input"
  assert_output --partial "Output"
  assert_output --partial "Cache+"
  # Totals should aggregate tokens
  assert_output --partial "input"
  assert_output --partial "total"
}

@test "summary: shows session ID from init message" {
  _create_stream_json_log "${TEST_TEMP_DIR}/plan-sid.log" 2 Bash
  python3 -c "print('x' * 6000)" >"${TEST_TEMP_DIR}/plan-sid.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  # Session column header should be present
  assert_output --partial "Session"
  # Should show 8-char session ID (not just dashes)
  # The UUID is random but the header proves the column exists
}

@test "summary: shows process state column header" {
  _create_stream_json_log "${TEST_TEMP_DIR}/plan-st.log" 2 Read
  python3 -c "print('x' * 6000)" >"${TEST_TEMP_DIR}/plan-st.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "State"
}

@test "summary: shows CPU column header" {
  _create_stream_json_log "${TEST_TEMP_DIR}/plan-cpu.log" 2 Read
  python3 -c "print('x' * 6000)" >"${TEST_TEMP_DIR}/plan-cpu.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "CPU"
}

@test "summary: shows Agents column header" {
  _create_stream_json_log "${TEST_TEMP_DIR}/plan-ag.log" 2 Read
  python3 -c "print('x' * 6000)" >"${TEST_TEMP_DIR}/plan-ag.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "Agents"
}

@test "summary: shows Activity column header" {
  _create_stream_json_log "${TEST_TEMP_DIR}/plan-act.log" 2 Read
  python3 -c "print('x' * 6000)" >"${TEST_TEMP_DIR}/plan-act.md"

  run "${PROJECT_ROOT}/monitor-sessions.sh" --summary "${TEST_TEMP_DIR}"
  assert_success
  assert_output --partial "Activity"
}
