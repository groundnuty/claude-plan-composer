# Claude SDKs vs `claude -p`: Comparison for Multi-Session Orchestration (March 2026)

Should claude-plan-composer use a Claude SDK instead of shelling out to `claude -p`?

## SDK ecosystem (complete, March 2026)

| Package | Language | Type | Install |
|---------|----------|------|---------|
| `@anthropic-ai/claude-agent-sdk` | **TypeScript** | Agent SDK | `npm install @anthropic-ai/claude-agent-sdk` |
| `claude-agent-sdk` | **Python** | Agent SDK | `pip install claude-agent-sdk` |
| `@anthropic-ai/sdk` | **TypeScript** | Client SDK | `npm install @anthropic-ai/sdk` |
| `anthropic` | **Python** | Client SDK | `pip install anthropic` |

## Available options

### 1. Claude Agent SDK (TypeScript + Python)

**What it is:** The same agent runtime powering Claude Code, packaged as a library.
Claude Code itself is TypeScript, so the **TypeScript SDK is the native binding** —
the Python version wraps the same CLI subprocess.

**TypeScript (primary — native binding):**
- GitHub: [anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)
- Requires Node.js 20+, TypeScript >= 4.9
- Two interfaces: `query()` (stateless one-shot) and `ClaudeSDKClient` (stateful multi-turn)

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// Parallel variant generation
const results = await Promise.all(
  variants.map(async (v) => {
    const messages = [];
    for await (const msg of query({
      prompt: v.prompt,
      options: {
        allowedTools: ["Read", "Write", "Bash"],
        model: "claude-opus-4-6",
        maxTurns: 20,
        maxBudgetUsd: 5.0,
        cwd: workDir,
        permissionMode: "acceptEdits",
        systemPrompt: v.systemPrompt,
        hooks: { /* PreToolUse, PostToolUse, Stop */ },
        agents: { /* subagent definitions */ },
      },
    })) {
      messages.push(msg);
    }
    return messages;
  })
);
```

**Python (wrapper):**

```python
from claude_agent_sdk import query, ClaudeAgentOptions

async def run_variant(prompt, variant_name):
    options = ClaudeAgentOptions(
        allowed_tools=["Read", "Write", "Bash"],
        cwd=f"/work/{variant_name}",
        max_turns=20,
        max_budget_usd=5.0,
        model="claude-opus-4-6",
    )
    async for message in query(prompt=prompt, options=options):
        if hasattr(message, "result"):
            return message.result

results = await asyncio.gather(
    run_variant("Architecture lens...", "v1"),
    run_variant("Security lens...", "v2"),
    run_variant("Performance lens...", "v3"),
    run_variant("Testing lens...", "v4"),
)
```

**Key features (both languages):**
- Same built-in tools as Claude Code (Read, Write, Bash, Glob, Grep, Agent)
- `maxBudgetUsd` / `max_budget_usd` for cost control (vs timeout-based termination)
- Hooks (PreToolUse, PostToolUse, Stop) for observability
- `canUseTool` / `can_use_tool` callback for runtime permission policies
- Session resume/fork for multi-turn workflows
- Subagent definitions (isolated child sessions)
- Typed message objects (vs parsing NDJSON logs)

**Architecture detail:** Both SDKs spawn the Claude Code CLI as a subprocess and
communicate via JSON-lines protocol. Requires Node.js. Same billing as `claude -p`.
The TypeScript SDK is the native implementation; Python wraps it.

### 2. Anthropic Client SDK (`anthropic`)

**What it is:** Low-level API client. Direct Messages API access. You build everything.

```python
import anthropic

client = anthropic.AsyncAnthropic()
response = await client.messages.create(
    model="claude-opus-4-6",
    max_tokens=16000,
    system="You are an architecture analyst...",
    messages=[{"role": "user", "content": prompt}],
)
```

**Key features:**
- Direct API access (no CLI subprocess overhead)
- Tool use with JSON Schema definitions
- Prompt caching (up to 90% input cost reduction)
- Batch API (50% discount for 24-hour async)
- Extended thinking / streaming
- Token counting for budget control

**What you DON'T get:** No built-in file R/W, no bash execution, no session persistence, no MCP, no subagents. You implement every tool yourself.

### 3. Third-party frameworks

| Framework | Strengths | Weaknesses | Claude support |
|-----------|-----------|------------|----------------|
| **LangGraph** | Battle-tested, visual debug, persistence | Heavy abstraction, steep learning curve | Via ChatAnthropic |
| **CrewAI** | Lowest barrier, role-based teams | Less control, no file/bash tools | Via LiteLLM |
| **Microsoft Agent Framework** | Multi-party debates | Transitional (merging SDKs) | Multi-provider |

All third-party frameworks: you implement every tool, add abstraction without adding capability for Claude-only pipelines.

## Head-to-head comparison for this project

| Dimension | `claude -p` (current) | Agent SDK | Client SDK |
|-----------|----------------------|-----------|------------|
| **Parallel sessions** | Shell `&` + `wait` | `Promise.all()` / `asyncio.gather()` | `Promise.all()` / `asyncio.gather()` |
| **Tool use** | Built-in | Built-in (same) | You build everything |
| **Output capture** | Parse NDJSON / Write tool | Typed message objects | Response objects |
| **Budget control** | `timeout` command | `max_budget_usd` | Manual token tracking |
| **Monitoring** | Parse NDJSON logs | Hooks (Pre/PostToolUse) | Manual logging |
| **Error handling** | Exit codes + log parsing | Python exceptions | Python exceptions |
| **Agent-teams/debate** | Interactive only (experimental) | Subagents + agent-teams (headless via env var) | You build entirely |
| **Cost model** | API key or Max subscription | API key or Max subscription | API key only |
| **Prompt caching** | Not available | Not available | Up to 90% input savings |
| **Batch API** | Not available | Not available | 50% discount (24h async) |
| **Complexity** | Already working | Moderate rewrite | High (build everything) |

## Cost comparison per pipeline run (4 variants × ~13K output tokens)

| Approach | Billing | Marginal cost |
|----------|---------|---------------|
| `claude -p` with Max $200/mo | Flat subscription | $0 (within limits) |
| `claude -p` or Agent SDK with API key | Per-token | ~$1.90 (Sonnet) |
| Client SDK with prompt caching | Per-token, cached | ~$1.00 (Sonnet, cached input) |
| Client SDK Batch API | 50% discount, 24h | ~$0.95 (Sonnet) |

## Recommendation

### Stay with `claude -p` for now

1. **It works.** 116 tests, proven pipeline, documented workarounds.
2. **Agent SDK spawns the same CLI.** Cleaner API, but same engine underneath.
3. **Agent-teams (debate) still experimental.** JSONL-monitoring approach is battle-tested.
4. **Shell orchestration is simpler for 4 parallel jobs.** `&` + `wait` + `timeout` is fewer lines than asyncio boilerplate.

### Migrate to Agent SDK when you need:

- **Programmatic hooks** — intercepting tool calls, structured audit trails, dynamic behavior modification mid-run. Far superior to parsing NDJSON logs.
- **Budget control** — `max_budget_usd=5.0` is cleaner than timeout-based termination.
- **Session forking** — A/B testing merge strategies from the same analysis state.
- **Typed output** — structured message objects instead of parsing Write tool artifacts.
- **Agent-teams GA** — once agent-teams exits experimental, SDK is the natural orchestration layer.

### Consider Client SDK when you need:

- **Prompt caching** — 90% input cost savings for repeated system prompts across variants.
- **Batch processing** — 50% discount for non-time-critical evaluation runs.
- **No Claude Code overhead** — direct API without spawning CLI subprocess.
- **Pure text generation** — if pipeline shifts away from file system interaction.

### Skip third-party frameworks unless:

- You need multi-provider support (not just Claude).
- You need specific orchestration patterns (graph-based, role-based crews).
- For Claude-only pipelines, they add abstraction without adding capability.

## Language choice for migration

If migrating from bash, the language choice depends on the SDK:

| SDK | Recommended language | Why |
|-----|---------------------|-----|
| Agent SDK | **TypeScript** | Native binding (Claude Code is TS), no wrapper overhead |
| Agent SDK | Python | Also works, but wraps the TS CLI subprocess |
| Client SDK | **Python** | Best benchmark performance, richest ecosystem |
| Client SDK | TypeScript | Also full-featured, type-safe |

The TypeScript Agent SDK is particularly interesting because:
1. Claude Code is written in TypeScript — the SDK is the native interface
2. `Promise.all()` for parallel sessions is idiomatic
3. Full type safety on message objects, hooks, options
4. Same Node.js runtime that Claude Code already requires

However, per the language benchmarks (see `research/language-analysis.md`),
**TypeScript is 1.6x slower/costlier than JavaScript for Claude to generate**.
This is a trade-off: native SDK binding vs generation efficiency.

## Migration path (if/when)

```
Current:        bash + claude -p
                    ↓ (when hooks/budget/typing needed)
Phase 1:        TypeScript + Agent SDK (native binding, same billing)
                    — or Python + Agent SDK (if team prefers Python)
                    ↓ (when agent-teams stabilizes)
Phase 2:        Agent SDK with programmatic agent-teams
                    ↓ (when cost optimization needed)
Phase 3:        Hybrid: Agent SDK for generation, Client SDK for evaluation
                         (prompt caching on repeated eval prompts)
```

Each phase is incremental. No big-bang rewrite needed.

## References

- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK TypeScript (GitHub)](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Agent SDK Python Reference](https://platform.claude.com/docs/en/agent-sdk/python)
- [Agent SDK Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [Agent SDK Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Agent SDK Migration Guide](https://platform.claude.com/docs/en/agent-sdk/migration-guide)
- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless)
- [Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Implement Tool Use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)
- [Anthropic Python SDK](https://github.com/anthropics/anthropic-sdk-python)
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [Claude Agent SDK Demos](https://github.com/anthropics/claude-agent-sdk-demos)
- [Inside Claude Agent SDK Architecture](https://buildwithaws.substack.com/p/inside-the-claude-agent-sdk-from)
- [Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
