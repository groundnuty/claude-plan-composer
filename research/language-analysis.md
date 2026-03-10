# Language Choice Analysis: bash vs alternatives (March 2026)

Should claude-plan-composer switch from bash to a different language? What language
does Claude Opus 4.6 generate best?

## Claude Opus 4.6 benchmark data (ai-coding-lang-bench, 2026)

Implementing simplified Git in 15 languages with Claude Code + Opus 4.6
(source: github.com/mame/ai-coding-lang-bench):

| Language | Time | Cost | Pass Rate | Variance |
|----------|------|------|-----------|----------|
| **Ruby** | 73s ±4s | $0.36 | 40/40 | Very low |
| **Python** | 75s ±5s | $0.38 | 40/40 | Very low |
| **JavaScript** | 81s ±5s | $0.39 | 40/40 | Low |
| Go | 102s ±37s | $0.50 | 40/40 | High |
| Rust | 114s ±55s | $0.54 | 38/40 | Very high |
| Java | 115s ±34s | $0.50 | 40/40 | High |
| Python/mypy | 125s ±19s | $0.57 | 40/40 | Medium |
| TypeScript | 133s ±29s | $0.62 | 40/40 | Medium |
| C | 156s ±41s | $0.74 | 40/40 | High |
| Haskell | 174s ±44s | $0.74 | 39/40 | High |

Key findings:
- **Python, Ruby, JavaScript** are fastest, cheapest, most reliable for Opus 4.6.
- **TypeScript is 1.6x slower/costlier than JavaScript** — type system overhead is
  real and measurable. Claude iterates more to satisfy type checker.
- **Static languages cost 1.3-2x more** than dynamic ones.
- Adding type checkers (mypy, Steep) to dynamic languages adds 1.6-3.2x overhead.
- Only Rust (2/40) and Haskell (1/40) had failures out of 600 total runs.

## Broader benchmark context (SWE-bench, Terminal-Bench)

| Benchmark | Opus 4.6 | Notes |
|-----------|----------|-------|
| SWE-bench Verified | 80.8% | Python-only; industry-leading |
| Terminal-Bench 2.0 | 65.4% | Shell/terminal tasks; industry-leading |
| ARC AGI 2 | 68.8% | Reasoning (not coding) |

SWE-bench Multilingual (C, C++, Go, Java, JS/TS, PHP, Ruby, Rust):
All LLMs perform significantly better on Python than other languages.
Rust had highest per-language resolution rate; C/C++ had lowest.

## Critical finding: harness > model

MorphLLM analysis (2026): the gap between top two coding models is **0.8 percentage
points**, while the gap between a good and bad agent scaffold is **22 percentage
points**. The pipeline architecture matters far more than language choice.

## Current codebase analysis

### What bash does well here

1. **CLI orchestration** — launching `claude -p`, managing parallel PIDs, `wait`
2. **Timeout management** — `timeout --foreground --verbose` wrapping
3. **File I/O** — reading prompts, writing plans, symlink management
4. **Zero compilation** — edit and run immediately
5. **Portability** — runs on any macOS/Linux without build step

### What bash does poorly here

1. **Config parsing** — YAML → bash variables requires Python (3 heredocs)
2. **JSON processing** — extracting from markdown, aggregation (5 heredocs)
3. **Statistics** — median, percentiles demand Python (1 heredoc)
4. **String safety** — quoting gotchas, `shlex.quote` workaround needed
5. **Data structures** — associative arrays require bash 4+, verbose syntax
6. **Testability** — Python code in heredocs is invisible to linters and untestable

### The hybrid reality

```
4,195 lines of bash
  ├── 65% orchestration glue (bash is genuinely good at this)
  ├── 30% data processing (all outsourced to 11 Python heredocs)
  └── 5% config/arg parsing

11 Python heredocs using: yaml, json, re, statistics, subprocess, shlex
78 references to Python standard library modules
```

PyYAML is already an undocumented runtime dependency.

## Language comparison for this project

| Language | Gains | Costs | Verdict |
|----------|-------|-------|---------|
| **Python** | Eliminates 11 heredocs, native YAML/JSON, asyncio for jobs, 30-40% smaller | Needs venv/uv, subprocess wrapping for `claude` CLI | **Best if full rewrite** |
| **TypeScript** | Claude Code itself is TS, good generation quality | Node.js dep, heavier for CLI glue | Good but heavier |
| **Go** | Single binary, goroutines, fast startup | Longer dev cycle, verbose for text processing | Great for distribution, overkill now |
| **Rust** | Max performance, type safety | Way overkill for orchestration glue | No |
| **Stay bash** | Zero rewrite cost | 11 untestable heredocs remain | **Pragmatic** |

## Recommendation: partial extraction, not full rewrite

**Extract Python heredocs into `lib/*.py` files.** Keep bash for orchestration.

### Why not full rewrite?

- 65% of code is orchestration glue — bash is genuinely best at this
- A Python rewrite means `subprocess.run("claude", ...)` everywhere — more verbose
- Rewrite risk is high for a working pipeline
- The benchmark data shows the *harness architecture* matters 27x more than language

### What extraction achieves

1. **Testable Python** — pytest + mypy instead of untestable heredocs
2. **Lintable** — ruff/mypy can check `lib/*.py`; shellcheck can't check Python in heredocs
3. **Debuggable** — stack traces instead of cryptic shell failures
4. **Explicit dependency** — PyYAML goes in `requirements.txt`
5. **Incremental** — extract one heredoc at a time, verify with `make check`
6. **Growth path** — if `lib/` grows large enough, bash wrappers become replaceable

### Proposed `lib/` structure

```
lib/
  common.sh              # existing: preflight checks, stream-json helpers
  config_parser.py       # YAML config → structured output (replaces 3 heredocs)
  eval_utils.py          # JSON extraction, Jaccard similarity, aggregation (replaces 5 heredocs)
  format_utils.py        # ANSI-aware column formatting (replaces 1 heredoc)
  stats.py               # median, percentile calculations (replaces 1 heredoc)
```

Each `.py` file is a CLI tool: `python3 lib/config_parser.py config.yaml` outputs
shell-eval-safe assignments. Bash scripts call them via command substitution.

## References

- ai-coding-lang-bench: github.com/mame/ai-coding-lang-bench
- SWE-bench Verified: swebench.com
- Terminal-Bench 2.0: arxiv.org/abs/2601.11868
- MorphLLM harness analysis: morphllm.com/best-ai-model-for-coding
- Aider polyglot leaderboard: aider.chat/docs/leaderboards/
- SWE-bench Multilingual: swebench.com/multilingual-leaderboard.html
