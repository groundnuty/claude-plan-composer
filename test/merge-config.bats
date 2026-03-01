#!/usr/bin/env bats

# Tests for merge-plans.sh config parsing — constitution field.

setup() {
  load 'test_helper/common-setup'
  _common_setup
}

teardown() {
  _common_teardown
}

# Helper: run the Python config parser in isolation.
# Takes a merge-config.yaml path and outputs the extracted shell variables.
_parse_merge_config() {
  local config_file="$1"
  python3 -c "
import yaml, shlex, sys

defaults = {
    'work_dir': '',
    'mcp_config': '',
    'project_description': 'the project',
    'role': 'an expert analyst',
    'dimensions': [
        'Approach and strategy',
        'Scope and priorities',
        'Technical depth and specificity',
        'Architecture and structure',
        'Risk assessment and trade-offs',
        'Actionability and next steps',
    ],
    'advocate_instructions': 'Argue for its approach.',
    'output_goal': 'Standalone plan.',
    'output_title': 'Merged Plan',
    'constitution': [
        'Every trade-off must be explicitly acknowledged with pros and cons',
        'No section should be purely aspirational — each needs a concrete next step',
        'Risks identified in any source plan must appear in the merged plan',
        'The plan must be self-consistent — no section contradicts another',
    ],
}

cfg_file = '${config_file}'
if cfg_file:
    with open(cfg_file) as f:
        cfg = yaml.safe_load(f) or {}
    for k, v in defaults.items():
        cfg.setdefault(k, v)
else:
    cfg = defaults

print(f'MCFG_PROJECT={shlex.quote(str(cfg[\"project_description\"]))}')
print(f'MCFG_ROLE={shlex.quote(str(cfg[\"role\"]))}')
print(f'MCFG_TITLE={shlex.quote(str(cfg[\"output_title\"]))}')

dims = cfg.get('dimensions', defaults['dimensions'])
dim_list = chr(10).join(f'   - {d}' for d in dims)
print(f'MCFG_DIMENSIONS={shlex.quote(dim_list)}')

const = cfg.get('constitution', defaults['constitution'])
const_list = chr(10).join(f'   - {c}' for c in const)
print(f'MCFG_CONSTITUTION={shlex.quote(const_list)}')
"
}

# ─── Constitution parsing ─────────────────────────────────────────────────

@test "extracts constitution from merge-config.yaml" {
  cat >"${TEST_TEMP_DIR}/merge-config.yaml" <<'EOF'
project_description: "test project"
constitution:
  - "Principle one"
  - "Principle two"
EOF

  run _parse_merge_config "${TEST_TEMP_DIR}/merge-config.yaml"
  assert_success
  assert_output --partial "Principle one"
  assert_output --partial "Principle two"
}

@test "uses default constitution when field is absent" {
  cat >"${TEST_TEMP_DIR}/merge-config.yaml" <<'EOF'
project_description: "test project"
EOF

  run _parse_merge_config "${TEST_TEMP_DIR}/merge-config.yaml"
  assert_success
  assert_output --partial "Every trade-off must be explicitly acknowledged"
  assert_output --partial "self-consistent"
}

@test "handles empty constitution list gracefully" {
  cat >"${TEST_TEMP_DIR}/merge-config.yaml" <<'EOF'
project_description: "test project"
constitution: []
EOF

  run _parse_merge_config "${TEST_TEMP_DIR}/merge-config.yaml"
  assert_success
  # Should produce MCFG_CONSTITUTION with empty value
  assert_output --partial "MCFG_CONSTITUTION="
}

@test "extracts dimensions alongside constitution" {
  cat >"${TEST_TEMP_DIR}/merge-config.yaml" <<'EOF'
project_description: "test project"
dimensions:
  - "Custom dimension A"
  - "Custom dimension B"
constitution:
  - "Custom principle"
EOF

  run _parse_merge_config "${TEST_TEMP_DIR}/merge-config.yaml"
  assert_success
  assert_output --partial "Custom dimension A"
  assert_output --partial "Custom dimension B"
  assert_output --partial "Custom principle"
}
