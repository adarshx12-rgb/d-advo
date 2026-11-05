"""Build the site's own headline font from Big Shoulders Display (SIL Open Font License 1.1).

Two styles come out:
  * "Clean": Big Shoulders at its heaviest, with vertical stems thickened further and spacing tightened,
    so it sits closer to a tabloid super-condensed face.
  * "Press": the same outlines with the edges roughened and the corners softened, like a headline
    letterpress-printed on cheap newsprint where the ink spreads into the fibres.

Usage:
  python tools/fonts/build_display_font.py SOURCE_VARIABLE_TTF OUT_DIR

The source is BigShouldersDisplay[wght].ttf from https://github.com/google/fonts/tree/main/ofl/bigshouldersdisplay
The OFL lets us modify and ship this as long as the result carries a different name and keeps the licence.
Change FAMILY below once the game has a final name.
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import pathops
from fontTools import subset
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FAMILY = "Docket Gothic"  # placeholder name; rename when the game name is final
FILE_STEM = "docket-gothic"
VERSION = "1.000"

WEIGHT = 900  # heaviest Big Shoulders instance
SMEAR = 56  # font units added to every vertical stem (UPM 2000)
TIGHTEN = 22  # font units removed from each side bearing

# Press style
STEP = 22  # spacing of outline samples, in font units
ROUGH_AMP = 2.4  # slow drift of the edge; kept small so stems stay straight
FIBRE_AMP = 3.2  # fine fibre noise, the main "printed" texture
BITE_CHANCE = 0.02  # chance a sample starts a small ink bite
BITE_DEPTH = 16.0

# Latin basic, Latin-1, general punctuation, euro and trademark.
UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + list(range(0x2010, 0x2028))
    + list(range(0x2030, 0x203B))
    + [0x20AC, 0x20B9, 0x2122, 0x2212]
)


def static_instance(src: Path) -> TTFont:
    font = TTFont(src)
    font = instancer.instantiateVariableFont(font, {"wght": WEIGHT}, updateFontNames=False)
    opts = subset.Options()
    opts.layout_features = ["kern", "liga", "calt", "case", "tnum", "lnum", "pnum"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    return font


def glyph_path(font: TTFont, name: str) -> pathops.Path:
    gs = font.getGlyphSet()
    rec = DecomposingRecordingPen(gs)
    gs[name].draw(rec)
    path = pathops.Path()
    rec.replay(path.getPen())
    return path


def shifted(path: pathops.Path, dx: float) -> pathops.Path:
    out = pathops.Path()
    path.draw(TransformPen(out.getPen(), (1, 0, 0, 1, dx, 0)))
    return out


def embolden(path: pathops.Path) -> pathops.Path:
    """Thicken vertical strokes by sweeping the outline sideways and taking the union."""
    result = pathops.Path(path)
    steps = 4
    for i in range(1, steps + 1):
        result = pathops.op(result, shifted(path, SMEAR * i / steps), pathops.PathOp.UNION)
    result.simplify(fix_winding=True, clockwise=True)
    return result


def contours(path: pathops.Path) -> list[list[tuple[float, float]]]:
    """Flatten every contour into a closed polyline with roughly STEP spacing."""
    out: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    last = (0.0, 0.0)

    def line_to(p):
        nonlocal last
        x0, y0 = last
        d = math.hypot(p[0] - x0, p[1] - y0)
        n = max(1, int(d / 4))
        for i in range(1, n + 1):
            t = i / n
            cur.append((x0 + (p[0] - x0) * t, y0 + (p[1] - y0) * t))
        last = p

    def curve_samples(pts, fn):
        nonlocal last
        # estimate length from the control polygon
        poly = [last] + list(pts)
        d = sum(math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]) for i in range(len(poly) - 1))
        n = max(4, int(d / 4))
        for i in range(1, n + 1):
            cur.append(fn(i / n))
        last = pts[-1]

    for verb, pts in path:
        if verb == pathops.PathVerb.MOVE:
            if cur:
                out.append(cur)
            cur = [pts[0]]
            last = pts[0]
        elif verb == pathops.PathVerb.LINE:
            line_to(pts[0])
        elif verb == pathops.PathVerb.QUAD:
            p0, (p1, p2) = last, pts

            def q(t, p0=p0, p1=p1, p2=p2):
                u = 1 - t
                return (u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1])

            curve_samples(pts, q)
        elif verb == pathops.PathVerb.CUBIC:
            p0, (p1, p2, p3) = last, pts

            def c(t, p0=p0, p1=p1, p2=p2, p3=p3):
                u = 1 - t
                return (
                    u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                    u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
                )

            curve_samples(pts, c)
        elif verb == pathops.PathVerb.CLOSE:
            if cur:
                out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    # drop duplicate closing point
    cleaned = []
    for c in out:
        if len(c) > 2 and math.hypot(c[0][0] - c[-1][0], c[0][1] - c[-1][1]) < 1:
            c = c[:-1]
        if len(c) >= 3:
            cleaned.append(resample(c))
    return [c for c in cleaned if len(c) >= 4]


def resample(c: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Respace a closed polyline evenly by arc length, so no two samples bunch up into a spike."""
    pts = c + [c[0]]
    seg = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1)]
    total = sum(seg)
    n = max(4, round(total / STEP))
    step = total / n
    out, i, acc = [], 0, 0.0
    for k in range(n):
        target = k * step
        while i < len(seg) - 1 and acc + seg[i] < target:
            acc += seg[i]
            i += 1
        t = (target - acc) / seg[i] if seg[i] else 0
        a, b = pts[i], pts[i + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def signed_area(c):
    return sum(c[i][0] * c[(i + 1) % len(c)][1] - c[(i + 1) % len(c)][0] * c[i][1] for i in range(len(c))) / 2


def roughen(c: list[tuple[float, float]], rng: random.Random) -> list[tuple[float, float]]:
    n = len(c)
    orient = 1 if signed_area(c) > 0 else -1
    # smooth random wobble: sum of a few sines over arc length, plus fibre noise and occasional bites
    ph = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
    wl = [rng.uniform(90, 140), rng.uniform(40, 60), rng.uniform(18, 26)]
    bite = [0.0] * n
    i = 0
    while i < n:
        if rng.random() < BITE_CHANCE:
            width = rng.randint(2, 4)
            depth = rng.uniform(0.5, 1.0) * BITE_DEPTH
            for k in range(-width, width + 1):
                bite[(i + k) % n] -= depth * math.cos(k / (width + 1) * math.pi / 2) ** 2
            i += width * 3
        i += 1
    out = []
    s = 0.0
    for i in range(n):
        p_prev, p, p_next = c[i - 1], c[i], c[(i + 1) % n]
        if i:
            s += math.hypot(p[0] - p_prev[0], p[1] - p_prev[1])
        tx, ty = p_next[0] - p_prev[0], p_next[1] - p_prev[1]
        tl = math.hypot(tx, ty) or 1
        # outward normal for this contour's orientation
        nx, ny = ty / tl * orient, -tx / tl * orient
        wobble = ROUGH_AMP * (0.55 * math.sin(s / wl[0] + ph[0]) + 0.3 * math.sin(s / wl[1] + ph[1]) + 0.15 * math.sin(s / wl[2] + ph[2]))
        d = wobble + rng.uniform(-FIBRE_AMP, FIBRE_AMP) + bite[i] + 2.0  # +2: a little ink spread overall
        out.append((p[0] + nx * d, p[1] + ny * d))
    return out


def draw_press(path: pathops.Path, pen, rng: random.Random):
    """All samples become off-curve points, so TrueType draws a smooth wobbly curve through their midpoints.
    That also rounds every corner a little, the way ink rounds them on paper."""
    for c in contours(path):
        r = roughen(c, rng)
        pts = [(round(x), round(y)) for x, y in r]
        # remove consecutive duplicates after rounding
        dedup = [p for i, p in enumerate(pts) if p != pts[i - 1]]
        if len(dedup) < 3:
            continue
        pen.qCurveTo(*dedup, None)
        pen.closePath()


def rebuild(font: TTFont, press: bool, seed: int = 7) -> None:
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    order = font.getGlyphOrder()
    paths = {name: glyph_path(font, name) for name in order}
    rng = random.Random(seed)
    for name in order:
        adv, _lsb = hmtx[name]
        path = paths[name]
        empty = not any(True for _ in path)
        if empty:
            new_adv = max(0, adv - 2 * TIGHTEN) if adv else 0
            hmtx[name] = (new_adv, 0)
            pen = TTGlyphPen(None)
            glyf[name] = pen.glyph()
            continue
        body = embolden(path)
        # shift left so the tightened side bearings stay even
        body = shifted(body, -TIGHTEN)
        pen = TTGlyphPen(None)
        if press:
            draw_press(body, pen, rng)
        else:
            body.draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=False))
        g = pen.glyph()
        g.recalcBounds(glyf)
        glyf[name] = g
        new_adv = adv + SMEAR - 2 * TIGHTEN if adv else 0
        hmtx[name] = (new_adv, g.xMin if hasattr(g, "xMin") else 0)
    font["hhea"].advanceWidthMax = max(a for a, _ in hmtx.metrics.values())
    font["maxp"].recalc(font)


def rename(font: TTFont, style: str) -> None:
    name = font["name"]
    full = f"{FAMILY} {style}"
    ps = f"{FAMILY.replace(' ', '')}-{style.replace(' ', '')}"
    copyright_text = (
        "Copyright 2019 The Big Shoulders Project Authors (https://github.com/xotypeco/big_shoulders). "
        f"Modified 2026 as {FAMILY}."
    )
    keep = {0, 13, 14}
    name.names = [n for n in name.names if n.nameID in keep]
    for nid, val in {
        0: copyright_text,
        1: full,
        2: "Regular",
        3: f"{VERSION};{ps}",
        4: full,
        5: f"Version {VERSION}",
        6: ps,
        16: FAMILY,
        17: style,
    }.items():
        name.setName(val, nid, 3, 1, 0x409)
    if not name.getName(13, 3, 1, 0x409):
        name.setName("This Font Software is licensed under the SIL Open Font License, Version 1.1.", 13, 3, 1, 0x409)
        name.setName("https://openfontlicense.org", 14, 3, 1, 0x409)
    font["OS/2"].usWeightClass = 900
    font["OS/2"].fsSelection = (font["OS/2"].fsSelection & ~0b1100001) | 0b1000000  # REGULAR bit
    font["head"].macStyle = 0
    if "STAT" in font:
        del font["STAT"]


def build(src: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for style, press in (("Clean", False), ("Press", True)):
        font = static_instance(src)
        rebuild(font, press)
        rename(font, style)
        stem = f"{FILE_STEM}-{style.lower()}"
        font.flavor = None
        font.save(out / f"{stem}.ttf")
        font.flavor = "woff2"
        font.save(out / f"{stem}.woff2")
        print(stem, (out / f"{stem}.woff2").stat().st_size // 1024, "KB woff2")


if __name__ == "__main__":
    build(Path(sys.argv[1]), Path(sys.argv[2]))
