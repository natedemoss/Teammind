<div align="center">

```
 ████████╗███████╗ █████╗ ███╗   ███╗███╗   ███╗██╗███╗   ██╗██████╗
    ██╔══╝██╔════╝██╔══██╗████╗ ████║████╗ ████║██║████╗  ██║██╔══██╗
    ██║   █████╗  ███████║██╔████╔██║██╔████╔██║██║██╔██╗ ██║██║  ██║
    ██║   ██╔══╝  ██╔══██║██║╚██╔╝██║██║╚██╔╝██║██║██║╚██╗██║██║  ██║
    ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║ ╚═╝ ██║██║██║ ╚████║██████╔╝
    ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝
```

**Git-aware persistent memory for Claude Code teams — and a personal AI that learns how you work**

[![npm version](https://img.shields.io/npm/v/teammind?color=blue&style=flat-square)](https://npmjs.com/package/teammind)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Users](https://img.shields.io/badge/Users:%20713-purple?style=flat-square)](https://www.npmjs.com/package/teammind)
[![No API key](https://img.shields.io/badge/API%20key-not%20required-brightgreen?style=flat-square)](#)

*Every insight your team discovers — remembered forever. Every preference you have — written to CLAUDE.md automatically.*

</div>

---

## Two things TeamMind does

**1. Team memory** — captures what your team learns with Claude Code and shares it across every developer's sessions automatically.

**2. Personal persona** — watches how you interact with Claude Code, figures out your preferences, and writes them directly to `~/.claude/CLAUDE.md`. Claude reads that file in every project, so it adapts to how you work without you ever having to explain yourself again.

---

## The problem

Claude Code is stateless. Every session starts fresh.

Alice spends 3 hours debugging a race condition, finds the root cause, fixes it. Bob hits the exact same bug the next morning — his Claude has no idea what Alice learned. The senior dev who knows why the auth middleware skips OPTIONS requests goes on vacation. The codebase has 40 undocumented gotchas that only exist in old Slack threads.

**TeamMind fixes this.** It silently captures what your team learns and makes that knowledge available to every developer's Claude — automatically, from the first prompt.

---

## Get started in 30 seconds

```bash
npm install -g teammind
teammind init
```

That's it. No API key. No config. No server to run.

```
✓ Hooks installed in ~/.claude/settings.json
✓ MCP server registered
✓ Embedding model ready (38MB, runs locally)
✓ Database created at ~/.teammind/db.sqlite

TeamMind is active. Just use Claude Code normally.
```

> **Already have it?** Update with `npm install -g teammind@latest`

---

## How it works

Open Claude Code → TeamMind silently injects relevant memories into Claude's context before you type a word. Close Claude Code → TeamMind scans the transcript in the background and saves anything worth remembering.

```
┌─ SESSION START ──────────────────────────────────────────────┐
│                                                               │
│  Claude receives your team's memories automatically:         │
│                                                               │
│  <team_memory project="myapp" branch="main">                 │
│  1. [gotcha] Stripe webhook needs raw Buffer before           │
│     constructEvent() — src/webhooks/stripe.ts                │
│  2. [bug] Prisma timeout at 5s on large checkouts            │
│  3. [decision] Idempotency keys on all payment intents       │
│  </team_memory>                                              │
│                                                               │
└───────────────────────────────────────────────────────────────┘
         Claude already knows this before you say anything.

┌─ SESSION END (background, ~1 second) ────────────────────────┐
│                                                               │
│  TeamMind scans assistant turns for high-value signals:      │
│  "the reason we..." / "note that..." / "fixed by..."         │
│                                                               │
│  Extracts → embeds locally → deduplicates → stores           │
│  with git metadata and file hashes for staleness detection   │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## Personal persona — writes to your CLAUDE.md

TeamMind watches your sessions for signals about how you prefer to work with Claude — things like "be more concise", "just do it", "show me the code first", "stop summarizing". It aggregates these across sessions and writes them directly to `~/.claude/CLAUDE.md`.

Since `~/.claude/CLAUDE.md` is the global instructions file that Claude Code reads at the start of **every** session in **every** project, your preferences travel with you automatically — no setup per project, no repeating yourself.

```
~/.claude/CLAUDE.md

<!-- teammind-persona:start -->

## User Interaction Preferences

- Keep responses concise — avoid lengthy explanations
- Take action directly — do not ask for confirmation on straightforward tasks
- Show code directly rather than describing it first

<!-- teammind-persona:end -->
```

TeamMind only touches the section between its markers — everything else in your CLAUDE.md stays exactly as it is.

```bash
teammind persona              # see your current preferences
teammind persona --update     # re-analyze sessions and rewrite to CLAUDE.md
teammind persona --reset      # remove the section from CLAUDE.md
```

**What it detects:** response length, explanation style, code-first vs description-first, confirmation prompts, formatting preferences, summary behavior.

**What it never touches:** how Claude writes code, architectural choices, language/framework preferences — those belong in your project's CLAUDE.md, not here.

---

## Daily commands

```bash
# See what TeamMind knows about your current project
teammind status

# Browse all memories
teammind memories

# Search memories
teammind memories "stripe webhook"

# Filter by type
teammind memories --tag bug
teammind memories --tag decision
teammind memories --tag gotcha

# Read a memory in full
teammind memory <id>

# Delete a memory
teammind forget <id>
teammind forget --stale        # clear outdated memories
teammind forget --all          # wipe everything for this project
```

```bash
# Build / update your personal preferences in CLAUDE.md
teammind persona
teammind persona --update
```

**`teammind status` shows a live breakdown:**
```
TeamMind — myapp
────────────────────────────────────────
  31 fresh memories  •  2 stale  •  last captured today

  By type:
    bug          ██████████ 12
    decision     ███████ 8
    gotcha       █████ 6
    security     ████ 5
    config       ██ 3

  Recent:
  • [gotcha] Stripe webhook must receive raw Buffer before constructEvent()  — today
  • [bug] Prisma transaction timeout at 5s on large cart checkouts  — today
  • [decision] Switched to idempotency keys after double-charge incident  — 2d ago
```

---

## Sharing with your team

Export your memories to a file and commit it:

```bash
# Export
teammind team --export .claude/team-memories.json
git add .claude/team-memories.json && git commit -m "chore: team memories" && git push

# Import (your teammates run this after pulling)
teammind team --import .claude/team-memories.json
```

Auto-import every time someone pulls:
```bash
echo 'teammind team --import .claude/team-memories.json' >> .git/hooks/post-merge
chmod +x .git/hooks/post-merge
```

---

## What gets captured

TeamMind scans assistant turns for signal language — no API call, no cost:

| Captured | Skipped |
|---|---|
| Root causes of bugs | Generic programming advice |
| Architectural decisions and *why* | Obvious things from reading the code |
| Non-obvious gotchas | Temporary debugging that was reverted |
| API quirks and workarounds | Standard library usage |
| Security considerations | Basic code explanations |
| Performance findings | |
| Config constraints | |

It looks for causal reasoning (`"instead of X because Y"`), gotcha markers (`"note that"`, `"watch out"`), bug/fix patterns, and decision language — the same things you'd write in a code review comment.

Memory types: `bug` · `decision` · `gotcha` · `security` · `performance` · `config` · `api` · `pattern`

---

## MCP tools (mid-session)

Claude can call these tools during a session without you asking:

| Tool | What it does |
|---|---|
| `memory_search` | Semantic search across team memories |
| `memory_add` | Save a new insight manually |
| `memory_list` | List recent memories for this project |
| `memory_stale` | Check which memories may be outdated |

---

## Staleness detection

When a memory references a file, TeamMind stores a hash of that file. On every session start it re-hashes and compares. If a file changed, the memory gets flagged:

```
• [gotcha] ⚠ STALE  Auth middleware skips OPTIONS for CORS
```

It still injects but warns Claude not to rely on it. `teammind forget --stale` clears them all.

---

## Configuration

```bash
teammind config list                          # show current config
teammind config set max_inject 15             # inject more memories per session (default: 10)
teammind config set extraction_enabled false  # disable auto-extraction
teammind config set similarity_threshold 0.85 # dedup sensitivity (default: 0.88)
```

---

## Sessions

```bash
teammind sessions              # see all captured sessions
teammind extract --pending     # manually process any unextracted sessions
```

If TeamMind is running but you're not seeing memories yet, run `teammind extract --pending` — it processes any sessions that haven't been extracted yet.

---

## How it hooks into Claude Code

TeamMind patches `~/.claude/settings.json` during `init`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node ~/.teammind/hooks/session-start.js" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "node ~/.teammind/hooks/session-stop.js"  }] }]
  },
  "mcpServers": {
    "teammind": { "type": "stdio", "command": "node", "args": ["...", "server"] }
  }
}
```

- **SessionStart** — prints memories to stdout, Claude Code injects them as context
- **Stop** — saves the transcript, spawns a detached background worker (you feel zero latency)
- **MCP server** — gives Claude the 4 tools above during sessions

---

## Privacy

- **No code leaves your machine** — extraction is entirely local, zero network requests
- **Embeddings run locally** via `@huggingface/transformers`
- **No telemetry** of any kind
- **Secrets are redacted** before team export (API keys, tokens, passwords)

---

## Requirements

- Node.js ≥ 18.0.0
- Claude Code (any version with hooks support)
- Git (optional — for branch/commit metadata)

No API key. No cloud account. No native compilation. Works on Mac, Linux, and Windows.

---

## License

MIT

---

<div align="center">

[npm](https://npmjs.com/package/teammind) · [Issues](https://github.com/natedemoss/Teammind/issues)

</div>
