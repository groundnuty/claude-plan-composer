#!/usr/bin/env bash

# Common test setup for all bats tests.
# Source this from setup() in each test file.

_common_setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  load 'test_helper/bats-file/load'

  # Project root (one level up from test/)
  PROJECT_ROOT="$(cd "${BATS_TEST_DIRNAME}/.." && pwd)"
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
