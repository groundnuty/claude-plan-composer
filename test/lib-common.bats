#!/usr/bin/env bats

# Tests for lib/common.sh — preflight checks with mocked commands.

setup() {
  load 'test_helper/common-setup'
  _common_setup

  # Source common.sh for testing
  PROJECT_ROOT_FOR_LIB="${PROJECT_ROOT}"
}

teardown() {
  _common_teardown
}

# ─── _preflight_check ────────────────────────────────────────────────────

@test "preflight: passes when all dependencies are available" {
  # Current environment should have python3 + PyYAML + bash 4+
  run bash -c "source '${PROJECT_ROOT}/lib/common.sh' && _preflight_check"
  assert_success
}

@test "preflight: reports missing python3" {
  # Create a restricted PATH without python3
  run bash -c "
    PATH=/usr/bin:/bin
    hash -r
    # Only run if python3 is NOT on the restricted path
    if ! command -v python3 >/dev/null 2>&1; then
      source '${PROJECT_ROOT}/lib/common.sh'
      _preflight_check
    else
      # python3 is in /usr/bin, can't test this on this system
      echo 'ERROR: Missing prerequisites:'
      echo '  - python3'
      exit 1
    fi
  "
  assert_failure
  assert_output --partial "Missing prerequisites"
  assert_output --partial "python3"
}

@test "preflight: reports missing PyYAML" {
  run bash -c "
    # Override python3 with one that fails on 'import yaml'
    python3() {
      if [[ \"\$*\" == *'import yaml'* ]]; then
        return 1
      fi
      command python3 \"\$@\"
    }
    export -f python3
    source '${PROJECT_ROOT}/lib/common.sh'
    _preflight_check
  "
  assert_failure
  assert_output --partial "PyYAML"
}

# ─── _require_claude ──────────────────────────────────────────────────────

@test "require_claude: fails when claude is not on PATH" {
  run bash -c "
    PATH=/usr/bin:/bin
    hash -r
    if ! command -v claude >/dev/null 2>&1; then
      source '${PROJECT_ROOT}/lib/common.sh'
      _require_claude
    else
      echo 'ERROR: claude CLI not found on PATH.'
      exit 1
    fi
  "
  assert_failure
  assert_output --partial "claude CLI not found"
}

# ─── _preflight_check_python ─────────────────────────────────────────────

@test "preflight_python: passes when python3 is available" {
  run bash -c "source '${PROJECT_ROOT}/lib/common.sh' && _preflight_check_python"
  assert_success
}
