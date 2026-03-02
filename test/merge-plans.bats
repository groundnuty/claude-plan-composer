#!/usr/bin/env bats

# Tests for merge-plans.sh — argument parsing and input validation.

setup() {
  load 'test_helper/common-setup'
  _common_setup
}

teardown() {
  _common_teardown
}

# ─── Help flag ────────────────────────────────────────────────────────────

@test "merge-plans: --help prints usage and exits 0" {
  run "${PROJECT_ROOT}/merge-plans.sh" --help
  assert_success
  assert_output --partial "Usage:"
  assert_output --partial "MERGE_MODE"
}

@test "merge-plans: -h prints usage and exits 0" {
  run "${PROJECT_ROOT}/merge-plans.sh" -h
  assert_success
  assert_output --partial "Usage:"
}

# ─── Argument parsing ────────────────────────────────────────────────────

@test "merge-plans: exits with usage when no arguments given" {
  run "${PROJECT_ROOT}/merge-plans.sh"
  assert_failure
  assert_output --partial "Usage:"
}

@test "merge-plans: rejects unknown flags" {
  run "${PROJECT_ROOT}/merge-plans.sh" "--unknown-flag"
  assert_failure
  assert_output --partial "Unknown flag"
}

@test "merge-plans: exits with error when plans directory does not exist" {
  run "${PROJECT_ROOT}/merge-plans.sh" "/nonexistent/path"
  assert_failure
}

@test "merge-plans: exits with error when fewer than 2 plans exist" {
  mkdir -p "${TEST_TEMP_DIR}/plans"
  echo "# Short plan" >"${TEST_TEMP_DIR}/plans/plan-only.md"
  run "${PROJECT_ROOT}/merge-plans.sh" "${TEST_TEMP_DIR}/plans"
  assert_failure
  assert_output --partial "Need at least 2 plan files"
}
