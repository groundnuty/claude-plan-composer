# claude-plan-composer — Development Makefile
#
# All tool invocations go through devbox to use project-pinned versions.
# Run `make help` to see all available targets.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# All shell scripts in the project root
SCRIPTS := $(wildcard *.sh)

# ─── Composite targets ──────────────────────────────────────────────────────

.PHONY: check
check: syntax lint fmt-check test ## Full verification loop: syntax + lint + format-check + test

.PHONY: fix
fix: fmt lint ## Auto-fix: format in-place, then lint

# ─── Individual targets ─────────────────────────────────────────────────────

.PHONY: syntax
syntax: ## Syntax-check all shell scripts
	@echo "── Syntax check ──"
	@for f in $(SCRIPTS); do \
		bash -n "$$f" && echo "  ✓ $$f" || { echo "  ✗ $$f"; exit 1; }; \
	done

.PHONY: lint
lint: ## ShellCheck all scripts
	@echo "── ShellCheck ──"
	devbox run -- shellcheck $(SCRIPTS)
	@echo "  ✓ All scripts pass shellcheck"

.PHONY: fmt
fmt: ## Format all scripts in-place with shfmt
	@echo "── shfmt (in-place) ──"
	devbox run -- shfmt -w -i 2 -ci -bn $(SCRIPTS)
	@echo "  ✓ Formatted"

.PHONY: fmt-check
fmt-check: ## Check formatting without modifying
	@echo "── shfmt (check) ──"
	devbox run -- shfmt -d -i 2 -ci -bn $(SCRIPTS)
	@echo "  ✓ All scripts properly formatted"

.PHONY: test
test: ## Run all bats tests
	@echo "── Bats tests ──"
	@if ls test/*.bats 1>/dev/null 2>&1; then \
		devbox run -- bats test/; \
	else \
		echo "  (no test files found — skipping)"; \
	fi

.PHONY: test-e2e
test-e2e: ## E2E pipeline test (requires Claude API, ~5 min)
	@echo "── E2E tests (real Claude API calls) ──"
	@if ! command -v claude >/dev/null 2>&1; then \
		echo "  ⚠ claude CLI not found — skipping e2e"; \
		exit 0; \
	fi
	devbox run -- bats test/e2e/

.PHONY: clean
clean: ## Remove generated artifacts
	@echo "── Clean ──"
	rm -rf generated-plans/
	@echo "  ✓ Cleaned"

.PHONY: help
help: ## List all targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
