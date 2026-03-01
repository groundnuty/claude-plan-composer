#!/usr/bin/env bash

# Common test setup for all bats tests.
# Source this from setup() in each test file.

_common_setup() {
  # Resolve paths from this file's location, not the test file's directory.
  # This allows tests in subdirectories (e.g., test/e2e/) to reuse this setup.
  local helper_dir
  helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  load "${helper_dir}/bats-support/load"
  load "${helper_dir}/bats-assert/load"
  load "${helper_dir}/bats-file/load"

  # Project root (two levels up from test_helper/)
  PROJECT_ROOT="$(cd "${helper_dir}/../.." && pwd)"
  export PROJECT_ROOT

  # Create a temp dir for each test
  TEST_TEMP_DIR="$(mktemp -d)"
  export TEST_TEMP_DIR
}

_common_teardown() {
  # Clean up temp dir
  if [[ -d "${TEST_TEMP_DIR:-}" ]]; then
    rm -rf "$TEST_TEMP_DIR"
  fi
}
