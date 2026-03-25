<div align="center">

```
 ████████╗███████╗ █████╗ ███╗   ███╗███╗   ███╗██╗███╗   ██╗██████╗
    ██╔══╝██╔════╝██╔══██╗████╗ ████║████╗ ████║██║████╗  ██║██╔══██╗
    ██║   █████╗  ███████║██╔████╔██║██╔████╔██║██║██╔██╗ ██║██║  ██║
    ██║   ██╔══╝  ██╔══██║██║╚██╔╝██║██║╚██╔╝██║██║██║╚██╗██║██║  ██║
    ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║ ╚═╝ ██║██║██║ ╚████║██████╔╝
    ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝
```

**Git-aware persistent memory for Claude Code teams**

[![npm version](https://img.shields.io/npm/v/teammind?color=blue&style=flat-square)](https://npmjs.com/package/teammind)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-purple?style=flat-square)](https://claude.ai/code)

*Every insight your team discovers with Claude Code — remembered forever.*

</div>

---

## Install

**One command. 30 seconds.**

```bash
npm install -g teammind
```

```
✓ Claude Code detected (v2.1.59)
✓ Hooks installed in ~/.claude/settings.json
✓ MCP server registered
✓ Embedding model ready (38MB, runs locally)
✓ Database created at ~/.teammind/db.sqlite

TeamMind is active. Just use Claude Code normally.
```

That's it. No API key required for the core feature. No server to run. No config to write.

> **Optional:** Set `ANTHROPIC_API_KEY` to enable automatic memory extraction at session end (~$0.001/session). Without it, you can still add memories manually via Claude during sessions.

---

## The problem

Claude Code is stateless. Every session starts from scratch.

Alice spends 3 hours debugging a race condition, finds the root cause, and fixes it. The next morning, Bob runs into the exact same bug and his Claude knows nothing about it. The senior dev who understands why the auth middleware skips OPTIONS requests goes on vacation. The codebase is full of small, undocumented gotchas that only live in old chats.

TeamMind solves this. It quietly captures what your team learns during Claude Code sessions and makes that knowledge available to every developer’s Claude automatically, all the time.

---

## How it works

```
YOUR SESSION                         BACKGROUND
──────────────────                   ──────────────────────────────────
You open Claude Code
        │
        ▼
SessionStart hook fires
TeamMind injects team
context into Claude's
initial prompt
  ┌─────────────────────┐
  │ [gotcha] Auth skips │
  │ OPTIONS for CORS    │
  │ [bug] Prisma times  │
  │ out at 5s on large  │
  │ checkouts           │
  └─────────────────────┘

Claude already knows
before you type a word
        │
        ▼
Mid-session: Claude calls
memory_search / memory_add
as it encounters files
        │                             SESSION ENDS
        ▼                                    │
You close Claude Code ──────────────────────►│
                                             ▼
                                      Stop hook fires
                                      Transcript saved to DB
                                             │
                                             ▼ (fully detached)
                                      claude-haiku-4-5 reads
                                      the transcript, extracts
                                      high-value memories
                                             │
                                             ▼
                                      Memories embedded locally
                                      Stored with git metadata
                                      File hashes saved for
                                      staleness detection
```

---

## Features

| | |
|---|---|
| **Silent operation** | Injects memory context before your first prompt. Captures learnings after your last. You never see it working. |
| **Git-aware** | Memories are tagged with branch and commit. Files referenced by a memory are hashed — when those files change, the memory is marked stale automatically. |
| **Zero native deps** | Uses Node.js built-in `node:sqlite`. No compilation, no Visual Studio, no Python. Works on Mac, Linux, and Windows out of the box. |
| **Local-first** | Embeddings run in-process. Your code never leaves your machine unless you explicitly choose cloud sync. |
| **Team sync** | Export memories to a JSON file, commit it to your repo, teammates import on `git pull`. |
| **MCP tools** | Claude can search, add, and check memory freshness mid-session via 4 MCP tools. |

---

## CLI Reference

```bash
# Setup
npm install -g teammind #install
npx teammind init              # one-time setup — patches Claude Code settings

# Daily use
teammind status                # memory stats for the current project
teammind memories              # browse all memories
teammind memories "auth"       # search memories by keyword
teammind sessions              # see captured sessions (processed / pending)
teammind forget <id>           # delete a specific memory
teammind forget --stale        # bulk-delete all stale memories

# Extraction
teammind extract --pending     # manually trigger extraction for pending sessions
teammind config set ANTHROPIC_API_KEY sk-...   # set API key for auto-extraction

# Team sync
teammind team                  # interactive team setup wizard
teammind team --export ./path  # export memories to JSON
teammind team --import ./path  # import memories from JSON
```

---

## What gets remembered

TeamMind uses `claude-haiku-4-5` to read your session transcript and extract only memories worth keeping:

| Captured | Not captured |
|---|---|
| Bugs found and their root cause | Generic programming advice |
| Architectural decisions and *why* | Things obvious from reading the code |
| Non-obvious gotchas | Temporary debugging steps |
| API quirks and workarounds | Standard library usage |
| Performance findings | Basic code explanations |
| Security considerations | |
| Important config constraints | |

Each memory is stored with:
- The files it relates to (for staleness detection)
- The git commit and branch it was discovered on
- Who discovered it
- A semantic embedding (for smart retrieval)

---

## Team Sync

### Option 1: Git (recommended)

```bash
# On your machine
teammind team --export .claude/team-memories.json
git add .claude/team-memories.json
git commit -m "chore: add team memories"
git push

# On your teammate's machine
git pull
teammind team --import .claude/team-memories.json
```

Auto-import on every `git pull` with a post-merge hook:
```bash
echo 'teammind team --import .claude/team-memories.json' >> .git/hooks/post-merge
chmod +x .git/hooks/post-merge
```

### Option 2: Self-hosted sync *(coming soon)*

Run a sync server on your own infra. All team members point to it.

### Option 3: TeamMind Cloud *(coming soon)*

Hosted sync, free for teams under 5.

---

## Configuration

```bash
# Set your Anthropic API key (enables auto-extraction)
teammind config set ANTHROPIC_API_KEY sk-ant-...

# View all config
teammind config list

# Adjust injection (default: 10 memories per session start)
teammind config set max_inject 15

# Disable auto-extraction (manual memory_add only)
teammind config set extraction_enabled false
```

Config is stored at `~/.teammind/config.json`.

---

## Memory lifecycle

```
Session ends
    │
    ▼
Transcript saved to ~/.teammind/db.sqlite
    │
    ▼ (background process, ~5 seconds)
Haiku reads transcript
Extracts 0–10 high-value memories
    │
    ▼
Each memory is:
  • Embedded locally (all-MiniLM-L6-v2, 384 dims)
  • Tagged with file paths + function names
  • Hashed against current file contents
  • Stored with git metadata
    │
    ▼
Next session start:
  Top 10 memories injected into Claude's context
  File hashes checked → stale memories flagged
  Claude calls memory_search as needed
```

---

## What Claude sees

At the start of every session on a project with memories:

```xml
<team_memory project="myapp" branch="feature/payments">
1. [gotcha] Stripe webhook must receive raw Buffer body before constructEvent() — src/webhooks/stripe.ts
2. [decision] Using idempotency keys on all payment intents — decided after double-charge incident Jan 2026
3. [bug] Prisma transaction timeout at 5s hits on large cart checkouts — src/db/checkout.ts
4. [pattern] All currency stored as integers (cents), never floats
5. [config] TEST_MODE=true bypasses Stripe in dev, but still hits real webhooks endpoint
</team_memory>
(5 of 31 memories — use memory_search tool for more)
```

Claude reads this before you type a word. It uses `memory_search` mid-session to pull deeper context when it needs it.

---

## Privacy

- **Your code never leaves your machine** unless you explicitly use team export or cloud sync
- **Embeddings run locally** using `@huggingface/transformers` — no API calls for search
- **Extraction uses Haiku** at session end (if `ANTHROPIC_API_KEY` is set) — only the conversation transcript is sent, not your code
- **Team export** scans for secrets before writing (API keys, tokens, passwords are redacted)
- **Self-hostable** — run everything on your own infra if needed

---

## How it hooks into Claude Code

TeamMind adds two hooks and one MCP server to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node ... inject" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "node ... capture" }] }]
  },
  "mcpServers": {
    "teammind": { "type": "stdio", "command": "node", "args": ["...", "server"] }
  }
}
```

**SessionStart** runs before your first prompt and prints team memories to stdout — Claude Code injects this as context.

**Stop** fires when Claude finishes. It saves the transcript and spawns a detached background process for extraction. You feel zero latency.

**MCP server** gives Claude 4 tools: `memory_search`, `memory_add`, `memory_list`, `memory_stale`.

---

## MCP Tools

Claude has these tools available mid-session:

#### `memory_search`
```
Search team memory for relevant context about code, bugs, decisions, or patterns.
Parameters: query (string), file_path? (string), limit? (number)
```

#### `memory_add`
```
Save an important insight, decision, bug fix, or pattern to team memory.
Parameters: content (string), summary (string), tags? (string[]), file_paths? (string[]), functions? (string[])
```

#### `memory_list`
```
List recent memories for the current project.
Parameters: limit? (number)
```

#### `memory_stale`
```
Check which memories may be outdated because their referenced files changed.
Parameters: (none)
```

---

## Staleness detection

When TeamMind saves a memory that references a file, it stores a SHA-256 hash of that file at that moment.

Every session start, it re-hashes all referenced files and compares. If a file changed:
- The memory is marked `stale`
- It still injects with a `[may be outdated]` tag
- It's deprioritized in ranking
- `teammind forget --stale` clears them in bulk

This means memories about refactored code don't silently mislead future sessions.

---

## Requirements

- Node.js ≥ 18.0.0
- Claude Code (any version with hooks support)
- Git (for git-aware features)
- `ANTHROPIC_API_KEY` (optional — only for auto-extraction)

---

## License

MIT — use it, fork it, build on it.

---

<div align="center">

Built for teams who use Claude Code seriously.

[npm](https://npmjs.com/package/teammind) · [Issues](https://github.com/yourusername/teammind/issues)

</div>
