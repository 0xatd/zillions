"""European culture — the default kit.

A sci-fi knightly star-fortress: cream stone-and-steel walls, slate-blue
roofs, gold trim, blue-and-gold banners, cyan energy lamps. Allies wear the
same blue and gold so "your men" match "your castle" at a glance.

Original designs. Every builder takes (kit, tier, pal) and authors in game
space (metres = tiles, +z = front, origin at ground centre).
"""
import math

from kit import shade, xform
import combat

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
    # Corner buttresses and inset masonry establish weight at gameplay zoom.
    for sx in (-1, 1):
        for sz in (-1, 1):
            for course in range(4):
                B.box(pal['stone2'] if course % 2 else pal['stone3'],
                      .26, .24, .26, sx*.83, base+course*.27, sz*.78)
    if t == 1:
        # Asymmetric watch-tower and lower stair turret frame the great hall.
        # All bases remain inside the original plinth / occupied footprint.
        round_tower(B, G, pal, -1.12, -.68, .48, 3.45, crest=True)
        round_tower(B, G, pal, 1.02, -.60, .38, 2.55, crest=True)
        banner(B, pal, -1.12, -.68, 4.65, .8, big=.65)
        # A framed porch, not just a colored rectangle on a wall.
        for sx in (-.33, .33):
            B.box(pal['stone2'], .16, .9, .34, sx, base, .93)
        B.gable(pal['roof'], .8, .35, .55, 0, base+.9, .99, overhang=.1)
        for i in range(3):
            B.box(pal['stone2'], .7+i*.12, .08, .22, 0, base-.08*i, 1.2+i*.18)
    if t == 1:
        keep_block(B, G, pal, 1.7, 1.6, 1.8, base, roof='merlon', windows=0)
        painted_roof(B, pal, 1.9, .85, 1.8, y=base+1.92, overhang=.12)
        # Stone entrance gable and deep porch establish a civic front.
        B.box(pal['stone'], .72, 1.45, .35, 0, base, .83)
        B.gable(pal['roof'], .86, .52, .62, 0, base+1.45, .86, overhang=.08)
        for sx in (-.73, .73):
            B.box(pal['stone2'], .18, 1.7, .24, sx, base, .86)
        door(B, pal, 0.4, 0.6, 0, 0.81, base)
        for x in (-0.5, 0.5):
            window(B, G, pal, x, base + 1.0, 0.81, w=0.16, h=0.22)
        B.box(pal['stone2'], 1.76, 0.07, 1.66, 0, base + 0.75, 0)
        chimney(B, pal, -0.55, base + 1.9, -0.45, h=0.6, w=0.2)
        banner(B, pal, 1.15, 0.85, base, 1.6, flip=True)
        return
    # Upgrades keep the original hall-and-watchtower identity, then grow
    # the rear tower and stone wings. No miniature castle inside a castle.
    hall_h=2.0+.28*(t-2)
    B.box(pal['stone'],1.95,hall_h,1.85,0,base,0)
    painted_roof(B,pal,2.05,1.0+.1*t,1.95,y=base+hall_h,overhang=.12)
    for x,z,r,h in [(-1.12,-.67,.55,3.9+.45*(t-2)),(1.1,-.62,.42,3.0+.4*(t-2))]:
        round_tower(B,G,pal,x,z,r,h)
        for j in range(3):
            B.prism(pal['stone2'],8,r*1.03,r*1.03,.10,x,.7+j*.8,z)
    for x in (-.91,.91):
        B.box(pal['stone2'],.22,hall_h+.12,.3,x,base,.85)
        window(B,G,pal,x*.6,base+1.1,.94,w=.22,h=.42,shutters=False)
    B.box(pal['stone2'],1.0,1.25,.45,0,base,1.03)
    painted_roof(B,pal,1.1,.64,.65,y=base+1.25,z=1.02,overhang=.06)
    door(B,pal,.48,.85,0,1.27,base)
    for j in range(3):
        B.box(pal['stone2'],.90+j*.16,.1,.2,0,base-.1-j*.08,1.42+j*.16)
    banner(B,pal,-1.12,-.67,5.2+.45*(t-2),.9,big=.9)
    if t>=3:
        for x in (-1.55,1.55):
            B.box(pal['stone'],.42,.95,.9,x,base,.45)
            painted_roof(B,pal,.48,.52,.95,x=x,y=base+.95,z=.45,overhang=.06)
    if t>=4:
        core=k.part('part_core',origin=(1.1,5.1,-.62))
        core.octa(pal['glow'],.15,.35,1.1,5.1,-.62)


# ---------------------------------------------------------------- tower

def tower(k, t, pal):
    B, G = k.B, k.G
    # A defensive landmark from the first purchase, not a waist-high box.
    r = .68 + .035 * t
    h = 2.65 + .48 * (t - 1)
    top = round_tower(B, G, pal, 0, 0, r, h, roof=False, seg=10)
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        x, z = math.cos(a) * r, math.sin(a) * r
        B.prism(pal['stone3'], 4, .22, .14, h * .62, x, 0, z, phase=a)
        B.box(pal['stone2'], .16, .12, .16, x, h*.62, z)
    B.prism(pal['stone3'], 10, r*1.16, r*1.07, .28, 0, 0, 0)
    B.prism(pal['stone2'], 10, r*1.16, r*1.12, .18, 0, h-.2, 0)
    for y in (.75, 1.55):
        B.box(pal['dark'], .11, .35, .04, 0, y, r+.01)
        B.box(pal['stone2'], .22, .07, .09, 0, y+.35, r+.02)
    banner(B, pal, -.46, .58, 1.15, 1.2, big=.85)
    top += .22
    s = .95 + .08*t
    if t >= 3:
        G.prism(pal['glow'], 10, r*1.03, r*1.03, .06, 0, h*.7, 0)
    head = k.part('part_turret', origin=(0, top, 0))
    turret_head(head, pal, s, twin=t >= 3, coil=t >= 4, oy=top)


def painted_roof(B, pal, w, h, d, x=0, y=0, z=0, ry=0, overhang=0.14):
    """Curved slate courses and dimensional eaves in the shared body mesh."""
    hw, hd = w / 2 + overhang, d / 2 + overhang
    c, sn = math.cos(ry), math.sin(ry)
    def point(px, py, pz):
        return (x + px*c + pz*sn, y + py, z - px*sn + pz*c)
    def height(t):
        return h * (t ** 1.3)
    def strip(a, ya, b, yb, z0, z1, color, thickness=.055):
        verts = [point(a,ya,z0),point(b,yb,z0),point(b,yb,z1),point(a,ya,z1),
                 point(a,ya-thickness,z0),point(b,yb-thickness,z0),
                 point(b,yb-thickness,z1),point(a,ya-thickness,z1)]
        B.emit(verts,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),
                      (2,6,7,3),(3,7,4,0)],color,xform())
    for side in (-1,1):
        for row in range(5):
            t0,t1=row/5,min(1,(row+1)/5+.018)
            a,b=side*hw*(1-t0),side*hw*(1-t1)
            for col in range(5):
                z0=-hd+col*2*hd/5
                # Continuous coverage; seams come from relief, not holes.
                strip(a,height(t0)+.02,b,height(t1)+.02,z0,z0+2*hd/5,
                      shade(pal['roof'],.88+((row*7+col*3)%5)*.035))
            for pz in (-hd,hd):
                strip(a,height(t0)+.05,b,height(t1)+.05,pz-.035,pz+.035,
                      shade(pal['wood'],1.12),.09)
        for pz in (-hd+.01,hd-.01):
            vs=[point(side*hw,0,pz),point(0,0,pz)]
            vs += [point(side*hw*(1-i/5),height(i/5),pz) for i in range(5,0,-1)]
            B.emit(vs,[tuple(range(len(vs)))],pal['wood'],xform())
    B.box(pal['trim'],.09,.065,2*hd+.08,x,y+h,z,0,ry,0)


# ---------------------------------------------------------------- houses

def house(k, t, pal):
    """Weighty timber-and-stone homes with steep roofs and a front cross gable."""
    B, G = k.B, k.G
    h = 1.50 + .25*(t-1)
    B.prism(pal['stone3'], 4, 1.16, 1.10, .22, phase=math.pi/4, sz=.87)
    B.box(pal['stone'], 1.43, h, 1.23, 0, .22, -.08)
    B.box(pal['wood'], 1.48, .10, 1.27, 0, .22+h*.56, -.08)
    for x in (-.69, .69):
        for z in (-.66, .5):
            B.box(pal['wood'], .10, h, .10, x, .22, z)
            for j in range(3):
                B.box(pal['stone2'], .20, .13, .20, x, .22+j*.16, z)
    painted_roof(B, pal, 1.46, .88+.08*t, 1.26, y=h+.22, z=-.08, ry=math.pi/2, overhang=.14)
    # Porch gable breaks the repeated rectangular roof without growing collision.
    B.box(pal['stone2'], .62, 1.12, .34, .22, .22, .61)
    painted_roof(B, pal, .66, .48, .50, x=.22, y=1.34, z=.58, overhang=.07)
    door(B, pal, .34, .86, .22, .80, .22)
    for j in range(2):
        B.box(pal['stone2'], .62+j*.1, .10, .13, .22, .12-j*.06, .84+j*.1)
    window(B, G, pal, -.38, .62, .55, w=.23, h=.27)
    chimney(B, pal, -.42, h+.54, -.42, h=.85, w=.24)
    if t >= 2:
        for x in (-.4, .4):
            window(B, G, pal, x, h-.1, .55, w=.20, h=.25)
    if t >= 3:
        timber_front(B, pal, 1.43, .75, h+.18, .55, posts=4)
    if t >= 4:
        banner(B, pal, -.7, .54, .7, 1.35, big=.7)


# ---------------------------------------------------------------- farm

def farm(k,t,pal):
    B,G=k.B,k.G
    B.box(pal['field'],1.85,.07,1.85)
    # A barn and silo form one agricultural silhouette beside real crop rows.
    for row in range(4):
        z=-.68+row*.44
        B.box(shade(pal['field'],.8),.8,.05,.20,-.48,.07,z)
        for j in range(5):
            x=-.82+j*.16;h=.22+((j+row)%3)*.045
            B.prism(pal['crop'],4,.03,.01,h,x,.12,z)
            B.ico(pal['crop2'],.065,x,.12+h,z,sx=.7,sy=1.4,sz=.7,sub=0)
    h=.8+.18*t
    B.box(pal['stone3'],.77,.16,1.50,.48,.07,0)
    B.box(pal['wood'],.65,h,1.35,.48,.23,0)
    fp=dict(pal,roof=0xb09a62)
    painted_roof(B,fp,.72,.62,1.4,x=.48,y=.23+h,overhang=.07)
    B.box(pal['dark'],.35,.62,.035,.48,.23,.69)
    for x in (.28,.68):
        B.box(pal['stone2'],.07,.68,.06,x,.23,.71)
    B.box(pal['stone2'],.48,.07,.06,.48,.89,.71)
    if t>=2:
        B.prism(pal['stone'],8,.20,.20,1.4+.2*t,.75,.07,-.68)
        B.prism(pal['roof'],8,.23,0,.4,.75,1.47+.2*t,-.68)
    if t>=3:
        G.box(pal['glow'],.52,.06,.04,.48,1.1,.70)
    for z in (-.88,.88):
        for x in (-.88,-.12):
            B.box(pal['wood'],.06,.38,.06,x,.07,z)
        B.box(pal['wood'],.82,.06,.05,-.5,.33,z)


# ---------------------------------------------------------------- mill

def mill(k, t, pal):
    B, G = k.B, k.G
    h = {1: 2.1, 2: 2.65, 3: 3.2}[t]
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
    blade = {1: 1.05, 2: 1.20, 3: 1.35}[t]
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
    """Muster hall, side watch chamber and open front drill apron."""
    B, G = k.B, k.G
    col = CAMP_COLORS[trade]
    cp = dict(pal, roof=col)
    B.prism(pal['stone3'], 4, 1.34, 1.28, .22, phase=math.pi/4)
    h=1.15+.24*t
    B.box(pal['stone'], 1.45, h, 1.02, -.1, .22, -.30)
    painted_roof(B, cp, 1.5, .85, 1.08, x=-.1, y=h+.22, z=-.30, ry=math.pi/2, overhang=.12)
    for x in (-.78,.55):
        B.box(pal['stone2'], .17, h, .22, x, .22, .23)
    door(B, pal, .48, .82, -.1, .24, .22)
    # Different silhouette for each corps, not merely three roof colors.
    if trade=='militia':
        round_tower(B,G,pal,.58,-.54,.28,h+.65,roof=False)
    elif trade=='ranger':
        B.box(pal['wood'], .52, .12, .60, .52, h+.52, -.52)
        painted_roof(B,cp,.52,.65,.6,x=.52,y=h+.64,z=-.52,overhang=.05)
    else:
        round_tower(B,G,cp,.58,-.54,.25,h+1.0)
    for x in (-.64,.48):
        window(B,G,pal,x,.68,.24,w=.16,h=.28,shutters=False)
    banner(B,pal,-.80,.62,.22,1.8,color=col,big=.85)
    B.box(pal['wood'],.55,.08,.09,.38,.70,.65)
    for x in (.15,.62):
        B.box(pal['wood'],.07,.7,.07,x,.22,.65)
        B.box(pal['steel'],.04,.48,.05,x,.43,.68,0,0,.16)
    if t>=2:
        B.box(pal['steel'],.35,.35,.35,-.55,.22,.63)
    if t>=3:
        G.box(pal['glow'],1.2,.06,.05,-.1,1.1,.24)


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
    painted_roof(B, pal, 1.3, .72, .9, -.1, .95, -.3, ry=math.pi/2)
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
# Sculpted infantry keeps separate hip/shoulder pivots for runtime stride.

def trooper(k, pal):
    combat.infantry(k, pal, 'soldier')


def ranger(k, pal):
    combat.infantry(k, pal, 'ranger')


def marksman(k, pal):
    combat.infantry(k, pal, 'sniper')


# ---------------------------------------------------------------- heroes
#
# Each hero rides a hoverbike. Scott: a heavy brawler bike and gravity maul.
# Alexander: a long, sleek lancer bike with a slung rail rifle and banner.
# Daniel: a low, finned stealth bike with twin blades.

HERO_LOOK = {
    'scott': {'main': 0xb32020, 'trim': 0xf4f1e8, 'bike': 0x3a3f4c, 'glow': 0xff8a5c,
              'cape': 0x7a1414, 'hair': 0x6b3f22},
    'alexander': {'main': 0x2f8f46, 'trim': 0xf3c53d, 'bike': 0xeee5cf, 'glow': 0x8ff3ff,
                  'cape': 0x1f6a33, 'hair': 0x3a2a1c},
    # Daniel stays the hooded shadow, but in bright cobalt with slate-blue
    # leathers and a silver hood rim so he reads at game zoom (v5).
    'danny': {'main': 0x3a8ef0, 'trim': 0x3a4866, 'bike': 0x5a6c90, 'glow': 0x7dffb2,
              'cape': 0x2a66c8, 'hair': 0x3a4866, 'rim': 0xdce8f8},
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
    combat.armor(B, look['bike'], width, height, length * 0.72, 0, y0, 0.02)
    B.box(shade(look['bike'], 0.82), width * 0.78, height * 0.86, length * 0.4, 0, y0 + 0.02, -hl + length * 0.2)
    # fairing + nose
    combat.armor(B, look['main'], width * 0.86, height * 0.7, nose, 0, y0 + height * 0.22, hl - nose / 2 + 0.04)
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
    else:
        # swept stealth fins and blade vanes
        for sx in (-1, 1):
            B.box(look['main'], 0.03, 0.24, 0.32, sx * width * 0.36, y0 + height * 0.8, -hl + 0.16, 0.5, 0, sx * 0.45)
            B.box(look['trim'], 0.2, 0.02, 0.36, sx * (width / 2 + 0.12), y0 + 0.04, 0.1, 0, sx * 0.3, 0)


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
    combat.cloth(B, look['cape'], top, z, w, length)


def _pauldron(B, c, x, y, z, r):
    B.ico(c, r, x, y, z, sy=0.7, sub=1)


def hero(k, key, pal):
    B, G = k.B, k.G
    look = HERO_LOOK[key]
    dk = pal_dark()
    hz = -0.1                                       # head z (over the torso)
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
    else:
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
    for name, sx in (('arm_l', -1), ('arm_r', 1)):
        A = k.part(name, origin=(sx * sh, seat + 0.28, -0.08))
        A.prism(arm_c, 6, arm_w * 0.55, arm_w * 0.5, 0.36, sx * sh, seat + 0.24, -0.06, rx=math.pi / 2 + 0.35)
        A.ico(look['trim'] if key != 'danny' else look['main'], arm_w * 0.6, sx * sh, seat + 0.12, 0.3, sub=1)  # fist


# ---------------------------------------------------------------- enemies
#
# The hive: dark violet husks with glowing eyes; each type's accent colour
# rides the spines and plates so the roster reads apart. Arms are pivot-
# relative (origin at the shoulder line) for the instanced swing.

def enemy(k, key, accent):
    combat.enemy(k, key, accent)


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
