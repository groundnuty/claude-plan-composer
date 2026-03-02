# Isolation Methods Comparison for claude-plan-composer

> Research conducted March 2026. Evaluates isolation options for the plan generation
> session — the only pipeline stage with Bash + network access.

## Why Only Plan Generation Needs Isolation

Of the 7 `claude -p` invocations in the pipeline, 6 are already restricted:

| Session | Permission Mode | Tools | Isolation Need |
|---------|----------------|-------|---------------|
| Auto-lens | `dontAsk` | none (text only) | None |
| **Plan generation** | **`dontAsk` + `--allowedTools`** | **Read, Glob, Bash, Write, Web** | **YES** |
| Agent-teams merge | `default` (interactive) | All (user approves) | None (human gate) |
| Simple merge | `acceptEdits` | Write only | None |
| Evaluation | `dontAsk` | none (text only) | None |
| Verification | `dontAsk` | none (text only) | None |
| Pre-mortem | `dontAsk` | none (text only) | None |

Plan generation is the only session that can execute arbitrary Bash commands and access
the network without human approval. It explores the target codebase for 60-80 turns,
making it the primary attack surface.

---

## Options Evaluated

### 1. Native Sandbox (macOS Seatbelt / Linux bubblewrap)

Claude Code's built-in OS-level sandbox. Enabled via `~/.claude/settings.json`.

**How it works:**
- macOS: Uses `sandbox-exec` (Seatbelt) — Apple's process-level sandboxing
- Linux: Uses `bubblewrap` (bwrap) — unprivileged namespace sandboxing
- Windows: Not supported (March 2026)
- Blocklist model: "allow everything except X"

**Configuration:**
```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "allowUnsandboxedCommands": false,
    "excludedCommands": ["git", "devbox", "nix"],
    "filesystem": {
      "denyRead": ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gcloud", "~/.kube"],
      "denyWrite": ["/etc", "/usr", "~/.bashrc", "~/.zshrc"]
    }
  }
}
```

**Strengths:**
- Zero setup (bundled with Claude Code)
- Near-zero runtime overhead
- Full toolchain access (user's installed compilers, package managers, etc.)
- Granular path-level control (`denyRead`, `denyWrite`)
- `autoAllowBashIfSandboxed` eliminates ~84% of permission prompts
- User-global setting — applies to all Claude Code sessions automatically

**Weaknesses:**
- Blocklist model (new sensitive paths must be explicitly added)
- No network domain allowlisting (all outbound traffic allowed)
- Windows not supported
- Runs as same user (no UID isolation)

**Community adoption:**
- 9.3M weekly npm installs (bundled with Claude Code)
- Anthropic's official recommendation for local development
- Lowest barrier to entry

### 2. Anthropic's Official Devcontainer

A standardized Docker-based development environment. Anthropic provides a reference
devcontainer configuration.

**How it works:**
- `devcontainer.json` + `Dockerfile` + `init-firewall.sh`
- Full Docker container with Claude Code pre-installed
- iptables firewall restricts network to Anthropic API only
- Allowlist model: "deny everything except X"

**Configuration:**
- Clone Anthropic's devcontainer repo or add to project
- Build with `CLAUDE_CODE_VERSION` build arg for version pinning
- `init-firewall.sh` configures iptables at container start

**Strengths:**
- Strongest default security posture (allowlist model)
- Network isolation by default (only Anthropic API allowed)
- Full filesystem isolation (container sees only mounted volumes)
- Reproducible environment across team members
- Cross-platform (macOS, Linux, Windows with Docker Desktop)

**Weaknesses:**
- **Toolchain mismatch**: Plan generation needs the user's build tools (make, npm,
  cargo, python, etc.) to understand the target codebase. A generic container won't
  have them. Installing at runtime wastes 3-5 minutes and 20-40 API turns per variant.
- Docker Desktop required (license cost for enterprises)
- Higher latency (container start, volume mounts)
- Not suitable for analyzing the host machine's codebase without bind mounts
  (which weaken isolation)
- Requires Docker knowledge to customize

**Community adoption:**
- ~220 GitHub stars (anthropics/claude-code-devcontainer)
- ~205 open issues — active development
- Primarily adopted by teams needing reproducible environments

### 3. Docker Sandboxes (Docker Desktop 4.58+)

Docker Desktop's built-in microVM isolation for AI coding agents.

**How it works:**
- `docker model` CLI or API
- Each session gets an isolated microVM (stronger than containers)
- Automatic filesystem snapshots for rollback
- Zero-config — works with any Docker model runner

**Strengths:**
- Strongest isolation (microVM, not just namespaces)
- Zero configuration
- Automatic rollback via filesystem snapshots
- Cross-platform (macOS, Linux, Windows)

**Weaknesses:**
- Requires Docker Desktop 4.58+ (March 2025)
- No version pinning for the agent runtime
- Same toolchain mismatch as devcontainer (generic environment)
- Experimental / rapidly evolving API
- Docker Desktop license required

**Community adoption:**
- Growing but still experimental
- Primarily used for one-off agent tasks, not pipelines

### 4. Third-Party Tools

| Tool | Description | Status |
|------|-------------|--------|
| `cco` | Community wrapper for `--dangerously-skip-permissions` in Docker | Minimal maintenance, ~50 GitHub stars |
| Trail of Bits `ctf-claude` | Nix-based sandbox with seccomp + netns | Research project, not production-ready |
| Firejail | Linux-only process sandbox | Not Claude Code-aware, manual config |
| nsjail / gVisor | Container sandboxing | Over-engineered for this use case |

None of these are widely adopted for Claude Code specifically.

---

## Per-Property Comparison

| Property | Native Sandbox | Devcontainer | Docker Sandboxes |
|----------|---------------|-------------|-----------------|
| **Setup** | 1 JSON file | Dockerfile + devcontainer.json | Docker Desktop install |
| **Runtime overhead** | ~0 | 2-5s container start | 5-10s microVM start |
| **Filesystem isolation** | Blocklist (`denyRead/Write`) | Allowlist (mount only needed dirs) | Full isolation (microVM) |
| **Network isolation** | None (all outbound allowed) | iptables firewall (API only) | Full isolation (microVM) |
| **Process isolation** | Same user, sandboxed syscalls | Container (namespaced) | MicroVM (hardware-level) |
| **Toolchain access** | Full (user's environment) | Must install in container | Must install in microVM |
| **Cross-platform** | macOS + Linux | macOS + Linux + Windows | macOS + Linux + Windows |
| **User-global** | Yes (`~/.claude/settings.json`) | No (per-project) | No (per-session) |
| **Anthropic support** | Official, bundled | Official reference | Docker partnership |
| **Cost** | Free | Docker Desktop license | Docker Desktop license |

---

## Analysis for Plan Generation

The plan generation session has a unique constraint: it must explore an arbitrary
codebase using the user's installed toolchain (compilers, package managers, build
systems, linters). This makes isolation approaches that require pre-installing tools
impractical for the general case.

### Why native sandbox wins for plan generation

1. **Toolchain availability**: The agent runs in the user's environment with all their
   tools available. No installation overhead, no wasted API turns.

2. **Zero friction**: A single `settings.json` change enables protection for all
   sessions. No Docker, no container builds, no per-project config.

3. **Credential protection**: `denyRead` for `~/.ssh`, `~/.aws`, `~/.gnupg` blocks
   the most critical exfiltration vectors regardless of what Bash commands the agent
   runs.

4. **Already deployed protection**: The `--allowedTools` whitelist blocks unexpected
   tool types (e.g., MCP tools from malicious `.claude/settings.json` in target repos).
   The sandbox adds OS-level protection on top of this.

### When devcontainer/Docker is better

- **Untrusted codebases**: When analyzing malicious repos, a container provides
  stronger isolation than a blocklist sandbox. The allowlist model means the agent
  can only access explicitly mounted directories.

- **Team environments**: When multiple developers need identical environments,
  the devcontainer ensures consistency.

- **CI/CD pipelines**: Automated runs on shared infrastructure should use containers
  for tenant isolation.

---

## Recommended Layered Approach

```
Layer 1 (framework):  --allowedTools whitelist           ← Deployed
Layer 2 (framework):  XML prompt injection boundaries    ← Deployed
Layer 3 (framework):  Config validation warnings         ← Deployed
Layer 4 (user):       Native sandbox with denyRead       ← Recommended
Layer 5 (optional):   PreToolUse hook for Bash patterns  ← Defense-in-depth
Layer 6 (optional):   Devcontainer for untrusted repos   ← Maximum isolation
```

Layers 1-3 are framework-controlled and always active. Layers 4-6 are user-global
settings that provide increasing isolation at increasing setup cost.

**For most users**: Layers 1-4 provide strong protection with zero Docker dependency.

**For security-critical deployments**: Add Layer 6 (devcontainer) when analyzing
untrusted codebases on shared infrastructure.

---

## Platform Support Matrix

| Method | macOS | Linux | Windows | WSL2 |
|--------|-------|-------|---------|------|
| Native sandbox | Seatbelt | bubblewrap | No | bubblewrap |
| Devcontainer | Docker Desktop | Docker Engine | Docker Desktop | Docker Engine |
| Docker Sandboxes | Docker Desktop 4.58+ | Docker Desktop 4.58+ | Docker Desktop 4.58+ | N/A |
| `--allowedTools` | Yes | Yes | Yes | Yes |
| Config validation | Yes | Yes | Yes | Yes |

Windows users without WSL2 must use Docker-based isolation (devcontainer or Docker
Sandboxes) since the native sandbox is not available.

---

## References

- `research/laptop-threat-model.md` — threat model and risk summary
- `research/permissions-hardening.md` — permission mode changes
- [Claude Code sandboxing docs](https://docs.anthropic.com/en/docs/claude-code/security#sandboxing)
- [Anthropic devcontainer](https://github.com/anthropics/claude-code-devcontainer)
- [Docker Sandboxes announcement](https://www.docker.com/blog/docker-ai-agent-sandboxes/)
