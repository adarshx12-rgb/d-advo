"""Build the site's serif headline font from the hand-checked glyph sheets in public/art/font/.

Each sheet is a row of black characters on white. Every sheet repeats reference letters
(H and O, or n and o) so all sheets can be scaled onto one cap height, x-height and baseline.

Usage:
  python tools/fonts/build_serif_font.py public/art/font OUT_DIR

Change FAMILY once the game has a final name.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pathops
import potrace
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image

FAMILY = "Docket Serif"  # placeholder name
FILE_STEM = "docket-serif"
VERSION = "1.000"

UPM = 1000
CAP = 700  # cap height
XH = 483  # x-height: the anchor sheet has n at 0.69 of H
ASC, DESC = 920, -280  # line metrics

# What each sheet contains, one entry per character. A tuple (char, n) means the character spans n
# separate blobs in the image (for example the two marks of a double quote).
SHEETS = {
    "caps-1": ("H", "O", "A", "B", "C", "D"),
    "caps-2": ("H", "O", "E", "F", "G", "I"),
    "caps-3": ("H", "O", "J", "K", "L", "M"),
    "caps-4": ("H", "O", "N", "P", "Q", "R"),
    "caps-5": ("H", "O", "S", "T", "U", "V"),
    "caps-6": ("H", "O", "W", "X", "Y", "Z"),
    "lower-1": ("n", "o", "a", "b", "c", "d"),
    "lower-2": ("n", "o", "e", "f", "g", "h"),
    "lower-3": ("n", "o", "i", "j", "k", "l"),
    "lower-4": ("n", "o", "m", "p", "q", "r"),
    "lower-5": ("n", "o", "s", "t", "u", "v"),
    "lower-6": ("n", "o", "w", "x", "y", "z"),
    "figures-1": ("H", "O", "1", "2", "3", "4", "5"),
    "figures-2": ("H", "O", "6", "7", "8", "9", "0"),
    "punct-1": ("H", "n", ".", ",", ":", ";", "!", "?"),
    "punct-2": ("H", "n", "’", ("”", 2), "-", "(", ")", "&"),
    "symbols": ("H", "n", "₹", "@", "#", "%", "/"),
}
# The reference letters themselves are taken from the sheets where they matched the anchor best.
PREFERRED = {"H": "caps-4", "O": "caps-4", "n": "lower-1", "o": "lower-6"}

# Side bearings in font units. Straight sides get the most room, round sides less, open diagonals least.
STRAIGHT, ROUND, OPEN, DIAG = 56, 36, 26, 12
LEFT = {
    **{c: ROUND for c in "OCGQSoceqasd0689@(&3"},
    **{c: DIAG for c in "AVWXYvwxyJj/7"},
    **{c: OPEN for c in "zZ2t%4#"},
}
RIGHT = {
    **{c: ROUND for c in "ODQbop0689)&3s5S@"},
    **{c: DIAG for c in "AKVWXYkvwxy/7"},
    **{c: OPEN for c in "CEFGLTPcefrtzZ2J4a%#₹"},
}
PUNCT_SIDE = 40


def load(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("L")) < 128


def blobs(ink: np.ndarray) -> list[tuple[int, int]]:
    """Column ranges that contain ink, left to right."""
    cols = ink.any(axis=0)
    out, start = [], None
    for x, v in enumerate(cols):
        if v and start is None:
            start = x
        elif not v and start is not None:
            out.append((start, x))
            start = None
    if start is not None:
        out.append((start, len(cols)))
    return [(s, e) for s, e in out if e - s > 3]


def bbox(ink: np.ndarray, s: int, e: int) -> tuple[int, int]:
    rows = np.where(ink[:, s:e].any(axis=1))[0]
    return int(rows.min()), int(rows.max()) + 1


def trace(ink: np.ndarray, s: int, e: int, origin_x: float, baseline: float, scale: float) -> pathops.Path:
    """Trace one character into an outline in font units (y up, baseline at 0, left edge at 0)."""
    pad = 4
    crop = np.zeros((ink.shape[0], e - s + 2 * pad), dtype=bool)
    crop[:, pad : pad + (e - s)] = ink[:, s:e]
    plist = potrace.Bitmap(~crop).trace(turdsize=8, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.0, opticurve=True, opttolerance=0.2)
    path = pathops.Path()
    pen = path.getPen()

    def pt(p):
        x, y = p.x, p.y
        return ((x - pad + s - origin_x) * scale, (baseline - y) * scale)

    for curve in plist:
        pen.moveTo(pt(curve.start_point))
        for seg in curve.segments:
            if seg.is_corner:
                pen.lineTo(pt(seg.c))
                pen.lineTo(pt(seg.end_point))
            else:
                pen.curveTo(pt(seg.c1), pt(seg.c2), pt(seg.end_point))
        pen.closePath()
    path.simplify(fix_winding=True, clockwise=True)
    return path


def transformed(path: pathops.Path, m) -> pathops.Path:
    out = pathops.Path()
    path.draw(TransformPen(out.getPen(), m))
    out.simplify(fix_winding=True, clockwise=True)
    return out


def bounds(path: pathops.Path):
    return path.bounds  # (xMin, yMin, xMax, yMax)


def collect(src: Path) -> dict[str, pathops.Path]:
    glyphs: dict[str, tuple[str, pathops.Path]] = {}
    for sheet, chars in SHEETS.items():
        ink = load(src / f"{sheet}.png")
        bl = blobs(ink)
        want = sum(c[1] if isinstance(c, tuple) else 1 for c in chars)
        if len(bl) != want:
            raise SystemExit(f"{sheet}: found {len(bl)} blobs, expected {want}")
        # reference letter sets the scale and baseline for the whole sheet
        rs, re_ = bl[0]
        top, bot = bbox(ink, rs, re_)
        ref = chars[0]
        target = CAP if ref == "H" else XH
        scale = target / (bot - top)
        baseline = bot
        i = 0
        for c in chars:
            n = c[1] if isinstance(c, tuple) else 1
            ch = c[0] if isinstance(c, tuple) else c
            s, e = bl[i][0], bl[i + n - 1][1]
            i += n
            if ch in glyphs and PREFERRED.get(ch) != sheet:
                continue
            glyphs[ch] = (sheet, trace(ink, s, e, s, baseline, scale))
        print(f"{sheet}: scale {scale:.3f} units/px")
    return {k: v for k, (_, v) in glyphs.items()}


def fix(g: dict[str, pathops.Path]) -> None:
    def fit_height(ch, h):
        x0, y0, x1, y1 = bounds(g[ch])
        k = h / (y1 - max(y0, 0))
        g[ch] = transformed(g[ch], (k, 0, 0, k, 0, 0))

    # ! and ? came out a little taller than the capitals
    fit_height("!", CAP + 8)
    fit_height("?", CAP + 8)
    # make the zero clearly narrower than the letter O
    x0, y0, x1, y1 = bounds(g["0"])
    cx = (x0 + x1) / 2
    g["0"] = transformed(g["0"], (0.9, 0, 0, 1, cx * 0.1, 0))
    # opening quotes are the closing ones turned upside down, sitting at the same height
    for close, open_ in (("’", "‘"), ("”", "“")):
        x0, y0, x1, y1 = bounds(g[close])
        g[open_] = transformed(g[close], (-1, 0, 0, -1, x0 + x1, y0 + y1))
    g["'"] = g["’"]
    g['"'] = g["”"]
    # dashes from the hyphen
    x0, y0, x1, y1 = bounds(g["-"])
    w = x1 - x0
    g["–"] = transformed(g["-"], (500 / w, 0, 0, 1, x0 - x0 * 500 / w, 0))
    g["—"] = transformed(g["-"], (900 / w, 0, 0, 1, x0 - x0 * 900 / w, 0))


def side(ch: str, table: dict[str, int]) -> int:
    if ch.isalnum() or ch == "₹":
        base = table.get(ch, STRAIGHT)
        return base if ch.isupper() or ch.isdigit() or ch == "₹" else max(6, base - 18)
    return table.get(ch, PUNCT_SIDE)


def build(src: Path, out: Path) -> None:
    g = collect(src)
    fix(g)
    names = {ch: f"uni{ord(ch):04X}" for ch in g}
    order = [".notdef", "space"] + [names[c] for c in sorted(g, key=ord)]
    cmap = {32: "space", 0xA0: "space"}
    cmap.update({ord(c): n for c, n in names.items()})

    glyf, metrics = {}, {}
    empty = TTGlyphPen(None)
    glyf[".notdef"] = empty.glyph()
    metrics[".notdef"] = (500, 0)
    glyf["space"] = TTGlyphPen(None).glyph()
    metrics["space"] = (220, 0)
    for ch, path in g.items():
        x0, y0, x1, y1 = bounds(path)
        lsb, rsb = side(ch, LEFT), side(ch, RIGHT)
        shifted = transformed(path, (1, 0, 0, 1, lsb - x0, 0))
        pen = TTGlyphPen(None)
        rec = RecordingPen()
        shifted.draw(rec)
        rec.replay(Cu2QuPen(pen, max_err=0.8, reverse_direction=False))
        name = names[ch]
        glyf[name] = pen.glyph()
        metrics[name] = (round(lsb + (x1 - x0) + rsb), lsb)

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyf)
    font = fb.font
    for name in order:
        glyf[name].recalcBounds(font["glyf"])
    metrics = {n: (adv, getattr(glyf[n], "xMin", 0) if hasattr(glyf[n], "xMin") else 0) for n, (adv, _l) in metrics.items()}
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASC, descent=DESC)
    ymax = max(getattr(glyf[n], "yMax", 0) for n in order)
    ymin = min(getattr(glyf[n], "yMin", 0) for n in order)
    ps = FAMILY.replace(" ", "") + "-Regular"
    fb.setupNameTable(
        {
            "copyright": "Copyright 2026. Glyphs drawn for this project.",
            "familyName": FAMILY,
            "styleName": "Regular",
            "uniqueFontIdentifier": f"{VERSION};{ps}",
            "fullName": FAMILY,
            "version": f"Version {VERSION}",
            "psName": ps,
        }
    )
    fb.setupOS2(
        sTypoAscender=ASC,
        sTypoDescender=DESC,
        sTypoLineGap=0,
        usWinAscent=max(ASC, ymax),
        usWinDescent=max(-DESC, -ymin),
        sxHeight=XH,
        sCapHeight=CAP,
        usWeightClass=700,
        fsType=0,
    )
    fb.setupPost()
    fb.setupHead(unitsPerEm=UPM, created=0x00000000E5A1F000, modified=0x00000000E5A1F000)
    out.mkdir(parents=True, exist_ok=True)
    font.save(out / f"{FILE_STEM}.ttf")
    font.flavor = "woff2"
    font.save(out / f"{FILE_STEM}.woff2")
    print(f"{len(g)} glyphs, {(out / f'{FILE_STEM}.woff2').stat().st_size // 1024} KB woff2")


if __name__ == "__main__":
    build(Path(sys.argv[1]), Path(sys.argv[2]))
