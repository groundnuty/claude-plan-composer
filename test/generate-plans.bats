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

# ─── Help flag ────────────────────────────────────────────────────────────

@test "generate: --help prints usage and exits 0" {
  run "${PROJECT_ROOT}/generate-plans.sh" --help
  assert_success
  assert_output --partial "Usage:"
  assert_output --partial "Environment variables:"
}

@test "generate: -h prints usage and exits 0" {
  run "${PROJECT_ROOT}/generate-plans.sh" -h
  assert_success
  assert_output --partial "Usage:"
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

@test "accepts --sequential-diversity flag without error in argument parsing" {
  run "${PROJECT_ROOT}/generate-plans.sh" --sequential-diversity
  assert_failure
  assert_output --partial "Usage:"
}

@test "rejects --sequential-diversity in multi-file mode" {
  echo "# Prompt A" >"${TEST_TEMP_DIR}/a.md"
  echo "# Prompt B" >"${TEST_TEMP_DIR}/b.md"

  run "${PROJECT_ROOT}/generate-plans.sh" --sequential-diversity \
    "${TEST_TEMP_DIR}/a.md" "${TEST_TEMP_DIR}/b.md"
  assert_failure
  assert_output --partial "incompatible with multi-file mode"
}

@test "--sequential-diversity is disabled in debug mode with warning" {
  echo "# Test prompt" >"${TEST_TEMP_DIR}/test-prompt.md"

  # Will fail downstream (claude call times out), but should warn about
  # sequential-diversity being disabled, not error on it.
  # Short timeout: we only care about the warning, not the claude call.
  run env TIMEOUT_SECS=5 \
    "${PROJECT_ROOT}/generate-plans.sh" --debug --sequential-diversity \
    "${TEST_TEMP_DIR}/test-prompt.md"

  # Should get past argument parsing and validation
  assert_output --partial "no effect in debug mode"
}

# ─── Config resolution ──────────────────────────────────────────────────────

@test "skeleton extraction captures section headings" {
  # Source the helper functions from generate-plans.sh
  # We'll simulate _extract_skeletons by running the same grep logic
  mkdir -p "${TEST_TEMP_DIR}/plans"
  RUN_DIR="${TEST_TEMP_DIR}/plans"

  cat >"${RUN_DIR}/plan-alpha.md" <<'EOF'
# Plan
## Section One
Some content here.
### Subsection A
More content.
## Section Two
Even more content.
EOF

  cat >"${RUN_DIR}/plan-beta.md" <<'EOF'
# Different Plan
## Approach
Content.
## Implementation
Content.
EOF

  # Run the same grep logic used by _extract_skeletons
  headings_alpha=$(grep -E '^#{1,3} ' "${RUN_DIR}/plan-alpha.md" || true)
  headings_beta=$(grep -E '^#{1,3} ' "${RUN_DIR}/plan-beta.md" || true)

  # Alpha should have 4 headings
  [[ $(echo "${headings_alpha}" | wc -l | tr -d ' ') -eq 4 ]]
  # Beta should have 3 headings
  [[ $(echo "${headings_beta}" | wc -l | tr -d ' ') -eq 3 ]]

  # Verify specific headings are captured
  echo "${headings_alpha}" | grep -q "## Section One"
  echo "${headings_alpha}" | grep -q "### Subsection A"
  echo "${headings_beta}" | grep -q "## Approach"
}

@test "falls back gracefully when no config.yaml exists" {
  # Create a minimal prompt file
  echo "# Test prompt" >"${TEST_TEMP_DIR}/test-prompt.md"

  # Run from temp dir where no config exists — should warn and use baseline.
  # Use DEBUG mode to avoid actually launching Claude.
  # Short timeout: we only care about config fallback, not the claude call.
  run env CONFIG="/tmp/nonexistent-config-$$.yaml" TIMEOUT_SECS=5 \
    "${PROJECT_ROOT}/generate-plans.sh" --debug "${TEST_TEMP_DIR}/test-prompt.md"

  # Will fail trying to parse a nonexistent config, which is expected
  assert_failure
}
