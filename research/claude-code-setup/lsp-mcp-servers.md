# TypeScript LSP MCP Servers for Claude Code

**Date:** 2026-03-10
**Sources:** GitHub repos, npm, official docs, community blogs

## Comparison Matrix

| Feature | Native LSP Plugin | @mizchi/lsmcp | cclsp | ProfessioneIT | isaacphi |
|---|---|---|---|---|---|
| Stars | built-in | 440 | - | - | - |
| Tool count | ~8 ops | 25+ | 6 | 24 | 6 |
| Go-to-def | Yes | Yes | Yes | Yes | Yes |
| Find refs | Yes | Yes | Yes | Yes | Yes |
| Rename | No | Yes | Yes | Yes | Yes |
| Diagnostics | Yes (push) | Yes | Yes | Yes (push cache) | Yes |
| External lib indexing | No | Yes | No | No | No |
| Project overview | No | Yes | No | No | No |
| Call hierarchy | Yes | No | No | Yes | No |
| Position error tolerance | N/A | No | Yes | No | No |
| tsgo/native TS | No | Yes | No | No | No |
| Setup complexity | Low | Medium | Low | High | Low |
| Runtime | Built-in | Node 22+ | Node/Bun | Node 18+ | Go binary |

## 1. Native LSP Plugin (Anthropic first-party)

Claude Code v2.0.74+ includes a built-in LSP tool.

### Installation

```bash
# Install language server binary
npm install -g typescript-language-server typescript

# Enable in ~/.claude/settings.json or .claude/settings.json
{
  "env": {
    "ENABLE_LSP_TOOL": "1"
  },
  "enabledPlugins": {
    "typescript-lsp@claude-plugins-official": true
  }
}
```

### Tools exposed

- `goToDefinition` — navigate to symbol definitions
- `findReferences` — find all usages
- `hover` — type information and documentation
- `documentSymbol` — list symbols in a file
- `workspaceSymbol` — search symbols across project
- `goToImplementation` — find interface implementations
- `incomingCalls` / `outgoingCalls` — call hierarchy
- `getDiagnostics` — real-time error/warning detection (pushed after every edit)

### Performance

A go-to-definition lookup costs ~15 tokens and ~50ms, vs grep returning ~2,100 tokens over 3-60 seconds. Saves 15,000-20,000 tokens (10-15% of context window) on multi-service debugging.

### Known issues

- `ENABLE_LSP_TOOL` env var is still required as of March 2026 (undocumented)
- Original Anthropic marketplace plugin had initialization race conditions (#16291), fixed Jan 2026
- Community marketplace `boostvolt/claude-code-lsps` is a more reliable alternative (covers 23 languages)
- v2.1.69 improved LSP tool rendering to no longer read entire files

### Alternative community plugin

```bash
# In Claude Code session:
/plugin marketplace add boostvolt/claude-code-lsps
# Install vtsls TypeScript plugin from Discover tab

# Prerequisite:
npm install -g @vtsls/language-server typescript
```

## 2. @mizchi/lsmcp (Most comprehensive)

440 stars, 558 commits, v0.10.0. Wraps any LSP server and exposes 25+ tools.

### Installation

```bash
npm add -D @mizchi/lsmcp @typescript/native-preview
npx @mizchi/lsmcp init -p tsgo

# Register with Claude Code:
claude mcp add lsmcp npx -- -y @mizchi/lsmcp -p tsgo
```

Requires Node.js 22+ (SQLite dependency).

### Tools (25+)

**Core LSP:** `lsp_get_hover`, `lsp_find_references`, `lsp_get_definitions`, `lsp_get_diagnostics`, `lsp_get_all_diagnostics`, `lsp_get_document_symbols`, `lsp_get_workspace_symbols`, `lsp_get_completion`, `lsp_get_signature_help`, `lsp_format_document`, `lsp_rename_symbol`, `lsp_get_code_actions`, `lsp_delete_symbol`, `lsp_check_capabilities`

**High-level:** `get_project_overview`, `search_symbols`, `get_symbol_details`

**External libs:** `index_external_libraries`, `get_typescript_dependencies`, `search_external_library_symbols`, `resolve_symbol`, `get_available_external_symbols`, `parse_imports`

**Code editing:** `replace_range`, `replace_regex`

**Memory:** `list_memories`, `read_memory`, `write_memory`, `delete_memory`

### Configuration (.lsmcp/config.json)

```json
{
  "$schema": "../node_modules/@mizchi/lsmcp/lsmcp.schema.json",
  "preset": "tsgo",
  "settings": {
    "autoIndex": true,
    "indexConcurrency": 10
  }
}
```

### Performance

Incremental indexing (modified files only), 15-minute intelligent caching, configurable concurrency, automatic GC at high memory.

## 3. cclsp (ktnyt/cclsp)

Solves the problem of LLMs providing inaccurate line/column numbers. Uses "intelligent position resolution" that tries multiple position combinations.

### Installation

```bash
npx cclsp@latest setup        # Interactive wizard
npx cclsp@latest setup --user # User-wide
```

### Tools (6)

`find_definition`, `find_references`, `rename_symbol`, `rename_symbol_strict`, `get_diagnostics`, `restart_server`

### Configuration (cclsp.json)

```json
{
  "servers": [
    {
      "extensions": ["ts", "tsx", "js", "jsx"],
      "command": ["typescript-language-server", "--stdio"],
      "rootDir": ".",
      "restartInterval": 5
    }
  ]
}
```

## 4. @juanpprieto/claude-lsp (Daemon-based)

Runs TS LSP + ESLint + Prettier + GraphQL as a background daemon. Hooks into Claude Code lifecycle.

### Installation

```bash
npm install -g @juanpprieto/claude-lsp
cd your-project && claude-intelligence-init
```

### Tools

`analyze_file`, `check_typescript`, `check_eslint`, `check_prettier`, `check_graphql`

**Key difference:** Diagnostics/linting focused, NOT navigation. Complements rather than replaces LSP navigation tools.

## 5. ProfessioneIT/lsp-mcp-server

Largest tool surface area (24 tools) including call hierarchy, type hierarchy, code actions, and composite "smart search."

### Installation

```bash
git clone https://github.com/ProfessioneIT/lsp-mcp-server
cd lsp-mcp-server && npm install && npm run build
```

Most feature-rich but highest setup complexity (clone + build from source).

## Recommendation for our project

**Native LSP plugin** is the pragmatic choice:
- Zero MCP overhead, built-in
- Push diagnostics after every edit
- ~15 tokens per go-to-def vs ~2,100 tokens for grep
- Anthropic's own approach (no MCP servers in their repos)
- Requires only `ENABLE_LSP_TOOL=1` env var + plugin install

**Upgrade to lsmcp** if we need:
- External library navigation into `@anthropic-ai/claude-agent-sdk` / `zod` types
- Project overview generation
- tsgo native compiler for faster type checking
