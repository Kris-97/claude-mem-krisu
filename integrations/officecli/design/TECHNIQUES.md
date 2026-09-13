# Depth and finish techniques for OfficeCLI decks

Every property here is supported by OfficeCLI and used **zero times** across all
51 reference styles. That gap is why generated decks come out flat: the reference
library's prose talks about gradients and glow constantly (58 and 22 mentions)
while its build scripts set neither, so anything learning from it produces flat
fills and calls them a design.

Syntax below is taken from `schemas/help/pptx/shape.json` — the same schema
`officecli help pptx shape --json` prints. **These snippets are schema-derived
and have not been rendered**, because the cloud container has no .NET to run
`officecli`. Treat the syntax as correct and the visual result as unverified
until run on a machine that can build a deck.

---

## 1. Depth on a surface — `shadow`, `innerShadow`

The cheapest way to stop a card looking like coloured paper.

```bash
--prop shadow=#000000                       # black, default blur/angle/distance
--prop shadow=0F2D46-12-45-6-35             # color-blur-angle-dist-opacity
--prop innerShadow=000000-8-90-3-40         # same grammar, pressed-in instead
--prop shadow=none                          # clears it
```

`color-blur-angle-dist-opacity`: blur and distance in points, angle in degrees,
opacity as a percentage. Colour accepts hex with or without `#`, 8-digit
`RRGGBBAA`, or a scheme name.

**Use it for**: lifting a KPI card off its background; separating a foreground
panel from a full-bleed image. **Restraint**: one shadow depth per deck. Two
different blurs on the same slide reads as an accident.

## 2. True 3D — `bevel` + `depth` + `material` + `lighting`

This is the one nothing in the reference library touches, and the one that makes
a shape look built rather than drawn. All four work together; setting `bevel`
alone is barely visible.

```bash
--prop bevel=circle-6-6 \
--prop depth=12pt \
--prop material=metal \
--prop lighting=threePt
```

- **bevel** — `preset[-width[-height]]`, sizes in points. Presets: `angle`,
  `artDeco`, `circle`, `convex`, `coolSlant`, `cross`, `divot`, `hardEdge`,
  `relaxedInset`, `riblet`, `slope`, `softRound`. `bevelBottom` takes the same
  grammar.
- **depth** — extrusion height. Bare number is points; `pt/cm/in/px/emu` accepted.
- **material** — `clear`, `darkEdge`, `flat`, `matte`, `metal`, `plastic`,
  `powder`, `softEdge`, `softMetal`, `translucentPowder`, `warmMatte`,
  `wireframe`.
- **lighting** — `threePt`, `balanced`, `soft`, `harsh`, `flood`, `contrasting`,
  `morning`, `sunrise`, `sunset`, `chilly`, `freezing`, `flat`, `twoPt`, `glow`,
  `brightRoom`.

**Combinations worth knowing**: `matte` + `soft` reads editorial and expensive;
`metal` + `threePt` reads technical; `translucentPowder` + `brightRoom` reads
light and modern. `wireframe` is a diagram, not a decoration.

**Use it for**: a single hero object — one number, one shape, one logo mark.
**Restraint**: one 3D object per slide, at most a few per deck. Extruding every
card is the fastest way to look like 2007.

## 3. Gradient fields — `gradient`

A gradient ground is the difference between "navy slide" and "designed slide".

```bash
--prop gradient=0F2D46-1B4E6F                    # linear, two stops
--prop gradient=0F2D46-1B4E6F-135                # with angle
--prop gradient=radial:1B4E6F-0F2D46-center      # radial, focus tl/tr/bl/br/center
--prop gradient=path:0F2D46-2A6B8F-tl            # path gradient
--prop gradient=0F2D46@0-1B4E6F@60-FFFFFF@100    # per-stop positions
```

The per-stop form (`C@PCT`) is the expressive one: it lets a gradient hold most
of its range in one colour and break late, which is what makes a field feel
lit rather than smeared.

**Use it for**: full-bleed section openers, the ground behind a hero stat.
**Restraint**: two stops of the same hue family beats three of different hues.

## 4. Light and emphasis — `glow`, `highlight`, `reflection`

```bash
--prop glow=#1B4E6F                 # colour, or 'true' for accent blue
--prop highlight=accent1            # text highlight behind glyphs; any colour
--prop reflection=tight             # true | tight | half | full | none
```

`highlight` is more useful than it sounds: unlike Word it takes any colour, so a
brand-tinted highlight behind a single line of type is a clean emphasis device
that does not need a shape behind it.

**Use it for**: glow on a single accent mark; reflection under a hero object on a
dark ground. **Restraint**: `reflection=full` almost always looks worse than
`tight`.

## 5. Texture — `pattern`

```bash
--prop pattern=diagBrick:0F2D46:FFFFFF     # preset:fg:bg
--prop pattern=ltUpDiag:1B4E6F             # fg only, bg defaults white
```

**Use it for**: a texture band behind a section number, a low-contrast fill that
survives projection better than a 5% tint. **Restraint**: pattern reads as noise
at small sizes — use it on areas, never on type.

## 6. Edge treatment — `softEdge`, `lineDash`, `line`

```bash
--prop softEdge=8                            # feathered edge in points
--prop lineDash=dash                         # solid|dot|dash|dashDot|lgDash|…
--prop line=0F2D46:2pt:dash                  # compound colour:width:style
```

**Use it for**: `softEdge` to blend an image panel into the ground instead of
cutting it with a hard rectangle. A dashed rule carries "projected/forecast" in a
financial chart without a legend entry.

## 7. Type as image — `textWarp`

```bash
--prop textWarp=textArchUp    # none|textPlain|textArchUp|textArchDown|textCircle
                              # textWave1|textWave2|textInflate|textDeflate
                              # textCanUp|textCanDown|textNoShape
```

**Use it for**: one display word on a cover. **Restraint**: this is the most
dated-looking property in the whole set. `textArchUp` on a single word can work;
`textWave2` on a headline cannot.

---

## Evli brand anchors

Taken from the brand assets in `Kris-97/OfficeCLI` (`69a8f22`), not invented:

- **Navy `#0F2D46`** — the logo colour, from `assets/logos/evli/*.svg`
- **White `#FFFFFF`** — the reverse
- **PP Formula** — Light, Medium, Extrabold, at `assets/fonts/evli/`
  (`.otf`/`.ttf` for PowerPoint, `.woff`/`.woff2` for web)
- **Logos** — navy and white, each with a `-flat` variant

A gradient built from navy toward a lighter tint of itself (`0F2D46-1B4E6F`)
stays on brand while giving a ground something to do. There is no second brand
colour in the assets, so an accent is a decision to make deliberately rather than
one to assume — ask before inventing one.

## The rule this library exists to enforce

A deck built only from flat fills, position and size is **unfinished**. At least
one deliberate depth or finish decision per deck, and one hero moment that uses
the 3D stack or a gradient field. Not every shape — one, chosen.
