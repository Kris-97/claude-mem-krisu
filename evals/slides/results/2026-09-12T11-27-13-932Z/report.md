# Slides memory eval — run report

- **Run**: 2026-09-12T11:27:13.932Z
- **Project**: `evalproj`
- **Semantic search (Chroma)**: **LIVE**
- **Corpus route used for family B**: yes
- **Ground truth**: 27 decks, 3582 officecli commands traced from their build.sh

## Scores by family

| Family | Score | n | Scored by |
|---|---|---|---|
| A · Pinpoint provenance | **100%** | 9 | target recall over search→fetch results |
| B · Taste synthesis | **31%** | 4 | reference-term coverage of the corpus answer |
| C · Style coverage | **88%** | 4 | set recall + false-claim count |
| D · Abstention | **0%** | 4 | abstention rate (1 = correctly said nothing is known) |
| E · Recency / supersession | **25%** | 4 | current value returned AND superseded value absent |
| F · Correction adherence | **50%** | 3 | target recall over search→fetch results |

> Families are scored by different mechanisms on purpose. A single blended number would
> average a retrieval failure together with a synthesis failure and hide both.

## Per-question results

### A · Pinpoint provenance

| Question | Route | Hits | Score | Detail |
|---|---|---|---|---|
| In the "bw--brutalist-raw" deck, what officecli command created the shape named !!border-box, and what properties did it set? | search | 12 | 100% | 7/7 targets present |
| What fill colours were used in the "bw--brutalist-raw" deck? | search | 12 | 100% | 4/4 targets present |
| In the "bw--mono-line" deck, what officecli command created the shape named !!line-h-top, and what properties did it set? | search | 12 | 100% | 7/7 targets present |
| What fill colours were used in the "bw--mono-line" deck? | search | 12 | 100% | 3/3 targets present |
| In the "bw--swiss-bauhaus" deck, what officecli command created the shape named !!blk-a, and what properties did it set? | search | 12 | 100% | 7/7 targets present |
| What fill colours were used in the "bw--swiss-bauhaus" deck? | search | 12 | 100% | 5/5 targets present |
| In the "dark--architectural-plan" deck, what officecli command created the shape named !!bg-panel, and what properties did it set? | search | 12 | 100% | 7/7 targets present |
| What fill colours were used in the "dark--architectural-plan" deck? | search | 12 | 100% | 5/5 targets present |
| What slide transition was configured in the "bw--brutalist-raw" deck? | search | 12 | 100% | 1/1 targets present |

### B · Taste synthesis

| Question | Route | Hits | Score | Detail |
|---|---|---|---|---|
| What taste is prevalent across all these slides? | corpus | 1 | 40% | 10/25 targets present |
| What is the colour discipline across the decks — how many colours per deck, and how are they used? | corpus | 1 | 32% | 8/25 targets present |
| What typographic posture is consistent across the decks? | corpus | 1 | 36% | 9/25 targets present |
| If you were to build a new deck in this house style, what five rules would you follow? Be specific to these decks. | corpus | 1 | 16% | 4/25 targets present |

Missed targets: `corpus`, `officecli-built`, `reference`, `Colour`, `tight`, `per-deck`, `distinct`, `fills`, `applied`, `extra`, `small`, `families`, `Black`, `Courier`, `heading`, `slides`, `opacity`, `Typography`, `Arial`, `Segoe`, `Inter`, `palette`, `depth`, `decks`

### C · Style coverage

| Question | Route | Hits | Score | Detail |
|---|---|---|---|---|
| What style elements are used across these decks? List the shape and slide properties that were actually set. | search | 12 | 88% | recall 22/25 |
| What fonts appear across the decks? | search | 12 | 65% | recall 11/17, 1 false claim(s) |
| What slide transition types are used across the decks? | search | 12 | 100% | recall 1/1 |
| Which shape and slide properties were set when building the "bw--swiss-bauhaus" deck? | search | 12 | 100% | recall 15/15 |

Missed targets: `geometry`, `lineOpacity`, `margin`, `Helvetica`, `LXGW WenKai`, `Montserrat Bold`, `Noto Serif`, `PingFang SC`, `Segoe UI Light`

**False claims** (style elements named but never used): `glow`

### D · Abstention

| Question | Route | Hits | Score | Detail |
|---|---|---|---|---|
| What code built slide 9's third quadrant in the swiss-bauhaus deck? | search | 12 | 0% | answered confidently when it should have abstained |
| What did we decide about the Helvetica Neue licensing for these decks? | search | 12 | 0% | answered confidently when it should have abstained |
| What animation was applied to the shape named !!blk-z? | search | 12 | 0% | answered confidently when it should have abstained |
| Which of these decks uses the Cherry Bold palette? | search | 12 | 0% | answered confidently when it should have abstained |

### E · Recency / supersession

| Question | Route | Hits | Score | Detail |
|---|---|---|---|---|
| What is the current accent colour for the house deck style? | search | 12 | 0% | 1/1 targets present; returned SUPERSEDED value(s): #2E5AAC, #1E88C7 |
| What slide margin are we using now? | search | 12 | 0% | 1/1 targets present; returned SUPERSEDED value(s): 1.27cm |
| What is the current default slide transition for house decks? | search | 12 | 0% | 1/1 targets present; returned SUPERSEDED value(s): fade |
| How are finished decks archived? | search | 12 | 100% | 1/1 targets present |

### F · Correction adherence

| Question | Route | Hits | Score | Detail |
|---|---|---|---|---|
| What was corrected about slide order in these decks? | search | 12 | 50% | 1/2 targets present |
| What was rejected about the title treatment? | search | 12 | 100% | 1/1 targets present |
| Is there anything we were told never to do again in these decks? | search | 12 | 0% | 0/1 targets present |

Missed targets: `ask`, `emoji`

## Scoring caveats

- Family B uses deterministic reference-term coverage as a proxy for the LLM judge; full answers are included so the judgement stays inspectable.
- Family D measures the **retrieval surface**, not the agent. Top-k search always returns
  results, so it can never itself signal "nothing relevant is known"; whether an agent reading
  those results then abstains is a separate question this run does not test.
