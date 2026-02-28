# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This is an **LLM plan composition toolkit** — a set of bash scripts that orchestrate multiple parallel Claude Code sessions to generate diverse implementation plans, then merge the best elements into a single plan. It implements a research-backed "best-of-N with prompt variation" pattern.

The scripts are domain-agnostic. Domain-specific configuration lives in `config.yaml` (single-file mode) or as separate prompt files (multi-file mode). Project-specific configs can be kept in a private `projects/` git submodule.

## Pipeline

1. **Generate** (`generate-plans.sh`): Launches parallel `claude -p` sessions, each with a different prompt. Two modes:
   - **Single-file**: One prompt + variant guidance from `config.yaml` (default: 4 variants).
   - **Multi-file**: Each prompt file is a standalone variant. Supports `--context=shared.md` to append common context to all prompts.
   Each session writes a plan to a file via the Write tool.

2. **Merge** (`merge-plans.sh`): Takes the generated plans and produces a merged plan. Two modes:
   - `agent-teams` (default): Interactive Claude session with Agent Teams — spawns advocate agents that debate each plan, then the lead synthesizes.
   - `simple`: Headless `claude -p` that reads all plans inline and produces a merged plan.

3. **Monitor** (`monitor-sessions.sh`): Real-time dashboard showing running Claude sessions — tracks PID, variant, transcript size, tool calls, subagents, token usage, context window utilization, compactions, and last action. Parses JSONL transcripts from `~/.claude/projects/`. Auto-exits in `--watch` mode when all sessions finish.

## Configuration

Variant prompts and additional directories are defined in YAML config files.

**Priority**: `CONFIG` env var > `config.local.yaml` > `config.yaml`

```yaml
# config.yaml
work_dir: ""          # empty = temp dir (no file access); set for codebase plans
add_dirs: []          # extra dirs beyond work_dir

# 4 variants recommended (see research/number-of-llms-sessions.md)
variants:
  baseline: ""
  simplicity: |
    ## Additional guidance
    Prioritize simplicity...
  depth: |
    ## Additional guidance
    Go deep on specifics...
  breadth: |
    ## Additional guidance
    Take a wide view...
```

- `config.yaml` — generic defaults (committed to repo)
- `config.local.yaml` — personal overrides (gitignored)
- `projects/` — optional git submodule for project-specific configs (private)

Usage: `CONFIG=projects/hyperflow/config.yaml ./generate-plans.sh my-prompt.md`

### Merge Configuration

Merge prompts (dimensions, role, output goal) are configured via `merge-config.yaml`.

**Priority**: `MERGE_CONFIG` env var > `merge-config.local.yaml` > `merge-config.yaml`

```yaml
# merge-config.yaml
work_dir: ""          # empty = temp dir; set for codebase-aware merge
project_description: "the project"
role: "an expert analyst"
dimensions:
  - Approach and strategy
  - Scope and priorities
  - Technical depth and specificity
advocate_instructions: |
  Argue for its approach in each dimension...
output_goal: |
  The merged plan must be standalone...
output_title: "Merged Plan"
```

Usage: `MERGE_CONFIG=projects/hackathon/merge-config.yaml ./merge-plans.sh generated-plans/latest`

## Commands

```bash
# Generate plans (all variants from config, Opus, ~15-25 min)
./generate-plans.sh <prompt-file.md>

# Generate with overrides
MODEL=sonnet ./generate-plans.sh my-prompt.md
CONFIG=projects/hyperflow/config.yaml ./generate-plans.sh my-prompt.md

# Multi-file mode (each file = one variant)
./generate-plans.sh prompt-a.md prompt-b.md prompt-c.md prompt-d.md

# Multi-file with shared context appended to each prompt
./generate-plans.sh --context=projects/agentregistry/prompts/00-common-context.md \
  projects/agentregistry/prompts/0[1-4]-*.md

# Debug mode: single variant, sonnet, fast
./generate-plans.sh --debug my-prompt.md           # baseline only
./generate-plans.sh --debug=depth my-prompt.md     # specific variant

# Merge plans (interactive agent-teams debate)
./merge-plans.sh generated-plans/<prompt-name>/latest

# Merge plans (headless, automated)
MERGE_MODE=simple ./merge-plans.sh generated-plans/<prompt-name>/latest

# Merge with project-specific config
MERGE_CONFIG=projects/agentregistry/merge-config.yaml ./merge-plans.sh generated-plans/multi-*/latest

# Monitor running sessions
./monitor-sessions.sh              # one-shot table
./monitor-sessions.sh --watch      # refresh every 15s
./monitor-sessions.sh --watch 5    # refresh every 5s (auto-exits when done)
```

## Output Structure

```
# Single-file mode:
generated-plans/<prompt-name>/<timestamp>/
  plan-baseline.md          # unguided variant
  plan-simplicity.md        # minimal scope
  plan-depth.md             # detailed specifics
  plan-breadth.md           # wide view

# Multi-file mode:
generated-plans/multi-<HHMMSS>/<timestamp>/
  plan-01-codebase-surgeon.md    # variant name = filename
  plan-02-protocol-architect.md
  ...

# Common:
  plan-*.log                # session stdout+stderr (for debugging)
  merge-prompt.md           # generated merge instructions (agent-teams mode)
  merged-plan.md            # final merged output
generated-plans/<name>/latest -> <timestamp>   # symlink
```

## Key Design Decisions

- **Default: 4 variants (configurable)**: Research shows diminishing returns from same-model ensembles — N=3-4 captures ~80% of total gain (arXiv:2506.07962). The number of variants is defined in `config.yaml`; add more or fewer as needed. Diversity comes from prompt variation, not repetition. See `research/number-of-llms-sessions.md`.
- **Write tool for output capture**: `--output-format text` only captures the LAST assistant message. Multi-turn research sessions lose intermediate content. The prompt instructs Claude to write the complete plan via the Write tool.
- **Configurable work_dir**: Sessions run from `work_dir` (set in config). If empty or missing, sessions run in a temporary directory with no file access — useful for non-codebase plans. `--add-dir` flags don't propagate to subagents, so CWD must encompass all needed files.
- **`CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000`**: Overrides any shell default, which may truncate plans.
- **`--dangerously-skip-permissions`**: Required for headless `-p` mode where no interactive user can approve tool use.
- **Monitor variant detection**: Uses output file path matching (`plan-baseline.md`, etc.) which works regardless of prompt content. Falls back to prompt text matching for legacy compatibility.

## Environment Variables

| Variable | Default (normal) | Default (debug) | Purpose |
|---|---|---|---|
| `MODEL` | `opus` | `sonnet` | Claude model |
| `MAX_TURNS` | `80` | `20` | Max API round-trips per session |
| `TIMEOUT_SECS` | `3600` | `600` | Hard kill timeout |
| `WORK_DIR` | from config | from config | CWD for Claude sessions (overrides config `work_dir`) |
| `CONFIG` | — | — | Path to YAML config file |
| `MERGE_MODE` | `agent-teams` | — | `agent-teams` or `simple` |
| `MERGE_CONFIG` | — | — | Path to merge YAML config file |
| `DEBUG` | — | `1` | Enable debug mode |

## Project-Specific Configs (`projects/` submodule)

Project-specific prompts, variant configs, and merge configs live in an optional private git submodule at `projects/`. This keeps the public repo generic.

```
projects/                              # git submodule (private)
  hackathon/merge-config.yaml          # idea synthesis merge dimensions
  hyperflow/config.yaml                # HyperFlow variant prompts + add_dirs
  hyperflow/merge-config.yaml          # HyperFlow merge dimensions
  agentregistry/merge-config.yaml      # agentregistry merge dimensions
  agentregistry/prompts/               # multi-file prompts with shared context
```

Setup: `git submodule update --init` after cloning. The toolkit works without the submodule — it falls back to `config.yaml` and `merge-config.yaml` defaults.

## Demo Recording

The `demo/` directory contains tools for recording terminal demos:
- `record-demo.sh` — tmux-based script that sets up split panes (generate + monitor)
- `demo.md` — instructions for recording and post-processing

Usage: `asciinema rec demo.cast -c "MODEL=sonnet MAX_TURNS=8 ./demo/record-demo.sh"`

## Research Notes

The `research/` directory contains analysis that informed the design:
- `number-of-llms-sessions.md` — Why N=4 sessions (logarithmic returns, correlated errors, merge cost explosion)
- `cloud-sessions-analysis.md` — Comparison of local `claude -p`, cloud sessions, and agent teams approaches
- `turns-in-claude.md` — How turns work, subagent turn counting, and `--max-turns` behavior
