# Understanding Turns in Claude Code

## What is a "turn"?

A turn = one API round-trip where Claude makes tool calls. Critically:

- **Parallel tool calls count as ONE turn.** If Claude reads 3 files simultaneously, that's 1 turn, not 3.
- Each turn sends the entire conversation context as input (growing with each turn).
- When `max-turns` is reached, Claude stops the agentic loop — it returns whatever it has so far.

## The Subagent Problem (Critical Finding)

**Subagent turns are NOT counted against the parent's `--max-turns`.**

When the parent spawns a Task subagent, that counts as 1 parent turn. But the subagent itself can execute dozens of tool calls in its own context. So `--max-turns 30` on the parent does **NOT** bound total work.

For a plan generation task where the prompt says "Use a team of agents to research in parallel," the likely breakdown is:

- Parent uses ~15-20 turns (spawn research agents + write plan)
- Each of 2-3 subagents uses ~10-20 turns internally
- **Effective total: ~50-80 tool calls**, despite `--max-turns 30`

## Is 30 the Right Number?

For a task involving reading ~12 files + web research + writing a long plan, the parent turn count breaks down as:

| Parent action | Turns |
|---|---|
| Read prompt, spawn 2-3 research subagents | 1 |
| Wait for subagents to complete | 1-3 |
| Read 5-7 source files itself (parallel batches) | 2-4 |
| Web searches | 2-5 |
| Write the plan (long output) | 1 |
| Revise/add sections | 2-5 |
| **Total** | **~10-20 parent turns** |

30 should be sufficient for the parent. But there's a risk: if the model is thorough (Opus!) it may read more files, do more research, and need more turns. Setting it too low risks an incomplete plan.

## What the Docs Say

From the [CLI reference](https://code.claude.com/docs/en/cli-reference):

> "Choose a value that gives Claude enough turns to complete typical tasks while preventing excessive usage."

- **Default:** If `--max-turns` is omitted in print mode, it appears to be unlimited — bounded only by context window (~200K tokens).
- **GitHub Actions default:** The `claude-code-action` examples use 10 for simple tasks.
- **Known bug** ([#3286](https://github.com/anthropics/claude-code/issues/3286)): `--max-turns` is sometimes ignored on resumed sessions.

## The Real Risk: Infinite Loops

Multiple GitHub issues document Claude Code entering infinite loops:

- [#6004](https://github.com/anthropics/claude-code/issues/6004): Infinite compaction loop, burning tokens
- [#7122](https://github.com/anthropics/claude-code/issues/7122): Infinite loop reading invalid files
- [#10570](https://github.com/anthropics/claude-code/issues/10570): Agent stuck after bash command

Without `--max-turns`, an infinite loop with Opus at ~$0.50-1.00/turn could cost $50-100+ before context fills.

## Recommendation

`--max-turns 30` is a reasonable compromise but not ideal. It provides enough headroom for thorough research while capping runaway costs from infinite loops.
