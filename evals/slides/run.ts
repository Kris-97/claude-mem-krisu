#!/usr/bin/env bun
/**
 * Run the slides memory eval and emit a report.
 *
 *   bun evals/slides/run.ts --styles <dir> --project <name> [--skip-synthetic]
 *
 * Families A, C, D, E and F are scored over what `/api/search` returns — that
 * is the retrieval surface a slide session actually uses. Family B goes through
 * the corpus route instead, because "what is prevalent across all decks" is a
 * synthesis question that top-k search structurally cannot answer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { traceAllDecks } from './src/groundtruth/trace-build.ts';
import { buildQuestionBank, SYNTHETIC_FACTS, type EvalQuestion } from './src/questions.ts';
import { scoreQuestion } from './src/scoring.ts';

interface Args {
  styles: string;
  project: string;
  port: number;
  skipSynthetic: boolean;
  outDir: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    styles: '/home/user/iofficeai/officecli/skills/morph-ppt/reference/styles',
    project: 'evalproj',
    port: Number(process.env.CLAUDE_MEM_WORKER_PORT ?? 37700),
    skipSynthetic: false,
    outDir: path.join(import.meta.dir, 'results'),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--styles') a.styles = argv[++i];
    else if (argv[i] === '--project') a.project = argv[++i];
    else if (argv[i] === '--port') a.port = Number(argv[++i]);
    else if (argv[i] === '--out') a.outDir = path.resolve(argv[++i]);
    else if (argv[i] === '--skip-synthetic') a.skipSynthetic = true;
  }
  return a;
}

const api = (port: number, route: string) => `http://127.0.0.1:${port}${route}`;

async function getJson(port: number, route: string, timeoutMs = 30000): Promise<any> {
  const res = await fetch(api(port, route), { signal: AbortSignal.timeout(timeoutMs) });
  return res.json();
}

async function postJson(port: number, route: string, body: unknown, timeoutMs = 180000): Promise<any> {
  const res = await fetch(api(port, route), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

/**
 * `/api/search` deliberately returns an INDEX — a markdown table of ids and
 * titles, ~50-100 tokens per hit — and only `/api/observations/batch` returns
 * bodies. Scoring the index alone marks every answer wrong even when retrieval
 * ranked the right memory first, so the eval must follow the same two-step
 * workflow a session does: search, then fetch the hits it chose.
 */
function extractIds(payload: any): number[] {
  const text = Array.isArray(payload?.content)
    ? payload.content.map((c: any) => c?.text ?? '').join('\n')
    : '';
  const ids = [...text.matchAll(/\|\s*#(\d+)\s*\|/g)].map((m) => Number(m[1]));
  return [...new Set(ids)];
}

function renderObservations(rows: any[]): string {
  return (Array.isArray(rows) ? rows : [])
    .map((o) =>
      [o?.title, o?.subtitle, o?.narrative, o?.text, o?.facts, o?.concepts]
        .filter((v) => v && v !== '[]')
        .join(' ')
    )
    .join('\n\n');
}

/**
 * Search with an explicit wide date range. Chroma search otherwise applies a
 * client-side 90-day recency window, which would silently drop older memories
 * and make the whole suite look like a retrieval failure.
 */
async function searchMemory(port: number, project: string, query: string) {
  const dateStart = new Date(Date.now() - 3650 * 864e5).toISOString();
  const dateEnd = new Date(Date.now() + 864e5).toISOString();
  const params = new URLSearchParams({ query, project, limit: '12', dateStart, dateEnd });
  const started = Date.now();
  const payload = await getJson(port, `/api/search?${params}`);
  const ids = extractIds(payload);
  const indexText = Array.isArray(payload?.content)
    ? payload.content.map((c: any) => c?.text ?? '').join('\n')
    : '';

  let bodies: any[] = [];
  if (ids.length) {
    bodies = await postJson(port, '/api/observations/batch', { ids }, 60000).catch(() => []);
  }
  // Index text is kept alongside the bodies: titles carry real answer content
  // (deck names, "is now teal"), and dropping them would understate retrieval.
  const text = `${indexText}\n\n${renderObservations(bodies)}`;
  return { text, count: ids.length, latencyMs: Date.now() - started };
}

/** Families D, E and F ask about facts that must be put there deliberately. */
async function seedSynthetic(port: number, project: string) {
  const f = SYNTHETIC_FACTS;
  const save = (title: string, text: string) =>
    postJson(port, '/api/memory/save', {
      title,
      text,
      project,
      metadata: { project, platformSource: 'officecli', importer: 'slides-eval' },
    });

  // Ordered oldest to newest so the supersession chain is unambiguous.
  await save('House accent colour set', `The house deck accent colour is ${f.accent.old}.`);
  await save('House accent colour revised', `The house accent colour changed from ${f.accent.old} to ${f.accent.mid}.`);
  await save(
    'House accent colour is now teal',
    `The current house accent colour is ${f.accent.current}, replacing ${f.accent.mid}. Use ${f.accent.current} on all new decks.`
  );
  await save('Slide margin standard', `Slide margins were ${f.margin.old}.`);
  await save('Slide margin widened', `The slide margin is now ${f.margin.current}, replacing ${f.margin.old}.`);
  await save('Default transition set to fade', `The default slide transition was ${f.transitionDefault.old}.`);
  await save(
    'Default transition is now morph',
    `The current default slide transition is ${f.transitionDefault.current}, replacing ${f.transitionDefault.old}.`
  );
  const ancient = await save('Deck archiving policy', `Finished decks are archived as ${f.ancientDecision}.`);

  await save('KM correction: slide order', `KM corrected the slide order: ${f.corrections.order}.`);
  await save('KM correction: title treatment', `KM rejected the title treatment: ${f.corrections.title}.`);
  await save('KM correction: iconography', `KM instructed: ${f.corrections.never}.`);

  // Backdate the archiving memory past the 90-day Chroma recency window, so
  // E-old-decision probes the window rather than ordinary retrieval.
  let backdated = false;
  try {
    const { Database } = await import('bun:sqlite');
    const db = new Database('/root/.claude-mem/claude-mem.db');
    const epoch = Date.now() - 120 * 864e5;
    const iso = new Date(epoch).toISOString();
    const id = ancient?.id;
    if (id) {
      db.run('UPDATE observations SET created_at_epoch = ?, created_at = ? WHERE id = ?', [epoch, iso, id]);
      backdated = true;
    }
    db.close();
  } catch (error) {
    console.warn(`could not backdate the 120-day memory (${String(error)}); E-old-decision tests plain retrieval`);
  }
  return { backdated };
}

async function answerSynthesis(port: number, project: string, q: EvalQuestion, corpus: string) {
  // Reprime between questions: the primed session is stateful and drifts, so
  // without this the scores become order-dependent.
  await postJson(port, `/api/corpus/${corpus}/reprime`, {}).catch(() => null);
  const res = await postJson(port, `/api/corpus/${corpus}/query`, { question: q.question });
  return typeof res?.answer === 'string' ? res.answer : JSON.stringify(res ?? {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const health = await getJson(args.port, '/health').catch(() => null);
  if (!health) throw new Error(`worker not reachable on 127.0.0.1:${args.port}`);
  const chroma = await getJson(args.port, '/api/chroma/status').catch(() => null);
  const chromaLive = chroma?.connected === true;

  console.log(`tracing decks from ${args.styles} ...`);
  const traces = traceAllDecks(args.styles);
  const incomplete = traces.filter((t) => !t.traceComplete);
  if (incomplete.length) throw new Error(`incomplete traces: ${incomplete.map((t) => t.deck).join(', ')}`);

  if (!args.skipSynthetic) {
    console.log('seeding synthetic facts for families D/E/F ...');
    await seedSynthetic(args.port, args.project);
  }

  const bank = buildQuestionBank(traces);
  console.log(`running ${bank.length} questions (chroma ${chromaLive ? 'LIVE' : 'DOWN'}) ...`);

  // One filter-only corpus for family B. A corpus with a `query` filter would
  // gate membership on search recall, smuggling a retrieval failure into a
  // synthesis score.
  const corpusName = 'slides-eval';
  let corpusReady = false;
  try {
    const built = await postJson(args.port, '/api/corpus', {
      name: corpusName,
      description: 'Reference deck builds, for slides memory eval',
      project: args.project,
      limit: 500,
    });
    corpusReady = !built?.error;
    if (corpusReady) await postJson(args.port, `/api/corpus/${corpusName}/prime`, {});
  } catch (error) {
    console.warn(`corpus unavailable (${String(error)}); family B will fall back to search`);
  }

  const results = [];
  for (const q of bank) {
    let answer = '';
    let retrieved = 0;
    let latencyMs = 0;
    let route = 'search';

    if (q.family === 'B' && corpusReady) {
      const started = Date.now();
      answer = await answerSynthesis(args.port, args.project, q, corpusName).catch((e) => `ERROR: ${e}`);
      latencyMs = Date.now() - started;
      route = 'corpus';
      retrieved = answer ? 1 : 0;
    } else {
      const r = await searchMemory(args.port, args.project, q.question);
      answer = r.text;
      retrieved = r.count;
      latencyMs = r.latencyMs;
    }

    const score = scoreQuestion(q, answer);
    results.push({
      id: q.id,
      family: q.family,
      deck: q.deck ?? null,
      question: q.question,
      route,
      retrieved,
      latencyMs,
      score: score.value,
      detail: score.detail,
      found: score.found,
      missed: score.missed,
      falseClaims: (score as any).falseClaims ?? [],
      answer,
    });
    console.log(`  [${q.family}] ${q.id.padEnd(28)} ${(score.value * 100).toFixed(0).padStart(3)}%  ${score.detail}`);
  }

  const byFamily: Record<string, { n: number; mean: number }> = {};
  for (const f of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const rs = results.filter((r) => r.family === f);
    if (rs.length) byFamily[f] = { n: rs.length, mean: rs.reduce((s, r) => s + r.score, 0) / rs.length };
  }

  const report = {
    metadata: {
      timestamp: new Date().toISOString(),
      project: args.project,
      chromaLive,
      decksTraced: traces.length,
      commandsTraced: traces.reduce((s, t) => s + t.commands.length, 0),
      corpusUsed: corpusReady,
      scoringNote:
        'Family B uses deterministic reference-term coverage as a proxy for the LLM judge; full answers are included so the judgement stays inspectable.',
    },
    byFamily,
    results,
  };

  const stamp = report.metadata.timestamp.replace(/[:.]/g, '-');
  const dir = path.join(args.outDir, stamp);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nwrote ${path.join(dir, 'report.json')}`);
  for (const [f, v] of Object.entries(byFamily)) {
    console.log(`  family ${f}: ${(v.mean * 100).toFixed(0)}%  (n=${v.n})`);
  }
  return report;
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
