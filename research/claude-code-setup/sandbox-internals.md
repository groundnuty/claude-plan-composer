# Claude Code Sandbox Internals

Research date: 2026-03-11

## Architecture Overview

Claude Code's sandbox has **three layers** of enforcement:

1. **OS-level sandbox runtime** (`@anthropic-ai/sandbox-runtime`) -- Seatbelt on macOS, bubblewrap on Linux
2. **Claude Code application logic** -- `excludedCommands`, `allowUnsandboxedCommands`, `dangerouslyDisableSandbox`
3. **System prompt instructions** -- The model sees sandbox restrictions in tool definitions and follows behavioral rules

These layers are **independent** and can conflict.

## Layer 1: OS-Level Sandbox Runtime

Source: [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)

### How Seatbelt Profiles Work (macOS)

On macOS, each sandboxed command is wrapped with `sandbox-exec -p <profile>` where the profile is a **dynamically generated** Seatbelt SBPL profile. The profile structure:

```
(version 1)
(deny default (with message "..."))    ; deny everything by default
(allow process-exec)                    ; allow running processes
(allow process-fork)                    ; allow forking
(allow file-read*)                      ; allow all reads (then deny specific paths)
(deny file-read* (subpath "/path"))     ; deny reads to specific paths
(allow file-write* (subpath "/path"))   ; allow writes to specific paths
(deny file-write* (subpath "/path"))    ; deny writes within allowed paths
```

Key files:
- `src/sandbox/macos-sandbox-utils.ts` -- Seatbelt profile generation
- `src/sandbox/sandbox-utils.ts` -- Path normalization, dangerous file lists
- `src/sandbox/sandbox-config.ts` -- Zod schemas for config validation

### Read Restrictions: Deny-Only Model

Read access uses a **deny-only** pattern:
- `undefined` config = no restrictions (allow all reads)
- `{denyOnly: []}` = no restrictions (empty deny = allow all)
- `{denyOnly: ["~/.ssh", "~/.aws"]}` = deny these paths, allow everything else

The `denyRead` paths from settings are passed directly as `FsReadRestrictionConfig.denyOnly`.

### Write Restrictions: Allow-Only Model

Write access uses an **allow-only** pattern:
- `undefined` config = no restrictions (allow all writes)
- `{allowOnly: [], denyWithinAllow: []}` = deny ALL writes
- `{allowOnly: ["."], denyWithinAllow: [".git/hooks"]}` = allow cwd, block hooks

### Hardcoded Dangerous Files (CANNOT Be Overridden)

The sandbox runtime has a `DANGEROUS_FILES` constant and `getDangerousDirectories()` that are **always** denied for writes, regardless of user configuration:

```typescript
export const DANGEROUS_FILES = [
  '.gitconfig', '.gitmodules', '.bashrc', '.bash_profile',
  '.zshrc', '.zprofile', '.profile', '.ripgreprc', '.mcp.json',
] as const

export const DANGEROUS_DIRECTORIES = ['.git', '.vscode', '.idea'] as const
// getDangerousDirectories() returns: .vscode, .idea, .claude/commands, .claude/agents
// (.git is excluded because git needs write access, but .git/hooks is always blocked)
```

These are combined with user-specified `denyWithinAllow` paths in `generateWriteRules()`. The function `macGetMandatoryDenyPatterns()` generates deny rules for:
- Each dangerous file in cwd + `**/<filename>` glob
- Each dangerous directory + `**/<dirname>/**` glob
- `.git/hooks` always blocked
- `.git/config` blocked unless `allowGitConfig: true`

### Default Write Paths

`getDefaultWritePaths()` provides paths that are always writable:
```typescript
['/dev/stdout', '/dev/stderr', '/dev/null', '/dev/tty',
 '/dev/dtracehelper', '/dev/autofs_nowait',
 '/tmp/claude', '/private/tmp/claude',
 '~/.npm/_logs', '~/.claude/debug']
```

### No Hardcoded DenyRead in the Runtime

**Critical finding**: The sandbox-runtime itself has **NO hardcoded denyRead paths**. The deny list for `~/.ssh`, `~/.gnupg`, `~/.aws`, etc. comes entirely from **Claude Code's configuration layer**, not from the runtime.

### Network Isolation

Network access is forced through a proxy:
- HTTP proxy on a localhost port
- SOCKS proxy on a localhost port
- Seatbelt profile only allows connections to these proxy ports
- All other network access is blocked at the OS level
- The proxy filters by domain (allowedDomains/deniedDomains)
- SSH over SOCKS is configured via `GIT_SSH_COMMAND=ssh -o ProxyCommand='nc -X 5 -x localhost:PORT %h %p'`

## Layer 2: Claude Code Application Logic

Claude Code (closed-source) sits between the model and the sandbox runtime. It handles:

### `excludedCommands`

**Documented behavior**: Commands listed should run outside the sandbox entirely.

**Actual behavior (as of v2.1.x)**: There are well-documented bugs:

1. **Exact match problem**: `"excludedCommands": ["git"]` only matches the literal string `"git"` with no arguments. You need `"git:*"` to match `git commit`, `git push`, etc. (Issue [#10524](https://github.com/anthropics/claude-code/issues/10524))

2. **Network sandbox still applied**: Even when a command is excluded, proxy environment variables (HTTP_PROXY, HTTPS_PROXY) are still set, breaking tools that reject HTTP proxies or need direct network access. (Issue [#12150](https://github.com/anthropics/claude-code/issues/12150))

3. **DNS blocked**: `excludedCommands` may bypass filesystem restrictions but not network restrictions. SSH connections fail because DNS resolution through systemd-resolved (127.0.0.53) is blocked. (Issue [#29274](https://github.com/anthropics/claude-code/issues/29274))

4. **Still runs sandboxed first**: Commands may still attempt sandboxed execution first, then fall back to unsandboxed only after failure. (Issue [#22620](https://github.com/anthropics/claude-code/issues/22620))

**Workaround**: Use `"command:*"` syntax (e.g., `"gpg:*"`, `"git:*"`) instead of bare command names.

### `allowUnsandboxedCommands`

Controls whether `dangerouslyDisableSandbox: true` is honored:
- `true` (default): The model can set `dangerouslyDisableSandbox: true` on the Bash tool, which runs the command outside the sandbox but still requires user permission through the normal approval flow.
- `false`: The `dangerouslyDisableSandbox` parameter is completely ignored. All commands must run sandboxed or be in `excludedCommands`.

### `dangerouslyDisableSandbox` (Bash tool parameter)

This is a parameter on the Bash tool that the **model** sets (not the user):
1. A command fails inside the sandbox
2. The model analyzes the failure
3. The model retries with `dangerouslyDisableSandbox: true`
4. Claude Code shows a permission prompt to the user (unless Bash is auto-approved, which is a security issue -- [#14268](https://github.com/anthropics/claude-code/issues/14268))
5. If approved, the command runs completely outside the sandbox

**Security concern**: If the user has `Bash(*)` in their allow list (as in your settings), `dangerouslyDisableSandbox: true` executes without any user confirmation.

### `autoAllowBashIfSandboxed`

When `true`, sandboxed bash commands are automatically approved without user permission prompts. Commands that fail the sandbox still go through the normal permission flow (unless `Bash(*)` is in the allow list).

## Layer 3: System Prompt Instructions

Claude Code injects sandbox restrictions into the tool definitions seen by the model. The restrictions shown in the Bash tool description (visible at the top of this conversation) are **dynamically generated** from the merged settings.

### What the Model Sees

The Bash tool description includes:
- Filesystem restrictions: `read.denyOnly`, `write.allowOnly`, `write.denyWithinAllow`
- Network restrictions: `allowedHosts`
- Instructions about `dangerouslyDisableSandbox` behavior
- Evidence patterns for sandbox failures
- Rules about retrying without sandbox

### How Settings Merge Into the Prompt

Permission deny rules from `permissions.deny` (like `Read(~/.ssh/**)`) are **merged** with `sandbox.filesystem.denyRead` paths and injected into the tool definition. This is why issue [#27757](https://github.com/anthropics/claude-code/issues/27757) found that large deny lists bloat the system prompt to 607k tokens -- each rule is expanded into the tool definition.

### The Deny List in Tool Definitions Is Both Documentation AND Enforcement

The sandbox restrictions shown in tool definitions serve **dual purposes**:
1. **Model guidance**: Tells the model what restrictions exist so it can explain failures
2. **OS-level enforcement**: The same values are passed to the sandbox runtime which enforces them via Seatbelt/bubblewrap

The model cannot override the OS-level enforcement by ignoring the prompt. However, the model CAN use `dangerouslyDisableSandbox: true` as an escape hatch (if `allowUnsandboxedCommands` is true).

## Settings Precedence and Merging

### Precedence (highest to lowest)

1. **Managed settings** (`/Library/Application Support/ClaudeCode/managed-settings.json` on macOS) -- CANNOT be overridden
2. **Command line arguments**
3. **Local project settings** (`.claude/settings.local.json`)
4. **Shared project settings** (`.claude/settings.json`)
5. **User settings** (`~/.claude/settings.json`)

### Array Merging

Array settings (like `denyRead`, `allowWrite`, `excludedCommands`) are **concatenated and deduplicated** across scopes, not replaced. Lower-priority scopes add to the list but cannot remove items added by higher-priority scopes.

### Can Project Settings Override System Deny Lists?

**No.** Project settings can only **add** restrictions, never remove them. If managed settings deny `~/.ssh`, a project setting cannot undo that.

However, there are **no managed settings** on your system (`/Library/Application Support/ClaudeCode/managed-settings.json` does not exist), so all restrictions come from user and project settings.

## The `/sandbox` Command

`/sandbox` is an interactive CLI command within Claude Code that opens a menu to:
1. Toggle sandbox on/off
2. Choose between auto-allow mode and regular permissions mode
3. Check for required dependencies (bubblewrap/socat on Linux)

It modifies settings and does not provide direct control over individual restrictions.

## Why GPG Fails Despite `excludedCommands`

### The Problem

`gpg --clearsign` fails with "can't create directory ~/.gnupg" even though `gpg` is in `excludedCommands`.

### Root Cause Analysis

Multiple factors combine:

1. **Exact match bug**: `"gpg"` in `excludedCommands` only matches the bare command `gpg` with no arguments. `gpg --clearsign` is not matched. **Fix**: Use `"gpg:*"`.

2. **denyRead blocks ~/.gnupg**: Your `permissions.deny` includes `Read(~/.gnupg/**)`. This gets merged into `sandbox.filesystem.denyRead` and enforced at the OS level via Seatbelt. Even if `excludedCommands` worked correctly, the **read deny** would still block gpg from reading `~/.gnupg`.

3. **Write access to ~/.gnupg not granted**: `~/.gnupg` is not in `sandbox.filesystem.allowWrite`. GPG needs to create/write to `~/.gnupg` for its keyring, agent socket, etc.

4. **Network proxy interference**: Even excluded commands get proxy environment variables set, which can interfere with GPG keyserver operations.

### Fix Options

**Option A: Use `excludedCommands` with wildcard syntax**
```json
"excludedCommands": ["gpg:*", "gpg-agent:*", "git:*"]
```
This should bypass the sandbox entirely for these commands. However, due to known bugs, this may still not bypass network restrictions or proxy settings.

**Option B: Grant filesystem access (keeps sandbox protection)**
```json
"sandbox": {
  "filesystem": {
    "allowWrite": ["~/.gnupg"],
    "denyRead": []  // Remove ~/.gnupg from deny if present
  }
}
```
And remove `Read(~/.gnupg/**)` from `permissions.deny`. This keeps GPG sandboxed but gives it the access it needs.

**Option C: Accept `dangerouslyDisableSandbox` as the escape hatch**
With `allowUnsandboxedCommands: true` (your current setting), when gpg fails in the sandbox, the model retries with `dangerouslyDisableSandbox: true`. Since you have `Bash(*)` in your allow list, this auto-approves without prompting. This works but wastes an API call on the failed first attempt.

**Recommended: Option A + B combined**
```json
{
  "sandbox": {
    "excludedCommands": ["ssh:*", "scp:*", "rsync:*", "devbox:*", "nix:*", "git:*", "gpg:*", "gpg-agent:*"],
    "filesystem": {
      "allowWrite": ["~/.gnupg", "~/.cache/devbox", "~/.local/share/devbox", "~/.nix-profile", "/nix"]
    }
  },
  "permissions": {
    "deny": [
      // Remove "Read(~/.gnupg/**)" if GPG signing is needed
      "Read(~/.ssh/id_*)",
      "Read(~/.ssh/*.pem)",
      "Read(~/.aws/**)"
    ]
  }
}
```

## Sources

- [Claude Code Sandboxing Docs](https://code.claude.com/docs/en/sandboxing)
- [Claude Code Settings Docs](https://code.claude.com/docs/en/settings)
- [Anthropic Engineering Blog: Making Claude Code More Secure](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [sandbox-runtime GitHub](https://github.com/anthropic-experimental/sandbox-runtime)
- [Issue #10524: excludedCommands not respected](https://github.com/anthropics/claude-code/issues/10524) -- `:*` suffix workaround discovered
- [Issue #16076: excludedCommands and allowUnixSockets not working](https://github.com/anthropics/claude-code/issues/16076) -- closed NOT_PLANNED
- [Issue #29274: excludedCommands doesn't bypass network sandbox](https://github.com/anthropics/claude-code/issues/29274) -- `git:*` syntax confirmed
- [Issue #22620: excludedCommands doesn't bypass sandbox for uv](https://github.com/anthropics/claude-code/issues/22620) -- permission rules alternative
- [Issue #12150: Proxy set for excluded commands](https://github.com/anthropics/claude-code/issues/12150) -- closed NOT_PLANNED
- [Issue #14268: dangerouslyDisableSandbox bypasses prompts](https://github.com/anthropics/claude-code/issues/14268)
- [Issue #27757: Large deny list causes 607k token prompt](https://github.com/anthropics/claude-code/issues/27757)
- [DeepWiki: macOS Sandboxing](https://deepwiki.com/anthropic-experimental/sandbox-runtime/6.2-macos-sandboxing)
- [System prompt fragments](https://github.com/Piebald-AI/claude-code-system-prompts)
