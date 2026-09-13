#!/usr/bin/env node
/**
 * KM's taste, stored in memory as decision rules.
 *
 * This is the thing memory is actually for here. A deck involves dozens of
 * small decisions — which accent, how much shadow, what goes on slide two —
 * and the system gets them wrong by guessing. Each guess is a wrong decision
 * waiting to happen, and a correction that has to be given again next time.
 *
 * So: every taste decision is a named slot. A slot is either DECIDED (KM said
 * so, recorded, reused forever) or OPEN (nobody has decided — ASK, never
 * invent). The whole point is that the system stops filling OPEN slots with
 * its own preferences.
 *
 * Usage:
 *   node taste.mjs list                       what is decided, what is open
 *   node taste.mjs open                       just the slots that need asking
 *   node taste.mjs get <slot>
 *   node taste.mjs set <slot> "<rule>" [--why "..."] [--source km|inferred]
 *   node taste.mjs veto "<what never to do>" [--why "..."]
 */
import { saveMemory, workerGet, workerHealthy, resolveWorkerPort } from './mem-client.mjs';

const PROJECT_DEFAULT = 'officecli';

/**
 * The decisions that actually go wrong on a deck. Each one is somewhere the
 * system would otherwise pick for itself.
 */
export const TASTE_SLOTS = {
  'palette.roles': 'The colour roles and their hex values — primary, secondary, accent, text, muted.',
  'palette.accent': 'The accent colour, and how much of a slide it is allowed to cover.',
  'type.pairing': 'Heading and body typefaces, and the weights used for each.',
  'type.scale': 'Size floors — smallest acceptable body size, minimum title size, title-to-body ratio.',
  'depth.policy': 'How much depth is right: shadows, 3D, gradients — none, restrained, or expressive.',
  'depth.hero': 'Whether a deck gets one hero object with real depth, and what qualifies as one.',
  'layout.repetition': 'Whether consecutive slides may share an arrangement, and how much variety is expected.',
  'layout.favourites': 'Compositions KM reaches for, and ones that feel wrong for this work.',
  'motif': 'The single visual device carried deck-wide, if any.',
  'order.default': 'Default slide order for a typical deck, and what must go last.',
  'density': 'How much goes on a slide — words, figures, negative space.',
  'charts.style': 'How figures are drawn: native charts, the figure library, or something else.',
  'imagery': 'Whether photography, illustration or pure geometry; and what is off-limits.',
  'brand.assets': 'Logo variants, where they sit, and the clear space around them.',
};

function parseArgs(argv) {
  const args = { _: [], project: PROJECT_DEFAULT, why: null, source: 'km' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--why') args.why = argv[++i];
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

const TITLE = (slot) => `TASTE ${slot}`;

/**
 * Read taste rows by listing the project, NOT by searching.
 *
 * Search is the wrong tool here and gets this dangerously wrong: a rule written
 * moments ago is not yet in Chroma, and on zero semantic hits the worker returns
 * empty rather than falling back to text matching. Looking taste up by search
 * therefore reports a decided slot as OPEN and the system asks KM a question it
 * already answered — the exact failure this file exists to prevent. Listing is
 * exact, immediate, and unaffected by indexing lag.
 */
async function fetchRows(project) {
  const params = new URLSearchParams({ project, limit: '200' });
  const res = await workerGet(`/api/observations?${params}`, { timeoutMs: 25000 });
  const body = res.body ?? {};
  const items = body.items ?? body.observations ?? body.results ?? [];
  return (Array.isArray(items) ? items : []).filter((o) =>
    String(o?.title ?? '').startsWith('TASTE')
  );
}

async function fetchAll(project) {
  const rows = await fetchRows(project);
  const decided = new Map();
  for (const slot of Object.keys(TASTE_SLOTS)) {
    const row = rows.find((o) => o.title === TITLE(slot));
    if (row) decided.set(slot, row);
  }
  return decided;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;

  if (!cmd || args.help) {
    console.log('usage: taste.mjs list | open | get <slot> | set <slot> "<rule>" | veto "<what>"');
    console.log('\nslots:');
    for (const [k, v] of Object.entries(TASTE_SLOTS)) console.log(`  ${k.padEnd(20)} ${v}`);
    return 0;
  }

  if (!(await workerHealthy())) {
    console.error(`claude-mem worker is not answering on port ${resolveWorkerPort()}.`);
    return 2;
  }

  if (cmd === 'list' || cmd === 'open') {
    const decided = await fetchAll(args.project);
    const openSlots = Object.keys(TASTE_SLOTS).filter((s) => !decided.has(s));

    if (cmd === 'open') {
      if (!openSlots.length) {
        console.log('Nothing open — every taste slot has a recorded decision.');
        return 0;
      }
      console.log('OPEN — ask KM, do not invent:\n');
      for (const s of openSlots) console.log(`  ${s.padEnd(20)} ${TASTE_SLOTS[s]}`);
      return 0;
    }

    console.log(`taste for project "${args.project}"\n`);
    for (const slot of Object.keys(TASTE_SLOTS)) {
      console.log(`${decided.has(slot) ? 'DECIDED' : 'OPEN   '}  ${slot.padEnd(20)} ${TASTE_SLOTS[slot]}`);
    }
    console.log(`\n${decided.size} decided, ${openSlots.length} open.`);
    if (openSlots.length) console.log('Open slots must be asked about, never guessed.');
    return 0;
  }

  if (cmd === 'get') {
    const slot = rest[0];
    if (!slot) {
      console.error('usage: taste.mjs get <slot>');
      return 1;
    }
    const decided = await fetchAll(args.project);
    const row = decided.get(slot);
    if (!row) {
      console.log(`OPEN: no decision recorded for "${slot}".`);
      console.log(`      ${TASTE_SLOTS[slot] ?? '(not a known slot)'}`);
      console.log('      Ask KM and record the answer with: taste.mjs set ' + slot + ' "<rule>"');
      return 3;
    }
    console.log(`${row.title}\n\n${row.narrative ?? row.text ?? ''}`);
    return 0;
  }

  if (cmd === 'set') {
    const [slot, rule] = rest;
    if (!slot || !rule) {
      console.error('usage: taste.mjs set <slot> "<rule>" [--why "..."] [--source km|inferred]');
      return 1;
    }
    if (!TASTE_SLOTS[slot]) {
      console.error(`"${slot}" is not a known slot. Run taste.mjs with no arguments to see the list.`);
      return 1;
    }
    // Source is recorded because a rule KM stated and a rule something inferred
    // are not equally trustworthy, and a later session needs to know which it is.
    const text =
      `${TASTE_SLOTS[slot]}\n\nRULE: ${rule}\n` +
      (args.why ? `WHY: ${args.why}\n` : '') +
      `SOURCE: ${args.source}\nRECORDED: ${new Date().toISOString()}`;
    const res = await saveMemory({
      title: TITLE(slot),
      text,
      project: args.project,
      metadata: { project: args.project, platformSource: 'officecli', kind: 'taste', slot, source: args.source },
    });
    if (res.ok && res.body?.success) {
      console.log(`recorded #${res.body.id}  ${slot}: ${rule}`);
      return 0;
    }
    console.error(`failed: ${res.status} ${res.error || res.text?.slice(0, 200) || ''}`);
    return 3;
  }

  if (cmd === 'veto') {
    const what = rest[0];
    if (!what) {
      console.error('usage: taste.mjs veto "<what never to do>" [--why "..."]');
      return 1;
    }
    const res = await saveMemory({
      title: `TASTE veto: ${what.slice(0, 80)}`,
      text: `NEVER: ${what}\n` + (args.why ? `WHY: ${args.why}\n` : '') + `RECORDED: ${new Date().toISOString()}`,
      project: args.project,
      metadata: { project: args.project, platformSource: 'officecli', kind: 'taste-veto' },
    });
    if (res.ok && res.body?.success) {
      console.log(`recorded veto #${res.body.id}: ${what}`);
      return 0;
    }
    console.error(`failed: ${res.status} ${res.error || ''}`);
    return 3;
  }

  console.error(`unknown command "${cmd}"`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
