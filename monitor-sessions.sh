#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Monitor running Claude Code plan-generation sessions.
#
# Usage:
#   ./monitor-sessions.sh              # one-shot table
#   ./monitor-sessions.sh --watch      # refresh every 15s
#   ./monitor-sessions.sh --watch 5    # refresh every 5s
# ─────────────────────────────────────────────────────────────────────────────

SNAPSHOT="/tmp/claude-monitor-sizes.json"

render() {
python3 << 'PYEOF'
import json, os, subprocess, re, time, glob, sys, datetime

HOME = os.path.expanduser("~")
PROJ_DIR = os.path.join(HOME, ".claude/projects")
SNAPSHOT = "/tmp/claude-monitor-sizes.json"
PLAN_GEN_DIR = os.getcwd() + "/generated-plans"

# ── Colors ──────────────────────────────────────────────────────────────
class C:
    RED    = "\033[0;31m"
    GREEN  = "\033[0;32m"
    YELLOW = "\033[0;33m"
    CYAN   = "\033[0;36m"
    DIM    = "\033[2m"
    BOLD   = "\033[1m"
    RESET  = "\033[0m"

def colored(text, color, width):
    """Return colored text padded to exact visible width."""
    visible_len = len(text)
    pad = max(0, width - visible_len)
    return f"{color}{text}{C.RESET}" + " " * pad

def human_size(b):
    if b > 1_048_576: return f"{b/1_048_576:.1f}MB"
    if b > 1024: return f"{b/1024:.1f}KB"
    return f"{b}B"

def human_tokens(t):
    if t >= 1_000_000: return f"{t/1_000_000:.1f}M"
    if t >= 1_000: return f"{t/1_000:.0f}K"
    return str(t)

# ── Find running claude -p processes ────────────────────────────────────
try:
    ps_out = subprocess.check_output(
        ["ps", "-ww", "-eo", "pid,cputime,args"], text=True
    )
except:
    print(f"{C.RED}Cannot run ps{C.RESET}")
    sys.exit(1)

sessions = []
for line in ps_out.strip().split("\n")[1:]:
    parts = line.strip().split(None, 2)
    if len(parts) < 3: continue
    pid, cputime, args = parts[0], parts[1], parts[2]
    if "claude -p" not in args: continue
    if args.startswith("timeout"): continue  # skip wrapper

    # Detect variant from full command line.
    # Primary: match output file path (domain-agnostic).
    # Fallback: match variant-specific prompt text.
    variant = "unknown"
    if "plan-simplicity.md" in args or "Prioritize simplicity" in args:
        variant = "simplicity"
    elif "plan-framework-depth.md" in args or "mcp-agent framework patterns" in args:
        variant = "framework-depth"
    elif "plan-k8s-ops.md" in args or "K8s deployment depth" in args:
        variant = "k8s-ops"
    elif "plan-baseline.md" in args:
        variant = "baseline"
    elif "merged plan" in args or "comparison table" in args:
        variant = "merge"

    sessions.append({"pid": pid, "cputime": cputime, "variant": variant})

if not sessions:
    print(f"{C.RED}No running 'claude -p' sessions found.{C.RESET}")
    sys.exit(2)  # exit 2 = no sessions (distinct from 1 = error)

# ── Find matching JSONL transcripts ─────────────────────────────────────
# Strategy: find ALL active JSONL files in hyperflow project dirs.
# Sessions may run from plan-generator/ (v1) or hyperflow/ (v2, sandbox fix).

# Search ALL project dirs — don't hardcode paths.
# Filter to recently modified dirs (last 2 hours) to avoid scanning stale ones.
proj_dirs = []
for d in glob.glob(os.path.join(PROJ_DIR, "*")):
    if os.path.isdir(d) and time.time() - os.path.getmtime(d) < 7200:
        proj_dirs.append(d)

jsonl_info = {}  # variant -> {sid, size, tools, last_action, ...}
jsonl_mtime = {} # variant -> mtime (for preferring most recent JSONL)

# Collect all candidate JSONL files, sorted newest first
all_jsonls = []
for proj_dir in proj_dirs:
    for jsonl_path in glob.glob(os.path.join(proj_dir, "*.jsonl")):
        size = os.path.getsize(jsonl_path)
        if size < 500: continue  # skip empty/init files only
        mtime = os.path.getmtime(jsonl_path)
        if time.time() - mtime > 600: continue  # skip files older than 10min

        sid = os.path.basename(jsonl_path).replace(".jsonl", "")

        # Read first few lines to detect variant.
        # Strategy: look for variant-specific prompt text OR the output
        # file path (plan-{variant}.md) which generate-plans.sh always includes.
        detected_variant = None
        try:
            with open(jsonl_path, "r") as f:
                for i, raw_line in enumerate(f):
                    if i > 15: break
                    try:
                        d = json.loads(raw_line)
                        msg = d.get("message", {})
                        content = msg.get("content", "")
                        if isinstance(content, list):
                            content = " ".join(
                                c.get("text", "") for c in content
                                if isinstance(c, dict) and c.get("type") == "text"
                            )
                        # Match by variant-specific prompt text
                        if "Prioritize simplicity" in content:
                            detected_variant = "simplicity"
                            break
                        elif "mcp-agent framework patterns" in content:
                            detected_variant = "framework-depth"
                            break
                        elif "K8s deployment depth" in content:
                            detected_variant = "k8s-ops"
                            break
                        elif "merged plan" in content or "comparison table" in content:
                            detected_variant = "merge"
                            break
                        # Match by output file path (works for any prompt content)
                        elif "plan-simplicity.md" in content:
                            detected_variant = "simplicity"
                            break
                        elif "plan-framework-depth.md" in content:
                            detected_variant = "framework-depth"
                            break
                        elif "plan-k8s-ops.md" in content:
                            detected_variant = "k8s-ops"
                            break
                        elif "plan-baseline.md" in content:
                            detected_variant = "baseline"
                            break
                    except: pass
        except: continue

        # Read full file for token usage, tail for tools/actions
        tools = 0
        last_action = "?"
        agent_last_seen = {}  # agentId -> latest ISO timestamp
        turns = 0             # number of API turns
        compactions = 0       # number of context compactions
        total_input = 0       # cumulative input tokens (all turns)
        total_output = 0      # cumulative output tokens (all turns)
        total_cache_create = 0
        total_cache_read = 0
        context_size = 0      # last turn's context window usage
        try:
            # Scan full file for token usage (usage entries are small, fast to parse)
            with open(jsonl_path, "r") as f:
                for raw_line in f:
                    try:
                        d = json.loads(raw_line)
                        # Count compactions
                        if d.get("type") == "system" and d.get("subtype") == "compact_boundary":
                            compactions += 1
                        msg = d.get("message", {})
                        if msg.get("role") == "assistant" and "usage" in msg:
                            u = msg["usage"]
                            inp = u.get("input_tokens", 0)
                            out = u.get("output_tokens", 0)
                            cc = u.get("cache_creation_input_tokens", 0)
                            cr = u.get("cache_read_input_tokens", 0)
                            turns += 1
                            total_input += inp
                            total_output += out
                            total_cache_create += cc
                            total_cache_read += cr
                            # Context = all input for this turn (new + cached)
                            context_size = inp + cc + cr
                    except: pass

            with open(jsonl_path, "rb") as f:
                f.seek(0, 2)
                end = f.tell()
                f.seek(max(0, end - 200_000))  # 200KB tail for better agent coverage
                tail_lines = []
                for raw in f:
                    try: tail_lines.append(json.loads(raw))
                    except: pass

            for d in tail_lines:
                # Count tools (parent only)
                if not d.get("isSidechain"):
                    for c in d.get("message", {}).get("content", []):
                        if isinstance(c, dict) and c.get("type") == "tool_use":
                            tools += 1

                # Track subagents by agentId and latest timestamp
                aid = d.get("agentId")
                if aid and d.get("isSidechain"):
                    ts = d.get("timestamp", "")
                    if ts > agent_last_seen.get(aid, ""):
                        agent_last_seen[aid] = ts

            # Determine running vs total subagents
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            agents_total = len(agent_last_seen)
            agents_running = 0
            for aid, ts in agent_last_seen.items():
                try:
                    last = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    age_secs = (now_utc - last).total_seconds()
                    if age_secs < 120:  # active within last 2 minutes
                        agents_running += 1
                except: pass

            # Find last assistant action (skip sidechain/subagent messages)
            for d in reversed(tail_lines):
                if d.get("isSidechain"): continue
                msg = d.get("message", {})
                if msg.get("role") != "assistant": continue
                for c in msg.get("content", []):
                    if not isinstance(c, dict): continue
                    if c.get("type") == "tool_use":
                        name = c["name"]
                        inp = c.get("input", {})
                        # Format nicely based on tool type
                        if name == "Task":
                            desc = inp.get("description", "")
                            last_action = f"Task → {desc}"
                        elif name == "TaskOutput":
                            tid = inp.get("task_id", "?")
                            last_action = f"TaskOutput(waiting {tid})"
                        elif name == "Read":
                            fp = inp.get("file_path", "")
                            last_action = f"Read({os.path.basename(fp)})"
                        elif name == "Glob":
                            last_action = f"Glob({inp.get('pattern', '?')})"
                        elif name == "Grep":
                            last_action = f"Grep({inp.get('pattern', '?')[:30]})"
                        elif name == "Bash":
                            cmd = inp.get("command", "")[:40]
                            last_action = f"Bash({cmd})"
                        elif name == "Write":
                            fp = inp.get("file_path", "")
                            last_action = f"Write({os.path.basename(fp)})"
                        elif name == "WebSearch":
                            q = inp.get("query", "")[:35]
                            last_action = f"WebSearch({q})"
                        elif name == "WebFetch":
                            u = inp.get("url", "")
                            last_action = f"WebFetch({u[-35:]})"
                        elif "Scholar" in name:
                            q = inp.get("query", "")[:30]
                            last_action = f"Scholar({q})"
                        elif "context7" in name:
                            last_action = f"Context7({inp.get('query', inp.get('libraryName', ''))[:25]})"
                        else:
                            last_action = name
                        break
                    elif c.get("type") == "text":
                        txt = c.get("text", "").strip()
                        if len(txt) > 10:
                            txt = txt.replace("\n", " ")
                            last_action = f"💬 {txt}"
                            break
                if last_action != "?":
                    break

        except: pass

        # Build info dict for this JSONL
        info = {
            "sid": sid, "size": size, "tools": tools,
            "agents_running": agents_running, "agents_total": agents_total,
            "last_action": last_action, "path": jsonl_path,
            "turns": turns, "compactions": compactions,
            "total_input": total_input,
            "total_output": total_output,
            "total_cache_create": total_cache_create,
            "total_cache_read": total_cache_read,
            "total_tokens": total_input + total_output + total_cache_create + total_cache_read,
            "context_size": context_size,
        }

        # Resolve variant name
        variant_key = detected_variant

        # Keep only the most recently modified JSONL per variant
        if variant_key:
            if variant_key not in jsonl_info or mtime > jsonl_mtime.get(variant_key, 0):
                jsonl_info[variant_key] = info
                jsonl_mtime[variant_key] = mtime

# ── Load previous snapshot ──────────────────────────────────────────────
prev_sizes = {}
try:
    with open(SNAPSHOT) as f:
        prev_sizes = json.load(f)
except: pass

new_sizes = {}

# ── Render table ────────────────────────────────────────────────────────
VARIANT_COLORS = {
    "baseline": C.CYAN,
    "simplicity": C.GREEN,
    "framework-depth": C.YELLOW,
    "k8s-ops": C.RED,
    "merge": C.BOLD,
}

# Column widths (visible characters)
W_PID = 7
W_VARIANT = 18
W_SID = 10
W_SIZE = 9
W_TOOLS = 6
W_AGENTS = 8
W_TURNS = 6
W_INPUT = 8
W_OUTPUT = 8
W_CCREATE = 9
W_CREAD = 9
W_TOTAL = 9
W_CTX = 10
W_COMPACT = 4
W_CPU = 9
W_ACTIVITY = 10
W_ACTION = 0  # expand to terminal

try:
    TERM_WIDTH = os.get_terminal_size().columns
except:
    TERM_WIDTH = 200
NUM_SEPS = 15
fixed_cols = W_PID + W_VARIANT + W_SID + W_SIZE + W_TOOLS + W_AGENTS + W_TURNS + W_INPUT + W_OUTPUT + W_CCREATE + W_CREAD + W_TOTAL + W_CTX + W_COMPACT + W_CPU + W_ACTIVITY + NUM_SEPS
W_ACTION = max(30, TERM_WIDTH - fixed_cols - 5)

cols = [
    ("PID", W_PID), ("Variant", W_VARIANT), ("Session", W_SID), ("Size", W_SIZE),
    ("Tools", W_TOOLS), ("Agents", W_AGENTS), ("Turns", W_TURNS),
    ("Input", W_INPUT), ("Output", W_OUTPUT), ("Cache+", W_CCREATE), ("Cache→", W_CREAD),
    ("Total", W_TOTAL), ("Context", W_CTX), ("C#", W_COMPACT),
    ("CPU", W_CPU), ("Activity", W_ACTIVITY), ("Last Action", W_ACTION),
]
sep_line = "┼".join("─" * w for _, w in cols)
header = "│".join(f"{name:^{w}}" for name, w in cols)

print()
print(f"{C.BOLD} {header}{C.RESET}")
print(f" {sep_line}")

for s in sessions:
    pid = s["pid"]
    variant = s["variant"]
    cputime = s["cputime"]

    # Match session transcript
    info = jsonl_info.get(variant, {})
    sid = info.get("sid", "?")[:8] if info else "?"
    size = info.get("size", 0)
    tools = info.get("tools", 0)
    agents_running = info.get("agents_running", 0)
    agents_total = info.get("agents_total", 0)
    last_action = info.get("last_action", "?")
    turns = info.get("turns", 0)
    t_input = info.get("total_input", 0)
    t_output = info.get("total_output", 0)
    t_ccreate = info.get("total_cache_create", 0)
    t_cread = info.get("total_cache_read", 0)
    t_total = info.get("total_tokens", 0)
    ctx = info.get("context_size", 0)
    compactions = info.get("compactions", 0)

    # Activity detection
    key = f"{variant}"
    new_sizes[key] = size
    prev = prev_sizes.get(key, 0)

    if prev == 0:
        activity = colored("● new", C.CYAN, W_ACTIVITY)
    elif size > prev:
        delta = size - prev
        activity = colored(f"▲ +{human_size(delta)}", C.GREEN, W_ACTIVITY)
    elif size == prev and size > 0:
        activity = colored("○ idle", C.YELLOW, W_ACTIVITY)
    else:
        activity = colored("? n/a", C.DIM, W_ACTIVITY)

    # Colored variant
    vc = VARIANT_COLORS.get(variant, C.DIM)
    variant_str = colored(variant, vc, W_VARIANT)

    # Format agents column: "running/total" with color
    if agents_total == 0:
        agents_str = colored("—", C.DIM, W_AGENTS)
    elif agents_running > 0:
        agents_str = colored(f"{agents_running}▶/{agents_total}", C.GREEN, W_AGENTS)
    else:
        agents_str = colored(f"0/{agents_total}", C.DIM, W_AGENTS)

    # Context as percentage of 200K limit
    ctx_pct = f"{ctx * 100 / 200_000:.0f}%" if ctx > 0 else "—"
    ctx_str = f"{human_tokens(ctx)} {ctx_pct}" if ctx > 0 else "—"
    # Color context by usage level
    if ctx > 160_000:
        ctx_str = colored(ctx_str, C.RED, W_CTX)
    elif ctx > 100_000:
        ctx_str = colored(ctx_str, C.YELLOW, W_CTX)
    else:
        ctx_str = colored(ctx_str, C.DIM, W_CTX) if ctx > 0 else colored("—", C.DIM, W_CTX)

    # Compaction count — color red if any (signals context pressure)
    if compactions > 0:
        compact_str = colored(str(compactions), C.RED, W_COMPACT)
    else:
        compact_str = colored("—", C.DIM, W_COMPACT)

    # Fit last_action to available terminal width
    if W_ACTION > 0 and len(last_action) > W_ACTION:
        last_action = last_action[:W_ACTION - 1] + "…"

    print(
        f" {pid:>{W_PID}}"
        f"│{variant_str}"
        f"│{sid:^{W_SID}}"
        f"│{human_size(size):>{W_SIZE}}"
        f"│{tools:>{W_TOOLS}}"
        f"│{agents_str}"
        f"│{turns:>{W_TURNS}}"
        f"│{human_tokens(t_input):>{W_INPUT}}"
        f"│{human_tokens(t_output):>{W_OUTPUT}}"
        f"│{human_tokens(t_ccreate):>{W_CCREATE}}"
        f"│{human_tokens(t_cread):>{W_CREAD}}"
        f"│{human_tokens(t_total):>{W_TOTAL}}"
        f"│{ctx_str}"
        f"│{compact_str}"
        f"│{cputime:>{W_CPU}}"
        f"│{activity}"
        f"│{last_action:<{W_ACTION}}"
    )

print(f" {sep_line}")

# ── Save snapshot ───────────────────────────────────────────────────────
with open(SNAPSHOT, "w") as f:
    json.dump(new_sizes, f)

# ── Output files ────────────────────────────────────────────────────────

# Build set of variants that still have running sessions
running_variants = {s["variant"] for s in sessions}

print()
print(f"{C.BOLD}Output files:{C.RESET}")

# Find latest run directory by newest timestamp subdirectory.
# Skip symlinks (like "latest") which would incorrectly sort after timestamps.
latest_dir = None
for prompt_dir in sorted(glob.glob(os.path.join(PLAN_GEN_DIR, "*")),
                         key=os.path.getmtime, reverse=True):
    if not os.path.isdir(prompt_dir) or os.path.islink(prompt_dir):
        continue
    # Find the newest timestamp subdirectory (YYYYMMDD-HHMMSS)
    subdirs = [
        d for d in sorted(os.listdir(prompt_dir), reverse=True)
        if os.path.isdir(os.path.join(prompt_dir, d))
        and not os.path.islink(os.path.join(prompt_dir, d))
    ]
    if subdirs:
        candidate = os.path.join(prompt_dir, subdirs[0])
        if latest_dir is None or os.path.getmtime(candidate) > os.path.getmtime(latest_dir):
            latest_dir = candidate
    break  # most recently modified prompt_dir wins

if latest_dir:
    print(f"  {C.DIM}{latest_dir}/{C.RESET}")
    # Show all expected plan files (from running + existing)
    shown_variants = set()
    for md in sorted(glob.glob(os.path.join(latest_dir, "plan-*.md"))):
        fsize = os.path.getsize(md)
        fname = os.path.basename(md)
        file_variant = fname.replace("plan-", "").replace(".md", "")
        shown_variants.add(file_variant)
        variant_running = file_variant in running_variants

        if fsize == 0:
            if variant_running:
                print(f"  {C.DIM}{fname}: empty (session running — waiting for Write tool){C.RESET}")
            else:
                print(f"  {C.RED}{fname}: empty ✗{C.RESET}")
        elif fsize < 5000:
            if variant_running:
                print(f"  {C.CYAN}{fname}: {human_size(fsize)} ⏳ still writing...{C.RESET}")
            else:
                print(f"  {C.YELLOW}{fname}: {human_size(fsize)} ⚠ possibly truncated{C.RESET}")
        else:
            print(f"  {C.GREEN}{fname}: {human_size(fsize)} ✓{C.RESET}")
    # Show running variants that have no file yet (Write tool not called yet)
    for v in sorted(running_variants - shown_variants):
        print(f"  {C.DIM}plan-{v}.md: not yet created (researching...){C.RESET}")
else:
    print(f"  {C.DIM}No output files found yet{C.RESET}")

print()
now = time.strftime("%H:%M:%S")
print(f"{C.DIM}{now} — {len(sessions)} session(s) running{C.RESET}")
PYEOF
}

# ─── Entry point ───────────────────────────────────────────────────────────

if [ "${1:-}" = "--watch" ]; then
    interval="${2:-15}"
    saw_sessions=false
    while true; do
        clear
        echo -e "\033[1mClaude Code Session Monitor\033[0m (refresh ${interval}s, Ctrl+C to stop)"
        rc=0; render || rc=$?
        if [ "$rc" -eq 0 ]; then
            saw_sessions=true
        elif [ "$rc" -eq 2 ] && $saw_sessions; then
            # Had sessions before, now none — all done
            echo ""
            echo -e "\033[1mAll sessions finished. Exiting monitor.\033[0m"
            sleep 2
            break
        fi
        sleep "$interval"
    done
else
    render
fi
