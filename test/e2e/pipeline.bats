#!/usr/bin/env bats

# End-to-end pipeline test — runs real Claude API calls.
#
# NOT included in `make check` (which is fast and free).
# Run manually:  make e2e
# Or directly:   MODEL=haiku bats test/e2e/pipeline.bats
#
# Cost: ~$2-4 per run (2 sonnet variants + 1 sonnet merge).
# Duration: ~3-8 minutes.
# Override model: MODEL=haiku make test-e2e

# ─── Lifecycle ──────────────────────────────────────────────────────────────

setup_file() {
  # Project root: test/e2e/ -> test/ -> project root
  export PROJECT_ROOT
  PROJECT_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"

  if ! command -v claude &>/dev/null; then
    export SKIP_E2E=1
    return
  fi

  # ── Phase 1: Generate plans (runs once for all tests) ──
  export MODEL="${MODEL:-sonnet}"
  export MAX_TURNS="${MAX_TURNS:-15}"
  export TIMEOUT_SECS="${TIMEOUT_SECS:-300}"
  export CONFIG="${PROJECT_ROOT}/test/e2e-config.yaml"

  # Allow nested Claude sessions (e2e may run from inside Claude Code).
  unset CLAUDECODE

  echo "# Generating plans with MODEL=${MODEL}, MAX_TURNS=${MAX_TURNS}..." >&3

  if ! "${PROJECT_ROOT}/generate-plans.sh" \
    "${PROJECT_ROOT}/examples/csv-to-json-cli.md"; then
    export GENERATE_FAILED=1
    return
  fi

  export RUN_DIR
  RUN_DIR="$(cd "${PROJECT_ROOT}/generated-plans/csv-to-json-cli/latest" && pwd)"
}

teardown_file() {
  # Leave generated-plans/ for debugging; `make clean` removes it.
  :
}

setup() {
  load '../test_helper/common-setup'
  _common_setup

  if [[ "${SKIP_E2E:-}" == "1" ]]; then
    skip "claude CLI not found on PATH"
  fi

  if [[ "${GENERATE_FAILED:-}" == "1" ]]; then
    skip "generate-plans.sh failed in setup_file"
  fi
}

# ─── Generate phase ─────────────────────────────────────────────────────────

@test "generate: produces 2 plan files" {
  assert_file_exists "${RUN_DIR}/plan-baseline.md"
  assert_file_exists "${RUN_DIR}/plan-simplicity.md"
}

@test "generate: each plan exceeds minimum size" {
  local size
  for plan in "${RUN_DIR}"/plan-*.md; do
    size=$(wc -c <"${plan}" | tr -d ' ')
    [[ "${size}" -gt 500 ]] || fail "$(basename "${plan}") is only ${size} bytes (expected >500)"
  done
}

@test "generate: each plan starts with markdown heading" {
  for plan in "${RUN_DIR}"/plan-*.md; do
    head -1 "${plan}" | grep -q '^# ' || fail "$(basename "${plan}") does not start with '# '"
  done
}

@test "generate: latest symlink exists" {
  [[ -L "${PROJECT_ROOT}/generated-plans/csv-to-json-cli/latest" ]]
}

# ─── Evaluate phase ─────────────────────────────────────────────────────────

@test "evaluate: convergence check succeeds (no-llm)" {
  run "${PROJECT_ROOT}/evaluate-plans.sh" --no-llm "${RUN_DIR}"
  assert_success
}

@test "evaluate: writes evaluation.md" {
  # Run evaluate if not already run
  "${PROJECT_ROOT}/evaluate-plans.sh" --no-llm "${RUN_DIR}" >/dev/null 2>&1 || true
  assert_file_exists "${RUN_DIR}/evaluation.md"
}

# ─── Merge phase ────────────────────────────────────────────────────────────

@test "merge: produces merged-plan.md" {
  echo "# Merging plans with MODEL=${MODEL:-sonnet}, MERGE_MODE=simple..." >&3

  # Run merge directly (not via bats `run`) because `run` creates a pipe context
  # that causes claude -p to receive SIGTTIN and stop silently.
  # See research/claude-p-headless-pitfalls.md for details.
  unset CLAUDECODE
  local merge_exit=0
  MODEL="${MODEL:-sonnet}" \
    MERGE_MODE=simple \
    MAX_TURNS="${MAX_TURNS:-15}" \
    TIMEOUT_SECS=600 \
    "${PROJECT_ROOT}/merge-plans.sh" "${RUN_DIR}" || merge_exit=$?

  [[ "${merge_exit}" -eq 0 ]] || fail "merge-plans.sh exited with code ${merge_exit}"
  [[ -f "${RUN_DIR}/merged-plan.md" ]] || fail "merged-plan.md not created"
}

@test "merge: merged plan exceeds minimum size" {
  [[ -f "${RUN_DIR}/merged-plan.md" ]] || skip "merge step did not run"
  local size
  size=$(wc -c <"${RUN_DIR}/merged-plan.md" | tr -d ' ')
  [[ "${size}" -gt 500 ]] || fail "merged-plan.md is only ${size} bytes (expected >500)"
}
