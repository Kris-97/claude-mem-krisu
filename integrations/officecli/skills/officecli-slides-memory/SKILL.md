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

### Depth is not optional

**A deck built only from flat fills, position and size is unfinished.** Before
you call a deck done, make at least one deliberate depth-or-finish decision, and
give the deck one hero moment that uses the 3D stack or a gradient field.

This rule exists because the reference styles teach the opposite. OfficeCLI
supports 15 depth and finish properties — `shadow`, `innerShadow`, `glow`,
`reflection`, `softEdge`, `gradient`, `pattern`, `lineDash`, `textWarp`, `bevel`,
`bevelBottom`, `depth`, `material`, `lighting`, `highlight` — and all 51 styles
in `skills/morph-ppt/reference/styles/` use **every one of them zero times**,
while their design notes mention "gradient" 58 times and "glow" 22. Copy those
scripts and you inherit flat output that describes itself as rich.

`<CLAUDE_MEM_OFFICECLI>/design/TECHNIQUES.md` has the exact syntax for each,
with what it is for and where it tips into looking dated. Read it before
building, pick deliberately, and say which technique you chose and why — a
choice the user can veto beats a default they have to notice.

The restraint matters as much as the reach: one shadow depth per deck, one 3D
object per slide, two gradient stops in the same hue family. Extruding every card
is worse than extruding none.

## 3. Record as you build — one memory per slide

**The deck is not finished until its provenance is recorded. This is a
precondition for ending the turn, not a nice-to-have.**

That wording is deliberate, and it is the result of a measurement rather than a
preference. Automatic capture does not preserve this work: ten slide-build
events run through claude-mem's real capture path produced two observations and
four session summaries, all of them deck-level prose — "a cohesive design system
built around a candy stripe pattern". Every `x`, `width`, fill and shape name
was compressed away. So a later session asking *"what built `!!blk-a`?"* finds
nothing, however good retrieval is. Anything you do not write down here is gone.

### 3a. After each slide — the mechanical record

Do this as part of the build loop, immediately after the slide's commands
succeed, not once at the end when the detail has scrolled away:

```bash
node <CLAUDE_MEM_OFFICECLI>/scripts/remember.mjs \
  --project officecli --tag deck --tag evli --tag slide-4 \
  --title "Evli co-invest deck, slide 4: KPI row" \
  "Slide 4 of decks/evli-co-invest.pptx (16:9, master templates/evli-master.pptx).
   3-column KPI row, grid maths: col_width = (33.87 - 3 - 1.52) / 3 = 9.78cm,
   x positions 1.5 / 12.04 / 22.58cm, cards y=4cm height=7cm.
   Shapes: !!kpi-bg-1..3 (roundRect, fill 1E2761, line none),
   #s4-num-1..3 (Georgia 60 bold, FFFFFF), #s4-sub-1..3 (Calibri 14, CADCFC).
   Native pptx charts avoided - the renderer drops axis formatting on export."
```

Name these fields explicitly every time. Vague prose is precisely what the
observer already produces, so a vague record adds nothing:

- **deck file path**, aspect ratio, and template/master path
- **slide number** and what the slide argues (pattern and recipe, if you used them)
- **named shapes**, with their fills and geometry — these are the handles a
  future question will use, since there is no object boundary around a "card"
- **grid maths**, written as the arithmetic, not just the result: the next deck
  reuses the formula, not the centimetres
- **palette as role → hex** (primary/secondary/accent/text/muted) and the
  **font pairing**

### 3b. Whenever they happen — the decisions

Separately from the mechanical record, write one memory each time:

- a **template, master or brand decision** is made or overridden
- the user **corrects** you ("no, we always put the ask last") — corrections are
  the highest-value memories in the database, because they encode a preference
  no file records. Record the correction itself, not the corrected result.
- a **workaround** is found (a renderer bug, an export quirk, a font that fails)
- the deck is **delivered** — one memory naming the file, audience and outcome

The installer rewrites `<CLAUDE_MEM_OFFICECLI>` to this machine's absolute
integration path when it copies this file into the project, so in the installed
copy the commands above are runnable as written. Seeing the placeholder means you
are reading the repo copy, not an installed one.

Do not record the literal slide text — it is in the `.pptx`, and `officecli dump
<deck> /slide[N]` recovers the structure. Record what the file cannot tell you:
the geometry decisions, the reasons, and the corrections.

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
