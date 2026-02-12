#!/usr/bin/env bash
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
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Input validation ─────────────────────────────────────────────────────

RUN_DIR="${1:?Usage: $0 <plans-directory>}"

# Resolve symlinks (e.g. generated-plans/latest → generated-plans/20260212-...)
RUN_DIR=$(cd "$RUN_DIR" && pwd)

# Find plan files
plans=()
for f in "$RUN_DIR"/plan-*.md; do
    [ -f "$f" ] || continue
    size=$(wc -c < "$f" | tr -d ' ')
    if [ "$size" -gt 1000 ]; then
        plans+=("$f")
    else
        echo "  Skipping $(basename "$f") — too small (${size} bytes)"
    fi
done

if [ ${#plans[@]} -lt 2 ]; then
    echo "ERROR: Need at least 2 plan files in $RUN_DIR/, found ${#plans[@]}."
    echo "  Run ./generate-plans.sh first."
    exit 1
fi

echo "Found ${#plans[@]} plans in $RUN_DIR/:"
for f in "${plans[@]}"; do
    lines=$(wc -l < "$f" | tr -d ' ')
    echo "  - $(basename "$f") (${lines} lines)"
done
echo ""

# ─── Configuration ─────────────────────────────────────────────────────────

MODEL="${MODEL:-opus}"
MERGE_MODE="${MERGE_MODE:-agent-teams}"
TIMEOUT_SECS="${TIMEOUT_SECS:-3600}"

# SANDBOX FIX: Run claude from this common parent directory.
# All repos (1000genome/, hyperflow-k8s-deployment/, hyperflow/) are under it.
# This ensures both the parent session AND subagents can read all files.
WORK_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# CRITICAL: Override the global CLAUDE_CODE_MAX_OUTPUT_TOKENS unconditionally.
# ~/.zshrc sets it to 6000 — far too low for merged plans (20K-40K tokens).
# Must use = not :- because the var IS set (to 6000) in the shell environment.
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000

# Output file (absolute path — works from any CWD)
merge_md="$RUN_DIR/merged-plan.md"

# ─── Agent Teams merge ─────────────────────────────────────────────────────

if [ "$MERGE_MODE" = "agent-teams" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Agent Teams merge (interactive)"
    echo ""

    # Write the merge prompt (with absolute output path)
    merge_prompt_file="$RUN_DIR/merge-prompt.md"
    cat > "$merge_prompt_file" << PROMPT_HEADER_EOF
# Agent Teams Merge — Competing Advocates

I have generated multiple implementation plans for the HyperFlow Conductor.
Each plan was generated with a different focus. Your job is to merge the
best elements into one final plan.

## Instructions

Create an agent team with these teammates:

PROMPT_HEADER_EOF

    # One advocate per plan
    advocate_num=0
    for plan_file in "${plans[@]}"; do
        variant_name=$(basename "$plan_file" .md | sed 's/plan-//')
        ((advocate_num++)) || true
        cat >> "$merge_prompt_file" << EOF
- **Advocate ${advocate_num} (${variant_name})**: Read \`${plan_file}\` and become
  its champion. Argue for its approach in each dimension. Challenge the other
  advocates' plans where yours is stronger. Concede where yours is weaker.
  Be specific — cite exact sections, trade-offs, and code examples.

EOF
    done

    # Use unquoted heredoc so $merge_md expands to absolute path
    cat >> "$merge_prompt_file" << PROMPT_FOOTER_EOF

## Team lead role

You (the lead) will:
1. Have each advocate present their plan's strengths (2-3 min each)
2. Facilitate a structured debate across these dimensions:
   - Staging strategy (stages, granularity, boundaries)
   - MVP scope (what's in/out, validation gates)
   - K8s testing strategy (provider, client, fixtures)
   - Deployment detail (steps, commands, specificity)
   - Code architecture (package layout, modularity, models)
   - Reference documentation (academic papers, HyperFlow internals)
   - Implementation planning (PR breakdown, acceptance criteria)
   - Workflow delivery mechanism
3. After the debate, produce:
   - A comparison table with the winner per dimension + justification
   - A COMPLETE merged plan taking the best of each
   - The merged plan must be standalone — a developer implements from it alone

## Constraints for advocates
- Use delegate mode — do NOT implement anything yourself, only coordinate
- Require advocates to READ their assigned plan file before debating
- Each advocate must identify at least 2 weaknesses in their OWN plan
- Each advocate must identify at least 2 strengths in a COMPETING plan

## Output (CRITICAL)
Write the final merged plan to this exact file path using the Write tool:
  ${merge_md}
PROMPT_FOOTER_EOF

    echo "  Merge prompt: $merge_prompt_file"
    echo "  Output: $merge_md"
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
    exec env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \
        CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 \
        claude --model "$MODEL" \
        "Read the merge prompt at $merge_prompt_file and follow its instructions. The plan files are in $RUN_DIR/."

# ─── Simple headless merge ─────────────────────────────────────────────────

elif [ "$MERGE_MODE" = "simple" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Simple merge (headless) with $MODEL..."
    echo "  Output: $merge_md"
    echo ""

    # Build prompt with all plans inline
    MERGE_PROMPT="You are an expert technical architect. Below are ${#plans[@]} implementation
plans for the same project, each generated with different focus areas.

Your task:
1. Produce a COMPARISON TABLE for each dimension:
   - Staging strategy (number of stages, granularity, boundaries)
   - MVP scope (what's in/out, validation gates)
   - K8s testing strategy (provider, Python client, fixtures)
   - Deployment detail (steps, commands, specificity)
   - Code architecture (package layout, modularity, models)
   - Reference documentation (academic papers, external refs, HyperFlow internals)
   - Implementation planning (PR breakdown, acceptance criteria)
   - Workflow delivery mechanism

2. For each dimension, identify the WINNER with a one-sentence justification.

3. Produce a MERGED PLAN that takes the best of each:
   - Use the winner's approach for each dimension
   - Resolve any conflicts between dimensions coherently
   - The merged plan should be a complete, standalone implementation blueprint
   - Include all sections from the original prompt (stages, code examples,
     testing plan, Makefile, PR breakdown, risks, etc.)

IMPORTANT: The merged plan must be COMPLETE and ACTIONABLE — a developer
should be able to implement from it without referencing the source plans.

"

    for plan_file in "${plans[@]}"; do
        variant_name=$(basename "$plan_file" .md | sed 's/plan-//')
        MERGE_PROMPT+="
═══════════════════════════════════════════════════════════════
PLAN: ${variant_name}
═══════════════════════════════════════════════════════════════

$(cat "$plan_file")

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
3. Start the file content with '# HyperFlow Conductor Implementation Plan (Merged)'
4. Include ALL sections in that single Write call — do not split across
   multiple Write calls
5. Do NOT write to .claude/plans/ or any other path — ONLY the path above
6. After writing the file, output a brief confirmation
"

    logfile="$RUN_DIR/merge.log"

    # Run from WORK_DIR so subagents can access source repos for verification.
    # Claude writes merged plan to $merge_md via Write tool.
    # stdout + stderr go to logfile for debugging.
    #
    # --dangerously-skip-permissions: Required for headless -p mode.
    #   Without it, Write tool is denied ("you haven't granted permissions yet")
    #   because there's no interactive user to approve.
    (cd "$WORK_DIR" && \
        CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 \
        timeout "$TIMEOUT_SECS" \
        claude -p "$MERGE_PROMPT" \
            --model "$MODEL" \
            --output-format text \
            --max-turns 30 \
            --dangerously-skip-permissions \
            > "$logfile" 2>&1) || true
    # || true: prevent set -e from killing the script on failure.
    # We validate the output file below instead.

    if [ -f "$merge_md" ]; then
        merge_size=$(wc -c < "$merge_md" | tr -d ' ')
        merge_lines=$(wc -l < "$merge_md" | tr -d ' ')

        if [ "$merge_size" -lt 5000 ]; then
            echo "  ⚠ Merge output too small (${merge_size} bytes < 5000). Likely incomplete."
            echo "    Check: $logfile"
            exit 1
        fi

        echo "  ✓ Merge completed (${merge_lines} lines, ${merge_size} bytes)"
        echo ""
        echo "  Output: $merge_md"
        echo ""
        echo "  Next steps:"
        echo "    1. Review: less $merge_md"
        echo "    2. Iterate: claude --resume"
        echo "    3. Adopt:   cp $merge_md ../.claude/plans/hyperflow-conductor.md"
    else
        echo "  ✗ Merge failed — plan file not created (Claude didn't use Write tool)"
        echo "    Check: $logfile"
        echo "    Retry: $0 $RUN_DIR"
        exit 1
    fi

else
    echo "ERROR: Unknown MERGE_MODE=$MERGE_MODE (expected: agent-teams, simple)"
    exit 1
fi
