# Git Commit Signing in Claude Code's Sandbox

Research date: 2026-03-11

## The Problem

When `commit.gpgsign=true` is set in git config, `git commit` invokes GPG to
sign the commit. This creates **two distinct problems** in Claude Code:

1. **Sandbox filesystem restriction**: The sandbox's `denyRead` blocks access to
   `~/.gnupg` by default, preventing GPG from accessing keys.
2. **Terminal/pinentry conflict**: Claude Code's TUI (Ink renderer) holds exclusive
   control of the terminal. When `pinentry-curses` or `pinentry-tty` tries to
   prompt for a passphrase, the two programs fight for the screen, causing
   flickering and eventual failure with `gpg: signing failed: No passphrase given`.

These are separate issues that compound each other. Even if you solve the sandbox
access problem, the pinentry conflict remains (and vice versa).

## Relevant GitHub Issues

| Issue | Status | Summary |
|-------|--------|---------|
| [#118](https://github.com/anthropics/claude-code/issues/118) | Closed (locked) | Original report: console screen management conflicts with GPG pinentry |
| [#7711](https://github.com/anthropics/claude-code/issues/7711) | Closed (locked) | Feature request: support commit signing for GitHub Vigilant Mode |
| [#22532](https://github.com/anthropics/claude-code/issues/22532) | Closed (stale) | GPG signing prompt conflicts with TUI; reports Claude silently retries with `--no-sign` |
| [#30539](https://github.com/anthropics/claude-code/issues/30539) | Open | GPG pinentry terminal conflict on WSL |
| [#15449](https://github.com/anthropics/claude-code/issues/15449) | Closed | VSCode extension steals focus from GPG pinentry dialog |
| [#5984](https://github.com/anthropics/claude-code/issues/5984) | Closed (dup of #118) | Bypass of GPG signature validation |
| [#16274](https://github.com/anthropics/claude-code/issues/16274) | Open | Marketplace plugin sync triggers YubiKey presence |
| [PR #30521](https://github.com/anthropics/claude-code/pull/30521) | Open | Plugin: `gpg-pinentry-guard` -- PreToolUse hook that blocks git commits when pinentry would fail |

**Official position**: Anthropic has not provided an official fix or recommendation.
The issues keep getting auto-closed by the stale bot despite community activity.

## Approaches and Workarounds

### Approach 1: Switch to SSH Signing (Recommended)

**How it works**: Git 2.34+ supports signing commits with SSH keys instead of GPG.
SSH keys are typically managed by `ssh-agent`, which caches the key for the
process lifetime (unlike `gpg-agent`'s 10-minute default). No pinentry prompt is
needed if the key is already loaded in the agent.

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

For GitHub "Verified" badges:
1. Go to GitHub Settings > SSH and GPG keys
2. Add your SSH public key with Key type: "Signing Key"
3. You may need to add the same key twice (once for Authentication, once for Signing)

For local verification, create `~/.config/git/allowed_signers`:
```
your-email@example.com ssh-ed25519 AAAA...
```
Then: `git config --global gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers`

**Pros**:
- Avoids the pinentry conflict entirely (no passphrase prompt needed if key is in agent)
- Works well with Claude Code's sandbox (SSH agent communicates via `SSH_AUTH_SOCK` unix socket)
- Works with 1Password SSH agent for seamless signing
- Supported by GitHub, GitLab, and Bitbucket

**Cons**:
- Requires Git 2.34+
- Different trust model than GPG (no web of trust)
- Local verification setup is less documented
- Sandbox may need `allowUnixSockets` for the SSH agent socket
- Security consideration: Claude has access to the SSH agent socket and could
  theoretically use it for other purposes (mentioned in issue #118 by @emcd)

**Sandbox config needed**:
```json
{
  "sandbox": {
    "network": {
      "allowUnixSockets": ["~/.ssh/agent-socket"]
    }
  }
}
```
For 1Password: the socket path may contain spaces; see [issue #32224](https://github.com/anthropics/claude-code/issues/32224).

### Approach 2: GUI Pinentry + Passphrase Caching

**How it works**: Use a GUI-based pinentry program (e.g., `pinentry-mac` on macOS,
`pinentry-gnome3` on Linux) that opens a separate window instead of fighting for
the terminal. Combined with aggressive passphrase caching, the GPG agent retains
the passphrase so pinentry is rarely invoked.

macOS setup:
```bash
brew install pinentry-mac
echo "pinentry-program $(which pinentry-mac)" >> ~/.gnupg/gpg-agent.conf
echo "default-cache-ttl 28800" >> ~/.gnupg/gpg-agent.conf   # 8 hours
echo "max-cache-ttl 86400" >> ~/.gnupg/gpg-agent.conf       # 24 hours
gpgconf --kill gpg-agent
```

Also ensure `ignore-cache-for-signing` is NOT in `gpg-agent.conf`.

**Pros**:
- Keeps GPG signing (preserves web of trust, existing key infrastructure)
- GUI pinentry avoids the terminal conflict entirely
- With long cache TTL, passphrase prompt is rare

**Cons**:
- Requires a GUI environment (won't work in headless/SSH sessions)
- Still needs sandbox access to `~/.gnupg` (see Approach 4)
- First-time passphrase entry per session still requires manual interaction
- macOS Keychain integration via GPG Suite can be finicky

### Approach 3: Pre-cache GPG Passphrase Before Claude Session

**How it works**: Before starting Claude Code, trigger GPG to cache the passphrase
by signing something manually. Then the passphrase remains cached for the
configured TTL.

```bash
# Cache passphrase before starting Claude
echo "test" | gpg --clearsign > /dev/null
# Now start Claude Code
claude
```

Or use `gpg-preset-passphrase` for programmatic caching:
```bash
# Get keygrip
gpg --list-keys --with-keygrip
# Preset passphrase
echo "your-passphrase" | /usr/lib/gnupg/gpg-preset-passphrase --preset <KEYGRIP>
```

**Pros**:
- No configuration changes to git or GPG signing method
- Simple to add to shell aliases/functions

**Cons**:
- Manual step before each Claude session
- Passphrase expires after TTL (default 10 min, configurable)
- Still needs sandbox access to `~/.gnupg`
- Storing passphrase in scripts is a security risk

### Approach 4: Sandbox Configuration for ~/.gnupg Access

**How it works**: The sandbox `denyRead` list blocks `~/.gnupg` by default. You
can either:
- Remove `~/.gnupg` from `denyRead` in permissions
- Add `~/.gnupg` to `sandbox.filesystem.allowWrite` (if GPG needs to write)
- Exclude `git` and/or `gpg` from sandbox via `excludedCommands`

Settings in `.claude/settings.json`:
```json
{
  "permissions": {
    "deny": [
      // Remove "Read(~/.gnupg/**)" from deny list, or don't add it
    ]
  },
  "sandbox": {
    "excludedCommands": ["git", "gpg", "gpg-agent"],
    "filesystem": {
      "allowWrite": ["~/.gnupg"]
    }
  }
}
```

Note: The `Read(~/.gnupg/**)` deny rule in permissions is separate from the
sandbox filesystem restrictions. Both need to be addressed:
- `permissions.deny` controls what Claude Code's Read tool can access
- `sandbox.filesystem.denyRead` controls what sandboxed bash commands can read

**Pros**:
- Solves the sandbox access portion of the problem
- `excludedCommands` for `git` means git runs outside the sandbox entirely

**Cons**:
- Does NOT solve the pinentry/terminal conflict (still need Approach 2 or 3)
- Reducing sandbox restrictions weakens security
- `excludedCommands: ["git"]` means all git commands run unsandboxed
- Allowing read access to `~/.gnupg` exposes private keys to Claude

### Approach 5: Disable Signing for AI Commits, Re-sign Later

**How it works**: Let Claude commit without signing, then batch-sign commits
afterward using `git rebase --exec`.

CLAUDE.md instruction:
```
Always use `--no-gpg-sign` when creating git commits.
```

After Claude's session, re-sign the commits:
```bash
git rebase --exec 'git commit --amend --no-edit --gpg-sign' HEAD~N
```
Where N is the number of unsigned commits.

**Pros**:
- Completely avoids all sandbox and pinentry issues
- No security exposure of GPG keys to Claude
- Clean separation: AI writes code, human signs it

**Cons**:
- Requires manual post-processing after every Claude session
- Rebase rewrites history (problematic if already pushed)
- Easy to forget, leaving unsigned commits
- Some orgs enforce signing via server-side hooks (push rejected)

### Approach 6: Custom Slash Command for Signed Commits

**How it works**: Create a `.claude/commands/commit.md` that wraps `git commit -S`.

```markdown
---
description: Creates a GPG/SSH signed git commit.
argument-hint: [commit message]
allowed-tools: Bash(git commit:*)
---
!git commit -S -m "$ARGUMENTS"
```

Then instruct Claude to use `/commit` instead of raw `git commit`.

Add to CLAUDE.md:
```
When creating commits, always use the /commit slash command.
```

**Pros**:
- Explicit signing flag on every commit
- Works with existing GPG/SSH setup
- Can be version-controlled per project

**Cons**:
- Claude must be explicitly told to use it (may forget)
- Does not solve the pinentry terminal conflict
- Does not solve sandbox access issues
- Fragile: depends on Claude following instructions

### Approach 7: PreToolUse Hook (gpg-pinentry-guard Plugin)

**How it works**: [PR #30521](https://github.com/anthropics/claude-code/pull/30521)
proposes a PreToolUse hook that detects when a git command would trigger a broken
terminal pinentry and blocks it with actionable guidance.

Detection pipeline:
1. Is this a git signing command? (commit, tag, merge)
2. Is GPG signing enabled?
3. Is `--no-gpg-sign` already present? -> allow
4. Is the pinentry GUI-based? -> allow (no terminal conflict)
5. Is the passphrase cached in gpg-agent? -> allow (no pinentry needed)
6. Otherwise -> block with guidance

**Pros**:
- Prevents the broken pinentry experience proactively
- Gives actionable error messages
- Smart detection: allows commits when passphrase is cached

**Cons**:
- PR not yet merged (may never be)
- Defensive only: blocks the commit rather than fixing signing
- Complex shell script logic for detection

## Recommended Configuration

For most users, the best approach is a combination:

### Option A: Switch to SSH Signing (simplest)

1. Configure SSH signing (see Approach 1)
2. Ensure SSH key is loaded in agent before starting Claude
3. Remove `Read(~/.gnupg/**)` from deny list (no longer needed)
4. Add SSH agent socket to sandbox allowlist if needed

### Option B: Keep GPG Signing (more setup)

1. Use GUI pinentry (Approach 2) -- solves terminal conflict
2. Configure long cache TTL (8+ hours)
3. Exclude `git` and `gpg` from sandbox (Approach 4)
4. Pre-cache passphrase before Claude session (Approach 3) as belt-and-suspenders
5. Keep `Read(~/.gnupg/**)` in deny list (Claude's Read tool doesn't need it;
   only the git/gpg subprocess does, and those run outside sandbox via `excludedCommands`)

### Option C: Post-session Signing (most secure)

1. Instruct Claude to use `--no-gpg-sign` (Approach 5)
2. Re-sign commits after Claude's session
3. Maximum security: no key material exposed to Claude at all

## Current Project Configuration Analysis

The project's `.claude/settings.json` already has:
- `"Read(~/.gnupg/**)"` in `permissions.deny` -- blocks Claude's Read tool from accessing GPG keys
- `"gpg"` and `"gpg-agent"` in `sandbox.excludedCommands` -- GPG runs outside sandbox
- `"git"` in `sandbox.excludedCommands` -- git runs outside sandbox
- `"Bash(git commit --no-verify *)"` and `"Bash(git commit -n *)"` in deny -- prevents skipping hooks

This means git and gpg already run outside the sandbox, so the sandbox
filesystem restrictions don't apply to them. The remaining issue is the
pinentry/terminal conflict if a passphrase prompt is triggered.

## Sources

### GitHub Issues
- https://github.com/anthropics/claude-code/issues/118
- https://github.com/anthropics/claude-code/issues/7711
- https://github.com/anthropics/claude-code/issues/22532
- https://github.com/anthropics/claude-code/issues/30539
- https://github.com/anthropics/claude-code/issues/5984
- https://github.com/anthropics/claude-code/issues/16274
- https://github.com/anthropics/claude-code/pull/30521

### Official Documentation
- https://code.claude.com/docs/en/sandboxing
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/security
- https://www.anthropic.com/engineering/claude-code-sandboxing

### Community Resources
- https://playbooks.com/skills/melodic-software/claude-code-plugins/gpg-signing
- https://lobehub.com/skills/prorise-cool-claude-code-multi-agent-gpg-signing
- https://patrickmccanna.net/a-better-way-to-limit-claude-code-and-other-coding-agents-access-to-secrets/
- https://perrotta.dev/2026/03/claude-srt-sandbox-runtime/
- https://developer.1password.com/docs/ssh/git-commit-signing/

### Sandbox Runtime
- https://github.com/anthropic-experimental/sandbox-runtime
