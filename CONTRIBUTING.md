# Contributing to TeamMind

Thanks for your interest. TeamMind is a small project and contributions are welcome — bug fixes, new features, and docs improvements alike.

---

## Getting started

```bash
git clone https://github.com/natedemoss/Teammind.git
cd Teammind
npm install
npm run build
```

To test your changes against a real Claude Code setup:

```bash
npm run build
node dist/cli.js <command>
```

---

## Project structure

```
src/
├── cli.ts        # All CLI commands (start here)
├── extract.ts    # Heuristic memory extraction from transcripts
├── persona.ts    # Persona extraction + CLAUDE.md read/write
├── db.ts         # SQLite schema and all database helpers
├── embed.ts      # Local embedding model (HuggingFace)
├── search.ts     # Memory ranking, semantic search, dedup
├── staleness.ts  # File hash-based staleness detection
├── sync.ts       # Team export/import
├── server.ts     # MCP server (memory_search, memory_add, etc.)
├── config.ts     # Config file helpers
└── constants.ts  # Paths, model name, version
```

The best place to start is `src/cli.ts` — every command is defined there and calls helpers from the other files.

---

## Open issues

These are good starting points:

| Issue | Difficulty |
|---|---|
| [#2 — `teammind remember` CLI command](https://github.com/natedemoss/Teammind/issues/2) | Easy |
| [#3 — Import memories from git history](https://github.com/natedemoss/Teammind/issues/3) | Medium |
| [#4 — Auto-refresh persona every N sessions](https://github.com/natedemoss/Teammind/issues/4) | Medium |

---

## Making changes

1. Fork the repo and create a branch off `main`
2. Make your changes in `src/`
3. Run `npm run build` — fix any TypeScript errors before submitting
4. Test manually with `node dist/cli.js <command>`
5. Open a PR against `main`

Keep PRs focused — one feature or fix per PR makes review faster.

---

## A few things to know

**No API key required.** Memory extraction and embedding run entirely locally. Don't add any feature that requires an external API call in the critical path (session start/stop hooks must never block or fail loudly).

**Silent failure is intentional.** The hooks wrap everything in try/catch and exit cleanly on error. Claude Code must never be broken by TeamMind. Keep this contract.

**The `dist/` folder is gitignored.** Don't commit build output.

**SQLite via `node:sqlite`.** This is a Node 22+ built-in. No native compilation, no `better-sqlite3`. Don't swap it out.

---

## Questions

Open an issue or reach out at ndemoss28@gmail.com.
