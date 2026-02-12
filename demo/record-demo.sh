#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Record a demo of the full generate → monitor → merge pipeline.
#
# Usage:
#   asciinema rec demo.cast -c ./record-demo.sh
#
# What happens:
#   1. tmux split: top = generate (4 variants), bottom = monitor
#   2. After generate completes, you take over in the top pane
#   3. Run merge, interact with Claude, show the final plan
#   4. Exit tmux (Ctrl+D both panes) to stop the recording
#
# Tips:
#   - Use MODEL=sonnet for a faster/cheaper demo (~5-10 min vs 15-25 min)
#   - Ctrl+C in bottom pane to stop monitor when generate finishes
#   - After merge: head -80 generated-plans/test-prompt/latest/merged-plan.md
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

MODEL="${MODEL:-sonnet}"
MAX_TURNS="${MAX_TURNS:-8}"
PROMPT="${PROMPT:-test-prompt.md}"
WORK_DIR="${WORK_DIR:-$SCRIPT_DIR}"
PROMPT_NAME=$(basename "$PROMPT" .md)

export MAX_TURNS WORK_DIR MODEL

# Ensure WORK_DIR exists
mkdir -p "$WORK_DIR"

# Kill any leftover demo session
tmux kill-session -t demo 2>/dev/null || true

# Create session, split, and attach — all in one call.
# Top pane: show prompt, then generate. Falls back to bash when done.
# Bottom pane: monitor with delay for sessions to start.
exec tmux new-session -s demo \
    "cd $SCRIPT_DIR && echo '# Default model is Opus (\$\$\$). Using Sonnet for this demo to save cost.' && echo '# MAX_TURNS=$MAX_TURNS (default: 80) — keeping it short for the demo.' && echo '# WORK_DIR=$WORK_DIR — Claude sessions run from here.' && echo '# MODEL=$MODEL MAX_TURNS=$MAX_TURNS ./record-demo.sh' && echo '' && sleep 3 && cat $PROMPT && echo '' && echo '── Generating plans ──' && echo '' && MODEL=$MODEL WORK_DIR=$WORK_DIR MAX_TURNS=$MAX_TURNS ./generate-plans.sh $PROMPT; echo ''; echo 'Generate done. Now run:'; echo '  ls -lh generated-plans/$PROMPT_NAME/latest/plan-*.md'; echo '  ./merge-plans.sh generated-plans/$PROMPT_NAME/latest'; exec bash" \; \
    split-window -v \
    "cd $SCRIPT_DIR && sleep 8 && ./monitor-sessions.sh --watch 2; exec bash" \; \
    select-pane -t 0
