# Runbook — install the memory bridge on your own machine

For Windows / PowerShell, which is what the OfficeCLI work runs on. Nothing here
depends on another Claude session being responsive: paste the blocks, read the
output.

One fact to keep in mind throughout: **on Windows the claude-mem worker listens
on port 37777**, not 37700. `process.getuid` does not exist there, so claude-mem
substitutes uid 77 into `37700 + (uid % 100)`. If you go looking for the worker
on the wrong port everything below will look broken when it is fine.

## 0. Set your paths once

```powershell
$Repo    = 'C:\path\to\claude-mem-krisu'     # this fork, on the integration branch
$Office  = 'C:\path\to\OfficeCLI'            # your OfficeCLI checkout
$Kris    = 'C:\path\to\kriskros'             # the private repo, for private context
$Integration = Join-Path $Repo 'integrations\officecli'
```

Get the branch first if you have not already:

```powershell
git -C $Repo fetch origin claude/memory-officecli-integration-7nw8ne
git -C $Repo checkout claude/memory-officecli-integration-7nw8ne
```

## 1. Make sure the worker is up

The worker starts when a Claude Code session starts. Confirm rather than assume:

```powershell
Invoke-RestMethod 'http://127.0.0.1:37777/health'
Invoke-RestMethod 'http://127.0.0.1:37777/api/chroma/status'
```

`/health` should return `status: ok`. The Chroma line matters more than it
looks: **if `connected` is false, semantic search is off**, every paraphrased
question falls back to literal text matching, and any retrieval number you
measure afterwards is about that, not about memory. This is the suspected cause
of the 30% hit@1 you saw.

## 2. Install

```powershell
& (Join-Path $Integration 'install.ps1') -Target $Office -Project officecli
```

Idempotent — re-running it is the supported way to upgrade. It installs the
`officecli-slides-memory` skill into `$Office\.claude\skills\`, merges
claude-mem's `mcp-search` server into `$Office\.mcp.json` (keeping any servers
already there), imports the public context pack, and runs the checker.

## 3. Import the private context too

The installer only imports the public pack. The private one lives in `kriskros`
because `claude-mem-krisu` is a **public** fork:

```powershell
node (Join-Path $Integration 'scripts\import-context.mjs') `
  --dir (Join-Path $Kris 'memory-context') --project officecli
```

Safe to re-run: each section is hashed into a ledger at
`~\.claude-mem\officecli-import-ledger.json`, so only changed sections import
again.

## 4. Verify

```powershell
node (Join-Path $Integration 'scripts\check.mjs') --project officecli --target $Office
```

Exit code 0 means a slide session in that project genuinely receives memory.
What each line means when it is not green:

| Line | If it fails |
|---|---|
| `worker reachable` | Worker is down. Open a Claude Code session to start it. Everything else is meaningless until this is green. |
| `memory database populated` | Worker is up but `/api/stats` failed — check the worker log at `~\.claude-mem\logs\`. |
| `imported context retrievable` | The context pack did not land. Re-run step 3, then this. |
| `topical recall for slide work` | **Advisory only** — a WARN here is expected when Chroma is not configured, and does not fail the run. |
| `claude-mem hooks installed` | claude-mem itself is not installed, only this bridge. Install the plugin from its marketplace first. |
| `memory MCP wired into target project` | `$Office\.mcp.json` has no memory server — re-run step 2. |
| `slides-memory skill installed` | The skill did not copy — re-run step 2 and check permissions on `$Office\.claude\`. |

## 5. Use it

Open a Claude Code session **in the OfficeCLI project** and build a deck as
normal. The skill triggers on deck/slide/pptx work. Two things should now happen
that did not before:

- before proposing a structure, it queries memory and tells you which recalled
  decision it is applying, so a stale one can be corrected rather than silently
  reused;
- as each slide is built, it records that slide's provenance — named shapes,
  fills, geometry, grid maths. This part is deliberate because automatic capture
  does not preserve it: measured, ten slide-build events produced two
  observations of deck-level prose and nothing per-shape.

To check memory is accumulating after a session or two:

```powershell
Invoke-RestMethod 'http://127.0.0.1:37777/api/stats' | ConvertTo-Json -Depth 3
```

## Moving your existing memory to the cloud sessions

See `MEMORY-TRANSFER.md` in this directory. Read the warning about the 90-day
export window before running the export — a naive export silently drops
everything older than three months.
