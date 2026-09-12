# Moving your memory from your machine to the cloud sessions

Your memory database lives on your Windows machine. Cloud sessions cannot reach
it, so it has to travel as a file. claude-mem already ships both halves —
`scripts/export-memories.ts` and `scripts/import-memories.ts` — and the second
one is fine. The first needs care.

## Read this before exporting

`scripts/export-memories.ts` takes a **search query** and exports what search
returns:

```
npx tsx scripts/export-memories.ts <query> <output-file> [--project=name]
```

That is not a database dump, and run the obvious way it will quietly give you a
fraction of your memory. Two independent limits bite:

1. **The 100-result Chroma cap.** When semantic search is live, `SearchManager`
   queries Chroma with an internal limit of 100 — the `limit=999999` the export
   script passes does not raise it. So a text query exports at most ~100
   observations however much you have.
2. **The 90-day recency window.** The script sends no `dateStart`/`dateEnd`, and
   the Chroma path then drops everything older than
   `now - 90 days` without saying so.

Neither prints a warning. You get a file that looks like a successful export.

## The export that actually works: empty query

Pass an **empty query string**. `SearchManager` treats a blank query as
filter-only (its PATH 1): pure SQLite, no Chroma, so neither the 100-result cap
nor the recency window applies.

```powershell
cd C:\path\to\claude-mem-krisu
npx tsx scripts\export-memories.ts "" "$env:USERPROFILE\memory-export.json"
```

Add `--project=<name>` only if you deliberately want one project.

## Always verify the count — do not skip this

The whole point is that a short export looks identical to a complete one:

```powershell
# what the database holds
Invoke-RestMethod 'http://127.0.0.1:37777/api/stats' | Select-Object -ExpandProperty database

# what the export captured
(Get-Content "$env:USERPROFILE\memory-export.json" | ConvertFrom-Json) |
  Select-Object totalObservations, totalSummaries, totalPrompts
```

`totalObservations` should match the database's `observations`. **If it is
exactly 100, or suspiciously round, the Chroma cap caught you** — re-run with the
empty query.

## Where the file goes

Push it to the **private** `kriskros` repo. `claude-mem-krisu` is a public fork,
and this bundle contains real client work:

```powershell
Copy-Item "$env:USERPROFILE\memory-export.json" 'C:\path\to\kriskros\memory-export\memory-export.json'
cd C:\path\to\kriskros
git checkout claude/memory-officecli-integration-7nw8ne
git add memory-export\memory-export.json
git commit -m "chore(memory): export from workstation"
git push -u origin claude/memory-officecli-integration-7nw8ne
```

Two things to weigh before you push, because this is a one-way door: the bundle
holds observation narratives from every project the export covered, and git
history keeps it even if you delete the file later. If that is more than you
want committed, export one project at a time with `--project=` instead.

## Importing it in a cloud session

```bash
bun scripts/import-memories.ts /path/to/memory-export.json
```

It POSTs to the worker's `/api/import`. Then confirm it landed:

```bash
curl -s http://127.0.0.1:$PORT/api/stats | python3 -m json.tool
node integrations/officecli/scripts/check.mjs --project officecli --target <project>
```

## What does not travel

The export carries observations, session summaries, user prompts and SDK session
metadata — not the Chroma vectors under `~/.claude-mem/chroma/`. After an import,
semantic search over the imported rows only works once Chroma has re-synced them;
until then retrieval falls back to SQLite text matching, which is worse at
paraphrases. That is a re-indexing delay, not data loss.
