# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This is an **LLM plan composition toolkit** — a set of bash scripts that orchestrate multiple parallel Claude Code sessions to generate diverse implementation plans, then merge the best elements into a single plan. It implements a research-backed "best-of-N with prompt variation" pattern.

The domain context is HyperFlow (scientific workflow engine) and 1000genome workflow deployment on Kubernetes, but the scripts are general-purpose and work with any prompt file.

## Pipeline

The workflow is a two-phase pipeline:

1. **Generate** (`generate-plans.sh`): Launches 4 parallel `claude -p` sessions, each with a different prompt variant (baseline, simplicity, framework-depth, k8s-ops). Each session researches the codebase and writes a plan to a file via the Write tool.

2. **Merge** (`merge-plans.sh`): Takes the generated plans and produces a merged plan. Two modes:
   - `agent-teams` (default): Interactive Claude session with Agent Teams — spawns advocate agents that debate each plan, then the lead synthesizes.
   - `simple`: Headless `claude -p` that reads all plans inline and produces a merged plan.

3. **Monitor** (`monitor-sessions.sh`): Real-time dashboard showing running Claude sessions — tracks PID, variant, transcript size, tool calls, subagents, token usage, context window utilization, compactions, and last action. Uses Python to parse JSONL transcripts from `~/.claude/projects/`.

## Commands

```bash
# Generate plans (all 4 variants, Opus, ~15-25 min)
./generate-plans.sh <prompt-file.md>

# Generate with overrides
MODEL=sonnet ./generate-plans.sh my-prompt.md
MAX_TURNS=50 TIMEOUT_SECS=1800 ./generate-plans.sh my-prompt.md

# Debug mode: single variant, sonnet, fast
./generate-plans.sh --debug my-prompt.md           # baseline only
./generate-plans.sh --debug=k8s-ops my-prompt.md   # specific variant

# Merge plans (interactive agent-teams debate)
./merge-plans.sh generated-plans/<prompt-name>/latest

# Merge plans (headless, automated)
MERGE_MODE=simple ./merge-plans.sh generated-plans/<prompt-name>/latest

# Monitor running sessions
./monitor-sessions.sh              # one-shot table
./monitor-sessions.sh --watch      # refresh every 15s
./monitor-sessions.sh --watch 5    # refresh every 5s
```

## Output Structure

```
generated-plans/<prompt-name>/<timestamp>/
  plan-baseline.md          # unguided variant
  plan-simplicity.md        # minimal MVP focus
  plan-framework-depth.md   # detailed code patterns
  plan-k8s-ops.md           # K8s deployment focus
  plan-*.log                # session stdout+stderr (for debugging)
  merge-prompt.md           # generated merge instructions (agent-teams mode)
  merged-plan.md            # final merged output
generated-plans/<prompt-name>/latest -> <timestamp>   # symlink
```

## Key Design Decisions

- **4 variants, not more**: Research shows diminishing returns from same-model ensembles (arXiv:2506.07962). Diversity comes from prompt variation, not repetition. See `research/number-of-llms-sessions.md`.
- **Write tool for output capture**: `--output-format text` only captures the LAST assistant message. Multi-turn research sessions lose intermediate content. The prompt instructs Claude to write the complete plan via the Write tool.
- **CWD is the hyperflow/ parent directory**: Sessions run from `../../` so all sibling repos are within the sandbox tree. This fixes subagent file access — `--add-dir` flags don't propagate to subagents.
- **`CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000`**: Overrides the user's shell default of 6000, which truncates plans.
- **`--dangerously-skip-permissions`**: Required for headless `-p` mode where no interactive user can approve tool use.

## Prompt Variants

Defined as associative array `VARIANTS` in `generate-plans.sh`:
- `baseline`: No additional guidance — model's default interpretation
- `simplicity`: Forces smallest MVP trade-offs, fewer dependencies
- `framework-depth`: Deep mcp-agent framework patterns, code examples, imports
- `k8s-ops`: K8s deployment specifics, helm/kubectl commands, kr8s async patterns

## Environment Variables

| Variable | Default (normal) | Default (debug) | Purpose |
|---|---|---|---|
| `MODEL` | `opus` | `sonnet` | Claude model |
| `MAX_TURNS` | `80` | `20` | Max API round-trips per session |
| `TIMEOUT_SECS` | `3600` | `600` | Hard kill timeout |
| `MERGE_MODE` | `agent-teams` | — | `agent-teams` or `simple` |
| `DEBUG` | — | `1` | Enable debug mode |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | `128000` | `128000` | Forced override |

## Research Notes

The `research/` directory contains analysis that informed the design:
- `number-of-llms-sessions.md` — Why N=4 sessions (logarithmic returns, correlated errors, merge cost explosion)
- `cloud-sessions-analysis.md` — Comparison of local `claude -p`, cloud sessions, and agent teams approaches
- `turns-in-claude.md` — How turns work, subagent turn counting, and `--max-turns` behavior
