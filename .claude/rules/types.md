---
paths:
  - "src/types/**/*.ts"
---

# Type Definitions

- All interfaces use `readonly` properties (immutability)
- Use Zod schemas for runtime validation, infer TypeScript types with `z.infer<>`
- Error classes extend `CpcError` with a unique `code` string
- Config schemas use camelCase; YAML files use snake_case (transformed by `snakeToCamel()`)
- Use `import type` for type-only imports (enforced by `verbatimModuleSyntax`)
