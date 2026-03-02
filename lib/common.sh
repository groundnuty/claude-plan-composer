#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Shared preflight checks for all claude-plan-composer scripts.
#
# Usage: source this file after --help handling and argument validation.
#   # shellcheck source=lib/common.sh
#   source "${SCRIPT_DIR}/lib/common.sh"
#   _preflight_check        # python3 + PyYAML + bash 4+
#   _require_claude          # claude CLI (only when needed)
# ─────────────────────────────────────────────────────────────────────────────

# _preflight_check — verify python3, PyYAML, and bash 4+ are available.
# Collects all missing deps before exiting so the user sees everything at once.
_preflight_check() {
  local missing=()

  if ! command -v python3 >/dev/null 2>&1; then
    missing+=("python3 — required for config parsing (install via your package manager)")
  fi

  if command -v python3 >/dev/null 2>&1; then
    if ! python3 -c "import yaml" 2>/dev/null; then
      missing+=("PyYAML — required for config parsing (pip install pyyaml)")
    fi
  fi

  if [[ "${BASH_VERSINFO[0]}" -lt 4 ]]; then
    missing+=("bash 4+ — required for associative arrays (macOS: brew install bash)")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing prerequisites:"
    for dep in "${missing[@]}"; do
      echo "  - ${dep}"
    done
    echo ""
    echo "Install all missing dependencies and retry."
    exit 1
  fi
}

# _preflight_check_python — lighter check for scripts that only need python3.
# Skips the bash 4+ check (monitor-sessions.sh doesn't use associative arrays).
_preflight_check_python() {
  local missing=()

  if ! command -v python3 >/dev/null 2>&1; then
    missing+=("python3 — required for this script (install via your package manager)")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing prerequisites:"
    for dep in "${missing[@]}"; do
      echo "  - ${dep}"
    done
    exit 1
  fi
}

# _require_claude — verify the claude CLI is on PATH.
# Call this separately because some scripts (monitor-sessions.sh, evaluate --no-llm)
# don't need it.
_require_claude() {
  if ! command -v claude >/dev/null 2>&1; then
    echo "ERROR: claude CLI not found on PATH."
    echo "  Install: https://docs.anthropic.com/en/docs/claude-code/overview"
    echo "  Or ensure it's in your PATH."
    exit 1
  fi
}

# _warn_sensitive_paths — warn if configured paths include credential directories
# or overly broad scopes. Called after config resolution.
# Usage: _warn_sensitive_paths "${WORK_DIR}" "${ADD_DIRS[@]}"
_warn_sensitive_paths() {
  local work_dir="$1"
  shift
  local add_dirs=("$@")
  local warnings=()

  # Sensitive path patterns (credential stores, system dirs)
  local -a sensitive=(
    ".ssh" ".aws" ".gnupg" ".config/gcloud" ".kube"
    ".docker" ".npmrc" ".pypirc" ".netrc"
  )

  # Check if work_dir is the root or home directory
  local resolved
  resolved=$(cd "${work_dir}" 2>/dev/null && pwd) || resolved="${work_dir}"
  if [[ "${resolved}" = "/" ]]; then
    warnings+=("work_dir is / — Claude has access to the entire filesystem")
  elif [[ "${resolved}" = "${HOME}" ]]; then
    warnings+=("work_dir is \$HOME — Claude has access to your entire home directory")
  fi

  # Check work_dir and add_dirs for sensitive path components
  local all_dirs=("${resolved}" "${add_dirs[@]}")
  for dir in "${all_dirs[@]}"; do
    for pattern in "${sensitive[@]}"; do
      if [[ "${dir}" == *"${pattern}"* ]]; then
        warnings+=("directory contains sensitive path '${pattern}': ${dir}")
      fi
    done
  done

  if [[ ${#warnings[@]} -gt 0 ]]; then
    echo ""
    echo "WARNING — Security:"
    for w in "${warnings[@]}"; do
      echo "   - ${w}"
    done
    echo "   Recommendation: enable native sandbox (see research/laptop-threat-model.md)"
    echo ""
  fi
}

# ─── Stream-JSON log helpers ──────────────────────────────────────────────────
# Parse stream-json logs (NDJSON) produced by `claude -p --output-format stream-json`.
# Requires jq on PATH.

# _stream_json_tools — extract tool call names from a stream-json log file.
# Usage: _stream_json_tools "${logfile}"
# Output: one tool name per line (e.g., "Read", "Write", "Bash")
_stream_json_tools() {
  local logfile="$1"
  jq -r '
    select(.type == "assistant")
    | .message.content[]?
    | select(.type == "tool_use")
    | .name
  ' "${logfile}" 2>/dev/null
}

# _stream_json_last_tool — get the most recent tool call from a stream-json log.
# Usage: _stream_json_last_tool "${logfile}"
_stream_json_last_tool() {
  local logfile="$1"
  # shellcheck disable=SC2312
  _stream_json_tools "${logfile}" | tail -1
}

# _stream_json_turns — count completed assistant turns in a stream-json log.
# Usage: _stream_json_turns "${logfile}"
_stream_json_turns() {
  local logfile="$1"
  # shellcheck disable=SC2312
  jq -r 'select(.type == "assistant") | .type' "${logfile}" 2>/dev/null \
    | wc -l | tr -d ' '
}

# _stream_json_summary — one-line summary of a stream-json log.
# Usage: _stream_json_summary "${logfile}"
# Output: "3 turns, 7 tool calls (Read,Bash,Write), 1.4KB"
_stream_json_summary() {
  local logfile="$1"
  local turns tools tool_count size

  turns=$(_stream_json_turns "${logfile}")
  # shellcheck disable=SC2312
  tools=$(_stream_json_tools "${logfile}" | sort | uniq -c | sort -rn \
    | awk '{print $2}' | paste -sd, -)
  # shellcheck disable=SC2312
  tool_count=$(_stream_json_tools "${logfile}" | wc -l | tr -d ' ')
  # shellcheck disable=SC2312
  size=$(wc -c <"${logfile}" 2>/dev/null | tr -d ' ')
  size=$((size / 1024))

  echo "${turns} turns, ${tool_count} tool calls (${tools:-none}), ${size}KB"
}
