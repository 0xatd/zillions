"""South American culture — the Sun Terrace Guard.

An original sci-fi take on Andean and Mesoamerican stonework: pale
limestone stepped terraces with teal bands, thatched temple roofs, battered
trapezoid doorways, gold sun discs that hum with yellow light. The keep
climbs from a thatched shrine on a platform to a five-step sun pyramid with
a floating sun disc. Its army: obsidian shieldbearers, jaguar scouts with
blowguns, solar atlatl throwers.

Same conventions as european.py: (kit, tier, pal), game space, +z front.
"""
import math

from kit import shade
from common import hip_roof, frustum, fig_legs, fig_head, arm
import european as eu

PALETTE = dict(eu.PALETTE,
               stone=0xe6dab0, stone2=0xc9b98a, stone3=0x8c8a66, roof=0x1f9a8a, roof2=0x177466,
               trim=0xf2b632, banner=0x1f9a8a, accent=0xe0662a, wood=0x8a5a36, steel=0xa7a08a,
               dark=0x2d2a24, glow=0xffd34a, warm=0xffc86a, cloth=0xe0662a, skin=0xc98d5e,
               thatch=0xd2a44e, thatch2=0xb88a3a)

TAU = math.tau


def thatch_roof(B, pal, w, d, y, h, x=0.0, z=0.0):
    hip_roof(B, pal['thatch'], w, d, y, h, flare=0.14, x=x, z=z)
    B.box(pal['thatch2'], w + 0.3, 0.06, d + 0.3, x, y - 0.03, z)      # shaggy eave fringe


def sun_disc(P, G, pal, x, y, z, r=0.22, face=True):
    """A gold sun: disc, eight rays, glowing heart. Faces +z."""
    P.prism(pal['trim'], 10, r, r, 0.05, x, y, z, rx=math.pi / 2)
    for i in range(8):
        a = i / 8 * TAU
        P.box(pal['trim'], 0.05, r * 0.5, 0.04, x + math.cos(a) * r * 1.05, y + math.sin(a) * r * 1.05 - r * 0.25,
              z + 0.01, 0, 0, a - math.pi / 2)
    G.prism(pal['glow'], 10, r * 0.5, r * 0.5, 0.03, x, y, z + 0.045, rx=math.pi / 2)


def stepped(B, pal, w, steps, step_h, inset, y=0.0, band=True, d=None):
    """Battered terrace courses with a teal band on each lip. Returns top."""
    d = d if d is not None else w
    for i in range(steps):
        wb, db = w - 2 * inset * i, d - 2 * inset * i
        c = pal['stone'] if i % 2 == 0 else shade(pal['stone'], 0.94)
        frustum(B, c, wb, db, wb - 0.1, db - 0.1, step_h, y=y)
        if band:
            # a teal lip band just under the tread, so the tread stays stone
            f = 1 - 0.13 / step_h
            frustum(B, pal['roof'], wb - 0.1 * f + 0.03, db - 0.1 * f + 0.03, wb - 0.1 * (f + 0.07 / step_h) + 0.03,
                    db - 0.1 * (f + 0.07 / step_h) + 0.03, 0.07, y=y + step_h - 0.13)
        y += step_h
    return y


def stairs(B, pal, top, z_front, depth, w=0.6, y0=0.0, steps=6):
    """A straight stair up the +z face, between two balustrades."""
    for i in range(steps):
        t = (i + 1) / steps
        h = (top - y0) * t
        zz = z_front - depth * (i + 0.5) / steps
        B.box(pal['stone2'], w, h, depth / steps + 0.02, 0, y0, zz + depth / steps * 0)
    for s in (-1, 1):
        B.box(pal['stone3'], 0.1, top - y0 + 0.08, depth + 0.02, s * (w / 2 + 0.05), y0, z_front - depth / 2)


def trap_door(B, pal, w, h, z, x=0.0, y=0.0, frame=None):
    """Trapezoid doorway (narrower at the top) on a +z face."""
    frame = frame or pal['stone2']
    frustum(B, frame, w + 0.16, 0.06, w * 0.7 + 0.16, 0.06, h + 0.08, y=y, x=x, z=z)
    frustum(B, pal['dark'], w, 0.08, w * 0.7, 0.08, h, y=y, x=x, z=z + 0.005)


def _temple(B, G, pal, y, w, h, comb=False):
    """The shrine on a pyramid top: stone room, teal band, thatched roof."""
    B.box(pal['stone'], w, h, w * 0.8, 0, y, 0)
    B.box(pal['roof'], w + 0.04, 0.08, w * 0.8 + 0.04, 0, y + h - 0.14, 0)
    for i in range(4):
        x = -w / 2 + 0.12 + i * (w - 0.24) / 3
        B.box(pal['accent'], 0.08, 0.08, 0.03, x, y + h - 0.12, w * 0.4 + 0.02)
    trap_door(B, pal, 0.36, h * 0.72, w * 0.4 + 0.01, y=y)
    G.box(pal['warm'], 0.2, 0.08, 0.02, 0, y + 0.02, w * 0.4 + 0.06)
    if comb:
        B.box(pal['stone2'], w * 0.6, 0.6, 0.14, 0, y + h, -0.05)        # roof comb
        for i in range(3):
            B.box(pal['dark'], 0.08, 0.18, 0.15, -w * 0.18 + i * w * 0.18, y + h + 0.24, -0.05)
        frustum(B, pal['roof'], w * 0.66, 0.18, w * 0.5, 0.14, 0.1, y=y + h + 0.6, z=-0.05)
        hip_roof(B, pal['thatch'], w * 0.9, w * 0.72, y + h, 0.3, flare=0.1)
        return y + h + 0.7
    thatch_roof(B, pal, w, w * 0.8, y + h, 0.55)
    return y + h + 0.55


def _torch(B, G, pal, x, y, z, h=0.55):
    B.prism(pal['wood'], 5, 0.035, 0.03, h, x, y, z)
    B.prism(pal['trim'], 6, 0.07, 0.09, 0.07, x, y + h, z)
    G.octa(pal['glow'], 0.06, 0.1, x, y + h + 0.13, z)


def castle(k, t, pal):
    B, G = k.B, k.G
    frustum(B, pal['stone3'], 4.2, 4.2, 4.0, 4.0, 0.14)
    if t == 1:
        top = stepped(B, pal, 2.6, 2, 0.3, 0.32, y=0.14)
        stairs(B, pal, top, 1.3, 0.75, y0=0.14, steps=4)
        top_t = _temple(B, G, pal, top, 1.3, 0.75)
        for sx in (-1, 1):
            _torch(B, G, pal, sx * 0.6, 0.14, 1.36)
        eu.banner(B, pal, 1.05, 0.8, 0.14, 1.5, flip=True)
        return
    steps = {2: 3, 3: 4, 4: 5}[t]
    base_w = {2: 3.2, 3: 3.5, 4: 3.7}[t]
    sh = {2: 0.36, 3: 0.38, 4: 0.42}[t]
    inset = {2: 0.36, 3: 0.32, 4: 0.28}[t]
    top = stepped(B, pal, base_w, steps, sh, inset, y=0.14)
    stairs(B, pal, top, base_w / 2, (steps - 0.4) * inset + 0.15, w=0.66, y0=0.14, steps=steps * 2)
    tw = base_w - 2 * inset * steps
    top_t = _temple(B, G, pal, top, min(1.3, tw + 0.1), 0.8 if t < 4 else 0.85, comb=t >= 3)
    for sx in (-1, 1):
        _torch(B, G, pal, sx * 0.48, top, base_w / 2 - inset * steps - 0.1)
        _torch(B, G, pal, sx * 0.55, 0.14, base_w / 2 + 0.1, h=0.7)
    # gold sun panels on the first terrace face
    for sx in (-1, 1):
        sun_disc(B, G, pal, sx * base_w * 0.3, 0.14 + sh * 0.55, base_w / 2 - 0.02, r=0.14)
    if t >= 3:
        # two stelae and a side banner pair
        for sx in (-1, 1):
            x = sx * (base_w / 2 + 0.05)
            frustum(B, pal['stone2'], 0.34, 0.24, 0.26, 0.18, 1.1, x=x, z=base_w / 2 - 0.1, y=0.14)
            B.box(pal['roof'], 0.3, 0.06, 0.22, x, 0.14 + 0.7, base_w / 2 - 0.1)
            B.box(pal['trim'], 0.12, 0.12, 0.03, x, 0.14 + 0.85, base_w / 2 + 0.0)
            eu.banner(B, pal, sx * (base_w / 2 - 0.25), -base_w / 2 + 0.3, 0.14 + sh, 1.4, flip=sx > 0)
    else:
        eu.banner(B, pal, base_w / 2 - 0.25, -base_w / 2 + 0.3, 0.14 + sh, 1.3, flip=True)
    if t >= 4:
        core = k.part('part_core', origin=(0, top_t + 0.7, 0))
        r = 0.3
        core.prism(pal['trim'], 12, r, r, 0.06, 0, top_t + 0.7, -0.03, rx=math.pi / 2)
        for i in range(12):
            a = i / 12 * TAU
            core.box(pal['trim'], 0.06, 0.16, 0.05, math.cos(a) * r * 1.15, top_t + 0.7 + math.sin(a) * r * 1.15 - 0.08,
                     0, 0, 0, a - math.pi / 2)
        G.prism(pal['glow'], 12, r * 0.55, r * 0.55, 0.04, 0, top_t + 0.7, 0.03, rx=math.pi / 2)
        G.prism(pal['glow'], 8, 0.2, 0.2, 0.03, 0, top_t + 0.05, 0)


def tower(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        frustum(B, pal['stone3'], 1.1, 1.1, 0.95, 0.95, 0.45)
        for sx in (-0.36, 0.36):
            for sz in (-0.36, 0.36):
                B.prism(pal['wood'], 5, 0.06, 0.05, 0.75, sx, 0.45, sz)
        B.box(pal['wood'], 1.0, 0.1, 1.0, 0, 1.05, 0)
        top, s, cw = 1.15, 0.8, 1.0
    else:
        steps = {2: 3, 3: 4, 4: 5}[t]
        w0 = {2: 1.16, 3: 1.2, 4: 1.24}[t]
        top = stepped(B, pal, w0, steps, {2: 0.5, 3: 0.55, 4: 0.58}[t], 0.04, y=0.0)
        trap_door(B, pal, 0.26, 0.42, w0 / 2 - 0.02)
        if t >= 3:
            sun_disc(B, G, pal, 0, top - 0.42, w0 / 2 - 0.1, r=0.14)
        cw = w0 - 0.4
        B.box(pal['stone2'], w0 - 0.2, 0.1, w0 - 0.2, 0, top, 0)
        top += 0.1
        s = {2: 0.95, 3: 1.1, 4: 1.2}[t]
        cw = w0 - 0.1
        if t >= 4:
            G.box(pal['glow'], w0 - 0.14, 0.05, w0 - 0.14, 0, top - 0.6, 0)
    canopy = top + 0.62 * s + 0.12
    for sx in (-1, 1):
        for sz in (-1, 1):
            B.prism(pal['wood'], 5, 0.04, 0.04, canopy - top, sx * cw * 0.44, top, sz * cw * 0.44)
    thatch_roof(B, pal, cw * 0.95, cw * 0.95, canopy, 0.5)
    B.box(pal['roof'], 0.1, 0.12, 0.1, 0, canopy + 0.48, 0)
    if t == 1:
        eu.banner(B, pal, -0.52, 0.52, 0, 1.6)
    head = k.part('part_turret', origin=(0, top, 0))
    eu.turret_head(head, pal, s, twin=t >= 3, coil=t >= 4, oy=top)


def _hut(B, G, pal, x, z, r, h):
    B.prism(pal['stone'], 8, r, r * 0.96, h, x, 0.1, z, phase=math.pi / 8)
    B.prism(pal['roof'], 8, r + 0.01, r + 0.01, 0.05, x, 0.1 + h * 0.6, z, phase=math.pi / 8)
    B.prism(pal['thatch'], 8, r + 0.14, 0.0, r * 1.25, x, 0.1 + h, z, phase=math.pi / 8)
    B.prism(pal['thatch2'], 8, r + 0.16, r + 0.12, 0.05, x, 0.1 + h - 0.03, z, phase=math.pi / 8)
    trap_door(B, pal, 0.2, h * 0.7, z + r * 0.92, x=x, y=0.1)


def house(k, t, pal):
    B, G = k.B, k.G
    B.box(pal['stone3'], 1.6, 0.1, 1.5, 0, 0, 0)
    if t == 1:
        _hut(B, G, pal, 0, 0, 0.5, 0.55)
        B.prism(0xa34a2a, 8, 0.12, 0.1, 0.18, 0.55, 0.1, 0.45)      # clay pot
        B.box(pal['accent'], 0.36, 0.03, 0.26, -0.5, 0.1, 0.45)      # woven mat
        return
    if t == 2:
        B.box(pal['stone'], 1.1, 0.62, 0.85, 0, 0.1, 0)
        B.box(pal['roof'], 1.12, 0.06, 0.87, 0, 0.5, 0)
        trap_door(B, pal, 0.26, 0.4, 0.43, y=0.1)
        G.box(pal['warm'], 0.14, 0.1, 0.03, 0.32, 0.36, 0.43)
        G.box(pal['warm'], 0.14, 0.1, 0.03, -0.32, 0.36, 0.43)
        thatch_roof(B, pal, 1.1, 0.85, 0.72, 0.5)
        _torch(B, G, pal, 0.62, 0.1, 0.52, h=0.4)
        return
    if t == 3:
        frustum(B, pal['stone2'], 1.5, 1.3, 1.44, 1.24, 0.22, y=0.1)
        B.box(pal['stone'], 0.8, 0.62, 0.7, -0.3, 0.32, -0.2)
        thatch_roof(B, pal, 0.8, 0.7, 0.94, 0.45, x=-0.3, z=-0.2)
        trap_door(B, pal, 0.24, 0.4, 0.15, x=-0.3, y=0.32)
        _hut(B, G, pal, 0.45, 0.3, 0.3, 0.45)
        B.box(pal['roof'], 0.82, 0.06, 0.72, -0.3, 0.74, -0.2)
        B.box(pal['stone2'], 0.4, 0.22, 0.25, -0.3, 0.1, 0.72)        # steps
        return
    # t4: two terraced storeys with a sun panel
    top = stepped(B, pal, 1.4, 1, 0.3, 0.0, y=0.1, d=1.2)
    B.box(pal['stone'], 1.2, 0.6, 1.0, 0, top, 0)
    B.box(pal['roof'], 1.22, 0.07, 1.02, 0, top + 0.48, 0)
    trap_door(B, pal, 0.3, 0.46, 0.5, y=top)
    B.box(pal['stone'], 0.8, 0.5, 0.65, 0, top + 0.6, -0.12)
    thatch_roof(B, pal, 0.8, 0.65, top + 1.1, 0.45, z=-0.12)
    sun_disc(B, G, pal, 0, top + 0.84, 0.22, r=0.13)
    for sx in (-1, 1):
        G.box(pal['warm'], 0.14, 0.1, 0.03, sx * 0.38, top + 0.3, 0.5)
    eu.banner(B, pal, 0.72, 0.4, 0.1, 1.6, big=0.7)


# ---------------------------------------------------------------- ramparts

JIT = [0.0, 0.035, -0.02, 0.05, -0.04, 0.02, -0.01, 0.045]


def wall_seg(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        B.box(pal['stone3'], 1.02, 0.26, 0.4, 0.5, 0, 0)
        for i in range(5):
            x = (i + 0.5) / 5
            h = 0.72 + JIT[i % 8] * 2
            B.prism(pal['wood'], 5, 0.075, 0.06, h, x, 0.2, 0, phase=0.3 * i)
            B.prism(shade(pal['wood'], 1.15), 5, 0.06, 0.0, 0.14, x, 0.2 + h, 0, phase=0.3 * i)
        B.box(pal['accent'], 1.0, 0.05, 0.05, 0.5, 0.6, 0.08)
        return
    h, thick = (1.05, 0.5) if t == 2 else (1.38, 0.6)
    frustum(B, pal['stone'], 1.0, thick + 0.12, 1.0, thick, h, x=0.5)        # battered ashlar
    B.box(pal['stone2'], 1.0, 0.04, thick + 0.1, 0.5, h * 0.38, 0)           # course line
    B.box(pal['roof'], 1.01, 0.1, thick + 0.02, 0.5, h - 0.1, 0)             # teal frieze
    # stepped crest: two small stepped blocks per segment
    for x in (0.25, 0.75):
        B.box(pal['stone'], 0.3, 0.12, thick * 0.7, x, h, 0)
        B.box(pal['stone2'], 0.16, 0.12, thick * 0.5, x, h + 0.12, 0)
    if t >= 3:
        for sz in (-1, 1):
            G.box(pal['glow'], 0.1, 0.1, 0.02, 0.5, h * 0.62, sz * (thick / 2 + 0.07))
            B.box(pal['trim'], 0.18, 0.18, 0.02, 0.5, h * 0.62 - 0.04, sz * (thick / 2 + 0.06))


def wall_post(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        # carved totem: stacked painted blocks, a sun on top
        B.box(pal['stone3'], 0.46, 0.26, 0.46, 0, 0, 0)
        cols = (pal['wood'], pal['accent'], pal['roof'], pal['wood'])
        for i, c in enumerate(cols):
            B.box(c, 0.26 - 0.02 * (i % 2), 0.24, 0.26, 0, 0.26 + i * 0.24, 0)
        B.box(pal['dark'], 0.18, 0.04, 0.02, 0, 0.6, 0.135)
        B.box(pal['trim'], 0.36, 0.06, 0.2, 0, 1.22, 0)
        return
    w = 0.74 if t == 2 else 0.84
    top = stepped(B, pal, w, 3 if t == 2 else 4, 0.45 if t == 2 else 0.42, 0.04)
    if t >= 3:
        sun_disc(B, G, pal, 0, top - 0.3, w / 2 - 0.1, r=0.12)
        for sx in (-1, 1):
            for sz in (-1, 1):
                B.box(pal['stone2'], 0.16, 0.16, 0.16, sx * (w / 2 - 0.2), top, sz * (w / 2 - 0.2))


def gatehouse(k, t, pal):
    B, G = k.B, k.G
    tx = 1.3
    if t == 1:
        for s in (-1, 1):
            x = s * tx
            frustum(B, pal['stone3'], 0.8, 0.8, 0.66, 0.66, 0.5, x=x)
            for (dx, dz) in ((-0.24, -0.24), (0.24, -0.24), (0.24, 0.24), (-0.24, 0.24)):
                B.prism(pal['wood'], 5, 0.055, 0.05, 0.9, x + dx, 0.5, dz)
            B.box(pal['wood'], 0.72, 0.08, 0.72, x, 1.2, 0)
            thatch_roof(B, pal, 0.62, 0.62, 1.6, 0.42, x=x)
            for dx in (-0.26, 0.26):
                B.prism(pal['wood'], 5, 0.04, 0.04, 0.4, x + dx, 1.2, 0.26)
        # a timber lintel with painted posts
        for sx in (-0.86, 0.86):
            B.box(pal['wood'], 0.14, 1.6, 0.14, sx, 0, 0.25)
            B.box(pal['accent'], 0.16, 0.12, 0.16, sx, 1.2, 0.25)
        B.box(pal['wood'], 2.0, 0.14, 0.18, 0, 1.5, 0.25)
        B.box(pal['roof'], 0.8, 0.12, 0.04, 0, 1.52, 0.35)
        sun_disc(B, G, pal, 0, 1.82, 0.32, r=0.14)
        B.box(pal['field'], 1.7, 0.03, 1.2, 0, 0, 0)
        return
    w = 0.96 if t == 2 else 1.06
    steps = 3 if t == 2 else 4
    sh = 0.62 if t == 2 else 0.6
    for s in (-1, 1):
        x = s * tx
        for i in range(steps):
            ww = w - 0.1 * i
            frustum(B, pal['stone'] if i % 2 == 0 else shade(pal['stone'], 0.94), ww, ww, ww - 0.08, ww - 0.08, sh,
                    y=i * sh, x=x)
            frustum(B, pal['roof'], ww - 0.05, ww - 0.05, ww - 0.06, ww - 0.06, 0.07, y=(i + 1) * sh - 0.14, x=x)
        top = steps * sh
        thatch_roof(B, pal, w - 0.4, w - 0.4, top + 0.38, 0.4, x=x)
        for dx in (-1, 1):
            for dz in (-1, 1):
                B.prism(pal['wood'], 5, 0.035, 0.035, 0.38, x + dx * (w - 0.5) / 2, top, dz * (w - 0.5) / 2)
        _torch(B, G, pal, x - s * (w / 2 + 0.06), 0, w / 2 + 0.06, h=0.8)
    # trapezoid gate: sloped jambs, a massive stepped lintel, a sun above
    for s in (-1, 1):
        B.box(pal['stone2'], 0.22, 1.5, 0.7, s * 0.86, 0, 0, 0, 0, s * 0.07)
    span = 2 * tx - w + 0.05
    B.box(pal['stone'], span, 0.42, 0.8, 0, 1.38, 0)
    B.box(pal['roof'], span + 0.02, 0.08, 0.82, 0, 1.62, 0)
    for i in range(5):
        x = -0.8 + i * 0.4
        B.box(pal['stone2'], 0.22, 0.14, 0.04, x, 1.43, 0.41)                     # step-fret
        B.box(pal['stone2'], 0.1, 0.1, 0.04, x + 0.08, 1.52, 0.41)
    B.box(pal['stone'], span * 0.66, 0.3, 0.6, 0, 1.8, 0)
    B.box(pal['stone2'], span * 0.36, 0.22, 0.4, 0, 2.1, 0)
    sun_disc(B, G, pal, 0, 2.02, 0.31, r=0.2 if t == 2 else 0.24)
    B.box(pal['stone2'], 1.7, 0.03, 1.2, 0, 0, 0)
    if t >= 3:
        G.box(pal['glow'], 1.2, 0.03, 0.25, 0, 0.035, 0.45)
        for s in (-1, 1):
            eu.banner(B, pal, s * 0.95, 0.42, 1.8, 0.9, big=0.6, flip=s > 0)


# ---------------------------------------------------------------- barracks

def camp(k, t, pal, trade='militia'):
    B, G = k.B, k.G
    col = eu.CAMP_COLORS[trade]
    frustum(B, pal['stone3'], 1.9, 1.9, 1.8, 1.8, 0.16)
    hw = 1.1 if t == 1 else 1.35
    B.box(pal['stone'], hw, 0.6, 0.72, 0, 0.16, -0.45)
    B.box(col, hw + 0.02, 0.08, 0.74, 0, 0.6, -0.45)                         # trade-colour frieze
    trap_door(B, pal, 0.28, 0.42, -0.08, y=0.16)
    thatch_roof(B, pal, hw, 0.72, 0.76, 0.48, z=-0.45)
    eu.banner(B, pal, -0.8, -0.1, 0.16, 1.3, color=col)
    # practice yard: a ring of stones and a feather-crowned target post
    for i in range(6):
        a = i / 6 * TAU
        B.box(pal['stone2'], 0.12, 0.1, 0.12, 0.35 + math.cos(a) * 0.38, 0.16, 0.45 + math.sin(a) * 0.3)
    B.box(pal['wood'], 0.08, 0.6, 0.08, 0.35, 0.16, 0.45)
    B.prism(col, 6, 0.14, 0.14, 0.06, 0.35, 0.6, 0.48, rx=math.pi / 2)
    for i in range(3):
        B.box((pal['accent'], pal['roof'], pal['trim'])[i], 0.04, 0.2, 0.03, 0.29 + i * 0.06, 0.76, 0.45, 0, 0,
              (i - 1) * 0.3)
    if t >= 2:
        _torch(B, G, pal, hw / 2 + 0.08, 0.16, -0.02, h=0.45)
        _torch(B, G, pal, -hw / 2 - 0.08, 0.16, -0.02, h=0.45)
        eu.banner(B, pal, 0.8, -0.1, 0.16, 1.3, color=col, flip=True)
    if t >= 3:
        # a small stepped shrine at the back corner
        for i in range(3):
            frustum(B, pal['stone'], 0.6 - 0.14 * i, 0.6 - 0.14 * i, 0.54 - 0.14 * i, 0.54 - 0.14 * i, 0.24,
                    y=0.16 + 0.24 * i, x=-0.6, z=0.55)
        G.octa(pal['glow'], 0.08, 0.12, -0.6, 0.16 + 0.72 + 0.14, 0.55)
        G.box(pal['glow'], hw, 0.05, 0.05, 0, 0.5, -0.07)


# ---------------------------------------------------------------- the army

def _feathers(B, pal, y, z, n=5, h=0.22, spread=0.9):
    cols = (pal['roof'], pal['accent'], pal['trim'], pal['accent'], pal['roof'])
    for i in range(n):
        a = (i - (n - 1) / 2) / (n - 1) * spread
        B.box(cols[i % 5], 0.05, h, 0.03, math.sin(a) * 0.06, y, z, 0, 0, -a)


def trooper(k, pal):
    """Obsidian Shieldbearer: quilted cotton armour, a feather crest, a big
    round sun shield and an obsidian-edged club."""
    B, G = k.B, k.G
    cot, teal = 0xf0e6cc, pal['roof']
    fig_legs(k, 0x6a4a30, pal['dark'], wide=1.1)
    B.box(cot, 0.4, 0.36, 0.26, 0, 0.32, 0)
    B.box(teal, 0.41, 0.06, 0.27, 0, 0.48, 0)
    B.box(pal['accent'], 0.41, 0.05, 0.27, 0, 0.38, 0)
    top, fz = fig_head(B, pal['skin'], 0.66)
    B.box(teal, 0.28, 0.08, 0.26, 0, top - 0.1, 0)                          # helm band
    _feathers(B, pal, top - 0.04, -0.06)
    A = arm(k, 'arm_l', -1, cot, sh=0.24)
    A.prism(teal, 10, 0.24, 0.24, 0.05, -0.32, 0.36, 0.14, rx=math.pi / 2, ry=-0.25)   # round shield
    A.prism(pal['trim'], 10, 0.12, 0.12, 0.02, -0.33, 0.36, 0.19, rx=math.pi / 2, ry=-0.25)
    G.prism(pal['glow'], 6, 0.05, 0.05, 0.02, -0.335, 0.36, 0.205, rx=math.pi / 2, ry=-0.25)
    R = arm(k, 'arm_r', 1, cot, sh=0.24)
    R.box(pal['wood'], 0.07, 0.5, 0.03, 0.27, 0.3, 0.1, 0.4, 0, 0)          # club
    for i in range(3):
        R.box(0x1c1a24, 0.11, 0.05, 0.035, 0.27, 0.45 + i * 0.12, 0.12 + i * 0.05, 0.4, 0, 0)


def ranger(k, pal):
    """Jaguar Scout: spotted hood with ears, a long blowgun."""
    B, G = k.B, k.G
    ochre, spot = 0xe0a640, 0x3a2a1a
    fig_legs(k, ochre, pal['dark'])
    B.box(ochre, 0.34, 0.32, 0.22, 0, 0.36, 0)
    for (x, y) in ((-0.1, 0.44), (0.08, 0.52), (0.1, 0.4), (-0.06, 0.58)):
        B.box(spot, 0.05, 0.05, 0.01, x, y, 0.115)
    top, fz = fig_head(B, pal['skin'], 0.66)
    B.prism(ochre, 8, 0.145, 0.12, 0.1, 0, top - 0.1, -0.01, phase=math.pi / 8)  # hood
    for sx in (-1, 1):
        B.prism(ochre, 4, 0.05, 0, 0.08, sx * 0.08, top - 0.01, -0.02)           # ears
        B.box(spot, 0.04, 0.04, 0.01, sx * 0.07, top - 0.07, 0.11)
    B.box(ochre, 0.22, 0.2, 0.08, 0, 0.46, -0.13)                               # pelt cape
    A = arm(k, 'arm_l', -1, ochre, sh=0.2)
    R = arm(k, 'arm_r', 1, ochre, sh=0.2)
    R.prism(pal['wood'], 6, 0.025, 0.025, 0.86, 0.22, 0.6, -0.2, rx=math.pi / 2 - 0.1)   # blowgun
    R.box(pal['roof'], 0.06, 0.06, 0.06, 0.22, 0.64, 0.5)
    G.box(pal['glow'], 0.03, 0.03, 0.03, 0.22, 0.66, 0.64)


def marksman(k, pal):
    """Solar Atlatl: a gold sun-ray headdress, a spear-thrower and a lit dart."""
    B, G = k.B, k.G
    teal = pal['roof']
    fig_legs(k, 0x4a3a2a, pal['dark'])
    B.box(teal, 0.36, 0.36, 0.24, 0, 0.32, 0)
    B.box(pal['trim'], 0.37, 0.06, 0.25, 0, 0.5, 0)
    B.box(pal['accent'], 0.2, 0.1, 0.25, 0, 0.38, 0)
    top, fz = fig_head(B, pal['skin'], 0.66)
    B.box(teal, 0.28, 0.07, 0.26, 0, top - 0.09, 0)
    B.prism(pal['trim'], 10, 0.2, 0.2, 0.03, 0, top - 0.04, -0.12, rx=math.pi / 2)   # sun-ray headdress
    for i in range(7):
        a = math.pi * (i / 6)
        B.box(pal['trim'], 0.04, 0.12, 0.02, math.cos(a) * 0.22, top - 0.04 + math.sin(a) * 0.22 - 0.06, -0.12,
              0, 0, a - math.pi / 2)
    G.prism(pal['glow'], 10, 0.09, 0.09, 0.02, 0, top - 0.04, -0.095, rx=math.pi / 2)
    arm(k, 'arm_l', -1, teal, sh=0.22)
    R = arm(k, 'arm_r', 1, teal, sh=0.22)
    R.box(pal['wood'], 0.04, 0.04, 0.42, 0.24, 0.62, 0.0, -0.5, 0, 0)           # atlatl
    R.box(pal['wood'], 0.025, 0.025, 0.9, 0.24, 0.86, -0.36, -0.5, 0, 0)        # dart
    G.octa(pal['glow'], 0.04, 0.09, 0.24, 1.08, 0.08)


farm, mill, mine, workshop, hero_forge, outpost = eu.farm, eu.mill, eu.mine, eu.workshop, eu.hero_forge, eu.outpost
hero, enemy, tree_round, tree_pine, rock, cliff = eu.hero, eu.enemy, eu.tree_round, eu.tree_pine, eu.rock, eu.cliff
