/**
 * Measure how visually ambitious a deck is.
 *
 * The motivating finding: OfficeCLI supports 15 depth-and-finish properties and
 * the 51 reference styles use every one of them zero times, while their design
 * notes mention "gradient" 58 times and "glow" 22. Decks built by learning from
 * that library come out flat. This turns "flat" from an opinion into a count.
 *
 * It measures reach, not taste. A deck can score well here and still look bad —
 * the numbers catch regressions, they do not certify a design.
 */
import type { DeckTrace, TracedCommand } from './trace-build.ts';

/** Every property OfficeCLI offers that puts depth or finish on a shape. */
export const DEPTH_PROPS = [
  'shadow',
  'innerShadow',
  'glow',
  'reflection',
  'softEdge',
  'gradient',
  'pattern',
  'lineDash',
  'textWarp',
  'bevel',
  'bevelBottom',
  'depth',
  'material',
  'lighting',
  'highlight',
] as const;

/** The four that only read as 3D when used together. */
export const THREE_D_STACK = ['bevel', 'depth', 'material', 'lighting'] as const;

export interface AmbitionScore {
  deck: string;
  /** Which of the 15 depth properties the deck uses at all. */
  depthPropsUsed: string[];
  /** Commands that set at least one depth property. */
  depthCommands: number;
  /** Share of shape-creating commands carrying any depth property, 0..1. */
  depthShare: number;
  /** True when the deck sets three or more of the 3D stack on one shape. */
  hasThreeDHero: boolean;
  /** Distinct column arrangements across slides — repetition shows up here. */
  layoutSignatures: number;
  slides: number;
  /** Distinct arrangements per slide, 0..1. 1.0 = every slide laid out differently. */
  layoutVariety: number;
  /** Flat when it reaches for none of the 15. */
  flat: boolean;
}

const isShapeCommand = (c: TracedCommand) =>
  (c.verb === 'add' || c.verb === 'set') && c.type !== 'slide';

/**
 * A slide's layout signature is its set of distinct x positions, rounded.
 * Two slides built on the same column grid produce the same signature, which is
 * what "every slide is the same three cards again" looks like numerically.
 */
function layoutSignature(commands: TracedCommand[]): string {
  const xs = [...new Set(commands.map((c) => c.props.x).filter(Boolean))]
    .map((x) => String(x).replace(/(\d+\.\d)\d+/, '$1'))
    .sort();
  return xs.join('|');
}

export function scoreAmbition(trace: DeckTrace): AmbitionScore {
  const depthPropsUsed = DEPTH_PROPS.filter((p) =>
    trace.commands.some((c) => c.props[p] !== undefined)
  );

  const shapeCommands = trace.commands.filter(isShapeCommand);
  const depthCommands = shapeCommands.filter((c) =>
    DEPTH_PROPS.some((p) => c.props[p] !== undefined)
  ).length;

  const hasThreeDHero = trace.commands.some(
    (c) => THREE_D_STACK.filter((p) => c.props[p] !== undefined).length >= 3
  );

  const bySlide = new Map<number, TracedCommand[]>();
  for (const c of trace.commands) {
    if (!bySlide.has(c.slide)) bySlide.set(c.slide, []);
    bySlide.get(c.slide)!.push(c);
  }
  const signatures = new Set(
    [...bySlide.values()].map(layoutSignature).filter((s) => s.length > 0)
  );
  const slides = Math.max(trace.slideCount, bySlide.size);

  return {
    deck: trace.deck,
    depthPropsUsed: [...depthPropsUsed],
    depthCommands,
    depthShare: shapeCommands.length ? depthCommands / shapeCommands.length : 0,
    hasThreeDHero,
    layoutSignatures: signatures.size,
    slides,
    layoutVariety: slides ? signatures.size / slides : 0,
    flat: depthPropsUsed.length === 0,
  };
}

export interface AmbitionSummary {
  decks: number;
  flatDecks: number;
  /** Union of depth properties any deck reached for. */
  depthPropsUsed: string[];
  /** Depth properties no deck touches — the unused capability. */
  depthPropsUnused: string[];
  meanDepthShare: number;
  meanLayoutVariety: number;
  decksWithThreeDHero: number;
}

export function summarize(scores: AmbitionScore[]): AmbitionSummary {
  const used = [...new Set(scores.flatMap((s) => s.depthPropsUsed))].sort();
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    decks: scores.length,
    flatDecks: scores.filter((s) => s.flat).length,
    depthPropsUsed: used,
    depthPropsUnused: DEPTH_PROPS.filter((p) => !used.includes(p)),
    meanDepthShare: mean(scores.map((s) => s.depthShare)),
    meanLayoutVariety: mean(scores.map((s) => s.layoutVariety)),
    decksWithThreeDHero: scores.filter((s) => s.hasThreeDHero).length,
  };
}
