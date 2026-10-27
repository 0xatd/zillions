"""European culture — the default kit.

A sci-fi knightly star-fortress: cream stone-and-steel walls, slate-blue
roofs, gold trim, blue-and-gold banners, cyan energy lamps. Allies wear the
same blue and gold so "your men" match "your castle" at a glance.

Original designs. Every builder takes (kit, tier, pal) and authors in game
space (metres = tiles, +z = front, origin at ground centre).
"""
import math

from kit import shade

PALETTE = {
    'stone': 0xeee5cf, 'stone2': 0xd8ccb1, 'stone3': 0xb5a68a, 'roof': 0x3f70c8,
    'roof2': 0x2f569e, 'trim': 0xf2c14e, 'banner': 0x3f70c8, 'accent': 0xc4473b,
    'wood': 0x9a6b44, 'steel': 0x9aa6b6, 'dark': 0x343c4c, 'glow': 0x8ff3ff,
    'warm': 0xffd27a, 'cloth': 0x3f70c8, 'skin': 0xf0c8a0, 'field': 0x8b6a45,
    'crop': 0xa7d45a, 'crop2': 0xe9cf5a, 'leaf': 0x6fbf5a,
}

TAU = math.tau


# ---------------------------------------------------------------- helpers

def merlons_rect(P, c, w, d, y, size=0.18, h=0.2, gap=1.9):
    """Crenellations around a w×d rectangle whose top is at y."""
    for sx, length, axis in ((1, w, 'x'), (1, d, 'z')):
        n = max(2, int(length / (size * gap)))
        for i in range(n):
            t = -length / 2 + (i + 0.5) * length / n
            if axis == 'x':
                P.box(c, size, h, size, t, y, d / 2 - size / 2)
                P.box(c, size, h, size, t, y, -d / 2 + size / 2)
            else:
                P.box(c, size, h, size, w / 2 - size / 2, y, t)
                P.box(c, size, h, size, -w / 2 + size / 2, y, t)


def merlons_ring(P, c, r, y, n=8, size=0.16, h=0.18, x=0, z=0):
    for i in range(n):
        a = (i + 0.5) / n * TAU
        P.box(c, size, h, size, x + math.cos(a) * r, y, z + math.sin(a) * r, 0, -a, 0)


def banner(B, pal, x, z, y=0, h=1.2, color=None, flip=False, big=1.0):
    color = color or pal['banner']
    B.box(pal['dark'], 0.05, h, 0.05, x, y, z)
    B.prism(pal['trim'], 4, 0.06, 0, 0.12, x, y + h, z)
    off = -0.2 if flip else 0.2
    B.box(color, 0.36 * big, 0.5 * big, 0.03, x + off * big, y + h - 0.55 * big, z)
    B.box(pal['trim'], 0.12 * big, 0.12 * big, 0.04, x + off * big, y + h - 0.33 * big, z)
    B.box(pal['trim'], 0.36 * big, 0.05, 0.035, x + off * big, y + h - 0.07, z)


def round_tower(B, G, pal, x, z, r, h, roof=True, crest=True, seg=8, window=True):
    B.prism(pal['stone3'], seg, r * 1.15, r * 1.05, 0.18, x, 0, z)
    B.prism(pal['stone'], seg, r, r * 0.95, h, x, 0.18, z)
    top = h + 0.18
    B.prism(pal['stone2'], seg, r * 1.14, r * 1.14, 0.12, x, top, z)
    if roof:
        B.prism(pal['roof'], seg, r * 1.22, 0, r * 2.1, x, top + 0.12, z)
        if crest:
            B.prism(pal['trim'], 4, 0.05, 0, 0.3, x, top + 0.12 + r * 2.1, z)
    else:
        merlons_ring(B, pal['stone'], r * 1.04, top + 0.12, n=seg, size=r * 0.32, h=r * 0.3, x=x, z=z)
    if window:
        G.box(pal['warm'], 0.1, 0.18, 0.04, x, top * 0.62, z + r * 0.97)
    return top


def keep_block(B, G, pal, w, d, h, y=0, x=0, z=0, roof='pyramid', windows=2):
    B.box(pal['stone'], w, h, d, x, y, z)
    B.box(pal['stone2'], w + 0.08, 0.1, d + 0.08, x, y + h, z)
    top = y + h + 0.1
    if roof == 'pyramid':
        B.prism(pal['roof'], 4, max(w, d) * 0.78, 0, max(w, d) * 0.62, x, top, z, phase=math.pi / 4)
    elif roof == 'merlon':
        merlons_rect(B, pal['stone'], w, d, top)
    for i in range(windows):
        t = (i + 0.5) / windows - 0.5
        G.box(pal['warm'], 0.12, 0.2, 0.04, x + t * w * 0.7, y + h * 0.6, z + d / 2 + 0.01)
    return top


def door(B, pal, w, h, x, z, y=0):
    B.box(pal['stone2'], w + 0.12, h + 0.08, 0.06, x, y, z)
    B.box(pal['accent'], w, h, 0.07, x, y, z + 0.01)
    B.box(pal['trim'], w * 0.18, 0.05, 0.08, x, y + h * 0.55, z + 0.01)


def curtain(B, pal, x0, z0, x1, z1, h, thick, merl=True):
    length = math.hypot(x1 - x0, z1 - z0)
    yaw = math.atan2(x1 - x0, z1 - z0)
    mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
    B.box(pal['stone'], thick, h, length, mx, 0, mz, 0, yaw, 0)
    B.box(pal['stone2'], thick + 0.06, 0.08, length, mx, h, mz, 0, yaw, 0)
    if merl:
        n = max(2, int(length / 0.36))
        for i in range(n):
            t = -length / 2 + (i + 0.5) * length / n
            B.box(pal['stone'], thick * 0.9, 0.16, 0.16,
                  mx + math.sin(yaw) * t, h + 0.08, mz + math.cos(yaw) * t, 0, yaw, 0)


def hex_plinth(B, G, pal, r, steps=2, lamps=True):
    y = 0
    for i in range(steps):
        rr = r - i * 0.22
        B.prism(pal['stone3'] if i == 0 else pal['stone2'], 6, rr, rr, 0.16, 0, y, 0, phase=math.pi / 6)
        y += 0.16
    if lamps:
        for i in range(6):
            a = math.pi / 6 + i / 6 * TAU
            G.box(pal['glow'], 0.12, 0.05, 0.12, math.cos(a) * (r - 0.12), 0.16, math.sin(a) * (r - 0.12))
    return y


def guard(B, pal, x, y, z, yaw=0.0, s=0.62):
    """Static wall guard: a tiny version of the trooper figurine."""
    c, sn = math.cos(yaw), math.sin(yaw)

    def at(dx, dz):
        return x + dx * c + dz * sn, z - dx * sn + dz * c
    px, pz = at(0, 0)
    B.box(pal['steel'], 0.3 * s, 0.34 * s, 0.22 * s, px, y + 0.28 * s, pz, 0, yaw, 0)
    B.box(pal['cloth'], 0.32 * s, 0.26 * s, 0.24 * s, px, y + 0.3 * s, pz, 0, yaw, 0)
    B.box(pal['steel'], 0.26 * s, 0.24 * s, 0.24 * s, px, y + 0.62 * s, pz, 0, yaw, 0)
    B.box(pal['trim'], 0.06 * s, 0.12 * s, 0.22 * s, px, y + 0.86 * s, pz, 0, yaw, 0)
    B.box(pal['steel'], 0.24 * s, 0.28 * s, 0.24 * s, px, y, pz, 0, yaw, 0)
    sx, sz = at(-0.2 * s, 0.1 * s)
    B.box(pal['banner'], 0.06 * s, 0.34 * s, 0.26 * s, sx, y + 0.2 * s, sz, 0, yaw, 0)
    wx, wz = at(0.2 * s, 0.05 * s)
    B.box(pal['dark'], 0.05 * s, 0.6 * s, 0.05 * s, wx, y + 0.25 * s, wz, 0, yaw, 0)


def turret_head(T, pal, s=1.0, twin=False, coil=False, oy=0.0, oz=0.0):
    """Tower gun head. Its Part origin is the pivot; barrels point +z."""
    T.prism(pal['steel'], 8, 0.34 * s, 0.3 * s, 0.14 * s, 0, oy, oz)
    T.box(pal['stone'], 0.46 * s, 0.32 * s, 0.5 * s, 0, oy + 0.14 * s, oz - 0.02 * s)
    T.box(pal['roof'], 0.5 * s, 0.08 * s, 0.54 * s, 0, oy + 0.46 * s, oz - 0.02 * s)
    for dx in ((-0.1, 0.1) if twin else (0.0,)):
        T.box(pal['dark'], 0.09 * s, 0.09 * s, 0.6 * s, dx * s, oy + 0.24 * s, oz + 0.4 * s)
        T.box(pal['trim'], 0.12 * s, 0.12 * s, 0.06 * s, dx * s, oy + 0.225 * s, oz + 0.68 * s)
    if coil:
        T.box(pal['glow'], 0.52 * s, 0.06 * s, 0.06 * s, 0, oy + 0.3 * s, oz + 0.24 * s)


# ---------------------------------------------------------------- castle

def castle(k, t, pal):
    B, G = k.B, k.G
    r = 2.0 + min(t, 3) * 0.1
    base = hex_plinth(B, G, pal, r, steps=2 if t < 3 else 3)
    if t == 1:
        top = keep_block(B, G, pal, 1.6, 1.5, 1.7, base, roof='pyramid')
        door(B, pal, 0.36, 0.55, 0, 0.76, base)
        banner(B, pal, -1.2, 0.9, base, 1.5)
        banner(B, pal, 1.2, 0.9, base, 1.5, flip=True)
        for x in (-1.4, 1.4):
            B.box(pal['wood'], 0.32, 0.26, 0.32, x, base, -0.9)
        return
    # T2+: curtain wall square with corner towers around the keep
    half = 1.45 if t == 2 else 1.6
    wall_h = 0.8 if t == 2 else 1.15 if t == 3 else 1.3
    thick = 0.26 if t == 2 else 0.4
    corners = [(-half, -half), (half, -half), (half, half), (-half, half)]
    for i in range(4):
        x0, z0 = corners[i]
        x1, z1 = corners[(i + 1) % 4]
        if i == 2:  # front wall gets the gatehouse gap
            curtain(B, pal, x0, z0, 0.42, z1, wall_h, thick)
            curtain(B, pal, -0.42, z0, x1, z1, wall_h, thick)
        else:
            curtain(B, pal, x0, z0, x1, z1, wall_h, thick)
    tower_h = 1.6 if t == 2 else 2.4 if t == 3 else 2.8
    tr = 0.38 if t == 2 else 0.46
    for (x, z) in corners:
        top = round_tower(B, G, pal, x, z, tr, tower_h)
        if t >= 3:
            banner(B, pal, x + (0.3 if x > 0 else -0.3), z, top - 0.2, 1.1, flip=x < 0)
    # gatehouse
    gh = wall_h + 0.5
    for sx in (-0.5, 0.5):
        B.box(pal['stone'], 0.32, gh, 0.5, sx, base * 0 + 0, half)
        B.box(pal['roof'], 0.4, 0.08, 0.56, sx, gh, half)
        B.prism(pal['roof'], 4, 0.3, 0, 0.36, sx, gh + 0.08, half, phase=math.pi / 4)
    B.box(pal['stone2'], 0.72, 0.22, 0.46, 0, gh - 0.22, half)
    G.box(pal['glow'] if t >= 3 else pal['warm'], 0.66, 0.04, 0.3, 0, 0.02, half)
    # the keep
    kw = 1.7 if t == 2 else 1.9
    kh = 2.2 if t == 2 else 2.7
    top = keep_block(B, G, pal, kw, kw, kh, base, roof='merlon', windows=3)
    door(B, pal, 0.4, 0.6, 0, kw / 2 + 0.01, base)
    upper_w = kw * 0.62
    uh = 0.9 if t == 2 else 1.4
    top2 = keep_block(B, G, pal, upper_w, upper_w, uh, top, roof='pyramid', windows=1)
    B.prism(pal['trim'], 4, 0.07, 0, 0.4, 0, top2 + upper_w * 0.62 * 0.98, 0)
    banner(B, pal, 0, -kw / 2 - 0.05, top, 1.3, color=pal['banner'], big=1.2)
    if t >= 3:
        # energy band and bigger banners: the keep is now a power plant
        for side in range(4):
            a = side * math.pi / 2
            G.box(pal['glow'], kw * 0.86 if side % 2 == 0 else 0.04, 0.07, 0.04 if side % 2 == 0 else kw * 0.86,
                  math.sin(a) * (kw / 2 + 0.02), base + kh * 0.35, math.cos(a) * (kw / 2 + 0.02))
        for (x, z, yaw) in ((-half * 0.5, half, 0.0), (half * 0.5, half, 0.0), (-half, 0, -math.pi / 2), (half, 0, math.pi / 2)):
            guard(B, pal, x, wall_h + 0.08, z, yaw)
        banner(B, pal, -0.9, half + 0.25, 0, 2.0, big=1.3)
        banner(B, pal, 0.9, half + 0.25, 0, 2.0, flip=True, big=1.3)
    if t >= 4:
        # citadel spire with a floating energy core
        B.prism(pal['stone'], 8, 0.32, 0.22, 2.0, 0, top2 + 0.2, 0)
        B.prism(pal['roof'], 8, 0.34, 0, 0.5, 0, top2 + 2.2, 0)
        core = k.part('part_core', origin=(0, top2 + 3.05, 0), glow=True)
        core.octa(pal['glow'], 0.26, 0.42, 0, top2 + 3.05, 0)
        for i in range(4):
            a = i / 4 * TAU + math.pi / 4
            G.box(pal['glow'], 0.06, 0.06, 0.06, math.cos(a) * 0.5, top2 + 2.9, math.sin(a) * 0.5)
        for (x, z, yaw) in ((-half, -half * 0.4, -math.pi / 2), (half, -half * 0.4, math.pi / 2),
                            (-half * 0.5, -half, math.pi), (half * 0.5, -half, math.pi)):
            guard(B, pal, x, wall_h + 0.08, z, yaw)


# ---------------------------------------------------------------- tower

def tower(k, t, pal):
    B, G = k.B, k.G
    if t == 1:
        B.box(pal['stone3'], 1.15, 0.16, 1.15, 0, 0, 0)
        B.box(pal['stone'], 0.9, 1.05, 0.9, 0, 0.16, 0)
        B.box(pal['wood'], 1.15, 0.1, 1.15, 0, 1.21, 0)
        for x in (-0.5, 0.5):
            for z in (-0.5, 0.5):
                B.box(pal['wood'], 0.08, 0.3, 0.08, x, 1.31, z)
        top = 1.31
        s = 0.8
        banner(B, pal, -0.55, 0.55, 0, 1.5)
    else:
        r = {2: 0.6, 3: 0.68, 4: 0.74}[t]
        h = {2: 1.9, 3: 2.8, 4: 3.6}[t]
        top = round_tower(B, G, pal, 0, 0, r, h, roof=False)
        top += 0.12
        s = {2: 0.95, 3: 1.1, 4: 1.2}[t]
        if t >= 3:
            B.prism(pal['trim'], 8, r * 1.02, r * 1.02, 0.08, 0, h * 0.55, 0)
            banner(B, pal, r + 0.08, 0, h * 0.35, 1.3, big=1.1)
            banner(B, pal, -r - 0.08, 0, h * 0.35, 1.3, flip=True, big=1.1)
        if t >= 4:
            for sx in (-1, 1):
                bx = sx * (r + 0.18)
                B.prism(pal['stone'], 6, 0.2, 0.2, 0.55, bx, h - 0.4, -0.15)
                B.prism(pal['roof'], 6, 0.26, 0, 0.5, bx, h + 0.15, -0.15)
            G.prism(pal['glow'], 8, r * 1.05, r * 1.05, 0.06, 0, h * 0.8, 0)
    head = k.part('part_turret', origin=(0, top, 0))
    turret_head(head, pal, s, twin=t >= 3, coil=t >= 4, oy=top)


# ---------------------------------------------------------------- houses

def house(k, t, pal):
    B, G = k.B, k.G
    B.box(pal['stone3'], 1.6, 0.1, 1.5, 0, 0, 0)
    if t == 1:
        B.box(pal['stone'], 1.0, 0.65, 0.85, 0, 0.1, 0)
        B.gable(pal['roof'], 1.0, 0.5, 0.85, 0, 0.75, 0, ry=math.pi / 2)
        door(B, pal, 0.2, 0.36, 0.2, 0.43, 0.1)
        G.box(pal['warm'], 0.14, 0.14, 0.04, -0.22, 0.42, 0.44)
        B.box(pal['wood'], 0.26, 0.2, 0.26, 0.6, 0.1, 0.5)
        return
    if t == 2:
        B.box(pal['stone'], 1.15, 1.25, 0.95, 0, 0.1, 0)
        B.box(pal['stone2'], 1.2, 0.07, 1.0, 0, 0.7, 0)
        B.gable(pal['roof'], 1.15, 0.6, 0.95, 0, 1.35, 0, ry=math.pi / 2)
        B.box(pal['stone2'], 0.2, 0.55, 0.2, 0.35, 1.45, -0.2)
        door(B, pal, 0.22, 0.4, 0, 0.48, 0.1)
        for x in (-0.33, 0.33):
            G.box(pal['warm'], 0.14, 0.16, 0.04, x, 0.95, 0.48)
        return
    if t == 3:
        B.box(pal['stone'], 1.2, 1.3, 0.8, -0.1, 0.1, -0.25)
        B.gable(pal['roof'], 1.2, 0.6, 0.8, -0.1, 1.4, -0.25, ry=math.pi / 2)
        B.box(pal['stone'], 0.6, 1.0, 0.7, 0.35, 0.1, 0.35)
        B.gable(pal['roof2'], 0.6, 0.45, 0.7, 0.35, 1.1, 0.35)
        round_tower(B, G, pal, -0.6, 0.35, 0.22, 1.6)
        door(B, pal, 0.22, 0.4, 0.35, 0.71, 0.1)
        for x in (-0.45, 0.1):
            G.box(pal['warm'], 0.14, 0.16, 0.04, x, 0.95, 0.16)
        banner(B, pal, 0.68, -0.6, 0.1, 1.9, flip=True)
        return
    # t4: arcology townhouse — three storeys and an energy spire
    B.box(pal['stone'], 1.2, 2.3, 1.05, 0, 0.1, 0)
    for y in (0.85, 1.6):
        B.box(pal['stone2'], 1.26, 0.08, 1.1, 0, y, 0)
        for x in (-0.33, 0.0, 0.33):
            G.box(pal['warm'], 0.14, 0.18, 0.04, x, y + 0.3, 0.53)
    G.box(pal['glow'], 1.22, 0.06, 1.07, 0, 2.15, 0)
    B.gable(pal['roof'], 1.2, 0.6, 1.05, 0, 2.4, 0, ry=math.pi / 2)
    B.prism(pal['steel'], 4, 0.06, 0, 0.9, 0, 3.0, 0)
    G.octa(pal['glow'], 0.1, 0.14, 0, 3.55, 0)
    door(B, pal, 0.24, 0.45, 0, 0.53, 0.1)


# ---------------------------------------------------------------- farm

def farm(k, t, pal):
    B, G = k.B, k.G
    B.box(pal['field'], 1.85, 0.08, 1.85, 0, 0, 0)
    rows = 4 if t == 1 else 5
    for i in range(rows):
        z = -0.75 + i * (1.5 / (rows - 1))
        c = pal['crop'] if (i + t) % 2 else pal['crop2']
        B.box(c, 1.1 if t < 3 else 0.9, 0.16, 0.2, -0.3 if t < 3 else -0.45, 0.08, z)
    if t == 1:
        for x in (-0.88, 0.88):
            for z in (-0.88, 0, 0.88):
                B.box(pal['wood'], 0.06, 0.28, 0.06, x, 0.08, z)
        B.box(pal['wood'], 0.4, 0.35, 0.4, 0.62, 0.08, 0.55)
        B.gable(pal['roof'], 0.4, 0.24, 0.4, 0.62, 0.43, 0.55)
        return
    # barn + silo
    B.box(pal['accent'], 0.6, 0.55, 0.75, 0.55, 0.08, 0.3)
    B.gable(pal['roof2'], 0.6, 0.35, 0.75, 0.55, 0.63, 0.3)
    B.box(pal['stone'], 0.2, 0.3, 0.04, 0.55, 0.08, 0.68)
    B.prism(pal['stone'], 8, 0.22, 0.22, 1.0, 0.6, 0.08, -0.5)
    B.prism(pal['roof'], 8, 0.25, 0, 0.3, 0.6, 1.08, -0.5)
    if t >= 3:
        for (x, z) in ((0.15, -0.55), (0.15, 0.55)):
            G.ico(pal['glow'], 0.3, x, 0.08, z, 1, 0.9, 1, sub=1)
            B.prism(pal['steel'], 8, 0.34, 0.34, 0.06, x, 0.06, z)


# ---------------------------------------------------------------- mill

def mill(k, t, pal):
    B, G = k.B, k.G
    h = {1: 1.4, 2: 1.9, 3: 2.4}[t]
    B.prism(pal['stone3'], 8, 0.7, 0.7, 0.12, 0, 0, 0)
    B.prism(pal['stone'], 8, 0.56, 0.4, h, 0, 0.12, 0)
    B.prism(pal['roof'], 8, 0.5, 0, 0.55, 0, h + 0.12, 0)
    door(B, pal, 0.2, 0.36, 0, 0.5, 0.12)
    G.box(pal['warm'], 0.12, 0.14, 0.04, 0, h * 0.62, 0.47)
    if t >= 2:
        B.box(pal['wood'], 0.5, 0.28, 0.4, 0.55, 0.12, 0.1)
    if t >= 3:
        banner(B, pal, -0.6, 0.2, 0.12, 1.4, flip=True)
    hub_y = h - 0.05
    rotor = k.part('part_rotor', origin=(0, hub_y, 0.52))
    rotor.box(pal['steel'], 0.16, 0.16, 0.14, 0, hub_y - 0.08, 0.52)
    blade = {1: 0.75, 2: 0.95, 3: 1.1}[t]
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        dx, dy = math.cos(a), math.sin(a)
        # a box's +y axis rotated by (a - 90deg) about z points along angle a
        rotor.box(pal['wood'], 0.07, blade, 0.03, 0, hub_y, 0.6, 0, 0, a - math.pi / 2)
        rotor.box(pal['stone'], 0.2, blade * 0.7, 0.02, dx * 0.28 - dy * 0.07, hub_y + dy * 0.28 + dx * 0.07,
                  0.62, 0, 0, a - math.pi / 2)
    if t >= 3:
        rotor.box(pal['trim'], 0.2, 0.2, 0.05, 0, hub_y - 0.1, 0.64)


# ---------------------------------------------------------------- mine

def mine(k, t, pal):
    B, G = k.B, k.G
    B.ico(pal['stone3'], 0.85, -0.2, 0.0, -0.25, 1.2, 0.7, 1.0)
    B.ico(pal['stone2'], 0.55, 0.45, 0.0, -0.45, 1.0, 0.8, 1.0)
    for (x, z, s) in ((-0.6, 0.45, 1.0), (0.65, 0.2, 0.8), (-0.1, 0.65, 0.7)) + (((0.3, -0.75, 1.2), (-0.8, -0.2, 0.9)) if t >= 2 else ()):
        G.octa(pal['glow'], 0.1 * s, 0.24 * s, x, 0.2 * s, z, ry=x)
    fh = {1: 1.3, 2: 1.6, 3: 1.9}[t]
    for sx in (-0.32, 0.32):
        B.box(pal['wood'], 0.08, fh, 0.08, sx, 0, 0.25, 0, 0, -sx * 0.25)
    B.box(pal['wood'], 0.8, 0.08, 0.1, 0, fh - 0.05, 0.25)
    wheel = k.part('part_rotor', origin=(0, fh - 0.2, 0.34))
    wheel.prism(pal['steel'], 10, 0.3, 0.3, 0.06, 0, fh - 0.2, 0.31, rx=math.pi / 2)
    wheel.box(pal['dark'], 0.5, 0.05, 0.08, 0, fh - 0.225, 0.36)
    wheel.box(pal['dark'], 0.05, 0.5, 0.08, 0, fh - 0.45, 0.36)
    if t >= 2:
        B.box(pal['steel'], 0.36, 0.2, 0.26, 0.55, 0.0, 0.65)
        G.box(pal['glow'], 0.28, 0.06, 0.18, 0.55, 0.2, 0.65)
    if t >= 3:
        B.box(pal['stone'], 0.7, 0.6, 0.6, -0.65, 0, 0.45)
        B.gable(pal['roof'], 0.7, 0.35, 0.6, -0.65, 0.6, 0.45, ry=math.pi / 2)
        banner(B, pal, 0.85, -0.6, 0, 1.5, flip=True)


# ---------------------------------------------------------------- barracks

CAMP_COLORS = {'militia': 0x3f70c8, 'ranger': 0x4f9a52, 'sniper': 0x7a5cc0}


def camp(k, t, pal, trade='militia'):
    B, G = k.B, k.G
    col = CAMP_COLORS[trade]
    B.box(pal['stone3'], 1.9, 0.1, 1.9, 0, 0, 0)
    hall_w = 1.1 if t == 1 else 1.3
    B.box(pal['stone'], hall_w, 0.7 if t == 1 else 0.95, 0.75, 0, 0.1, -0.45)
    rh = 0.8 if t == 1 else 1.05
    B.gable(col, hall_w, 0.42, 0.75, 0, rh, -0.45, ry=math.pi / 2)
    door(B, pal, 0.26, 0.45, 0, -0.07, 0.1)
    banner(B, pal, -0.8, -0.1, 0.1, 1.3, color=col)
    # training yard: weapon rack + dummies
    B.box(pal['wood'], 0.5, 0.06, 0.08, -0.45, 0.4, 0.55)
    for x in (-0.65, -0.25):
        B.box(pal['wood'], 0.06, 0.4, 0.06, x, 0.1, 0.55)
    if trade == 'ranger':
        B.prism(0xe9e0cc, 10, 0.2, 0.2, 0.04, 0.45, 0.35, 0.6, rx=math.pi / 2)
        B.prism(0xc4473b, 10, 0.1, 0.1, 0.05, 0.45, 0.35, 0.62, rx=math.pi / 2)
        B.box(pal['wood'], 0.05, 0.4, 0.05, 0.45, 0.1, 0.56)
    else:
        B.box(pal['wood'], 0.06, 0.55, 0.06, 0.45, 0.1, 0.55)
        B.box(0xd9c9a3, 0.28, 0.25, 0.16, 0.45, 0.4, 0.55)
    if t >= 2:
        B.prism(col, 4, 0.35, 0, 0.5, 0.7, 0.1, 0.0, phase=math.pi / 4)
        B.prism(shade(col, 0.8), 4, 0.3, 0, 0.42, -0.7, 0.1, 0.25, phase=math.pi / 4)
        banner(B, pal, 0.8, -0.1, 0.1, 1.3, color=col, flip=True)
    if t >= 3:
        top = round_tower(B, G, pal, 0.75, -0.75, 0.24, 1.6)
        banner(B, pal, 0.75, -0.75, top + 0.5, 0.9, color=col)
        guard(B, pal, 0.0, 0.1, 0.4, 0.0, s=0.75)
        guard(B, pal, 0.25, 0.1, 0.75, 0.3, s=0.75)
        G.box(pal['glow'], hall_w, 0.05, 0.05, 0, 0.75, -0.06)


# ---------------------------------------------------------------- outpost

def outpost(k, t, pal):
    B, G = k.B, k.G
    half = 0.8
    B.box(pal['stone3'], 1.9, 0.1, 1.9, 0, 0, 0)
    wh = 0.45 + t * 0.12
    for (x0, z0, x1, z1) in ((-half, -half, half, -half), (half, -half, half, half), (-half, half, -half, -half)):
        curtain(B, pal, x0, z0, x1, z1, wh, 0.18)
    curtain(B, pal, half, half, 0.25, half, wh, 0.18)
    curtain(B, pal, -0.25, half, -half, half, wh, 0.18)
    h = 0.9 + t * 0.35
    top = round_tower(B, G, pal, 0, -0.1, 0.42, h, roof=False)
    head = k.part('part_turret', origin=(0, top + 0.1, 0))
    turret_head(head, pal, 0.75 + t * 0.07, twin=t >= 3, coil=t >= 4, oy=top + 0.1)
    banner(B, pal, -half, half, wh, 1.0)
    if t >= 2:
        banner(B, pal, half, half, wh, 1.0, flip=True)


# ---------------------------------------------------------------- workshop

def workshop(k, t, pal):
    B, G = k.B, k.G
    B.box(pal['stone3'], 1.9, 0.1, 1.9, 0, 0, 0)
    B.box(pal['stone'], 1.3, 0.85, 0.9, -0.1, 0.1, -0.3)
    B.gable(pal['roof2'], 1.3, 0.4, 0.9, -0.1, 0.95, -0.3, ry=math.pi / 2)
    B.box(pal['stone2'], 0.3, 1.5 + t * 0.2, 0.3, 0.4, 0.1, -0.55)
    G.box(0xff9a3c, 0.22, 0.08, 0.22, 0.4, 1.6 + t * 0.2, -0.55)
    G.box(0xff9a3c, 0.5, 0.3, 0.04, -0.1, 0.12, 0.16)
    B.box(pal['dark'], 0.3, 0.25, 0.25, 0.4, 0.1, 0.55)  # anvil block
    if t >= 2:
        B.box(pal['wood'], 0.08, 1.4, 0.08, -0.75, 0.1, 0.6)
        B.box(pal['wood'], 0.7, 0.07, 0.07, -0.45, 1.45, 0.6)
        B.box(pal['steel'], 0.18, 0.18, 0.18, -0.15, 1.0, 0.6)
    if t >= 3:
        banner(B, pal, 0.85, 0.75, 0.1, 1.4, flip=True)
        G.box(pal['glow'], 1.3, 0.05, 0.05, -0.1, 0.6, 0.16)


# ---------------------------------------------------------------- hero forge

def hero_forge(k, t, pal):
    B, G = k.B, k.G
    B.prism(pal['stone3'], 8, 0.95, 0.95, 0.14, 0, 0, 0)
    B.prism(pal['stone2'], 8, 0.75, 0.75, 0.14, 0, 0.14, 0)
    h = 1.0 + t * 0.35
    B.prism(pal['stone'], 4, 0.26, 0.12, h, 0, 0.28, 0, phase=math.pi / 4)
    G.octa(pal['glow'], 0.16, 0.26, 0, h + 0.55, 0)
    for i in range(4 if t < 3 else 6):
        a = i / (4 if t < 3 else 6) * TAU
        x, z = math.cos(a) * 0.82, math.sin(a) * 0.82
        B.box(pal['stone'], 0.16, 0.5 + t * 0.15, 0.16, x, 0.14, z)
        G.box(pal['glow'], 0.1, 0.06, 0.1, x, 0.64 + t * 0.15, z)
    if t >= 2:
        banner(B, pal, -0.6, -0.6, 0.14, 1.4)
        banner(B, pal, 0.6, -0.6, 0.14, 1.4, flip=True)
    if t >= 3:
        G.prism(pal['glow'], 8, 0.8, 0.8, 0.04, 0, 0.28, 0)


# ---------------------------------------------------------------- figures
#
# Chunky block figurines, ~0.95 tall, facing +z. Limbs are separate parts
# with their origin at the hip / shoulder so the runtime stride swings them.

def _legs(k, pal, col, boot, hip=0.36, w=0.1, s=1.0):
    for name, x in (('leg_l', -w), ('leg_r', w)):
        L = k.part(name, origin=(x * s, hip * s, 0))
        L.box(col, 0.14 * s, (hip - 0.08) * s, 0.16 * s, x * s, 0.08 * s, 0)
        L.box(boot, 0.16 * s, 0.1 * s, 0.22 * s, x * s, 0, 0.02 * s)


def _torso(B, pal, armor, cloth, s=1.0, wide=1.0):
    B.box(armor, 0.36 * s * wide, 0.36 * s, 0.24 * s, 0, 0.34 * s, 0)
    B.box(cloth, 0.38 * s * wide, 0.3 * s, 0.26 * s, 0, 0.3 * s, 0)
    B.box(pal['trim'], 0.39 * s * wide, 0.05 * s, 0.27 * s, 0, 0.42 * s, 0)


def trooper(k, pal):
    """Shield knight with a rifle-lance — the line soldier."""
    B, G = k.B, k.G
    steel, cloth = 0xc9d3df, pal['cloth']
    _legs(k, pal, 0x8d98a8, pal['dark'])
    _torso(B, pal, steel, cloth)
    B.box(steel, 0.42, 0.14, 0.28, 0, 0.62, 0)              # pauldrons
    B.box(steel, 0.3, 0.28, 0.3, 0, 0.72, 0)                # helm
    B.box(pal['dark'], 0.24, 0.07, 0.04, 0, 0.83, 0.15)     # visor slit
    G.box(pal['glow'], 0.18, 0.03, 0.02, 0, 0.845, 0.17)
    B.box(pal['trim'], 0.06, 0.16, 0.28, 0, 1.0, -0.01)     # crest
    A = k.part('arm_l', origin=(-0.24, 0.66, 0))
    A.box(steel, 0.11, 0.3, 0.13, -0.25, 0.38, 0)
    A.box(cloth, 0.06, 0.42, 0.34, -0.33, 0.3, 0.06)        # kite shield
    A.box(pal['trim'], 0.07, 0.42, 0.06, -0.335, 0.3, 0.06)
    A.box(pal['trim'], 0.07, 0.06, 0.3, -0.335, 0.48, 0.06)
    R = k.part('arm_r', origin=(0.24, 0.66, 0))
    R.box(steel, 0.11, 0.3, 0.13, 0.25, 0.38, 0)
    R.box(pal['dark'], 0.07, 0.07, 0.62, 0.27, 0.42, 0.22)  # rifle-lance
    R.box(pal['trim'], 0.09, 0.09, 0.07, 0.27, 0.41, 0.52)
    G.box(pal['glow'], 0.04, 0.04, 0.1, 0.27, 0.43, 0.58)


def ranger(k, pal):
    """Hooded scout with an energy bow."""
    B, G = k.B, k.G
    green, leather = 0x4f9a52, 0x8a6342
    _legs(k, pal, leather, pal['dark'])
    _torso(B, pal, leather, green)
    B.box(green, 0.44, 0.12, 0.3, 0, 0.6, 0)                # cape shoulders
    B.box(green, 0.36, 0.42, 0.06, 0, 0.24, -0.15)          # cape
    B.box(pal['skin'], 0.24, 0.22, 0.24, 0, 0.7, 0)
    B.prism(green, 4, 0.22, 0, 0.32, 0, 0.84, 0, phase=math.pi / 4)  # hood
    B.box(pal['dark'], 0.2, 0.05, 0.03, 0, 0.78, 0.125)
    A = k.part('arm_l', origin=(-0.22, 0.64, 0))
    A.box(leather, 0.1, 0.3, 0.12, -0.23, 0.36, 0.02)
    A.box(pal['wood'], 0.05, 0.62, 0.05, -0.27, 0.16, 0.18)  # bow stave
    G.box(pal['glow'], 0.02, 0.56, 0.02, -0.27, 0.19, 0.14)  # string
    R = k.part('arm_r', origin=(0.22, 0.64, 0))
    R.box(leather, 0.1, 0.3, 0.12, 0.23, 0.36, 0)
    B.box(leather, 0.12, 0.34, 0.12, 0.12, 0.42, -0.17)     # quiver
    G.box(pal['glow'], 0.1, 0.06, 0.1, 0.12, 0.76, -0.17)


def marksman(k, pal):
    """Cloaked sniper with a long rail rifle."""
    B, G = k.B, k.G
    violet, dark = 0x7a5cc0, 0x3d3560
    _legs(k, pal, dark, pal['dark'])
    _torso(B, pal, dark, violet)
    B.box(violet, 0.4, 0.5, 0.06, 0, 0.18, -0.15)
    B.box(dark, 0.27, 0.27, 0.27, 0, 0.68, 0)
    G.box(0xc8a8ff, 0.08, 0.06, 0.03, 0.06, 0.79, 0.14)      # scope eye
    B.box(violet, 0.31, 0.08, 0.31, 0, 0.93, 0)
    A = k.part('arm_l', origin=(-0.22, 0.64, 0))
    A.box(dark, 0.1, 0.3, 0.12, -0.23, 0.36, 0.04)
    R = k.part('arm_r', origin=(0.22, 0.64, 0))
    R.box(dark, 0.1, 0.3, 0.12, 0.23, 0.36, 0)
    R.box(pal['dark'], 0.06, 0.08, 0.95, 0.18, 0.44, 0.3)
    R.box(pal['steel'], 0.08, 0.08, 0.16, 0.18, 0.52, 0.18)
    G.box(0xc8a8ff, 0.03, 0.03, 0.1, 0.18, 0.45, 0.8)


# ---------------------------------------------------------------- heroes
#
# Each hero rides a hoverbike. Scott: a heavy brawler bike and gravity maul.
# Alexander: a long, sleek lancer bike with a slung rail rifle and banner.
# Daniel: a low, finned stealth bike with twin blades.

HERO_LOOK = {
    'scott': {'main': 0xb32020, 'trim': 0xf4f1e8, 'bike': 0x3a3f4c, 'glow': 0xff8a5c},
    'alexander': {'main': 0x2f8f46, 'trim': 0xf3c53d, 'bike': 0xeee5cf, 'glow': 0x8ff3ff},
    'danny': {'main': 0x2468c9, 'trim': 0x16181e, 'bike': 0x22262f, 'glow': 0x7dffb2},
}


def _bike(B, G, look, length, width, height, nose, fins=False, heavy=False):
    y0 = 0.22
    B.box(look['bike'], width, height, length, 0, y0, -0.05)
    B.box(look['main'], width * 0.8, height * 0.6, nose, 0, y0 + height * 0.25, length / 2 + nose / 2 - 0.08)
    B.prism(look['main'], 4, width * 0.42, 0, nose * 0.7, 0, y0 + height * 0.55, length / 2 + nose * 0.75,
            rx=math.pi / 2, phase=math.pi / 4)
    B.box(look['trim'], width + 0.04, 0.05, length * 0.7, 0, y0 + height, -0.05)
    for sx in (-1, 1):
        B.box(look['bike'], 0.12 if heavy else 0.08, 0.14, length * 0.7, sx * (width / 2 + 0.06), y0 - 0.04, -0.05)
        G.box(look['glow'], 0.1, 0.03, length * 0.55, sx * (width / 2 + 0.06), y0 - 0.06, -0.05)
    G.box(look['glow'], width * 0.6, 0.1, 0.05, 0, y0 + height * 0.3, -length / 2 - 0.07)  # thruster
    G.box(look['glow'], width * 0.7, 0.03, length * 0.8, 0, 0.1, -0.05)                   # hover wash
    B.box(pal_dark(), 0.5 * width, 0.05, 0.05, 0, y0 + height + 0.18, length / 2 - 0.12)   # handlebar
    if fins:
        for sx in (-1, 1):
            B.box(look['main'], 0.03, 0.22, 0.3, sx * width * 0.35, y0 + height, -length / 2 + 0.15, 0, 0, sx * 0.4)


def pal_dark():
    return 0x23262e


def hero(k, key, pal):
    B, G = k.B, k.G
    look = HERO_LOOK[key]
    if key == 'scott':
        _bike(B, G, look, 1.0, 0.46, 0.26, 0.28, heavy=True)
        seat = 0.5
        B.box(look['main'], 0.44, 0.36, 0.3, 0, seat, -0.12)          # torso
        B.box(look['trim'], 0.6, 0.16, 0.36, 0, seat + 0.3, -0.12)    # pauldrons
        B.box(look['main'], 0.3, 0.28, 0.3, 0, seat + 0.42, -0.1)     # helm
        G.box(look['glow'], 0.22, 0.05, 0.03, 0, seat + 0.55, 0.06)
        B.box(pal_dark(), 0.06, 0.8, 0.06, 0.14, seat + 0.05, -0.32, -0.6, 0, 0)  # maul haft
        B.box(look['bike'], 0.34, 0.24, 0.24, 0.14, seat + 0.62, -0.62, -0.6, 0, 0)
        G.box(0x7a9cf0, 0.36, 0.06, 0.26, 0.14, seat + 0.72, -0.6, -0.6, 0, 0)
        arm_w, arm_c = 0.14, look['main']
    elif key == 'alexander':
        _bike(B, G, look, 1.3, 0.38, 0.2, 0.4)
        seat = 0.46
        B.box(look['main'], 0.34, 0.34, 0.24, 0, seat, -0.15)
        B.box(look['trim'], 0.36, 0.05, 0.26, 0, seat + 0.12, -0.15)
        B.box(pal['skin'], 0.22, 0.22, 0.22, 0, seat + 0.36, -0.12)
        B.box(look['trim'], 0.26, 0.08, 0.26, 0, seat + 0.56, -0.12)  # gold circlet helm
        B.box(look['main'], 0.3, 0.42, 0.04, 0, seat - 0.05, -0.3)    # cape
        B.box(pal_dark(), 0.06, 0.06, 1.0, -0.16, seat + 0.18, -0.25, 0.5, 0, 0)  # rail rifle
        G.box(look['glow'], 0.03, 0.03, 0.4, -0.16, seat + 0.24, -0.15, 0.5, 0, 0)
        banner(B, pal, 0.15, -0.6, 0.4, 1.0, color=look['main'])
        arm_w, arm_c = 0.11, look['main']
    else:
        _bike(B, G, look, 1.15, 0.34, 0.16, 0.36, fins=True)
        seat = 0.4
        B.box(look['trim'], 0.32, 0.3, 0.24, 0, seat, -0.12)
        B.box(look['main'], 0.34, 0.05, 0.26, 0, seat + 0.08, -0.12)
        B.box(look['main'], 0.26, 0.26, 0.26, 0, seat + 0.3, -0.06)
        B.prism(look['main'], 4, 0.2, 0, 0.26, 0, seat + 0.5, -0.08, phase=math.pi / 4)  # hood
        G.box(look['glow'], 0.16, 0.04, 0.03, 0, seat + 0.42, 0.08)
        for sx in (-1, 1):
            B.box(0xd8dde6, 0.04, 0.6, 0.04, sx * 0.1, seat + 0.05, -0.28, -0.4, 0, sx * 0.4)
            G.box(look['glow'], 0.02, 0.4, 0.02, sx * 0.1, seat + 0.2, -0.3, -0.4, 0, sx * 0.4)
        arm_w, arm_c = 0.1, look['trim']
    for name, sx in (('arm_l', -1), ('arm_r', 1)):
        A = k.part(name, origin=(sx * 0.22, seat + 0.28, -0.08))
        A.box(arm_c, arm_w, 0.12, 0.38, sx * 0.22, seat + 0.2, 0.08, -0.35, 0, 0)


# ---------------------------------------------------------------- enemies
#
# The hive: dark violet husks with glowing eyes; each type's accent colour
# rides the spines and plates so the roster reads apart. Arms are pivot-
# relative (origin at the shoulder line) for the instanced swing.

HIVE = 0x4b3d63
HIVE2 = 0x6a5888
HIVE3 = 0x2f2742


def enemy(k, key, accent):
    B, A, E = k.B, k.part('arms', origin=(0, 0.72, 0.02)), k.part('eyes', glow=True)
    pv = 0.72
    if key == 'walker':
        for x in (-0.1, 0.1):
            B.box(HIVE3, 0.13, 0.32, 0.15, x, 0, 0)
        B.box(HIVE, 0.4, 0.38, 0.28, 0, 0.32, 0, 0.18, 0, 0)
        B.box(accent, 0.3, 0.1, 0.12, 0, 0.62, -0.12, 0.3, 0, 0)
        B.box(HIVE2, 0.28, 0.24, 0.26, 0, 0.7, 0.08, 0.25, 0, 0)
        eyes = [(-0.06, 0.82, 0.22), (0.06, 0.82, 0.22)]
        arm_len, arm_w = 0.42, 0.1
    elif key == 'runner':
        pv = 0.66
        for x, z in ((-0.08, 0.1), (0.08, -0.12)):
            B.box(HIVE3, 0.1, 0.34, 0.12, x, 0, z)
        B.box(HIVE, 0.3, 0.3, 0.24, 0, 0.32, 0.03, 0.55, 0, 0)
        B.box(accent, 0.08, 0.18, 0.28, 0, 0.55, -0.05, 0.55, 0, 0)
        B.box(HIVE2, 0.22, 0.2, 0.28, 0, 0.56, 0.2, 0.4, 0, 0)
        eyes = [(-0.05, 0.66, 0.36), (0.05, 0.66, 0.36)]
        arm_len, arm_w = 0.38, 0.08
    elif key == 'brute':
        pv = 0.8
        for x in (-0.16, 0.16):
            B.box(HIVE3, 0.2, 0.34, 0.22, x, 0, 0)
        B.box(HIVE, 0.66, 0.5, 0.44, 0, 0.32, 0)
        B.box(accent, 0.7, 0.14, 0.3, 0, 0.78, -0.08)
        B.box(HIVE2, 0.24, 0.18, 0.22, 0, 0.82, 0.18)
        eyes = [(-0.06, 0.9, 0.3), (0.06, 0.9, 0.3)]
        arm_len, arm_w = 0.5, 0.18
    elif key == 'spitter':
        for x in (-0.1, 0.1):
            B.box(HIVE3, 0.12, 0.3, 0.14, x, 0, 0)
        B.box(HIVE, 0.36, 0.34, 0.26, 0, 0.3, 0)
        B.ico(accent, 0.24, 0, 0.62, -0.18, 1, 1, 1, sub=1)
        B.box(HIVE2, 0.12, 0.26, 0.12, 0, 0.6, 0.1, -0.4, 0, 0)
        B.box(HIVE2, 0.2, 0.16, 0.24, 0, 0.82, 0.2)
        eyes = [(-0.05, 0.94, 0.33), (0.05, 0.94, 0.33)]
        arm_len, arm_w = 0.32, 0.08
    elif key == 'burrower':
        pv = 0.5
        for x in (-0.16, 0.16):
            B.box(HIVE3, 0.14, 0.2, 0.3, x, 0, 0)
        B.box(HIVE, 0.48, 0.3, 0.46, 0, 0.18, -0.04)
        B.prism(accent, 6, 0.2, 0, 0.42, 0, 0.35, 0.2, rx=math.pi / 2)
        B.box(HIVE2, 0.36, 0.12, 0.3, 0, 0.48, -0.08)
        eyes = [(-0.12, 0.42, 0.18), (0.12, 0.42, 0.18)]
        arm_len, arm_w = 0.3, 0.12
    elif key == 'sieger':
        pv = 0.78
        for x in (-0.16, 0.16):
            B.box(HIVE3, 0.18, 0.32, 0.22, x, 0, 0)
        B.box(HIVE, 0.58, 0.46, 0.5, 0, 0.3, 0)
        for i in range(3):
            B.box(accent, 0.62 - i * 0.1, 0.1, 0.34 - i * 0.04, 0, 0.62 + i * 0.1, -0.06 - i * 0.04)
        B.box(HIVE2, 0.42, 0.3, 0.2, 0, 0.36, 0.3)
        eyes = [(-0.12, 0.6, 0.41), (0.12, 0.6, 0.41)]
        arm_len, arm_w = 0.44, 0.16
    else:  # caller
        pv = 0.86
        for x in (-0.08, 0.08):
            B.box(HIVE3, 0.1, 0.42, 0.12, x, 0, 0)
        B.box(HIVE, 0.28, 0.46, 0.22, 0, 0.4, 0)
        B.box(HIVE2, 0.24, 0.22, 0.22, 0, 0.88, 0.02)
        for i, a in enumerate((-0.5, 0, 0.5)):
            E.prism(accent, 4, 0.04, 0, 0.3, math.sin(a) * 0.1, 1.08, 0, rz=-a)
        eyes = [(-0.05, 1.0, 0.13), (0.05, 1.0, 0.13)]
        arm_len, arm_w = 0.5, 0.07
    A.origin.y = pv
    for sx in (-1, 1):
        A.box(HIVE2, arm_w, arm_w, arm_len, sx * (0.2 + arm_w), pv - arm_w, 0.06 + arm_len / 2 - 0.12)
        A.box(accent, arm_w * 1.1, arm_w * 0.5, 0.08, sx * (0.2 + arm_w), pv - arm_w * 0.4, arm_len - 0.1)
    for (x, y, z) in eyes:
        E.box(0xffffff, 0.06, 0.05, 0.04, x, y, z)


# ---------------------------------------------------------------- props

def tree_round(k, pal):
    k.part('trunk').prism(0x9a6b44, 5, 0.09, 0.06, 0.5, 0, 0, 0)
    c = k.part('canopy')
    c.ico(0xffffff, 0.42, 0, 0.75, 0, 1, 1.05, 1, sub=1)
    c.ico(0xe3e3e3, 0.26, 0.24, 0.55, 0.1, 1, 1, 1, sub=1)


def tree_pine(k, pal):
    k.part('trunk').prism(0x9a6b44, 5, 0.08, 0.06, 0.35, 0, 0, 0)
    c = k.part('canopy')
    c.prism(0xe6e6e6, 6, 0.48, 0.0, 0.65, 0, 0.28, 0)
    c.prism(0xffffff, 6, 0.38, 0.0, 0.6, 0, 0.62, 0)
    c.prism(0xffffff, 6, 0.26, 0.0, 0.5, 0, 0.95, 0)


def rock(k, pal, variant=0):
    r = k.part('rock')
    if variant == 0:
        r.ico(0xffffff, 0.45, 0, 0.12, 0, 1.2, 0.8, 1.0, sub=0, ry=0.3)
        r.ico(0xdedede, 0.28, 0.32, 0.05, 0.18, 1, 0.8, 1, sub=0)
    else:
        r.prism(0xffffff, 5, 0.42, 0.18, 0.9, 0, 0, 0, phase=0.4)
        r.prism(0xe0e0e0, 4, 0.22, 0.08, 0.5, 0.32, 0, 0.12, phase=0.2)


def cliff(k, pal):
    r = k.part('rock')
    r.prism(0xffffff, 6, 0.62, 0.48, 1.0, 0, 0, 0, phase=0.25)
    r.prism(0xe6e6e6, 6, 0.48, 0.3, 0.45, 0.05, 1.0, -0.05, phase=0.6)
