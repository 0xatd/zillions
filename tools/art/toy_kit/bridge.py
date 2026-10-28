"""River bridge: an original sci-fi low-poly span for the river-bend base.

A tied-arch span: a paved deck on two stone piers with cutwaters, steel arch
ribs over each kerb with hangers, cream end pylons crowned with energy lamps
and a cyan light strip along both kerbs. Authored at a 10-unit span (z from
-5 to +5, +z = out of the base) with the deck top at y = 0 at both ends and
a gentle camber; the renderer stretches it along z to the river's width and
uses the same camber (deck_y) for figures crossing it.
"""
import math

from kit import xform

SPAN = 10.0
HALF_W = 1.8      # deck half width (matches the ford, ~3.4 tiles wide)
CAMBER = 0.45     # deck rise at mid-span


def deck_y(z):
    return CAMBER * math.cos(math.pi * z / SPAN)


def skew_box(p, c, x0, x1, za, ya, zb, yb, thick, top=0.0):
    """A box whose top runs from (za, ya) to (zb, yb), `thick` deep."""
    v = [(x0, ya - thick, za), (x1, ya - thick, za), (x1, yb - thick, zb), (x0, yb - thick, zb),
         (x0, ya + top, za), (x1, ya + top, za), (x1, yb + top, zb), (x0, yb + top, zb)]
    f = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    p.emit(v, f, c, xform())


def beam(p, c, a, b, w, h):
    """A square beam from point a to point b (x, y, z), w wide and h tall."""
    ax, ay, az = a
    bx, by, bz = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    L = math.sqrt(dx * dx + dy * dy + dz * dz)
    ry = math.atan2(dx, dz)
    rx = -math.atan2(dy, math.hypot(dx, dz))
    hw, hh = w / 2, h / 2
    v = [(-hw, -hh, 0), (hw, -hh, 0), (hw, hh, 0), (-hw, hh, 0),
         (-hw, -hh, L), (hw, -hh, L), (hw, hh, L), (-hw, hh, L)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    p.emit(v, f, c, xform(ax, ay, az, rx, ry, 0))


def bridge(k, pal):
    B, G = k.B, k.G
    stone, stone2, stone3 = pal['stone'], pal['stone2'], pal['stone3']
    steel, dark, trim, glow = pal['steel'], pal['dark'], pal['trim'], pal['glow']
    n = 10
    zs = [-SPAN / 2 + SPAN * i / n for i in range(n + 1)]
    pave = (0xc9bea4, 0xb3a78c)
    for i in range(n):
        za, zb = zs[i], zs[i + 1]
        ya, yb = deck_y(za), deck_y(zb)
        # Paved deck in cross bands, a steel slab under it.
        skew_box(B, pave[i % 2], -HALF_W + 0.22, HALF_W - 0.22, za, ya, zb, yb, 0.12)
        skew_box(B, steel, -HALF_W - 0.05, HALF_W + 0.05, za, ya - 0.12, zb, yb - 0.12, 0.26)
        skew_box(B, dark, -HALF_W - 0.02, HALF_W + 0.02, za, ya - 0.38, zb, yb - 0.38, 0.08)
        for s in (-1, 1):
            # Kerb with a light strip on its inner face.
            x0, x1 = (HALF_W - 0.22, HALF_W) if s > 0 else (-HALF_W, -HALF_W + 0.22)
            skew_box(B, dark, x0, x1, za, ya, zb, yb, 0.12, top=0.14)
            gx = HALF_W - 0.26 if s > 0 else -HALF_W + 0.2
            skew_box(G, glow, gx, gx + 0.06, za, ya + 0.02, zb, yb + 0.02, 0.0, top=0.05)
    # Piers with cutwaters (pointing up and down stream, i.e. along x).
    for pz in (-2.5, 2.5):
        y = deck_y(pz) - 0.46
        B.prism(stone2, 6, 0.85, 0.7, y + 1.4, 0, -1.4, pz, phase=0.0, sx=1.9, sz=1.0)
        B.prism(stone3, 6, 0.95, 0.9, 0.3, 0, -1.4, pz, phase=0.0, sx=1.9, sz=1.05)
        B.box(trim, 2.9, 0.08, 1.15, 0, y - 0.06, pz)
    # Tied-arch ribs over each kerb, with hangers down to the deck.
    rise = 1.35
    m = 12
    for s in (-1, 1):
        x = s * (HALF_W + 0.06)
        pts = []
        for i in range(m + 1):
            z = -SPAN / 2 + 0.3 + (SPAN - 0.6) * i / m
            t = (z + SPAN / 2 - 0.3) / (SPAN - 0.6)
            pts.append((x, deck_y(z) + 0.2 + rise * math.sin(math.pi * t), z))
        for i in range(m):
            beam(B, steel if i % 2 == 0 else shade_steel(steel), pts[i], pts[i + 1], 0.16, 0.2)
        for i in range(2, m - 1, 2):
            px, py, pz = pts[i]
            beam(B, dark, (px, deck_y(pz) + 0.1, pz), (px, py - 0.08, pz), 0.06, 0.06)
        # Glowing keystone at the crown of each rib.
        cx, cy, cz = pts[m // 2]
        G.octa(glow, 0.13, 0.17, cx, cy + 0.2, cz)
    # End pylons: cream stone, gold collar, energy lamp.
    for pz in (-SPAN / 2 + 0.05, SPAN / 2 - 0.05):
        for s in (-1, 1):
            px = s * (HALF_W + 0.28)
            B.box(stone3, 0.62, 0.22, 0.62, px, -0.25, pz)
            B.box(stone, 0.5, 1.15, 0.5, px, -0.05, pz)
            B.box(trim, 0.58, 0.1, 0.58, px, 1.1, pz)
            B.prism(stone2, 4, 0.34, 0.12, 0.36, px, 1.2, pz, phase=math.pi / 4)
            G.box(glow, 0.2, 0.2, 0.2, px, 1.58, pz)
            # Tie the arch rib into the pylon.
            B.box(dark, 0.2, 0.18, 0.4, s * (HALF_W + 0.06), 0.32, pz - 0.2 * (1 if pz > 0 else -1))


def shade_steel(c):
    r = int(((c >> 16) & 255) * 0.82)
    g = int(((c >> 8) & 255) * 0.82)
    b = int((c & 255) * 0.86)
    return (r << 16) | (g << 8) | b
