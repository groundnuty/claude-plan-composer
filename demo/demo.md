# Recording a Demo

## Prerequisites

- `asciinema` installed (`brew install asciinema`)
- `tmux` installed (`brew install tmux`)
- Claude Code CLI with API access

## Quick start

```bash
# Record the demo (Sonnet model, 8 turns, ~5-10 min)
cd demo/
rm -f demo.cast && asciinema rec demo.cast -c "MODEL=sonnet MAX_TURNS=8 ./record-demo.sh"
```

## What the recording shows

The script opens a tmux split terminal:

- **Top pane**: Shows the prompt file, then runs `generate-plans.sh` (4 variants)
- **Bottom pane**: `monitor-sessions.sh` showing live progress (auto-exits when done)

## After generate completes

Type these in the top pane:

```bash
# Show the 4 generated plans
ls -lh generated-plans/test-prompt/latest/plan-*.md

# Option A: Headless merge (fast, no interaction)
MERGE_MODE=simple ./merge-plans.sh generated-plans/test-prompt/latest

# Option B: Interactive agent-teams merge (longer, shows debate)
./merge-plans.sh generated-plans/test-prompt/latest

# Show the final merged plan
head -80 generated-plans/test-prompt/latest/merged-plan.md
```

Then Ctrl+D to stop the recording.

## Post-processing

Cap idle time to speed up the recording:

```bash
python3 trim-idle.py demo.cast --max-idle 2.0
```

## Upload

```bash
asciinema upload demo.cast
```

Update the asciinema ID in `../README.md` (replace `PLACEHOLDER`).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MODEL` | `sonnet` | Claude model for all sessions |
| `MAX_TURNS` | `8` | Max API turns per session |
| `WORK_DIR` | `$SCRIPT_DIR` | CWD for Claude sessions |
| `PROMPT` | `test-prompt.md` | Prompt file to use |

## Files

| File | Purpose |
|---|---|
| `record-demo.sh` | Tmux-based demo script (called by asciinema) |
| `trim-idle.py` | Post-processing: cap idle time in .cast files |
| `demo.cast` | Latest recording (gitignored) |
| `demo-backup.cast` | Backup of previous recording (gitignored) |
