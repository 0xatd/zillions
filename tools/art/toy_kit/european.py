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
    'stone': 0xe9d8b4, 'stone2': 0xd2bc92, 'stone3': 0xa88f6c, 'roof': 0x3a66c4,
    'roof2': 0x3a66c4, 'trim': 0xf2c14e, 'banner': 0x3f70c8, 'accent': 0xc4473b,
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


def window(B, G, pal, x, y, z, w=0.14, h=0.18, shutters=True, sill=True):
    """Front-facing (+z) lit window: wood frame, optional shutters and sill."""
    B.box(pal['wood'], w + 0.06, h + 0.06, 0.03, x, y - 0.03, z)
    G.box(pal['warm'], w, h, 0.04, x, y, z + 0.005)
    B.box(pal['wood'], w, 0.025, 0.045, x, y + h * 0.48, z + 0.01)        # mullion bar
    if shutters:
        for sx in (-1, 1):
            B.box(pal['roof2'], w * 0.45, h + 0.04, 0.03, x + sx * (w * 0.5 + w * 0.28), y - 0.02, z + 0.005)
    if sill:
        B.box(pal['stone2'], w + 0.1, 0.035, 0.07, x, y - 0.06, z + 0.02)


def flower_box(B, pal, x, y, z, w=0.22):
    B.box(pal['wood'], w, 0.06, 0.07, x, y, z + 0.03)
    for i, c in enumerate((pal['accent'], pal['crop2'], pal['accent'])):
        B.box(c, 0.05, 0.05, 0.05, x + (i - 1) * w * 0.32, y + 0.06, z + 0.03)
    B.box(pal['leaf'], w * 0.9, 0.03, 0.06, x, y + 0.055, z + 0.03)


def chimney(B, pal, x, y, z, h=0.45, w=0.18):
    B.box(pal['stone3'], w, h, w, x, y, z)
    B.box(pal['stone2'], w + 0.06, 0.06, w + 0.06, x, y + h, z)
    B.box(pal['dark'], w * 0.5, 0.04, w * 0.5, x, y + h + 0.06, z)


def timber_front(B, pal, w, y0, y1, z, posts=3):
    """Half-timbering on a +z wall: top/bottom beams, posts and one brace."""
    c = shade(pal['wood'], 0.85)
    B.box(c, w, 0.05, 0.03, 0, y0, z)
    B.box(c, w, 0.05, 0.03, 0, y1 - 0.05, z)
    for i in range(posts):
        x = -w / 2 + 0.03 + i * (w - 0.06) / (posts - 1)
        B.box(c, 0.05, y1 - y0, 0.03, x, y0, z)
    B.box(c, 0.04, (y1 - y0) * 1.1, 0.03, -w * 0.25, y0 + 0.02, z, 0, 0, 0.6)


def ridge(B, pal, w, y, z=0, ry=0.0, length=1.0):
    B.box(shade(pal['roof'], 0.72), 0.06, 0.05, length, 0, y, z, 0, ry, 0)


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
    if h > 0.9:
        B.prism(pal['stone2'], seg, r * 1.02, r * 1.02, 0.07, x, 0.18 + h * 0.34, z)   # stone course
        for a in (TAU / 4 + TAU / 8, TAU / 4 - TAU / 8):
            B.box(pal['dark'], 0.05, 0.16, 0.03, x + math.cos(a) * r * 0.96, 0.18 + h * 0.48, z + math.sin(a) * r * 0.96,
                  0, -a + TAU / 4, 0)                                                   # arrow slits
    if window:
        G.box(pal['warm'], 0.1, 0.18, 0.04, x, top * 0.62, z + r * 0.97)
        B.box(pal['stone2'], 0.16, 0.04, 0.06, x, top * 0.62 + 0.18, z + r * 0.97)
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
    """Iconic, uncluttered keep: warm stone, one blue roof colour, a single
    banner. Each tier adds one readable mass (curtain + towers, then height,
    then a spire) instead of more small parts. Scale matches the figurines:
    the door is ~1.4 figurines tall."""
    B, G = k.B, k.G
    r = 2.0 + min(t, 3) * 0.1
    base = hex_plinth(B, G, pal, r, steps=2 if t < 3 else 3, lamps=False)
    if t == 1:
        keep_block(B, G, pal, 1.7, 1.6, 1.8, base, roof='pyramid', windows=0)
        door(B, pal, 0.4, 0.6, 0, 0.81, base)
        for x in (-0.5, 0.5):
            window(B, G, pal, x, base + 1.0, 0.81, w=0.16, h=0.22)
        B.box(pal['stone2'], 1.76, 0.07, 1.66, 0, base + 0.75, 0)
        chimney(B, pal, -0.55, base + 1.9, -0.45, h=0.6, w=0.2)
        banner(B, pal, 1.15, 0.85, base, 1.6, flip=True)
        return
    # T2+: a chunky square curtain with four round corner towers.
    half = 1.45 if t == 2 else 1.6
    wall_h = 0.8 if t == 2 else 1.1
    thick = 0.34 if t == 2 else 0.42
    corners = [(-half, -half), (half, -half), (half, half), (-half, half)]
    for i in range(4):
        x0, z0 = corners[i]
        x1, z1 = corners[(i + 1) % 4]
        if i == 2:  # the front wall leaves a clear gate opening
            curtain(B, pal, x0, z0, 0.45, z1, wall_h, thick)
            curtain(B, pal, -0.45, z0, x1, z1, wall_h, thick)
        else:
            curtain(B, pal, x0, z0, x1, z1, wall_h, thick)
    tower_h = 1.6 if t == 2 else 2.2 if t == 3 else 2.5
    tr = 0.42 if t == 2 else 0.5
    for (x, z) in corners:
        round_tower(B, G, pal, x, z, tr, tower_h, crest=False, window=False)
    # gate: two squat flanking piers and a lintel — a plain dark opening
    gh = wall_h + 0.35
    for sx in (-0.55, 0.55):
        B.box(pal['stone2'], 0.34, gh, 0.52, sx, 0, half)
    B.box(pal['stone2'], 1.44, 0.24, 0.52, 0, gh - 0.24, half)
    B.box(pal['dark'], 0.74, gh - 0.3, 0.06, 0, 0, half + 0.24)
    # the keep: one big block, one smaller crowning block with the roof
    kw = 1.8 if t == 2 else 2.0
    kh = 2.1 if t == 2 else 2.6
    top = keep_block(B, G, pal, kw, kw, kh, base, roof='merlon', windows=0)
    door(B, pal, 0.42, 0.62, 0, kw / 2 + 0.01, base)
    for x in (-kw * 0.28, kw * 0.28):
        window(B, G, pal, x, base + kh * 0.55, kw / 2 + 0.01, w=0.16, h=0.24, shutters=False)
    B.box(pal['stone2'], kw + 0.06, 0.08, kw + 0.06, 0, base + kh * 0.42, 0)   # string course
    # portcullis bars in the gate
    for bx in (-0.24, -0.08, 0.08, 0.24):
        B.box(pal['steel'], 0.04, gh - 0.34, 0.03, bx, 0.02, half + 0.27)
    B.box(pal['steel'], 0.7, 0.04, 0.03, 0, (gh - 0.3) * 0.55, half + 0.27)
    if t >= 3:
        for (x, z) in corners[:2]:
            banner(B, pal, x, z, tower_h + 0.18 + tr * 2.1, 0.7, big=0.6)
    upper_w = kw * 0.6
    uh = 0.8 if t == 2 else 1.2
    top2 = keep_block(B, G, pal, upper_w, upper_w, uh, top, roof='pyramid', windows=0)
    banner(B, pal, 0, kw / 2 + 0.05, top, 1.4, big=1.25)
    if t >= 4:
        # citadel spire: a tall slender roofed tower rising from the keep
        B.prism(pal['stone'], 8, 0.34, 0.26, 1.6, 0, top2 + 0.3, 0)
        B.prism(pal['roof'], 8, 0.42, 0, 0.9, 0, top2 + 1.9, 0)
        # gold finial: the renderer's part_core (it turns slowly)
        core = k.part('part_core', origin=(0, top2 + 2.8, 0))
        core.prism(pal['trim'], 4, 0.07, 0, 0.4, 0, top2 + 2.8, 0)


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
    """Cottages that grow into a timbered townhouse: overhanging roofs,
    chimneys, framed lit windows with shutters, a flower box."""
    B, G = k.B, k.G
    B.box(pal['stone3'], 1.6, 0.1, 1.5, 0, 0, 0)
    if t == 1:
        B.box(pal['stone3'], 1.06, 0.14, 0.91, 0, 0.1, 0)                    # foundation course
        B.box(pal['stone'], 1.0, 0.55, 0.85, 0, 0.24, 0)
        for sx in (-1, 1):
            B.box(pal['wood'], 0.06, 0.55, 0.06, sx * 0.48, 0.24, 0.41)      # corner posts
        B.gable(pal['roof'], 1.0, 0.52, 0.85, 0, 0.79, 0, ry=math.pi / 2, overhang=0.14)
        ridge(B, pal, 1.0, 1.29, ry=math.pi / 2, length=1.2)
        chimney(B, pal, -0.3, 0.95, -0.2, h=0.42)
        door(B, pal, 0.2, 0.36, 0.2, 0.43, 0.24)
        window(B, G, pal, -0.22, 0.48, 0.43)
        flower_box(B, pal, -0.22, 0.39, 0.43)
        B.box(pal['wood'], 0.26, 0.2, 0.26, 0.6, 0.1, 0.5)                   # woodpile
        B.box(shade(pal['wood'], 0.8), 0.3, 0.06, 0.3, 0.6, 0.3, 0.5)
        return
    if t == 2:
        B.box(pal['stone3'], 1.21, 0.12, 1.01, 0, 0.1, 0)
        B.box(pal['stone2'], 1.15, 0.6, 0.95, 0, 0.22, 0)                    # stone ground floor
        B.box(pal['stone'], 1.25, 0.62, 1.05, 0, 0.82, 0)                    # jettied upper floor
        timber_front(B, pal, 1.25, 0.82, 1.44, 0.53, posts=4)
        B.gable(pal['roof'], 1.25, 0.62, 1.05, 0, 1.44, 0, ry=math.pi / 2, overhang=0.15)
        ridge(B, pal, 1.25, 2.06, ry=math.pi / 2, length=1.45)
        chimney(B, pal, 0.38, 1.6, -0.25, h=0.62)
        door(B, pal, 0.22, 0.4, 0, 0.48, 0.22)
        for x in (-0.36, 0.36):
            window(B, G, pal, x, 0.36, 0.48, shutters=False)
            window(B, G, pal, x, 1.04, 0.53)
        flower_box(B, pal, -0.36, 0.95, 0.53)
        flower_box(B, pal, 0.36, 0.95, 0.53)
        return
    if t == 3:
        B.box(pal['stone3'], 1.26, 0.12, 0.86, -0.1, 0.1, -0.25)
        B.box(pal['stone'], 1.2, 1.2, 0.8, -0.1, 0.2, -0.25)
        timber_front(B, pal, 1.2, 0.78, 1.4, 0.16, posts=3)
        B.gable(pal['roof'], 1.2, 0.6, 0.8, -0.1, 1.4, -0.25, ry=math.pi / 2, overhang=0.14)
        ridge(B, pal, 1.2, 2.0, z=-0.25, ry=math.pi / 2, length=1.4)
        B.box(pal['stone'], 0.6, 0.9, 0.7, 0.35, 0.2, 0.35)
        B.gable(pal['roof2'], 0.6, 0.45, 0.7, 0.35, 1.1, 0.35, overhang=0.12)
        chimney(B, pal, -0.5, 1.55, -0.45, h=0.55)
        round_tower(B, G, pal, -0.6, 0.35, 0.22, 1.6)
        door(B, pal, 0.22, 0.4, 0.35, 0.71, 0.2)
        window(B, G, pal, 0.35, 0.82, 0.71, shutters=False)
        for x in (-0.45, 0.1):
            window(B, G, pal, x, 0.95, 0.16)
        flower_box(B, pal, 0.1, 0.86, 0.16)
        return
    # t4: tall timbered townhouse — three storeys, a dormer, two chimneys
    B.box(pal['stone3'], 1.26, 0.14, 1.11, 0, 0.1, 0)
    B.box(pal['stone2'], 1.2, 0.75, 1.05, 0, 0.24, 0)
    B.box(pal['stone'], 1.3, 1.4, 1.12, 0, 0.99, 0)
    timber_front(B, pal, 1.3, 0.99, 1.69, 0.565, posts=4)
    timber_front(B, pal, 1.3, 1.69, 2.39, 0.565, posts=4)
    for y in (0.99, 1.69):
        B.box(pal['stone2'], 1.36, 0.08, 1.18, 0, y - 0.04, 0)
    for x in (-0.36, 0.0, 0.36):
        window(B, G, pal, x, 1.2, 0.565)
        window(B, G, pal, x, 1.9, 0.565, shutters=False)
    for x in (-0.36, 0.36):
        window(B, G, pal, x, 0.5, 0.53, shutters=False)
    B.gable(pal['roof'], 1.3, 0.66, 1.12, 0, 2.39, 0, ry=math.pi / 2, overhang=0.16)
    ridge(B, pal, 1.3, 3.05, ry=math.pi / 2, length=1.5)
    B.box(pal['stone'], 0.34, 0.3, 0.3, 0, 2.45, 0.42)                     # dormer
    B.gable(pal['roof2'], 0.34, 0.2, 0.34, 0, 2.75, 0.42, overhang=0.06)
    window(B, G, pal, 0, 2.52, 0.575, w=0.12, h=0.14, shutters=False, sill=False)
    chimney(B, pal, 0.42, 2.55, -0.3, h=0.7)
    chimney(B, pal, -0.42, 2.55, -0.3, h=0.55)
    door(B, pal, 0.24, 0.45, 0, 0.53, 0.24)
    banner(B, pal, 0.72, 0.4, 0.9, 1.0, big=0.7)


# ---------------------------------------------------------------- farm

def farm(k, t, pal):
    B, G = k.B, k.G
    B.box(pal['field'], 1.85, 0.08, 1.85, 0, 0, 0)
    rows = 4 if t == 1 else 5
    for i in range(rows):
        z = -0.75 + i * (1.5 / (rows - 1))
        c = pal['crop'] if (i + t) % 2 else pal['crop2']
        B.box(c, 1.1 if t < 3 else 0.9, 0.16, 0.2, -0.3 if t < 3 else -0.45, 0.08, z)
    # split-rail fence on three sides
    for x in (-0.88, 0.88):
        for z in (-0.88, 0, 0.88):
            B.box(pal['wood'], 0.06, 0.28, 0.06, x, 0.08, z)
        B.box(shade(pal['wood'], 0.9), 0.04, 0.04, 1.8, x, 0.26, 0)
    for z in (-0.88,):
        for x in (-0.44, 0.44):
            B.box(pal['wood'], 0.06, 0.28, 0.06, x, 0.08, z)
        B.box(shade(pal['wood'], 0.9), 1.8, 0.04, 0.04, 0, 0.26, z)
    if t == 1:
        B.box(pal['wood'], 0.4, 0.35, 0.4, 0.62, 0.08, 0.55)
        B.gable(pal['roof'], 0.4, 0.24, 0.4, 0.62, 0.43, 0.55, overhang=0.1)
        B.box(pal['dark'], 0.14, 0.22, 0.03, 0.62, 0.08, 0.76)
        # scarecrow
        B.box(pal['wood'], 0.04, 0.6, 0.04, -0.62, 0.08, 0.62)
        B.box(pal['wood'], 0.4, 0.04, 0.04, -0.62, 0.48, 0.62)
        B.box(pal['accent'], 0.16, 0.18, 0.08, -0.62, 0.36, 0.62)
        B.box(0xe9cf8a, 0.12, 0.12, 0.12, -0.62, 0.56, 0.62)
        B.prism(pal['wood'], 6, 0.12, 0, 0.1, -0.62, 0.68, 0.62)
        return
    # barn + silo
    B.box(pal['accent'], 0.6, 0.55, 0.75, 0.55, 0.08, 0.3)
    B.gable(pal['roof2'], 0.6, 0.35, 0.75, 0.55, 0.63, 0.3, overhang=0.1)
    B.box(pal['stone'], 0.26, 0.34, 0.04, 0.55, 0.08, 0.68)                 # barn door + white X
    B.box(pal['stone'], 0.04, 0.4, 0.05, 0.55, 0.06, 0.69, 0, 0, 0.6)
    B.box(pal['stone'], 0.04, 0.4, 0.05, 0.55, 0.06, 0.69, 0, 0, -0.6)
    B.box(pal['dark'], 0.12, 0.12, 0.04, 0.55, 0.5, 0.68)                   # hayloft
    for (hx, hz) in ((-0.15, 0.72), (0.12, 0.8)):                           # haystacks
        B.prism(pal['crop2'], 6, 0.14, 0.1, 0.16, hx, 0.08, hz)
        B.prism(shade(pal['crop2'], 0.9), 6, 0.1, 0, 0.1, hx, 0.24, hz)
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
    B.box(pal['stone3'], hall_w + 0.06, 0.12, 0.81, 0, 0.1, -0.45)          # foundation course
    B.gable(col, hall_w, 0.42, 0.75, 0, rh, -0.45, ry=math.pi / 2, overhang=0.14)
    B.box(shade(col, 0.7), 0.06, 0.05, hall_w + 0.3, 0, rh + 0.42, -0.45, 0, math.pi / 2, 0)
    chimney(B, pal, hall_w * 0.32, rh + 0.1, -0.62, h=0.4, w=0.16)
    door(B, pal, 0.26, 0.45, 0, -0.07, 0.1)
    for sx in (-1, 1):
        window(B, G, pal, sx * hall_w * 0.32, 0.42, -0.07, w=0.12, h=0.14, shutters=False)
    # shield over the door in the trade colour
    B.box(pal['trim'], 0.2, 0.2, 0.03, 0, rh - 0.2, -0.065)
    B.box(col, 0.15, 0.15, 0.04, 0, rh - 0.175, -0.06)
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
# Each hero is a chibi rider with a big readable face. Scott, Alexander and
# Daniel ride hoverbikes. Turtle, John and Tiger do too. Aaron rides a disc.
# Colours are each hero's config armour and trim. Props are the kit they
# already fight with, drawn big enough to name from the game camera.
# Scott: heavy bike, round helm, gravity maul.
# Alexander: long lancer, crown, rail rifle, banner.
# Daniel: low finned bike, hood, visor, crossed blades.
# Turtle: widest sled, bone shell, tower shield, mace.
# John: short sled, ivory plate, powerfists, keg, crest.
# Tiger: longest low bike, ear fins, stripes, twin blades.
# Aaron: gold-rimmed disc, open hood, robe, crystal staff.

HERO_LOOK = {
    'scott': {'main': 0xb32020, 'trim': 0xf4f1e8, 'bike': 0x3a3f4c, 'glow': 0xff8a5c,
              'cape': 0x7a1414, 'hair': 0x6b3f22},
    'alexander': {'main': 0x2f8f46, 'trim': 0xf3c53d, 'bike': 0xeee5cf, 'glow': 0x8ff3ff,
                  'cape': 0x1f6a33, 'hair': 0x3a2a1c},
    # Daniel stays the hooded shadow, but in bright cobalt with slate-blue
    # leathers and a silver hood rim so he reads at game zoom (v5).
    'danny': {'main': 0x3a8ef0, 'trim': 0x3a4866, 'bike': 0x5a6c90, 'glow': 0x7dffb2,
              'cape': 0x2a66c8, 'hair': 0x3a4866, 'rim': 0xdce8f8},
    'turtle': {'main': 0x3f6b5e, 'trim': 0xb8ae86, 'bike': 0x2a4038, 'glow': 0x8fd0ff,
               'cape': 0x2c4a40, 'hair': 0x3a2e24},
    'john': {'main': 0x3a3a3f, 'trim': 0xf0ece0, 'bike': 0x2c2c30, 'glow': 0xffb347,
             'cape': 0x2a2a2e, 'hair': 0xd23b32},
    'tiger': {'main': 0xd8721f, 'trim': 0x1c1a18, 'bike': 0x3a2a18, 'glow': 0xffa64d,
              'cape': 0x1c1a18, 'hair': 0x1c1a18},
    'aaron': {'main': 0x6a4fae, 'trim': 0xf0d060, 'bike': 0x3a3058, 'glow': 0x8fd6ff,
              'cape': 0x4a3488, 'hair': 0xd9d3c8},
}


def pal_dark():
    return 0x23262e


def _bike(B, G, look, length, width, height, nose, style):
    """Hoverbike: hull, fairing with headlamp, saddle, side pods with hover
    glow, tail fender and exhausts. style picks the silhouette."""
    y0 = 0.22
    dk = pal_dark()
    hl = length / 2
    # hull, tapered: a wide mid block and a narrower tail
    B.box(look['bike'], width, height, length * 0.62, 0, y0, 0.02)
    B.box(shade(look['bike'], 0.82), width * 0.78, height * 0.86, length * 0.4, 0, y0 + 0.02, -hl + length * 0.2)
    # fairing + nose
    B.box(look['main'], width * 0.86, height * 0.7, nose, 0, y0 + height * 0.22, hl - nose / 2 + 0.04)
    B.prism(look['main'], 4, width * 0.42, 0, nose * 0.8, 0, y0 + height * 0.55, hl + nose * 0.32,
            rx=math.pi / 2, phase=math.pi / 4)
    G.box(0xfff4c8, width * 0.34, 0.07, 0.03, 0, y0 + height * 0.5, hl + 0.06)      # headlamp
    # windscreen
    B.box(shade(look['glow'], 0.55), width * 0.6, 0.16, 0.03, 0, y0 + height + 0.02, hl - nose - 0.02, -0.5, 0, 0)
    # trim stripe and saddle
    B.box(look['trim'], width + 0.03, 0.045, length * 0.66, 0, y0 + height * 0.62, 0.0)
    B.box(dk, width * 0.5, 0.07, 0.34, 0, y0 + height, -0.14)
    # handlebar
    B.box(dk, 0.56 * width + 0.12, 0.045, 0.05, 0, y0 + height + 0.16, hl - nose - 0.12)
    for sx in (-1, 1):
        B.box(dk, 0.05, 0.18, 0.05, sx * width * 0.22, y0 + height, hl - nose - 0.12, -0.3, 0, 0)
    # side pods with hover glow
    pod = 0.13 if style == 'heavy' else 0.09
    for sx in (-1, 1):
        B.box(shade(look['bike'], 0.7), pod, 0.14, length * 0.72, sx * (width / 2 + pod / 2), y0 - 0.05, -0.02)
        G.box(look['glow'], pod * 0.8, 0.03, length * 0.56, sx * (width / 2 + pod / 2), y0 - 0.07, -0.02)
        # exhausts
        B.prism(dk, 6, 0.045, 0.04, 0.16, sx * width * 0.26, y0 + height * 0.35, -hl - 0.02, rx=math.pi / 2)
        G.box(look['glow'], 0.05, 0.05, 0.02, sx * width * 0.26, y0 + height * 0.33, -hl - 0.17)
    G.box(look['glow'], width * 0.7, 0.03, length * 0.78, 0, 0.1, -0.02)            # hover wash
    # tail fender
    B.box(look['main'], width * 0.7, 0.05, 0.22, 0, y0 + height * 0.9, -hl + 0.06, 0.25, 0, 0)
    if style == 'heavy':
        # bull bar and armour plates
        B.box(look['trim'], width + 0.1, 0.06, 0.06, 0, y0 + 0.02, hl + 0.06)
        for sx in (-1, 1):
            B.box(shade(look['main'], 0.85), 0.05, height * 0.8, length * 0.34, sx * (width / 2 + 0.01), y0 + 0.04, 0.12)
    elif style == 'lancer':
        # long nose spike and a gold fin
        B.prism(look['trim'], 4, 0.04, 0, 0.36, 0, y0 + height * 0.5, hl + nose * 0.5, rx=math.pi / 2, phase=math.pi / 4)
        B.box(look['trim'], 0.03, 0.16, 0.32, 0, y0 + height, -hl + 0.2, 0.3, 0, 0)
    elif style == 'stealth':
        # swept stealth fins and blade vanes
        for sx in (-1, 1):
            B.box(look['main'], 0.03, 0.24, 0.32, sx * width * 0.36, y0 + height * 0.8, -hl + 0.16, 0.5, 0, sx * 0.45)
            B.box(look['trim'], 0.2, 0.02, 0.36, sx * (width / 2 + 0.12), y0 + 0.04, 0.1, 0, sx * 0.3, 0)
    elif style == 'shell':
        # blunt armoured skirts. No bull bar — that silhouette is Scott's.
        for sx in (-1, 1):
            B.box(shade(look['main'], 0.75), 0.07, height * 0.85, length * 0.62,
                  sx * (width / 2 + 0.02), y0, 0.0)
        B.box(look['trim'], width * 0.55, 0.05, 0.08, 0, y0 + 0.01, hl + 0.02)
    elif style == 'brawler':
        # short pub sled: an ivory centre stripe, no bull bar
        B.box(look['trim'], 0.045, height * 0.95, length * 0.58, 0, y0, 0.02)
        B.box(look['trim'], width + 0.04, 0.035, length * 0.42, 0, y0 + height * 0.2, 0.06)


def _rider(B, G, pal, look, seat, wide=1.0, boot=None):
    """Seated rider, chibi proportions: short legs tucked onto the pegs, a
    tapered eight-sided torso, belt. Returns the neck height."""
    boot = boot or pal_dark()
    for sx in (-1, 1):
        B.prism(shade(look['main'], 0.7), 6, 0.065 * wide, 0.06 * wide, 0.3, sx * 0.12 * wide, seat - 0.06, -0.12,
                rx=math.pi / 2 - 0.15)                                                        # thigh
        B.prism(boot, 6, 0.06 * wide, 0.07 * wide, 0.24, sx * 0.13 * wide, seat - 0.36, 0.17, rx=-0.2)  # shin+boot
    B.prism(pal_dark(), 8, 0.17 * wide, 0.17 * wide, 0.07, 0, seat - 0.03, -0.1, phase=math.pi / 8)   # belt
    B.box(look['trim'], 0.08, 0.06, 0.03, 0, seat - 0.02, 0.06)                                     # buckle
    B.prism(look['main'], 8, 0.16 * wide, 0.2 * wide, 0.3, 0, seat + 0.04, -0.1, phase=math.pi / 8)  # torso
    B.box(shade(look['main'], 1.22), 0.2 * wide, 0.17, 0.04, 0, seat + 0.1, 0.07)                   # chest plate
    return seat + 0.34


HEAD_R = 0.175


def _head(B, pal, y, z, r=HEAD_R, eyes=0x1b1d24, skin=None):
    """Big readable toy head: a chamfered eight-sided block, flat face to the
    front, two tall eyes, a nose and rosy cheeks."""
    skin = skin or pal['skin']
    ph = math.pi / 8
    B.prism(shade(skin, 0.92), 8, r * 0.78, r, r * 0.45, 0, y, z, phase=ph)          # jaw
    B.prism(skin, 8, r, r, r * 0.9, 0, y + r * 0.45, z, phase=ph)                     # cranium
    B.prism(skin, 8, r, r * 0.72, r * 0.25, 0, y + r * 1.35, z, phase=ph)             # crown
    fz = z + r * math.cos(ph)
    for sx in (-1, 1):
        B.box(eyes, 0.05, 0.075, 0.02, sx * r * 0.36, y + r * 0.78, fz)
        B.box(0xffffff, 0.018, 0.022, 0.022, sx * r * 0.36 + 0.012, y + r * 0.78 + 0.04, fz + 0.002)
        B.box(0xe89a8a, 0.05, 0.025, 0.015, sx * r * 0.56, y + r * 0.55, fz)          # cheeks
    B.box(shade(skin, 0.82), 0.045, 0.05, 0.035, 0, y + r * 0.58, fz)                  # nose
    return y + r * 1.6, fz


def _cape(B, look, top, z, w, length, sway=0.0):
    """Two-panel cape from the shoulders, flaring back."""
    B.box(look['cape'], w, length * 0.55, 0.035, 0, top - length * 0.55, z, -0.18, 0, sway)
    B.box(shade(look['cape'], 0.85), w * 1.12, length * 0.5, 0.035, 0, top - length * 1.0, z - 0.1, -0.42, 0, sway)


def _pauldron(B, c, x, y, z, r):
    B.ico(c, r, x, y, z, sy=0.7, sub=1)


def hero(k, key, pal):
    B, G = k.B, k.G
    look = HERO_LOOK[key]
    dk = pal_dark()
    hz = -0.1                                       # head z (over the torso)
    fist_c, fist_r = look['trim'], None
    if key == 'scott':
        # The brawler: a broad red knight on a heavy armoured bike. A round
        # red great-helm with an open face, white crest, bushy beard, big
        # round pauldrons and the gravity maul across his back.
        _bike(B, G, look, 1.02, 0.5, 0.27, 0.28, 'heavy')
        seat = 0.52
        neck = _rider(B, G, pal, look, seat, wide=1.25)
        for sx in (-1, 1):
            _pauldron(B, look['trim'], sx * 0.26, neck - 0.05, -0.1, 0.12)
            B.box(look['main'], 0.05, 0.05, 0.16, sx * 0.3, neck - 0.04, -0.1)
        top, fz = _head(B, pal, neck, hz, r=0.18)
        ph = math.pi / 8
        # helm: a band round the head and a dome over it, face left open
        B.prism(look['main'], 8, 0.2, 0.2, 0.1, 0, neck + 0.2, hz - 0.02, phase=ph)
        B.prism(look['main'], 8, 0.2, 0.08, 0.14, 0, neck + 0.3, hz - 0.02, phase=ph)
        B.box(look['main'], 0.36, 0.24, 0.12, 0, neck - 0.02, hz - 0.14)              # neck guard
        G.box(look['glow'], 0.3, 0.03, 0.02, 0, neck + 0.215, fz + 0.03)            # brow band
        B.box(look['trim'], 0.06, 0.12, 0.36, 0, neck + 0.38, hz - 0.04)             # crest
        # beard: a big bushy block under the face
        B.box(look['hair'], 0.3, 0.12, 0.1, 0, neck - 0.02, fz - 0.02)
        B.box(look['hair'], 0.2, 0.08, 0.08, 0, neck - 0.08, fz)
        B.box(look['hair'], 0.14, 0.03, 0.02, 0, neck + 0.085, fz + 0.01)           # moustache
        _cape(B, look, neck - 0.02, -0.28, 0.4, 0.38)
        B.box(dk, 0.06, 0.86, 0.06, 0.04, seat - 0.05, -0.34, -0.15, 0, -0.75)      # maul haft
        B.box(look['bike'], 0.36, 0.24, 0.24, 0.36, seat + 0.5, -0.42, 0, 0, -0.75)
        B.box(look['trim'], 0.4, 0.05, 0.27, 0.36, seat + 0.5, -0.42, 0, 0, -0.75)
        G.box(0x7a9cf0, 0.04, 0.16, 0.2, 0.52, seat + 0.62, -0.42, 0, 0, -0.75)
        arm_w, arm_c, sh = 0.14, look['main'], 0.29
    elif key == 'alexander':
        # The crowned rifleman: a long cream-and-green racer; bare head with
        # dark hair under a gold crown and red plume, a flowing green cape,
        # the rail rifle and his house banner.
        _bike(B, G, look, 1.32, 0.38, 0.2, 0.42, 'lancer')
        seat = 0.46
        neck = _rider(B, G, pal, look, seat)
        for sx in (-1, 1):
            _pauldron(B, look['trim'], sx * 0.2, neck - 0.05, -0.1, 0.09)
        top, fz = _head(B, pal, neck, hz)
        ph = math.pi / 8
        # hair: a cap over the crown, a fringe and short sides
        B.prism(look['hair'], 8, HEAD_R * 1.04, HEAD_R * 0.8, 0.09, 0, neck + 0.24, hz - 0.01, phase=ph)
        B.box(look['hair'], 0.3, 0.05, 0.05, 0, neck + 0.215, fz - 0.01)
        for sx in (-1, 1):
            B.box(look['hair'], 0.04, 0.14, 0.24, sx * HEAD_R * 0.98, neck + 0.12, hz - 0.03)
        B.box(look['hair'], 0.3, 0.16, 0.06, 0, neck + 0.1, hz - HEAD_R)
        # crown: gold band and five points
        B.prism(look['trim'], 8, HEAD_R * 0.98, HEAD_R * 0.98, 0.06, 0, neck + 0.29, hz - 0.01, phase=ph)
        for q in range(5):
            a = math.pi / 2 + (q - 2) * 0.62
            B.prism(look['trim'], 4, 0.035, 0, 0.1 if q != 2 else 0.14,
                    math.cos(a) * HEAD_R * 0.92, neck + 0.35, hz - 0.01 + math.sin(a) * HEAD_R * 0.92, phase=math.pi / 4)
        G.box(0xff5a6a, 0.04, 0.04, 0.02, 0, neck + 0.31, fz + 0.005)               # crown jewel
        B.box(0xc4473b, 0.05, 0.2, 0.16, 0.08, neck + 0.32, hz - 0.12, 0.6, 0, -0.2)   # plume
        _cape(B, look, neck - 0.02, -0.26, 0.38, 0.6, sway=0.08)
        B.box(look['trim'], 0.38, 0.04, 0.04, 0, neck - 0.05, -0.25)                # clasp bar
        B.box(dk, 0.06, 0.06, 1.0, -0.22, seat + 0.16, -0.27, 0.5, 0, 0)            # rail rifle
        G.box(look['glow'], 0.03, 0.03, 0.4, -0.22, seat + 0.22, -0.17, 0.5, 0, 0)
        banner(B, pal, 0.19, -0.64, 0.4, 1.15, color=look['main'])
        arm_w, arm_c, sh = 0.11, look['main'], 0.23
    elif key == 'danny':
        # The shadow: low finned stealth bike; a deep blue hood framing a
        # dark face mask with a glowing green visor slit, scarf streaming,
        # twin blades crossed on his back.
        _bike(B, G, look, 1.16, 0.34, 0.16, 0.36, 'stealth')
        seat = 0.4
        neck = _rider(B, G, pal, look, seat, boot=look['trim'])
        top, fz = _head(B, pal, neck, hz, skin=0x55627e, eyes=0x55627e)
        ph = math.pi / 8
        # hood: an eight-sided cowl a size bigger than the head, open at the
        # front, drawn to a soft point behind
        r = HEAD_R * 1.18
        B.prism(look['main'], 8, r, r * 1.02, 0.2, 0, neck - 0.02, hz - 0.03, phase=ph, sz=1.0)
        B.prism(look['main'], 8, r * 1.02, r * 0.55, 0.2, 0, neck + 0.18, hz - 0.05, phase=ph)
        B.prism(look['main'], 6, r * 0.5, 0.0, 0.14, 0, neck + 0.36, hz - 0.1, rx=-0.5)
        B.box(look['main'], 0.32, 0.36, 0.1, 0, neck - 0.02, hz - 0.15)             # hood back
        B.prism(look['rim'], 8, r * 1.05, r * 1.05, 0.035, 0, neck + 0.17, hz - 0.04, phase=ph)  # silver hood rim
        # the face opening: slate mask with a bright visor across the eyes
        B.box(0x2c3852, 0.24, 0.2, 0.03, 0, neck + 0.04, fz + 0.012)
        G.box(look['glow'], 0.24, 0.05, 0.02, 0, neck + 0.14, fz + 0.03)
        B.box(look['cape'], 0.3, 0.08, 0.08, 0, neck - 0.04, fz - 0.03)              # scarf wrap
        B.box(look['cape'], 0.09, 0.04, 0.44, 0.07, neck - 0.04, -0.46, 0.35, 0.2, 0)  # scarf tails
        B.box(look['cape'], 0.08, 0.04, 0.32, 0.13, neck - 0.15, -0.74, 0.55, 0.35, 0)
        for sx in (-1, 1):                                                           # crossed blades
            B.box(0xd8dde6, 0.04, 0.66, 0.04, sx * 0.08, seat + 0.02, -0.3, -0.25, 0, sx * 0.55)
            G.box(look['glow'], 0.02, 0.44, 0.02, sx * 0.08, seat + 0.14, -0.31, -0.25, 0, sx * 0.55)
            B.box(look['trim'], 0.12, 0.03, 0.06, sx * 0.08, seat + 0.0, -0.3, -0.25, 0, sx * 0.55)
        arm_w, arm_c, sh = 0.1, look['trim'], 0.21
        fist_c = look['main']
    elif key == 'turtle':
        # The wall: the widest sled, a bone carapace behind a bare face, a
        # tower shield on the left and a mace on the right. The shell brim
        # sits behind the eyes so the face stays the readable part.
        _bike(B, G, look, 0.9, 0.62, 0.2, 0.22, 'shell')
        seat = 0.5
        neck = _rider(B, G, pal, look, seat, wide=1.42)
        for sx in (-1, 1):
            _pauldron(B, look['trim'], sx * 0.3, neck - 0.04, -0.08, 0.11)
        top, fz = _head(B, pal, neck, hz, r=0.18)
        ph = math.pi / 8
        B.prism(look['trim'], 8, 0.3, 0.3, 0.05, 0, neck + 0.2, hz - 0.07, phase=ph, sz=0.6)  # shell brim
        B.prism(look['main'], 8, 0.16, 0.07, 0.12, 0, neck + 0.24, hz - 0.05, phase=ph)       # cap
        B.prism(look['trim'], 8, 0.2, 0.22, 0.06, 0, neck - 0.08, hz - 0.02, phase=ph)        # gorget
        # Carapace sits behind the face and rises beside the head, so the
        # dome reads from the high follow camera.
        B.ico(look['trim'], 0.42, 0, seat + 0.34, -0.42, sx=1.35, sy=0.7, sz=0.75, sub=1)
        B.box(shade(look['trim'], 0.7), 0.07, 0.09, 0.5, 0, seat + 0.58, -0.42)              # scutes
        B.box(shade(look['trim'], 0.7), 0.72, 0.09, 0.07, 0, seat + 0.58, -0.42)
        B.box(shade(look['trim'], 0.78), 0.1, 0.22, 0.16, -0.5, seat + 0.28, -0.42)
        B.box(shade(look['trim'], 0.78), 0.1, 0.22, 0.16, 0.5, seat + 0.28, -0.42)
        # tower shield: bone rim, lighter teal face, cyan ward core
        B.box(look['trim'], 0.54, 0.88, 0.05, -0.4, seat - 0.38, 0.14)
        B.box(shade(look['main'], 1.35), 0.42, 0.72, 0.06, -0.4, seat - 0.28, 0.18)
        B.box(look['trim'], 0.08, 0.66, 0.075, -0.4, seat - 0.24, 0.2)
        G.box(look['glow'], 0.12, 0.12, 0.03, -0.4, seat + 0.02, 0.24)
        B.box(0x4a4034, 0.05, 0.05, 0.4, 0.34, seat + 0.12, 0.02)                            # mace haft
        B.ico(0xc5ccd0, 0.11, 0.34, seat + 0.16, 0.28, sub=1)
        arm_w, arm_c, sh = 0.15, look['main'], 0.34
    elif key == 'john':
        # The brawler: charcoal plate, an ivory chest, a red crest, powerfists
        # and the keg he cracks for Last Call. No beard — that read is Scott's.
        _bike(B, G, look, 0.78, 0.46, 0.24, 0.2, 'brawler')
        seat = 0.48
        neck = _rider(B, G, pal, look, seat, wide=1.16)
        top, fz = _head(B, pal, neck, hz, r=0.18)
        B.box(look['trim'], 0.26, 0.2, 0.05, 0, seat + 0.02, 0.1)                           # ivory chest
        for sx in (-1, 1):
            B.box(look['trim'], 0.14, 0.05, 0.16, sx * 0.16, neck - 0.06, -0.02)            # white yokes
        B.box(look['hair'], 0.055, 0.24, 0.36, 0, neck + 0.24, hz - 0.02)                   # crest
        # Keg rides the right shoulder, beside the head, where the follow
        # camera can see it. A keg centred on the back disappears behind him.
        B.prism(0x6b5334, 8, 0.15, 0.14, 0.38, 0.36, seat + 0.18, -0.08)
        B.prism(0x3a3d42, 8, 0.16, 0.16, 0.045, 0.36, seat + 0.18, -0.08)
        B.prism(0x3a3d42, 8, 0.16, 0.16, 0.045, 0.36, seat + 0.52, -0.08)
        G.box(look['glow'], 0.08, 0.045, 0.08, 0.36, seat + 0.57, -0.08)                    # bung
        arm_w, arm_c, sh = 0.13, look['main'], 0.28
        fist_c, fist_r = 0xd8d4cc, 0.13
    elif key == 'tiger':
        # The pack leader: the longest, lowest bike, black stripes over
        # orange, ear fins, and two blades rising in a V. The face stays
        # bare so he is not Daniel's hood.
        _bike(B, G, look, 1.4, 0.32, 0.15, 0.34, 'stealth')
        seat = 0.38
        neck = _rider(B, G, pal, look, seat, wide=0.9)
        top, fz = _head(B, pal, neck, hz)
        ph = math.pi / 8
        # Hair stays on the crown, behind the eyes, so the face stays the
        # bright part. Ears are the silhouette, with an orange inner.
        B.prism(look['hair'], 8, HEAD_R * 0.92, HEAD_R * 0.5, 0.07, 0, neck + 0.26, hz - 0.08, phase=ph, sz=0.7)
        for sx in (-1, 1):
            B.prism(look['trim'], 3, 0.07, 0.0, 0.2, sx * 0.13, neck + 0.3, hz - 0.02, rz=sx * -0.42)
            B.prism(look['main'], 3, 0.035, 0.0, 0.12, sx * 0.13, neck + 0.34, hz - 0.01, rz=sx * -0.42)
            B.box(look['trim'], 0.018, 0.055, 0.016, sx * 0.09, neck + 0.08, fz + 0.014)   # cheek stripes
        B.box(look['trim'], 0.3, 0.045, 0.06, 0, seat + 0.16, 0.07)                         # chest stripes
        B.box(look['trim'], 0.22, 0.04, 0.05, 0, seat + 0.08, 0.06)
        B.box(look['trim'], 0.07, 0.03, 0.55, 0.05, seat + 0.18, -0.48, 0.45, 0.2, 0)      # scarf tail
        for sx in (-1, 1):
            B.box(0xe7e1d4, 0.045, 0.78, 0.04, sx * 0.15, seat + 0.14, -0.16, -0.42, 0, sx * -0.2)
            G.box(look['glow'], 0.016, 0.52, 0.016, sx * 0.15, seat + 0.28, -0.14, -0.42, 0, sx * -0.2)
            B.box(look['trim'], 0.11, 0.05, 0.08, sx * 0.14, seat + 0.1, -0.12)
        arm_w, arm_c, sh = 0.1, look['main'], 0.2
    elif key == 'aaron':
        # The warlock: a gold-rimmed disc instead of a hull, an open violet
        # hood (the face stays skin, unlike Daniel's mask), a short white
        # beard, and a staff whose crystal clears the head.
        _disc_seat = 0.36
        dk = pal_dark()
        B.prism(look['trim'], 12, 0.5, 0.5, 0.04, 0, 0.08, 0)                               # gold rim
        B.prism(look['main'], 12, 0.42, 0.42, 0.07, 0, 0.12, 0)                             # disc
        B.prism(shade(look['main'], 0.72), 12, 0.2, 0.2, 0.05, 0, 0.19, -0.02)
        G.prism(look['glow'], 12, 0.55, 0.55, 0.02, 0, 0.05, 0)                             # ward ring
        G.box(look['glow'], 0.62, 0.02, 0.62, 0, 0.07, 0)
        B.box(dk, 0.22, 0.05, 0.26, 0, 0.28, -0.04)                                         # saddle
        B.box(dk, 0.34, 0.04, 0.04, 0, 0.46, 0.2)                                           # tiller
        for sx in (-1, 1):
            B.box(look['trim'], 0.04, 0.1, 0.04, sx * 0.15, 0.4, 0.2)
        seat = _disc_seat
        neck = _rider(B, G, pal, look, seat, wide=0.96)
        B.prism(look['cape'], 8, 0.34, 0.16, 0.3, 0, seat - 0.2, -0.06, phase=math.pi / 8)  # robe
        top, fz = _head(B, pal, neck, hz)
        ph = math.pi / 8
        r = HEAD_R * 1.12
        B.prism(look['main'], 8, r, r, 0.16, 0, neck + 0.02, hz - 0.07, phase=ph, sz=0.82)
        B.prism(look['main'], 8, r * 0.95, r * 0.4, 0.16, 0, neck + 0.16, hz - 0.09, phase=ph)
        B.box(look['main'], 0.3, 0.34, 0.08, 0, neck - 0.02, hz - 0.16)                     # hood back
        B.prism(look['trim'], 8, r * 1.04, r * 1.04, 0.03, 0, neck + 0.15, hz - 0.06, phase=ph, sz=0.88)
        B.box(look['hair'], 0.11, 0.07, 0.045, 0, neck + 0.005, fz - 0.005)                 # goatee
        B.box(look['hair'], 0.16, 0.02, 0.016, 0, neck + 0.17, fz + 0.01)                   # brows
        for sx in (-1, 1):
            G.octa(look['trim'], 0.04, 0.055, sx * 0.18, neck - 0.02, 0.0)
        B.prism(0x3a3040, 6, 0.04, 0.045, 0.7, 0.34, 0.15, 0.08)                             # staff shaft
        B.prism(look['trim'], 6, 0.045, 0.05, 0.55, 0.34, 0.82, 0.08)                        # gold upper staff
        G.octa(look['trim'], 0.14, 0.2, 0.34, 1.45, 0.08)                                    # crystal above the hood
        arm_w, arm_c, sh = 0.1, look['cape'], 0.22
    else:
        raise KeyError(key)
    for name, sx in (('arm_l', -1), ('arm_r', 1)):
        A = k.part(name, origin=(sx * sh, seat + 0.28, -0.08))
        A.prism(arm_c, 6, arm_w * 0.55, arm_w * 0.5, 0.36, sx * sh, seat + 0.24, -0.06, rx=math.pi / 2 + 0.35)
        A.ico(fist_c, fist_r if fist_r else arm_w * 0.6, sx * sh, seat + 0.12, 0.3, sub=1)
        if key == 'john':
            A.box(look['trim'], 0.2, 0.04, 0.06, sx * sh, seat + 0.14, 0.4)                 # knuckle bar
        if key == 'tiger':
            A.box(look['trim'], 0.11, 0.03, 0.12, sx * sh, seat + 0.26, 0.0)


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
