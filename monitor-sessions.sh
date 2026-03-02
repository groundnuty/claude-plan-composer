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

def colored(text, color, width=0):
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
import json, os, subprocess, re, time, glob, sys, datetime

run_dir = sys.argv[1]

# ── Colors and formatting ──────────────────────────────────────────────
class C:
    RED    = "\033[0;31m"
    GREEN  = "\033[0;32m"
    YELLOW = "\033[0;33m"
    CYAN   = "\033[0;36m"
    DIM    = "\033[2m"
    BOLD   = "\033[1m"
    RESET  = "\033[0m"

HR = "\u2500"  # ─ horizontal rule character
ARROW = "\u2192"  # → arrow character
DASH = "\u2014"   # — em dash for empty values

def human_size(b):
    if b > 1_048_576: return f"{b/1_048_576:.1f}MB"
    if b > 1024: return f"{b/1024:.1f}KB"
    return f"{b}B"

def human_tokens(t):
    if t >= 1_000_000: return f"{t/1_000_000:.1f}M"
    if t >= 1_000: return f"{t/1_000:.0f}K"
    return str(t)

_ANSI_RE = re.compile(r'\033\[[^m]*m')

def colored(text, color):
    return f"{color}{text}{C.RESET}"

def pad(s, width, align='>'):
    """Pad string with ANSI codes to exact visible width."""
    visible = len(_ANSI_RE.sub('', s))
    p = max(0, width - visible)
    if align == '<':
        return s + ' ' * p
    return ' ' * p + s

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

def _format_last_action(content_blocks):
    """Format last action from assistant message content blocks."""
    for c in content_blocks:
        if not isinstance(c, dict):
            continue
        if c.get("type") == "tool_use":
            name = c.get("name", "?")
            inp = c.get("input", {})
            if name == "Read":
                return f"Read({os.path.basename(inp.get('file_path', '?'))})"
            elif name == "Glob":
                return f"Glob({inp.get('pattern', '?')})"
            elif name == "Grep":
                return f"Grep({inp.get('pattern', '?')[:30]})"
            elif name == "Bash":
                return f"Bash({inp.get('command', '?')[:40]})"
            elif name == "Write":
                return f"Write({os.path.basename(inp.get('file_path', '?'))})"
            elif name == "Edit":
                return f"Edit({os.path.basename(inp.get('file_path', '?'))})"
            elif name == "WebSearch":
                return f"WebSearch({inp.get('query', '?')[:35]})"
            elif name == "Agent":
                return f"Agent({inp.get('description', '?')[:35]})"
            return name
        elif c.get("type") == "text":
            text = c.get("text", "").replace("\n", " ").strip()
            if len(text) > 10:
                return f"\U0001f4ac {text[:50]}"
    return None

def parse_stream_json(log_path):
    """Parse NDJSON log. Returns dict with session, token, and tool data."""
    turns = 0
    tool_counts = {}
    size = os.path.getsize(log_path)
    valid_json = 0
    session_id = None
    input_tokens = 0
    output_tokens = 0
    cache_create = 0
    cache_read = 0
    context_size = 0
    compactions = 0
    last_action = None

    try:
        with open(log_path, "r") as f:
            for line in f:
                try:
                    d = json.loads(line)
                    valid_json += 1
                    dtype = d.get("type")

                    if dtype == "system":
                        if d.get("subtype") == "init":
                            session_id = d.get("session_id", "")
                        elif d.get("subtype") == "compact_boundary":
                            compactions += 1

                    elif dtype == "assistant":
                        msg = d.get("message", {})
                        content = msg.get("content", [])
                        turns += 1

                        # Token usage
                        usage = msg.get("usage", {})
                        if usage:
                            inp = usage.get("input_tokens", 0)
                            out = usage.get("output_tokens", 0)
                            cc = usage.get("cache_creation_input_tokens", 0)
                            cr = usage.get("cache_read_input_tokens", 0)
                            input_tokens += inp
                            output_tokens += out
                            cache_create += cc
                            cache_read += cr
                            context_size = inp + cc + cr

                        # Tool counts + last action
                        action = _format_last_action(content)
                        if action:
                            last_action = action
                        for c in content:
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
    total_tokens = input_tokens + output_tokens + cache_create + cache_read
    breakdown = ",".join(
        f"{name}({count})"
        for name, count in sorted(tool_counts.items(), key=lambda x: -x[1])
    )

    return {
        "turns": turns, "tools": total_tools,
        "breakdown": breakdown or "none", "size": size,
        "session_id": (session_id or "")[:8],
        "input_tokens": input_tokens, "output_tokens": output_tokens,
        "cache_create": cache_create, "cache_read": cache_read,
        "total_tokens": total_tokens, "context_size": context_size,
        "compactions": compactions, "last_action": last_action,
    }

# ── Status detection ────────────────────────────────────────────────────

def _find_running_processes():
    """Find all running claude -p processes. Returns {variant: {pid, state, cputime}}."""
    result = {}
    try:
        ps_out = subprocess.check_output(
            ["ps", "-ww", "-eo", "pid,state,cputime,args"], text=True
        )
        for line in ps_out.strip().split("\n")[1:]:
            parts = line.strip().split(None, 3)
            if len(parts) < 4:
                continue
            pid, state, cputime, args = parts
            if "claude -p" not in args:
                continue
            m = re.search(r'plan-([A-Za-z0-9_-]+)\.(?:md|log)', args)
            if m:
                result[m.group(1)] = {"pid": int(pid), "state": state, "cputime": cputime}
            elif "merge" in args.lower() and ("merged plan" in args or "comparison table" in args):
                result["merge"] = {"pid": int(pid), "state": state, "cputime": cputime}
    except Exception:
        pass
    return result

# Call once at start — shared by all detect_status calls
_running_procs = _find_running_processes()

def _state_colored(state):
    """Color process state: green=running, cyan=sleeping, red=stopped/zombie."""
    if not state:
        return colored(DASH, C.DIM)
    s0 = state[0]
    if s0 == "R":
        return colored(state, C.GREEN)
    elif s0 in ("S", "I"):
        return colored(state, C.CYAN)
    elif s0 in ("T", "Z", "U"):
        return colored(state, C.RED + C.BOLD)
    return colored(state, C.YELLOW)

def detect_status(log_path, output_path, variant_key, min_output=1000):
    """Detect status and process info: (status, proc_info|None)."""
    if not os.path.exists(log_path):
        return "not started", None

    log_mtime = os.path.getmtime(log_path)
    is_recent = (time.time() - log_mtime) < 120

    proc = _running_procs.get(variant_key)

    if proc or is_recent:
        if output_path and os.path.exists(output_path):
            out_size = os.path.getsize(output_path)
            if out_size >= min_output:
                return "done", proc
        return "running", proc

    if output_path and os.path.exists(output_path):
        out_size = os.path.getsize(output_path)
        if out_size >= min_output:
            return "done", None
        return "failed", None

    return "failed", None

def _find_agents_from_jsonl(session_id):
    """Look up JSONL transcript by session_id, extract agent running/total counts."""
    if not session_id:
        return 0, 0
    pattern = os.path.expanduser(f"~/.claude/projects/*/{session_id}*.jsonl")
    paths = glob.glob(pattern)
    if not paths:
        return 0, 0
    jsonl_path = paths[0]
    agent_last_seen = {}
    try:
        fsize = os.path.getsize(jsonl_path)
        with open(jsonl_path, "r") as f:
            f.seek(max(0, fsize - 200_000))
            for raw in f:
                try:
                    d = json.loads(raw)
                    aid = d.get("agentId")
                    if aid and d.get("isSidechain"):
                        ts = d.get("timestamp", "")
                        if ts > agent_last_seen.get(aid, ""):
                            agent_last_seen[aid] = ts
                except (json.JSONDecodeError, ValueError):
                    pass
    except Exception:
        pass
    agents_total = len(agent_last_seen)
    agents_running = 0
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    for ts in agent_last_seen.values():
        try:
            last = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if (now_utc - last).total_seconds() < 120:
                agents_running += 1
        except Exception:
            pass
    return agents_running, agents_total

SNAPSHOT = "/tmp/claude-monitor-summary-sizes.json"

def _load_snapshot():
    try:
        with open(SNAPSHOT) as f:
            return json.load(f)
    except Exception:
        return {}

def _save_snapshot(sizes):
    try:
        with open(SNAPSHOT, "w") as f:
            json.dump(sizes, f)
    except Exception:
        pass

_prev_sizes = _load_snapshot()
_new_sizes = {}

def _activity_str(key, current_size):
    """Track activity: new/growing/idle based on size snapshot."""
    _new_sizes[key] = current_size
    prev = _prev_sizes.get(key, 0)
    if prev == 0:
        return colored("new", C.CYAN)
    elif current_size > prev:
        delta = current_size - prev
        return colored(f"+{human_size(delta)}", C.GREEN)
    elif current_size == prev and current_size > 0:
        return colored("idle", C.YELLOW)
    return colored(DASH, C.DIM)

# ── Scan run directory ──────────────────────────────────────────────────

# GENERATE stage
gen_variants = []
for log_path in sorted(glob.glob(os.path.join(run_dir, "plan-*.log"))):
    fname = os.path.basename(log_path)
    variant = fname[5:-4]  # plan-{variant}.log
    md_path = os.path.join(run_dir, f"plan-{variant}.md")
    parsed = parse_stream_json(log_path)
    status, proc = detect_status(log_path, md_path, variant, min_output=5000)
    md_exists, md_size = file_info(md_path)
    # Agent tracking via JSONL transcript
    full_sid = ""
    if parsed and parsed.get("session_id"):
        full_sid = parsed["session_id"]
    agents_r, agents_t = _find_agents_from_jsonl(full_sid)
    gen_variants.append({
        "variant": variant, "status": status, "proc": proc,
        "log": parsed, "md_size": md_size if md_exists else 0,
        "agents_running": agents_r, "agents_total": agents_t,
    })

# EVALUATE stage
eval_md_exists, eval_md_size = file_info(os.path.join(run_dir, "evaluation.md"))
eval_json_exists, eval_json_size = file_info(os.path.join(run_dir, "evaluation.json"))

# MERGE stage
merge_log_path = os.path.join(run_dir, "merge.log")
merge_md_path = os.path.join(run_dir, "merged-plan.md")
merge_parsed = parse_stream_json(merge_log_path) if os.path.exists(merge_log_path) else None
merge_status, merge_proc = detect_status(merge_log_path, merge_md_path, "merge")
merge_md_exists, merge_md_size = file_info(merge_md_path)
if merge_status == "running":
    any_running = True
merge_agents_r, merge_agents_t = 0, 0
if merge_parsed and merge_parsed.get("session_id"):
    merge_agents_r, merge_agents_t = _find_agents_from_jsonl(merge_parsed["session_id"])

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

def _render_detail_rows(log, md_size):
    """Print detail rows (row 2: files+breakdown, row 3: last action)."""
    if not log:
        return
    parts = []
    parts.append(f"Log: {human_size(log['size'])}")
    if md_size > 0:
        parts.append(f"Plan: {human_size(md_size)}")
    if log["breakdown"] != "none":
        parts.append(log["breakdown"][:40])
    print(f"  {C.DIM}{'':>18} {' '.join(parts)}{C.RESET}")
    if log.get("last_action"):
        print(f"  {C.DIM}{'':>18} \u2514\u2500 {log['last_action'][:60]}{C.RESET}")

def _ctx_str(log):
    """Format context size with percentage and color."""
    ctx = log.get("context_size", 0) if log else 0
    if ctx <= 0:
        return colored("\u2014", C.DIM)
    pct = int(ctx / 2000)  # percentage of 200K
    s = f"{human_tokens(ctx)} {pct}%"
    if ctx > 160_000:
        return colored(s, C.RED)
    elif ctx > 100_000:
        return colored(s, C.YELLOW)
    return colored(s, C.DIM)

def _compact_str(log):
    """Format compaction count."""
    n = log.get("compactions", 0) if log else 0
    if n > 0:
        return colored(str(n), C.RED)
    return colored("\u2014", C.DIM)

# -- GENERATE --
gen_count = len(gen_variants)
gen_done = sum(1 for v in gen_variants if v["status"] == "done")
gen_running = sum(1 for v in gen_variants if v["status"] == "running")
if gen_running > 0:
    any_running = True
print()
label = f"GENERATE ({gen_count} variant{'s' if gen_count != 1 else ''})"
print(f"{C.BOLD}{HR}{HR} {label} {HR * max(1, 62 - len(label))}{C.RESET}")
if gen_variants:
    print(f"  {'Variant':<18} {'Status':<12} {'State':>5} {'PID':>7} {'CPU':>8}"
          f" {'Session':>10} {'Turns':>5} {'Tools':>5} {'Agents':>6}"
          f" {'Input':>6} {'Output':>6} {'Cache+':>7} {f'Cache{ARROW}':>7} {'Total':>7}"
          f" {'Ctx':>8} {'C#':>3} {'Activity':>8}")
    for v in gen_variants:
        log = v["log"]
        proc = v["proc"]
        turns = str(log["turns"]) if log else DASH
        tools = str(log["tools"]) if log else DASH
        st = status_colored(v["status"])
        state_s = _state_colored(proc["state"]) if proc else colored(DASH, C.DIM)
        pid_s = str(proc["pid"]) if proc else DASH
        cpu_s = proc["cputime"] if proc else DASH
        sid = log["session_id"] if log and log.get("session_id") else DASH
        ar, at = v["agents_running"], v["agents_total"]
        agents_s = f"{ar}/{at}" if at > 0 else DASH
        t_in = human_tokens(log["input_tokens"]) if log and log["input_tokens"] else DASH
        t_out = human_tokens(log["output_tokens"]) if log and log["output_tokens"] else DASH
        t_cc = human_tokens(log["cache_create"]) if log and log["cache_create"] else DASH
        t_cr = human_tokens(log["cache_read"]) if log and log["cache_read"] else DASH
        t_tot = human_tokens(log["total_tokens"]) if log and log["total_tokens"] else DASH
        ctx = _ctx_str(log)
        comp = _compact_str(log)
        log_size = log["size"] if log else 0
        activity = _activity_str(v["variant"], log_size)
        print(f"  {v['variant']:<18} {pad(st, 12, '<')} {pad(state_s, 5)} {pid_s:>7} {cpu_s:>8}"
              f" {sid:>10} {turns:>5} {tools:>5} {agents_s:>6}"
              f" {t_in:>6} {t_out:>6} {t_cc:>7} {t_cr:>7} {t_tot:>7}"
              f" {pad(ctx, 8)} {pad(comp, 3)} {pad(activity, 8)}")
        _render_detail_rows(log, v["md_size"])
else:
    print(f"  {C.DIM}No plan logs found{C.RESET}")

# -- EVALUATE --
print()
print(f"{C.BOLD}{HR}{HR} EVALUATE {HR * 53}{C.RESET}")
if eval_md_exists:
    print(f"  evaluation.md     {human_size(eval_md_size):>8}   {status_colored('done')}")
else:
    print(f"  evaluation.md     {DASH:>8}   {status_colored('not run')}")
if eval_json_exists:
    print(f"  evaluation.json   {human_size(eval_json_size):>8}   {status_colored('done')}")

# -- MERGE --
print()
print(f"{C.BOLD}{HR}{HR} MERGE {HR * 56}{C.RESET}")
if merge_parsed:
    print(f"  {'Status':<12} {'State':>5} {'PID':>7} {'CPU':>8}"
          f" {'Session':>10} {'Turns':>5} {'Tools':>5} {'Agents':>6}"
          f" {'Input':>6} {'Output':>6} {'Cache+':>7} {f'Cache{ARROW}':>7} {'Total':>7}"
          f" {'Ctx':>8} {'C#':>3} {'Activity':>8}")
    st = status_colored(merge_status)
    state_s = _state_colored(merge_proc["state"]) if merge_proc else colored(DASH, C.DIM)
    pid_s = str(merge_proc["pid"]) if merge_proc else DASH
    cpu_s = merge_proc["cputime"] if merge_proc else DASH
    sid = merge_parsed["session_id"] if merge_parsed.get("session_id") else DASH
    mar, mat = merge_agents_r, merge_agents_t
    agents_s = f"{mar}/{mat}" if mat > 0 else DASH
    t_in = human_tokens(merge_parsed["input_tokens"]) if merge_parsed["input_tokens"] else DASH
    t_out = human_tokens(merge_parsed["output_tokens"]) if merge_parsed["output_tokens"] else DASH
    t_cc = human_tokens(merge_parsed["cache_create"]) if merge_parsed["cache_create"] else DASH
    t_cr = human_tokens(merge_parsed["cache_read"]) if merge_parsed["cache_read"] else DASH
    t_tot = human_tokens(merge_parsed["total_tokens"]) if merge_parsed["total_tokens"] else DASH
    ctx = _ctx_str(merge_parsed)
    comp = _compact_str(merge_parsed)
    m_log_size = merge_parsed["size"] if merge_parsed else 0
    m_activity = _activity_str("merge", m_log_size)
    print(f"  {pad(st, 12, '<')} {pad(state_s, 5)} {pid_s:>7} {cpu_s:>8}"
          f" {sid:>10} {merge_parsed['turns']:>5} {merge_parsed['tools']:>5} {agents_s:>6}"
          f" {t_in:>6} {t_out:>6} {t_cc:>7} {t_cr:>7} {t_tot:>7}"
          f" {pad(ctx, 8)} {pad(comp, 3)} {pad(m_activity, 8)}")
    _render_detail_rows(merge_parsed, merge_md_size if merge_md_exists else 0)
elif merge_status == "not started":
    print(f"  {status_colored('not started')}")
else:
    print(f"  {status_colored(merge_status)}")

# -- VERIFY --
print()
print(f"{C.BOLD}{HR}{HR} VERIFY {HR * 55}{C.RESET}")
if report_exists:
    print(f"  verification-report.md   {human_size(report_size):>8}   {status_colored('done')}")
else:
    print(f"  verification-report.md   {DASH:>8}   {status_colored('not run')}")
if premortem_exists:
    print(f"  pre-mortem.md            {human_size(premortem_size):>8}   {status_colored('done')}")
else:
    print(f"  pre-mortem.md            {DASH:>8}   {status_colored('not run')}")

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

# Aggregate token totals
all_logs = [v["log"] for v in gen_variants if v["log"]]
if merge_parsed:
    all_logs.append(merge_parsed)
tot_input = sum(l["input_tokens"] for l in all_logs)
tot_output = sum(l["output_tokens"] for l in all_logs)
tot_cc = sum(l["cache_create"] for l in all_logs)
tot_cr = sum(l["cache_read"] for l in all_logs)
tot_all = tot_input + tot_output + tot_cc + tot_cr

print()
print(f"{C.BOLD}{HR}{HR} Totals {HR * 55}{C.RESET}")
status_label = colored("running", C.CYAN) if any_running else (
    colored("complete", C.GREEN) if stages_done == 4 else colored("incomplete", C.YELLOW)
)
print(f"  Status: {status_label} \u2014 {stages_done}/4 stages done")
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
if tot_all > 0:
    print(f"  Tokens: {human_tokens(tot_input)} input, {human_tokens(tot_output)} output,"
          f" {human_tokens(tot_cc)} cache+, {human_tokens(tot_cr)} cache\u2192"
          f" ({human_tokens(tot_all)} total)")

_save_snapshot(_new_sizes)

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
