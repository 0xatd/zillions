"""Rampart pieces: wall segments, joint posts and gatehouses (all tiers).

Chunky, charming, slightly irregular. Authored in game space with the origin
on the ground at the pier centre:

  wall_tN_seg   a curtain run from x=0 to x=1 (the game scales x to the
                real run length and yaws it toward the neighbouring tile);
                thickness along z, outside = +z.
  wall_tN_post  the joint post/tower standing on a pier.
  gate_tN       a gatehouse centred on the gate tile: the passage runs along
                z, the wall along x; flanking towers at x = +-1.3 so the
                opening stays clear across the three-tile arch.

T1 is a timber palisade (cheap, first night), T2 a crenellated stone wall
with square towers, T3 a tall stone wall with round roofed towers, banners
and an energy band. Deterministic: irregularity comes from fixed tables.
"""
import math

from kit import shade

# Fixed jitter tables (no randomness): block heights and shades along a run.
JIT = [0.0, 0.035, -0.02, 0.05, -0.04, 0.02, -0.01, 0.045]
SHD = [1.0, 0.94, 1.04, 0.97, 1.02, 0.92, 1.0, 0.96]


def _logs(B, pal, x0, x1, h, n, z=0.0, r=0.085):
    for i in range(n):
        x = x0 + (i + 0.5) * (x1 - x0) / n
        hh = h + JIT[i % 8] * 2.0
        c = shade(pal['wood'], SHD[i % 8])
        B.prism(c, 6, r, r * 0.95, hh, x, 0, z, phase=0.3 * i)
        B.prism(shade(pal['wood'], 1.12), 6, r * 0.95, 0, 0.16, x, hh, z, phase=0.3 * i)


def _stone_run(B, pal, h, thick, merl=True, n=4, battered=False):
    """Stone curtain from x=0..1: plinth, body blocks, walk and merlons."""
    st, st2, st3 = pal['stone'], pal['stone2'], pal['stone3']
    B.box(st3, 1.02, 0.16, thick + 0.16, 0.5, 0, 0)                    # footing
    if battered:
        B.box(shade(st2, 0.95), 1.02, h * 0.45, thick + 0.12, 0.5, 0.16, 0)
    # the body as a few big ashlar blocks: irregular top line, varied shade
    for i in range(n):
        x0 = i / n
        bh = h - 0.16 + JIT[i % 8]
        B.box(shade(st, SHD[i % 8]), 1.0 / n + 0.005, bh, thick, x0 + 0.5 / n, 0.16, 0)
    # a few proud stones on both faces: the hand-built look
    for i, (x, y) in enumerate(((0.22, 0.42), (0.71, 0.3), (0.5, 0.72))):
        for s in (-1, 1):
            B.box(shade(st2, SHD[(i + 3) % 8]), 0.2, 0.13, 0.04, x, y * h, s * (thick / 2 + 0.01))
    B.box(st2, 1.02, 0.1, thick + 0.08, 0.5, h, 0)                     # wall-walk cap
    if merl:
        for i in range(2):
            x = 0.25 + i * 0.5
            B.box(st, 0.24, 0.24, 0.16, x, h + 0.1, thick / 2 - 0.04)   # outer merlons
        B.box(st2, 1.0, 0.1, 0.08, 0.5, h + 0.1, -thick / 2 + 0.04)     # inner parapet lip


def wall_seg(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        B.box(pal['stone3'], 1.02, 0.08, 0.36, 0.5, 0, 0)               # earth bank
        _logs(B, pal, 0, 1, 0.82, 4)
        B.box(shade(pal['wood'], 0.8), 1.0, 0.07, 0.07, 0.5, 0.5, -0.09)  # rail
        B.box(shade(pal['wood'], 0.8), 1.0, 0.07, 0.07, 0.5, 0.25, -0.09)
        return
    if t == 2:
        _stone_run(B, pal, 1.0, 0.46)
        return
    _stone_run(B, pal, 1.32, 0.56, battered=True)
    G.box(pal['glow'], 1.0, 0.05, 0.02, 0.5, 0.95, 0.29)
    G.box(pal['glow'], 1.0, 0.05, 0.02, 0.5, 0.95, -0.29)


def wall_post(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        B.prism(pal['stone3'], 6, 0.3, 0.3, 0.1, 0, 0, 0)
        B.prism(shade(pal['wood'], 0.9), 6, 0.17, 0.16, 1.15, 0, 0.1, 0)
        B.prism(shade(pal['wood'], 1.1), 6, 0.16, 0, 0.24, 0, 1.25, 0)
        B.prism(shade(pal['wood'], 0.7), 6, 0.185, 0.185, 0.07, 0, 0.75, 0)
        return
    if t == 2:
        w, h = 0.72, 1.45
        B.box(pal['stone3'], w + 0.14, 0.18, w + 0.14, 0, 0, 0)
        B.box(pal['stone'], w, h - 0.18, w, 0, 0.18, 0)
        B.box(pal['stone2'], w + 0.1, 0.1, w + 0.1, 0, h, 0)
        for (x, z) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            B.box(pal['stone'], 0.2, 0.22, 0.2, x * (w / 2 - 0.05), h + 0.1, z * (w / 2 - 0.05))
        B.box(pal['dark'], 0.08, 0.2, 0.04, 0, h * 0.62, w / 2 + 0.005)
        return
    r, h = 0.44, 1.85
    B.prism(pal['stone3'], 8, r * 1.2, r * 1.15, 0.2, 0, 0, 0, phase=0.2)
    B.prism(pal['stone'], 8, r, r * 0.94, h - 0.2, 0, 0.2, 0, phase=0.2)
    B.prism(pal['stone2'], 8, r * 1.14, r * 1.14, 0.12, 0, h, 0, phase=0.2)
    B.prism(pal['roof'], 8, r * 1.25, 0, r * 1.9, 0, h + 0.12, 0, phase=0.2)
    B.prism(pal['trim'], 4, 0.05, 0, 0.26, 0, h + 0.12 + r * 1.9, 0)
    G.box(pal['warm'], 0.09, 0.16, 0.04, 0, h * 0.6, r * 0.96)


def _flag(B, pal, x, z, y, h=0.9, flip=False):
    B.box(pal['dark'], 0.04, h, 0.04, x, y, z)
    off = -0.17 if flip else 0.17
    B.box(pal['banner'], 0.3, 0.38, 0.03, x + off, y + h - 0.42, z)
    B.box(pal['trim'], 0.3, 0.05, 0.035, x + off, y + h - 0.06, z)


def gatehouse(k, t, pal):
    B, G = k.B, k.G
    tx = 1.3                                     # tower centres along the wall
    if t == 1:
        for s in (-1, 1):
            x = s * tx
            B.box(pal['stone3'], 0.8, 0.1, 0.8, x, 0, 0)
            for (dx, dz) in ((-0.24, -0.24), (0.24, -0.24), (0.24, 0.24), (-0.24, 0.24)):
                B.prism(pal['wood'], 6, 0.08, 0.075, 1.5, x + dx, 0.1, dz)
            B.box(shade(pal['wood'], 1.1), 0.78, 0.08, 0.78, x, 1.3, 0)           # platform
            for dz in (-0.33, 0.33):
                B.box(shade(pal['wood'], 0.85), 0.78, 0.22, 0.05, x, 1.38, dz)
            B.gable(pal['roof'], 0.7, 0.36, 0.7, x, 1.62, 0)                   # little roof
        B.box(shade(pal['wood'], 0.8), 2.5, 0.16, 0.16, 0, 1.18, 0.12)          # lintel beam
        B.box(shade(pal['wood'], 0.8), 2.5, 0.16, 0.16, 0, 1.18, -0.12)
        for s in (-1, 1):                                                        # leaves, swung in
            B.box(pal['wood'], 0.62, 0.9, 0.07, s * 0.62, 0.06, -0.42, 0, s * 1.15, 0)
        B.box(pal['field'], 1.7, 0.03, 1.2, 0, 0, 0)                            # trodden threshold
        return
    if t == 2:
        w, h = 0.95, 2.0
        for s in (-1, 1):
            x = s * tx
            B.box(pal['stone3'], w + 0.18, 0.2, w + 0.18, x, 0, 0)
            B.box(pal['stone'], w, h - 0.2, w, x, 0.2, 0)
            B.box(pal['stone2'], w + 0.12, 0.12, w + 0.12, x, h, 0)
            for (dx, dz) in ((-1, -1), (1, -1), (1, 1), (-1, 1), (0, 1), (0, -1)):
                B.box(pal['stone'], 0.22, 0.24, 0.22, x + dx * (w / 2 - 0.06), h + 0.12, dz * (w / 2 - 0.06))
            G.box(pal['warm'], 0.12, 0.2, 0.04, x, h * 0.6, w / 2 + 0.01)
        # the bridge over the passage: a solid arch block with a lit slit
        B.box(pal['stone'], 2 * tx - w + 0.05, 0.62, 0.8, 0, 1.3, 0)
        B.box(pal['stone2'], 2 * tx - w + 0.1, 0.1, 0.86, 0, 1.92, 0)
        for i in range(3):
            B.box(pal['stone'], 0.22, 0.22, 0.16, -0.5 + i * 0.5, 2.02, 0.35)
        B.box(pal['dark'], 1.5, 0.22, 0.06, 0, 1.08, 0.35)                     # raised portcullis
        for i in range(5):
            B.box(pal['dark'], 0.04, 0.3, 0.05, -0.6 + i * 0.3, 0.86, 0.35)
        B.box(pal['trim'], 0.5, 0.1, 0.04, 0, 1.62, 0.41)
        B.box(pal['stone2'], 1.7, 0.03, 1.2, 0, 0, 0)                          # paved threshold
        return
    r, h = 0.62, 2.55
    for s in (-1, 1):
        x = s * tx
        B.prism(pal['stone3'], 8, r * 1.2, r * 1.14, 0.24, x, 0, 0, phase=0.2)
        B.prism(pal['stone'], 8, r, r * 0.95, h - 0.24, x, 0.24, 0, phase=0.2)
        B.prism(pal['stone2'], 8, r * 1.15, r * 1.15, 0.14, x, h, 0, phase=0.2)
        B.prism(pal['roof'], 8, r * 1.28, 0, r * 1.95, x, h + 0.14, 0, phase=0.2)
        B.prism(pal['trim'], 4, 0.06, 0, 0.3, x, h + 0.14 + r * 1.95, 0)
        G.box(pal['warm'], 0.12, 0.22, 0.04, x, h * 0.62, r * 0.96)
        G.prism(pal['glow'], 8, r * 1.0, r * 1.0, 0.06, x, h * 0.4, 0, phase=0.2)
        _flag(B, pal, x + s * 0.2, 0.62, 0.5, 1.4, flip=s < 0)
    B.box(pal['stone'], 2 * tx - 2 * r + 0.1, 0.8, 0.95, 0, 1.5, 0)
    B.box(pal['stone2'], 2 * tx - 2 * r + 0.15, 0.12, 1.0, 0, 2.3, 0)
    for i in range(3):
        B.box(pal['stone'], 0.24, 0.26, 0.18, -0.45 + i * 0.45, 2.42, 0.41)
    B.box(pal['banner'], 0.55, 0.62, 0.04, 0, 1.52, 0.49)                     # the big gate banner
    B.box(pal['trim'], 0.2, 0.2, 0.05, 0, 1.75, 0.5)
    B.box(pal['dark'], 1.3, 0.2, 0.06, 0, 1.28, 0.42)
    for i in range(5):
        B.box(pal['dark'], 0.04, 0.3, 0.05, -0.52 + i * 0.26, 1.06, 0.42)
    B.box(pal['stone2'], 1.6, 0.03, 1.3, 0, 0, 0)
    G.box(pal['glow'], 1.2, 0.03, 0.25, 0, 0.035, 0.45)
