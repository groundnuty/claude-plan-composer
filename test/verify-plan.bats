#!/usr/bin/env bats

# Tests for verify-plan.sh — argument parsing and input validation.

setup() {
  load 'test_helper/common-setup'
  _common_setup
}

teardown() {
  _common_teardown
}

# ─── Argument parsing ────────────────────────────────────────────────────

@test "exits with usage when no arguments given" {
  run "${PROJECT_ROOT}/verify-plan.sh"
  assert_failure
  assert_output --partial "Usage:"
}

@test "exits with error when plans directory does not exist" {
  run "${PROJECT_ROOT}/verify-plan.sh" "/nonexistent/path"
  assert_failure
}

@test "exits with error when merged-plan.md is missing" {
  mkdir -p "${TEST_TEMP_DIR}/plans"
  python3 -c "print('# Plan A\n' + '## Section\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/plan-alpha.md"
  python3 -c "print('# Plan B\n' + '## Section\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/plan-beta.md"

  run "${PROJECT_ROOT}/verify-plan.sh" "${TEST_TEMP_DIR}/plans"
  assert_failure
  assert_output --partial "No merged-plan.md"
}

@test "exits with error when fewer than 2 source plans exist" {
  mkdir -p "${TEST_TEMP_DIR}/plans"
  echo "# Merged Plan" >"${TEST_TEMP_DIR}/plans/merged-plan.md"
  echo "# Only plan" >"${TEST_TEMP_DIR}/plans/plan-only.md"

  run "${PROJECT_ROOT}/verify-plan.sh" "${TEST_TEMP_DIR}/plans"
  assert_failure
  assert_output --partial "Need at least 2 source plan files"
}

@test "rejects unknown flags" {
  run "${PROJECT_ROOT}/verify-plan.sh" "--unknown" "."
  assert_failure
  assert_output --partial "Unknown flag"
}

@test "accepts --pre-mortem flag" {
  mkdir -p "${TEST_TEMP_DIR}/plans"
  python3 -c "print('# Merged\n' + '## Section\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/merged-plan.md"
  python3 -c "print('# Plan A\n' + '## Section\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/plan-alpha.md"
  python3 -c "print('# Plan B\n' + '## Section\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/plan-beta.md"

  # Will fail on claude call but should accept the flag
  run "${PROJECT_ROOT}/verify-plan.sh" "--pre-mortem" "${TEST_TEMP_DIR}/plans"

  # Should get past argument parsing (won't say "Unknown flag")
  refute_output --partial "Unknown flag"
  # Should reach the verification step (shows model name)
  assert_output --partial "Verifying merged plan"
}
