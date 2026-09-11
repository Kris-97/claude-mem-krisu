#!/usr/bin/env node
/**
 * Write one memory into the local claude-mem database.
 *
 * The MCP `observation_add` tool is server-runtime only (it calls /v1/memories
 * on a server-beta install), so on a normal desktop install it is not a way to
 * record anything. The worker's POST /api/memory/save is, and that is what this
 * wraps — which makes it the recording half of the slides-memory loop.
 *
 * Usage:
 *   node remember.mjs --title "Evli deck: 16:9, Söhne headings" "body text..."
 *   echo "body text" | node remember.mjs --title "..." --project officecli
 */
import { saveMemory, workerHealthy, resolveWorkerPort } from './mem-client.mjs';

function parseArgs(argv) {
  const args = { title: null, project: 'officecli', tags: [], text: null, help: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') args.title = argv[++i];
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--tag') args.tags.push(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else rest.push(a);
  }
  if (rest.length) args.text = rest.join(' ');
  return args;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: remember.mjs [--title T] [--project P] [--tag X]... "text"   (or pipe text on stdin)');
    return 0;
  }

  const text = (args.text || (await readStdin())).trim();
  if (!text) {
    console.error('nothing to save: pass text as an argument or pipe it on stdin');
    return 1;
  }

  if (!(await workerHealthy())) {
    console.error(`claude-mem worker is not answering on port ${resolveWorkerPort()}; memory not saved.`);
    return 2;
  }

  const res = await saveMemory({
    text,
    title: args.title || undefined,
    project: args.project,
    metadata: {
      project: args.project,
      platformSource: 'officecli',
      importer: 'claude-mem-officecli',
      source: 'slides-memory-skill',
      tags: args.tags,
    },
  });

  if (res.ok && res.body?.success) {
    console.log(`saved #${res.body.id} to project "${res.body.project}": ${res.body.title}`);
    return 0;
  }
  console.error(`save failed: ${res.status} ${res.error || res.text?.slice(0, 300) || ''}`);
  return 3;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
