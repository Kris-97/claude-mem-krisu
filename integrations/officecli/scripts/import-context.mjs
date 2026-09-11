#!/usr/bin/env node
/**
 * Import the committed context pack into the local claude-mem database.
 *
 * Each markdown file under context/ is split at its `## ` headings and every
 * section is saved as one observation through POST /api/memory/save. Sections
 * rather than whole files, because retrieval returns whole observations: a
 * single 400-line blob would push 400 lines of mostly-irrelevant context into
 * a session that asked about one deck convention.
 *
 * Re-running is safe. Every section is hashed and recorded in a ledger, so a
 * second run imports only what changed. `--force` re-imports everything.
 *
 * Usage:
 *   node import-context.mjs [--project NAME] [--dir PATH] [--dry-run] [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MEM_HOME, saveMemory, workerHealthy, resolveWorkerPort } from './mem-client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTEXT_DIR = path.resolve(HERE, '..', 'context');
const LEDGER_PATH = path.join(CLAUDE_MEM_HOME, 'officecli-import-ledger.json');
const DEFAULT_PROJECT = 'officecli';

function parseArgs(argv) {
  const args = { project: null, dir: DEFAULT_CONTEXT_DIR, dryRun: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--dir') args.dir = path.resolve(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

/** Front matter is optional and deliberately tiny: `key: value` and `key: [a, b]`. */
export function parseFrontMatter(raw) {
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      meta[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: raw.slice(match[0].length) };
}

/**
 * Split a document into {title, text} sections at its `## ` headings.
 *
 * Fenced code blocks are held intact: a context file that documents this very
 * format contains `##` lines inside its example fence, and treating those as
 * real headings shreds the document into fragments titled after the example.
 */
export function splitSections(body, fallbackTitle) {
  const lines = body.split('\n');
  const sections = [];
  let title = null;
  let buffer = [];
  let inFence = false;

  const flush = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (!text) return;
    sections.push({ title: title || fallbackTitle, text });
  };

  for (const line of lines) {
    // ``` or ~~~ toggles a fence; the marker line itself stays in the body.
    if (/^[ \t]*(```|~~~)/.test(line)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }

    const h2 = /^##[ \t]+(.*\S)[ \t]*$/.exec(line);
    const h1 = /^#[ \t]+(.*\S)[ \t]*$/.exec(line);
    if (h2) {
      flush();
      title = h2[1];
      continue;
    }
    if (h1 && title === null && buffer.join('').trim() === '') {
      // The document's own H1 titles the preamble section.
      title = h1[1];
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

function readLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  // 0600: the ledger sits beside the memory database and names its contents.
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), { mode: 0o600 });
}

const hashOf = (project, source, title, text) =>
  crypto.createHash('sha256').update(`${project} ${source} ${title} ${text}`).digest('hex').slice(0, 32);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: import-context.mjs [--project NAME] [--dir PATH] [--dry-run] [--force]');
    return 0;
  }

  if (!fs.existsSync(args.dir)) {
    console.error(`context directory not found: ${args.dir}`);
    return 1;
  }

  const files = fs.readdirSync(args.dir).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) {
    console.error(`no .md files in ${args.dir}`);
    return 1;
  }

  if (!args.dryRun && !(await workerHealthy())) {
    console.error(`claude-mem worker is not answering on port ${resolveWorkerPort()}.`);
    console.error('Start it first (opening a new Claude Code session starts it), or re-run with --dry-run.');
    return 2;
  }

  // --force still loads the ledger: re-importing must update the existing
  // entries rather than strand them, or the next default run re-imports twice.
  const ledger = readLedger();
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const raw = fs.readFileSync(path.join(args.dir, file), 'utf-8');
    const { meta, body } = parseFrontMatter(raw);

    // A README explains the pack to a person; it is not context worth recalling
    // mid-task. Any file can opt out the same way with `import: false`.
    if (/^readme\.md$/i.test(file) || String(meta.import).toLowerCase() === 'false') {
      console.log(`skipping ${file} (not context)`);
      continue;
    }

    const project = args.project || meta.project || DEFAULT_PROJECT;
    const tags = Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [];
    const sections = splitSections(body, path.basename(file, '.md'));

    for (const section of sections) {
      const hash = hashOf(project, file, section.title, section.text);
      if (!args.force && ledger[hash]) {
        skipped++;
        continue;
      }

      if (args.dryRun) {
        console.log(`[dry-run] ${project} :: ${file} :: ${section.title} (${section.text.length} chars)`);
        imported++;
        continue;
      }

      const res = await saveMemory({
        title: section.title.slice(0, 120),
        text: section.text,
        project,
        metadata: {
          project,
          platformSource: 'officecli',
          importer: 'claude-mem-officecli',
          source: `integrations/officecli/context/${file}`,
          section: section.title,
          contentHash: hash,
          tags,
        },
      });

      if (res.ok && res.body?.success) {
        ledger[hash] = {
          id: res.body.id,
          title: section.title,
          project,
          importedAt: new Date().toISOString(),
        };
        imported++;
        console.log(`saved #${res.body.id}  ${project} :: ${section.title}`);
      } else {
        failed++;
        const detail = res.error || res.text?.slice(0, 200) || '';
        console.error(`FAILED  ${file} :: ${section.title} -> ${res.status} ${detail}`);
      }
    }
  }

  if (!args.dryRun) writeLedger(ledger);
  console.log(`\nimported ${imported}, skipped ${skipped} (already present), failed ${failed}`);
  return failed > 0 ? 3 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
