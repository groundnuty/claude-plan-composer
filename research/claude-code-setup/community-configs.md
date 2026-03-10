# Community Claude Code Configurations for TypeScript

**Date:** 2026-03-10
**Sources:** GitHub repos, awesome-claude-code, community blogs

## Trail of Bits (trailofbits/claude-code-config)

Most comprehensive public reference config. Security-focused.

### TypeScript tsconfig recommendations

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  }
}
```

### CLAUDE.md philosophy rules (prevent agent drift)

- "No speculative features" / "No premature abstraction"
- "Replace, don't deprecate" — remove old code entirely
- "Finish the job" — handle edge cases, don't invent new scope
- Hard limits: <=100 lines/function, cyclomatic complexity <=8
- 100-char line length, absolute imports only
- Pin exact versions (no `^` or `~`), enforce 24-hour publish delay

### Tooling choices

| Purpose | Tool |
|---------|------|
| Lint | oxlint (faster than ESLint) |
| Format | oxfmt (faster than Prettier) |
| Test | vitest |
| Types | tsc --noEmit |

### settings.json features

- `cleanupPeriodDays: 365`
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` env var
- Extensive deny list: rm -rf, sudo, git push --force, git reset --hard
- PreToolUse hooks blocking dangerous bash commands with regex matching
- Blocks reading: ~/.ssh, ~/.gnupg, ~/.aws, ~/.config/gh, ~/.git-credentials, ~/.docker/config.json, ~/.kube, ~/.npmrc, ~/Library/Keychains

## shinpr/ai-coding-project-boilerplate

Production-ready boilerplate with 20+ sub-agents. `npx create-ai-project` scaffolding.

### TypeScript Rules Skill

- Data flow: `unknown` → type guards → guaranteed types
- Functions over classes (unless framework requires)
- Max 2 parameters per function; use objects for 3+
- Dependency injection as parameters for testability
- Result type pattern for error possibilities
- Custom AppError classes: ValidationError, BusinessRuleError, DatabaseError, ExternalServiceError
- Mandatory global handlers for `unhandledRejection` and `uncaughtException`
- No commented-out code — delete it

### TypeScript Testing Skill

```
Coverage: 70%+ mandatory (Statements, Branches, Functions, Lines)
Directory: src/application/services/__tests__/service.test.ts
Naming: {target}.test.ts for unit, {target}.int.test.ts for integration
```

- Literal expected values in assertions (not replicated logic)
- Result-based verification (not invocation order)
- Mock only direct external I/O dependencies
- No test.skip() or commented-out tests — delete or fix
- Property-based testing with `fast-check` for invariants

### Workflow commands

`/implement`, `/task`, `/design`, `/plan`, `/build`, `/review`

## Matt-Dionis/claude-code-configs (Config Composer)

CLI that merges configs for your stack:

```bash
npx claude-config-composer nextjs-15 shadcn tailwindcss drizzle vercel-ai-sdk
```

Generates:
- 40+ specialized agents from combined configs
- 25+ custom commands
- Merged settings.json with unified permissions
- Automation hooks: auto type-check, format, lint after edits
- Protected files: .env, secrets, lockfiles blocked from edits

## Svenja-dev/claude-code-skills

### strict-typescript-mode Skill (7 rules)

1. No `any` without documentation — require justification or use `unknown` with type guards
2. Explicit types for public APIs — all exports need declared parameter and return types
3. Generic constraints — forbid unbounded `<T>`, require `<T extends object>`
4. Utility types — use `Omit`, `Partial`, `Pick` to avoid interface duplication
5. Readonly enforcement — `readonly` keyword and `ReadonlyArray`
6. Const assertions — `as const` for literal type narrowing
7. Discriminated unions — tagged unions over optional property patterns

### Hooks collection

| Hook | Trigger | Function |
|------|---------|----------|
| post-edit-tsc-check.ts | PostToolUse → Edit/Write | TS type checking with SHA256 cache |
| security-scan.ts | PreToolUse → Bash | Blocks dangerous git commands |
| pre-commit-quality.ts | PreToolUse → Bash | Secret scanning + TSC |
| post-tool-use-tracker.ts | PostToolUse → Edit | Tracks edited files |
| supervisor-trigger.ts | UserPromptSubmit | Activates QA mode |

## VoltAgent/awesome-claude-code-subagents

TypeScript Pro subagent covering:
- Advanced type patterns (conditional, mapped, template literals, branded)
- Development checklist: strict mode, no explicit `any`, >90% test coverage

## CLAUDE.md Length Best Practices

Multiple sources confirm: **60-80 lines max per project CLAUDE.md**. Claude's system prompt has ~50 instructions; each CLAUDE.md line competes in the ~150-200 instruction reliable-follow limit. Beyond ~200 lines, adherence degrades.

## import type Enforcement

### Via tsconfig (recommended)

```json
{
  "compilerOptions": {
    "verbatimModuleSyntax": true
  }
}
```

Forces `import type { ... }` syntax. TypeScript 5.0+ recommended approach (replaces `importsNotUsedAsValues`).

### Via bartolli hooks

Detects `as any` declarations with configurable severity per project type:
- React App: warning
- VS Code Extension: strict error
- Node.js TypeScript: warning

## Branded Types Pattern

Referenced across multiple sources as a CLAUDE.md/skill rule:

```typescript
type Brand<T, B> = T & { readonly __brand: B };
type UserId = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;
```

## Other Notable Projects

- `bartolli/claude-code-typescript-hooks` (169★) — quality check hooks with tsc + ESLint + Prettier + SHA256 caching
- `johnlindquist/claude-hooks` — TypeScript types for all hook payloads
- `constellos/claude-code-plugins` — full TS type definitions for all hook events
- `ruvnet/claude-flow` (14,200★) — orchestration platform with TS-specific CLAUDE.md templates
- `giuseppe-trisciuoglio/developer-kit` — 12+ TypeScript-specific agents
