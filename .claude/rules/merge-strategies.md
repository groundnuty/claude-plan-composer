---
paths:
  - "src/merge/**/*.ts"
---

# Merge Module

- All strategies implement the `MergeStrategy` interface from `strategy.ts`
- Strategies: `simple` (single session), `subagent-debate` (advocate agents), `agent-teams` (TeamCreate/SendMessage)
- Merge prompts use 3-phase structure: Analysis (conflict classification), Synthesis (minority insight scanning), Constitutional Review
- Eval-informed merging: if `EvalResult` provided, include per-dimension summary in prompt
