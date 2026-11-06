#!/usr/bin/env python3
"""Compute theoretical seam-free line-height limits from font tables.

For a line box of height L, Chromium centres the font's content area
(ascent + descent) in the box, so the baseline sits at

    baseline = (L - (asc + desc)) / 2 + asc        (from the line-box top)

A glyph spanning [baseline - top, baseline + bottom] fills its line box,
and therefore connects with the same glyph on the next row, iff

    L <= 2*top - asc + desc     and     L <= 2*bottom + asc - desc

The smaller bound, in em, is the largest seam-free line-height ratio
before pixel rounding. Chromium rounds ascent and descent to whole pixels,
so the empirical limit (tools/calibrate.js) can be slightly lower.

Usage: python3 tools/font-limits.py > fonts/metrics.json
"""
import glob
import json
import os
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINE_GLYPHS = [0x2502, 0x2551, 0x2503, 0x253C]  # │ ║ ┃ ┼
BLOCK_GLYPHS = [0x2588]                         # █


def vertical_metrics(font):
    """Ascent/descent pairs Chromium may use, in font units (descent positive)."""
    hhea, os2 = font["hhea"], font["OS/2"]
    use_typo = bool(os2.fsSelection & (1 << 7))
    out = {
        "hhea": (hhea.ascent, -hhea.descent),
        "typo": (os2.sTypoAscender, -os2.sTypoDescender),
        "win": (os2.usWinAscent, os2.usWinDescent),
    }
    return out, ("typo" if use_typo else "hhea")


def glyph_extent(font, cp):
    gs = font.getGlyphSet()
    pen = BoundsPen(gs)
    gs[font.getBestCmap()[cp]].draw(pen)
    _, y_min, _, y_max = pen.bounds
    return y_max, -y_min  # (top above baseline, bottom below baseline)


def limit(asc, desc, top, bottom):
    return min(2 * top - asc + desc, 2 * bottom + asc - desc)


def analyse(path):
    font = TTFont(path)
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    advance = font["hmtx"][cmap[0x30]][0]
    for cp in LINE_GLYPHS + BLOCK_GLYPHS:
        if cp not in cmap:
            raise SystemExit(f"{path}: missing U+{cp:04X}")
        if font["hmtx"][cmap[cp]][0] != advance:
            raise SystemExit(f"{path}: U+{cp:04X} advance differs from '0'")

    metrics, used = vertical_metrics(font)
    limits = {}
    for name, (asc, desc) in metrics.items():
        lines = min(limit(asc, desc, *glyph_extent(font, cp)) for cp in LINE_GLYPHS)
        blocks = min(limit(asc, desc, *glyph_extent(font, cp)) for cp in BLOCK_GLYPHS)
        limits[name] = {
            "ascent": asc,
            "descent": desc,
            "lines": round(lines / upm, 5),
            "blocks": round(blocks / upm, 5),
        }
    return {
        "file": os.path.relpath(path, ROOT),
        "version": font["name"].getDebugName(5),
        "unitsPerEm": upm,
        "advance": advance,
        "advanceEm": round(advance / upm, 6),
        "useTypoMetrics": used == "typo",
        "limits": limits,
        "expected": used,
    }


def main():
    out = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "fonts", "*", "*-400.woff2"))):
        out[os.path.basename(os.path.dirname(path))] = analyse(path)
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
