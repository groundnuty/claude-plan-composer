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

# Helper: create a synthetic stream-json log with N assistant turns using a tool.
_create_stream_json_log() {
  local path="$1" turns="${2:-3}" tool="${3:-Read}"
  python3 -c "
import json
for i in range(${turns}):
    print(json.dumps({'type':'assistant','message':{'role':'assistant',
      'content':[{'type':'tool_use','name':'${tool}','input':{}}]}}))
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
