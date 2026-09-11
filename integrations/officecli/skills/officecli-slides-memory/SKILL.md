---
name: officecli-slides-memory
description: "Recall past deck decisions from claude-mem before building slides with OfficeCLI, and record the decisions this deck makes. Use whenever building, editing or reviewing a .pptx deck, presentation, pitch deck or slide with officecli -- especially when the user says 'like last time', 'same template', 'our usual layout', 'the Evli deck', or refers to any deck built in an earlier session."
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# OfficeCLI slides, with memory

Deck work is the worst case for a stateless session: the brand rules, the
template path, the figure conventions and the client's preferences were all
settled in some session three weeks ago, and none of it is in this context
window. This skill closes that loop. It does not build slides — the
`officecli-pptx` and `officecli-pitch-deck` skills do that — it makes sure the
build starts from what was already decided and ends by writing down what this
one decided.

**The loop: recall → build → record. Never skip record.** A deck that is built
without recording leaves the next session exactly as ignorant as this one
started, which is the failure this whole integration exists to prevent.

## 1. Recall, before the first `officecli` call

Query memory *before* proposing a structure, not after the user rejects one.
Use the `search` MCP tool from the `mcp-search` server (claude-mem):

```
search(query="<client or deck topic> deck template brand", project="officecli", limit=15)
```

Run two or three queries, not one — retrieval is a recall problem, and the
vocabulary you pick first is rarely the vocabulary the earlier session used.
Worth querying separately:

- the **client or subject** ("Evli", "co-invest study") — facts, sensitivities, audience
- the **template and brand** ("template", "master", "brand colours", "fonts", "16:9")
- the **structure** ("deck structure", "slide order", "narrative") — what shape worked
- the **figures** ("figure library", "chart style", "diagram") — how visuals are made here

Then follow claude-mem's layered workflow: the index comes back with IDs, and
you fetch full detail with `get_observations` for the few that look relevant.
Do not pull full detail for everything — that is the 10x token mistake the
`mem-search` skill warns about.

If memory returns nothing useful, say so in one line ("no prior deck memory for
this client — starting fresh") and continue. Silence reads as "there was no
history", which is a different and misleading claim.

## 2. Build

Hand off to the OfficeCLI skills as normal (`officecli-pptx` for decks
generally, `officecli-pitch-deck` for investor narrative). The verbs are
`create`, `open`, `add`, `set`, `get`, `query`, `remove`, `validate`, `view`,
`save`; `officecli help pptx` is authoritative for syntax and is cheaper than
guessing.

What memory changes here is the *defaults you propose*: apply the recalled
template, aspect ratio, fonts and slide order instead of inventing new ones,
and tell the user which recalled decision you are applying, so a stale one can
be corrected rather than silently re-applied:

> Using the 16:9 Evli master at `templates/evli-master.pptx` and the
> problem → evidence → recommendation order from the March deck. Say if either
> has moved on.

## 3. Record, before you end the turn

Write back what a future session would need and could not re-derive from the
`.pptx` file itself. The reasons are the valuable part — the file already
stores the result.

```bash
node <CLAUDE_MEM_OFFICECLI>/scripts/remember.mjs \
  --project officecli \
  --title "Evli co-invest deck: structure and template" \
  --tag deck --tag evli \
  "Built 14-slide co-invest deck from templates/evli-master.pptx (16:9).
   Order: problem, market, evidence, co-invest mechanics, fees, ask.
   Client asked to lead with evidence not market size - reversed slides 2/3.
   Charts from the figure-library components, not native pptx charts, because
   the native renderer loses the axis formatting on export."
```

The installer rewrites `<CLAUDE_MEM_OFFICECLI>` to this machine's absolute
integration path when it copies this file into the project, so in the installed
copy the command above is runnable as written. Seeing the placeholder means you
are reading the repo copy, not an installed one.

Record at these moments, not only at the very end:

- a **template, master or brand decision** is made or overridden
- the user **corrects** you ("no, we always put the ask last") — corrections are
  the highest-value memories in the database, because they encode a preference
  no file records
- a **workaround** is found (a renderer bug, an export quirk, a font that fails)
- the deck is **delivered** — one memory naming the file, audience and outcome

Do not record: the literal slide text (it is in the file), routine tool syntax,
or anything the user asked to keep out of memory.

## 4. If memory is not answering

`search` failing means the worker is down, not that there is no history. Check
and say which it is rather than proceeding as if the project had no past:

```bash
node <CLAUDE_MEM_OFFICECLI>/scripts/check.mjs --project officecli --target <this project>
```

A red `worker reachable` line means claude-mem is not running — opening a fresh
Claude Code session starts it. Everything else in that output names its own fix.
