#!/usr/bin/env bats

# Tests for generate-plans.sh --auto-lenses flag.

setup() {
  load 'test_helper/common-setup'
  _common_setup
}

teardown() {
  _common_teardown
}

# ─── Argument parsing ────────────────────────────────────────────────────

@test "accepts --auto-lenses flag without error in argument parsing" {
  # Create a dummy prompt file
  echo "# Test prompt" >"${TEST_TEMP_DIR}/prompt.md"

  # --auto-lenses should be accepted (will fail later due to no claude, but
  # should not fail on argument parsing). Check it gets past the arg parser.
  run "${PROJECT_ROOT}/generate-plans.sh" "--auto-lenses" "--debug" "${TEST_TEMP_DIR}/prompt.md"

  # Should get past arg parsing — may fail on config loading or claude call,
  # but should NOT say "unknown flag" or fail on usage.
  refute_output --partial "unknown"
  refute_output --partial "Usage:"
}

@test "rejects --auto-lenses in multi-file mode" {
  echo "# Prompt A" >"${TEST_TEMP_DIR}/a.md"
  echo "# Prompt B" >"${TEST_TEMP_DIR}/b.md"

  run "${PROJECT_ROOT}/generate-plans.sh" "--auto-lenses" "${TEST_TEMP_DIR}/a.md" "${TEST_TEMP_DIR}/b.md"
  assert_failure
  assert_output --partial "incompatible with multi-file mode"
}

# ─── Lens YAML parsing ──────────────────────────────────────────────────

# Helper: parse YAML lens output using the same logic as generate-plans.sh
_parse_lenses() {
  python3 -c "
import sys, yaml, shlex, re

text = sys.stdin.read()

fence = re.search(r'\`\`\`(?:yaml)?\s*\n(.*?)\n\`\`\`', text, re.DOTALL)
if fence:
    text = fence.group(1)

try:
    data = yaml.safe_load(text)
    perspectives = data.get('perspectives', []) if isinstance(data, dict) else []
    if not perspectives:
        print('LENS_FAILED=1')
        sys.exit(0)

    nl = chr(10)
    for p in perspectives:
        name = str(p.get('name', '')).strip().lower()
        name = re.sub(r'[^a-z0-9-]', '-', name).strip('-')
        name = re.sub(r'-+', '-', name)
        guidance = str(p.get('guidance', '')).strip()
        if name and guidance:
            g = f'## Additional guidance{nl}{guidance}'
            print(f'VARIANTS[{name}]={shlex.quote(g)}')
except Exception:
    print('LENS_FAILED=1')
"
}

@test "parses valid YAML lens output into variants" {
  yaml_input="perspectives:
  - name: risk-first
    guidance: Focus on risk assessment and mitigation strategies.
  - name: user-centric
    guidance: Prioritize user experience and accessibility."

  result=$(echo "${yaml_input}" | _parse_lenses)

  [[ "${result}" == *"VARIANTS[risk-first]="* ]]
  [[ "${result}" == *"VARIANTS[user-centric]="* ]]
  [[ "${result}" == *"risk assessment"* ]]
  [[ "${result}" == *"user experience"* ]]
}

@test "handles YAML wrapped in markdown fences" {
  yaml_input='```yaml
perspectives:
  - name: test-lens
    guidance: A test lens for validation.
```'

  result=$(echo "${yaml_input}" | _parse_lenses)

  [[ "${result}" == *"VARIANTS[test-lens]="* ]]
}

@test "reports failure on invalid YAML" {
  result=$(echo "this is not yaml {{{" | _parse_lenses)

  [[ "${result}" == *"LENS_FAILED=1"* ]]
}

@test "sanitizes variant names to kebab-case" {
  yaml_input="perspectives:
  - name: 'Risk First!'
    guidance: Focus on risks.
  - name: 'User Centric (v2)'
    guidance: Focus on users."

  result=$(echo "${yaml_input}" | _parse_lenses)

  # 'Risk First!' → 'risk-first' (special chars → -, consecutive dashes collapsed, trailing - stripped)
  [[ "${result}" == *"VARIANTS[risk-first]="* ]]
  # 'User Centric (v2)' → 'user-centric-v2' (spaces and parens → -, collapsed)
  [[ "${result}" == *"VARIANTS[user-centric-v2]="* ]]
}
