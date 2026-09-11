---
project: officecli
tags: [claude-mem, runtime, worker, troubleshooting]
---

# claude-mem runtime facts

## Worker port resolution

Every claude-mem client resolves the local worker port in the same order, and
diverging from it means silently talking to nothing:

1. `CLAUDE_MEM_WORKER_PORT` from the environment
2. `CLAUDE_MEM_WORKER_PORT` in `~/.claude-mem/settings.json`
3. fallback `37700 + (uid % 100)`

The fallback matters on Windows: `process.getuid` does not exist there, so
claude-mem substitutes uid 77, giving **port 37777**. On Linux and macOS the
port varies per user. Hard-coding 37700 works only for uid 0.

The worker binds loopback. `http://127.0.0.1:<port>/health` answering is the
cheapest proof it is alive.

## Worker HTTP surface has no authentication

The worker's HTTP API has no request authentication at all; its only defence is
the loopback bind. That is why `POST /api/memory/save` works from a local script
with no token, and it is also why nothing should ever point it at a non-loopback
host casually.

There is one exception: when an operator opens the bind with
`CLAUDE_MEM_WORKER_HOST` so a phone or spare monitor can watch Observation TV,
a remote guard default-denies every non-loopback request except an exact-match
allowlist of four read-only paths (`/tv`, `/tv.html`, `/stream`,
`/api/observations`) behind a shared token. Mutations are never remotely
reachable.

## Routes worth knowing

- `GET /health` — liveness
- `GET /api/stats`, `GET /api/projects` — what is in the database
- `GET /api/search?query=...&project=...&limit=...` — unified search. The field
  is `query`, not `q`. Responses come back MCP-shaped:
  `{content:[{type:"text", text:...}]}`
- `POST /api/memory/save` — `{text, title?, project?, metadata?}`. Stores a
  manual observation of type `discovery`, subtitle "Manual memory", attaches it
  to a per-project manual session, and syncs it to Chroma for semantic search.
  Returns `{success, id, title, project}`
- `GET /api/context/inject` — what the SessionStart hook injects
- `POST /api/observations/batch` — a **read** (fetch observations by id), not an
  ingest route, despite the name
- `POST /api/corpus`, `/api/corpus/:name/prime|query|rebuild` — the corpus
  system for question-answering over a filtered slice of memory

## MCP tools, and which ones work locally

The `mcp-search` server exposes `search`, `timeline`, `get_observations`,
`get_tool_uses`, `session_start_context`, `smart_search`, `smart_unfold`,
`smart_outline`, and the corpus tools.

`observation_add` and `observation_record_event` are **server-runtime only** —
they call `/v1/memories` and `/v1/events` on a server-beta install. On a normal
desktop install they are not a way to write memory; use the worker's
`POST /api/memory/save` instead.

## Retrieval discipline

Search returns an index of IDs and titles at roughly 50-100 tokens per result;
`get_observations` fetches full detail. Always filter on the index before
fetching detail — pulling full detail for every hit costs about 10x more tokens
for the same answer. Several claude-mem skills state this rule; it applies to
deck work too.

## Where memory attaches to an agent

`src/cli/adapters/` holds one adapter per host — `claude-code`, `codex`,
`cursor`, `windsurf`, `antigravity-cli`, and `raw` as the permissive default.
Each normalizes that host's hook payload into a common shape
(`sessionId`, `cwd`, `prompt`, `toolName`, `toolInput`, `toolResponse`,
`transcriptPath`). Hooks invoke
`node scripts/bun-runner.js scripts/worker-service.cjs hook <platform> <event>`,
where event is one of `context`, `session-init`, `observation`, `file-context`,
`summarize`.

Adding a genuinely new agent host means adding an adapter there. A host that is
*driven by* Claude Code — as OfficeCLI is — needs no new adapter, because the
`claude-code` adapter already sees the whole session.
