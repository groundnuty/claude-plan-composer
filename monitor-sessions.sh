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

render() {
  python3 <<'PYEOF'
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

    # Detect variant from full command line (domain-agnostic).
    # Strategy: match output file path pattern plan-{variant}.md in args.
    variant = "unknown"
    m = re.search(r'plan-([A-Za-z0-9_-]+)\.(?:md|log)', args)
    if m:
        variant = m.group(1)
    elif "merge" in args.lower() and ("merged plan" in args or "comparison table" in args):
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
                        # Generic variant detection from output file path.
                        # Matches plan-{variant}.md in prompt content.
                        pm = re.search(r'plan-([A-Za-z0-9_-]+)\.md', content)
                        if pm:
                            detected_variant = pm.group(1)
                            break
                        elif "merged plan" in content or "comparison table" in content:
                            detected_variant = "merge"
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

# ── Parse stream-json logs from run directory ─────────────────────────────
# Stream-json logs have predictable paths: plan-{variant}.log, merge.log.
# This gives reliable variant detection from filename (domain-agnostic)
# and supplements JSONL data when transcript matching fails.

def _find_latest_run_dir():
    """Find the most recent run directory under generated-plans/."""
    for prompt_dir in sorted(glob.glob(os.path.join(PLAN_GEN_DIR, "*")),
                             key=os.path.getmtime, reverse=True):
        if not os.path.isdir(prompt_dir) or os.path.islink(prompt_dir):
            continue
        subdirs = [
            d for d in sorted(os.listdir(prompt_dir), reverse=True)
            if os.path.isdir(os.path.join(prompt_dir, d))
            and not os.path.islink(os.path.join(prompt_dir, d))
        ]
        if subdirs:
            return os.path.join(prompt_dir, subdirs[0])
    return None

run_dir = _find_latest_run_dir()
if run_dir:
    for log_path in glob.glob(os.path.join(run_dir, "*.log")):
        fname = os.path.basename(log_path)
        # Extract variant from filename: plan-simplicity.log → simplicity
        if fname.startswith("plan-") and fname.endswith(".log"):
            sj_variant = fname[5:-4]
        elif fname == "merge.log":
            sj_variant = "merge"
        else:
            continue

        sj_mtime = os.path.getmtime(log_path)
        if time.time() - sj_mtime > 600:
            continue  # skip stale logs

        # Skip if JSONL already matched this variant (JSONL has richer data)
        if sj_variant in jsonl_info:
            continue

        sj_size = os.path.getsize(log_path)
        sj_tools = 0
        sj_turns = 0
        sj_last_action = "?"
        try:
            with open(log_path, "r") as f:
                for raw_line in f:
                    try:
                        d = json.loads(raw_line)
                        if d.get("type") == "assistant":
                            sj_turns += 1
                            for c in d.get("message", {}).get("content", []):
                                if isinstance(c, dict) and c.get("type") == "tool_use":
                                    sj_tools += 1
                                    name = c.get("name", "?")
                                    inp = c.get("input", {})
                                    if name == "Write":
                                        fp = inp.get("file_path", "")
                                        sj_last_action = f"Write({os.path.basename(fp)})"
                                    elif name == "Read":
                                        fp = inp.get("file_path", "")
                                        sj_last_action = f"Read({os.path.basename(fp)})"
                                    else:
                                        sj_last_action = name
                    except:
                        pass
        except:
            continue

        jsonl_info[sj_variant] = {
            "sid": "stream", "size": sj_size, "tools": sj_tools,
            "agents_running": 0, "agents_total": 0,
            "last_action": sj_last_action, "path": log_path,
            "turns": sj_turns, "compactions": 0,
            "total_input": 0, "total_output": 0,
            "total_cache_create": 0, "total_cache_read": 0,
            "total_tokens": 0, "context_size": 0,
        }

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

# ─── Summary mode ─────────────────────────────────────────────────────────
# Parse stream-json logs and output files from a completed (or in-progress)
# run directory. Shows per-stage pipeline summary.

render_summary() {
  local run_dir="$1"
  python3 - "${run_dir}" <<'PYEOF'
import json, os, subprocess, re, time, glob, sys

run_dir = sys.argv[1]

# ── Colors ──────────────────────────────────────────────────────────────
class C:
    RED    = "\033[0;31m"
    GREEN  = "\033[0;32m"
    YELLOW = "\033[0;33m"
    CYAN   = "\033[0;36m"
    DIM    = "\033[2m"
    BOLD   = "\033[1m"
    RESET  = "\033[0m"

def human_size(b):
    if b > 1_048_576: return f"{b/1_048_576:.1f}MB"
    if b > 1024: return f"{b/1024:.1f}KB"
    return f"{b}B"

def colored(text, color):
    return f"{color}{text}{C.RESET}"

def status_colored(status):
    colors = {
        "done": C.GREEN, "running": C.CYAN,
        "failed": C.RED, "not started": C.DIM, "not run": C.DIM,
    }
    return colored(status, colors.get(status, C.DIM))

def file_info(path):
    """Return (exists, size) for a file path."""
    if os.path.exists(path):
        return True, os.path.getsize(path)
    return False, 0

# ── Stream-JSON parser ──────────────────────────────────────────────────

def parse_stream_json(log_path):
    """Parse NDJSON log. Returns dict with turns, tools, breakdown, size."""
    turns = 0
    tool_counts = {}
    size = os.path.getsize(log_path)
    valid_json = 0

    try:
        with open(log_path, "r") as f:
            for line in f:
                try:
                    d = json.loads(line)
                    valid_json += 1
                    if d.get("type") == "assistant":
                        turns += 1
                        for c in d.get("message", {}).get("content", []):
                            if isinstance(c, dict) and c.get("type") == "tool_use":
                                name = c.get("name", "?")
                                tool_counts[name] = tool_counts.get(name, 0) + 1
                except (json.JSONDecodeError, ValueError):
                    pass
    except Exception:
        pass

    if valid_json == 0:
        return None  # not a valid NDJSON file

    total_tools = sum(tool_counts.values())
    breakdown = ",".join(
        f"{name}({count})"
        for name, count in sorted(tool_counts.items(), key=lambda x: -x[1])
    )

    return {
        "turns": turns, "tools": total_tools,
        "breakdown": breakdown or "none", "size": size,
    }

# ── Status detection ────────────────────────────────────────────────────

def _has_running_process(match_text):
    """Check if any running claude -p process matches the given text."""
    try:
        ps_out = subprocess.check_output(
            ["ps", "-ww", "-eo", "args"], text=True
        )
        for line in ps_out.split("\n"):
            if "claude -p" in line and match_text in line:
                return True
    except Exception:
        pass
    return False

def detect_status(log_path, output_path, min_output=1000):
    """Detect status: done | running | failed | not started."""
    if not os.path.exists(log_path):
        return "not started"

    log_mtime = os.path.getmtime(log_path)
    is_recent = (time.time() - log_mtime) < 120

    # Check for running process matching this log's variant
    log_name = os.path.basename(log_path)
    has_process = _has_running_process(log_name.replace(".log", ""))

    if has_process or is_recent:
        if output_path and os.path.exists(output_path):
            out_size = os.path.getsize(output_path)
            if out_size >= min_output:
                return "done"
        return "running"

    if output_path and os.path.exists(output_path):
        out_size = os.path.getsize(output_path)
        if out_size >= min_output:
            return "done"
        return "failed"

    return "failed"

# ── Scan run directory ──────────────────────────────────────────────────

# GENERATE stage
gen_variants = []
for log_path in sorted(glob.glob(os.path.join(run_dir, "plan-*.log"))):
    fname = os.path.basename(log_path)
    variant = fname[5:-4]  # plan-{variant}.log
    md_path = os.path.join(run_dir, f"plan-{variant}.md")
    parsed = parse_stream_json(log_path)
    status = detect_status(log_path, md_path, min_output=5000)
    md_exists, md_size = file_info(md_path)
    gen_variants.append({
        "variant": variant, "status": status,
        "log": parsed, "md_size": md_size if md_exists else 0,
    })

# EVALUATE stage
eval_md_exists, eval_md_size = file_info(os.path.join(run_dir, "evaluation.md"))
eval_json_exists, eval_json_size = file_info(os.path.join(run_dir, "evaluation.json"))

# MERGE stage
merge_log_path = os.path.join(run_dir, "merge.log")
merge_md_path = os.path.join(run_dir, "merged-plan.md")
merge_parsed = parse_stream_json(merge_log_path) if os.path.exists(merge_log_path) else None
merge_status = detect_status(merge_log_path, merge_md_path)
merge_md_exists, merge_md_size = file_info(merge_md_path)
if merge_status == "running":
    any_running = True

# VERIFY stage
report_exists, report_size = file_info(os.path.join(run_dir, "verification-report.md"))
premortem_exists, premortem_size = file_info(os.path.join(run_dir, "pre-mortem.md"))

# ── Render ──────────────────────────────────────────────────────────────

print()
# Directory age — how fresh is this run?
dir_mtime = os.path.getmtime(run_dir)
age_secs = time.time() - dir_mtime
if age_secs < 120:
    age_str = colored("just now", C.GREEN)
elif age_secs < 3600:
    age_str = colored(f"{int(age_secs / 60)}m ago", C.CYAN)
elif age_secs < 86400:
    age_str = colored(f"{int(age_secs / 3600)}h ago", C.YELLOW)
else:
    age_str = colored(f"{int(age_secs / 86400)}d ago", C.RED)

# Detect if any stage is still running
any_running = False

print(f"{C.BOLD}Pipeline Summary:{C.RESET} {run_dir}")
print(f"  Last modified: {age_str}")

# -- GENERATE --
gen_count = len(gen_variants)
gen_done = sum(1 for v in gen_variants if v["status"] == "done")
gen_running = sum(1 for v in gen_variants if v["status"] == "running")
if gen_running > 0:
    any_running = True
print()
label = f"GENERATE ({gen_count} variant{'s' if gen_count != 1 else ''})"
print(f"{C.BOLD}── {label} {'─' * max(1, 62 - len(label))}{C.RESET}")
if gen_variants:
    print(f"  {'Variant':<18} {'Status':<12} {'Turns':>5} {'Tools':>5}  {'Breakdown':<30} {'Log':>8} {'Plan':>8}")
    for v in gen_variants:
        log = v["log"]
        turns = str(log["turns"]) if log else "—"
        tools = str(log["tools"]) if log else "—"
        bd = (log["breakdown"][:30] if log else "—")
        log_sz = human_size(log["size"]) if log else "—"
        plan_sz = human_size(v["md_size"]) if v["md_size"] > 0 else "—"
        st = status_colored(v["status"])
        print(f"  {v['variant']:<18} {st:<21} {turns:>5} {tools:>5}  {bd:<30} {log_sz:>8} {plan_sz:>8}")
else:
    print(f"  {C.DIM}No plan logs found{C.RESET}")

# -- EVALUATE --
print()
print(f"{C.BOLD}── EVALUATE {'─' * 53}{C.RESET}")
if eval_md_exists:
    print(f"  evaluation.md     {human_size(eval_md_size):>8}   {status_colored('done')}")
else:
    print(f"  evaluation.md     {'—':>8}   {status_colored('not run')}")
if eval_json_exists:
    print(f"  evaluation.json   {human_size(eval_json_size):>8}   {status_colored('done')}")

# -- MERGE --
print()
print(f"{C.BOLD}── MERGE {'─' * 56}{C.RESET}")
if merge_parsed:
    print(f"  {'Status':<12} {'Turns':>5} {'Tools':>5}  {'Breakdown':<30} {'Log':>8} {'Plan':>8}")
    bd = merge_parsed["breakdown"][:30]
    log_sz = human_size(merge_parsed["size"])
    plan_sz = human_size(merge_md_size) if merge_md_exists else "—"
    st = status_colored(merge_status)
    print(f"  {st:<21} {merge_parsed['turns']:>5} {merge_parsed['tools']:>5}  {bd:<30} {log_sz:>8} {plan_sz:>8}")
elif merge_status == "not started":
    print(f"  {status_colored('not started')}")
else:
    print(f"  {status_colored(merge_status)}")

# -- VERIFY --
print()
print(f"{C.BOLD}── VERIFY {'─' * 55}{C.RESET}")
if report_exists:
    print(f"  verification-report.md   {human_size(report_size):>8}   {status_colored('done')}")
else:
    print(f"  verification-report.md   {'—':>8}   {status_colored('not run')}")
if premortem_exists:
    print(f"  pre-mortem.md            {human_size(premortem_size):>8}   {status_colored('done')}")
else:
    print(f"  pre-mortem.md            {'—':>8}   {status_colored('not run')}")

# -- Totals --
stages_done = sum([
    gen_done == gen_count and gen_count > 0,
    eval_md_exists,
    merge_status == "done",
    report_exists,
])
total_log_bytes = sum(v["log"]["size"] for v in gen_variants if v["log"])
if merge_parsed:
    total_log_bytes += merge_parsed["size"]

print()
print(f"{C.BOLD}── Totals {'─' * 55}{C.RESET}")
status_label = colored("running", C.CYAN) if any_running else (
    colored("complete", C.GREEN) if stages_done == 4 else colored("incomplete", C.YELLOW)
)
print(f"  Status: {status_label} — {stages_done}/4 stages done")
if gen_count > 0:
    parts = []
    if gen_done > 0:
        parts.append(f"{gen_done} done")
    if gen_running > 0:
        parts.append(f"{gen_running} running")
    gen_failed = gen_count - gen_done - gen_running
    if gen_failed > 0:
        parts.append(f"{gen_failed} failed")
    print(f"  Plans:  {', '.join(parts)} (of {gen_count})")
print(f"  Logs:   {human_size(total_log_bytes)} total")

print()
print(f"{C.DIM}{time.strftime('%H:%M:%S')}{C.RESET}")
PYEOF
}

# ─── Entry point ───────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ "${1:-}" = "-h" ]] || [[ "${1:-}" = "--help" ]]; then
  cat <<'HELP'
Usage: ./monitor-sessions.sh [--watch [INTERVAL]] [--summary <DIR>]

  Real-time dashboard for running Claude Code plan-generation sessions.
  Tracks PIDs, token usage, context window, subagents, and last action.

Flags:
  --watch [SECS]        Refresh every SECS seconds (default: 15)
  --summary <DIR>       Pipeline summary for a run directory (post-hoc or live)
  -h, --help            Show this help

Examples:
  ./monitor-sessions.sh                                     # one-shot table
  ./monitor-sessions.sh --watch                             # refresh every 15s
  ./monitor-sessions.sh --watch 5                           # refresh every 5s
  ./monitor-sessions.sh --summary generated-plans/x/latest  # pipeline summary
HELP
  exit 0
fi

# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
_preflight_check_python

if [[ "${1:-}" = "--summary" ]]; then
  run_dir="${2:?Usage: $0 --summary <run-dir>}"
  if [[ ! -d "${run_dir}" ]]; then
    echo "ERROR: Directory not found: ${run_dir}"
    exit 1
  fi
  # Resolve symlinks (e.g., .../latest -> .../20260302-102925)
  run_dir=$(cd "${run_dir}" && pwd)
  render_summary "${run_dir}"
elif [[ "${1:-}" = "--watch" ]]; then
  interval="${2:-15}"
  saw_sessions=false
  while true; do
    clear
    echo -e "\033[1mClaude Code Session Monitor\033[0m (refresh ${interval}s, Ctrl+C to stop)"
    rc=0
    # shellcheck disable=SC2310 # intentional — capture exit code
    render || rc=$?
    if [[ "${rc}" -eq 0 ]]; then
      saw_sessions=true
    elif [[ "${rc}" -eq 2 ]] && ${saw_sessions}; then
      # Had sessions before, now none — all done
      echo ""
      echo -e "\033[1mAll sessions finished. Exiting monitor.\033[0m"
      sleep 2
      break
    fi
    sleep "${interval}"
  done
else
  render
fi
