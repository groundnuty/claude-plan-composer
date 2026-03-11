# Claude Code Plugins & Skills Ecosystem Research

> Date: 2026-03-11
> Sources: GitHub, official docs, blog posts, community reviews, adoption metrics

---

## Table of Contents

1. [Plugin Architecture: How It Works](#1-plugin-architecture-how-it-works)
2. [Official Anthropic Plugins](#2-official-anthropic-plugins)
3. [Community Plugins](#3-community-plugins)
4. [Plugin Overlap & Conflict Analysis](#4-plugin-overlap--conflict-analysis)
5. [Performance Impact & Token Economics](#5-performance-impact--token-economics)
6. [TypeScript-Specific Plugins](#6-typescript-specific-plugins)
7. [Community Recommendations](#7-community-recommendations)
8. [Security Considerations](#8-security-considerations)
9. [Recommendations for Our Setup](#9-recommendations-for-our-setup)

---

## 1. Plugin Architecture: How It Works

### Skill Loading: Progressive Disclosure (Lazy, Not Eager)

Skills use a **three-stage progressive disclosure** model:

1. **Startup**: Only skill names, descriptions, and frontmatter metadata are loaded (~100 tokens each). These populate the `<available_skills>` section in the Skill tool description.
2. **On selection**: When Claude matches user intent to a skill, the full `SKILL.md` content loads into conversation context (500-5,000 words, ~1,500+ tokens).
3. **During execution**: Helper assets, reference files, and scripts load as needed.

This prevents context bloat while maintaining discoverability.

### Where Skills Live in the API

Skills do **not** live in the system prompt. They exist as part of the `Skill` meta-tool's description within the `tools` array of API requests. The Skill tool formats all available skills into its description prompt, and Claude decides which skill to invoke based on textual understanding.

When invoked, a skill injects **two user messages**: one visible (metadata) and one hidden (`isMeta: true` for the API). Skills can also dynamically pre-approve tool permissions and override model selection.

### Skill Description Budget

There is a hard **~16,000 character budget** for the `<available_skills>` section (approximately 2% of context window). Key measurements:

| Description Length | Max Skills Visible |
|---|---|
| 263 chars (observed avg) | ~42 skills |
| 200 chars | ~52 skills |
| 150 chars | ~60 skills |
| 130 chars | ~67 skills |
| 100 chars | ~75 skills |

Each skill has ~109 characters of XML/metadata overhead beyond the description. When the budget is exceeded, **excess skills become invisible** to Claude -- it cannot invoke what it cannot see. This is cumulative, not per-skill.

Important: `defer_loading` and Tool Search apply only to MCP **tools**, not skills. Skills have no deferred loading mechanism.

### Plugin Components

A plugin is a directory containing any combination of:
- **Skills** (`skills/*/SKILL.md`) -- instruction sets loaded on demand
- **Agents** (`agents/*.md`) -- subagent definitions
- **Commands** (`commands/*.md`) -- slash commands
- **Hooks** (`hooks.json` or TypeScript hooks) -- event-driven automations
- **MCP servers** -- external tool integrations

Source: [Claude Agent Skills Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/)

---

## 2. Official Anthropic Plugins

### Internal Plugins (30 total, in `anthropics/claude-plugins-official`)

Source: [anthropics/claude-plugins-official/plugins](https://github.com/anthropics/claude-plugins-official/tree/main/plugins)

#### Development Workflows
| Plugin | Description | Relevance |
|---|---|---|
| **superpowers** | Agentic skills framework: TDD, planning, brainstorming, debugging, subagent-driven dev, code review. 42K+ GitHub stars. By obra/Jesse Vincent. | HIGH |
| **feature-dev** | Guided feature dev with code-explorer, code-architect, code-reviewer agents. `/feature-dev` command. | HIGH |
| **commit-commands** | Commit/push/PR shortcuts. | MEDIUM |
| **code-review** | Automated PR review with 5 specialized agents, confidence-based scoring (0-100 threshold). By Boris Cherny. | HIGH |
| **pr-review-toolkit** | 6 specialized review agents: comment analyzer, test analyzer, silent failure hunter, type design analyzer, code reviewer, code simplifier. | MEDIUM |
| **code-simplifier** | Identifies complexity, suggests simplifications while preserving functionality. | LOW |
| **ralph-loop** | Autonomous long-running coding sessions via stop hook. Re-feeds prompt until completion or max iterations. | MEDIUM |
| **security-guidance** | PreToolUse hook monitoring 9 security patterns: command injection, XSS, eval, pickle, os.system, etc. | MEDIUM |

#### Project Setup & Meta
| Plugin | Description | Relevance |
|---|---|---|
| **claude-code-setup** | Analyzes codebase, recommends tailored automations (hooks, skills, MCP servers, subagents). | LOW (one-time) |
| **claude-md-management** | Audits CLAUDE.md quality, captures session learnings, proposes improvements. | LOW |
| **plugin-dev** | Toolkit for developing Claude Code plugins with 7 expert skills. | LOW |
| **skill-creator** | 4 modes: Create, Eval, Improve, Benchmark for skill development lifecycle. | LOW |
| **hookify** | Commands for creating/managing hooks. Includes conversation-analyzer agent. | LOW |
| **playground** | Creates interactive HTML playgrounds with 6 templates (design, data, code map, diff review, etc.). | LOW |

#### Output Styles
| Plugin | Description | Relevance |
|---|---|---|
| **explanatory-output-style** | SessionStart hook adding educational insights about implementation choices. | LOW |
| **learning-output-style** | Interactive learning: user contributes code at decision points. | LOW |

#### Language Server Protocol (LSP)
| Plugin | Description | Relevance |
|---|---|---|
| **typescript-lsp** | TypeScript/JavaScript language server for go-to-definition, find references, type errors. | HIGH (but buggy) |
| **clangd-lsp** | C/C++ LSP | N/A |
| **csharp-lsp** | C# LSP | N/A |
| **gopls-lsp** | Go LSP | N/A |
| **jdtls-lsp** | Java LSP | N/A |
| **kotlin-lsp** | Kotlin LSP | N/A |
| **lua-lsp** | Lua LSP | N/A |
| **php-lsp** | PHP LSP | N/A |
| **pyright-lsp** | Python LSP | N/A |
| **ruby-lsp** | Ruby LSP | N/A |
| **rust-analyzer-lsp** | Rust LSP | N/A |
| **swift-lsp** | Swift LSP | N/A |

#### Other
| Plugin | Description | Relevance |
|---|---|---|
| **agent-sdk-dev** | `/new-sdk-app` command + verifier agents for Agent SDK projects. | LOW |
| **frontend-design** | ~400 tokens of typography, color, motion, spatial composition guidance. | N/A |
| **example-plugin** | Template/reference plugin. | N/A |

### External Plugins (13 total, partner integrations)

| Plugin | Description | Relevance |
|---|---|---|
| **context7** | Real-time library documentation lookup via MCP. Skill-based, loads only when needed. | HIGH |
| **playwright** | Browser automation and testing via MCP. | LOW |
| **github** | GitHub workflow integration. | MEDIUM |
| **gitlab** | GitLab integration. | N/A |
| **linear** | Issue tracking integration. | MEDIUM |
| **slack** | Slack messaging integration. | LOW |
| **firebase** | Firebase backend integration. | N/A |
| **supabase** | Supabase integration. | N/A |
| **stripe** | Payment processing integration. | N/A |
| **asana** | Project management integration. | N/A |
| **greptile** | Code search/understanding. | LOW |
| **laravel-boost** | Laravel PHP framework. | N/A |
| **serena** | Unknown/new. | N/A |

---

## 3. Community Plugins

### Superpowers (`obra/superpowers`) -- 42K+ stars

Source: [github.com/obra/superpowers](https://github.com/obra/superpowers)

The most popular community plugin, now accepted into the official Anthropic marketplace (January 2026). Created by Jesse Vincent. MIT license.

**Skills provided (14 total):**
- `test-driven-development` -- RED-GREEN-REFACTOR with anti-patterns
- `systematic-debugging` -- 4-phase root cause analysis
- `verification-before-completion` -- validates fixes are genuine
- `brainstorming` -- Socratic design refinement
- `writing-plans` -- detailed implementation plans
- `executing-plans` -- batch execution with human checkpoints
- `dispatching-parallel-agents` -- concurrent subagent workflows
- `requesting-code-review` / `receiving-code-review` -- review workflow
- `using-git-worktrees` -- isolated parallel branches
- `finishing-a-development-branch` -- merge/PR decisions
- `subagent-driven-development` -- two-stage review (spec + quality)
- `writing-skills` -- meta-skill for creating new skills
- `using-superpowers` -- introduction guide

**Key philosophy**: "Mandatory workflows, not suggestions." Skills activate automatically based on context. TDD skill will delete code written before tests.

**Related repos:**
- `obra/superpowers-marketplace` -- curated plugin marketplace
- `obra/superpowers-lab` -- experimental skills
- `obra/superpowers-chrome` -- Chrome DevTools control
- `obra/superpowers-developing-for-claude-code` -- development guide

### Everything Claude Code (`affaan-m/everything-claude-code`)

Source: [github.com/affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)

Described as "agent harness performance optimization system" from an Anthropic hackathon winner.

**Scope (massive):**
- 65+ skills across languages (TS, Python, Go, Java, C++, Swift), frameworks (Django, Spring Boot, Next.js, React), and domains (ClickHouse, article writing, investor materials)
- 12+ specialized agents (planner, architect, TDD guide, code reviewer, security reviewer, build error resolver, E2E runner, refactor cleaner, doc updater, language-specific reviewers)
- 40+ slash commands (`/plan`, `/tdd`, `/code-review`, `/verify`, `/learn`, `/multi-plan`, `/multi-execute`, `/orchestrate`, `/sessions`, `/pm2`)
- Hooks with runtime gating via `ECC_HOOK_PROFILE` (minimal|standard|strict) and `ECC_DISABLED_HOOKS`
- MCP configs for GitHub, Supabase, Vercel, Railway

**Concerns:**
- 65+ skills will blow past the ~42 skill visibility limit at default description lengths
- Many skills are domain-specific (ClickHouse, investor materials, article writing) and irrelevant for most projects
- Hooks run on every session start/stop (memory persistence), adding overhead
- Overlap with superpowers on TDD, planning, code review workflows

### Jamie-BitFlight Skills (`Jamie-BitFlight/claude_skills`)

Source: [github.com/Jamie-BitFlight/claude_skills](https://github.com/Jamie-BitFlight/claude_skills)

25 plugins (12 full-featured systems, 13 lightweight clip-ins).

**holistic-linting plugin**: Automatic quality enforcement with root-cause analysis. Discovers project linters (ruff, ty, bandit, eslint), runs them before completing tasks, resolves issues through systematic analysis rather than suppression comments. Focused on **Python** tooling (ruff, ty, bandit) -- less relevant for TypeScript where ESLint/tsc handle this natively.

**Other notable plugins:**
- Python 3.11+, Bash 5.1+, Perl 5.30+ development with TDD workflows
- GitLab CI/CD automation
- LLM integration patterns
- MCP server creation
- claude-plugins-reference-2026 -- plugin development reference

### Constellos (`constellos/claude-code-plugins`)

Source: [github.com/constellos/claude-code-plugins](https://github.com/constellos/claude-code-plugins)

TypeScript types and typed hooks for Claude Code. Three production-ready plugins:
- **github-orchestration** -- branch context and commit enhancement
- **nextjs-supabase-ai-sdk-dev** -- development quality enforcement
- **project-context** -- context discovery and documentation management

Also includes `claude-worktree.sh` for isolated git worktrees per session.

### Other Notable Community Repos

- **`hesreallyhim/awesome-claude-code`** -- curated list of skills, hooks, commands, agents, plugins
- **`ComposioHQ/awesome-claude-plugins`** -- curated list with 500+ SaaS integrations
- **`quemsah/awesome-claude-plugins`** -- automated adoption metrics across 7,413 repos
- **`sickn33/antigravity-awesome-skills`** -- 1000+ agentic skills collection
- **`travisvn/awesome-claude-skills`** -- curated skills list
- **`alexgreensh/token-optimizer`** -- audits context window overhead
- **`Piebald-AI/claude-code-lsps`** -- alternative LSP plugin marketplace

---

## 4. Plugin Overlap & Conflict Analysis

### Superpowers vs. Everything Claude Code

| Capability | Superpowers | Everything Claude Code |
|---|---|---|
| TDD workflow | `test-driven-development` | `/tdd` command + TDD agent |
| Planning | `writing-plans`, `executing-plans` | `/plan`, `/multi-plan` |
| Code review | `requesting-code-review`, `receiving-code-review` | `/code-review` + code-reviewer agent |
| Debugging | `systematic-debugging` | build-error-resolver agent |
| Subagents | `dispatching-parallel-agents`, `subagent-driven-development` | `/multi-execute`, `/orchestrate` |
| Git worktrees | `using-git-worktrees` | Not present |
| Verification | `verification-before-completion` | `/verify` command |
| Skill creation | `writing-skills` | Not present |
| Language-specific | None | Go, Python, Java, C++ reviews |
| Domain-specific | None | ClickHouse, content engine, investor materials |
| Hooks | None | SessionStart/Stop memory, PostToolUse automation |

**Verdict**: Massive overlap on core development workflows. Having both installed means:
1. **Skill budget collision**: Combined 14 + 65+ skills = ~79 skills, far exceeding the ~42 visible skill limit. Many skills will be invisible to Claude.
2. **Conflicting instructions**: Both define TDD workflows but with different processes. Superpowers enforces "delete code written before tests"; ECC may not.
3. **Decision confusion**: When Claude sees two planning skills, two TDD skills, and two review skills, it must choose -- adding latency and potential for wrong selection.
4. **Token waste**: Duplicate capability descriptions consume the character budget twice.

### Superpowers vs. Official Plugins

| Official Plugin | Superpowers Overlap |
|---|---|
| `feature-dev` | Partial -- feature-dev adds code-explorer/architect agents not in superpowers |
| `code-review` | Partial -- official uses 5-agent parallel review with confidence scoring; superpowers uses checklist-based review |
| `commit-commands` | None -- different scope |
| `pr-review-toolkit` | Partial -- both review code, but toolkit has specialized agents |

**Verdict**: Superpowers and official plugins have **complementary** overlap. Official plugins add specialized agents (confidence-scored review, PR-specific analysis) that superpowers doesn't provide. They can coexist.

---

## 5. Performance Impact & Token Economics

### Fixed Overhead (Per Session)

| Component | Tokens | % of 200K Window |
|---|---|---|
| System prompt | ~3,000 | 1.5% |
| Built-in tool definitions | 12,000-17,000 | 6-8.5% |
| CLAUDE.md + rules | ~3,900 | 2% |
| Autocompact buffer | 30,000-35,000 | 15-17.5% |
| **Total fixed overhead** | **~50,000-59,000** | **25-30%** |

### Plugin-Specific Overhead

| Component | Tokens | Notes |
|---|---|---|
| Skill metadata (per skill) | ~100 | Name + description in available_skills |
| Skill full load (on invoke) | 500-5,000 | SKILL.md content injected into conversation |
| MCP tool definition (per tool) | ~100 | Added to tools array |
| MCP tool (deferred) | ~15 | Tool Search reduces by 85% |
| Hook (per execution) | 0 | Hooks run externally, no token cost |
| Agent spawn overhead | 5,000-15,000 | Context bootstrapping per subagent |
| Agent tool verification | 2,000-8,000 | Tool access verification per subagent |

### Plugin Count Impact

With 6 plugins currently installed (assuming ~10 skills each = ~60 skills):
- Skill metadata: ~60 x 100 = **6,000 tokens** (but only ~42 visible)
- MCP tools (Context7): ~500 tokens for tool definitions
- Hooks (holistic-linting, ECC): ~0 tokens (hooks run externally)

**Risk threshold**: More than ~42 skills at average description length causes invisible skills. More than 5 MCP servers adds hundreds of tokens per turn even when idle.

### Subagent Cost Explosion

Each subagent spawns with its own 200K context window and loads:
- Full system prompt + tool definitions: ~15,000-50,000 tokens
- All enabled skill metadata: another 6,000+ tokens
- CLAUDE.md and rules: another 3,900 tokens

A plugin like `code-review` (5 parallel agents) can consume 250K-350K tokens per invocation. The `ralph-loop` plugin, running autonomously, can exhaust a $20/month plan quota in a single session.

### Prompt Caching

Anthropic implements prompt caching that reduces costs for repeated content (system prompts, tool definitions). This means the per-turn cost of having plugins installed is lower than naive token counting suggests -- the first turn pays full price, subsequent turns benefit from cache hits.

Sources:
- [Manage costs effectively](https://code.claude.com/docs/en/costs)
- [Subagent cost explosion](https://www.aicosts.ai/blog/claude-code-subagent-cost-explosion-887k-tokens-minute-crisis)
- [50K tokens per subagent](https://dev.to/jungjaehoon/why-claude-code-subagents-waste-50k-tokens-per-turn-and-how-to-fix-it-41ma)
- [Skill budget research](https://gist.github.com/alexey-pelykh/faa3c304f731d6a962efc5fa2a43abe1)

---

## 6. TypeScript-Specific Plugins

### typescript-lsp (Official)

**What it does**: Runs TypeScript language server (tsserver/vtsls) in the background, providing go-to-definition, find-references, and real-time type error detection after every edit.

**Performance benefit**: Semantic search in 50ms vs. 45 seconds for text-based grep (900x improvement).

**Current status (March 2026): BUGGY**
- [Issue #15235](https://github.com/anthropics/claude-code/issues/15235): Plugin from official marketplace is incomplete (missing plugin.json)
- [Issue #16291](https://github.com/anthropics/claude-code/issues/16291): Plugin not registering with LSP tool system
- [Issue #14803](https://github.com/anthropics/claude-code/issues/14803): "No LSP server available" despite correct configuration

**Alternative**: `Piebald-AI/claude-code-lsps` marketplace provides `vtsls` as an alternative TypeScript LSP that reportedly works better. Install with `/plugin install vtsls@claude-code-lsps`.

**Our assessment**: Worth trying the alternative `vtsls` from claude-code-lsps. If it works, the semantic code navigation and type checking would significantly improve autonomous development quality. If buggy, the `make -f dev.mk check` (build + lint + test) PostToolUse hook approach we already use provides equivalent safety net.

### Other TypeScript-Relevant Plugins

- **context7**: Fetches current TypeScript/Node.js library documentation. Useful for Agent SDK, Zod, Commander, etc. Already installed.
- **holistic-linting**: Primarily Python-focused (ruff, ty, bandit). For TypeScript, ESLint + tsc in our Makefile already covers this. **May not add value for our TS project.**
- **constellos/claude-code-plugins**: TypeScript types for hooks -- useful if writing custom typed hooks.

---

## 7. Community Recommendations

### What Developers Actually Recommend (2026)

Source: Blog posts, Reddit, Threads, dev.to, HN

**Tier 1 -- Near-universal recommendation:**
1. **Superpowers** -- "The essential plugin." Enforces discipline. 42K+ stars.
2. **Context7** -- Stops API hallucination. Real docs injected on demand.

**Tier 2 -- Frequently recommended:**
3. **Code Review** (official) -- Multi-agent PR review with confidence scoring.
4. **Commit-Commands** -- Simple but useful shortcuts.
5. **Feature-Dev** -- Good for structured feature implementation.

**Tier 3 -- Situational:**
6. **Ralph Loop** -- For long autonomous sessions. Warning: burns tokens fast.
7. **Linear** -- If using Linear for issue tracking.
8. **Playwright** -- If doing browser testing. Token-heavy.
9. **TypeScript LSP** -- If it works (buggy as of March 2026).
10. **Security Guidance** -- Good safety net for production code.

**Widely cautioned against:**
- Installing 10+ plugins ("plugin fatigue")
- Running multiple MCP servers simultaneously
- Everything-Claude-Code's 65+ skills (bloat, visibility limits)
- Ralph Loop on limited quota plans

### Key Quotes

> "Start with 3-5 plugins that match your daily workflow and add more only when you've confirmed existing ones deliver value." -- Multiple Reddit/dev.to sources

> "Each MCP server and agent consumes context tokens, and installing ten MCP-heavy plugins can noticeably shrink Claude's effective working memory." -- Community consensus

> "A simple policy is to keep always-on only the tools you use every session, with everything else disabled by default." -- Token optimization guide

### Blog Post: "Best Way to Do Agentic Development in 2026"

Source: [dev.to/chand1012](https://dev.to/chand1012/the-best-way-to-do-agentic-development-in-2026-14mn)

Recommended stack: Superpowers + Context7 + Tavily + Playwright + Frontend-Design + Feature-Dev + Commit-Commands. Emphasized planning-first approach and using `/research` command before complex features.

---

## 8. Security Considerations

### Known Vulnerabilities

- **CVE-2026-21852** (CVSS 5.3): Information disclosure in project-load flow allowing API key exfiltration from malicious repos.
- **CVE-2025-59536** (CVSS 8.7): Code injection via hooks allowing arbitrary shell commands on tool initialization in untrusted directories.
- **Prompt injection via skills**: Research paper (arxiv 2601.17548) provides first detailed analysis of skill-based prompt injection vulnerabilities.

### Plugin Trust Model

- Official Anthropic plugins: vetted, but still had RCE bugs in Chrome/iMessage/Notes MCP extensions
- Community plugins: **no vetting process**. The `everything-claude-code` repo includes hooks that run on every SessionStart/Stop -- these execute shell commands
- Skills can modify tool permissions and override model selection

### Mitigations

- Use `settingSources: []` for session isolation (already in our setup)
- Review hook code before installing community plugins
- Prefer official marketplace plugins over raw GitHub installs
- Don't clone untrusted repos while Claude Code is running

---

## 9. Recommendations for Our Setup

### Current Setup Assessment

| Plugin | Verdict | Reasoning |
|---|---|---|
| `superpowers` | **KEEP** | Core development methodology. TDD, planning, debugging, subagents. |
| `everything-claude-code` | **REMOVE** | Massive overlap with superpowers. 65+ skills exceed visibility limit. Domain-specific bloat (ClickHouse, investor materials). Hooks add overhead. |
| `commit-commands` | **KEEP** | Lightweight, no overlap, useful shortcuts. |
| `feature-dev` | **KEEP** | Complements superpowers with code-explorer/architect agents. |
| `context7` | **KEEP** | Essential for accurate library docs. Loads only when needed. |
| `holistic-linting` | **REMOVE** | Python-focused (ruff, ty, bandit). Our TS project uses ESLint + tsc via Makefile. No added value. |

### Recommended Additions

| Plugin | Rationale | Priority |
|---|---|---|
| `code-review` (official) | Multi-agent PR review with confidence scoring. Complements superpowers' checklist review. | HIGH |
| `typescript-lsp` or `vtsls` | Semantic code navigation + real-time type checking. Try `vtsls@claude-code-lsps` first. | HIGH (if working) |
| `security-guidance` | Lightweight PreToolUse hook catching 9 security patterns. Low overhead, high value. | MEDIUM |

### Recommended Final Plugin Set

```
1. superpowers@claude-plugins-official          -- core methodology
2. commit-commands@claude-plugins-official       -- git shortcuts
3. feature-dev@claude-plugins-official           -- guided feature dev
4. context7@claude-plugins-official              -- library docs
5. code-review@claude-plugins-official           -- multi-agent PR review
6. vtsls@claude-code-lsps                        -- TypeScript LSP (test first)
7. security-guidance@claude-plugins-official      -- security pattern detection
```

This gives us 7 plugins with approximately 20-25 skills total, well within the ~42 skill visibility limit, with no significant overlap.

### What NOT to Install

- **everything-claude-code**: Token bloat, skill visibility overflow, domain-irrelevant skills
- **holistic-linting**: Python-focused, redundant with our ESLint/tsc setup
- **ralph-loop**: We use structured planning, not autonomous loops. High token burn risk.
- **playwright**: Not doing browser testing in this project
- **10+ plugins**: Community consensus is clear -- more plugins = worse performance

### Token Budget Estimate (Final Set)

| Component | Estimated Tokens |
|---|---|
| System prompt + tools | ~15,000 |
| CLAUDE.md + rules | ~4,000 |
| Autocompact buffer | ~32,000 |
| Skill metadata (25 skills x 100) | ~2,500 |
| MCP tools (Context7 + LSP) | ~1,000 |
| **Total overhead** | **~54,500 (27% of 200K)** |
| **Available for work** | **~145,500 (73% of 200K)** |

This is a healthy ratio. Adding everything-claude-code would push skill metadata alone to 6,500+ tokens and make many skills invisible.

---

## Sources

### Official Documentation
- [Claude Code Plugins README](https://github.com/anthropics/claude-code/blob/main/plugins/README.md)
- [Official Plugin Marketplace](https://github.com/anthropics/claude-plugins-official)
- [Extend Claude with Skills](https://code.claude.com/docs/en/skills)
- [Create Plugins](https://code.claude.com/docs/en/plugins)
- [Discover Plugins](https://code.claude.com/docs/en/discover-plugins)
- [Manage Costs](https://code.claude.com/docs/en/costs)

### Plugin Repositories
- [Superpowers](https://github.com/obra/superpowers) -- 42K+ stars
- [Everything Claude Code](https://github.com/affaan-m/everything-claude-code)
- [Jamie-BitFlight Skills](https://github.com/Jamie-BitFlight/claude_skills)
- [Constellos Plugins](https://github.com/constellos/claude-code-plugins)
- [Piebald-AI LSPs](https://github.com/Piebald-AI/claude-code-lsps)
- [Token Optimizer](https://github.com/alexgreensh/token-optimizer)

### Technical Deep Dives
- [Claude Agent Skills: A First Principles Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/)
- [Skill Budget Research](https://gist.github.com/alexey-pelykh/faa3c304f731d6a962efc5fa2a43abe1)
- [Subagent 50K Token Problem](https://dev.to/jungjaehoon/why-claude-code-subagents-waste-50k-tokens-per-turn-and-how-to-fix-it-41ma)
- [Subagent Cost Explosion](https://www.aicosts.ai/blog/claude-code-subagent-cost-explosion-887k-tokens-minute-crisis)

### Reviews & Recommendations
- [Top 10 Claude Code Plugins (Firecrawl)](https://www.firecrawl.dev/blog/best-claude-code-plugins)
- [Top 10 Claude Code Plugins (Composio)](https://composio.dev/blog/top-claude-code-plugins)
- [Best Way to Do Agentic Development 2026](https://dev.to/chand1012/the-best-way-to-do-agentic-development-in-2026-14mn)
- [Superpowers Explained (Dev Genius)](https://blog.devgenius.io/superpowers-explained-the-claude-plugin-that-enforces-tdd-subagents-and-planning-c7fe698c3b82)
- [Plugin Adoption Metrics](https://github.com/quemsah/awesome-claude-plugins)
- [Claude Code Plugins Review (AI Tool Analysis)](https://aitoolanalysis.com/claude-code-plugins/)

### Security
- [Claude Code Flaws (Hacker News)](https://thehackernews.com/2026/02/claude-code-flaws-allow-remote-code.html)
- [RCE via Project Files (Check Point)](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)
- [Prompt Injection in Skills (arXiv)](https://arxiv.org/html/2601.17548v1)
