/**
 * Seed the memory database with the reference deck builds.
 *
 * Seeding goes through claude-mem's REAL capture path — the same
 * `hook claude-code <event>` entry points the plugin's hooks.json invokes — so
 * the observer compresses these sessions exactly as it would a live one.
 * Inserting rows straight into SQLite would be far faster and would evaluate
 * the database instead of the harness, which is the one thing this eval must
 * not do.
 *
 * Granularity is one tool-use event per slide rather than per command: the
 * observer skips trivial single commands as `routine` (verified), and a whole
 * slide's build is the honest unit of work anyway.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { traceAllDecks, type DeckTrace, type TracedCommand } from '../groundtruth/trace-build.ts';

const REPO_ROOT = path.resolve(import.meta.dir, '..', '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'plugin', 'scripts', 'bun-runner.js');
const WORKER = path.join(REPO_ROOT, 'plugin', 'scripts', 'worker-service.cjs');

export interface SeedOptions {
  /** Working directory reported to the hooks; becomes the memory "project". */
  projectDir: string;
  decks?: string[];
  onProgress?: (message: string) => void;
}

function runHook(event: 'session-init' | 'observation' | 'summarize', payload: unknown): boolean {
  const res = spawnSync('node', [RUNNER, WORKER, 'hook', 'claude-code', event], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    timeout: 120000,
  });
  return res.status === 0;
}

/** Render one slide's traced commands back into the shell text that produced them. */
function renderSlideCommands(commands: TracedCommand[]): string {
  return commands
    .map((c) => {
      if (c.fromBatch) {
        const item = { command: c.verb, parent: c.path, type: c.type, props: c.props };
        return `officecli batch deck.pptx <<< '${JSON.stringify(item)}'`;
      }
      const props = Object.entries(c.props).map(([k, v]) => `--prop ${k}=${v}`);
      return ['officecli', c.verb, 'deck.pptx', c.path ?? '/', c.type ? `--type ${c.type}` : '', ...props]
        .filter(Boolean)
        .join(' ');
    })
    .join('\n');
}

export async function pollUntilDrained(port: number, timeoutMs = 300000): Promise<boolean> {
  // Mirrors ragtime.ts's waitForQueueToEmpty: the observer compresses
  // asynchronously, so querying before the queue drains measures a half-written
  // database.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/processing-status`, {
        signal: AbortSignal.timeout(8000),
      });
      const body = (await res.json()) as { isProcessing?: boolean; queueDepth?: number };
      if (body.queueDepth === 0 && body.isProcessing === false) return true;
    } catch {
      // Worker busy or momentarily unreachable; keep waiting rather than
      // declaring the queue drained, which would truncate the corpus.
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return false;
}

/**
 * Claude Code transcript format: one JSONL object per turn, `{"type":"user"|
 * "assistant","message":{role,content[]}}`. The observer reads this file for
 * session context — pointing it at /dev/null makes it report "no tool
 * executions" and record nothing, which looks exactly like a memory failure
 * but is a seeding bug.
 */
function appendTranscript(file: string, entries: unknown[]): void {
  fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

const userTurn = (text: string) => ({
  type: 'user',
  uuid: randomUUID(),
  message: { role: 'user', content: [{ type: 'text', text }] },
});

const assistantTurn = (content: unknown[]) => ({
  type: 'assistant',
  uuid: randomUUID(),
  message: { role: 'assistant', model: 'claude-opus-5', content },
});

export async function seedDeck(trace: DeckTrace, opts: SeedOptions, port: number): Promise<number> {
  const sessionId = `eval-deck-${trace.deck}`;
  const log = opts.onProgress ?? (() => {});

  const transcriptPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), `eval-transcript-${trace.deck}-`)),
    'transcript.jsonl'
  );
  const base = { session_id: sessionId, cwd: opts.projectDir, transcript_path: transcriptPath };

  const openingPrompt = `Build the "${trace.deck}" reference deck with officecli, following its style guide.`;
  appendTranscript(transcriptPath, [userTurn(openingPrompt)]);

  runHook('session-init', { ...base, prompt: openingPrompt });

  const bySlide = new Map<number, TracedCommand[]>();
  for (const c of trace.commands) {
    if (!bySlide.has(c.slide)) bySlide.set(c.slide, []);
    bySlide.get(c.slide)!.push(c);
  }

  let events = 0;
  for (const [slide, commands] of [...bySlide.entries()].sort((a, b) => a[0] - b[0])) {
    const names = commands.map((c) => c.props.name).filter(Boolean);
    const command = renderSlideCommands(commands);
    const description = `${trace.deck}: build slide ${slide}${names.length ? ` (shapes: ${names.join(', ')})` : ''}`;
    const toolUseId = `toolu_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const stdout = `Built slide ${slide}: ${commands.length} commands applied`;

    // The transcript must carry the same turn the hook reports, or the observer
    // is reasoning about a session it cannot see.
    appendTranscript(transcriptPath, [
      assistantTurn([
        { type: 'text', text: `Building slide ${slide} of ${trace.deck}.` },
        { type: 'tool_use', id: toolUseId, name: 'Bash', input: { command, description } },
      ]),
      {
        type: 'user',
        uuid: randomUUID(),
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUseId, content: stdout }],
        },
      },
    ]);

    runHook('observation', {
      ...base,
      tool_name: 'Bash',
      tool_input: { command, description },
      tool_response: { stdout, exitCode: 0 },
      tool_use_id: toolUseId,
    });
    events++;
  }

  appendTranscript(transcriptPath, [
    assistantTurn([
      {
        type: 'text',
        text:
          `Finished the ${trace.deck} deck: ${trace.slideCount} slides, ` +
          `${trace.commands.length} officecli commands. Palette ${trace.fills.slice(0, 4).join('/')}; ` +
          `fonts ${trace.fonts.join(', ') || 'theme defaults'}; ` +
          `named shapes ${trace.namedShapes.slice(0, 8).join(', ')}.`,
      },
    ]),
  ]);

  runHook('summarize', base);
  log(`  ${trace.deck}: ${events} slide events queued`);
  await pollUntilDrained(port);
  return events;
}

export async function seedAll(stylesRoot: string, opts: SeedOptions, port: number) {
  const log = opts.onProgress ?? (() => {});
  let traces = traceAllDecks(stylesRoot);
  if (opts.decks?.length) traces = traces.filter((t) => opts.decks!.includes(t.deck));

  const incomplete = traces.filter((t) => !t.traceComplete);
  if (incomplete.length) {
    throw new Error(
      `refusing to seed from incomplete traces (answer key would be short): ${incomplete.map((t) => t.deck).join(', ')}`
    );
  }

  log(`seeding ${traces.length} decks through the real capture path...`);
  let total = 0;
  for (const trace of traces) total += await seedDeck(trace, opts, port);
  log(`seeded ${traces.length} decks, ${total} slide events`);
  return { decks: traces.length, events: total, traces };
}
