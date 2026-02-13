# claude-plan-composer

## The problem: LLM plans look good but have blind spots

Ask Claude to write an implementation plan and you'll get something impressive — well-structured, thorough-looking, and confident. Ship it to a developer and the cracks appear:

**Monoculture thinking.** The model gravitates toward the same patterns every time. Ask for a CLI? It picks Click. Config management? Pydantic-settings. Project structure? The same `src/` layout. These aren't wrong choices, but they crowd out alternatives that might fit your constraints better. You get one perspective presented as the only reasonable option.

**Under-specification of operational details.** Plans describe *what* to deploy but hand-wave *how*. "Deploy to Kubernetes" without the helm flags, resource quotas, node selectors, and PVC setup that make or break a real deployment. The gap between "deploy to K8s" and a working `helm install` command is where most projects stall.

**Over-engineering.** A single session tends to add abstractions "for flexibility" — plugin systems, configuration layers, factory patterns — that increase complexity without solving the immediate problem. With no adversarial pressure, every component survives the plan review.

**Training data bias.** The model's knowledge is shaped by what's popular on GitHub, not what's correct for your domain. Niche tools, internal APIs, and domain-specific deployment patterns get less attention than they deserve, while well-documented mainstream tools get over-represented.

These aren't bugs in the model. They're structural consequences of generating a plan from a single perspective. A human architect doesn't produce a plan in isolation either — they get feedback, defend trade-offs, and iterate against competing views.

## Demo

![demo](demo/demo.gif)

> Top pane: 4 parallel Claude sessions generating plan variants. Bottom pane: real-time monitor tracking progress. Then: interactive merge with Agent Teams debate, and the final merged plan.

## The approach: parallel sessions with prompt variation, then structured merge

This project forces multiple perspectives by running parallel Claude Code sessions, each with a **different prompt variant** that demands different trade-offs, then merging the best elements through structured comparison.

```
                          ┌─────────────────────┐
                          │   Your prompt file   │
                          │   (my-prompt.md)     │
                          └──────────┬──────────┘
                                     │
              ┌──────────────┬───────┼───────┬──────────────┐
              ▼              ▼       ▼       ▼              ▼
        ┌──────────┐  ┌──────────┐ ┌──────────┐  ┌──────────────┐
        │ baseline │  │simplicity│ │framework │  │   k8s-ops    │
        │(no extra │  │(minimal  │ │ (deep    │  │  (deploy     │
        │ guidance)│  │  MVP)    │ │ patterns)│  │   detail)    │
        └────┬─────┘  └────┬─────┘ └────┬─────┘  └──────┬───────┘
              │              │       │       │              │
              └──────────────┴───────┼───────┴──────────────┘
                                     ▼
                          ┌──────────────────────┐
                          │     Merge phase      │
                          │     (agent-team      │
                          │      debate or       │
                          │      automated)      │
                          └──────────┬───────────┘
                                     ▼
                          ┌──────────────────────┐
                          │    merged-plan.md    │
                          │    (human review)    │
                          └──────────────────────┘
```

**Phase 1 — Generate.** Four `claude -p` sessions run in parallel, each receiving the same base prompt plus a variant instruction that forces a specific lens:
- **Baseline**: No extra guidance — the model's default interpretation
- **Simplicity**: "Find the smallest possible MVP. Question whether each component is needed."
- **Framework depth**: "Show detailed code examples, exact imports, error handling patterns."
- **K8s operations**: "Replicate the exact deployment sequence with helm/kubectl commands and flags."

**Phase 2 — Merge.** A separate Claude session (or an Agent Teams debate with competing advocates) compares all plans dimension by dimension — staging strategy, MVP scope, testing approach, deployment detail, code architecture — and synthesizes a merged plan taking the best of each.

**Phase 3 — Review.** The merged plan is a file on disk. A human reads it, iterates, and adopts it.

The critical insight: **diversity comes from prompt variation, not from repetition.** Running the same prompt 10 times produces 10 similar plans with [correlated errors](https://arxiv.org/abs/2506.07962). Running 4 variants that force different trade-offs produces genuinely different perspectives.

## Why this works (grounded in research)

This isn't a heuristic — the approach is grounded in specific findings from LLM ensemble research:

**Same-model runs share blind spots.** [Correlated Errors in Large Language Models](https://arxiv.org/abs/2506.07962) (2025) found that models from the same architecture agree on 60% of their errors. Running the same prompt N times is like polling twins, not strangers. The "wisdom of crowds" only works when evaluators make independent errors — same-model LLM runs don't qualify.

**Diminishing returns from repetition, not from variation.** Best-of-N sampling follows a logarithmic curve: N=3-4 captures ~80% of the total possible gain, while N=8+ adds mostly noise. [Self-MoA (Li et al., 2025, Princeton)](https://arxiv.org/abs/2502.00674) showed that multiple runs of the single best model outperforms mixing different models by 6.6% on AlpacaEval — quality beats diversity from weaker sources. This justifies using 4 Opus sessions rather than mixing Opus + Sonnet + Haiku.

**Prompt variation manufactures the diversity the model can't produce on its own.** [Doshi et al. (2024)](https://doi.org/10.1002/smj.3677) found that "different prompts shift the model's attention to various aspects of the input, influencing the final output." Simplicity vs. framework-depth vs. operational-detail aren't cosmetic differences — they force the model into genuinely different trade-off spaces.

**There's a hard ceiling on same-prompt diversity.** [A PNAS study on structural diversity in LLM outputs](https://www.pnas.org/doi/10.1073/pnas.2504966122) found that LLM-generated text contains repetitive combinations of structural elements. After 3-4 runs of the same prompt, you've exhausted the space of meaningfully different structural choices.

**Merge complexity explodes beyond 4-6 plans.** Comparing 4 plans requires 6 pairwise comparisons (manageable for a human or LLM). 8 plans = 28 pairs. 10 plans = 45 pairs. The merge quality degrades as N increases, even if individual plans are good. 4 variants is the sweet spot: enough diversity, still mergeable.

**Parallel Claude at scale is proven.** Anthropic's own engineering team used [16 parallel Claude agents across 2000 sessions to build a C compiler](https://www.anthropic.com/engineering/building-c-compiler). The incident.io team documented [shipping faster with parallel Claude Code and git worktrees](https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees). This project applies the same principle to planning, not coding.

## What's in this repo

Three bash scripts and a research directory:

| File | Purpose |
|---|---|
| `generate-plans.sh` | Launches 4 parallel `claude -p` sessions with prompt variants. Each session researches the codebase and writes a plan via the Write tool. |
| `merge-plans.sh` | Merges generated plans. Default mode: interactive Agent Teams debate with competing advocates. Alternative: headless automated merge. |
| `monitor-sessions.sh` | Real-time dashboard for running sessions — tracks PIDs, token usage, context window, subagents, tool calls, and last action by parsing JSONL transcripts. |
| `research/` | Analysis documents that informed the design decisions (optimal N, turn counting, cloud vs. local trade-offs). |
| `AGENTS.md` | Detailed usage reference for working with this project in Claude Code. |

### Quick start

```bash
# 1. Write your prompt (or use the included test prompt)
cat test-prompt.md

# 2. Generate 4 plan variants (use --debug for a quick single-variant test)
./generate-plans.sh --debug test-prompt.md

# 3. Merge the results
MERGE_MODE=simple ./merge-plans.sh generated-plans/test-prompt/latest
```

Full generation with all 4 variants (Opus, ~15-25 min, ~$20-60):

```bash
./generate-plans.sh my-prompt.md
./monitor-sessions.sh --watch          # watch progress in another terminal
./merge-plans.sh generated-plans/my-prompt/latest   # interactive agent-team merge
```

See [AGENTS.md](AGENTS.md) for all options, environment variables, and output structure.

## Adapting to your own project

The domain-specific parts (HyperFlow, Kubernetes, 1000genome) live entirely in the prompt file — the scripts themselves are generic. To use this for your own project: write a markdown file describing what you need planned (architecture, constraints, existing codebase references), then run `./generate-plans.sh your-prompt.md`. The four variant prompts in `generate-plans.sh` (simplicity, framework-depth, k8s-ops) can be edited to match your domain — swap "k8s-ops" for "API design" or "database schema" or whatever dimension matters most to your project. The merge step works unchanged regardless of domain. The key requirement is that your prompt file gives Claude enough context to produce a substantive plan — point it at files to read, decisions to make, and trade-offs to consider.

## Limitations

- **This is a specific example, not a framework.** It's a working technique with bash scripts, not a polished library. Fork it, adapt it, throw away what you don't need.
- **Cost: ~$20-60 per run.** Four Opus sessions plus a merge session. Use `--debug` mode (single Sonnet session) to iterate on prompts cheaply before a full run.
- **Same-model correlation is inherent.** Prompt variation reduces but doesn't eliminate correlated blind spots. If Claude doesn't know about your internal API, four variants of Claude still won't know about it.
- **The merge step has its own biases.** The LLM doing the merge may favor familiar patterns when adjudicating between plans. The Agent Teams debate mode helps but doesn't fully solve this.
- **No automated quality scoring.** There's no programmatic way to evaluate whether the merged plan is "better." Quality assessment is a human judgment call.
- **Requires Claude Code CLI** with API access (Max plan or direct API key). Sessions share org-level rate limits.

## License

MIT
