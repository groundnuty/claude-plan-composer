#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Generate multiple implementation plans using parallel Claude Code sessions.
#
# Output: generated-plans/<prompt-name>/<timestamp>/plan-{variant}.md
#
# WHY 4 SESSIONS?
#   Research shows diminishing returns from same-model LLM ensembles:
#   - Correlated errors: same model = 60% error agreement (arXiv:2506.07962)
#   - Self-MoA (Li et al. 2025): multiple runs of best model > mixing models
#   - Best-of-N: logarithmic returns, N=3-4 captures ~80% of total gain
#   - Merging cost: comparing 4 plans = 6 pairs (still manageable)
#   Diversity comes from PROMPT VARIATION, not from more runs of same prompt.
#   4 variants cover: baseline, simplicity, framework patterns, K8s operations.
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
#   v2 runs `claude -p` from the common parent hyperflow/ directory so all
#   repos are within the CWD sandbox tree.
#
# Usage:
#   ./generate-plans.sh <prompt-file>                  # all 4 variants
#   ./generate-plans.sh initial-project-promt.md       # example
#   MODEL=sonnet ./generate-plans.sh my-prompt.md      # override model
#   ./generate-plans.sh --debug my-prompt.md           # single variant (baseline)
#   ./generate-plans.sh --debug=k8s-ops my-prompt.md   # single variant (chosen)
#   DEBUG=1 ./generate-plans.sh my-prompt.md            # same as --debug
#
# After completion, merge with:
#   ./merge-plans.sh generated-plans/<prompt-name>/latest
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Parse arguments ──────────────────────────────────────────────────────
# Supports: --debug, --debug=<variant>, positional <prompt-file>
DEBUG_MODE="${DEBUG:-}"
DEBUG_VARIANT=""

args=()
for arg in "$@"; do
    case "$arg" in
        --debug)    DEBUG_MODE=1 ;;
        --debug=*)  DEBUG_MODE=1; DEBUG_VARIANT="${arg#--debug=}" ;;
        *)          args+=("$arg") ;;
    esac
done

PROMPT_FILE="${args[0]:?Usage: $0 [--debug[=variant]] <prompt-file>}"

# Resolve prompt file to absolute path (may be relative to CWD)
if [[ "$PROMPT_FILE" != /* ]]; then
    PROMPT_FILE="$(pwd)/$PROMPT_FILE"
fi

if [ ! -f "$PROMPT_FILE" ]; then
    echo "Error: $PROMPT_FILE not found"
    exit 1
fi

BASE_PROMPT=$(cat "$PROMPT_FILE")

# Directory structure: generated-plans/<prompt-name>/<timestamp>/
# Use absolute paths — they must work after we cd to WORK_DIR.
PLANS_DIR="$SCRIPT_DIR/generated-plans"
PROMPT_NAME=$(basename "$PROMPT_FILE" .md)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RUN_DIR="$PLANS_DIR/$PROMPT_NAME/$TIMESTAMP"
mkdir -p "$RUN_DIR"

# ─── Configuration ─────────────────────────────────────────────────────────

# ─── Debug mode defaults ──────────────────────────────────────────────────
# Runs a single variant to test the pipeline without burning tokens on all 4.
#   --debug          → baseline variant, sonnet model, 20 max turns, 10 min timeout
#   --debug=k8s-ops  → k8s-ops variant, sonnet model, 20 max turns, 10 min timeout
#   DEBUG=1          → same as --debug
# Explicit env vars always win: MODEL=opus ./generate-plans.sh --debug ...
if [ -n "$DEBUG_MODE" ]; then
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

# SANDBOX FIX: Run claude -p from this common parent directory.
# All repos (1000genome/, hyperflow-k8s-deployment/, hyperflow/) are under it.
# This ensures both the parent session AND subagents can read all files.
WORK_DIR="${WORK_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

# CRITICAL: Override the global CLAUDE_CODE_MAX_OUTPUT_TOKENS unconditionally.
# Your ~/.zshrc sets it to 6000 — far too low for implementation plans (8K-20K tokens).
# Must use = not :- because the var IS set (to 6000) in the shell environment.
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000

# ─── Load project config (variants + add-dirs) ───────────────────────────
# Priority: CONFIG env var > config.local.yaml > config.yaml
# Usage: CONFIG=config.hyperflow.yaml ./generate-plans.sh my-prompt.md
CONFIG_FILE="${CONFIG:-}"
if [ -n "$CONFIG_FILE" ] && [[ "$CONFIG_FILE" != /* ]]; then
    CONFIG_FILE="$SCRIPT_DIR/$CONFIG_FILE"
fi
if [ -z "$CONFIG_FILE" ] && [ -f "$SCRIPT_DIR/config.local.yaml" ]; then
    CONFIG_FILE="$SCRIPT_DIR/config.local.yaml"
elif [ -f "$SCRIPT_DIR/config.yaml" ]; then
    CONFIG_FILE="$SCRIPT_DIR/config.yaml"
fi

ADD_DIRS=()
declare -A VARIANTS

if [ -n "$CONFIG_FILE" ]; then
    # Parse YAML into bash-friendly format using Python + PyYAML.
    eval "$(python3 -c "
import yaml, sys, shlex

with open('$CONFIG_FILE') as f:
    cfg = yaml.safe_load(f)

# Emit ADD_DIRS array
dirs = cfg.get('add_dirs') or []
parts = []
for d in dirs:
    parts.append(shlex.quote(str(d)))
print('ADD_DIRS=(' + ' '.join(parts) + ')')

# Emit VARIANTS associative array entries
variants = cfg.get('variants') or {'baseline': ''}
for name, guidance in variants.items():
    val = str(guidance).strip() if guidance else ''
    print(f'VARIANTS[{name}]={shlex.quote(val)}')
")"
else
    echo "Warning: No config.yaml found. Using baseline-only variant."
    VARIANTS[baseline]=""
fi

# NOTE: output_instruction is set per-variant inside the loop (needs md_file path)

# ─── Debug mode: filter to single variant ─────────────────────────────────
if [ -n "$DEBUG_MODE" ]; then
    if [ -z "${VARIANTS[$DEBUG_VARIANT]+x}" ]; then
        echo "Error: unknown variant '$DEBUG_VARIANT'"
        echo "Available: ${!VARIANTS[*]}"
        exit 1
    fi
    # Keep only the selected variant
    selected_guidance="${VARIANTS[$DEBUG_VARIANT]}"
    unset VARIANTS
    declare -A VARIANTS
    VARIANTS[$DEBUG_VARIANT]="$selected_guidance"
fi

# ─── Launch sessions ──────────────────────────────────────────────────────

declare -A PIDS
STARTED_AT=$(date +%s)

MODE_LABEL=""
if [ -n "$DEBUG_MODE" ]; then
    MODE_LABEL=" (DEBUG: ${DEBUG_VARIANT} only)"
fi

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Generating ${#VARIANTS[@]} plan variant(s)${MODE_LABEL}"
echo "║  Model: $MODEL | Max turns: $MAX_TURNS | Timeout: ${TIMEOUT_SECS}s"
echo "║  Output: $RUN_DIR/"
echo "║  Session CWD: $WORK_DIR"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

for variant in "${!VARIANTS[@]}"; do
    md_file="$RUN_DIR/plan-${variant}.md"
    logfile="$RUN_DIR/plan-${variant}.log"

    echo "  → Launching: $variant"
    echo "    Plan: $md_file"

    # OUTPUT FIX: Tell Claude to write the plan to a file using the Write tool.
    #
    # Why not --output-format text?
    #   `--output-format text` returns only the LAST assistant message (the
    #   `result` field of SDKResultMessage). When Claude researches across
    #   multiple turns, the actual plan content is in intermediate messages
    #   and only a summary like "The complete plan has been delivered above"
    #   gets captured. This is confirmed by GitHub issues #2904 and #3359.
    #
    # Why not --output-format stream-json?
    #   Would capture everything but also includes research notes, tool call
    #   context, and internal reasoning — noisy and hard to extract cleanly.
    #
    # Write tool approach:
    #   Claude writes the plan directly to the file. Simple, reliable, and
    #   the plan file contains exactly the plan — nothing else.
    output_instruction="

## Output format (CRITICAL)
Write the COMPLETE plan to this exact file path using the Write tool:
  ${md_file}

Rules:
1. Do ALL your research first (read files, web search, etc.) — use as many
   turns as needed for thorough research
2. Then use the Write tool ONCE to create the file at the path above with
   the ENTIRE plan content
3. Start the file content with '# HyperFlow Conductor Implementation Plan'
4. Include ALL sections in that single Write call — do not split the plan
   across multiple Write calls
5. Do NOT write to .claude/plans/ or any other path — ONLY the path above
6. After writing the file, output a brief confirmation (e.g., 'Plan written
   to ${md_file}')"

    full_prompt="${BASE_PROMPT}${VARIANTS[$variant]}${output_instruction}"

    # Build --add-dir flags for directories that exist
    add_dir_flags=()
    for dir in "${ADD_DIRS[@]}"; do
        if [ -d "$dir" ]; then
            add_dir_flags+=(--add-dir "$dir")
        fi
    done

    # Run from WORK_DIR so all repos are within the sandbox tree.
    # Claude writes the plan to $md_file via the Write tool.
    # stdout + stderr go to logfile for debugging.
    #
    # --dangerously-skip-permissions: Required for headless -p mode.
    #   Without it, Write and WebSearch are denied ("you haven't granted
    #   permissions yet") because there's no interactive user to approve.
    #   Safe here: sessions only read source files + write one plan file.
    (cd "$WORK_DIR" && \
        CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 \
        timeout "$TIMEOUT_SECS" \
        claude -p "$full_prompt" \
            --model "$MODEL" \
            --output-format text \
            --max-turns "$MAX_TURNS" \
            --dangerously-skip-permissions \
            "${add_dir_flags[@]}" \
            > "$logfile" 2>&1) &

    PIDS[$variant]=$!

    # Stagger launches to reduce rate limit pressure.
    # All sessions share the same org-level RPM/TPM limits.
    sleep "$STAGGER_SECS"
done

echo ""
echo "All ${#VARIANTS[@]} sessions launched (PIDs: ${PIDS[*]})"
echo "Waiting for completion... ($MODEL: ~15-25 min per session, ${TIMEOUT_SECS}s timeout)"
echo ""

# ─── Wait and validate ────────────────────────────────────────────────────

failures=0
succeeded=0

for variant in "${!PIDS[@]}"; do
    pid=${PIDS[$variant]}
    md_file="$RUN_DIR/plan-${variant}.md"
    logfile="$RUN_DIR/plan-${variant}.log"

    if wait "$pid"; then
        if [ -f "$md_file" ]; then
            size=$(wc -c < "$md_file" | tr -d ' ')
            lines=$(wc -l < "$md_file" | tr -d ' ')

            if [ "$size" -lt "$MIN_OUTPUT_BYTES" ]; then
                echo "  ⚠ $variant: plan too small (${size} bytes < ${MIN_OUTPUT_BYTES}). Likely incomplete."
                echo "    Check: $logfile"
                ((failures++)) || true
            else
                echo "  ✓ $variant completed (${lines} lines, ${size} bytes)"
                ((succeeded++)) || true
            fi
        else
            echo "  ✗ $variant: plan file not created (Claude didn't use Write tool)"
            echo "    Check: $logfile"
            ((failures++)) || true
        fi
    else
        exit_code=$?
        if [ "$exit_code" -eq 124 ]; then
            echo "  ✗ $variant TIMED OUT after ${TIMEOUT_SECS}s"
        else
            echo "  ✗ $variant FAILED (exit code: $exit_code)"
        fi
        echo "    Check: $logfile"
        # Check if partial plan was written before timeout/failure
        if [ -f "$md_file" ]; then
            size=$(wc -c < "$md_file" | tr -d ' ')
            echo "    (partial plan exists: ${size} bytes)"
        fi
        ((failures++)) || true
    fi
done

# ─── Summary ───────────────────────────────────────────────────────────────

ln -sfn "$TIMESTAMP" "$PLANS_DIR/$PROMPT_NAME/latest"

ELAPSED=$(( $(date +%s) - STARTED_AT ))
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Done in ${ELAPSED}s. ${succeeded}/${#VARIANTS[@]} plans succeeded.                       ║"
echo "║  Output: $RUN_DIR/                                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

ls -lh "$RUN_DIR"/plan-*.md 2>/dev/null
echo ""

if [ $succeeded -eq 0 ]; then
    echo "ERROR: No plans generated. Check logs in $RUN_DIR/"
    exit 1
fi

if [ $failures -gt 0 ]; then
    echo "⚠  $failures plan(s) failed. Check logs:"
    for variant in "${!VARIANTS[@]}"; do
        if [ ! -s "$RUN_DIR/plan-${variant}.md" ]; then
            echo "    $RUN_DIR/plan-${variant}.log"
        fi
    done
    echo ""
fi

echo "Next step — merge plans:"
echo "  ./merge-plans.sh $RUN_DIR"
echo ""
echo "  or using the symlink:"
echo "  ./merge-plans.sh $PLANS_DIR/$PROMPT_NAME/latest"
