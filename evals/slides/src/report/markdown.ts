#!/usr/bin/env bun
/**
 * Render a run's report.json as the committed markdown record.
 *   bun src/report/markdown.ts <results-dir>
 */
import fs from 'node:fs';
import path from 'node:path';

const FAMILY_NAMES: Record<string, string> = {
  A: 'A · Pinpoint provenance',
  B: 'B · Taste synthesis',
  C: 'C · Style coverage',
  D: 'D · Abstention',
  E: 'E · Recency / supersession',
  F: 'F · Correction adherence',
};

const FAMILY_METHOD: Record<string, string> = {
  A: 'target recall over search→fetch results',
  B: 'reference-term coverage of the corpus answer',
  C: 'set recall + false-claim count',
  D: 'abstention rate (1 = correctly said nothing is known)',
  E: 'current value returned AND superseded value absent',
  F: 'target recall over search→fetch results',
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function renderMarkdown(report: any): string {
  const m = report.metadata;
  const lines: string[] = [];

  lines.push('# Slides memory eval — run report', '');
  lines.push(`- **Run**: ${m.timestamp}`);
  lines.push(`- **Project**: \`${m.project}\``);
  lines.push(`- **Semantic search (Chroma)**: ${m.chromaLive ? '**LIVE**' : '**DOWN — every number below means something different**'}`);
  lines.push(`- **Corpus route used for family B**: ${m.corpusUsed ? 'yes' : 'no (fell back to search)'}`);
  lines.push(`- **Ground truth**: ${m.decksTraced} decks, ${m.commandsTraced} officecli commands traced from their build.sh`);
  lines.push('');

  lines.push('## Scores by family', '');
  lines.push('| Family | Score | n | Scored by |');
  lines.push('|---|---|---|---|');
  for (const [f, v] of Object.entries(report.byFamily as Record<string, { n: number; mean: number }>)) {
    lines.push(`| ${FAMILY_NAMES[f] ?? f} | **${pct(v.mean)}** | ${v.n} | ${FAMILY_METHOD[f] ?? ''} |`);
  }
  lines.push('');
  lines.push(
    '> Families are scored by different mechanisms on purpose. A single blended number would',
    '> average a retrieval failure together with a synthesis failure and hide both.',
    ''
  );

  lines.push('## Per-question results', '');
  for (const f of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const rs = report.results.filter((r: any) => r.family === f);
    if (!rs.length) continue;
    lines.push(`### ${FAMILY_NAMES[f]}`, '');
    lines.push('| Question | Route | Hits | Score | Detail |');
    lines.push('|---|---|---|---|---|');
    for (const r of rs) {
      const q = String(r.question).replace(/\|/g, '\\|');
      lines.push(`| ${q} | ${r.route} | ${r.retrieved} | ${pct(r.score)} | ${String(r.detail).replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
    const missed = rs.flatMap((r: any) => r.missed ?? []);
    if (missed.length) lines.push(`Missed targets: \`${[...new Set(missed)].slice(0, 25).join('`, `')}\``, '');
    const fc = rs.flatMap((r: any) => r.falseClaims ?? []);
    if (fc.length) lines.push(`**False claims** (style elements named but never used): \`${[...new Set(fc)].join('`, `')}\``, '');
  }

  lines.push('## Scoring caveats', '');
  lines.push(`- ${m.scoringNote}`);
  lines.push(
    '- Family D measures the **retrieval surface**, not the agent. Top-k search always returns',
    '  results, so it can never itself signal "nothing relevant is known"; whether an agent reading',
    '  those results then abstains is a separate question this run does not test.'
  );
  lines.push('');
  return lines.join('\n');
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: markdown.ts <results-dir>');
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf-8'));
  const out = path.join(dir, 'report.md');
  fs.writeFileSync(out, renderMarkdown(report));
  console.log(`wrote ${out}`);
}
