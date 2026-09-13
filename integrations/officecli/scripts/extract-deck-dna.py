#!/usr/bin/env python3
"""Read a .pptx's design DNA straight out of the file.

A .pptx is a zip of XML, so the theme palette, the master fonts, the layouts and
every depth/finish effect can be read without PowerPoint, without officecli and
without .NET — which matters here, because the cloud container has none of them.

What it pulls out:
  - the full theme colour scheme as exact hex (dk1/dk2, lt1/lt2, accent1-6,
    hyperlink colours) — i.e. the real brand palette, not a transcription
  - the major/minor fonts the master actually specifies
  - slide layout names
  - per-slide use of the 15 depth-and-finish effects, so a benchmark deck can be
    compared against generated ones on the same measure

Usage:
  python3 extract-deck-dna.py <deck.pptx> [--json]
"""
import argparse
import json
import re
import sys
import zipfile
from collections import Counter
from xml.etree import ElementTree as ET

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"

# DrawingML element -> the officecli property it corresponds to, so the output
# speaks the same vocabulary as the build scripts and the ambition measure.
EFFECT_ELEMENTS = {
    f"{A}outerShdw": "shadow",
    f"{A}innerShdw": "innerShadow",
    f"{A}glow": "glow",
    f"{A}reflection": "reflection",
    f"{A}softEdge": "softEdge",
    f"{A}gradFill": "gradient",
    f"{A}pattFill": "pattern",
    f"{A}prstDash": "lineDash",
    f"{A}prstTxWarp": "textWarp",
    f"{A}bevelT": "bevel",
    f"{A}bevelB": "bevelBottom",
    f"{A}sp3d": "depth",
    f"{A}prstMaterial": "material",
    f"{A}lightRig": "lighting",
    f"{A}highlight": "highlight",
}

COLOUR_ROLES = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3",
                "accent4", "accent5", "accent6", "hlink", "folHlink"]


def colour_of(node):
    """A scheme colour is srgbClr val=, or sysClr with a lastClr fallback."""
    if node is None:
        return None
    srgb = node.find(f"{A}srgbClr")
    if srgb is not None:
        return "#" + srgb.get("val", "").upper()
    sysclr = node.find(f"{A}sysClr")
    if sysclr is not None and sysclr.get("lastClr"):
        return "#" + sysclr.get("lastClr", "").upper()
    return None


def read_theme(zf):
    names = [n for n in zf.namelist() if re.match(r"ppt/theme/theme\d+\.xml$", n)]
    if not names:
        return {}, {}
    root = ET.fromstring(zf.read(sorted(names)[0]))
    scheme = root.find(f".//{A}clrScheme")
    palette = {}
    if scheme is not None:
        for role in COLOUR_ROLES:
            el = scheme.find(f"{A}{role}")
            value = colour_of(el)
            if value:
                palette[role] = value

    fonts = {}
    font_scheme = root.find(f".//{A}fontScheme")
    if font_scheme is not None:
        for key, tag in (("heading", "majorFont"), ("body", "minorFont")):
            latin = font_scheme.find(f"{A}{tag}/{A}latin")
            if latin is not None and latin.get("typeface"):
                fonts[key] = latin.get("typeface")
    return palette, fonts


def read_layouts(zf):
    out = []
    for name in sorted(n for n in zf.namelist()
                       if re.match(r"ppt/slideLayouts/slideLayout\d+\.xml$", n)):
        root = ET.fromstring(zf.read(name))
        csld = root.find(f".//{P}cSld")
        if csld is not None and csld.get("name"):
            out.append(csld.get("name"))
    return out


def slide_sort_key(name):
    m = re.search(r"(\d+)\.xml$", name)
    return int(m.group(1)) if m else 0


def read_slides(zf):
    slides = []
    names = sorted((n for n in zf.namelist()
                    if re.match(r"ppt/slides/slide\d+\.xml$", n)), key=slide_sort_key)
    for name in names:
        root = ET.fromstring(zf.read(name))
        effects = Counter()
        for el in root.iter():
            prop = EFFECT_ELEMENTS.get(el.tag)
            if prop:
                effects[prop] += 1
        fills = Counter()
        for el in root.iter(f"{A}srgbClr"):
            val = el.get("val")
            if val:
                fills["#" + val.upper()] += 1
        shapes = sum(1 for _ in root.iter(f"{P}sp"))
        slides.append({
            "slide": slide_sort_key(name),
            "shapes": shapes,
            "effects": dict(effects),
            "top_colours": [c for c, _ in fills.most_common(6)],
        })
    return slides


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("deck")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    try:
        zf = zipfile.ZipFile(args.deck)
    except (zipfile.BadZipFile, FileNotFoundError) as exc:
        print(f"cannot read {args.deck}: {exc}", file=sys.stderr)
        return 1

    with zf:
        palette, fonts = read_theme(zf)
        layouts = read_layouts(zf)
        slides = read_slides(zf)

    used = Counter()
    for s in slides:
        used.update(s["effects"])

    result = {
        "deck": args.deck,
        "palette": palette,
        "fonts": fonts,
        "layouts": layouts,
        "slides": len(slides),
        "effects_used": dict(used),
        "effects_unused": [p for p in sorted(set(EFFECT_ELEMENTS.values())) if p not in used],
        "per_slide": slides,
    }

    if args.json:
        print(json.dumps(result, indent=2))
        return 0

    print(f"{args.deck}\n{'=' * len(args.deck)}")
    print(f"\nPALETTE ({len(palette)} roles)")
    for role in COLOUR_ROLES:
        if role in palette:
            print(f"  {role:<10} {palette[role]}")
    print("\nFONTS")
    for k, v in fonts.items():
        print(f"  {k:<10} {v}")
    print(f"\nLAYOUTS ({len(layouts)})")
    for name in layouts:
        print(f"  - {name}")
    print(f"\nSLIDES: {len(slides)}")
    print("\nDEPTH & FINISH EFFECTS USED")
    if used:
        for prop, count in used.most_common():
            print(f"  {prop:<14} {count}")
    else:
        print("  none — this deck is flat")
    print(f"\nNEVER USED: {', '.join(result['effects_unused']) or '(none)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
