# Observability for Headless `claude -p` Pipelines

> Research findings, March 2026.
> Problem: when running `claude -p` in headless pipelines, there's zero visibility
> into what the agent is doing — no progress, no streaming output, just waiting.

## Summary

Five practical approaches exist today, from zero-setup to full-stack dashboards:

| Approach | Setup | Real-Time? | Cost | Best For |
|----------|-------|------------|------|----------|
| `stream-json` + tail/jq | Flag change | Yes | Free | Quick win, per-session |
| OpenTelemetry export | Collector needed | Near-real-time | Free (self-hosted) | Cost/usage dashboards |
| Hooks (custom scripts) | Hook config | Yes | Free | Custom monitoring |
| Hooks (disler dashboard) | Server + UI | Yes (WebSocket) | Free | Multi-agent real-time |
| Langfuse (Stop hook) | Account needed | Per-turn | Free tier | Deep trace analysis |

---

## 1. `--output-format stream-json` (Easiest, works today)

Instead of `--output-format text`, use `stream-json` to get real-time streaming
events from each `claude -p` session as newline-delimited JSON.

**What it emits:** Text deltas, tool calls starting, tool results, message
completions, and usage statistics — all as JSON objects.

```bash
# Current (blind):
claude -p "${PROMPT}" --output-format text >"${logfile}" 2>&1

# Observable:
claude -p "${PROMPT}" --output-format stream-json --verbose >"${logfile}" 2>&1
```

**Monitor a running session in real-time:**

```bash
# Stream tool calls
tail -f "${logfile}" | jq -r '
  select(.type == "stream_event") |
  if .event.type == "content_block_start" and .event.content_block.type == "tool_use"
  then "TOOL: " + .event.content_block.name
  elif .event.type == "message_delta"
  then "TURN COMPLETE (stop: " + (.event.delta.stop_reason // "unknown") + ")"
  else empty end
'

# Compact view — just tool names
tail -f "${logfile}" | jq -r '
  select(.type == "stream_event" and .event.type == "content_block_start"
    and .event.content_block.type == "tool_use") |
  .event.content_block.name
'
```

**Tested and confirmed (March 2026):** `stream-json` works with the Write tool pattern.
The plan file is created correctly regardless of `--output-format`. Experiment results
(`test/experiment-stream-json.sh`):

- Write tool creates files identically to `--output-format text`
- Log is valid NDJSON, parseable with jq line-by-line
- Tool calls (Write, Read, etc.) are visible in the stream
- No truncation observed (tested up to 3.4KB output)
- Output sizes comparable between text and stream-json (within ~25%)

**Background:** Previous research found known truncation bugs with `--output-format json`
([#2904](https://github.com/anthropics/claude-code/issues/2904),
[#3359](https://github.com/anthropics/claude-code/issues/3359)). These affect the
SDK readline JSON parser, not `stream-json` (which uses NDJSON, one object per line).
See `research/cloud-sessions-analysis.md` for the full output format analysis.

**Limitation with extended thinking:** When `max_thinking_tokens` is explicitly set,
`StreamEvent` messages are NOT emitted — only complete messages. Thinking is disabled
by default in `-p` mode, so this works fine unless explicitly enabled.

---

## 2. OpenTelemetry Export (Built-in, needs collector)

Claude Code has native OTel support. Add env vars before launching sessions:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export OTEL_METRIC_EXPORT_INTERVAL=10000   # 10s
export OTEL_LOGS_EXPORT_INTERVAL=5000      # 5s
export OTEL_LOG_USER_PROMPTS=1
export OTEL_LOG_TOOL_DETAILS=1
```

**Metrics available:**

| Metric | Description |
|--------|-------------|
| `claude_code.session.count` | Sessions started |
| `claude_code.token.usage` | Tokens by type (input/output/cache) |
| `claude_code.cost.usage` | Cost in USD |
| `claude_code.active_time.total` | Active time in seconds |
| `claude_code.lines_of_code.count` | Lines modified |

**Events (structured logs):**

| Event | Data |
|-------|------|
| `claude_code.tool_result` | Tool name, success/failure, duration |
| `claude_code.api_request` | Model, tokens, cost, duration, cache stats |
| `claude_code.api_error` | Error messages, status codes |

For quick debugging, use `OTEL_METRICS_EXPORTER=console` to print to stderr.

**Collector options:**
- Docker `otel/opentelemetry-collector` + Grafana (self-hosted)
- [SigNoz](https://signoz.io/docs/claude-code-monitoring/) (self-hosted, open source)
- Honeycomb, Datadog, Grafana Cloud (hosted)

**What's missing:** OTel **traces** (spans with parent-child relationships) are not
exported yet. Only metrics and logs. Requested in
[Issue #9584](https://github.com/anthropics/claude-code/issues/9584).

---

## 3. Hooks System (Built-in, needs hook scripts)

Claude Code has 16 hook event types. These work with headless `claude -p` when
configured in **project-level** settings (since we use `--setting-sources project,local`).

**Relevant hook events:**

| Event | When | Useful for |
|-------|------|-----------|
| `SessionStart` | Session begins | Track session launch |
| `SessionEnd` | Session terminates | Capture final metrics |
| `PreToolUse` | Before tool execution | Log what's about to happen |
| `PostToolUse` | After tool succeeds | Log tool results |
| `PostToolUseFailure` | After tool fails | Track errors |
| `Stop` | Claude finishes responding | Capture each turn |
| `PreCompact` | Before compaction | Context pressure alerts |

**Hook input (stdin JSON):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/plan.md" }
}
```

**Configuration (`.claude/settings.json` or `.claude/settings.local.json`):**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/log-tool-use.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

**HTTP hooks** are also supported — POST events directly to a monitoring server:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/events",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

**Important:** Use `"async": true` so hooks don't slow down the agent.

---

## 4. Community Dashboards

### disler/claude-code-hooks-multi-agent-observability

Purpose-built real-time monitoring for multiple concurrent Claude Code agents.

```
Claude -p sessions → Hook Scripts → HTTP POST → Bun Server → SQLite → WebSocket → Vue 3 Dashboard
```

Features:
- Parallel agent tracking via session IDs
- Real-time WebSocket streaming
- Multi-criteria filtering (app, session, event type)
- Live pulse chart
- Chat transcript viewer

Source: [github.com/disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability)

### Other tools

- **[onikan27/claude-code-monitor](https://github.com/onikan27/claude-code-monitor):** Real-time dashboard, CLI + Mobile Web UI
- **[KyleAMathews/claude-code-ui](https://github.com/KyleAMathews/claude-code-ui):** Session tracker with real-time updates
- **[daaain/claude-code-log](https://github.com/daaain/claude-code-log):** JSONL to readable HTML (post-hoc analysis)

---

## 5. Langfuse Integration

Langfuse has a specific Claude Code integration using the Stop hook. Parses
transcript JSONL files and sends structured traces to Langfuse.

**What you see:**
- Each conversation turn as a trace
- Generation spans (model info, tokens, cost)
- Tool spans (nested spans for Read, Write, Bash, etc.)
- Session grouping across turns

**Setup:**
```json
// .claude/settings.local.json
{
  "env": {
    "TRACE_TO_LANGFUSE": "true",
    "LANGFUSE_PUBLIC_KEY": "pk-...",
    "LANGFUSE_SECRET_KEY": "sk-..."
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/langfuse-trace.py"
          }
        ]
      }
    ]
  }
}
```

**Self-hosted:** [doneyli/claude-code-langfuse-template](https://github.com/doneyli/claude-code-langfuse-template)
provides Docker Compose for self-hosted Langfuse for Claude Code.

Sources: [langfuse.com/integrations/other/claude-code](https://langfuse.com/integrations/other/claude-code)

---

## Recommended Strategy for claude-plan-composer

### Phase 1: Quick Win — `stream-json` + enhanced monitor

Switch `--output-format text` to `--output-format stream-json --verbose` in
generate-plans.sh and merge-plans.sh. The existing `monitor-sessions.sh` can
parse the stream-json log files for real-time tool tracking.

No output breakage — we use Write tool for plan capture, not stdout.

### Phase 2: Hooks for Real-Time Events

Add project-level hooks (`.claude/settings.json`) that log to a shared events
file. Use async hooks to avoid slowing the agent.

### Phase 3: OTel for Cost/Usage Dashboard

Enable OTel export with a local collector for aggregate cost tracking and
session analytics across pipeline runs.

### Phase 4 (Optional): Langfuse for Deep Tracing

Add Langfuse Stop hook for rich post-hoc analysis with a web UI.

---

## What Does NOT Exist Yet

1. **OTel Traces** — No spans/traces, only metrics and logs
   ([#9584](https://github.com/anthropics/claude-code/issues/9584))
2. **Per-sub-agent metrics** — Only session-level aggregates
   ([#13994](https://github.com/anthropics/claude-code/issues/13994))
3. **Native platform integration** — No built-in Langfuse/LangSmith/Helicone;
   all go through hooks or OTel
4. **Progress callbacks for -p** — No ETA or progress %; closest is stream-json

---

## References

- [Claude Code Headless Docs](https://code.claude.com/docs/en/headless)
- [Claude Code Monitoring](https://code.claude.com/docs/en/monitoring-usage)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [SigNoz Guide](https://signoz.io/docs/claude-code-monitoring/)
- [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- [Langfuse Integration](https://langfuse.com/integrations/other/claude-code)
- `research/claude-p-headless-pitfalls.md` — companion doc on silent failures
