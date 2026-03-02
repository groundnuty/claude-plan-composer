#!/usr/bin/env bats

# Static analysis tests — verify correct permission flags and safety measures
# at each claude invocation. No API calls needed; these grep the source files.

setup() {
  load 'test_helper/common-setup'
  _common_setup
}

teardown() {
  _common_teardown
}

# ─── generate-plans.sh ─────────────────────────────────────────────────────

@test "auto-lens uses --permission-mode dontAsk (not --dangerously-skip-permissions)" {
  # The auto-lens invocation (LENS_PROMPT) is pure text completion (YAML generation).
  run bash -c "
    grep -A5 'claude -p.*LENS_PROMPT' '${PROJECT_ROOT}/generate-plans.sh'
  "
  assert_success
  assert_output --partial "permission-mode dontAsk"
  refute_output --partial "dangerously-skip-permissions"
}

@test "plan generation uses --allowedTools with dontAsk (not --dangerously-skip-permissions)" {
  # The plan generation invocation is in _launch_variant.
  # Uses explicit tool whitelist instead of bypass for codebase exploration.
  run bash -c "
    awk '/_launch_variant/,/^}/' '${PROJECT_ROOT}/generate-plans.sh' \
      | grep -A8 'claude -p.*full_prompt'
  "
  assert_success
  assert_output --partial "permission-mode dontAsk"
  assert_output --partial "allowedTools"
  refute_output --partial "dangerously-skip-permissions"
}

# ─── merge-plans.sh ────────────────────────────────────────────────────────

@test "simple merge uses dontAsk with --allowedTools Write" {
  # The simple merge invocation needs Write tool only.
  run bash -c "
    awk '/claude -p.*MERGE_PROMPT/,/logfile/' '${PROJECT_ROOT}/merge-plans.sh'
  "
  assert_success
  assert_output --partial "permission-mode dontAsk"
  assert_output --partial "allowedTools"
  refute_output --partial "dangerously-skip-permissions"
}

# ─── evaluate-plans.sh ─────────────────────────────────────────────────────

@test "evaluation uses --permission-mode dontAsk" {
  # Evaluation is pure text (plans embedded in prompt, JSON output).
  run bash -c "
    grep -A5 'claude -p.*EVAL_PROMPT' '${PROJECT_ROOT}/evaluate-plans.sh'
  "
  assert_success
  assert_output --partial "permission-mode dontAsk"
  refute_output --partial "dangerously-skip-permissions"
}

# ─── verify-plan.sh ────────────────────────────────────────────────────────

@test "verification uses --permission-mode dontAsk" {
  # Verification is pure text (plans embedded, markdown output).
  run bash -c "
    grep -A5 'claude -p.*VERIFY_PROMPT' '${PROJECT_ROOT}/verify-plan.sh'
  "
  assert_success
  assert_output --partial "permission-mode dontAsk"
  refute_output --partial "dangerously-skip-permissions"
}

@test "pre-mortem uses --permission-mode dontAsk" {
  # Pre-mortem is pure text (plan embedded, markdown output).
  run bash -c "
    grep -A5 'claude -p.*PREMORTEM_PROMPT' '${PROJECT_ROOT}/verify-plan.sh'
  "
  assert_success
  assert_output --partial "permission-mode dontAsk"
  refute_output --partial "dangerously-skip-permissions"
}

# ─── No bypass flag anywhere ──────────────────────────────────────────────

@test "no script uses --dangerously-skip-permissions" {
  # All invocations now use explicit permission modes.
  run bash -c "
    grep -r --include='*.sh' -c 'dangerously-skip-permissions' \
      '${PROJECT_ROOT}/generate-plans.sh' \
      '${PROJECT_ROOT}/evaluate-plans.sh' \
      '${PROJECT_ROOT}/merge-plans.sh' \
      '${PROJECT_ROOT}/verify-plan.sh' \
    2>/dev/null | grep -v ':0$' | wc -l | tr -d ' '
  "
  assert_success
  assert_output "0"
}

# ─── Prompt injection boundaries ──────────────────────────────────────────

@test "plan content is wrapped in XML safety boundaries (evaluate)" {
  run bash -c "grep -c 'generated_plan' '${PROJECT_ROOT}/evaluate-plans.sh'"
  assert_success
  [[ "${output}" -ge 2 ]]  # opening + closing tag
}

@test "plan content is wrapped in XML safety boundaries (merge)" {
  run bash -c "grep -c 'generated_plan' '${PROJECT_ROOT}/merge-plans.sh'"
  assert_success
  [[ "${output}" -ge 2 ]]
}

@test "plan content is wrapped in XML safety boundaries (verify)" {
  run bash -c "grep -c -E 'generated_plan|merged_plan' '${PROJECT_ROOT}/verify-plan.sh'"
  assert_success
  [[ "${output}" -ge 4 ]]  # 2 tags x 2 sections (verify + pre-mortem)
}

# ─── Session isolation ───────────────────────────────────────────────────

@test "all claude invocations use --setting-sources project,local" {
  # Prevents loading user-global hooks, plugins, and rules.
  # grep -v '^\s*#' excludes comment lines from the count.
  run bash -c "
    for f in generate-plans.sh evaluate-plans.sh merge-plans.sh verify-plan.sh; do
      count_invocations=\$(grep -v '^\s*#' \"\${PROJECT_ROOT}/\${f}\" | grep -c 'claude -p')
      count_isolated=\$(grep -v '^\s*#' \"\${PROJECT_ROOT}/\${f}\" | grep -c 'setting-sources project,local')
      if [[ \"\${count_invocations}\" -ne \"\${count_isolated}\" ]]; then
        echo \"FAIL: \${f} has \${count_invocations} claude -p calls but \${count_isolated} --setting-sources project,local\"
        exit 1
      fi
    done
    echo 'OK'
  "
  assert_success
  assert_output "OK"
}

@test "all claude invocations use --disable-slash-commands" {
  # Prevents skills from loading in headless sessions.
  # grep -v '^\s*#' excludes comment lines from the count.
  run bash -c "
    for f in generate-plans.sh evaluate-plans.sh merge-plans.sh verify-plan.sh; do
      count_invocations=\$(grep -v '^\s*#' \"\${PROJECT_ROOT}/\${f}\" | grep -c 'claude -p')
      count_disabled=\$(grep -v '^\s*#' \"\${PROJECT_ROOT}/\${f}\" | grep -c 'disable-slash-commands')
      if [[ \"\${count_invocations}\" -ne \"\${count_disabled}\" ]]; then
        echo \"FAIL: \${f} has \${count_invocations} claude -p calls but \${count_disabled} --disable-slash-commands\"
        exit 1
      fi
    done
    echo 'OK'
  "
  assert_success
  assert_output "OK"
}

# ─── Config validation ────────────────────────────────────────────────────

@test "sensitive path warning function exists in lib/common.sh" {
  run bash -c "grep -c '_warn_sensitive_paths' '${PROJECT_ROOT}/lib/common.sh'"
  assert_success
  [[ "${output}" -ge 1 ]]
}
