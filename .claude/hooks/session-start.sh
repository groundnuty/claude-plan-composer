#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install shellcheck, shfmt, and bats via apt
apt-get update -qq
apt-get install -y -qq shellcheck shfmt bats > /dev/null

# Initialize bats helper submodules (bats-support, bats-assert, bats-file)
cd "$CLAUDE_PROJECT_DIR"
git submodule update --init test/test_helper/bats-support test/test_helper/bats-assert test/test_helper/bats-file

# Create a devbox shim so `make` targets (which use `devbox run --`) work
# without installing devbox itself. The shim strips `devbox run --` and
# executes the remaining command directly.
cat > /usr/local/bin/devbox << 'SHIM'
#!/bin/bash
if [ "$1" = "run" ] && [ "$2" = "--" ]; then
  shift 2
  exec "$@"
fi
exec "$@"
SHIM
chmod +x /usr/local/bin/devbox
