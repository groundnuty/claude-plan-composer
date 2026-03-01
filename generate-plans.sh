#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Generate multiple implementation plans using parallel Claude Code sessions.
#
# Output: generated-plans/<prompt-name>/<timestamp>/plan-{variant}.md
#
# WHY N SESSIONS? (default: 4)
#   The number of variants is configurable in config.yaml. The default of 4
#   is based on research showing diminishing returns from same-model ensembles:
#   - Correlated errors: same model = 60% error agreement (arXiv:2506.07962)
#   - Self-MoA (Li et al. 2025): multiple runs of best model > mixing models
#   - Best-of-N: logarithmic returns, N=3-4 captures ~80% of total gain
#   - Merging cost: N plans = N*(N-1)/2 pairwise comparisons
#   Diversity comes from PROMPT VARIATION, not from more runs of same prompt.
#   See research/number-of-llms-sessions.md for full analysis.
#
# OUTPUT CAPTURE (v2 fix):
#   v1 used `--output-format text > file` which only captures the LAST assistant
#   message. When Claude researches across multiple turns, the plan is spread
#   across intermediate messages and only the final summary gets captured
#   (e.g., "The complete plan has been delivered above").
#   v2 tells Claude to write the plan to a file via the Write tool — reliable
#   regardless of how many turns Claude takes.
#
# SANDBOX ACCESS (v2 fix):
#   v1 ran `claude -p` from plan-generator/. Subagents couldn't access files
#   in sibling repos despite --add-dir flags (--add-dir doesn't propagate
#   to subagents).
#   v2 runs `claude -p` from a configurable work_dir so all needed repos
#   are within the CWD sandbox tree. If work_dir is empty, uses a temp dir.
#
# Usage:
#   Single prompt + variant config (variants from config.yaml):
#     ./generate-plans.sh <prompt-file>                  # all variants from config
#     ./generate-plans.sh initial-project-promt.md       # example
#     MODEL=sonnet ./generate-plans.sh my-prompt.md      # override model
#     ./generate-plans.sh --debug my-prompt.md           # single variant (baseline)
#     ./generate-plans.sh --debug=k8s-ops my-prompt.md   # single variant (chosen)
#     DEBUG=1 ./generate-plans.sh my-prompt.md            # same as --debug
#
#   Multiple prompt files (each file = one variant, no config.yaml needed):
#     ./generate-plans.sh prompt-baseline.md prompt-simplicity.md prompt-depth.md
#     MODEL=sonnet ./generate-plans.sh prompts/*.md
#     Variant name = filename without .md extension.
#
#   Multiple prompt files with shared context appended to each:
#     ./generate-plans.sh --context shared-context.md prompt-*.md
#     The context file is appended to every prompt before the output instruction.
#
# After completion, merge with:
#   ./merge-plans.sh generated-plans/<prompt-name>/latest
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Parse arguments ──────────────────────────────────────────────────────
# Supports: --debug, --debug=<variant>, --context=<file>, --auto-lenses,
#           --sequential-diversity, positional <prompt-file(s)>
DEBUG_MODE="${DEBUG:-}"
DEBUG_VARIANT=""
CONTEXT_FILE=""
AUTO_LENSES="${AUTO_LENSES:-}"
SEQUENTIAL_DIVERSITY="${SEQUENTIAL_DIVERSITY:-}"

args=()
for arg in "$@"; do
  case "${arg}" in
    --debug) DEBUG_MODE=1 ;;
    --debug=*)
      DEBUG_MODE=1
      DEBUG_VARIANT="${arg#--debug=}"
      ;;
    --context=*) CONTEXT_FILE="${arg#--context=}" ;;
    --context)
      echo "Error: --context requires a value (--context=file.md)"
      exit 1
      ;;
    --auto-lenses) AUTO_LENSES=1 ;;
    --sequential-diversity) SEQUENTIAL_DIVERSITY=1 ;;
    *) args+=("${arg}") ;;
  esac
done

# Resolve and validate context file
SHARED_CONTEXT=""
if [[ -n "${CONTEXT_FILE}" ]]; then
  if [[ "${CONTEXT_FILE}" != /* ]]; then
    CONTEXT_FILE="$(pwd)/${CONTEXT_FILE}"
  fi
  if [[ ! -f "${CONTEXT_FILE}" ]]; then
    echo "Error: context file not found: ${CONTEXT_FILE}"
    exit 1
  fi
  SHARED_CONTEXT=$'\n\n'"$(cat "${CONTEXT_FILE}")"
fi

# ─── Detect mode: single prompt + config variants, or multiple prompt files ──
if [[ ${#args[@]} -eq 0 ]]; then
  echo "Usage: $0 [--debug[=variant]] [--auto-lenses] [--sequential-diversity] <prompt-file>"
  echo "       $0 <prompt-1.md> <prompt-2.md> ...  (multi-file mode)"
  exit 1
fi

MULTI_FILE_MODE=false
if [[ ${#args[@]} -gt 1 ]]; then
  MULTI_FILE_MODE=true
fi

# Resolve all prompt files to absolute paths and verify they exist
PROMPT_FILES=()
for f in "${args[@]}"; do
  if [[ "${f}" != /* ]]; then
    f="$(pwd)/${f}"
  fi
  if [[ ! -f "${f}" ]]; then
    echo "Error: ${f} not found"
    exit 1
  fi
  PROMPT_FILES+=("${f}")
done

if ${MULTI_FILE_MODE}; then
  # Multi-file mode: use parent directory name or "multi" as the run name
  PROMPT_NAME="multi-$(date +%H%M%S)"
  BASE_PROMPT="" # not used in multi-file mode
else
  PROMPT_FILE="${PROMPT_FILES[0]}"
  BASE_PROMPT=$(cat "${PROMPT_FILE}")
  PROMPT_NAME=$(basename "${PROMPT_FILE}" .md)
fi

# Directory structure: generated-plans/<prompt-name>/<timestamp>/
# Use absolute paths — they must work after we cd to WORK_DIR.
PLANS_DIR="${SCRIPT_DIR}/generated-plans"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RUN_DIR="${PLANS_DIR}/${PROMPT_NAME}/${TIMESTAMP}"
mkdir -p "${RUN_DIR}"

# ─── Configuration ─────────────────────────────────────────────────────────

# ─── Debug mode defaults ──────────────────────────────────────────────────
# Runs a single variant to test the pipeline without burning tokens on all variants.
#   --debug          → baseline variant, sonnet model, 20 max turns, 10 min timeout
#   --debug=k8s-ops  → k8s-ops variant, sonnet model, 20 max turns, 10 min timeout
#   DEBUG=1          → same as --debug
# Explicit env vars always win: MODEL=opus ./generate-plans.sh --debug ...
if [[ -n "${DEBUG_MODE}" ]]; then
  MODEL="${MODEL:-sonnet}"
  MAX_TURNS="${MAX_TURNS:-20}"
  TIMEOUT_SECS="${TIMEOUT_SECS:-600}"
  MIN_OUTPUT_BYTES=500
  STAGGER_SECS=0
  DEBUG_VARIANT="${DEBUG_VARIANT:-baseline}"
else
  MODEL="${MODEL:-opus}"
  MAX_TURNS="${MAX_TURNS:-80}"
  TIMEOUT_SECS="${TIMEOUT_SECS:-3600}"
  MIN_OUTPUT_BYTES=5000
  STAGGER_SECS=10
fi

# WORK_DIR is resolved after config is loaded (needs work_dir from config).
# Priority: WORK_DIR env var > config work_dir > temp directory.
WORK_DIR_ENV="${WORK_DIR:-}"

# CRITICAL: Override the global CLAUDE_CODE_MAX_OUTPUT_TOKENS unconditionally.
# Your ~/.zshrc sets it to 6000 — far too low for implementation plans (8K-20K tokens).
# Must use = not :- because the var IS set (to 6000) in the shell environment.
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000

# ─── Load project config (variants + add-dirs) ───────────────────────────
ADD_DIRS=()
declare -A VARIANTS
declare -A VARIANT_MODELS
CFG_MCP_CONFIG=""

if ${MULTI_FILE_MODE}; then
  # Multi-file mode: each file IS a complete variant prompt.
  # Variant name = filename without .md extension.
  # Config is still loaded for add_dirs only (variants are ignored).
  for f in "${PROMPT_FILES[@]}"; do
    variant_name=$(basename "${f}" .md)
    VARIANTS[${variant_name}]="__FILE__:${f}"
  done
  echo "  Multi-file mode: ${#VARIANTS[@]} prompt files"
fi

# Load config for add_dirs (and variants in single-file mode).
# Priority: CONFIG env var > config.local.yaml > config.yaml
CONFIG_FILE="${CONFIG:-}"
if [[ -n "${CONFIG_FILE}" ]] && [[ "${CONFIG_FILE}" != /* ]]; then
  CONFIG_FILE="${SCRIPT_DIR}/${CONFIG_FILE}"
fi
if [[ -z "${CONFIG_FILE}" ]]; then
  if [[ -f "${SCRIPT_DIR}/config.local.yaml" ]]; then
    CONFIG_FILE="${SCRIPT_DIR}/config.local.yaml"
  elif [[ -f "${SCRIPT_DIR}/config.yaml" ]]; then
    CONFIG_FILE="${SCRIPT_DIR}/config.yaml"
  fi
fi

if [[ -n "${CONFIG_FILE}" ]]; then
  if ${MULTI_FILE_MODE}; then
    # Multi-file: only load work_dir, add_dirs, mcp_config from config.
    # shellcheck disable=SC2312 # eval of python output is intentional
    eval "$(python3 -c "
import yaml, shlex
with open('${CONFIG_FILE}') as f:
    cfg = yaml.safe_load(f)
wd = str(cfg.get('work_dir') or '').strip()
print(f'CFG_WORK_DIR={shlex.quote(wd)}')
mcp = str(cfg.get('mcp_config') or '').strip()
print(f'CFG_MCP_CONFIG={shlex.quote(mcp)}')
dirs = cfg.get('add_dirs') or []
parts = [shlex.quote(str(d)) for d in dirs]
print('ADD_DIRS=(' + ' '.join(parts) + ')')
")"
  else
    # Single-file: load work_dir, add_dirs, mcp_config, and variants.
    # shellcheck disable=SC2312 # eval of python output is intentional
    eval "$(python3 -c "
import yaml, shlex
with open('${CONFIG_FILE}') as f:
    cfg = yaml.safe_load(f)
wd = str(cfg.get('work_dir') or '').strip()
print(f'CFG_WORK_DIR={shlex.quote(wd)}')
mcp = str(cfg.get('mcp_config') or '').strip()
print(f'CFG_MCP_CONFIG={shlex.quote(mcp)}')
dirs = cfg.get('add_dirs') or []
parts = [shlex.quote(str(d)) for d in dirs]
print('ADD_DIRS=(' + ' '.join(parts) + ')')
variants = cfg.get('variants') or {'baseline': ''}
for name, val in variants.items():
    if isinstance(val, dict):
        guidance = str(val.get('guidance') or '').strip()
        model = str(val.get('model') or '').strip()
    else:
        guidance = str(val).strip() if val else ''
        model = ''
    print(f'VARIANTS[{name}]={shlex.quote(guidance)}')
    if model:
        print(f'VARIANT_MODELS[{name}]={shlex.quote(model)}')
")"
  fi
elif ! ${MULTI_FILE_MODE}; then
  echo "Warning: No config.yaml found. Using baseline-only variant."
  VARIANTS[baseline]=""
fi

# ─── Resolve WORK_DIR ────────────────────────────────────────────────────
# Priority: WORK_DIR env var > config work_dir > temp directory.
# Temp dir means Claude has no access to project files (useful for non-code plans).
if [[ -n "${WORK_DIR_ENV}" ]]; then
  WORK_DIR="${WORK_DIR_ENV}"
elif [[ -n "${CFG_WORK_DIR:-}" ]]; then
  # Resolve relative paths against script directory
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

# NOTE: output_instruction is set per-variant inside the loop (needs md_file path)

# ─── Validate sequential-diversity ────────────────────────────────────────
if [[ -n "${SEQUENTIAL_DIVERSITY}" ]]; then
  if ${MULTI_FILE_MODE}; then
    echo "Error: --sequential-diversity is incompatible with multi-file mode"
    echo "  Multi-file mode defines its own variant prompts."
    exit 1
  fi
  if [[ -n "${DEBUG_MODE}" ]]; then
    echo "Warning: --sequential-diversity has no effect in debug mode (single variant)"
    SEQUENTIAL_DIVERSITY=""
  fi
fi

# ─── Auto-lenses: generate task-specific variants via LLM ────────────────
if [[ -n "${AUTO_LENSES}" ]]; then
  if ${MULTI_FILE_MODE}; then
    echo "Error: --auto-lenses is incompatible with multi-file mode"
    echo "  Multi-file mode already defines its own variants (one per file)."
    exit 1
  fi

  LENS_MODEL="${LENS_MODEL:-haiku}"
  LENS_COUNT="${LENS_COUNT:-4}"
  LENS_TIMEOUT="${LENS_TIMEOUT:-120}"
  export CLAUDE_CODE_MAX_OUTPUT_TOKENS=4000

  echo "── Auto-lenses: generating ${LENS_COUNT} task-specific perspectives (${LENS_MODEL}) ──"

  LENS_PROMPT="Given this planning task, generate exactly ${LENS_COUNT} maximally different
analytical perspectives to approach it from. Each perspective should force
genuinely different trade-offs, priorities, and reasoning paths.

For each perspective, output:
- name: a short kebab-case identifier (e.g., 'risk-first', 'user-centric')
- guidance: 2-3 sentences of specific guidance for that perspective

Output ONLY valid YAML, no other text:
perspectives:
  - name: ...
    guidance: ...

The task:
${BASE_PROMPT}"

  lens_raw=$(timeout "${LENS_TIMEOUT}" \
    claude -p "${LENS_PROMPT}" \
    --model "${LENS_MODEL}" \
    --output-format text \
    --max-turns 3 \
    --dangerously-skip-permissions \
    2>/dev/null) || true

  # Parse YAML response into variants
  # shellcheck disable=SC2312 # eval of python output is intentional
  lens_parsed=$(echo "${lens_raw}" | python3 -c "
import sys, yaml, shlex, re, json

text = sys.stdin.read()

# Strip markdown fences if present
fence = re.search(r'\`\`\`(?:yaml)?\s*\n(.*?)\n\`\`\`', text, re.DOTALL)
if fence:
    text = fence.group(1)

try:
    data = yaml.safe_load(text)
    perspectives = data.get('perspectives', []) if isinstance(data, dict) else []
    if not perspectives:
        print('LENS_FAILED=1')
        sys.exit(0)

    seen = set()
    count = 0
    for p in perspectives:
        name = str(p.get('name', '')).strip().lower()
        name = re.sub(r'[^a-z0-9-]', '-', name).strip('-')
        name = re.sub(r'-+', '-', name)  # collapse consecutive dashes
        guidance = str(p.get('guidance', '')).strip()
        if not name or not guidance:
            continue
        if name in seen:
            print(f'# Warning: duplicate lens name \"{name}\" skipped', file=sys.stderr)
            continue
        seen.add(name)
        g = '## Additional guidance\n' + guidance
        print(f'VARIANTS[{name}]={shlex.quote(g)}')
        count += 1

    if count == 0:
        print('LENS_FAILED=1')
        sys.exit(0)

    # Save for reproducibility
    print(f'LENS_YAML={shlex.quote(yaml.dump(data, default_flow_style=False))}')
except Exception:
    print('LENS_FAILED=1')
" 2>/dev/null) || lens_parsed="LENS_FAILED=1"

  if echo "${lens_parsed}" | grep -q 'LENS_FAILED=1'; then
    echo "  ⚠ Auto-lens generation failed — falling back to config variants"
    # Reset CLAUDE_CODE_MAX_OUTPUT_TOKENS for plan generation
    export CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000
  else
    # Replace config variants with auto-generated ones
    unset VARIANTS
    declare -A VARIANTS
    eval "${lens_parsed}"

    # Verify at least one variant was produced
    if [[ ${#VARIANTS[@]} -eq 0 ]]; then
      echo "  ⚠ Auto-lens parsing produced 0 valid variants — falling back to config variants"
      # Re-load config variants (they were unset above)
      unset VARIANTS
      declare -A VARIANTS
      if [[ -n "${CONFIG_FILE}" ]]; then
        # shellcheck disable=SC2312 # eval of python output is intentional
        eval "$(python3 -c "
import yaml, shlex
with open('${CONFIG_FILE}') as f:
    cfg = yaml.safe_load(f)
variants = cfg.get('variants') or {'baseline': ''}
for name, val in variants.items():
    if isinstance(val, dict):
        guidance = str(val.get('guidance') or '').strip()
    else:
        guidance = str(val).strip() if val else ''
    print(f'VARIANTS[{name}]={shlex.quote(guidance)}')
")"
      else
        VARIANTS[baseline]=""
      fi
    else
      # Save generated lenses for reproducibility
      if [[ -n "${LENS_YAML:-}" ]]; then
        echo "${LENS_YAML}" >"${RUN_DIR}/auto-lenses.yaml"
        echo "  ✓ Generated ${#VARIANTS[@]} lenses → ${RUN_DIR}/auto-lenses.yaml"
      fi
    fi

    # Reset CLAUDE_CODE_MAX_OUTPUT_TOKENS for plan generation
    export CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000
  fi

  echo ""
fi

# ─── Debug mode: filter to single variant (single-file mode only) ────────
if [[ -n "${DEBUG_MODE}" ]] && ! ${MULTI_FILE_MODE}; then
  if [[ -n "${AUTO_LENSES}" ]]; then
    # Auto-lenses + debug: keep only the first generated variant
    first_variant="${!VARIANTS[*]}"
    first_variant="${first_variant%% *}"
    DEBUG_VARIANT="${first_variant}"
    selected_guidance="${VARIANTS[${first_variant}]}"
    unset VARIANTS
    declare -A VARIANTS
    VARIANTS[${first_variant}]="${selected_guidance}"
  else
    if [[ -z "${VARIANTS[${DEBUG_VARIANT}]+x}" ]]; then
      echo "Error: unknown variant '${DEBUG_VARIANT}'"
      echo "Available: ${!VARIANTS[*]}"
      exit 1
    fi
    # Keep only the selected variant
    selected_guidance="${VARIANTS[${DEBUG_VARIANT}]}"
    unset VARIANTS
    declare -A VARIANTS
    VARIANTS[${DEBUG_VARIANT}]="${selected_guidance}"
  fi
fi

# ─── Launch helpers ───────────────────────────────────────────────────────

# _build_output_instruction <md_file>
# Produces the Write-tool output instruction appended to every prompt.
_build_output_instruction() {
  local md_file="$1"
  cat <<OUTINST

## Output format (CRITICAL)
Write the COMPLETE plan to this exact file path using the Write tool:
  ${md_file}

Rules:
1. Do ALL your research first (read files, web search, etc.) — use as many
   turns as needed for thorough research
2. Then use the Write tool ONCE to create the file at the path above with
   the ENTIRE plan content
3. Start the file content with '# Plan'
4. Include ALL sections in that single Write call — do not split the plan
   across multiple Write calls
5. Do NOT write to .claude/plans/ or any other path — ONLY the path above
6. After writing the file, output a brief confirmation (e.g., 'Plan written
   to ${md_file}')
OUTINST
}

# _build_extra_flags
# Outputs --add-dir and --mcp-config flags for claude invocations.
_build_extra_flags() {
  for dir in "${ADD_DIRS[@]}"; do
    if [[ -d "${dir}" ]]; then
      echo "--add-dir"
      echo "${dir}"
    fi
  done
  if [[ -n "${MCP_CONFIG}" ]]; then
    echo "--mcp-config"
    echo "${MCP_CONFIG}"
  fi
}

# _launch_variant <variant> <extra_prompt_context>
# Launches a single variant session in the background. Sets PIDS[$variant].
_launch_variant() {
  local variant="$1"
  local extra_context="${2:-}"
  local md_file="${RUN_DIR}/plan-${variant}.md"
  local logfile="${RUN_DIR}/plan-${variant}.log"

  echo "  → Launching: ${variant}"
  echo "    Plan: ${md_file}"

  local output_instruction
  output_instruction=$(_build_output_instruction "${md_file}")

  # Build the full prompt
  local variant_value="${VARIANTS[${variant}]}"
  local full_prompt
  if [[ "${variant_value}" == __FILE__:* ]]; then
    local prompt_file="${variant_value#__FILE__:}"
    full_prompt="$(cat "${prompt_file}")${SHARED_CONTEXT}${extra_context}${output_instruction}"
  else
    full_prompt="${BASE_PROMPT}${variant_value}${SHARED_CONTEXT}${extra_context}${output_instruction}"
  fi

  # Per-variant model override (falls back to global $MODEL)
  local variant_model="${VARIANT_MODELS[${variant}]:-${MODEL}}"

  # Build extra flags
  local -a extra_flags
  # shellcheck disable=SC2312 # _build_extra_flags only echoes strings; can't fail meaningfully
  mapfile -t extra_flags < <(_build_extra_flags)

  # Run from WORK_DIR so all repos within it are accessible to Claude.
  # --dangerously-skip-permissions: Required for headless -p mode.
  (cd "${WORK_DIR}" \
    && CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 \
      timeout "${TIMEOUT_SECS}" \
      claude -p "${full_prompt}" \
      --model "${variant_model}" \
      --output-format text \
      --max-turns "${MAX_TURNS}" \
      --dangerously-skip-permissions \
      "${extra_flags[@]}" \
      >"${logfile}" 2>&1) &

  PIDS[${variant}]=$!
}

# _wait_for_variants <variant1> [variant2 ...]
# Waits for listed variants and validates their output files.
# Increments $failures and $succeeded.
_wait_for_variants() {
  for variant in "$@"; do
    local pid="${PIDS[${variant}]}"
    local md_file="${RUN_DIR}/plan-${variant}.md"
    local logfile="${RUN_DIR}/plan-${variant}.log"

    if wait "${pid}"; then
      if [[ -f "${md_file}" ]]; then
        local size lines
        size=$(wc -c <"${md_file}" | tr -d ' ')
        lines=$(wc -l <"${md_file}" | tr -d ' ')

        if [[ "${size}" -lt "${MIN_OUTPUT_BYTES}" ]]; then
          echo "  ⚠ ${variant}: plan too small (${size} bytes < ${MIN_OUTPUT_BYTES}). Likely incomplete."
          echo "    Check: ${logfile}"
          ((failures++)) || true
        else
          echo "  ✓ ${variant} completed (${lines} lines, ${size} bytes)"
          ((succeeded++)) || true
        fi
      else
        echo "  ✗ ${variant}: plan file not created (Claude didn't use Write tool)"
        echo "    Check: ${logfile}"
        ((failures++)) || true
      fi
    else
      local exit_code=$?
      if [[ "${exit_code}" -eq 124 ]]; then
        echo "  ✗ ${variant} TIMED OUT after ${TIMEOUT_SECS}s"
      else
        echo "  ✗ ${variant} FAILED (exit code: ${exit_code})"
      fi
      echo "    Check: ${logfile}"
      if [[ -f "${md_file}" ]]; then
        local size
        size=$(wc -c <"${md_file}" | tr -d ' ')
        echo "    (partial plan exists: ${size} bytes)"
      fi
      ((failures++)) || true
    fi
  done
}

# _extract_skeletons <variant1> [variant2 ...]
# Extracts section headings from completed plans as diversity context.
# Prints the skeleton text to stdout.
_extract_skeletons() {
  local skeleton=""
  for variant in "$@"; do
    local md_file="${RUN_DIR}/plan-${variant}.md"
    if [[ -f "${md_file}" ]] && [[ -s "${md_file}" ]]; then
      local headings
      headings=$(grep -E '^#{1,3} ' "${md_file}" || true)
      if [[ -n "${headings}" ]]; then
        skeleton+="
── ${variant} outline ──
${headings}
"
      fi
    fi
  done
  echo "${skeleton}"
}

# ─── Launch sessions ──────────────────────────────────────────────────────

declare -A PIDS
STARTED_AT=$(date +%s)

MODE_LABEL=""
if [[ -n "${DEBUG_MODE}" ]]; then
  MODE_LABEL=" (DEBUG: ${DEBUG_VARIANT} only)"
elif [[ -n "${SEQUENTIAL_DIVERSITY}" ]]; then
  MODE_LABEL=" (sequential-diversity: 2 waves)"
fi

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Generating ${#VARIANTS[@]} plan variant(s)${MODE_LABEL}"
echo "║  Model: ${MODEL} | Max turns: ${MAX_TURNS} | Timeout: ${TIMEOUT_SECS}s"
echo "║  Output: ${RUN_DIR}/"
echo "║  Session CWD: ${WORK_DIR}"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Collect variant names into a sorted array (deterministic wave splitting)
# shellcheck disable=SC2312 # printf | sort can't fail meaningfully
mapfile -t all_variants < <(printf '%s\n' "${!VARIANTS[@]}" | sort)
failures=0
succeeded=0

# Warn if sequential-diversity has too few variants to be useful
if [[ -n "${SEQUENTIAL_DIVERSITY}" ]] && [[ ${#all_variants[@]} -lt 3 ]]; then
  echo "Warning: --sequential-diversity requires >= 3 variants (got ${#all_variants[@]}). Running all-parallel."
  SEQUENTIAL_DIVERSITY=""
fi

if [[ -n "${SEQUENTIAL_DIVERSITY}" ]] && [[ ${#all_variants[@]} -ge 3 ]]; then
  # ── Two-wave generation ──────────────────────────────────────────────
  # Wave 1: first half of variants run in parallel
  # Wave 2: remaining variants run with skeleton context from wave 1
  wave1_count=$((${#all_variants[@]} / 2))
  wave1_variants=("${all_variants[@]:0:${wave1_count}}")
  wave2_variants=("${all_variants[@]:${wave1_count}}")

  echo "── Wave 1: ${#wave1_variants[@]} variants ──"
  for variant in "${wave1_variants[@]}"; do
    _launch_variant "${variant}"
    sleep "${STAGGER_SECS}"
  done
  echo ""
  wave1_pids=""
  for v in "${wave1_variants[@]}"; do
    wave1_pids+="${PIDS[${v}]} "
  done
  echo "  Wave 1 launched (PIDs: ${wave1_pids})"
  echo "  Waiting for wave 1 to complete..."
  echo ""

  _wait_for_variants "${wave1_variants[@]}"

  # Extract skeletons from completed wave 1 plans
  skeleton_text=$(_extract_skeletons "${wave1_variants[@]}")
  diversity_context=""
  if [[ -n "${skeleton_text}" ]]; then
    diversity_context="

## Diversity constraint
The following plan outlines have already been generated by other analysts.
Your plan MUST differ structurally — use different approaches, different
technology choices, or different prioritization. Do NOT repeat their structure.
${skeleton_text}"
    echo ""
    echo "  Extracted skeletons from wave 1 for diversity conditioning"
  fi

  echo ""
  echo "── Wave 2: ${#wave2_variants[@]} variants (diversity-conditioned) ──"
  for variant in "${wave2_variants[@]}"; do
    _launch_variant "${variant}" "${diversity_context}"
    sleep "${STAGGER_SECS}"
  done

  echo ""
  echo "  Wave 2 launched. Waiting for completion..."
  echo ""

  _wait_for_variants "${wave2_variants[@]}"

else
  # ── All-parallel generation (default) ────────────────────────────────
  for variant in "${all_variants[@]}"; do
    _launch_variant "${variant}"
    sleep "${STAGGER_SECS}"
  done

  echo ""
  echo "All ${#VARIANTS[@]} sessions launched (PIDs: ${PIDS[*]})"
  echo "Waiting for completion... (${MODEL}: ~15-25 min per session, ${TIMEOUT_SECS}s timeout)"
  echo ""

  _wait_for_variants "${all_variants[@]}"
fi

# ─── Summary ───────────────────────────────────────────────────────────────

ln -sfn "${TIMESTAMP}" "${PLANS_DIR}/${PROMPT_NAME}/latest"

ELAPSED=$(($(date +%s) - STARTED_AT))
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Done in ${ELAPSED}s. ${succeeded}/${#VARIANTS[@]} plans succeeded.                       ║"
echo "║  Output: ${RUN_DIR}/                                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

ls -lh "${RUN_DIR}"/plan-*.md 2>/dev/null
echo ""

if [[ "${succeeded}" -eq 0 ]]; then
  echo "ERROR: No plans generated. Check logs in ${RUN_DIR}/"
  exit 1
fi

if [[ "${failures}" -gt 0 ]]; then
  echo "⚠  ${failures} plan(s) failed. Check logs:"
  for variant in "${!VARIANTS[@]}"; do
    if [[ ! -s "${RUN_DIR}/plan-${variant}.md" ]]; then
      echo "    ${RUN_DIR}/plan-${variant}.log"
    fi
  done
  echo ""
fi

echo "Next step — merge plans:"
echo "  ./merge-plans.sh ${RUN_DIR}"
echo ""
echo "  or using the symlink:"
echo "  ./merge-plans.sh ${PLANS_DIR}/${PROMPT_NAME}/latest"

# Clean up temp work directory if we created one
if [[ "${WORK_DIR_IS_TEMP:-}" = "true" ]] && [[ -d "${WORK_DIR}" ]]; then
  rm -rf "${WORK_DIR}"
fi
