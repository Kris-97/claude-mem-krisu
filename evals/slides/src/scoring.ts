/**
 * Scoring. Each family is scored by the mechanism its question type demands —
 * a single blended number would average a retrieval failure together with a
 * synthesis failure and hide both.
 */
import type { EvalQuestion } from './questions.ts';

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`'"*_]/g, '')
    .replace(/\s+/g, ' ');

/** Hex colours and measurements must match loosely (#1E2761 vs 1e2761 vs 1E2761). */
function contains(haystack: string, needle: string): boolean {
  const h = normalize(haystack);
  const n = normalize(needle).replace(/^#/, '');
  if (!n) return false;
  if (h.includes(n)) return true;
  // "1.5cm" should also match "1.5 cm"; "morph" should match "morph-slow".
  const spaced = n.replace(/([\d.]+)(cm|pt|px)/, '$1 $2');
  return h.includes(spaced);
}

export interface Score {
  /** 0..1 */
  value: number;
  detail: string;
  found: string[];
  missed: string[];
}

export function scoreTargets(answer: string, targets: string[]): Score {
  const found = targets.filter((t) => contains(answer, t));
  const missed = targets.filter((t) => !contains(answer, t));
  return {
    value: targets.length ? found.length / targets.length : 0,
    detail: `${found.length}/${targets.length} targets present`,
    found,
    missed,
  };
}

/**
 * Style elements that OfficeCLI supports but these decks never use. Claiming
 * one is a fabrication, and counting them is the only honest precision proxy
 * available when the answer is free prose rather than a parseable list.
 */
export const PLAUSIBLE_BUT_ABSENT = [
  'bevel',
  'reflection',
  'softEdge',
  'innerShadow',
  'textWarp',
  'lineDash',
  'pattern',
  'glow',
];

export function scoreSet(answer: string, expected: string[]): Score & { falseClaims: string[] } {
  const found = expected.filter((e) => contains(answer, e));
  const missed = expected.filter((e) => !contains(answer, e));
  const falseClaims = PLAUSIBLE_BUT_ABSENT.filter(
    (p) => !expected.some((e) => e.toLowerCase() === p.toLowerCase()) && contains(answer, p)
  );
  const recall = expected.length ? found.length / expected.length : 0;
  return {
    value: recall,
    detail: `recall ${found.length}/${expected.length}${falseClaims.length ? `, ${falseClaims.length} false claim(s)` : ''}`,
    found,
    missed,
    falseClaims,
  };
}

const ABSTENTION_MARKERS = [
  'no memory',
  'no observation',
  'not recorded',
  'no record',
  'nothing in memory',
  'no results',
  'no information',
  'not found',
  'cannot find',
  "couldn't find',",
  'could not find',
  "don't have",
  'do not have',
  'no matching',
  'unknown',
  'not mentioned',
  'no data',
  'none of',
  'no such',
];

/** For family D the correct behaviour is admitting ignorance. */
export function scoreAbstention(answer: string, forbidden: string[] = []): Score {
  const text = normalize(answer);
  const abstained = ABSTENTION_MARKERS.some((m) => text.includes(m)) || text.trim().length < 40;
  const fabricated = forbidden.filter((f) => contains(answer, f));
  const value = abstained && fabricated.length === 0 ? 1 : 0;
  return {
    value,
    detail: abstained
      ? fabricated.length
        ? `abstained but still asserted: ${fabricated.join(', ')}`
        : 'correctly abstained'
      : 'answered confidently when it should have abstained',
    found: fabricated,
    missed: [],
  };
}

/** For family E, returning the superseded value is worse than returning nothing. */
export function scoreCurrentValue(answer: string, targets: string[], forbidden: string[] = []): Score {
  const base = scoreTargets(answer, targets);
  const stale = forbidden.filter((f) => contains(answer, f));
  if (stale.length) {
    return { ...base, value: 0, detail: `${base.detail}; returned SUPERSEDED value(s): ${stale.join(', ')}`, found: stale };
  }
  return base;
}

export function scoreQuestion(q: EvalQuestion, answer: string): Score & { falseClaims?: string[] } {
  switch (q.expect.kind) {
    case 'set':
      return scoreSet(answer, q.expect.set ?? []);
    case 'abstain':
      return scoreAbstention(answer, q.expect.forbidden);
    case 'current-value':
      return scoreCurrentValue(answer, q.expect.targets ?? [], q.expect.forbidden);
    case 'synthesis': {
      // Deterministic proxy for the LLM judge: how much of the reference's
      // substance the answer covers. Reported alongside the full answer so the
      // judgement stays inspectable rather than hidden behind a number.
      const terms = [...new Set((q.expect.reference ?? '').match(/[A-Za-z][A-Za-z-]{4,}/g) ?? [])]
        .filter((t) => !['there', 'their', 'which', 'these', 'those', 'about', 'across', 'rather', 'than'].includes(t.toLowerCase()))
        .slice(0, 25);
      return scoreTargets(answer, terms);
    }
    case 'provenance':
    case 'correction':
    default:
      return scoreTargets(answer, q.expect.targets ?? []);
  }
}
