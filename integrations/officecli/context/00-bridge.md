---
project: officecli
tags: [bridge, claude-mem, officecli, setup]
---

# claude-mem to OfficeCLI bridge

## OFFICECLI-MEMORY-BRIDGE: what this integration is

The marker in this heading exists so the bridge can prove itself:
`integrations/officecli/scripts/check.mjs` searches memory for it, and a hit
means the import pipeline reached the database and retrieval reads it back.

It has to be in the *heading*, not the body. `/api/search` returns an index of
IDs and titles — roughly 50-100 tokens per result — and only `get_observations`
returns bodies. A marker buried in the body would never appear in the index the
checker reads, and the check would fail on a perfectly healthy install.

The bridge connects claude-mem (persistent cross-session memory) to OfficeCLI
(the .docx/.xlsx/.pptx document toolchain) so that building slides starts from
what earlier sessions already decided — template, brand, slide order, figure
conventions, client preferences — instead of re-deriving or re-asking.

It lives in the claude-mem fork at `integrations/officecli/` and consists of:
a context importer, a memory writer, an end-to-end checker, installers for
Windows and POSIX, and the `officecli-slides-memory` skill that drives the
recall to build to record loop.

## Where memory attaches, and why not as an OfficeCLI plugin

OfficeCLI's plugin protocol (`plugins/plugin-protocol.md`) defines exactly three
plugin kinds — `dump-reader`, `exporter`, and a converter kind — all of which
exist to add file-format support. They are short-lived sidecar processes that
stream batch items on stdout. There is no session lifecycle, no tool-use event,
and no conversation in that protocol, so there is nothing for a memory system to
subscribe to. Writing claude-mem as an OfficeCLI plugin is not a thing the
protocol can express.

Memory therefore attaches one layer up, at the agent that drives OfficeCLI.
That agent is Claude Code, and claude-mem's existing `claude-code` adapter
already captures its tool use. The OfficeCLI-specific work is not a new hook
transport; it is making the captured memory *usable for deck work* — seeding the
project's memory with conventions, and giving the agent a skill that reliably
recalls before building and records after.

## How a slide session gets memory

Three independent paths, and the checker verifies each:

1. **Automatic capture and injection.** claude-mem's Claude Code hooks
   (SessionStart, UserPromptSubmit, PostToolUse, Stop) run the local worker,
   which compresses tool use into observations and injects relevant context at
   the start of later sessions. Nothing OfficeCLI-specific is needed for this.
2. **Explicit recall.** The `mcp-search` MCP server exposes `search`,
   `get_observations`, `timeline` and `smart_search`. The
   `officecli-slides-memory` skill tells the agent to query these before
   proposing a deck structure.
3. **Explicit recording.** `scripts/remember.mjs` posts to the worker's
   `POST /api/memory/save`. The MCP `observation_add` tool is *not* usable for
   this on a desktop install — it is server-runtime only and calls
   `/v1/memories` — which is why the bridge ships its own writer.

## Public repo, private context

`Kris-97/claude-mem-krisu` is a **public** fork. Everything under
`integrations/officecli/context/` is therefore mechanism only: architecture,
routes, conventions. No client names, deal material, or business content goes
here.

Private context belongs in the private `Kris-97/kriskros` repo and is imported
with the same tool by pointing it elsewhere:

```bash
node scripts/import-context.mjs --dir /path/to/kriskros/memory-context --project officecli
```

Both import into the same local database and are retrieved together, so the
split costs nothing at recall time. It only keeps the sensitive half off a
public remote.
