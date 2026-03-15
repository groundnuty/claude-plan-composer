# Contributing to Claude Plan Composer

Thank you for your interest in contributing!

## Development Setup

This project uses [devbox](https://www.jetify.com/devbox) for environment management. See [README.md](README.md) for quick start and [AGENTS.md](AGENTS.md) for detailed architecture and conventions.

```bash
make -f dev.mk check   # full CI: build + lint + test
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes following the conventions in AGENTS.md
3. Ensure `make -f dev.mk check` passes
4. Submit a PR with a clear description

## Commit Messages

Use [conventional commits](https://www.conventionalcommits.org/):

```
<type>: <description>

Types: feat, fix, refactor, docs, test, chore, perf, ci
```

## Code Style

- ESM-only with `.js` import extensions
- Zod v4 for schemas
- Immutable interfaces (`readonly`)
- `import type` for type-only imports
- Functions < 50 lines, files < 800 lines
