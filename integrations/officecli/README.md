# claude-mem ↔ OfficeCLI

Persistent memory for slide work: recall the template, brand rules, slide order
and client preferences that earlier sessions settled, instead of re-deriving or
re-asking them every time a deck starts.

## Why the integration lives here and not in OfficeCLI

OfficeCLI's plugin protocol (`plugins/plugin-protocol.md`) defines plugins as
short-lived sidecar processes that extend **file-format** support —
`dump-reader`, `exporter`, and a converter kind. They stream JSONL batch items
on stdout and exit. There is no session, no prompt, and no tool-use event in
that protocol, so there is nothing for a memory system to subscribe to: a
claude-mem "OfficeCLI plugin" is not expressible.

Memory therefore attaches one layer up, at the agent that drives OfficeCLI —
Claude Code — where claude-mem's existing `claude-code` adapter already captures
every `officecli` invocation as an ordinary tool use. No new adapter, no new
hook transport.

What actually needed building is the part that makes captured memory *useful for
decks*: seeding the project's memory, and a skill that makes recall-before-build
and record-after-build reliable rather than occasional.

## Install

POSIX:

```bash
./install.sh --target /path/to/OfficeCLI --project officecli
```

Windows PowerShell:

```powershell
.\install.ps1 -Target 'C:\path\to\OfficeCLI' -Project officecli
```

Both are thin launchers over `scripts/install.mjs`, which holds all the logic so
the two platforms cannot drift. The install is idempotent — re-running it is the
supported way to upgrade. It will:

1. install the `officecli-slides-memory` skill into
   `<target>/.claude/skills/`, substituting this machine's absolute integration
   path into the skill's commands
2. merge claude-mem's `mcp-search` server into `<target>/.mcp.json`, preserving
   any servers already configured there
3. import the context pack into the local memory database
4. run the end-to-end check

Requires Node ≥ 20.12 and a running claude-mem worker. Opening a Claude Code
session starts the worker; steps 1–2 work without it, and step 3 will tell you
to re-run it once the worker is up.

## Verify

```bash
node scripts/check.mjs --project officecli --target /path/to/OfficeCLI
```

Exit code 0 means a slide session in that project genuinely receives memory.
`PASS`/`FAIL` lines each name their own fix; `WARN` lines are advisory and do
not fail the run — `topical recall` in particular degrades when Chroma semantic
search is not configured, which is not a broken bridge.

The `imported context retrievable` check is the meaningful one: it searches for
the `OFFICECLI-MEMORY-BRIDGE` marker, which is carried in an observation
**title** rather than a body, because `/api/search` returns an index of IDs and
titles and only `get_observations` returns bodies.

## The pieces

| Path | What it is |
|---|---|
| `skills/officecli-slides-memory/SKILL.md` | The recall → build → record loop. The heart of the integration. |
| `scripts/mem-client.mjs` | Worker client. Resolves the port the same way claude-mem does. |
| `scripts/import-context.mjs` | Imports `context/*.md` as memories, split at `##` headings, with a ledger so re-runs are idempotent. |
| `scripts/remember.mjs` | Writes one memory. Used by the skill's record step. |
| `scripts/check.mjs` | End-to-end verification. |
| `scripts/install.mjs` | All installer logic. |
| `context/` | The committed context pack (mechanism only — see below). |
| `REPORTS/` | State reports from the machine-side session. |

## Public repo — what must not go in `context/`

`Kris-97/claude-mem-krisu` is a **public** fork. Everything under `context/` is
mechanism only: architecture, routes, conventions. No client names, deal
material, or business content.

Private context belongs in the private `Kris-97/kriskros` repo, under
`memory-context/`, and imports with the same tool:

```bash
node scripts/import-context.mjs --dir /path/to/kriskros/memory-context --project officecli
```

Both halves land in the same local database and are retrieved together, so the
split costs nothing at recall time — it only keeps the sensitive half off a
public remote.

## Two things worth knowing about the runtime

**Port.** The worker port is `CLAUDE_MEM_WORKER_PORT` (env), else the same key
in `~/.claude-mem/settings.json`, else `37700 + (uid % 100)`. On Windows
`process.getuid` does not exist, so claude-mem substitutes uid 77 — **port
37777**. Hard-coding 37700 only works for uid 0.

**Writing memory.** The MCP `observation_add` tool is server-runtime only (it
calls `/v1/memories` on a server-beta install) and is not a way to record
anything on a desktop install. The worker's `POST /api/memory/save` is, which is
why `remember.mjs` exists.
