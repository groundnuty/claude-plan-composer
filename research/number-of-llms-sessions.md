# Optimal Number of LLM Sessions for Plan Generation

## Why More Sessions Give Diminishing (or Worse) Results

### The Core Problem: Correlated Errors

The most important recent finding is from "Correlated Errors in Large Language Models" ([arXiv:2506.07962](https://arxiv.org/abs/2506.07962), June 2025):

> Models from the same provider/architecture agree on 60% of their errors. As model accuracy increases, models are also converging in the errors they make.

This is devastating for the "wisdom of crowds" assumption. The wisdom of crowds works when evaluators make independent errors that cancel out. But multiple runs of the same Claude model are **not independent** — they share:

- The same training data and weights
- The same architectural biases
- The same blind spots about your codebase
- The same tendency to reach for familiar patterns (e.g., always suggesting Click for CLI, always reaching for pydantic-settings)

Running 10 sessions of the same model is like polling 10 twins, not 10 strangers.

## The Six Specific Failure Modes

### 1. Logarithmic returns, linear costs

Research on Best-of-N sampling shows gains follow a log curve — each doubling of N yields progressively smaller improvements. The academic consensus:

| N sessions | Value captured |
|---|---|
| 1 | Baseline |
| 2-3 | Most of the diversity (~70-80% of total possible gain) |
| 4-6 | Remaining meaningful diversity |
| 8+ | Noise dominates signal |
| 16+ | Reward hacking / convergence artifacts |

But costs (API tokens, rate limits, human review time) scale linearly. At ~$5-15 per plan generation with Sonnet, 10 sessions costs $50-150 for marginal gains over 3-4 sessions.

### 2. Quality beats diversity (Self-MoA result)

Li et al. (2025, Princeton) found that Self-MoA (running the single best model multiple times) outperforms standard MoA (mixing different models) by 6.6% on AlpacaEval:

> "Mixing different LLMs often lowers the average quality. Diversity from lower-quality sources actively hurts aggregate performance."

For our case: running 4 Sonnet sessions + 4 Haiku sessions would be **worse** than running 4 Sonnet sessions alone. The Haiku plans would inject lower-quality ideas that pollute the merge.

### 3. No verifiable correctness criterion

Self-consistency (Wang et al. 2022) works brilliantly for math — sample 40 reasoning paths, majority-vote on the answer, get +17.9% accuracy on GSM8K. But plans have no discrete answer to vote on. You can't majority-vote on "should we use k3d or Kind?" — both are defensible. Without a ground truth, aggregation drifts toward bland consensus (picking the safest option in every dimension) rather than bold, coherent choices.

### 4. Merging cost explosion

Comparing 2 plans is a clear A-vs-B analysis. But:

- 4 plans = 6 pairwise comparisons
- 8 plans = 28 pairwise comparisons
- 10 plans = 45 pairwise comparisons

The human (or LLM) doing the merge quickly loses the ability to hold all plans in working memory. The merge quality degrades as N increases, even if individual plans are good.

### 5. Structural diversity ceiling

A PNAS paper found that LLM-generated outputs contain repetitive combinations of structural elements — there are hard limits to how different same-model outputs can be. For plan generation, this manifests as:

- All sessions will discover the same MCP tools (they read the same `mcp_server.py`)
- All sessions will propose similar project structures (src layout is "correct")
- All sessions will identify the same deployment steps (they read the same `fast-test.sh`)
- Diversity is limited to: staging strategy, testing tools, code organization details

After 3-4 runs, you've exhausted the space of meaningfully different structural choices.

### 6. Rate limit pressure degrades quality

Claude Code rate limits are per-organization, not per-session. Running 5 parallel sessions consumes RPM/TPM 5x faster. At Tier 2 (1,000 RPM), 5 sessions each making tool calls can hit limits within minutes, causing:

- Retries and backoffs that extend generation time
- Potential for incomplete research (agent hits limit mid-investigation)
- Error 429/529 responses that truncate the plan

## The Optimal Strategy (Based on Research)

**Sweet spot: 3-4 sessions with varied prompts**

The research converges on this because:

1. **Diversity comes from prompt variation, not from model variation.** Doshi et al. (2024) found that "different prompts shift the model's attention to various aspects of the input, influencing the final output." Using focus angles (simplicity, k8s-native, framework-patterns) is exactly right — it manufactures the diversity that the model can't produce on its own.
2. **Temperature doesn't help much for plans.** The literature says temperature 0.5-0.7 is the sweet spot for diversity, but Claude Code doesn't expose temperature control in `claude -p`. And for structured outputs (code, plans), higher temperature quickly produces incoherent results rather than creative alternatives.
3. **The merge step is the bottleneck.** The value isn't in generating N plans — it's in the quality of the comparison and merge. 3-4 plans is the maximum a human (or LLM) can effectively hold in working memory for a nuanced comparative analysis.

## Practical Recommendations

Based on all this research, the recommended approach:

- **Session 1:** Baseline (no extra guidance)
- **Session 2:** "Prioritize simplicity" (forces different trade-offs)
- **Session 3:** "Focus on mcp-agent patterns" (forces framework depth)

Drop session 4 unless the first 3 are too similar. Three is enough. For the merge step, use a single high-quality session (Opus) rather than trying to automate it.

## Parallel Sessions: Practical Issues

### Known bugs when running parallel Claude Code sessions

- [#22172](https://github.com/anthropics/claude-code/issues/22172): v2.1.23+ causes 100% CPU hang with multiple parallel instances when hooks are enabled
- [#13352](https://github.com/anthropics/claude-code/issues/13352): Concurrent sessions can block each other on macOS
- [#24631](https://github.com/anthropics/claude-code/issues/24631): Connection conflicts when multiple agents run locally via Anthropic API

**Practical fix:** Use `--output-format json` to avoid a known stdout truncation bug that can cut off long plan outputs at ~4-16K characters.

### Alternative: Agent Teams

Instead of DIY `claude -p` fan-out, Claude Code has Agent Teams (experimental):

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

This gives peer-to-peer coordination with shared task lists and file-locked task claiming — designed for parallel exploration.

## Key Sources

- [Correlated Errors in Large Language Models](https://arxiv.org/abs/2506.07962) (2025)
- [Self-MoA — Li et al.](https://arxiv.org/abs/2502.00674) (2025, Princeton)
- [Self-Consistency — Wang et al.](https://arxiv.org/abs/2203.11171) (2022, ICLR 2023)
- [Structural diversity in LLM outputs](https://www.pnas.org/doi/10.1073/pnas.2504966122) (PNAS)
- [ChatGPT for complex text evaluation tasks — Thelwall](https://doi.org/10.1002/asi.24966) (2024)
- [Generative AI and evaluating strategic decisions — Doshi et al.](https://doi.org/10.1002/smj.3677) (2024)
- [Building a C Compiler — Anthropic Engineering](https://www.anthropic.com/engineering/building-c-compiler)
- [Shipping faster with Claude Code and git worktrees — incident.io](https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees)
