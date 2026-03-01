#!/usr/bin/env bats

# Tests for merge-plans.sh config parsing — constitution, comparison method,
# weighted dimensions.

setup() {
  load 'test_helper/common-setup'
  _common_setup
}

teardown() {
  _common_teardown
}

# Helper: run the Python config parser in isolation.
# Mirrors the parser in merge-plans.sh — extracts all MCFG_* shell variables.
_parse_merge_config() {
  local config_file="$1"
  python3 -c "
import yaml, shlex, json, sys

defaults = {
    'work_dir': '',
    'mcp_config': '',
    'project_description': 'the project',
    'role': 'an expert analyst',
    'comparison_method': 'holistic',
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

cm = str(cfg.get('comparison_method', 'holistic')).strip()
print(f'MCFG_COMPARISON={shlex.quote(cm)}')

raw_dims = cfg.get('dimensions', defaults['dimensions'])
dim_names = []
dim_weights = {}
for d in raw_dims:
    if isinstance(d, dict):
        name = str(d.get('name', ''))
        weight = d.get('weight')
        dim_names.append(name)
        if weight is not None:
            dim_weights[name] = float(weight)
    else:
        dim_names.append(str(d))

dim_list = chr(10).join(f'   - {n}' for n in dim_names)
print(f'MCFG_DIMENSIONS={shlex.quote(dim_list)}')
print(f'MCFG_DIM_NAMES_JSON={shlex.quote(json.dumps(dim_names))}')
if dim_weights:
    print(f'MCFG_DIM_WEIGHTS_JSON={shlex.quote(json.dumps(dim_weights))}')
else:
    print(\"MCFG_DIM_WEIGHTS_JSON='{}'\")

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

# ─── Comparison method ─────────────────────────────────────────────────

@test "extracts comparison_method from config" {
  cat >"${TEST_TEMP_DIR}/merge-config.yaml" <<'EOF'
project_description: "test project"
comparison_method: pairwise
EOF

  run _parse_merge_config "${TEST_TEMP_DIR}/merge-config.yaml"
  assert_success
  assert_output --partial "MCFG_COMPARISON=pairwise"
}

@test "defaults comparison_method to holistic when absent" {
  cat >"${TEST_TEMP_DIR}/merge-config.yaml" <<'EOF'
project_description: "test project"
EOF

  run _parse_merge_config "${TEST_TEMP_DIR}/merge-config.yaml"
  assert_success
  assert_output --partial "MCFG_COMPARISON=holistic"
}

# ─── Weighted dimensions ──────────────────────────────────────────────

@test "parses weighted dimensions (dict form)" {
  cat >"${TEST_TEMP_DIR}/merge-config.yaml" <<'EOF'
project_description: "test project"
dimensions:
  - name: "Approach and strategy"
    weight: 0.3
  - name: "Actionability"
    weight: 0.3
  - "Technical depth"
EOF

  run _parse_merge_config "${TEST_TEMP_DIR}/merge-config.yaml"
  assert_success
  # Dimension names extracted
  assert_output --partial "Approach and strategy"
  assert_output --partial "Actionability"
  assert_output --partial "Technical depth"
  # JSON names array
  assert_output --partial 'MCFG_DIM_NAMES_JSON='
  # Weights JSON contains weighted dimensions
  assert_output --partial '"Approach and strategy": 0.3'
  assert_output --partial '"Actionability": 0.3'
}

@test "outputs empty weights when all dimensions are unweighted" {
  cat >"${TEST_TEMP_DIR}/merge-config.yaml" <<'EOF'
project_description: "test project"
dimensions:
  - "Dim A"
  - "Dim B"
EOF

  run _parse_merge_config "${TEST_TEMP_DIR}/merge-config.yaml"
  assert_success
  assert_output --partial "MCFG_DIM_WEIGHTS_JSON='{}'"
}

@test "JSON names array includes all dimensions in order" {
  cat >"${TEST_TEMP_DIR}/merge-config.yaml" <<'EOF'
project_description: "test project"
dimensions:
  - name: "First"
    weight: 0.5
  - "Second"
  - "Third"
EOF

  run _parse_merge_config "${TEST_TEMP_DIR}/merge-config.yaml"
  assert_success
  assert_output --partial '["First", "Second", "Third"]'
}
