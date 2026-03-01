# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This is an **LLM plan composition toolkit** — a set of bash scripts that orchestrate multiple parallel Claude Code sessions to generate diverse implementation plans, then merge the best elements into a single plan. It implements a research-backed "best-of-N with prompt variation" pattern.

The scripts are domain-agnostic. Domain-specific configuration lives in `config.yaml` (single-file mode) or as separate prompt files (multi-file mode). Project-specific configs can be kept in a private `projects/` git submodule.

## Pipeline

1. **Generate** (`generate-plans.sh`): Launches parallel `claude -p` sessions, each with a different prompt. Two modes:
   - **Single-file**: One prompt + variant guidance from `config.yaml` (default: 4 variants).
   - **Multi-file**: Each prompt file is a standalone variant. Supports `--context=shared.md` to append common context to all prompts.
   - Flags: `--auto-lenses` generates task-specific variant lenses via LLM before launching. `--sequential-diversity` runs variants in two waves — wave 1 generates, wave 2 gets skeleton outlines of wave 1 plans as a diversity constraint.
   Each session writes a plan to a file via the Write tool.

2. **Evaluate** (`evaluate-plans.sh`): Pre-merge analysis of generated plans.
   - **Phase 1** (zero cost): Bash-level convergence check — extracts section headings from each plan, computes pairwise Jaccard similarity, warns about too-similar or too-divergent plans.
   - **Phase 2** (optional LLM): Coverage matrix, gap detection, per-plan strengths. Uses a cheap model (default: haiku). Produces `evaluation.md` and `evaluation.json`.
   - Exit code 1 if critical gaps found.

3. **Merge** (`merge-plans.sh`): Takes the generated plans and produces a merged plan. Two modes:
   - `agent-teams` (default): Interactive Claude session with Agent Teams — spawns advocate agents that debate each plan, then the lead synthesizes.
   - `simple`: Headless `claude -p` that reads all plans inline and produces a merged plan.
   - Merge prompts use a 3-phase structure: Analysis (with conflict classification), Synthesis (with minority insight scanning), and Constitutional Review.
   - Supports `comparison_method: pairwise` for C(N,2) pairwise tournament scoring (simple mode only).

4. **Verify** (`verify-plan.sh`): Post-merge quality gates on the merged plan.
   - **Gate 1: CONSISTENCY** — checks for internal contradictions.
   - **Gate 2: COMPLETENESS** — checks for content lost from source plans.
   - **Gate 3: ACTIONABILITY** — checks that each section has concrete next steps.
   - Optional `--pre-mortem` flag for failure scenario analysis.
   - Exit code 1 if any gate fails.

5. **Monitor** (`monitor-sessions.sh`): Real-time dashboard showing running Claude sessions — tracks PID, variant, transcript size, tool calls, subagents, token usage, context window utilization, compactions, and last action. Parses JSONL transcripts from `~/.claude/projects/`. Auto-exits in `--watch` mode when all sessions finish.

## Configuration

Variant prompts and additional directories are defined in YAML config files.

**Priority**: `CONFIG` env var > `config.local.yaml` > `config.yaml`

```yaml
# config.yaml
work_dir: ""          # empty = temp dir (no file access); set for codebase plans
add_dirs: []          # extra dirs beyond work_dir
mcp_config: ""        # MCP server config JSON — external knowledge sources

# 4 variants recommended (see research/number-of-llms-sessions.md)
# Simple form: variant_name: "guidance"
# Extended form with per-variant model override:
#   variant_name:
#     model: sonnet
#     guidance: "guidance text"
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

### Lens strategies

The default analytical lenses (baseline/simplicity/depth/breadth) are domain-agnostic. For better results, swap in domain-specific alternatives:

| Strategy | Idea | Example variants |
|----------|------|-----------------|
| **Persona** | Shift *who* is thinking | architect, pragmatist, skeptic, visionary |
| **Constraint** | Force different solution spaces | fast-and-cheap, unlimited-time, scale-first, legacy-compat |
| **Adversarial** | One contrarian that must differ structurally | contrarian |
| **Model cascade** | Sonnet for generation, Opus for merge | `model: sonnet` on 3 of 4 variants (~48% savings) |

See `config.yaml` for commented examples of each strategy.

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
mcp_config: ""        # MCP server config JSON
project_description: "the project"
role: "an expert analyst"

# holistic (default): evaluate all plans per dimension simultaneously
# pairwise: C(N,2) pairwise tournament, then tally (more reliable for 4+ plans)
comparison_method: holistic

dimensions:
  - Approach and strategy
  - Scope and priorities
  - Technical depth and specificity
# Weighted form (used in pairwise scoring and synthesis):
#   - name: "Approach and strategy"
#     weight: 0.3
#   - "Technical depth"   # weight defaults to equal share

advocate_instructions: |
  Argue for its approach in each dimension...
output_goal: |
  The merged plan must be standalone...
output_title: "Merged Plan"
# Quality principles verified after synthesis — the merge revises if violated.
constitution:
  - "Every trade-off must be explicitly acknowledged with pros and cons"
  - "No section should be purely aspirational — each needs a concrete next step"
  - "Risks identified in any source plan must appear in the merged plan"
  - "The plan must be self-consistent — no section contradicts another"
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

# Auto-lenses: LLM generates task-specific variant perspectives (single-file only)
./generate-plans.sh --auto-lenses my-prompt.md
LENS_MODEL=sonnet LENS_COUNT=6 ./generate-plans.sh --auto-lenses my-prompt.md

# Sequential diversity: wave 1 generates, wave 2 gets skeleton outlines as constraint
./generate-plans.sh --sequential-diversity my-prompt.md

# Both flags can be combined
./generate-plans.sh --auto-lenses --sequential-diversity my-prompt.md

# Debug mode: single variant, sonnet, fast
./generate-plans.sh --debug my-prompt.md           # baseline only
./generate-plans.sh --debug=depth my-prompt.md     # specific variant

# Evaluate plans before merging (optional but recommended)
./evaluate-plans.sh generated-plans/<prompt-name>/latest
./evaluate-plans.sh --no-llm generated-plans/latest   # convergence check only (zero cost)
EVAL_MODEL=sonnet ./evaluate-plans.sh generated-plans/latest

# Merge plans (interactive agent-teams debate)
./merge-plans.sh generated-plans/<prompt-name>/latest

# Merge plans (headless, automated)
MERGE_MODE=simple ./merge-plans.sh generated-plans/<prompt-name>/latest

# Merge with pairwise tournament comparison
MERGE_MODE=simple MERGE_CONFIG=my-pairwise.yaml ./merge-plans.sh generated-plans/latest

# Merge with project-specific config
MERGE_CONFIG=projects/agentregistry/merge-config.yaml ./merge-plans.sh generated-plans/multi-*/latest

# Verify merged plan against quality gates
./verify-plan.sh generated-plans/<prompt-name>/latest
./verify-plan.sh --pre-mortem generated-plans/latest   # includes failure scenario analysis
VERIFY_MODEL=haiku ./verify-plan.sh generated-plans/latest

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
| `MODEL` | `opus` | `sonnet` | Claude model for plan generation |
| `MAX_TURNS` | `80` | `20` | Max API round-trips per session |
| `TIMEOUT_SECS` | `3600` | `600` | Hard kill timeout |
| `WORK_DIR` | from config | from config | CWD for Claude sessions (overrides config `work_dir`) |
| `CONFIG` | — | — | Path to YAML config file |
| `MERGE_MODE` | `agent-teams` | — | `agent-teams` or `simple` |
| `MERGE_CONFIG` | — | — | Path to merge YAML config file |
| `DEBUG` | — | `1` | Enable debug mode |
| `AUTO_LENSES` | — | — | Enable auto-lens generation (or use `--auto-lenses` flag) |
| `LENS_MODEL` | `haiku` | — | Model for auto-lens generation |
| `LENS_COUNT` | `4` | — | Number of lenses to generate |
| `SEQUENTIAL_DIVERSITY` | — | — | Enable two-wave diversity (or use `--sequential-diversity` flag) |
| `EVAL_MODEL` | `haiku` | — | Model for `evaluate-plans.sh` LLM evaluation |
| `VERIFY_MODEL` | `sonnet` | — | Model for `verify-plan.sh` quality gates |

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

## Development

The project uses [devbox](https://www.jetpack.io/devbox) for reproducible tooling. All `make` targets run through `devbox run`.

```bash
make check     # Full verification: syntax + shellcheck + shfmt + bats tests
make fix       # Auto-fix: format in-place, then lint
make test      # Run bats tests only (fast, no API calls)
make test-e2e  # E2E pipeline test (requires Claude API, ~$1, ~5 min)
make lint      # ShellCheck only
make fmt       # shfmt format in-place
make fmt-check # shfmt check without modifying
```

Test structure (44 tests across 5 files):
- `test/merge-config.bats` — config parsing, weighted dimensions, constitution, comparison_method validation
- `test/generate-plans.bats` — flag parsing, multi-file mode, sequential diversity
- `test/evaluate-plans.bats` — convergence check, LLM evaluation
- `test/auto-lenses.bats` — lens generation, edge cases
- `test/verify-plan.bats` — quality gates, pre-mortem

## Research Notes

The `research/` directory contains analysis that informed the design:
- `number-of-llms-sessions.md` — Why N=4 sessions (logarithmic returns, correlated errors, merge cost explosion)
- `cloud-sessions-analysis.md` — Comparison of local `claude -p`, cloud sessions, and agent teams approaches
- `turns-in-claude.md` — How turns work, subagent turn counting, and `--max-turns` behavior
- `methodology-improvements.md` — 50+ references: conflict classification, constitutional AI, pairwise comparison, sequential diversity conditioning, and the 7-PR improvement roadmap
