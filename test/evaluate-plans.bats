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
  # Two plans with completely different headings (simulates multi-file mode)
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
  # Near-zero overlap should get friendly message, not scary warning
  assert_output --partial "expected for multi-file mode"
  refute_output --partial "merge may need manual guidance"
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

# ─── Configuration ──────────────────────────────────────────────────

@test "eval output files are versioned by model name" {
  # evaluate-plans.sh should use evaluation-{model}.json, not evaluation.json
  run bash -c "grep 'evaluation-.*EVAL_MODEL' '${PROJECT_ROOT}/evaluate-plans.sh'"
  assert_success
}

@test "eval_passes config field is parsed from merge config" {
  run bash -c "grep -c 'EVAL_PASSES' '${PROJECT_ROOT}/evaluate-plans.sh'"
  assert_success
  [[ "${output}" -ge 3 ]]  # config parse + resolution + loop usage
}

@test "eval_consensus config field is parsed from merge config" {
  run bash -c "grep -c 'EVAL_CONSENSUS' '${PROJECT_ROOT}/evaluate-plans.sh'"
  assert_success
  [[ "${output}" -ge 3 ]]  # config parse + resolution + aggregation usage
}

@test "default EVAL_MODEL is sonnet" {
  run bash -c "grep 'EVAL_MODEL=.*:-' '${PROJECT_ROOT}/evaluate-plans.sh'"
  assert_success
  assert_output --partial "sonnet"
}

# ─── Binary scoring ─────────────────────────────────────────────────

@test "eval_scoring config field is parsed from merge config" {
  run bash -c "grep -c 'EVAL_SCORING' '${PROJECT_ROOT}/evaluate-plans.sh'"
  assert_success
  [[ "${output}" -ge 3 ]]  # config parse + resolution + prompt branch
}

@test "default EVAL_SCORING is binary" {
  run bash -c "grep 'EVAL_SCORING=.*:-' '${PROJECT_ROOT}/evaluate-plans.sh'"
  assert_success
  assert_output --partial "binary"
}

@test "binary eval prompt asks for pass/fail not strength" {
  # The binary branch of the prompt should contain 'pass' and 'critique'
  run bash -c "sed -n '/EVAL_SCORING.*binary/,/Plans to evaluate/p' '${PROJECT_ROOT}/evaluate-plans.sh'"
  assert_success
  assert_output --partial "pass"
  assert_output --partial "critique"
}

@test "likert eval prompt preserves strength scoring" {
  # The else/likert branch should contain 'strength' and '1-5'
  run bash -c "sed -n '/Legacy Likert/,/Plans to evaluate/p' '${PROJECT_ROOT}/evaluate-plans.sh'"
  assert_success
  assert_output --partial "strength"
  assert_output --partial "1-5"
}

# ─── Plan filtering ─────────────────────────────────────────────────

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
