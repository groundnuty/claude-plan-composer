.PHONY: install check test lint build clean test-e2e eval eval-full eval-save eval-full-save eval-compare eval-full-compare

install:
	devbox run -- npm ci

check: install build lint test

build:
	devbox run -- npx tsc --noEmit

lint:
	devbox run -- npx eslint src/

test:
	devbox run -- npx vitest run

test-e2e:
	devbox run -- npx vitest run --config vitest.e2e.config.ts

clean:
	rm -rf dist coverage

eval:  ## Quick eval (haiku, cheap fixtures)
	EVAL_MODE=quick devbox run -- npx vitest run --config vitest.eval.config.ts

eval-full:  ## Serious eval (opus, full configs)
	EVAL_MODE=full devbox run -- npx vitest run --config vitest.eval.config.ts

eval-save:  ## Quick eval + save baseline (NAME=...)
	EVAL_MODE=quick EVAL_SAVE_BASELINE=$(NAME) devbox run -- npx vitest run --config vitest.eval.config.ts

eval-full-save:  ## Full eval + save baseline (NAME=...)
	EVAL_MODE=full EVAL_SAVE_BASELINE=$(NAME) devbox run -- npx vitest run --config vitest.eval.config.ts

eval-compare:  ## Quick eval + compare against baseline (NAME=...)
	EVAL_MODE=quick EVAL_COMPARE_BASELINE=$(NAME) devbox run -- npx vitest run --config vitest.eval.config.ts

eval-full-compare:  ## Full eval + compare against baseline (NAME=...)
	EVAL_MODE=full EVAL_COMPARE_BASELINE=$(NAME) devbox run -- npx vitest run --config vitest.eval.config.ts
