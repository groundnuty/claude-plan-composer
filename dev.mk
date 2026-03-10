.PHONY: check test lint build clean

check: build lint test

build:
	npx tsc --noEmit

lint:
	npx eslint src/

test:
	npx vitest run

test-e2e:
	npx vitest run test/e2e/

clean:
	rm -rf dist coverage
