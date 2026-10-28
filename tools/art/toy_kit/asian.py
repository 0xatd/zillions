"""Asian culture — the Jade Lantern Dynasty.

An original sci-fi take on East Asian fortress architecture: white plaster
on dark stone footings, jade-tiled hipped roofs with upturned gold eave
horns, red-lacquer pillars, paper lanterns with warm energy cores. The keep
grows from a single hall into a five-storey pagoda with a floating jade orb.
Its army: glaive guards in wide hat-helms, repeater archers, fire-lances.

Every builder takes (kit, tier, pal) and authors in game space (metres =
tiles, +z = front, origin at ground centre), same conventions as european.py.
"""
import math

from kit import shade
from common import hip_roof, frustum, lantern, fig_legs, fig_head, arm
import european as eu

PALETTE = dict(eu.PALETTE,
               stone=0xf3ece0, stone2=0xd9c9b2, stone3=0x5f5a66, roof=0x2f9a80, roof2=0x237463,
               trim=0xe8bb48, banner=0xc8463a, accent=0xc8463a, wood=0xa8392e, steel=0xa7b0bc,
               dark=0x2c2830, glow=0xffb45e, warm=0xffcf7a, cloth=0xc8463a, skin=0xf0c8a0)

TAU = math.tau


def _pillars(B, pal, w, h, z, y=0.0, n=4):
    for i in range(n):
        x = -w / 2 + i * w / (n - 1)
        B.prism(pal['wood'], 6, 0.06, 0.06, h, x, y, z)
        B.box(pal['trim'], 0.12, 0.04, 0.12, x, y + h - 0.04, z)


def _storey(B, G, pal, w, d, h, y, roof_top, roof_h=0.42, windows=True, pillars=True):
    """One pagoda storey: plaster body, red band, lit windows, a jade
    hipped roof with upturned gold horns. Returns the next floor level."""
    B.box(pal['stone'], w, h, d, 0, y, 0)
    B.box(pal['wood'], w + 0.04, 0.07, d + 0.04, 0, y + h - 0.12, 0)
    if pillars:
        for sx in (-1, 1):
            for sz in (-1, 1):
                B.box(pal['wood'], 0.08, h, 0.08, sx * (w / 2), y, sz * (d / 2))
    if windows:
        for x in ((-w * 0.25, w * 0.25) if w > 0.9 else (0.0,)):
            G.box(pal['warm'], 0.14, 0.18, 0.03, x, y + h * 0.35, d / 2 + 0.01)
            B.box(pal['wood'], 0.2, 0.03, 0.04, x, y + h * 0.35 + 0.08, d / 2 + 0.02)
    hip_roof(B, pal['roof'], w, d, y + h, roof_h, top=roof_top, tip=pal['trim'], flare=0.2)
    B.box(shade(pal['roof'], 0.72), w + 0.44, 0.05, d + 0.44, 0, y + h - 0.02, 0)   # eave board
    return y + h + roof_h


def pagoda(B, G, pal, y, w0, tiers, h0=0.7, shrink=0.15, spire=True):
    w = w0
    for i in range(tiers):
        last = i == tiers - 1
        nxt = w * (1 - shrink)
        y = _storey(B, G, pal, w, w, h0 if i == 0 else h0 * 0.78, y, 0.0 if last else nxt * 0.9,
                    roof_h=0.5 if last else 0.3, windows=True)
        w = nxt
    if spire:
        B.prism(pal['trim'], 8, 0.06, 0.04, 0.5, 0, y - 0.05, 0)
        for i in range(3):
            B.prism(pal['trim'], 8, 0.11 - i * 0.025, 0.11 - i * 0.025, 0.04, 0, y + 0.08 + i * 0.12, 0)
    return y


def _compound_wall(B, G, pal, x0, z0, x1, z1, h, thick):
    length = math.hypot(x1 - x0, z1 - z0)
    yaw = math.atan2(x1 - x0, z1 - z0)
    mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
    B.box(pal['stone3'], thick + 0.08, 0.2, length, mx, 0, mz, 0, yaw, 0)
    B.box(pal['stone'], thick, h - 0.2, length, mx, 0.2, mz, 0, yaw, 0)
    B.box(pal['wood'], thick + 0.02, 0.06, length, mx, h - 0.16, mz, 0, yaw, 0)
    # jade tile coping: a ridge cap with a gold line
    B.box(pal['roof'], thick + 0.22, 0.08, length + 0.04, mx, h, mz, 0, yaw, 0)
    B.box(pal['roof2'], thick * 0.5, 0.08, length + 0.04, mx, h + 0.08, mz, 0, yaw, 0)
    B.box(pal['trim'], 0.05, 0.03, length, mx, h + 0.16, mz, 0, yaw, 0)


def _pavilion(B, G, pal, x, z, w, h, roofs=1):
    B.box(pal['stone3'], w + 0.12, 0.18, w + 0.12, x, 0, z)
    B.box(pal['stone'], w, h, w, x, 0.18, z)
    B.box(pal['wood'], w + 0.03, 0.07, w + 0.03, x, 0.18 + h - 0.14, z)
    y = 0.18 + h
    for i in range(roofs):
        ww = w * (1 - 0.18 * i)
        last = i == roofs - 1
        hip_roof(B, pal['roof'], ww, ww, y, 0.34 if last else 0.22, top=0 if last else ww * 0.72, tip=pal['trim'],
                 flare=0.14, x=x, z=z)
        if not last:
            B.box(pal['stone'], ww * 0.72, 0.28, ww * 0.72, x, y + 0.22, z)
            y += 0.5
    G.box(pal['warm'], 0.12, 0.16, 0.03, x, 0.18 + h * 0.55, z + w / 2 + 0.01)
    return y + 0.34


def castle(k, t, pal):
    B, G = k.B, k.G
    frustum(B, pal['stone3'], 4.2, 4.2, 3.9, 3.9, 0.18)
    frustum(B, shade(pal['stone3'], 1.15), 3.4, 3.4, 3.2, 3.2, 0.14, y=0.18)
    base = 0.32
    if t == 1:
        # A single audience hall: red pillar porch, jade roof, two lanterns.
        B.box(pal['stone'], 1.8, 1.05, 1.3, 0, base, -0.1)
        _pillars(B, pal, 1.9, 1.05, 0.66, base, n=4)
        B.box(pal['wood'], 1.96, 0.1, 0.12, 0, base + 0.95, 0.66)
        hip_roof(B, pal['roof'], 1.9, 1.5, base + 1.05, 0.7, tip=pal['trim'], flare=0.24)
        B.box(pal['trim'], 1.2, 0.06, 0.06, 0, base + 1.72, 0)                 # ridge
        B.box(pal['wood'], 0.46, 0.66, 0.05, 0, base, 0.56)                    # red doors
        B.box(pal['trim'], 0.04, 0.6, 0.06, 0, base + 0.02, 0.58)
        for sx in (-1, 1):
            lantern(B, G, pal, sx * 0.62, base + 0.62, 0.68)
        eu.banner(B, pal, 1.35, 0.95, base, 1.6, flip=True)
        return
    half = 1.5 if t == 2 else 1.65
    wh = 0.85 if t == 2 else 1.1
    corners = [(-half, -half), (half, -half), (half, half), (-half, half)]
    for i in range(4):
        x0, z0 = corners[i]
        x1, z1 = corners[(i + 1) % 4]
        if i == 2:
            _compound_wall(B, G, pal, x0, z0, 0.55, z1, wh, 0.3)
            _compound_wall(B, G, pal, -0.55, z0, x1, z1, wh, 0.3)
        else:
            _compound_wall(B, G, pal, x0, z0, x1, z1, wh, 0.3)
    for (x, z) in corners:
        _pavilion(B, G, pal, x, z, 0.62 if t == 2 else 0.7, 1.2 if t == 2 else 1.5, roofs=1 if t == 2 else 2)
    # the front gate: a red-pillared gate pavilion with a double jade eave
    for sx in (-0.5, 0.5):
        B.prism(pal['wood'], 6, 0.08, 0.08, wh + 0.5, sx, 0, half)
    B.box(pal['wood'], 1.24, 0.12, 0.16, 0, wh + 0.3, half)
    hip_roof(B, pal['roof'], 1.2, 0.5, wh + 0.5, 0.18, top=0.9, tip=pal['trim'], flare=0.12, z=half)
    hip_roof(B, pal['roof'], 0.9, 0.36, wh + 0.68, 0.24, tip=pal['trim'], flare=0.1, z=half)
    B.box(pal['trim'], 0.34, 0.16, 0.04, 0, wh + 0.12, half + 0.09)            # name board
    for sx in (-1, 1):
        lantern(B, G, pal, sx * 0.5, wh + 0.02, half + 0.12)
    # the keep: a pagoda rising from a stone podium
    frustum(B, pal['stone3'], 2.2, 2.2, 2.0, 2.0, 0.22, y=base)
    tiers = {2: 2, 3: 3, 4: 5}[t]
    top = pagoda(B, G, pal, base + 0.22, 1.7 if t < 4 else 1.8, tiers, h0=0.8 if t == 2 else 0.85,
                 shrink=0.16 if t < 4 else 0.13)
    B.box(pal['wood'], 0.44, 0.66, 0.05, 0, base + 0.22, 0.86)
    eu.banner(B, pal, 0, 1.0, base + 0.22, 1.5, big=1.2)
    if t >= 3:
        for (x, z) in corners[:2]:
            eu.banner(B, pal, x, z + 0.4, 0.18 + 1.5 + 0.6, 0.8, big=0.6)
        for (x, z) in corners:
            lantern(B, G, pal, x * 0.72, wh + 0.06, z * 0.72 if z < 0 else half - 0.18)
    if t >= 4:
        core = k.part('part_core', origin=(0, top + 0.95, 0))
        core.ico(pal['roof'], 0.2, 0, top + 0.95 - 0.2, 0, sub=1)
        G.prism(pal['glow'], 8, 0.14, 0.14, 0.03, 0, top + 0.55, 0)
        for i in range(4):
            a = i / 4 * TAU + 0.4
            core.box(pal['trim'], 0.05, 0.05, 0.22, math.cos(a) * 0.3, top + 0.93, math.sin(a) * 0.3, 0, -a, 0)


def tower(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        B.box(pal['stone3'], 1.15, 0.16, 1.15, 0, 0, 0)
        for sx in (-0.4, 0.4):
            for sz in (-0.4, 0.4):
                B.prism(pal['wood'], 6, 0.06, 0.06, 1.25, sx, 0.16, sz)
        B.box(shade(pal['wood'], 0.8), 1.0, 0.1, 1.0, 0, 1.0, 0)
        top = 1.1
        s = 0.8
        h_canopy = top + 0.62
    else:
        h = {2: 1.6, 3: 2.3, 4: 2.9}[t]
        w = {2: 1.0, 3: 1.1, 4: 1.16}[t]
        frustum(B, pal['stone3'], w + 0.3, w + 0.3, w + 0.1, w + 0.1, 0.5)
        B.box(pal['stone'], w, h - 0.5, w, 0, 0.5, 0)
        B.box(pal['wood'], w + 0.04, 0.08, w + 0.04, 0, h - 0.18, 0)
        if t >= 3:
            hip_roof(B, pal['roof'], w, w, h * 0.55, 0.16, top=w * 0.9, tip=pal['trim'], flare=0.16)  # mid eave
        for sx in (-1, 1):
            G.box(pal['warm'], 0.12, 0.16, 0.03, sx * w * 0.22, h * 0.36, w / 2 + 0.01)
        B.box(pal['wood'], w + 0.2, 0.08, w + 0.2, 0, h, 0)                    # balcony floor
        for sx in (-1, 1):
            B.box(pal['wood'], w + 0.2, 0.12, 0.04, 0, h + 0.08, sx * (w / 2 + 0.08))
            B.box(pal['wood'], 0.04, 0.12, w + 0.2, sx * (w / 2 + 0.08), h + 0.08, 0)
        top = h + 0.08
        s = {2: 0.95, 3: 1.1, 4: 1.2}[t]
        h_canopy = top + 0.62 * s + 0.1
        for sx in (-1, 1):
            for sz in (-1, 1):
                B.box(pal['wood'], 0.06, h_canopy - top, 0.06, sx * (w / 2 + 0.04), top, sz * (w / 2 + 0.04))
        if t >= 3:
            lantern(B, G, pal, w / 2 + 0.14, h - 0.32, w / 2 + 0.14)
            lantern(B, G, pal, -w / 2 - 0.14, h - 0.32, w / 2 + 0.14)
        if t >= 4:
            G.box(pal['glow'], w + 0.02, 0.05, w + 0.02, 0, h * 0.82, 0)
    cw = 1.0 if t == 1 else {2: 1.0, 3: 1.1, 4: 1.16}[t]
    hip_roof(B, pal['roof'], cw, cw, h_canopy, 0.42, tip=pal['trim'], flare=0.2)
    B.prism(pal['trim'], 4, 0.05, 0, 0.3, 0, h_canopy + 0.4, 0)
    if t == 1:
        eu.banner(B, pal, -0.55, 0.55, 0, 1.6)
    head = k.part('part_turret', origin=(0, top, 0))
    eu.turret_head(head, pal, s, twin=t >= 3, coil=t >= 4, oy=top)


def house(k, t, pal):
    B, G = k.B, k.G
    B.box(pal['stone3'], 1.6, 0.1, 1.5, 0, 0, 0)
    if t == 1:
        B.box(pal['stone'], 1.05, 0.62, 0.85, 0, 0.1, 0)
        _pillars(B, pal, 1.05, 0.62, 0.43, 0.1, n=3)
        hip_roof(B, pal['roof'], 1.05, 0.85, 0.72, 0.44, tip=pal['trim'], flare=0.16)
        B.box(pal['trim'], 0.5, 0.05, 0.05, 0, 1.12, 0)
        B.prism(pal['dark'], 8, 0.16, 0.16, 0.04, 0.22, 0.32, 0.43, rx=math.pi / 2)  # moon door
        B.prism(pal['wood'], 8, 0.2, 0.2, 0.03, 0.22, 0.32, 0.425, rx=math.pi / 2)
        G.box(pal['warm'], 0.16, 0.14, 0.03, -0.25, 0.4, 0.44)
        lantern(B, G, pal, 0.48, 0.5, 0.52)
        B.box(0x7aa35a, 0.3, 0.12, 0.3, -0.55, 0.1, 0.52)                        # bamboo pot
        for i in range(3):
            B.prism(0x86b85a, 5, 0.025, 0.02, 0.5 + i * 0.1, -0.6 + i * 0.05, 0.22, 0.5 + (i % 2) * 0.05)
        return
    if t == 2:
        y = _storey(B, G, pal, 1.15, 0.95, 0.62, 0.1, 0.9, roof_h=0.2)
        B.box(pal['wood'], 1.2, 0.05, 0.12, 0, y - 0.02, 0.52)                  # balcony rail
        _storey(B, G, pal, 0.9, 0.75, 0.5, y, 0.0, roof_h=0.42, windows=True)
        B.box(pal['wood'], 0.26, 0.42, 0.04, 0, 0.1, 0.48)
        lantern(B, G, pal, 0.48, 0.48, 0.6)
        lantern(B, G, pal, -0.48, 0.48, 0.6)
        return
    if t == 3:
        # courtyard house: a long hall at the back, a side wing, a gate
        B.box(pal['stone'], 1.3, 0.75, 0.6, 0, 0.1, -0.4)
        hip_roof(B, pal['roof'], 1.3, 0.6, 0.85, 0.42, tip=pal['trim'], flare=0.16, z=-0.4)
        B.box(pal['stone'], 0.5, 0.6, 0.6, 0.45, 0.1, 0.3)
        hip_roof(B, pal['roof2'], 0.5, 0.6, 0.7, 0.32, tip=pal['trim'], flare=0.12, x=0.45, z=0.3)
        _pillars(B, pal, 1.3, 0.75, -0.08, 0.1, n=4)
        for x in (-0.3, 0.3):
            G.box(pal['warm'], 0.14, 0.18, 0.03, x, 0.42, -0.09)
        B.box(pal['stone'], 0.7, 0.42, 0.12, -0.35, 0.1, 0.62)                  # court wall
        B.box(pal['roof'], 0.8, 0.07, 0.22, -0.35, 0.52, 0.62)
        lantern(B, G, pal, -0.75, 0.62, 0.66)
        B.prism(0xd16d8a, 6, 0.18, 0.0, 0.42, -0.3, 0.22, 0.2)                  # blossom tree
        B.prism(pal['wood'], 5, 0.03, 0.03, 0.2, -0.3, 0.1, 0.2)
        return
    # t4: a tall three-storey tower-house with balconies
    y = _storey(B, G, pal, 1.2, 1.05, 0.7, 0.1, 1.0, roof_h=0.2)
    y = _storey(B, G, pal, 1.0, 0.9, 0.55, y, 0.82, roof_h=0.18)
    _storey(B, G, pal, 0.82, 0.74, 0.5, y, 0.0, roof_h=0.46)
    B.box(pal['wood'], 0.26, 0.45, 0.04, 0, 0.1, 0.53)
    for sx in (-1, 1):
        lantern(B, G, pal, sx * 0.52, 0.55, 0.62)
    eu.banner(B, pal, 0.72, 0.4, 0.1, 1.6, big=0.7)


# ---------------------------------------------------------------- ramparts

JIT = [0.0, 0.035, -0.02, 0.05, -0.04, 0.02, -0.01, 0.045]


def wall_seg(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        # bamboo palisade on an earth bank, bound with red cord
        B.box(pal['stone3'], 1.02, 0.08, 0.36, 0.5, 0, 0)
        for i in range(6):
            x = (i + 0.5) / 6
            h = 0.85 + JIT[i % 8] * 2
            B.prism(0x9cbf5c if i % 2 else 0x86aa4c, 6, 0.06, 0.055, h, x, 0.08, 0)
            B.box(0x6d8f3c, 0.13, 0.03, 0.13, x, 0.08 + h * 0.6, 0)
        for y in (0.35, 0.62):
            B.box(pal['wood'], 1.0, 0.05, 0.05, 0.5, y, -0.08)
        return
    h, thick = (1.05, 0.42) if t == 2 else (1.38, 0.52)
    B.box(pal['stone3'], 1.02, 0.36 if t == 2 else 0.6, thick + 0.14, 0.5, 0, 0)  # dark stone footing
    B.box(pal['stone'], 1.0, h - 0.1, thick, 0.5, 0.1, 0)
    B.box(pal['wood'], 1.02, 0.06, thick + 0.02, 0.5, h - 0.24, 0)              # red timber band
    # tile coping: jade eave on both faces, a ridge and a gold line
    B.box(pal['roof'], 1.04, 0.08, thick + 0.3, 0.5, h, 0)
    B.box(pal['roof2'], 1.04, 0.1, thick * 0.55, 0.5, h + 0.08, 0)
    B.box(pal['trim'], 1.04, 0.03, 0.05, 0.5, h + 0.18, 0)
    if t >= 3:
        G.box(pal['glow'], 1.0, 0.05, 0.02, 0.5, 0.7, thick / 2 + 0.01)
        G.box(pal['glow'], 1.0, 0.05, 0.02, 0.5, 0.7, -thick / 2 - 0.01)


def wall_post(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        B.prism(pal['stone3'], 6, 0.26, 0.26, 0.1, 0, 0, 0)
        B.prism(0x86aa4c, 6, 0.12, 0.11, 1.2, 0, 0.1, 0)
        hip_roof(B, pal['roof'], 0.3, 0.3, 1.3, 0.22, tip=pal['trim'], flare=0.06)
        return
    if t == 2:
        w, h = 0.7, 1.4
        B.box(pal['stone3'], w + 0.12, 0.42, w + 0.12, 0, 0, 0)
        B.box(pal['stone'], w, h - 0.42, w, 0, 0.42, 0)
        B.box(pal['wood'], w + 0.03, 0.06, w + 0.03, 0, h - 0.16, 0)
        hip_roof(B, pal['roof'], w, w, h, 0.36, tip=pal['trim'], flare=0.14)
        G.box(pal['warm'], 0.1, 0.14, 0.03, 0, h * 0.62, w / 2 + 0.01)
        return
    _pavilion(B, G, pal, 0, 0, 0.78, 1.55, roofs=2)
    lantern(B, G, pal, 0, 1.2, 0.5)


def gatehouse(k, t, pal):
    B, G = k.B, k.G
    tx = 1.3
    if t == 1:
        for s in (-1, 1):
            x = s * tx
            B.box(pal['stone3'], 0.7, 0.1, 0.7, x, 0, 0)
            for (dx, dz) in ((-0.22, -0.22), (0.22, -0.22), (0.22, 0.22), (-0.22, 0.22)):
                B.prism(0x86aa4c, 6, 0.06, 0.055, 1.45, x + dx, 0.1, dz)
            B.box(shade(pal['wood'], 1.05), 0.7, 0.08, 0.7, x, 1.25, 0)
            hip_roof(B, pal['roof'], 0.6, 0.6, 1.55, 0.32, tip=pal['trim'], flare=0.1, x=x)
            for sz in (-1, 1):
                B.box(pal['wood'], 0.04, 0.3, 0.04, x - 0.26, 1.25, sz * 0.26)
                B.box(pal['wood'], 0.04, 0.3, 0.04, x + 0.26, 1.25, sz * 0.26)
        # the gate frame: two red posts, a double beam with a jade cap
        for sx in (-0.85, 0.85):
            B.prism(pal['wood'], 6, 0.08, 0.08, 1.7, sx, 0, 0.2)
        B.box(pal['wood'], 2.1, 0.12, 0.14, 0, 1.38, 0.2)
        B.box(pal['wood'], 1.9, 0.08, 0.1, 0, 1.1, 0.2)
        hip_roof(B, pal['roof'], 2.0, 0.24, 1.5, 0.16, tip=pal['trim'], flare=0.1, z=0.2)
        B.box(pal['trim'], 0.3, 0.14, 0.04, 0, 1.18, 0.27)
        B.box(pal['field'], 1.7, 0.03, 1.2, 0, 0, 0)
        return
    w = 0.95 if t == 2 else 1.05
    h = 1.9 if t == 2 else 2.35
    for s in (-1, 1):
        x = s * tx
        frustum(B, pal['stone3'], w + 0.2, w + 0.2, w + 0.04, w + 0.04, 0.8, x=x)
        B.box(pal['stone'], w, h - 0.8, w, x, 0.8, 0)
        B.box(pal['wood'], w + 0.03, 0.07, w + 0.03, x, h - 0.16, 0)
        hip_roof(B, pal['roof'], w, w, h, 0.44, tip=pal['trim'], flare=0.18, x=x)
        G.box(pal['warm'], 0.12, 0.2, 0.03, x, h * 0.6, w / 2 + 0.01)
        if t >= 3:
            lantern(B, G, pal, x - s * (w / 2 + 0.1), h * 0.62, w / 2 + 0.1)
    # gate hall bridging the passage: dark stone arch block, plaster hall,
    # double jade eaves, a gold name board and red doors swung open
    span = 2 * tx - w + 0.05
    B.box(pal['stone3'], span, 0.36, 0.86, 0, 1.25, 0)
    B.box(pal['stone'], span - 0.2, 0.5, 0.7, 0, 1.61, 0)
    _pillars(B, pal, span - 0.22, 0.5, 0.36, 1.61, n=4)
    hip_roof(B, pal['roof'], span, 0.9, 2.11, 0.2, top=span * 0.7, tip=pal['trim'], flare=0.16)
    B.box(pal['stone'], span * 0.6, 0.3, 0.55, 0, 2.31, 0)
    hip_roof(B, pal['roof'], span * 0.66, 0.6, 2.61, 0.4, tip=pal['trim'], flare=0.16)
    B.box(pal['trim'], 0.46, 0.2, 0.04, 0, 1.3, 0.45)
    B.box(pal['banner'], 0.36, 0.12, 0.045, 0, 1.34, 0.46)
    for s in (-1, 1):
        B.box(pal['wood'], 0.62, 1.15, 0.07, s * 0.66, 0.05, -0.42, 0, s * 1.15, 0)
    B.box(pal['stone2'], 1.7, 0.03, 1.2, 0, 0, 0)
    if t >= 3:
        G.box(pal['glow'], 1.2, 0.03, 0.25, 0, 0.035, 0.45)
        for s in (-1, 1):
            lantern(B, G, pal, s * 0.5, 1.02, 0.5)


# ---------------------------------------------------------------- barracks

def camp(k, t, pal, trade='militia'):
    B, G = k.B, k.G
    col = eu.CAMP_COLORS[trade]
    B.box(pal['stone3'], 1.9, 0.1, 1.9, 0, 0, 0)
    hw = 1.1 if t == 1 else 1.35
    hh = 0.62 if t == 1 else 0.8
    B.box(pal['stone'], hw, hh, 0.75, 0, 0.1, -0.45)
    _pillars(B, pal, hw, hh, -0.07, 0.1, n=4)
    hip_roof(B, pal['roof'], hw, 0.75, 0.1 + hh, 0.4, tip=pal['trim'], flare=0.16, z=-0.45)
    B.box(col, hw * 0.6, 0.06, 0.06, 0, 0.1 + hh + 0.36, -0.45)               # trade-colour ridge
    B.box(pal['wood'], 0.26, 0.42, 0.04, 0, 0.1, -0.06)
    B.box(col, 0.3, 0.16, 0.04, 0, 0.1 + hh - 0.22, -0.05)                      # trade plaque
    eu.banner(B, pal, -0.8, -0.1, 0.1, 1.3, color=col)
    # training yard: a weapon rack and a straw target
    B.box(pal['wood'], 0.5, 0.06, 0.08, -0.45, 0.4, 0.55)
    for x in (-0.65, -0.25):
        B.box(pal['wood'], 0.06, 0.4, 0.06, x, 0.1, 0.55)
    B.prism(0xe2c27a, 8, 0.18, 0.18, 0.08, 0.45, 0.42, 0.6, rx=math.pi / 2)
    B.prism(col, 8, 0.09, 0.09, 0.09, 0.45, 0.42, 0.61, rx=math.pi / 2)
    B.box(pal['wood'], 0.05, 0.42, 0.05, 0.45, 0.1, 0.56)
    if t >= 2:
        lantern(B, G, pal, hw / 2 + 0.05, 0.6, 0.0)
        lantern(B, G, pal, -hw / 2 - 0.05, 0.6, 0.0)
        eu.banner(B, pal, 0.8, -0.1, 0.1, 1.3, color=col, flip=True)
    if t >= 3:
        _pavilion(B, G, pal, 0.75, -0.75, 0.42, 1.0, roofs=2)
        G.box(pal['glow'], hw, 0.05, 0.05, 0, 0.6, -0.06)


# ---------------------------------------------------------------- the army

def trooper(k, pal):
    """Glaive Guard: red lamellar coat, a wide jade hat-helm, a long glaive."""
    B, G = k.B, k.G
    red, jade, gold = pal['cloth'], pal['roof'], pal['trim']
    fig_legs(k, 0x3a3440, pal['dark'])
    B.box(red, 0.36, 0.34, 0.24, 0, 0.34, 0)
    for i in range(3):
        B.box(shade(red, 0.82 if i % 2 else 1.0), 0.38, 0.05, 0.26, 0, 0.4 + i * 0.09, 0)   # lamellar rows
    B.box(gold, 0.39, 0.05, 0.27, 0, 0.36, 0)
    B.box(0x3a3440, 0.4, 0.22, 0.16, 0, 0.18, -0.06)                            # skirt
    top, fz = fig_head(B, pal['skin'], 0.66)
    B.prism(jade, 8, 0.3, 0.0, 0.18, 0, top - 0.04, 0)                          # wide hat-helm
    B.prism(gold, 8, 0.31, 0.31, 0.025, 0, top - 0.055, 0)
    B.prism(gold, 4, 0.03, 0, 0.1, 0, top + 0.12, 0)
    G.box(pal['glow'], 0.14, 0.025, 0.02, 0, top - 0.11, fz + 0.005)
    A = arm(k, 'arm_l', -1, red)
    A.box(pal['skin'], 0.08, 0.08, 0.08, -0.25, 0.32, 0.03)
    R = arm(k, 'arm_r', 1, red)
    R.box(pal['wood'], 0.04, 1.15, 0.04, 0.26, 0.05, 0.12)                       # glaive haft
    R.box(0xdfe4ea, 0.03, 0.26, 0.12, 0.26, 1.18, 0.16, -0.3, 0, 0)             # curved blade
    G.box(pal['glow'], 0.02, 0.18, 0.03, 0.26, 1.2, 0.22)
    R.box(red, 0.06, 0.06, 0.06, 0.26, 1.14, 0.12)                               # tassel


def ranger(k, pal):
    """Repeater Archer: jade jacket, red headband, a magazine crossbow."""
    B, G = k.B, k.G
    jade, red = pal['roof'], pal['cloth']
    fig_legs(k, 0x5a4a3a, pal['dark'])
    B.box(jade, 0.36, 0.34, 0.24, 0, 0.34, 0)
    B.box(shade(jade, 0.8), 0.06, 0.34, 0.25, 0.08, 0.34, 0.0)                  # wrap fold
    B.box(pal['trim'], 0.37, 0.04, 0.25, 0, 0.42, 0)
    top, fz = fig_head(B, pal['skin'], 0.66)
    B.prism(0x23202a, 8, 0.135, 0.1, 0.08, 0, top - 0.05, 0, phase=math.pi / 8)  # hair
    B.box(0x23202a, 0.08, 0.08, 0.08, 0, top + 0.01, -0.06)                      # topknot
    B.box(red, 0.27, 0.035, 0.27, 0, top - 0.09, 0)                              # headband
    B.box(red, 0.04, 0.03, 0.18, 0.06, top - 0.1, -0.2, 0.3, 0, 0)
    A = arm(k, 'arm_l', -1, jade, sh=0.22)
    A.box(pal['wood'], 0.08, 0.08, 0.42, -0.24, 0.36, 0.2)                      # crossbow stock
    A.box(pal['dark'], 0.44, 0.04, 0.05, -0.24, 0.42, 0.36)                     # bow arms
    A.box(pal['wood'], 0.1, 0.14, 0.14, -0.24, 0.44, 0.18)                      # magazine
    G.box(pal['glow'], 0.04, 0.04, 0.12, -0.24, 0.46, 0.4)
    arm(k, 'arm_r', 1, jade, sh=0.22)
    B.box(pal['wood'], 0.1, 0.3, 0.1, 0.12, 0.42, -0.17)                        # bolt case


def marksman(k, pal):
    """Fire-Lance: dark armour, a gold war-mask, a shoulder rocket tube."""
    B, G = k.B, k.G
    dark, gold, red = 0x3a3440, pal['trim'], pal['cloth']
    fig_legs(k, dark, pal['dark'])
    B.box(dark, 0.36, 0.36, 0.24, 0, 0.34, 0)
    B.box(red, 0.38, 0.12, 0.26, 0, 0.5, 0)
    B.box(gold, 0.39, 0.04, 0.27, 0, 0.42, 0)
    top, fz = fig_head(B, pal['skin'], 0.66)
    B.box(gold, 0.2, 0.12, 0.03, 0, 0.72, fz + 0.005)                           # war mask
    G.box(0xff7a3c, 0.14, 0.025, 0.02, 0, 0.78, fz + 0.02)
    B.prism(dark, 8, 0.15, 0.06, 0.16, 0, top - 0.06, 0, phase=math.pi / 8)     # helm
    B.box(red, 0.04, 0.12, 0.1, 0, top + 0.08, -0.02)
    arm(k, 'arm_l', -1, dark, sh=0.22)
    R = arm(k, 'arm_r', 1, dark, sh=0.22)
    R.prism(red, 8, 0.075, 0.075, 0.82, 0.2, 0.74, -0.32, rx=math.pi / 2)      # rocket tube
    R.prism(gold, 8, 0.085, 0.085, 0.05, 0.2, 0.74, 0.46, rx=math.pi / 2)
    G.prism(0xff7a3c, 8, 0.05, 0.05, 0.03, 0.2, 0.74, 0.5, rx=math.pi / 2)


# Shared with the European kit (re-coloured by the palette): the economy
# buildings, outposts, heroes, the horde and the terrain props.
farm, mill, mine, workshop, hero_forge, outpost = eu.farm, eu.mill, eu.mine, eu.workshop, eu.hero_forge, eu.outpost
hero, enemy, tree_round, tree_pine, rock, cliff = eu.hero, eu.enemy, eu.tree_round, eu.tree_pine, eu.rock, eu.cliff
