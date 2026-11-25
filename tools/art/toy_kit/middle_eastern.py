"""Middle Eastern culture — the Mirage Court.

An original sci-fi take on desert citadel architecture: warm sandstone,
turquoise tiled domes and bands, pointed-arch portals, slender minaret
towers with balconies, gold finials, cool cyan energy. The keep grows from
a domed hall into a wide tier-3 palace, then a tier-4 spire citadel: one
tall onion tower, four minarets, and a floating astrolabe. Its army: lancers
in tall turban-helms, dune riders on
hover skiffs with recurve bows, astrolabe longgun marksmen.

Same conventions as european.py: (kit, tier, pal), game space, +z front.
"""
import math

from kit import shade
from common import frustum, dome, fig_legs, fig_head, arm
import european as eu

PALETTE = dict(eu.PALETTE,
               stone=0xf2e0bc, stone2=0xdcc290, stone3=0xb48c5c, roof=0x2fa6c4, roof2=0x1f74a0,
               trim=0xf0c75a, banner=0x2f8fb0, accent=0xb8432f, wood=0x8a5a36, steel=0xb0b8c4,
               dark=0x2a2c38, glow=0x7fe8ff, warm=0xffd890, cloth=0xf4efe2, skin=0xd9a77a)

TAU = math.tau


def finial(B, pal, x, y, z, s=1.0):
    B.prism(pal['trim'], 6, 0.03 * s, 0.03 * s, 0.12 * s, x, y, z)
    B.ico(pal['trim'], 0.05 * s, x, y + 0.14 * s, z, sub=1)
    B.prism(pal['trim'], 6, 0.02 * s, 0.0, 0.14 * s, x, y + 0.18 * s, z)


def domed(B, G, pal, x, z, r, y, onion=False, drum=0.12, tiles=True):
    """A drum with a turquoise band and a dome on it; returns the tip y."""
    B.prism(pal['stone'], 8, r * 1.02, r * 1.02, drum, x, y, z, phase=math.pi / 8)
    if tiles:
        B.prism(pal['roof2'], 8, r * 1.04, r * 1.04, 0.04, x, y + drum - 0.05, z, phase=math.pi / 8)
    tip = dome(B, pal['roof'], r, y + drum, x=x, z=z, onion=onion)
    finial(B, pal, x, tip - 0.02, z, s=max(0.6, r * 1.6))
    return tip + 0.3


def arch(B, pal, w, h, x, z, y=0.0, fill=None, frame=None, depth=0.05):
    """A pointed-arch opening drawn on a +z face (a dark recess and frame)."""
    fill = fill if fill is not None else pal['dark']
    frame = frame if frame is not None else pal['roof']
    B.box(frame, w + 0.12, h * 0.66 + 0.04, depth, x, y, z)
    B.box(fill, w, h * 0.66, depth + 0.01, x, y, z + 0.004)
    # pointed head: two leaning half-panels meeting at the apex
    hh = h * 0.34
    a = math.atan2(w / 2, hh)
    L = math.hypot(w / 2, hh)
    for s in (-1, 1):
        B.box(frame, 0.07, L + 0.05, depth, x + s * (w / 2 + 0.02), y + h * 0.66, z, 0, 0, s * a)
        B.box(fill, w * 0.36, L * 0.78, depth + 0.01, x + s * w * 0.2, y + h * 0.66, z + 0.004, 0, 0, s * a * 0.62)


def merlons(B, pal, length, y, thick, n, c=None, axis='x', x0=0.0, z0=0.0, h=0.16):
    """Stepped (two-block) desert merlons along a run."""
    c = c if c is not None else pal['stone']
    for i in range(n):
        u = (i + 0.5) / n * length - length / 2
        x, z = (x0 + u, z0) if axis == 'x' else (x0, z0 + u)
        B.box(c, 0.16, h, thick * 0.8, x, y, z)
        B.box(c, 0.08, h * 0.6, thick * 0.6, x, y + h, z)


def minaret(B, G, pal, x, z, r, h, y=0.0, balcony=True, onion=True):
    B.prism(pal['stone2'], 8, r * 1.2, r * 1.2, 0.2, x, y, z, phase=math.pi / 8)
    B.prism(pal['stone'], 8, r, r * 0.9, h, x, y + 0.2, z, phase=math.pi / 8)
    for f in (0.35, 0.7):
        B.prism(pal['roof'], 8, r * (1 - 0.1 * f) + 0.012, r * (1 - 0.1 * f) + 0.012, 0.06, x, y + 0.2 + h * f, z,
                phase=math.pi / 8)
    top = y + 0.2 + h
    if balcony:
        B.prism(pal['stone2'], 8, r * 1.35, r * 1.35, 0.08, x, top, z, phase=math.pi / 8)
        B.prism(pal['stone'], 8, r * 0.75, r * 0.75, 0.26, x, top + 0.08, z, phase=math.pi / 8)
        G.prism(pal['glow'], 8, r * 0.77, r * 0.77, 0.05, x, top + 0.18, z, phase=math.pi / 8)
        top += 0.34
    return domed(B, G, pal, x, z, r * 0.8, top, onion=onion, drum=0.04, tiles=False)


def _spire_citadel(k, pal, half):
    """Tier-4 keep crown: one tall onion spire and four minarets.

    The tier-3 keep is a wide three-dome palace. This replaces that mass so
    the two tiers do not read as the same shell."""
    B, G = k.B, k.G
    frustum(B, pal['stone2'], 2.3, 2.1, 2.1, 1.9, 0.24, y=0.16, z=-0.16)
    shaft_y, shaft_h = 0.4, 3.05
    B.box(pal['stone'], 1.0, shaft_h, 1.0, 0, shaft_y, -0.18)
    B.box(pal['roof'], 1.04, 0.08, 1.04, 0, shaft_y + 1.05, -0.18)
    B.box(pal['roof2'], 1.04, 0.07, 1.04, 0, shaft_y + 2.15, -0.18)
    arch(B, pal, 0.32, 0.58, 0, 0.33, y=shaft_y + 0.28)
    G.box(pal['warm'], 0.14, 0.2, 0.03, 0, shaft_y + 1.5, 0.33)
    bal_y = shaft_y + shaft_h
    B.prism(pal['stone2'], 8, 0.72, 0.72, 0.1, 0, bal_y, -0.18, phase=math.pi / 8)
    for i in range(8):
        a = i / 8 * TAU + math.pi / 8
        B.box(pal['stone'], 0.1, 0.16, 0.08, math.cos(a) * 0.66, bal_y + 0.1, math.sin(a) * 0.66 - 0.18,
              0, -a, 0)
    G.prism(pal['glow'], 8, 0.66, 0.66, 0.045, 0, bal_y + 0.02, -0.18, phase=math.pi / 8)
    tip = domed(B, G, pal, 0, -0.18, 0.48, bal_y + 0.1, onion=True, drum=0.16)
    for (x, z) in ((-half, -half), (half, -half), (half, half), (-half, half)):
        minaret(B, G, pal, x, z, 0.15, 2.55, y=0.16, balcony=True, onion=True)
    # The astrolabe sits on the onion, close enough to read as its crown.
    cy = tip + 0.28
    core = k.part('part_core', origin=(0, cy, -0.18))
    for i in range(10):
        a = i / 10 * TAU
        core.box(pal['trim'], 0.06, 0.06, 0.18, math.cos(a) * 0.32, cy - 0.03, math.sin(a) * 0.32 - 0.18, 0, -a, 0)
    for i in range(8):
        a = i / 8 * TAU
        core.box(pal['trim'], 0.045, 0.2, 0.045, math.cos(a) * 0.22, cy + math.sin(a) * 0.22 - 0.1, -0.18)
    G.octa(pal['glow'], 0.12, 0.18, 0, cy, -0.18)


def castle(k, t, pal):
    B, G = k.B, k.G
    frustum(B, pal['stone3'], 4.2, 4.2, 4.0, 4.0, 0.16)
    if t == 1:
        B.box(pal['stone'], 1.6, 1.05, 1.5, 0, 0.16, -0.1)
        B.box(pal['roof'], 1.62, 0.08, 1.52, 0, 0.9, -0.1)
        merlons(B, pal, 1.6, 1.21, 0.2, 7, z0=0.65)
        domed(B, G, pal, 0, -0.1, 0.55, 1.21, drum=0.2)
        arch(B, pal, 0.5, 0.8, 0, 0.66, y=0.16)
        for sx in (-1, 1):
            minaret(B, G, pal, sx * 0.86, 0.6, 0.14, 1.25, y=0.16, balcony=False)
        eu.banner(B, pal, -0.95, -0.7, 0.16, 1.6)
        return
    half = {2: 1.55, 3: 1.7, 4: 1.82}[t]
    wh = {2: 0.95, 3: 1.2, 4: 1.55}[t]
    th = 0.3
    # curtain with stepped merlons, a turquoise tile band
    for (x0, z0, x1, z1) in ((-half, -half, half, -half), (half, -half, half, half), (-half, half, -half, -half)):
        L = math.hypot(x1 - x0, z1 - z0)
        yaw = math.atan2(x1 - x0, z1 - z0)
        B.box(pal['stone'], th, wh, L, (x0 + x1) / 2, 0.16, (z0 + z1) / 2, 0, yaw, 0)
        B.box(pal['roof'], th + 0.02, 0.07, L, (x0 + x1) / 2, 0.16 + wh - 0.2, (z0 + z1) / 2, 0, yaw, 0)
    for s in (-1, 1):
        L = half - 0.55
        B.box(pal['stone'], L, wh, th, s * (0.55 + L / 2), 0.16, half)
        B.box(pal['roof'], L, 0.07, th + 0.02, s * (0.55 + L / 2), 0.16 + wh - 0.2, half)
        merlons(B, pal, L, 0.16 + wh, th, 3, x0=s * (0.55 + L / 2), z0=half)
    merlons(B, pal, 2 * half, 0.16 + wh, th, 9, x0=0, z0=-half)
    merlons(B, pal, 2 * half, 0.16 + wh, th, 9, axis='z', x0=half)
    merlons(B, pal, 2 * half, 0.16 + wh, th, 9, axis='z', x0=-half)
    # round corner towers with small domes. Tier 4 stands minarets here instead.
    if t < 4:
        for (x, z) in ((-half, -half), (half, -half), (half, half), (-half, half)):
            r = 0.36 if t == 2 else 0.4
            B.prism(pal['stone2'], 8, r, r * 0.95, wh + 0.4, x, 0.16, z, phase=math.pi / 8)
            B.prism(pal['roof'], 8, r + 0.01, r + 0.01, 0.07, x, 0.16 + wh, z, phase=math.pi / 8)
            domed(B, G, pal, x, z, r * 0.8, 0.16 + wh + 0.4, onion=t >= 3, drum=0.06)
    # the iwan portal: a tall framed pointed arch over the gap
    for s in (-1, 1):
        B.box(pal['stone2'], 0.22, wh + 0.6, 0.42, s * 0.6, 0.16, half)
    B.box(pal['stone2'], 1.42, 0.5, 0.42, 0, 0.16 + wh + 0.1, half)
    B.box(pal['roof'], 1.44, 0.08, 0.44, 0, 0.16 + wh + 0.6, half)
    merlons(B, pal, 1.42, 0.16 + wh + 0.68, 0.3, 5, x0=0, z0=half)
    arch(B, pal, 0.7, 0.62, 0, half + 0.22, y=0.16 + wh - 0.2)
    G.box(pal['glow'], 0.5, 0.04, 0.02, 0, 0.16 + wh + 0.45, half + 0.22)
    if t < 4:
        # the palace and its domes. Tier 3 is this wide hall; tier 4 is the spire.
        pw = 1.6 if t == 2 else 1.8
        B.box(pal['stone'], pw, 1.1, pw * 0.85, 0, 0.16, -0.25)
        B.box(pal['roof'], pw + 0.02, 0.08, pw * 0.85 + 0.02, 0, 0.16 + 0.9, -0.25)
        for x in (-0.45, 0, 0.45):
            arch(B, pal, 0.26, 0.5, x, -0.25 + pw * 0.425 + 0.01, y=0.3, fill=shade(pal['dark'], 1.4) if x else pal['dark'])
        for x in (-0.45, 0.45):
            G.box(pal['warm'], 0.12, 0.12, 0.02, x, 0.42, -0.25 + pw * 0.425 + 0.04)
        domed(B, G, pal, 0, -0.25, 0.62 if t == 2 else 0.7, 1.26, onion=t >= 3, drum=0.22)
        if t >= 3:
            for sx in (-1, 1):
                domed(B, G, pal, sx * 0.62, 0.2, 0.26, 1.26, drum=0.08)
                minaret(B, G, pal, sx * 0.78, -0.9, 0.16, 1.8, y=0.16)
    else:
        _spire_citadel(k, pal, half)
    eu.banner(B, pal, -half + 0.35, -half + 0.3, 0.16 + wh, 1.2, big=0.9)
    if t >= 3:
        eu.banner(B, pal, half - 0.35, -half + 0.3, 0.16 + wh, 1.2, big=0.9, flip=True)


def tower(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        B.prism(pal['stone3'], 8, 0.6, 0.6, 0.12, 0, 0, 0, phase=math.pi / 8)
        B.prism(pal['stone2'], 8, 0.5, 0.44, 1.0, 0, 0.12, 0, phase=math.pi / 8)
        for i in range(8):
            a = i / 8 * TAU
            B.prism(pal['stone2'], 6, 0.07, 0.04, 0.16, math.cos(a) * 0.4, 1.12, math.sin(a) * 0.4)
        top, s = 1.12, 0.8
    else:
        h = {2: 1.6, 3: 2.2, 4: 2.8}[t]
        r = {2: 0.5, 3: 0.54, 4: 0.56}[t]
        B.prism(pal['stone3'], 8, r + 0.12, r + 0.1, 0.3, 0, 0, 0, phase=math.pi / 8)
        B.prism(pal['stone'], 8, r, r * 0.92, h - 0.3, 0, 0.3, 0, phase=math.pi / 8)
        for f in ((0.45,) if t == 2 else (0.35, 0.65)):
            B.prism(pal['roof'], 8, r * (1 - 0.08 * f) + 0.012, r * (1 - 0.08 * f) + 0.012, 0.08, 0, h * f, 0,
                    phase=math.pi / 8)
        arch(B, pal, 0.18, 0.34, 0, r * 0.92 + 0.02, y=h * 0.55)
        # balcony ring with stepped merlons
        B.prism(pal['stone2'], 8, r + 0.14, r + 0.14, 0.1, 0, h, 0, phase=math.pi / 8)
        for i in range(8):
            a = i / 8 * TAU + math.pi / 8
            B.box(pal['stone2'], 0.14, 0.14, 0.1, math.cos(a) * (r + 0.06), h + 0.1, math.sin(a) * (r + 0.06),
                  0, -a + math.pi / 2, 0)
        top, s = h + 0.1, {2: 0.95, 3: 1.1, 4: 1.2}[t]
        if t >= 3:
            for sx in (-1, 1):
                minaret(B, G, pal, sx * (r + 0.1), -0.2, 0.08, h * 0.55, y=0.0, balcony=False)
        if t >= 4:
            G.prism(pal['glow'], 8, r * 0.95, r * 0.95, 0.05, 0, h * 0.82, 0, phase=math.pi / 8)
    if t == 1:
        eu.banner(B, pal, -0.5, 0.5, 0, 1.6)
    head = k.part('part_turret', origin=(0, top, 0))
    eu.turret_head(head, pal, s, twin=t >= 3, coil=t >= 4, oy=top)


def _cube(B, G, pal, w, d, h, x, z, y=0.1, band=True):
    B.box(pal['stone'], w, h, d, x, y, z)
    B.box(pal['stone2'], w + 0.04, 0.06, d + 0.04, x, y + h, z)
    if band:
        B.box(pal['roof'], w + 0.01, 0.05, d + 0.01, x, y + h - 0.16, z)


def _awning(B, pal, w, x, y, z):
    for i in range(4):
        c = pal['accent'] if i % 2 == 0 else pal['cloth']
        B.box(c, w / 4, 0.03, 0.3, x - w / 2 + w / 8 + i * w / 4, y, z + 0.12, -0.35, 0, 0)
    for sx in (-1, 1):
        B.box(pal['wood'], 0.03, y - 0.1, 0.03, x + sx * w / 2, 0.1, z + 0.26)


def _windcatcher(B, pal, x, z, y, h=0.4):
    B.box(pal['stone2'], 0.22, h, 0.22, x, y, z)
    B.box(pal['dark'], 0.14, 0.12, 0.23, x, y + h - 0.16, z)
    B.box(pal['stone2'], 0.26, 0.04, 0.26, x, y + h, z)


def house(k, t, pal):
    B, G = k.B, k.G
    B.box(pal['stone3'], 1.6, 0.1, 1.5, 0, 0, 0)
    if t == 1:
        _cube(B, G, pal, 1.05, 0.85, 0.62, 0, 0)
        arch(B, pal, 0.24, 0.42, 0, 0.43, y=0.1)
        G.box(pal['warm'], 0.12, 0.14, 0.02, 0.32, 0.38, 0.43)
        _windcatcher(B, pal, -0.3, -0.2, 0.78)
        B.prism(0xa34a2a, 8, 0.1, 0.08, 0.2, 0.6, 0.1, 0.5)       # water jar
        return
    if t == 2:
        _cube(B, G, pal, 1.15, 0.95, 0.66, 0, 0)
        _cube(B, G, pal, 0.6, 0.6, 0.42, -0.22, -0.12, y=0.82)
        domed(B, G, pal, 0.3, 0.05, 0.22, 0.82, drum=0.05)
        arch(B, pal, 0.26, 0.44, 0.22, 0.48, y=0.1)
        G.box(pal['warm'], 0.12, 0.14, 0.02, -0.3, 0.4, 0.48)
        _awning(B, pal, 0.44, -0.3, 0.52, 0.42)
        return
    if t == 3:
        _cube(B, G, pal, 1.35, 0.55, 0.85, 0, -0.42)
        _cube(B, G, pal, 0.45, 0.6, 0.65, 0.45, 0.3)
        for x in (-0.4, 0.0, 0.4):
            arch(B, pal, 0.22, 0.5, x, -0.14, y=0.1, fill=shade(pal['dark'], 1.3))
        domed(B, G, pal, -0.3, -0.42, 0.22, 0.95, drum=0.05)
        _windcatcher(B, pal, 0.35, -0.42, 0.95, h=0.5)
        B.prism(pal['wood'], 6, 0.04, 0.035, 0.7, -0.4, 0.1, 0.4)          # palm
        for i in range(5):
            a = i / 5 * TAU
            B.box(0x4f9a52, 0.08, 0.03, 0.34, -0.4 + math.cos(a) * 0.14, 0.78, 0.4 + math.sin(a) * 0.14, -0.3, -a + math.pi / 2, 0)
        B.prism(pal['roof'], 8, 0.2, 0.22, 0.08, 0.0, 0.1, 0.35)            # fountain
        G.prism(pal['glow'], 8, 0.14, 0.14, 0.03, 0.0, 0.16, 0.35)
        return
    _cube(B, G, pal, 1.2, 1.05, 0.8, 0, 0)
    _cube(B, G, pal, 0.95, 0.8, 0.55, -0.05, -0.08, y=0.96)
    domed(B, G, pal, -0.05, -0.08, 0.34, 1.57, drum=0.08, onion=True)
    _windcatcher(B, pal, 0.42, -0.35, 1.57, h=0.45)
    arch(B, pal, 0.28, 0.5, 0, 0.53, y=0.1)
    for sx in (-1, 1):
        G.box(pal['warm'], 0.12, 0.16, 0.02, sx * 0.3, 1.18, 0.33)
    _awning(B, pal, 0.5, 0.3, 0.6, 0.47)
    eu.banner(B, pal, 0.72, 0.4, 0.1, 1.6, big=0.7)


# ---------------------------------------------------------------- ramparts

def wall_seg(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        # mud-brick wall with rounded merlons
        B.box(pal['stone3'], 1.02, 0.66, 0.34, 0.5, 0, 0)
        B.box(shade(pal['stone3'], 0.9), 1.02, 0.04, 0.35, 0.5, 0.3, 0)
        for x in (0.25, 0.75):
            B.prism(pal['stone3'], 6, 0.12, 0.06, 0.18, x, 0.66, 0)
        return
    h, thick = (1.1, 0.44) if t == 2 else (1.42, 0.52)
    B.box(pal['stone3'], 1.02, 0.2, thick + 0.1, 0.5, 0, 0)
    B.box(pal['stone'], 1.0, h - 0.2, thick, 0.5, 0.2, 0)
    B.box(pal['roof'], 1.0, 0.08, thick + 0.02, 0.5, h - 0.24, 0)
    if t >= 3:
        B.box(pal['roof2'], 1.0, 0.05, thick + 0.02, 0.5, h - 0.34, 0)
        for sz in (-1, 1):
            G.box(pal['glow'], 0.3, 0.04, 0.02, 0.5, h * 0.5, sz * (thick / 2 + 0.01))
    merlons(B, pal, 1.0, h, thick, 3, x0=0.5)


def wall_post(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        B.prism(pal['stone3'], 8, 0.3, 0.26, 0.85, 0, 0, 0, phase=math.pi / 8)
        B.prism(pal['stone3'], 8, 0.16, 0.0, 0.22, 0, 0.85, 0, phase=math.pi / 8)
        return
    r, h = (0.38, 1.4) if t == 2 else (0.44, 1.75)
    B.prism(pal['stone2'], 8, r + 0.06, r + 0.06, 0.24, 0, 0, 0, phase=math.pi / 8)
    B.prism(pal['stone'], 8, r, r * 0.94, h - 0.24, 0, 0.24, 0, phase=math.pi / 8)
    B.prism(pal['roof'], 8, r * 0.96 + 0.01, r * 0.96 + 0.01, 0.07, 0, h - 0.3, 0, phase=math.pi / 8)
    if t == 2:
        for i in range(6):
            a = i / 6 * TAU
            B.box(pal['stone'], 0.12, 0.14, 0.1, math.cos(a) * r * 0.82, h, math.sin(a) * r * 0.82, 0, -a + math.pi / 2, 0)
    else:
        domed(B, G, pal, 0, 0, r * 0.8, h, onion=True, drum=0.05)


def gatehouse(k, t, pal):
    B, G = k.B, k.G
    tx = 1.3
    if t == 1:
        for s in (-1, 1):
            x = s * tx
            B.prism(pal['stone3'], 8, 0.42, 0.36, 1.4, x, 0, 0, phase=math.pi / 8)
            for i in range(6):
                a = i / 6 * TAU
                B.prism(pal['stone3'], 6, 0.08, 0.04, 0.16, x + math.cos(a) * 0.3, 1.4, math.sin(a) * 0.3)
        for s in (-1, 1):
            B.box(pal['stone3'], 0.22, 1.35, 0.5, s * 0.86, 0, 0.0)
        B.box(pal['stone3'], 1.94, 0.32, 0.5, 0, 1.35, 0)
        arch(B, pal, 0.8, 0.5, 0, 0.26, y=1.0, fill=pal['stone3'], frame=pal['roof'])
        B.box(pal['field'], 1.7, 0.03, 1.2, 0, 0, 0)
        return
    r = 0.52 if t == 2 else 0.58
    h = 1.9 if t == 2 else 2.3
    for s in (-1, 1):
        x = s * tx
        B.prism(pal['stone2'], 8, r + 0.08, r + 0.06, 0.3, x, 0, 0, phase=math.pi / 8)
        B.prism(pal['stone'], 8, r, r * 0.92, h - 0.3, x, 0.3, 0, phase=math.pi / 8)
        B.prism(pal['roof'], 8, r * 0.94 + 0.012, r * 0.94 + 0.012, 0.08, x, h - 0.4, 0, phase=math.pi / 8)
        domed(B, G, pal, x, 0, r * 0.82, h, onion=t >= 3, drum=0.08)
        if t >= 3:
            G.box(pal['glow'], 0.08, 0.2, 0.02, x, h * 0.55, r * 0.92 + 0.01)
    # the pishtaq: a tall tiled frame around a pointed arch over the passage
    for s in (-1, 1):
        B.box(pal['stone'], 0.22, h - 0.2, 0.62, s * 0.88, 0, 0)
    B.box(pal['stone'], 1.98, 0.7 if t == 2 else 0.9, 0.62, 0, 1.4, 0)
    top = 1.4 + (0.7 if t == 2 else 0.9)
    B.box(pal['roof'], 2.0, 0.08, 0.64, 0, top - 0.12, 0)
    merlons(B, pal, 1.98, top, 0.5, 5, x0=0)
    arch(B, pal, 1.3, 1.1 if t == 2 else 1.3, 0, 0.32, y=1.4 - 0.02, frame=pal['roof'],
         fill=shade(pal['dark'], 1.2))
    for s in (-1, 1):
        B.box(pal['roof2'], 0.06, top - 0.2, 0.04, s * 0.99, 0, 0.32)
    B.box(pal['stone2'], 1.7, 0.03, 1.2, 0, 0, 0)
    if t >= 3:
        G.box(pal['glow'], 1.2, 0.03, 0.25, 0, 0.035, 0.45)
        finial(B, pal, 0, top + 0.26, 0, s=1.4)


# ---------------------------------------------------------------- barracks

def camp(k, t, pal, trade='militia'):
    B, G = k.B, k.G
    col = eu.CAMP_COLORS[trade]
    B.box(pal['stone3'], 1.9, 0.1, 1.9, 0, 0, 0)
    hw = 1.1 if t == 1 else 1.35
    _cube(B, G, pal, hw, 0.72, 0.68, 0, -0.45)
    B.box(col, hw + 0.02, 0.06, 0.74, 0, 0.52, -0.45)                        # trade-colour band
    arch(B, pal, 0.3, 0.5, 0, -0.08, y=0.1)
    # striped pavilion tent over the yard
    for i in range(4):
        c = col if i % 2 == 0 else pal['cloth']
        B.box(c, 0.22, 0.03, 0.8, 0.12 + i * 0.22, 0.95, 0.45, 0, 0, (0.35 if i < 2 else -0.35))
    for (x, z) in ((0.08, 0.1), (0.9, 0.1), (0.08, 0.8), (0.9, 0.8)):
        B.box(pal['wood'], 0.04, 0.85, 0.04, x, 0.1, z)
    B.box(pal['wood'], 0.5, 0.05, 0.06, -0.45, 0.42, 0.55)                  # spear rack
    for x in (-0.6, -0.45, -0.3):
        B.box(pal['steel'], 0.03, 0.7, 0.03, x, 0.1, 0.5)
    eu.banner(B, pal, -0.8, -0.1, 0.1, 1.3, color=col)
    if t >= 2:
        domed(B, G, pal, 0, -0.45, 0.28, 0.78, drum=0.05)
        eu.banner(B, pal, 0.8, -0.1, 0.1, 1.3, color=col, flip=True)
    if t >= 3:
        minaret(B, G, pal, -0.78, -0.78, 0.12, 1.3, y=0.1, balcony=False)
        G.box(pal['glow'], hw, 0.05, 0.05, 0, 0.6, -0.08)


# ---------------------------------------------------------------- the army

def _turban(B, pal, top, c, tall=0.14, spike=True):
    B.prism(c, 8, 0.15, 0.14, tall, 0, top - 0.1, 0, phase=math.pi / 8)
    B.prism(shade(c, 0.88), 8, 0.155, 0.155, 0.04, 0, top - 0.06, 0, phase=math.pi / 8)
    B.prism(c, 8, 0.12, 0.05, 0.1, 0, top - 0.1 + tall, 0, phase=math.pi / 8)
    if spike:
        B.prism(pal['trim'], 6, 0.025, 0.0, 0.16, 0, top + tall, 0)


def trooper(k, pal):
    """Mirage Lancer: long white coat, a turquoise turban-helm, a lance with
    a pennant and a small round buckler."""
    B, G = k.B, k.G
    coat, teal = pal['cloth'], pal['roof']
    fig_legs(k, 0x5a4a6a, pal['dark'])
    B.box(coat, 0.36, 0.36, 0.24, 0, 0.32, 0)
    B.box(coat, 0.4, 0.2, 0.26, 0, 0.16, 0)                                  # coat skirt
    B.box(teal, 0.06, 0.36, 0.25, 0, 0.32, 0.005)                            # sash
    B.box(pal['trim'], 0.37, 0.04, 0.25, 0, 0.44, 0)
    top, fz = fig_head(B, pal['skin'], 0.66)
    _turban(B, pal, top, teal)
    B.box(pal['steel'], 0.04, 0.12, 0.02, 0, top - 0.2, fz + 0.01)          # nasal guard
    A = arm(k, 'arm_l', -1, coat)
    A.prism(pal['steel'], 8, 0.15, 0.15, 0.04, -0.3, 0.36, 0.12, rx=math.pi / 2)
    A.prism(pal['trim'], 8, 0.05, 0.0, 0.05, -0.3, 0.36, 0.16, rx=math.pi / 2)
    R = arm(k, 'arm_r', 1, coat)
    R.box(pal['wood'], 0.035, 1.4, 0.035, 0.26, 0.0, 0.1)                    # lance
    R.prism(pal['steel'], 4, 0.04, 0.0, 0.22, 0.26, 1.4, 0.1)
    R.box(teal, 0.02, 0.12, 0.22, 0.26, 1.18, 0.0)                           # pennant
    G.box(pal['glow'], 0.02, 0.04, 0.04, 0.26, 1.6, 0.1)


def ranger(k, pal):
    """Dune Rider: a scarf-wrapped scout on a small hover skiff, recurve bow."""
    B, G = k.B, k.G
    sand, scarf = 0xd8b884, pal['accent']
    # the skiff under the feet
    B.prism(pal['stone2'], 8, 0.32, 0.3, 0.05, 0, 0.0, 0.02, sz=1.4)
    B.prism(pal['roof'], 8, 0.33, 0.33, 0.02, 0, 0.04, 0.02, sz=1.4)
    G.prism(pal['glow'], 8, 0.2, 0.2, 0.02, 0, -0.01, 0.02, sz=1.4)
    fig_legs(k, 0x6a5a48, pal['dark'])
    B.box(sand, 0.34, 0.32, 0.22, 0, 0.36, 0)
    B.box(scarf, 0.3, 0.1, 0.24, 0, 0.6, 0.0)
    B.box(scarf, 0.08, 0.26, 0.04, 0.08, 0.38, -0.13, 0.25, 0, 0)          # trailing scarf
    top, fz = fig_head(B, pal['skin'], 0.66)
    _turban(B, pal, top, sand, tall=0.08, spike=False)
    B.box(scarf, 0.22, 0.07, 0.03, 0, 0.7, fz + 0.005)                      # face wrap
    A = arm(k, 'arm_l', -1, sand, sh=0.22)
    for (dy, rz) in ((0.0, 0.0), (0.2, 0.5), (-0.2, -0.5)):
        A.box(pal['wood'], 0.04, 0.24, 0.04, -0.26, 0.26 + dy, 0.2, 0, 0, rz)   # recurve bow
    A.box(pal['glow'], 0.01, 0.6, 0.01, -0.26, 0.1, 0.16)
    arm(k, 'arm_r', 1, sand, sh=0.22)
    B.box(pal['wood'], 0.1, 0.3, 0.1, 0.12, 0.42, -0.17)                    # quiver


def marksman(k, pal):
    """Astrolabe Longgun: a very long brass-ringed rifle, an astrolabe sight."""
    B, G = k.B, k.G
    robe, blue = 0x3c4a78, pal['roof2']
    fig_legs(k, robe, pal['dark'])
    B.box(robe, 0.36, 0.36, 0.24, 0, 0.32, 0)
    B.box(pal['trim'], 0.37, 0.05, 0.25, 0, 0.46, 0)
    B.box(robe, 0.4, 0.18, 0.26, 0, 0.16, 0)
    top, fz = fig_head(B, pal['skin'], 0.66)
    _turban(B, pal, top, pal['cloth'], tall=0.12, spike=False)
    B.box(blue, 0.31, 0.04, 0.31, 0, top - 0.04, 0)
    arm(k, 'arm_l', -1, robe, sh=0.22)
    R = arm(k, 'arm_r', 1, robe, sh=0.22)
    R.prism(pal['steel'], 6, 0.035, 0.03, 1.2, 0.22, 0.62, -0.3, rx=math.pi / 2)    # long barrel
    for zz in (0.0, 0.35, 0.7):
        R.prism(pal['trim'], 6, 0.05, 0.05, 0.04, 0.22, 0.62, zz, rx=math.pi / 2)
    R.prism(pal['trim'], 10, 0.1, 0.1, 0.02, 0.22, 0.76, -0.05, rx=math.pi / 2)    # astrolabe sight
    G.prism(pal['glow'], 6, 0.03, 0.03, 0.03, 0.22, 0.62, 0.9, rx=math.pi / 2)


# ---------------------------------------------------------------- economy
#
# A walled garden, a lateen-sail mill and an iwan forge. Original shapes on
# the sandstone, turquoise and pointed-arch language of the keep.

def _palm(B, x, z, h=0.7, y=0.08):
    B.prism(0x8a5a36, 6, 0.04, 0.028, h, x, y, z)
    for i in range(5):
        a = i / 5 * TAU
        B.box(0x3e8a48, 0.06, 0.025, 0.28, x + math.cos(a) * 0.1, y + h, z + math.sin(a) * 0.1,
              -0.4, -a + math.pi / 2, 0)


def _bed(B, pal, x, z, w, d, y=0.08, gold=False):
    B.box(pal['stone2'], w + 0.06, 0.08, d + 0.06, x, y, z)
    B.box(0xc6a24a if gold else 0x6a9a48, w, 0.06, d, x, y + 0.06, z)


def _court_walls(B, pal, w, d, h, z=0.0):
    """Three sandstone walls and a front gate gap."""
    B.box(pal['stone'], w, h, 0.1, 0, 0.06, z - d / 2)
    B.box(pal['stone'], 0.1, h, d, -w / 2, 0.06, z)
    B.box(pal['stone'], 0.1, h, d, w / 2, 0.06, z)
    B.box(pal['stone'], w * 0.28, h, 0.1, -w * 0.32, 0.06, z + d / 2)
    B.box(pal['stone'], w * 0.28, h, 0.1, w * 0.32, 0.06, z + d / 2)
    B.box(pal['roof'], w, 0.04, 0.12, 0, 0.06 + h, z - d / 2)


def farm(k, t, pal):
    """Mirage gardens. Tier 1 is a walled plot; tier 3 is a four-bed charbagh
    with a cyan water cross and a small onion pavilion."""
    B, G = k.B, k.G
    B.box(pal['stone3'], 1.75, 0.06, 1.65, 0, 0, 0)
    if t == 1:
        _court_walls(B, pal, 1.55, 1.4, 0.32)
        _bed(B, pal, -0.28, -0.1, 0.55, 0.7)
        _bed(B, pal, 0.32, -0.1, 0.55, 0.7, gold=True)
        _palm(B, -0.55, 0.48, h=0.55)
        B.box(pal['stone'], 0.4, 0.32, 0.36, 0.4, 0.06, 0.42)
        domed(B, G, pal, 0.4, 0.42, 0.16, 0.38, drum=0.04, tiles=False)
        B.prism(0xa34a2a, 8, 0.08, 0.07, 0.14, -0.15, 0.06, 0.55)
        return
    if t == 2:
        _court_walls(B, pal, 1.6, 1.45, 0.42)
        _bed(B, pal, -0.32, -0.28, 0.5, 0.45)
        _bed(B, pal, 0.32, -0.28, 0.5, 0.45, gold=True)
        _bed(B, pal, -0.32, 0.22, 0.5, 0.38)
        B.prism(pal['stone2'], 8, 0.18, 0.18, 0.1, 0, 0.06, -0.02, phase=math.pi / 8)
        G.prism(pal['glow'], 8, 0.1, 0.1, 0.04, 0, 0.14, -0.02, phase=math.pi / 8)
        B.box(pal['stone'], 0.55, 0.4, 0.45, 0.4, 0.06, 0.4)
        domed(B, G, pal, 0.4, 0.4, 0.2, 0.46, drum=0.05)
        _windcatcher(B, pal, -0.55, -0.5, 0.48, h=0.4)
        _palm(B, -0.6, 0.45, h=0.65)
        _palm(B, 0.62, -0.45, h=0.5)
        _awning(B, pal, 0.4, -0.15, 0.48, 0.55)
        return
    # tier 3 charbagh: four beds, a glowing water cross, an onion pavilion
    for sx in (-1, 1):
        for sz, gold in ((-1, False), (1, True)):
            _bed(B, pal, sx * 0.38, sz * 0.32, 0.55, 0.42, gold=gold and sx > 0)
    G.box(pal['glow'], 1.35, 0.03, 0.1, 0, 0.1, 0)
    G.box(pal['glow'], 0.1, 0.03, 1.15, 0, 0.1, 0)
    B.prism(pal['stone2'], 8, 0.16, 0.16, 0.08, 0, 0.08, 0, phase=math.pi / 8)
    B.box(pal['stone'], 0.5, 0.45, 0.45, 0, 0.08, -0.55)
    domed(B, G, pal, 0, -0.55, 0.22, 0.53, onion=True, drum=0.06)
    _palm(B, -0.7, 0.55, h=0.75)
    _palm(B, 0.7, 0.55, h=0.6)
    _windcatcher(B, pal, 0.55, -0.55, 0.55, h=0.45)
    eu.banner(B, pal, -0.75, -0.6, 0.06, 1.2, big=0.75)


def _lateen_rotor(k, pal, hub_y, z, length):
    """Four white lateen sails on turquoise spars. Spins in XY."""
    rotor = k.part('part_rotor', origin=(0, hub_y, z))
    rotor.prism(pal['trim'], 8, 0.12, 0.12, 0.07, 0, hub_y - 0.035, z, rx=math.pi / 2)
    rotor.prism(pal['roof'], 8, 0.06, 0.06, 0.04, 0, hub_y - 0.02, z + 0.05, rx=math.pi / 2)
    for i in range(4):
        a = i * math.pi / 2 + 0.35
        dx, dy = math.cos(a), math.sin(a)
        rotor.box(pal['roof'], 0.045, length, 0.03, 0, hub_y, z, 0, 0, a - math.pi / 2)
        along, aside = length * 0.26, 0.12
        rotor.box(pal['cloth'], 0.32, length * 0.66, 0.02,
                  dx * along - dy * aside, hub_y + dy * along + dx * aside, z + 0.03, 0, 0, a - math.pi / 2)
        rotor.box(pal['roof2'], 0.32, 0.03, 0.025,
                  dx * (along + length * 0.52) - dy * aside,
                  hub_y + dy * (along + length * 0.52) + dx * aside - 0.015,
                  z + 0.04, 0, 0, a - math.pi / 2)
    return rotor


def mill(k, t, pal):
    """Sandstone mill tower, turquoise band, dome cap and lateen sails.
    A windcatcher joins at tier 2; tier 3 wears an onion dome and a second one."""
    B, G = k.B, k.G
    h = {1: 1.05, 2: 1.4, 3: 1.65}[t]
    B.box(pal['stone3'], 1.15, 0.14, 1.05, 0, 0, -0.05)
    B.box(pal['stone'], 0.9, h, 0.8, 0, 0.14, -0.05)
    B.box(pal['roof'], 0.92, 0.07, 0.82, 0, 0.14 + h * 0.55, -0.05)
    arch(B, pal, 0.26, 0.42, 0, 0.36, y=0.14)
    G.box(pal['warm'], 0.12, 0.14, 0.03, 0.22, 0.14 + h * 0.45, 0.36)
    domed(B, G, pal, 0, -0.05, 0.34 if t < 3 else 0.38, 0.14 + h, onion=t >= 3, drum=0.08)
    if t >= 2:
        _windcatcher(B, pal, 0.62, -0.32, 0.14 + h * 0.72, h=0.5 if t == 2 else 0.7)
    if t >= 3:
        _windcatcher(B, pal, -0.62, -0.28, 0.14 + h * 0.55, h=0.48)
        eu.banner(B, pal, -0.7, 0.45, 0.14, 1.2, big=0.7)
        G.prism(pal['glow'], 8, 0.48, 0.48, 0.04, 0, 0.14 + h * 0.72, -0.05, phase=math.pi / 8)
    _lateen_rotor(k, pal, 0.14 + h * 0.62, 0.5, {1: 0.78, 2: 0.95, 3: 1.08}[t])


def workshop(k, t, pal):
    """Iwan smithy. The forge sits in the pointed arch; the windcatcher is
    the flue. Tier 3 caps the hall with an onion dome and a second catcher."""
    B, G = k.B, k.G
    B.box(pal['stone3'], 1.8, 0.1, 1.65, 0, 0, 0)
    if t == 1:
        _cube(B, G, pal, 1.15, 0.8, 0.7, -0.05, -0.1, y=0.1)
        arch(B, pal, 0.46, 0.55, -0.05, 0.31, y=0.1)
        G.box(0xff7a3c, 0.28, 0.16, 0.04, -0.05, 0.22, 0.34)
        _windcatcher(B, pal, 0.4, -0.35, 0.86, h=0.45)
        _awning(B, pal, 0.55, -0.05, 0.72, 0.28)
        B.box(pal['dark'], 0.22, 0.14, 0.14, 0.45, 0.1, 0.45)
        B.box(pal['trim'], 0.28, 0.05, 0.12, 0.45, 0.24, 0.45)
        return
    h = 0.85 if t == 2 else 0.95
    _cube(B, G, pal, 1.35, 0.9, h, 0, -0.15, y=0.1)
    arch(B, pal, 0.55, 0.7 if t == 3 else 0.6, 0, 0.31, y=0.1)
    G.box(0xff7a3c, 0.32, 0.2, 0.04, 0, 0.28, 0.34)
    if t == 2:
        domed(B, G, pal, 0, -0.15, 0.32, 0.1 + h, drum=0.06)
    else:
        domed(B, G, pal, 0, -0.15, 0.4, 0.1 + h, onion=True, drum=0.1)
        G.prism(pal['glow'], 8, 0.55, 0.55, 0.04, 0, 0.1 + h - 0.02, -0.15, phase=math.pi / 8)
    _windcatcher(B, pal, 0.62, -0.45, 0.1 + h * 0.55, h=0.55 if t == 2 else 0.75)
    if t >= 3:
        _windcatcher(B, pal, -0.62, -0.42, 0.1 + h * 0.4, h=0.5)
    B.box(pal['dark'], 0.24, 0.16, 0.16, 0.55, 0.1, 0.5)
    B.box(pal['trim'], 0.3, 0.05, 0.12, 0.55, 0.26, 0.5)
    # hoist
    B.prism(pal['wood'], 6, 0.04, 0.035, 1.05, -0.7, 0.1, 0.5)
    B.box(pal['wood'], 0.55, 0.05, 0.05, -0.42, 1.1, 0.5)
    B.box(pal['trim'], 0.08, 0.18, 0.06, -0.18, 0.92, 0.5)
    if t >= 3:
        eu.banner(B, pal, 0.8, 0.5, 0.1, 1.3, flip=True)
        B.prism(pal['trim'], 8, 0.1, 0.1, 0.04, 0.15, 1.35, 0.35, rx=math.pi / 2)
        G.prism(pal['glow'], 8, 0.05, 0.05, 0.03, 0.15, 1.35, 0.38, rx=math.pi / 2)


# Mines, hero forges and outposts stay shared European builders, recoloured.
mine, hero_forge, outpost = eu.mine, eu.hero_forge, eu.outpost
hero, enemy, tree_round, tree_pine, rock, cliff = eu.hero, eu.enemy, eu.tree_round, eu.tree_pine, eu.rock, eu.cliff
