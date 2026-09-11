---
project: officecli
tags: [officecli, slides, pptx, skills]
---

# OfficeCLI runtime facts

## What OfficeCLI is

A .NET CLI (`officecli.slnx`, sources under `src/officecli/`) that reads and
writes the three universal Office formats — `.docx`, `.xlsx`, `.pptx` — plus a
resident server mode (`ResidentServer.cs`), a watch server
(`Core/Watch/WatchServer.cs`), and an MCP server (`McpServer.cs`) so an agent
can drive it as tools rather than as one-shot commands.

Handlers are per-format under `src/officecli/Handlers/` (`Pptx/`, `Word/`,
`Excel/`), with HTML preview and batch-emitter paths alongside the document
handlers. Diagram support goes through `Core/Diagram/MermaidParser.cs` and a
Mermaid image renderer, and there is a formula parser and evaluator for Excel.

## Command vocabulary

The pptx verbs are `create`, `open`, `add`, `set`, `get`, `query`, `remove`,
`validate`, `view`, `save`. `officecli help pptx` is authoritative for syntax
and is cheaper than guessing at flags.

## The skills that ship with it

`skills/` contains, among others: `officecli` (general), `officecli-pptx`,
`officecli-pitch-deck`, `officecli-docx`, `officecli-xlsx`,
`officecli-data-dashboard`, `officecli-financial-model`,
`officecli-academic-paper`, `officecli-word-form`, plus `morph-ppt` and
`morph-ppt-3d`.

`officecli-pptx` triggers on any .pptx involvement — creating, reading, editing,
combining, templates, layouts, speaker notes, comments. `officecli-pitch-deck`
carries the narrative guidance for investor decks (structure, what belongs on
which slide, what a stage-appropriate deck must include).

## The plugin protocol is about file formats, not agents

`plugins/plugin-protocol.md` (v1) defines plugins as independent sidecar
processes discovered and invoked by the main binary, existing to extend *format*
support without bloating the binary or coupling licences — legacy formats
(`.doc`, `.rtf`, `.odt`), regional formats (`.hwpx`, `.hwp`), export targets
(`.pdf`, `.epub`).

- `dump-reader`: reads a foreign format and streams `add`/`set`/`batch` items as
  JSONL on stdout; main replays them into a native sibling file next to the
  source, cached by mtime. One JSON object per line, flushed individually —
  a top-level JSON array is rejected as `corrupt_batch`, and the per-line flush
  is what feeds main's idle watchdog.
- `exporter`: renders a native file to a foreign target, one direction, no
  editing.

Nothing in the protocol carries a session, a prompt, or a tool-use event, so it
cannot host a memory integration. Memory attaches at the agent driving OfficeCLI.

## Consequence for the memory bridge

Because the agent is Claude Code, claude-mem's existing hooks already capture
OfficeCLI work — every `officecli` invocation is a Bash tool use like any other,
and it lands in memory without special handling. What needed building was the
deck-specific recall and record discipline, not a new capture transport.
