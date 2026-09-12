/**
 * The question bank, as approved.
 *
 * Families A and C derive their answer keys mechanically from the build traces
 * — a hand-written key would drift from the decks and silently mark correct
 * answers wrong. Families B, D, E and F are authored, because "what taste is
 * prevalent", "what has no answer", "which value is current" and "what was
 * corrected" are claims about the corpus that no single deck states.
 */
import type { DeckTrace } from './groundtruth/trace-build.ts';

export type Family = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface EvalQuestion {
  id: string;
  family: Family;
  question: string;
  deck?: string;
  expect: {
    kind: 'provenance' | 'synthesis' | 'set' | 'abstain' | 'current-value' | 'correction';
    /** Strings the answer must contain (scored as recall over the list). */
    targets?: string[];
    /** Expected set members, for recall + precision. */
    set?: string[];
    /** Reference text the judge scores a synthesis answer against. */
    reference?: string;
    /** Strings whose presence is a failure (stale values, fabrications). */
    forbidden?: string[];
  };
}

const pick = <T,>(xs: T[], n: number): T[] => xs.slice(0, n);

/** Family A — pinpoint provenance, keyed off the traces. */
function familyA(traces: DeckTrace[]): EvalQuestion[] {
  const out: EvalQuestion[] = [];
  const withNames = traces.filter((t) => t.namedShapes.length > 0);

  for (const t of pick(withNames, 4)) {
    const shape = t.namedShapes[0];
    const cmd = t.commands.find((c) => c.props.name === shape);
    if (!cmd) continue;
    const geom = ['x', 'y', 'width', 'height']
      .map((k) => cmd.props[k])
      .filter((v): v is string => Boolean(v));

    out.push({
      id: `A-${t.deck}-shape`,
      family: 'A',
      deck: t.deck,
      question: `In the "${t.deck}" deck, what officecli command created the shape named ${shape}, and what properties did it set?`,
      expect: {
        kind: 'provenance',
        targets: [shape, cmd.verb, ...(cmd.props.fill ? [cmd.props.fill] : []), ...geom].filter(Boolean),
      },
    });

    if (t.fills.length) {
      out.push({
        id: `A-${t.deck}-fill`,
        family: 'A',
        deck: t.deck,
        question: `What fill colours were used in the "${t.deck}" deck?`,
        expect: { kind: 'provenance', targets: pick(t.fills, 5) },
      });
    }
  }

  const morph = traces.find((t) => t.transitions.includes('morph'));
  if (morph) {
    out.push({
      id: 'A-transition',
      family: 'A',
      deck: morph.deck,
      question: `What slide transition was configured in the "${morph.deck}" deck?`,
      expect: { kind: 'provenance', targets: ['morph'] },
    });
  }
  return out;
}

/** Family C — coverage, keyed off the union of traced props. */
function familyC(traces: DeckTrace[]): EvalQuestion[] {
  const universe = [...new Set(traces.flatMap((t) => t.propKeys))].sort();
  const fonts = [...new Set(traces.flatMap((t) => t.fonts))].sort();
  const transitions = [...new Set(traces.flatMap((t) => t.transitions))].sort();
  const out: EvalQuestion[] = [
    {
      id: 'C-style-elements',
      family: 'C',
      question:
        'What style elements are used across these decks? List the shape and slide properties that were actually set.',
      expect: { kind: 'set', set: universe },
    },
    {
      id: 'C-fonts',
      family: 'C',
      question: 'What fonts appear across the decks?',
      expect: { kind: 'set', set: fonts },
    },
    {
      id: 'C-transitions',
      family: 'C',
      question: 'What slide transition types are used across the decks?',
      expect: { kind: 'set', set: transitions },
    },
  ];

  const deck = traces.find((t) => t.deck === 'bw--swiss-bauhaus') ?? traces[0];
  if (deck) {
    out.push({
      id: `C-${deck.deck}-props`,
      family: 'C',
      deck: deck.deck,
      question: `Which shape and slide properties were set when building the "${deck.deck}" deck?`,
      expect: { kind: 'set', set: deck.propKeys },
    });
  }
  return out;
}

/**
 * Family B — taste synthesis. The reference is assembled from the corpus
 * fingerprint rather than hand-written, so it cannot drift from the decks.
 */
function familyB(traces: DeckTrace[]): EvalQuestion[] {
  const fonts = [...new Set(traces.flatMap((t) => t.fonts))];
  const allFills = traces.flatMap((t) => t.fills);
  const fillsPerDeck = Math.round(allFills.length / Math.max(traces.length, 1));
  const morphShare = traces.filter((t) => t.transitions.includes('morph')).length;
  const namespaced = traces.filter((t) => t.namedShapes.some((n) => n.startsWith('!!'))).length;

  const reference = [
    `The corpus is ${traces.length} officecli-built reference decks, ${traces[0]?.slideCount ?? 5}-7 slides each.`,
    `Colour: a tight per-deck palette (about ${fillsPerDeck} distinct fills per deck), applied as flat fills with`,
    `opacity used for depth rather than extra hues. Typography: a small set of families (${fonts.slice(0, 6).join(', ')}),`,
    `heading/body pairing with a strong size hierarchy. Motion: ${morphShare} of ${traces.length} decks use morph transitions.`,
    `Structure: shapes are explicitly named and positioned in cm with hand-computed grid maths — there is no layout engine.`,
    `${namespaced} decks use the !!scene / #sN naming namespace to carry persistent elements across slides.`,
    `Taste: geometric, flat, high-contrast, restrained palettes, deliberate negative space; a single visual motif carried deck-wide.`,
  ].join(' ');

  return [
    {
      id: 'B-prevalent-taste',
      family: 'B',
      question: 'What taste is prevalent across all these slides?',
      expect: { kind: 'synthesis', reference },
    },
    {
      id: 'B-colour-discipline',
      family: 'B',
      question: 'What is the colour discipline across the decks — how many colours per deck, and how are they used?',
      expect: { kind: 'synthesis', reference },
    },
    {
      id: 'B-typography',
      family: 'B',
      question: 'What typographic posture is consistent across the decks?',
      expect: { kind: 'synthesis', reference },
    },
    {
      id: 'B-house-rules',
      family: 'B',
      question:
        'If you were to build a new deck in this house style, what five rules would you follow? Be specific to these decks.',
      expect: { kind: 'synthesis', reference },
    },
  ];
}

/** Family D — questions with no answer in memory. Abstention is the correct behaviour. */
function familyD(): EvalQuestion[] {
  return [
    {
      id: 'D-no-slide-9',
      family: 'D',
      question: 'What code built slide 9\'s third quadrant in the swiss-bauhaus deck?',
      expect: { kind: 'abstain', forbidden: ['quadrant'] },
    },
    {
      id: 'D-helvetica-licence',
      family: 'D',
      question: 'What did we decide about the Helvetica Neue licensing for these decks?',
      expect: { kind: 'abstain', forbidden: ['decided', 'licence agreed', 'we chose'] },
    },
    {
      id: 'D-missing-shape',
      family: 'D',
      question: 'What animation was applied to the shape named !!blk-z?',
      expect: { kind: 'abstain' },
    },
    {
      id: 'D-cherry-bold',
      family: 'D',
      question: 'Which of these decks uses the Cherry Bold palette?',
      expect: { kind: 'abstain' },
    },
  ];
}

/** Families E and F pair with seed-synthetic.ts, which writes the memories they ask about. */
export const SYNTHETIC_FACTS = {
  accent: { old: '#2E5AAC', mid: '#1E88C7', current: '#0FB5A0' },
  margin: { old: '1.27cm', current: '1.5cm' },
  transitionDefault: { old: 'fade', current: 'morph' },
  ancientDecision: 'decks are archived as PDF alongside the .pptx',
  corrections: {
    order: 'the ask slide goes last, never second',
    title: 'no decorative underline under slide titles',
    never: 'never use emoji as iconography',
  },
};

function familyE(): EvalQuestion[] {
  const f = SYNTHETIC_FACTS;
  return [
    {
      id: 'E-accent-current',
      family: 'E',
      question: 'What is the current accent colour for the house deck style?',
      expect: { kind: 'current-value', targets: [f.accent.current], forbidden: [f.accent.old, f.accent.mid] },
    },
    {
      id: 'E-margin-current',
      family: 'E',
      question: 'What slide margin are we using now?',
      expect: { kind: 'current-value', targets: [f.margin.current], forbidden: [f.margin.old] },
    },
    {
      id: 'E-transition-current',
      family: 'E',
      question: 'What is the current default slide transition for house decks?',
      expect: { kind: 'current-value', targets: [f.transitionDefault.current], forbidden: [f.transitionDefault.old] },
    },
    {
      id: 'E-old-decision',
      family: 'E',
      question: 'How are finished decks archived?',
      // Recorded 120 days ago and never superseded: a direct probe of the
      // 90-day recency window in Chroma search.
      expect: { kind: 'current-value', targets: ['PDF'] },
    },
  ];
}

function familyF(): EvalQuestion[] {
  const c = SYNTHETIC_FACTS.corrections;
  return [
    {
      id: 'F-slide-order',
      family: 'F',
      question: 'What was corrected about slide order in these decks?',
      expect: { kind: 'correction', targets: ['ask', 'last'] },
    },
    {
      id: 'F-title-treatment',
      family: 'F',
      question: 'What was rejected about the title treatment?',
      expect: { kind: 'correction', targets: ['underline'] },
    },
    {
      id: 'F-never-again',
      family: 'F',
      question: 'Is there anything we were told never to do again in these decks?',
      expect: { kind: 'correction', targets: ['emoji'] },
    },
  ];
}

export function buildQuestionBank(traces: DeckTrace[]): EvalQuestion[] {
  return [...familyA(traces), ...familyB(traces), ...familyC(traces), ...familyD(), ...familyE(), ...familyF()];
}
