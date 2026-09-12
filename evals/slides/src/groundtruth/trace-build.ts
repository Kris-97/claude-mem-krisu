/**
 * Ground truth for family A (provenance) and family C (coverage).
 *
 * Each reference deck ships a build.sh of real `officecli` commands. Rather
 * than parsing bash — which would mean reimplementing variable expansion, line
 * continuations, loops and heredocs, and getting them subtly wrong — we RUN the
 * script with a fake `officecli` on PATH that records its argv and stdin. The
 * shell does the expansion; we just observe the calls.
 *
 * The script is always run against a disposable COPY of the deck directory:
 * every build.sh opens with `rm -f "$OUTPUT"`, so tracing in place destroys the
 * reference .pptx sitting next to it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface TracedCommand {
  verb: string;
  /** Document DOM path the command targets, e.g. "/" or "/slide[3]". */
  path?: string;
  /** Element type from --type, e.g. "slide", "shape", "textbox". */
  type?: string;
  props: Record<string, string>;
  /** 1-based index of the slide being built when this command ran. */
  slide: number;
  /** True when the command came from a JSON batch rather than argv. */
  fromBatch: boolean;
  argv: string[];
}

export interface DeckTrace {
  deck: string;
  commands: TracedCommand[];
  /** Every `name=` value, in first-seen order — the real component handles. */
  namedShapes: string[];
  /** Every distinct --prop key — the family-C answer universe for this deck. */
  propKeys: string[];
  slideCount: number;
  fonts: string[];
  fills: string[];
  transitions: string[];
  /** Number of times the shim was invoked (a batch counts once). */
  invocations: number;
  /** `officecli` call sites counted in the script text. */
  expectedInvocations: number;
  /**
   * False when the script stopped before issuing all its officecli calls, i.e.
   * the answer key is short. Several reference decks end with a `final-check`
   * against `morph-helpers.py`, which does not ship in the repo — `set -e` then
   * aborts *after* the last build command, so the trace is still complete.
   */
  traceComplete: boolean;
  /** Non-fatal problems worth surfacing rather than swallowing. */
  warnings: string[];
}

const SHIM = `#!/usr/bin/env bash
# Records argv (and stdin, for batch) as one JSON object per line, then exits 0.
_stdin=""
if [ ! -t 0 ]; then _stdin="$(cat)"; fi
OFFICECLI_STDIN="$_stdin" python3 -c '
import json, sys, os
rec = {"argv": sys.argv[1:], "stdin": os.environ.get("OFFICECLI_STDIN", "")}
with open(os.environ["OFFICECLI_TRACE"], "a") as f:
    f.write(json.dumps(rec) + "\\n")
' "$@"
exit 0
`;

/** Split "k=v" once, so values containing "=" survive intact. */
function splitProp(token: string): [string, string] | null {
  const i = token.indexOf('=');
  if (i <= 0) return null;
  return [token.slice(0, i), token.slice(i + 1)];
}

function parseArgv(argv: string[]): { verb: string; path?: string; type?: string; props: Record<string, string> } {
  const verb = argv[0] ?? '';
  const props: Record<string, string> = {};
  let type: string | undefined;
  const positionals: string[] = [];

  for (let i = 1; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--prop') {
      const kv = splitProp(argv[++i] ?? '');
      if (kv) props[kv[0]] = kv[1];
    } else if (tok === '--type') {
      type = argv[++i];
    } else if (tok.startsWith('--')) {
      // Flags we do not model (e.g. --json, --best-effort). Skip a value if the
      // flag clearly takes one, otherwise treat as boolean.
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) i++;
    } else {
      positionals.push(tok);
    }
  }

  // Positionals are `<file> [<path>]`; the file is always first.
  const domPath = positionals.length > 1 ? positionals[1] : undefined;
  return { verb, path: domPath, type, props };
}

/** Batch items carry the same shape as argv commands under different keys. */
function parseBatchStdin(stdin: string): Array<{ verb: string; path?: string; type?: string; props: Record<string, string> }> {
  const trimmed = stdin.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, any>;
    const verb = String(item.command ?? item.op ?? '');
    if (!verb) return [];
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(item.props ?? {})) props[k] = String(v);
    return [{ verb, path: item.parent ?? item.path, type: item.type, props }];
  });
}

export function traceDeck(deckDir: string): DeckTrace {
  const deck = path.basename(deckDir);
  const buildScript = path.join(deckDir, 'build.sh');
  if (!fs.existsSync(buildScript)) throw new Error(`no build.sh in ${deckDir}`);

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `deck-trace-${deck}-`));
  const warnings: string[] = [];
  try {
    // Copy, never trace in place: build.sh starts with `rm -f "$OUTPUT"`.
    fs.cpSync(deckDir, path.join(sandbox, 'deck'), { recursive: true });
    const binDir = path.join(sandbox, 'bin');
    fs.mkdirSync(binDir);
    const shimPath = path.join(binDir, 'officecli');
    fs.writeFileSync(shimPath, SHIM, { mode: 0o755 });

    const tracePath = path.join(sandbox, 'trace.jsonl');
    const result = spawnSync('bash', ['build.sh'], {
      cwd: path.join(sandbox, 'deck'),
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OFFICECLI_TRACE: tracePath },
      encoding: 'utf-8',
      timeout: 120000,
    });
    if (result.status !== 0) {
      warnings.push(`build.sh exited ${result.status}: ${(result.stderr || '').slice(0, 300)}`);
    }
    if (!fs.existsSync(tracePath)) {
      throw new Error(`no commands traced for ${deck}; stderr: ${(result.stderr || '').slice(0, 300)}`);
    }

    const commands: TracedCommand[] = [];
    let slide = 0;
    let invocations = 0;
    let maxSlideRef = 0;
    for (const line of fs.readFileSync(tracePath, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      invocations++;
      let rec: { argv: string[]; stdin: string };
      try {
        rec = JSON.parse(line);
      } catch {
        warnings.push(`unparseable trace line skipped`);
        continue;
      }

      const base = parseArgv(rec.argv);
      const batched = base.verb === 'batch' ? parseBatchStdin(rec.stdin) : [];

      if (batched.length > 0) {
        for (const item of batched) {
          if (item.type === 'slide') slide++;
          commands.push({ ...item, slide: Math.max(slide, 1), fromBatch: true, argv: rec.argv });
        }
        continue;
      }
      if (base.verb === 'batch') warnings.push('batch command produced no parseable items');

      if (base.type === 'slide' && base.verb === 'add') slide++;
      commands.push({ ...base, slide: Math.max(slide, 1), fromBatch: false, argv: rec.argv });
    }

    for (const c of commands) {
      const m = /\/slide\[(\d+)\]/.exec(c.path ?? '');
      if (m) maxSlideRef = Math.max(maxSlideRef, Number(m[1]));
    }

    // A script that stops early yields a short answer key, which would silently
    // mark correct memory answers wrong. Compare call sites against invocations
    // instead of trusting the exit code, which also fires on the missing
    // post-build `final-check` helper.
    const scriptText = fs.readFileSync(buildScript, 'utf-8');
    const expectedInvocations = (scriptText.match(/(?:^|[\s|(])officecli\s/gm) ?? []).length;
    const traceComplete = invocations >= expectedInvocations;
    if (!traceComplete) {
      warnings.push(
        `INCOMPLETE TRACE: ${invocations} of ~${expectedInvocations} officecli call sites ran; answer key is short`
      );
    }

    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
    const propValues = (key: string) =>
      commands.map((c) => c.props[key]).filter((v): v is string => typeof v === 'string');

    return {
      deck,
      commands,
      namedShapes: uniq(propValues('name')),
      propKeys: uniq(commands.flatMap((c) => Object.keys(c.props))).sort(),
      slideCount: Math.max(slide, maxSlideRef),
      invocations,
      expectedInvocations,
      traceComplete,
      fonts: uniq([...propValues('font'), ...propValues('font.latin')]),
      fills: uniq(propValues('fill')),
      transitions: uniq(propValues('transition')),
      warnings,
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

/** Trace every deck directory that ships a build.sh. */
export function traceAllDecks(stylesRoot: string): DeckTrace[] {
  return fs
    .readdirSync(stylesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(stylesRoot, e.name, 'build.sh')))
    .map((e) => traceDeck(path.join(stylesRoot, e.name)))
    .sort((a, b) => a.deck.localeCompare(b.deck));
}
