#!/usr/bin/env bats

# Tests for evaluate-plans.sh — argument parsing, convergence check, plan validation.

setup() {
  load 'test_helper/common-setup'
  _common_setup
}

teardown() {
  _common_teardown
}

# ─── Help flag ────────────────────────────────────────────────────────────

@test "evaluate: --help prints usage and exits 0" {
  run "${PROJECT_ROOT}/evaluate-plans.sh" --help
  assert_success
  assert_output --partial "Usage:"
  assert_output --partial "EVAL_MODEL"
}

@test "evaluate: -h prints usage and exits 0" {
  run "${PROJECT_ROOT}/evaluate-plans.sh" -h
  assert_success
  assert_output --partial "Usage:"
}

# ─── Argument parsing ────────────────────────────────────────────────────

@test "exits with usage when no arguments given" {
  run "${PROJECT_ROOT}/evaluate-plans.sh"
  assert_failure
  assert_output --partial "Usage:"
}

@test "exits with error when plans directory does not exist" {
  run "${PROJECT_ROOT}/evaluate-plans.sh" "/nonexistent/path"
  assert_failure
}

@test "exits with error when fewer than 2 plans exist" {
  mkdir -p "${TEST_TEMP_DIR}/plans"
  echo "# Short plan" >"${TEST_TEMP_DIR}/plans/plan-only.md"
  run "${PROJECT_ROOT}/evaluate-plans.sh" "--no-llm" "${TEST_TEMP_DIR}/plans"
  assert_failure
  assert_output --partial "Need at least 2 plan files"
}

@test "accepts --no-llm flag" {
  mkdir -p "${TEST_TEMP_DIR}/plans"
  # Create 2 plans with >1000 bytes each
  python3 -c "print('# Plan A\n' + '## Section One\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/plan-alpha.md"
  python3 -c "print('# Plan B\n' + '## Section Two\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/plan-beta.md"

  run "${PROJECT_ROOT}/evaluate-plans.sh" "--no-llm" "${TEST_TEMP_DIR}/plans"
  assert_success
  assert_output --partial "Convergence check"
}

@test "rejects unknown flags" {
  run "${PROJECT_ROOT}/evaluate-plans.sh" "--unknown-flag" "."
  assert_failure
  assert_output --partial "Unknown flag"
}

# ─── Convergence check ───────────────────────────────────────────────────

@test "convergence check detects similar plans" {
  mkdir -p "${TEST_TEMP_DIR}/plans"
  # Two plans with identical headings
  python3 -c "
sections = ['## Architecture', '## Testing', '## Deployment']
content = '\n'.join(s + '\nDetails here.\n' * 30 for s in sections)
print('# Plan A\n' + content)
" >"${TEST_TEMP_DIR}/plans/plan-alpha.md"
  python3 -c "
sections = ['## Architecture', '## Testing', '## Deployment']
content = '\n'.join(s + '\nDifferent details.\n' * 30 for s in sections)
print('# Plan B\n' + content)
" >"${TEST_TEMP_DIR}/plans/plan-beta.md"

  run "${PROJECT_ROOT}/evaluate-plans.sh" "--no-llm" "${TEST_TEMP_DIR}/plans"
  assert_success
  assert_output --partial "100% overlap"
}

@test "convergence check detects divergent plans" {
  mkdir -p "${TEST_TEMP_DIR}/plans"
  # Two plans with completely different headings
  python3 -c "
sections = ['## API Design', '## Database Schema', '## Auth Flow']
content = '\n'.join(s + '\nDetails here.\n' * 30 for s in sections)
print('# Plan A\n' + content)
" >"${TEST_TEMP_DIR}/plans/plan-alpha.md"
  python3 -c "
sections = ['## Frontend UI', '## Monitoring', '## Cost Analysis']
content = '\n'.join(s + '\nDetails here.\n' * 30 for s in sections)
print('# Plan B\n' + content)
" >"${TEST_TEMP_DIR}/plans/plan-beta.md"

  run "${PROJECT_ROOT}/evaluate-plans.sh" "--no-llm" "${TEST_TEMP_DIR}/plans"
  assert_success
  assert_output --partial "0% overlap"
}

@test "writes evaluation.md summary" {
  mkdir -p "${TEST_TEMP_DIR}/plans"
  python3 -c "print('# Plan A\n' + '## Section One\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/plan-alpha.md"
  python3 -c "print('# Plan B\n' + '## Section Two\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/plan-beta.md"

  run "${PROJECT_ROOT}/evaluate-plans.sh" "--no-llm" "${TEST_TEMP_DIR}/plans"
  assert_success
  [[ -f "${TEST_TEMP_DIR}/plans/evaluation.md" ]]
}

@test "skips plans smaller than 1000 bytes" {
  mkdir -p "${TEST_TEMP_DIR}/plans"
  echo "# Tiny" >"${TEST_TEMP_DIR}/plans/plan-tiny.md"
  python3 -c "print('# Plan A\n' + '## Section\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/plan-alpha.md"
  python3 -c "print('# Plan B\n' + '## Section\nContent.\n' * 100)" \
    >"${TEST_TEMP_DIR}/plans/plan-beta.md"

  run "${PROJECT_ROOT}/evaluate-plans.sh" "--no-llm" "${TEST_TEMP_DIR}/plans"
  assert_success
  assert_output --partial "Skipping plan-tiny.md"
  assert_output --partial "Evaluating 2 plans"
}
