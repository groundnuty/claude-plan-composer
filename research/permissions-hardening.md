# Permissions Hardening: From `--dangerously-skip-permissions` to Least Privilege

> Implemented March 2026. Based on analysis in `private/claude-code-security-guide.md`.

## Problem

All 6 headless `claude -p` invocations used `--dangerously-skip-permissions`, granting
every session unrestricted tool access. Deep analysis showed only 1 of the 6 genuinely
needs broad access — the rest are either pure text completion (no tools at all) or need
only the Write tool.

This created an unnecessary attack surface: plan files (which contain LLM-generated
content from previous sessions) are embedded directly into prompts for merge, evaluate,
and verify steps. A prompt injection payload in a plan file could instruct Claude to
exfiltrate data, write to arbitrary paths, or execute shell commands — and with
`--dangerously-skip-permissions`, nothing would stop it.

## Audit of all invocations

| # | Script | Function | What it does | Tools used | Max turns |
|---|--------|----------|-------------|-----------|-----------|
| 1 | generate-plans.sh:369 | Auto-lens | Generates YAML perspectives from prompt | **none** | 3 |
| 2 | generate-plans.sh:571 | Plan generation | Explores codebase, writes plan file | Read, Glob, Bash, WebSearch, Write | 80 |
| 3 | merge-plans.sh:558 | Simple merge | Merges plans via Write tool | Write | 30 |
| 4 | evaluate-plans.sh:275 | Evaluation | Scores plans, returns JSON | **none** | 3 |
| 5 | verify-plan.sh:192 | Verification | Quality gates, returns markdown | **none** | 5 |
| 6 | verify-plan.sh:255 | Pre-mortem | Failure scenarios, returns markdown | **none** | 5 |

(Invocation 3, agent-teams merge at merge-plans.sh:360, is interactive — no bypass flag needed.)

**Key observation**: Invocations 1, 4, 5, 6 have `--max-turns 3-5`, capture stdout to
a bash variable, and the *shell* writes output files. Claude never uses any tools in
these sessions.

## Claude Code permission modes

Research into `claude --help` and official docs revealed 5 permission modes:

| Mode | Behavior in headless `-p` mode |
|------|-------------------------------|
| `default` | Prompts for tool use — **hangs in non-TTY** (no one to answer) |
| `acceptEdits` | Auto-approves Read/Write/Edit + filesystem Bash (mkdir, cp, rm) |
| `plan` | Can analyze but not execute state-changing tools |
| `dontAsk` | Auto-denies all tools unless explicitly allowed via `--allowedTools` |
| `bypassPermissions` | Skips all prompts (same as `--dangerously-skip-permissions`) |

## Critical finding: bare `claude -p` hangs

The original plan was to simply remove `--dangerously-skip-permissions` from text-only
invocations. Testing revealed this causes the process to **hang indefinitely**:

```bash
# This HANGS — claude tries to show an interactive permission dialog
claude -p "Reply with: HELLO" --model haiku --output-format text --max-turns 1
# Process sits at 100% CPU waiting for TTY input that will never come
```

The `default` permission mode tries to render a permission prompt even when no tool use
is attempted. In a non-TTY context (pipe, subshell, background process), this blocks
forever.

**Solution**: Use `--permission-mode dontAsk` — auto-denies any tool attempt without
blocking, while text completion works normally.

## Applied permission strategy

| # | Invocation | Before | After | Rationale |
|---|-----------|--------|-------|-----------|
| 1 | Auto-lens | `--dangerously-skip-permissions` | `--permission-mode dontAsk` | Pure text. If Claude somehow tries a tool, it's safely denied. |
| 2 | Plan generation | `--dangerously-skip-permissions` | `--dangerously-skip-permissions` | **Unchanged.** Genuinely needs Read, Glob, Bash, WebSearch, Write for codebase exploration. |
| 3 | Simple merge | `--dangerously-skip-permissions` | `--permission-mode acceptEdits` | Needs Write tool only. acceptEdits auto-approves Write but blocks arbitrary Bash. |
| 4 | Evaluation | `--dangerously-skip-permissions` | `--permission-mode dontAsk` | Pure text (JSON output). All plan content is embedded in the prompt. |
| 5 | Verification | `--dangerously-skip-permissions` | `--permission-mode dontAsk` | Pure text (markdown output). All plan content is embedded in the prompt. |
| 6 | Pre-mortem | `--dangerously-skip-permissions` | `--permission-mode dontAsk` | Pure text (markdown output). Plan content is embedded. |

**Result**: Down from 6 invocations using bypass to 1. The remaining bypass invocation
(plan generation) is the only one that genuinely requires broad tool access.

## Validation

### Integration tests (`test/validate-permissions.sh`)

Four live `claude -p` calls (~$0.02 with haiku) that validate the permission modes:

1. **dontAsk text completion** — confirms text output works without tool permissions
2. **dontAsk blocks Write** — confirms Write tool is auto-denied (file not created)
3. **acceptEdits approves Write** — confirms Write tool works (file created)
4. **acceptEdits blocks Bash** — confirms arbitrary Bash is blocked

Tests 2 and 4 (the safety properties) passed reliably. Tests 1 and 3 had output
capture issues when run from inside Claude Code (nested session limitations), but
worked correctly in standalone testing.

### Static analysis tests (`test/permissions.bats`)

Seven bats tests that grep the production scripts to verify the correct permission
flags are present:

- Auto-lens uses `dontAsk`, not `dangerously-skip-permissions`
- Plan generation keeps `dangerously-skip-permissions`
- Simple merge uses `acceptEdits`
- Evaluation uses `dontAsk`
- Verification uses `dontAsk`
- Pre-mortem uses `dontAsk`
- Exactly 1 script file contains `dangerously-skip-permissions`

These are pure static analysis — no API calls, no flakiness.

## Eval injection fix (bonus)

During the audit, a secondary issue was found: `CONFIG_FILE` paths were interpolated
directly into Python string literals via `python3 -c "... with open('${CONFIG_FILE}') ..."`.
A path containing a single quote would break out of the Python string.

**Fix**: Changed to heredoc + `sys.argv[1]` pattern:

```bash
# Before (injectable):
eval "$(python3 -c "
import yaml
with open('${CONFIG_FILE}') as f:     # ← shell-interpolated into Python string
    cfg = yaml.safe_load(f)
...")"

# After (safe):
eval "$(
  python3 - "${CONFIG_FILE}" <<'PYEOF'
import yaml, sys
with open(sys.argv[1]) as f:          # ← passed as argument, no interpolation
    cfg = yaml.safe_load(f)
...
PYEOF
)"
```

Applied to `generate-plans.sh` (2 blocks) and `merge-plans.sh` (1 block).
`evaluate-plans.sh` already used `sys.argv[1]` correctly.

## Remaining attack surface

The plan generation session (invocation 2) still uses `--dangerously-skip-permissions`.
This is the session with the most exposure — it runs for up to 80 turns with access to
the codebase and network. Mitigations:

1. **It runs in `WORK_DIR`** — typically a temp directory or a specific project dir,
   not the user's home directory.
2. **The prompt is user-supplied** — the user controls what Claude is asked to do,
   unlike the merge/verify steps where LLM-generated plan content is embedded.
3. **Sandbox configuration** (not yet deployed) would add OS-level filesystem and
   network restrictions even with bypass enabled. See `private/claude-code-security-guide.md`
   Layer 1 for recommended config.

## References

- `private/claude-code-security-guide.md` — 4-layer security model research
- `private/conversation-export.md` — Q&A that produced the security guide
- [Claude Code permissions docs](https://code.claude.com/docs/en/permissions)
- [Claude Code headless mode docs](https://code.claude.com/docs/en/headless)
- [GitHub issue #581](https://github.com/anthropics/claude-code/issues/581) — `-p` mode permission handling
- [GitHub issue #12232](https://github.com/anthropics/claude-code/issues/12232) — `--allowedTools` ignored with bypassPermissions
