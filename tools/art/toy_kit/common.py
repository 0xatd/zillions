"""Shared shape helpers for the non-European culture kits.

Every helper authors in game space (x right, y up, +z front, ground at 0)
on a kit Part, like european.py. Deterministic, no randomness.
"""
import math

from kit import shade

TAU = math.tau
R2 = math.sqrt(2)


def hip_roof(P, c, w, d, y, h, top=0.0, tip=None, flare=0.12, ridge=None, x=0.0, z=0.0):
    """Four-sided hipped roof over a w x d block whose eaves sit at y.

    top > 0 leaves a flat top that wide (a tier for the next storey). tip
    adds upturned corner horns in that colour (the jade-lantern eave)."""
    s = d / w if w else 1.0
    _rect_frustum(P, c, w + 2 * flare, d + 2 * flare, top, top * s if top else 0, h, y, x, z)
    if ridge is not None and top <= 0:
        P.box(ridge, 0.06, 0.06, max(0.1, (d - w)) + 0.12, x, y + h - 0.03, z)
    if tip is not None:
        hw, hd = w / 2 + flare, d / 2 + flare
        for sx in (-1, 1):
            for sz in (-1, 1):
                P.prism(tip, 4, 0.05, 0.0, 0.2, x + sx * (hw + 0.04), y - 0.02, z + sz * (hd + 0.04),
                        rx=sz * 0.6, rz=-sx * 0.6, phase=math.pi / 4)


def _rect_frustum(P, c, wb, db, wt, dt, h, y, x=0.0, z=0.0):
    hb, hd = wb / 2, db / 2
    ht, htd = wt / 2, dt / 2
    v = [(-hb, 0, -hd), (hb, 0, -hd), (hb, 0, hd), (-hb, 0, hd)]
    if wt <= 1e-4 and dt <= 1e-4:
        v.append((0, h, 0))
        f = [(0, 1, 2, 3), (0, 4, 1), (1, 4, 2), (2, 4, 3), (3, 4, 0)]
    else:
        v += [(-ht, h, -htd), (ht, h, -htd), (ht, h, htd), (-ht, h, htd)]
        f = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    from kit import xform
    P.emit(v, f, c, xform(x, y, z))


def frustum(P, c, wb, db, wt, dt, h, y=0.0, x=0.0, z=0.0):
    """Rectangular frustum (stepped-pyramid course, battered wall, plinth)."""
    _rect_frustum(P, c, wb, db, wt, dt, h, y, x, z)


def lantern(B, G, pal, x, y, z, s=1.0, hang=True):
    """Paper lantern: a red barrel with a warm glowing core and gold caps."""
    if hang:
        B.box(pal['dark'], 0.02 * s, 0.14 * s, 0.02 * s, x, y + 0.2 * s, z)
    B.prism(pal['trim'], 6, 0.06 * s, 0.07 * s, 0.03 * s, x, y + 0.17 * s, z)
    G.prism(pal['glow'], 6, 0.09 * s, 0.09 * s, 0.14 * s, x, y + 0.03 * s, z)
    B.prism(pal['trim'], 6, 0.07 * s, 0.06 * s, 0.03 * s, x, y, z)


def dome(P, c, r, y, x=0.0, z=0.0, n=8, sy=1.0, onion=False):
    """Stacked-ring dome (or onion dome) of n sides on a drum at y."""
    rings = [(1.0, 0.0), (0.97, 0.26), (0.87, 0.5), (0.7, 0.71), (0.48, 0.87), (0.24, 0.97)]
    if onion:
        rings = [(1.0, 0.0), (1.12, 0.22), (1.05, 0.45), (0.8, 0.68), (0.45, 0.88), (0.18, 1.02)]
    for i in range(len(rings) - 1):
        (a, ya), (b, yb) = rings[i], rings[i + 1]
        P.prism(c, n, r * a, r * b, (yb - ya) * r * sy, x, y + ya * r * sy, z, phase=math.pi / n)
    a, ya = rings[-1]
    P.prism(c, n, r * a, 0.0, (1.12 - ya) * r * sy, x, y + ya * r * sy, z, phase=math.pi / n)
    return y + 1.12 * r * sy


def arch_door(B, pal, w, h, x, z, y=0.0, frame=None, fill=None, pointed=True, ry=0.0):
    """A dark arched opening on a +z face: jambs, a pointed or round head."""
    frame = frame or pal['stone2']
    fill = fill or pal['dark']
    B.box(frame, w + 0.14, h + 0.08, 0.05, x, y, z, 0, ry, 0)
    B.box(fill, w, h * 0.72, 0.06, x, y, z + 0.005, 0, ry, 0)
    if pointed:
        B.prism(fill, 4, w * 0.5 * R2 * 0.72, 0.0, h * 0.34, x, y + h * 0.72, z + 0.005, phase=math.pi / 4,
                rx=0, sz=0.12)
    else:
        B.prism(fill, 8, w * 0.5, w * 0.5, 0.06, x, y + h * 0.72, z + 0.005, rx=math.pi / 2)


def fig_legs(k, col, boot, hip=0.36, w=0.1, s=1.0, wide=1.0):
    for name, x in (('leg_l', -w * wide), ('leg_r', w * wide)):
        L = k.part(name, origin=(x * s, hip * s, 0))
        L.box(col, 0.14 * s, (hip - 0.08) * s, 0.16 * s, x * s, 0.08 * s, 0)
        L.box(boot, 0.16 * s, 0.1 * s, 0.22 * s, x * s, 0, 0.02 * s)


def fig_head(B, skin, y, z=0.0, r=0.13, eyes=0x1b1d24):
    """Small chibi head for line troops: eight-sided block, two eyes."""
    ph = math.pi / 8
    B.prism(shade(skin, 0.93), 8, r * 0.8, r, r * 0.5, 0, y, z, phase=ph)
    B.prism(skin, 8, r, r * 0.86, r * 1.0, 0, y + r * 0.5, z, phase=ph)
    fz = z + r * math.cos(ph)
    for sx in (-1, 1):
        B.box(eyes, 0.035, 0.05, 0.015, sx * r * 0.38, y + r * 0.85, fz)
    return y + r * 1.5, fz


def arm(k, name, side, col, sh=0.24, top=0.66, length=0.3, w=0.11):
    A = k.part(name, origin=(side * sh, top, 0))
    A.box(col, w, length, w * 1.15, side * (sh + 0.01), top - length, 0)
    return A
