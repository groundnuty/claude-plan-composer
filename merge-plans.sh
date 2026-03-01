#!/usr/bin/env bash
# shellcheck disable=SC2154 # MCFG_* variables are set via eval of python config parser
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Merge multiple implementation plans into one final plan.
#
# Takes a directory of plan-*.md files (output of generate-plans.sh) and
# uses Claude to synthesize a merged plan taking the best of each.
#
# Merge modes:
#   agent-teams  (default) Interactive debate with competing advocates.
#                Uses Agent Teams experimental feature — each advocate
#                champions one plan, debates the others, lead synthesizes.
#   simple       Headless `claude -p` auto-merge. Quick, cheap, automated.
#
# Usage:
#   ./merge-plans.sh generated-plans/latest                          # agent-teams
#   ./merge-plans.sh generated-plans/20260212-030000                 # specific run
#   MERGE_MODE=simple ./merge-plans.sh generated-plans/latest        # headless
#   MODEL=sonnet MERGE_MODE=simple ./merge-plans.sh generated-plans/latest
#   MERGE_CONFIG=my-merge.yaml ./merge-plans.sh generated-plans/latest
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Input validation ─────────────────────────────────────────────────────

RUN_DIR="${1:?Usage: $0 <plans-directory>}"

# Resolve symlinks (e.g. generated-plans/latest → generated-plans/20260212-...)
RUN_DIR=$(cd "${RUN_DIR}" && pwd)

# Find plan files
plans=()
for f in "${RUN_DIR}"/plan-*.md; do
  [[ -f "${f}" ]] || continue
  size=$(wc -c <"${f}" | tr -d ' ')
  if [[ "${size}" -gt 1000 ]]; then
    plans+=("${f}")
  else
    echo "  Skipping $(basename "${f}") — too small (${size} bytes)"
  fi
done

if [[ ${#plans[@]} -lt 2 ]]; then
  echo "ERROR: Need at least 2 plan files in ${RUN_DIR}/, found ${#plans[@]}."
  echo "  Run ./generate-plans.sh first."
  exit 1
fi

echo "Found ${#plans[@]} plans in ${RUN_DIR}/:"
for f in "${plans[@]}"; do
  lines=$(wc -l <"${f}" | tr -d ' ')
  echo "  - $(basename "${f}") (${lines} lines)"
done
echo ""

# ─── Configuration ─────────────────────────────────────────────────────────

MODEL="${MODEL:-opus}"
MERGE_MODE="${MERGE_MODE:-agent-teams}"
TIMEOUT_SECS="${TIMEOUT_SECS:-3600}"
WORK_DIR_ENV="${WORK_DIR:-}"
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000

# Output file (absolute path — works from any CWD)
merge_md="${RUN_DIR}/merged-plan.md"

# ─── Load merge config ───────────────────────────────────────────────────
# Priority: MERGE_CONFIG env var > merge-config.local.yaml > merge-config.yaml
MERGE_CONFIG_FILE="${MERGE_CONFIG:-}"
if [[ -n "${MERGE_CONFIG_FILE}" ]] && [[ "${MERGE_CONFIG_FILE}" != /* ]]; then
  MERGE_CONFIG_FILE="${SCRIPT_DIR}/${MERGE_CONFIG_FILE}"
fi
if [[ -z "${MERGE_CONFIG_FILE}" ]] && [[ -f "${SCRIPT_DIR}/merge-config.local.yaml" ]]; then
  MERGE_CONFIG_FILE="${SCRIPT_DIR}/merge-config.local.yaml"
elif [[ -z "${MERGE_CONFIG_FILE}" ]] && [[ -f "${SCRIPT_DIR}/merge-config.yaml" ]]; then
  MERGE_CONFIG_FILE="${SCRIPT_DIR}/merge-config.yaml"
fi

# Parse merge config with defaults for every field.
# Variables set by eval: MCFG_PROJECT, MCFG_ROLE, MCFG_ADVOCATE,
# MCFG_GOAL, MCFG_TITLE, MCFG_DIMENSIONS, MCFG_CONSTITUTION,
# MCFG_COMPARISON, MCFG_DIM_NAMES_JSON, CFG_WORK_DIR, CFG_MCP_CONFIG
# shellcheck disable=SC2312 # eval of python output is intentional
eval "$(python3 -c "
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
    'advocate_instructions': 'Argue for its approach in each dimension. Challenge the other advocates where yours is stronger. Concede where yours is weaker. Be specific — cite exact sections and trade-offs.',
    'output_goal': 'The merged plan must be standalone — someone should be able to act on it without referencing the source plans.',
    'output_title': 'Merged Plan',
    'constitution': [
        'Every trade-off must be explicitly acknowledged with pros and cons',
        'No section should be purely aspirational — each needs a concrete next step',
        'Risks identified in any source plan must appear in the merged plan',
        'The plan must be self-consistent — no section contradicts another',
    ],
}

cfg_file = '${MERGE_CONFIG_FILE}'
if cfg_file:
    with open(cfg_file) as f:
        cfg = yaml.safe_load(f) or {}
    for k, v in defaults.items():
        cfg.setdefault(k, v)
else:
    cfg = defaults

wd = str(cfg.get('work_dir') or '').strip()
print(f'CFG_WORK_DIR={shlex.quote(wd)}')
mcp = str(cfg.get('mcp_config') or '').strip()
print(f'CFG_MCP_CONFIG={shlex.quote(mcp)}')
print(f'MCFG_PROJECT={shlex.quote(str(cfg[\"project_description\"]))}')
print(f'MCFG_ROLE={shlex.quote(str(cfg[\"role\"]))}')
print(f'MCFG_ADVOCATE={shlex.quote(str(cfg[\"advocate_instructions\"]).strip())}')
print(f'MCFG_GOAL={shlex.quote(str(cfg[\"output_goal\"]).strip())}')
print(f'MCFG_TITLE={shlex.quote(str(cfg[\"output_title\"]))}')

# Comparison method
cm = str(cfg.get('comparison_method', 'holistic')).strip()
print(f'MCFG_COMPARISON={shlex.quote(cm)}')

# Dimensions — support both string and dict forms
# String: 'Approach and strategy' (equal weight)
# Dict: {name: 'Approach and strategy', weight: 0.25}
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

# JSON arrays for pairwise tournament
print(f'MCFG_DIM_NAMES_JSON={shlex.quote(json.dumps(dim_names))}')
if dim_weights:
    print(f'MCFG_DIM_WEIGHTS_JSON={shlex.quote(json.dumps(dim_weights))}')
else:
    print(\"MCFG_DIM_WEIGHTS_JSON='{}'\")

# Constitution as a formatted list
const = cfg.get('constitution', defaults['constitution'])
const_list = chr(10).join(f'   - {c}' for c in const)
print(f'MCFG_CONSTITUTION={shlex.quote(const_list)}')
")"

# ─── Resolve WORK_DIR ────────────────────────────────────────────────────
# Priority: WORK_DIR env var > config work_dir > temp directory.
if [[ -n "${WORK_DIR_ENV}" ]]; then
  WORK_DIR="${WORK_DIR_ENV}"
elif [[ -n "${CFG_WORK_DIR:-}" ]]; then
  if [[ "${CFG_WORK_DIR}" != /* ]]; then
    WORK_DIR="$(cd "${SCRIPT_DIR}" && cd "${CFG_WORK_DIR}" && pwd)"
  else
    WORK_DIR="${CFG_WORK_DIR}"
  fi
else
  WORK_DIR=$(mktemp -d)
  WORK_DIR_IS_TEMP=true
fi

# ─── Resolve MCP config ──────────────────────────────────────────────────
MCP_CONFIG=""
if [[ -n "${CFG_MCP_CONFIG:-}" ]]; then
  if [[ "${CFG_MCP_CONFIG}" != /* ]]; then
    MCP_CONFIG="${SCRIPT_DIR}/${CFG_MCP_CONFIG}"
  else
    MCP_CONFIG="${CFG_MCP_CONFIG}"
  fi
  if [[ ! -f "${MCP_CONFIG}" ]]; then
    echo "Warning: mcp_config file not found: ${MCP_CONFIG} (skipping)"
    MCP_CONFIG=""
  fi
fi

echo "  Merge config: ${MERGE_CONFIG_FILE:-defaults}"

# ─── Agent Teams merge ─────────────────────────────────────────────────────

if [[ "${MERGE_MODE}" = "agent-teams" ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Agent Teams merge (interactive)"
  echo ""

  # Write the merge prompt (with absolute output path)
  merge_prompt_file="${RUN_DIR}/merge-prompt.md"
  cat >"${merge_prompt_file}" <<PROMPT_HEADER_EOF
# Agent Teams Merge — Competing Advocates

I have generated multiple plans for ${MCFG_PROJECT}.
Each plan was generated with a different focus. Your job is to merge the
best elements into one final plan.

## Instructions

Create an agent team with these teammates:

PROMPT_HEADER_EOF

  # One advocate per plan
  advocate_num=0
  for plan_file in "${plans[@]}"; do
    variant_name=$(basename "${plan_file}" .md | sed 's/plan-//')
    ((advocate_num++)) || true
    cat >>"${merge_prompt_file}" <<EOF
- **Advocate ${advocate_num} (${variant_name})**: Read \`${plan_file}\` and become
  its champion. ${MCFG_ADVOCATE}

EOF
  done

  # Use unquoted heredoc so $merge_md and config vars expand
  cat >>"${merge_prompt_file}" <<PROMPT_FOOTER_EOF

## Team lead role

You (the lead) will:
1. Have each advocate present their plan's strengths (2-3 min each)
2. Facilitate a structured debate across these dimensions:
${MCFG_DIMENSIONS}
3. For each dimension where advocates disagree, classify the disagreement:
   - GENUINE TRADE-OFF: Present both options with trade-off analysis
   - COMPLEMENTARY: Merge both contributions
   - ARBITRARY DIVERGENCE: Pick the more specific/actionable version
4. After the debate, produce:
   - A comparison table with the winner per dimension + justification
   - A COMPLETE merged plan taking the best of each
   - ${MCFG_GOAL}
5. Scan each source plan for unique insights not in any other plan.
   Include valuable ones with "[Source: variant-name]".
6. Verify the merged plan against these quality principles:
${MCFG_CONSTITUTION}
   Revise any sections that violate a principle.

## Constraints for advocates
- Use delegate mode — do NOT implement anything yourself, only coordinate
- Require advocates to READ their assigned plan file before debating
- Each advocate must identify at least 2 weaknesses in their OWN plan
- Each advocate must identify at least 2 strengths in a COMPETING plan

## Output (CRITICAL)
Write the final merged plan (titled "${MCFG_TITLE}") to this exact file path
using the Write tool:
  ${merge_md}
PROMPT_FOOTER_EOF

  echo "  Merge prompt: ${merge_prompt_file}"
  echo "  Output: ${merge_md}"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Launching interactive Claude with Agent Teams enabled..."
  echo ""
  echo "  Tip: Use Shift+Up/Down to talk to individual advocates."
  echo "  Press Shift+Tab to enable delegate mode (lead coordinates only)."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Interactive mode: no -p flag. Pass initial prompt as positional argument.
  # exec replaces shell — Claude runs interactively, user can debate.
  mcp_flags=()
  if [[ -n "${MCP_CONFIG}" ]]; then
    mcp_flags+=(--mcp-config "${MCP_CONFIG}")
  fi

  exec env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \
    CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 \
    claude --model "${MODEL}" \
    "${mcp_flags[@]}" \
    "Read the merge prompt at ${merge_prompt_file} and follow its instructions. The plan files are in ${RUN_DIR}/."

# ─── Simple headless merge ─────────────────────────────────────────────────

elif [[ "${MERGE_MODE}" = "simple" ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Simple merge (headless, ${MCFG_COMPARISON}) with ${MODEL}..."
  echo "  Output: ${merge_md}"
  echo ""

  # Collect variant names for pairwise pair enumeration
  variant_names=()
  for plan_file in "${plans[@]}"; do
    variant_names+=("$(basename "${plan_file}" .md | sed 's/plan-//')")
  done

  # Build weight instructions if weights are provided
  WEIGHT_INSTRUCTIONS=""
  if [[ "${MCFG_DIM_WEIGHTS_JSON}" != "{}" ]]; then
    WEIGHT_INSTRUCTIONS="
Dimension weights (use these to weight scoring and emphasis in synthesis):
${MCFG_DIM_WEIGHTS_JSON}
Unweighted dimensions share the remaining weight equally."
  fi

  # Build prompt based on comparison method
  if [[ "${MCFG_COMPARISON}" = "pairwise" ]]; then
    # ── Pairwise tournament prompt ──────────────────────────────────
    # Enumerate all C(N,2) pairs
    pairs_list=""
    for ((i = 0; i < ${#variant_names[@]}; i++)); do
      for ((j = i + 1; j < ${#variant_names[@]}; j++)); do
        pairs_list+="   - ${variant_names[${i}]} vs ${variant_names[${j}]}
"
      done
    done

    # Weight-aware scoring instructions
    if [[ "${MCFG_DIM_WEIGHTS_JSON}" != "{}" ]]; then
      SCORING_INSTRUCTIONS="Apply dimension weights to compute weighted scores:
${MCFG_DIM_WEIGHTS_JSON}
A win in a weighted dimension earns its weight as score.
Unweighted dimensions share the remaining weight equally."
    else
      SCORING_INSTRUCTIONS="Each dimension win counts as 1 point."
    fi

    MERGE_PROMPT="You are ${MCFG_ROLE}. Below are ${#plans[@]} plans
for ${MCFG_PROJECT}, each generated with different focus areas.

Your task has four phases:

## Phase 1 — PAIRWISE COMPARISONS

For each dimension listed below, compare every pair of plans head-to-head.
For each pair × dimension, pick a WINNER and give a one-sentence justification.

Dimensions:
${MCFG_DIMENSIONS}
${WEIGHT_INSTRUCTIONS}

Pairs to compare:
${pairs_list}
Output Phase 1 as a structured table:
| Dimension | Pair | Winner | Justification |
|-----------|------|--------|---------------|

## Phase 2 — TOURNAMENT TALLY

Count the wins per plan per dimension from Phase 1.
${SCORING_INSTRUCTIONS}

Produce a final ranking table:
| Plan | Total Score | Wins by Dimension |
|------|-------------|-------------------|

## Phase 3 — SYNTHESIS

Using the tournament results, produce a MERGED PLAN:
- Use the dimension winner's approach for each dimension
- For dimensions with a clear winner, adopt their approach
- For dimensions where results are close (1-point margin), classify the
  disagreement:
  - GENUINE TRADE-OFF: Present both options with trade-off analysis
  - COMPLEMENTARY: Merge both contributions
  - ARBITRARY DIVERGENCE: Pick the more specific/actionable version
- ${MCFG_GOAL}

After synthesizing, scan each source plan for insights that appear in ONLY
that plan. For each unique insight:
- If genuinely valuable, include it with a note: \"[Source: variant-name]\"
- If not valuable, briefly note why it was excluded in the comparison section

## Phase 4 — CONSTITUTIONAL REVIEW

Verify the merged plan against these quality principles:
${MCFG_CONSTITUTION}

For each principle: does the merged plan satisfy it? If not, revise the
relevant section before finalizing.

"

  else
    # ── Holistic comparison prompt (default) ────────────────────────
    MERGE_PROMPT="You are ${MCFG_ROLE}. Below are ${#plans[@]} plans
for ${MCFG_PROJECT}, each generated with different focus areas.

Your task has three phases:

## Phase 1 — ANALYSIS
For each of the following dimensions, produce a comparison table showing
each plan's approach, strengths, and weaknesses:
${MCFG_DIMENSIONS}
${WEIGHT_INSTRUCTIONS}

For each dimension, classify any disagreements between plans:
- GENUINE TRADE-OFF: Legitimate alternatives with different strengths.
  Present both options with trade-off analysis in the merged plan.
- COMPLEMENTARY: Plans address different sub-aspects that can coexist.
  Merge both contributions.
- ARBITRARY DIVERGENCE: No substantive reason for the difference.
  Pick the more specific/actionable version.

For each dimension, identify the WINNER with a one-sentence justification.

## Phase 2 — SYNTHESIS
Produce a MERGED PLAN that takes the best of each:
- Use the winner's approach for each dimension
- Resolve conflicts using the disagreement classifications above
- ${MCFG_GOAL}

After synthesizing, scan each source plan for insights that appear in ONLY
that plan. For each unique insight:
- If genuinely valuable, include it with a note: \"[Source: variant-name]\"
- If not valuable, briefly note why it was excluded in the comparison section

## Phase 3 — CONSTITUTIONAL REVIEW
Verify the merged plan against these quality principles:
${MCFG_CONSTITUTION}

For each principle: does the merged plan satisfy it? If not, revise the
relevant section before finalizing.

"
  fi

  for plan_file in "${plans[@]}"; do
    variant_name=$(basename "${plan_file}" .md | sed 's/plan-//')
    MERGE_PROMPT+="
═══════════════════════════════════════════════════════════════
PLAN: ${variant_name}
═══════════════════════════════════════════════════════════════

$(cat "${plan_file}")

"
  done

  # OUTPUT FIX: Tell Claude to write the merged plan to a file via Write tool.
  # --output-format text only captures the LAST assistant message — same bug
  # that truncated all generated plans. The Write tool approach is reliable
  # regardless of how many turns the merge takes.
  MERGE_PROMPT+="

## Output format (CRITICAL)
Write the COMPLETE merged plan to this exact file path using the Write tool:
  ${merge_md}

Rules:
1. Read and analyze ALL plans above first
2. Then use the Write tool ONCE to create the file at the path above with
   the ENTIRE merged plan content
3. Start the file content with '# ${MCFG_TITLE}'
4. Include ALL sections in that single Write call — do not split across
   multiple Write calls
5. Do NOT write to .claude/plans/ or any other path — ONLY the path above
6. After writing the file, output a brief confirmation
"

  logfile="${RUN_DIR}/merge.log"

  # Run from WORK_DIR so subagents can access files if needed.
  # Claude writes merged plan to $merge_md via Write tool.
  # stdout + stderr go to logfile for debugging.
  #
  # --dangerously-skip-permissions: Required for headless -p mode.
  #   Without it, Write tool is denied ("you haven't granted permissions yet")
  #   because there's no interactive user to approve.
  mcp_flags=()
  if [[ -n "${MCP_CONFIG}" ]]; then
    mcp_flags+=(--mcp-config "${MCP_CONFIG}")
  fi

  (cd "${WORK_DIR}" \
    && CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 \
      timeout "${TIMEOUT_SECS}" \
      claude -p "${MERGE_PROMPT}" \
      --model "${MODEL}" \
      --output-format text \
      --max-turns 30 \
      --dangerously-skip-permissions \
      "${mcp_flags[@]}" \
      >"${logfile}" 2>&1) || true
  # || true: prevent set -e from killing the script on failure.
  # We validate the output file below instead.

  if [[ -f "${merge_md}" ]]; then
    merge_size=$(wc -c <"${merge_md}" | tr -d ' ')
    merge_lines=$(wc -l <"${merge_md}" | tr -d ' ')

    if [[ "${merge_size}" -lt 5000 ]]; then
      echo "  ⚠ Merge output too small (${merge_size} bytes < 5000). Likely incomplete."
      echo "    Check: ${logfile}"
      exit 1
    fi

    echo "  ✓ Merge completed (${merge_lines} lines, ${merge_size} bytes)"
    echo ""
    echo "  Output: ${merge_md}"
    echo ""
    echo "  Next steps:"
    echo "    1. Review: less ${merge_md}"
    echo "    2. Iterate: claude --resume"
    echo "    3. Adopt:   cp ${merge_md} <your-project>/.claude/plans/"
  else
    echo "  ✗ Merge failed — plan file not created (Claude didn't use Write tool)"
    echo "    Check: ${logfile}"
    echo "    Retry: $0 ${RUN_DIR}"
    exit 1
  fi

else
  echo "ERROR: Unknown MERGE_MODE=${MERGE_MODE} (expected: agent-teams, simple)"
  exit 1
fi

# Clean up temp work directory if we created one
if [[ "${WORK_DIR_IS_TEMP:-}" = "true" ]] && [[ -d "${WORK_DIR}" ]]; then
  rm -rf "${WORK_DIR}"
fi
