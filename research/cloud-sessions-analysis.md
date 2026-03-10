# Deep Analysis: Improving Plan Generation with Multiple Claude Sessions

## Current Script Assessment

`generate-plans.sh` uses a **DIY best-of-N pattern**: 3 parallel `claude -p`
sessions with prompt variation, writing to files, followed by a manual merge.

### What the script does well

1. **Prompt variation** — 3 genuinely different angles (baseline, simplicity,
   framework-depth) is research-backed (Doshi et al. 2024)
2. **Staggered launches** — 5s delay reduces rate limit contention
3. **Research-grounded N=3** — correct per Self-MoA and Best-of-N literature
4. **Opus model choice** — quality > speed for plan generation

### Problems identified

| # | Issue | Impact | Severity |
|---|-------|--------|----------|
| 1 | `--output-format text` | The original comment said text "avoids stdout truncation bug". Investigation shows the known truncation bugs ([#2904](https://github.com/anthropics/claude-code/issues/2904), [#3359](https://github.com/anthropics/claude-code/issues/3359)) affect the **SDK readline JSON parser** at fixed cut-offs (4K/8K/16K chars), NOT cli stdout piped to a file. All three formats (text/json/stream-json) produce identical output when using `claude -p > file`. **`text` is correct** — simplest, no extraction step, no `jq` dependency. | Low (was misdiagnosed) |
| 2 | No timeout/watchdog | A hung session runs forever. Opus at ~$0.50-1.00/turn with no upper bound. | High |
| 3 | No `--allowedTools` | Sessions have unrestricted tool access. In `-p` mode tools auto-execute, but a session could do unexpected things (git operations, file writes outside output). | Medium |
| 4 | No progress monitoring | You're blind for 15-25 minutes per session. No way to see if a session is stuck. | Low |
| 5 | Manual merge step | The merge command is printed as a hint, not automated. Human must copy-paste it. | Low |
| 6 | All sessions local | Shares local CPU, memory, and org-level rate limits aggressively. Three parallel Opus sessions = 3x RPM/TPM pressure. | Medium |
| 7 | No retry on failure | If a session fails, no automatic retry. | Low |
| 8 | No output validation | Doesn't check if output is actually a plan vs. error message or truncated output. | Medium |

---

## Three Available Approaches (2026 Landscape)

### Approach A: Cloud Sessions (`--remote` / `& prefix`)

**How it works**: `claude --remote "prompt"` creates a cloud session on
claude.ai that runs in an isolated VM. Each session clones the repo, sets up
the environment, and executes autonomously.

**For plan generation**:
```bash
# Launch 3 cloud sessions
claude --remote "Generate implementation plan (baseline)..."
claude --remote "Generate implementation plan (simplicity focus)..."
claude --remote "Generate implementation plan (framework focus)..."

# Monitor from terminal
# /tasks shows all running cloud sessions

# When done, teleport results back
claude --teleport <session-id>
```

**Pros**:
- True isolation (each session in its own VM)
- No local resource consumption
- Can monitor from phone via Claude iOS app
- Sessions survive laptop sleep/close
- Built-in PR creation for results

**Cons**:
- Requires GitHub-hosted repo (repo must be pushed to GitHub)
- Network latency for setup (repo clone per session)
- Limited network access by default (may affect tool research)
- "Research preview" — not fully stable
- Session handoff is one-way (can't push terminal→web, only `&` creates NEW session)
- Shares rate limits with all Claude usage on your account
- Output retrieval is less scriptable — results live in cloud sessions,
  not local files. Must teleport or create PR to get output.
- No `--output-format json` equivalent — harder to parse results programmatically

**Verdict**: Strong option if the repo is on GitHub. Best for hands-off
execution (launch, close laptop, review later). The trade-off vs local
`claude -p` is scriptability: cloud sessions are better for interactive
workflows, local `claude -p` is better for automated pipelines with
structured output capture.

### Approach B: Agent Teams (experimental)

**How it works**: One session acts as team lead, spawning teammate sessions
that work in parallel with shared task lists and inter-agent messaging.

**For plan generation** (the "competing hypotheses" pattern from docs):
```
Create an agent team to generate 3 implementation plans from different angles:
- Teammate A: Baseline plan following all constraints as-is
- Teammate B: Simplicity-focused — smallest possible MVP
- Teammate C: Framework-depth — detailed mcp-agent patterns and code
Have them each create a plan, then compare and merge the best elements.
```

**Pros**:
- Teammates can debate and critique each other's plans
- Shared task list coordinates work automatically
- Team lead can synthesize findings
- Built-in plan approval workflow
- Delegate mode prevents lead from doing implementation itself
- File-locked task claiming prevents race conditions

**Cons**:
- Experimental, disabled by default
- No session resumption with in-process teammates
- "Significantly higher token cost" (each teammate = separate Opus context)
- Task status can lag
- Shutdown can be slow
- Teammates don't inherit lead's conversation history
- Coordination overhead may exceed benefit for a "generate 3 independent plans" task
- Two teammates editing same file → overwrites (not a concern for plan files)

**Verdict**: Viable but overkill. Agent teams shine when agents need to
**interact** (debate, critique, build on each other). For independent plan
generation where diversity comes from prompt variation, the coordination
overhead adds cost without proportional benefit. The merge step IS a good
use case though.

### Approach C: Improved Local `claude -p` (pragmatic)

**How it works**: Same basic pattern as current script, but with fixes for
all identified problems plus automation of the merge step.

**Pros**:
- Works with any repo (Dropbox, local, GitHub)
- No experimental features required
- Full control over execution
- Easy to debug and iterate
- Cheapest option (no coordination overhead)

**Cons**:
- Local CPU/memory consumption
- Rate limit pressure from parallel sessions
- No inter-session communication

**Verdict**: Best fit for your current setup. Fix the bugs, automate the merge.

---

## Recommended Approaches

### Option 1: Cloud Sessions (best for hands-off, async work)

Use this when you want to launch plans, close your laptop, and review later.

```bash
# From an interactive Claude Code session:
& Generate an implementation plan for the HyperFlow Conductor. [baseline prompt]
& Generate an implementation plan for the HyperFlow Conductor. [simplicity prompt]
& Generate an implementation plan for the HyperFlow Conductor. [framework-depth prompt]

# Monitor progress
/tasks

# When done, teleport each session back and extract the plan
claude --teleport <session-id-1>
claude --teleport <session-id-2>
claude --teleport <session-id-3>
```

Or from the CLI directly:
```bash
claude --remote "$BASE_PROMPT"
claude --remote "$BASE_PROMPT $SIMPLICITY_VARIANT"
claude --remote "$BASE_PROMPT $FRAMEWORK_VARIANT"
```

**Pros**: True VM isolation, survives laptop sleep, phone monitoring, no local CPU.
**Cons**: Less scriptable output capture, must teleport each session manually,
harder to automate the merge step.

**Best for**: Kicking off plans before leaving your desk, reviewing next day.

### Option 2: Improved Local Script (best for automated pipeline)

Use this when you want a single `./generate-plans.sh` command that produces
a merged plan file with no manual intervention.

Key improvements over the original:
1. **`--output-format json`** — Reliable output capture, detects truncation
2. **Timeout via `timeout` command** — Hard kill after configurable timeout
3. **Output validation** — Check JSON structure, minimum output size
4. **Automated Phase 2 merge** — Opus compares and synthesizes the best of each
5. **Timestamped run directories** — Runs don't overwrite each other
6. **Configurable via env vars** — `MODEL=sonnet ./generate-plans.sh`

**Pros**: Fully automated, scriptable, structured output, easy to iterate.
**Cons**: Local CPU/memory, rate limit pressure from parallel sessions.

**Best for**: Repeatable pipeline, CI integration, iterating on prompt variants.

### Option 3: Hybrid — Cloud Generate + Agent Teams Merge

Use cloud sessions for generation (hands-off), then agent teams for a
high-quality adversarial merge (interactive).

1. Launch 3 cloud sessions with `--remote` or `&`
2. When done, teleport results back
3. Start an interactive session with agent teams enabled
4. Use the "competing advocates" pattern for the merge

**Best for**: Maximum quality when you have time to supervise the merge.

### Phase 3 (all options): Validate (human review)

The merged plan is written to a file. Human reviews and can iterate with
a fresh Claude session.

---

## Alternative: Hybrid with Agent Teams for Merge Step

If you want the merge to be higher quality, use agent teams fovr ONLY the
merge step (not generation):

1. **Generate**: 3 parallel `claude -p` sessions (improved script)
2. **Merge**: Start an interactive session, enable agent teams, and:
   ```
   Create an agent team to evaluate these 3 plans:
   - Teammate A: Advocate for Plan 1 (baseline)
   - Teammate B: Advocate for Plan 2 (simplicity)
   - Teammate C: Advocate for Plan 3 (framework-depth)
   - Lead: Synthesize a merged plan taking the best of each

   Have advocates debate the merits of their plan vs others.
   Lead produces the final merged plan.
   ```

This gets the benefit of agent team debate for the hardest part (merging)
without the overhead during generation (where prompt variation is sufficient).

---

## Implementation Changes for the Script

### Critical fixes

```bash
# 1. Use text output format — simplest and reliable for cli stdout > file
#    Known truncation bugs (#2904, #3359) affect the SDK readline JSON
#    parser, NOT cli stdout piped to files. Tested on v2.1.39.
claude -p "$full_prompt" \
    --model opus \
    --output-format text \
    --max-turns 50 \
    > "$outfile" \
    2> "$logfile" &

# 2. Add timeout (40 min max per session)
timeout 2400 claude -p "$full_prompt" ...

# 3. Validate output
min_size=5000  # A real plan should be >5KB
actual_size=$(wc -c < "$outfile" | tr -d ' ')
if [ "$actual_size" -lt "$min_size" ]; then
    echo "⚠ Output too small ($actual_size bytes), likely truncated or failed"
fi
```

> **Note on `--output-format json`**: If you need cost/session metadata, use
> `json` format. But beware: the output is a JSON **array** (not object).
> Extract with `jq -r '.[-1].result'`, not `jq -r '.result'`. The array
> structure is: `[init_message, ...tool_messages, result_message]`.

### Automated merge step

```bash
# After all 3 plans complete, auto-merge
MERGE_PROMPT="Read these 3 implementation plans and produce:
1. A comparison table for each dimension (staging, MVP, testing, etc.)
2. Winner per dimension with justification
3. A merged plan that takes the best of each

Plans:
$(for f in "$PLANS_DIR"/plan-*.md; do
    echo "=== $(basename $f) ==="
    cat "$f"
    echo ""
done)
"

claude -p "$MERGE_PROMPT" \
    --model opus \
    --output-format json \
    --max-turns 30 \
    | jq -r '.result' > "$PLANS_DIR/merged-plan.md"
```

### Progress monitoring

```bash
# Tail logs in background for progress visibility
for variant in "${!VARIANTS[@]}"; do
    (tail -f "$PLANS_DIR/plan-${variant}.log" 2>/dev/null |
     sed "s/^/[$variant] /" &)
done
```

---

## Cost Estimation

| Approach | Sessions | Est. Cost | Time | Scriptable? |
|----------|----------|-----------|------|-------------|
| Current script (3x Opus local) | 3 gen + 1 manual merge | ~$15-45 | 15-25 min | Partial |
| Improved local (3x Opus + auto merge) | 3 gen + 1 merge | ~$20-60 | 20-30 min | Yes |
| Cloud sessions + local merge | 3 cloud + 1 local merge | ~$20-60 | 20-35 min | Semi |
| Cloud + agent teams merge | 3 cloud + 4 team | ~$40-100 | 25-40 min | No |
| Full agent teams (skip gen, debate) | 1 lead + 3 teammates | ~$50-120 | 30-45 min | No |

**Choose based on workflow**:
- **Automated pipeline** → Improved local script (Option 2)
- **Hands-off async** → Cloud sessions (Option 1)
- **Maximum quality** → Hybrid cloud + agent teams (Option 3)

---

## When to Consider Agent Teams Instead

Switch to agent teams if:
- Plans from 3 sessions are too **similar** (need debate to differentiate)
- You want agents to **critique** each other (not just generate independently)
- The merge step produces **bland consensus** (need adversarial evaluation)
- You're building a more complex pipeline with **dependent tasks**

The "competing hypotheses" pattern from agent teams docs is exactly your merge
use case, but the generation step doesn't benefit from it.

---

## Key Sources

### Claude Code Official Documentation
- [Cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web)
- [Agent teams](https://code.claude.com/docs/en/agent-teams)
- [Best practices](https://code.claude.com/docs/en/best-practices)
- [Headless mode](https://code.claude.com/docs/en/headless.md)

### Community & Engineering
- [Building a C compiler with parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler) — 16 agents, 2000 sessions, $20K
- [Claude Code Agent Teams Setup Guide](https://www.marc0.dev/en/blog/claude-code-agent-teams-multiple-ai-agents-working-in-parallel-setup-guide-1770317684454)
- [Claude Code Swarms — Addy Osmani](https://addyosmani.com/blog/claude-code-agent-teams/)
- [Managing Parallel Sessions Without Worktrees — GitButler](https://blog.gitbutler.com/parallel-claude-code)
- [How to run Claude Code in parallel — Ona](https://ona.com/stories/parallelize-claude-code)
- [Multi-agent tmux workflow — GitHub gist](https://gist.github.com/andynu/13e362f7a5e69a9f083e7bca9f83f60a)

### Academic
- [Correlated Errors in LLMs](https://arxiv.org/abs/2506.07962) (2025)
- [Self-MoA — Li et al.](https://arxiv.org/abs/2502.00674) (2025, Princeton)
- [Mixture-of-Agents — Wang et al.](https://arxiv.org/abs/2406.04692) (2024)
- [Multi-Agent Debate — Triem & Ding](https://doi.org/10.1002/pra2.1034) (2024, ASIS&T)
