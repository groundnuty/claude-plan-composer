# Pitfalls of Running `claude -p` in Headless Pipelines

> Hard-won findings from debugging the claude-plan-composer pipeline, March 2026.
> These issues are poorly documented and cost hours to diagnose. Each produces
> **zero output and zero error messages** — the process silently fails or hangs.

## TL;DR

If your `claude -p` produces 0-byte output and the process appears stuck:

```bash
# Check process state:
ps -p $(pgrep -f 'claude.*-p') -o pid,state,%cpu,rss

# State T = stopped by signal (SIGTTIN) — see Pitfall 1
# State S with 0% CPU for minutes — see Pitfall 2 or 3
```

---

## Pitfall 1: `timeout` Creates a New Process Group (SIGTTIN)

**Symptom:** `claude -p` loads (~100MB RSS) then freezes. Process state is `T`
(stopped). Log file is 0 bytes. No error output anywhere.

**Root cause:** GNU `timeout` calls `setpgid()` to put the child in a new process
group so it can `kill(-pid)` all descendants on timeout. When `claude` (in the new
group) tries to access the terminal during initialization, the kernel sends
**SIGTTIN** (terminal input from background process), which stops the process.

This happens even with `claude -p` (pipe mode) because Claude Code's initialization
checks terminal capabilities before entering headless mode.

**The fix:**

```bash
# BROKEN — claude gets SIGTTIN and stops silently:
timeout 300 claude -p "prompt" --output-format text ...

# FIXED — keeps claude in the foreground process group:
timeout --foreground 300 claude -p "prompt" --output-format text ...
```

**Why this is subtle:**
- `timeout --foreground` is not the default because it can't kill grandchild processes
- The process loads fully (~100-300MB RSS) before stopping, so it looks like it's working
- `|| true` swallows the eventual timeout exit code, hiding the failure
- No error message is produced — the log file stays 0 bytes
- This only affects `claude -p`, not other commands, because most CLI tools don't
  touch the terminal when their stdout is redirected

**Applies to:** All `timeout ... claude -p` calls. Diagnosed via `ps` showing
state `T` and `sample <pid>` showing `__wait4` in the call stack.

**Also broken — subshells compound the problem:**

```bash
# BROKEN — subshell + timeout = double process group isolation:
(cd /some/dir && timeout 300 claude -p "prompt" > log 2>&1)

# FIXED — either use --foreground or avoid subshell:
cd /some/dir
timeout --foreground 300 claude -p "prompt" > log 2>&1
cd -
```

---

## Pitfall 2: `--setting-sources local` Strips Auth Config

**Symptom:** `claude -p` exits immediately with code 1 and 0-byte output. No error.

**Root cause:** `--setting-sources` controls which configuration layers Claude Code
loads. The three sources are:

| Source | What it loads | Path |
|--------|-------------|------|
| `user` | User-global settings, hooks, plugins, rules, CLAUDE.md | `~/.claude/` |
| `project` | Project settings, CLAUDE.md | `.claude/` in project root |
| `local` | Local overrides (`.local` files) | `.claude/*.local.*` |

Using `--setting-sources local` skips the `user` source, which may contain
**API authentication configuration**. Claude silently fails to authenticate
and exits with no output.

**The fix:**

```bash
# BROKEN — no auth, no hooks, no output:
claude -p "prompt" --setting-sources local

# FIXED — skips user hooks but keeps project config (which can have auth):
claude -p "prompt" --setting-sources project,local

# Note: user hooks (sounds, notifications) will still be skipped.
# API auth works if ANTHROPIC_API_KEY is in the environment or project config.
```

**Why you'd want `--setting-sources` in the first place:**
User-installed hooks (e.g., sound notifications, peon-ping) fire on every
`claude -p` session, including headless pipeline runs. `--setting-sources project,local`
prevents loading user-global hooks while keeping auth working.

---

## Pitfall 3: `acceptEdits` Mode Tries Terminal Access

**Symptom:** Same as Pitfall 1 — process stops with state `T`. But this happens
even without `timeout` creating a process group, if the process is run inside
bats `run` or other pipe-based test harnesses.

**Root cause:** `--permission-mode acceptEdits` auto-approves file edits but may
still attempt to display a permission UI for non-edit operations. When stdout/stderr
are piped (not a terminal), this initialization fails silently.

**The fix:**

```bash
# BROKEN — acceptEdits tries terminal access:
claude -p "prompt" --permission-mode acceptEdits

# FIXED — dontAsk + allowedTools is fully non-interactive:
claude -p "prompt" --permission-mode dontAsk --allowedTools "Write"
```

`dontAsk` never prompts. `--allowedTools` controls which tools are available.
This combination is strictly better than `acceptEdits` for headless pipelines:
- Never touches the terminal
- Explicit tool whitelist (defense-in-depth)
- Blocks unexpected tool types from malicious project configs

---

## Pitfall 4: `CLAUDECODE` Env Var Blocks Nested Sessions

**Symptom:** `claude -p` produces no output when called from inside another Claude
Code session (e.g., from a hook, plugin, or the Bash tool).

**Root cause:** Claude Code sets `CLAUDECODE=1` in all child processes. When a
child `claude -p` detects this, it refuses to run to prevent infinite recursion.

**Known bug ([#29543](https://github.com/anthropics/claude-code/issues/29543)):**
Unsetting `CLAUDECODE` in a script doesn't fully work — the process exits with
code 0 but produces zero output.

**Partial fix (works from regular terminals, not from Claude Code's Bash tool):**

```bash
#!/usr/bin/env bash
# At the top of scripts that spawn claude -p:
unset CLAUDECODE 2>/dev/null || true
```

**What does NOT work (as of March 2026):**

```bash
# From Claude Code's Bash tool — CLAUDECODE is re-injected at the process level:
unset CLAUDECODE && claude -p "prompt"  # exits 0, empty output

# env -i also fails — Bash tool kills the nested process:
env -i HOME=$HOME PATH=$PATH claude -p "prompt"  # exit 144 (SIGTERM)
```

**The only reliable workaround:** Run `claude -p` from a **regular terminal**,
not from inside Claude Code. For CI/CD and automated testing, this isn't an issue
since there's no parent Claude Code session.

**Upstream tracking:**
- [claude-code #29543](https://github.com/anthropics/claude-code/issues/29543) — silent failure bug
- [claude-code #26190](https://github.com/anthropics/claude-code/issues/26190) — nested sessions hang
- [agent-sdk-python #573](https://github.com/anthropics/claude-agent-sdk-python/issues/573) — CLAUDECODE inheritance
- [agent-sdk-python PR #594](https://github.com/anthropics/claude-agent-sdk-python/pull/594) — fix pending review

---

## Pitfall 5: `--disable-slash-commands` Does NOT Disable Hooks

**What it does:** Disables skills (slash commands like `/commit`, `/review`).

**What it does NOT do:** Disable hooks (PreToolUse, PostToolUse, SessionStart, etc.).

There is **no CLI flag to disable hooks** as of March 2026. The only way to prevent
user hooks from firing is `--setting-sources project,local` (which skips the `user`
config layer where hooks are defined).

```bash
# Skills disabled, hooks still fire:
claude -p "prompt" --disable-slash-commands

# Skills disabled AND user hooks skipped:
claude -p "prompt" --disable-slash-commands --setting-sources project,local
```

---

## Pitfall 6: `timeout` Kills Claude Before It Finishes (Silent)

**Symptom:** Merge log contains only `timeout: sending signal TERM to command 'claude'`.
Or, without `--verbose`, the log is 0 bytes and no output file is created. Looks
identical to Pitfall 1.

**Root cause:** Merge operations embed multiple full plans in the prompt (often 30-80KB
of text). Claude needs time to read, analyze, compare, and synthesize — easily 5-10
minutes for complex plans. A 5-minute timeout kills it mid-work.

**The fix:**

```bash
# BROKEN — 5 minutes is too short for merge/analysis:
timeout --foreground 300 claude -p "${BIG_PROMPT}" ...

# FIXED — give merge operations 10+ minutes:
timeout --foreground 600 claude -p "${BIG_PROMPT}" ...
```

**Debugging tip:** Always use `--verbose` with `timeout` (see Pitfall 8).

**Why this is confusing:**
- Without `--verbose`, timeout kills silently — no error in log
- The log file is 0 bytes because stdout is buffered and flushed on exit, but SIGTERM
  prevents graceful flush
- Looks identical to Pitfall 1 (SIGTTIN) — both produce 0-byte logs
- The fix for Pitfall 1 (`--foreground`) makes the process actually run, but then it
  hits this timeout issue instead

---

## Pitfall 7: Bats `setup_file` Exports Override Per-Test Defaults

**Symptom:** Merge test fails with 0-byte output even though `TIMEOUT_SECS=600` is
set in the test. Identical to Pitfall 6.

**Root cause:** Bats `setup_file()` runs once before all tests and exports variables.
When a test later uses `TIMEOUT_SECS="${TIMEOUT_SECS:-600}"`, the `:-` default syntax
doesn't apply because the variable is already set (to a shorter value from setup).

```bash
# setup_file() — runs once:
export TIMEOUT_SECS="${TIMEOUT_SECS:-300}"  # sets to 300

# Test — the :-600 default NEVER fires:
TIMEOUT_SECS="${TIMEOUT_SECS:-600}" \       # evaluates to 300!
  ./merge-plans.sh "${RUN_DIR}"
```

**The fix:**

```bash
# BROKEN — default doesn't override existing export:
TIMEOUT_SECS="${TIMEOUT_SECS:-600}" ./merge-plans.sh "${RUN_DIR}"

# FIXED — hard assignment overrides the export:
TIMEOUT_SECS=600 ./merge-plans.sh "${RUN_DIR}"
```

**Why this is confusing:**
- The `:-` syntax looks correct — it reads as "use 600 if not set"
- But `setup_file` already set it, so it IS set (to the wrong value)
- The test passes locally when you run `TIMEOUT_SECS=600 make test-e2e`
  because the env var overrides setup_file, masking the bug
- The failure is identical to Pitfall 6 — 0-byte logs, no error

**General rule:** In bats tests, never use `:-` defaults for variables exported
by `setup_file`. Use hard assignments when a specific test needs a different value.

---

## Pitfall 8: `timeout --verbose` Is Not the Default (Silent Kills)

**Symptom:** `claude -p` produces 0 bytes and you can't tell if it was killed by
timeout or stopped by SIGTTIN. Both look identical.

**Root cause:** GNU `timeout` kills silently by default. Without `--verbose`, there's
no way to distinguish "timeout killed the process" from "process was stopped by signal".

**The fix:** Always use `--verbose`:

```bash
# BAD — silent kill, indistinguishable from SIGTTIN:
timeout --foreground 300 claude -p ...

# GOOD — prints to stderr when it kills:
timeout --foreground --verbose 300 claude -p ...
# stderr: "timeout: sending signal TERM to command 'claude'"
```

**Why `--verbose` should be the default in pipelines:**
- Zero cost when the process completes normally (no output)
- Critical diagnostic when the process is killed (one line to stderr)
- Distinguishes Pitfall 1 (SIGTTIN, state T) from Pitfall 6 (timeout, state gone)
- The stderr line goes to the log file along with other diagnostics

**Recommendation:** Add `--verbose` to every `timeout` call in pipeline scripts.
There is no reason not to.

---

## Pitfall 9: Unit Tests Become Slow Integration Tests

**Symptom:** `bats test/` (unit tests only, no e2e) takes 10-30+ minutes instead
of seconds. You see `claude -p` processes with `--model sonnet` running during
what should be fast, offline tests.

**Root cause:** Tests that validate argument parsing or flag behavior call the
real script with a prompt file:

```bash
@test "flag is accepted" {
  echo "# Test prompt" >"${TMPDIR}/prompt.md"
  # Comment says "will fail because claude not available"
  # But claude IS available on dev machines!
  run ./generate-plans.sh --some-flag "${TMPDIR}/prompt.md"
  assert_output --partial "expected warning"
}
```

The script gets past argument parsing, loads config, and launches `claude -p` with
a 600-second timeout. The test author assumed claude wouldn't be installed, but on
developer machines it is — turning a <1s arg-parsing test into a 10-minute API call.

**The fix:** Set a short timeout so the claude call fails fast:

```bash
@test "flag is accepted" {
  echo "# Test prompt" >"${TMPDIR}/prompt.md"
  # Short timeout: we only care about arg parsing, not the claude call.
  run env TIMEOUT_SECS=5 \
    ./generate-plans.sh --some-flag "${TMPDIR}/prompt.md"
  assert_output --partial "expected warning"
}
```

**Why `TIMEOUT_SECS=5` and not `0`:**
- `0` means "no timeout" in GNU timeout (infinite wait)
- `1` might not be enough for the script to reach the assertion-relevant output
- `5` is long enough for startup + flag parsing + config loading, short enough to
  not waste time

**Affected tests in claude-plan-composer (fixed):**

| Test file | Test name | Was | Now |
|-----------|-----------|-----|-----|
| `generate-plans.bats` | sequential-diversity warning | 600s | 5s |
| `generate-plans.bats` | config fallback | 600s | 5s |
| `auto-lenses.bats` | accepts --auto-lenses flag | 600s | 5s |
| `verify-plan.bats` | accepts --pre-mortem flag | 600s | 5s |

**Prevention:** Any unit test that calls a script which may invoke `claude -p`
should set `TIMEOUT_SECS=5` (or whatever the script's timeout env var is).
Better yet, tests should mock the claude call entirely — but `TIMEOUT_SECS=5`
is a quick fix that doesn't require refactoring the script.

---

## Recommended Invocation Pattern

For headless `claude -p` in pipelines, use all of these together:

```bash
unset CLAUDECODE 2>/dev/null || true  # at script top

timeout --foreground --verbose "${TIMEOUT_SECS}" \
  claude -p "${PROMPT}" \
  --model "${MODEL}" \
  --output-format text \
  --max-turns "${MAX_TURNS}" \
  --permission-mode dontAsk \
  --allowedTools "Write" \
  --setting-sources project,local \
  --disable-slash-commands \
  >"${logfile}" 2>&1
```

| Flag | Purpose |
|------|---------|
| `timeout --foreground --verbose` | Prevents SIGTTIN; logs when timeout kills |
| `--permission-mode dontAsk` | Never prompts, fully non-interactive |
| `--allowedTools "..."` | Explicit tool whitelist, blocks unexpected tools |
| `--setting-sources project,local` | Skips user hooks/plugins, keeps project auth |
| `--disable-slash-commands` | Prevents skill loading |
| `unset CLAUDECODE` | Allows nested execution from parent Claude sessions |

---

## Debugging Checklist

When `claude -p` produces 0-byte output:

1. **Check process state:** `ps -p $(pgrep -f 'claude.*-p') -o state`
   - `T` = stopped → Pitfall 1 (add `--foreground`) or Pitfall 3 (use `dontAsk`)
   - `S` with 0% CPU → Pitfall 2 (check `--setting-sources`) or Pitfall 4 (`CLAUDECODE`)
   - No process found → crashed during init, check stderr

2. **Check environment:** `echo $CLAUDECODE`
   - If `1` → Pitfall 4

3. **Check log file:** `wc -c logfile`
   - 0 bytes → process never produced output (Pitfalls 1-4)
   - Non-zero but small → check for error messages in log

4. **Check timeout verbose output in log:**
   ```bash
   grep -l 'timeout: sending signal' *.log
   ```
   - If found → Pitfall 6 (increase timeout) or Pitfall 7 (env var default bug)

5. **Check test execution time:** `time bats test/`
   - Minutes instead of seconds → Pitfall 9 (add `TIMEOUT_SECS=5` to unit tests)

6. **Minimal reproduction:**
   ```bash
   unset CLAUDECODE
   timeout --foreground --verbose 30 claude -p "Say HELLO" \
     --output-format text --max-turns 1 \
     --permission-mode dontAsk \
     --setting-sources project,local \
     --disable-slash-commands
   ```
   If this works, the issue is prompt-specific (size, content, model).

---

## Stacked Failures (Why Diagnosis Is Hard)

These pitfalls stack and mask each other. A typical debugging session:

1. **Start:** 0-byte log, process gone. No idea what happened.
2. **Add `--foreground`:** Fixes SIGTTIN (Pitfall 1). But now...
3. **Still 0-byte log.** Process runs but gets killed. Why?
4. **Add `--verbose`:** Reveals `timeout: sending signal TERM` (Pitfall 6/8).
5. **Increase timeout to 600s:** Claude finishes. But in bats e2e...
6. **Still fails with 300s.** The test sets `:-600` but `setup_file` exported 300 (Pitfall 7).
7. **Change to hard assignment `=600`:** E2e passes. But unit tests...
8. **Take 30 minutes.** Tests call real scripts that invoke `claude -p` (Pitfall 9).
9. **Add `TIMEOUT_SECS=5` to unit tests:** Everything fast and green.

Each fix reveals the next problem. Without `--verbose` on `timeout`, steps 3-4
are indistinguishable from step 2 — both show 0-byte logs and no error.

---

## References

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code headless mode](https://code.claude.com/docs/en/headless)
- [GNU timeout --foreground docs](https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html)
- [SIGTTIN — POSIX terminal access control](https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/signal.h.html)
- `research/laptop-threat-model.md` — security analysis of pipeline sessions
- `research/sandbox-comparison.md` — isolation methods comparison
