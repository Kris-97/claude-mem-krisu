# Slides memory eval

Measures whether claude-mem answers the questions that come up while building
decks with OfficeCLI. Six families, scored by different mechanisms on purpose.

```bash
bun evals/slides/run.ts --project <memory-project>      # run the bank
bun evals/slides/src/report/markdown.ts results/<stamp> # render the record
```

## Ground truth

`src/groundtruth/trace-build.ts` RUNS each reference deck's `build.sh` with a
fake `officecli` on PATH that records argv and stdin. The shell does variable
expansion, line continuations and heredocs; we just observe the calls. Tracing
always happens against a disposable copy — every build.sh opens with
`rm -f "$OUTPUT"`, so tracing in place destroys the reference `.pptx`.

A trace that stops early would produce a short answer key and mark correct
answers wrong, so `traceComplete` compares call sites against invocations
rather than trusting the exit code (8 decks end with a `final-check` against
`morph-helpers.py`, which does not ship in the repo).

## Two seeding modes, and why both matter

- **Retrieval ceiling** — deck facts written straight to `/api/memory/save`.
  The answers are present by construction, so scores measure *retrieval only*.
  A low score here means search is broken.
- **Organic capture** — replays deck builds through the real
  `hook claude-code <event>` path so the observer compresses them as it would a
  live session. Measures *capture plus retrieval*.

The gap between the two is the interesting number: it is how much of the work
memory never recorded in the first place.

## The trap this eval kept falling into

`/api/search` returns an **index** of ids and titles; only
`/api/observations/batch` returns bodies. Scoring the index alone marks every
answer wrong even when retrieval ranked the right memory first. The runner
therefore does search → ids → fetch, the same two-step a session does.

Chroma search also applies a client-side 90-day recency window when the caller
passes no `dateRange`, silently dropping older memories. The runner always
passes an explicit range; `E-old-decision` probes the window deliberately with a
memory backdated 120 days.
