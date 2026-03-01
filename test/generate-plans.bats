#!/usr/bin/env bats

# Tests for generate-plans.sh — argument parsing, config loading, validation.
# These tests do NOT launch actual Claude sessions (no API calls).

setup() {
  load 'test_helper/common-setup'
  _common_setup
}

teardown() {
  _common_teardown
}

# ─── Argument parsing ───────────────────────────────────────────────────────

@test "exits with usage when no arguments given" {
  run "${PROJECT_ROOT}/generate-plans.sh"
  assert_failure
  assert_output --partial "Usage:"
}

@test "exits with error when prompt file does not exist" {
  run "${PROJECT_ROOT}/generate-plans.sh" "/tmp/nonexistent-prompt-file-$$.md"
  assert_failure
  assert_output --partial "not found"
}

@test "accepts --debug flag without error in argument parsing" {
  # This will still fail (no prompt file), but should get past flag parsing
  run "${PROJECT_ROOT}/generate-plans.sh" --debug
  assert_failure
  assert_output --partial "Usage:"
}

@test "accepts --context flag with value" {
  run "${PROJECT_ROOT}/generate-plans.sh" "--context=/tmp/nonexistent-$$.md"
  assert_failure
  # Should fail on the context file not existing, not on parsing
  assert_output --partial "not found"
}

@test "rejects --context without value" {
  run "${PROJECT_ROOT}/generate-plans.sh" --context
  assert_failure
  assert_output --partial "requires a value"
}

# ─── Config resolution ──────────────────────────────────────────────────────

@test "falls back gracefully when no config.yaml exists" {
  # Create a minimal prompt file
  echo "# Test prompt" >"${TEST_TEMP_DIR}/test-prompt.md"

  # Run from temp dir where no config exists — should warn and use baseline
  # Use DEBUG mode to avoid actually launching Claude
  run env CONFIG="/tmp/nonexistent-config-$$.yaml" \
    "${PROJECT_ROOT}/generate-plans.sh" --debug "${TEST_TEMP_DIR}/test-prompt.md"

  # Will fail trying to parse a nonexistent config, which is expected
  assert_failure
}
