# Generate the colony material atlas + terrain grain. Painted-style luminance
# maps: near-neutral mean so they MULTIPLY under vertex colors — one atlas
# serves every hue in the palette. Deterministic (fixed seed).
import random, math
from PIL import Image, ImageDraw, ImageFilter

random.seed(77)
T = 256  # tile size
ATLAS = Image.new('RGB', (T * 4, T * 4), (232, 232, 232))

def value_noise(size, octaves=(4, 8, 16), amp=1.0):
    img = Image.new('L', (size, size), 128)
    for o in octaves:
        small = Image.new('L', (o, o))
        small.putdata([random.randint(0, 255) for _ in range(o * o)])
        layer = small.resize((size, size), Image.BILINEAR)
        img = Image.blend(img, layer, 0.5 / len(octaves) * amp * 2)
    return img

def edge_ao(draw, size, strength=52, width=26):
    # Darkened border with soft falloff: every mapped face gets contact AO.
    for i in range(width):
        a = int(strength * (1 - i / width) ** 2)
        draw.rectangle([i, i, size - 1 - i, size - 1 - i], outline=a)

def make_tile(kind):
    base = {'plate': 235, 'steel': 120, 'concrete': 205, 'solar': 228}[kind]
    img = Image.new('RGB', (T, T), (base, base, base))
    d = ImageDraw.Draw(img, 'RGB')
    px = img.load()

    # material grain
    noise = value_noise(T, (6, 12, 24), 1.0)
    npx = noise.load()
    for y in range(T):
        for x in range(T):
            n = (npx[x, y] - 128) / 128.0
            v = base + n * (10 if kind != 'steel' else 14)
            r = g = b = int(max(0, min(255, v)))
            px[x, y] = (r, g, b)

    d = ImageDraw.Draw(img, 'RGB')
    if kind == 'plate':
        # panel seams: dark cut + light bevel below/right
        seams_v = [70, 150, 210]
        seams_h = [88, 190]
        for sx in seams_v:
            d.line([(sx, 8), (sx, T - 8)], fill=(178, 178, 178), width=2)
            d.line([(sx + 2, 8), (sx + 2, T - 8)], fill=(250, 250, 250), width=1)
        for sy in seams_h:
            d.line([(8, sy), (T - 8, sy)], fill=(172, 172, 172), width=2)
            d.line([(8, sy + 2), (T - 8, sy + 2)], fill=(252, 252, 252), width=1)
        # rivets at intersections + corners of panels
        for sx in seams_v + [24, T - 24]:
            for sy in seams_h + [20, T - 20]:
                d.ellipse([sx - 3, sy - 3, sx + 3, sy + 3], fill=(196, 196, 196))
                d.ellipse([sx - 3, sy - 3, sx + 1, sy + 1], fill=(246, 246, 246))
        # grime streaks bleeding down from seams and rivets
        for _ in range(26):
            gx = random.randint(10, T - 10)
            gy = random.choice(seams_h + [random.randint(20, T - 60)])
            ln = random.randint(14, 60)
            wd = random.randint(2, 6)
            for yy in range(ln):
                a = (1 - yy / ln) * 26
                for xx in range(wd):
                    xxx = gx + xx - wd // 2
                    if 0 <= xxx < T and gy + yy < T:
                        r, g, b = px[xxx, gy + yy]
                        px[xxx, gy + yy] = (int(r - a), int(g - a), int(b - a))
        # scuffs: short light scratches
        for _ in range(14):
            x0, y0 = random.randint(8, T - 30), random.randint(8, T - 8)
            d.line([(x0, y0), (x0 + random.randint(6, 22), y0 - random.randint(0, 4))], fill=(250, 250, 250), width=1)
    elif kind == 'steel':
        # brushed horizontal + scratches + oil blotches
        for y in range(0, T, 2):
            v = 120 + random.randint(-9, 9)
            d.line([(0, y), (T, y)], fill=(v, v, v), width=1)
        for _ in range(22):
            x0, y0 = random.randint(4, T - 40), random.randint(4, T - 4)
            v = random.choice([88, 150, 165])
            d.line([(x0, y0), (x0 + random.randint(10, 36), y0)], fill=(v, v, v), width=1)
        for _ in range(6):
            x0, y0, r0 = random.randint(20, T - 20), random.randint(20, T - 20), random.randint(8, 22)
            for dy in range(-r0, r0):
                for dx in range(-r0, r0):
                    if dx * dx + dy * dy < r0 * r0:
                        xx, yy = x0 + dx, y0 + dy
                        if 0 <= xx < T and 0 <= yy < T:
                            r, g, b = px[xx, yy]
                            f = 1 - 0.12 * (1 - (dx * dx + dy * dy) / (r0 * r0))
                            px[xx, yy] = (int(r * f), int(g * f), int(b * f))
    elif kind == 'concrete':
        # pour lines, cracks, stains
        for sy in [64, 128, 192]:
            d.line([(4, sy), (T - 4, sy)], fill=(186, 186, 186), width=1)
        for _ in range(8):
            x, y = random.randint(10, T - 10), random.randint(10, T - 10)
            for _seg in range(random.randint(4, 9)):
                nx, ny = x + random.randint(-18, 18), y + random.randint(4, 16)
                d.line([(x, y), (nx, ny)], fill=(168, 168, 168), width=1)
                x, y = nx, ny
        for _ in range(10):
            x0, y0, r0 = random.randint(0, T), random.randint(0, T), random.randint(14, 40)
            for dy in range(-r0, r0):
                for dx in range(-r0, r0):
                    dd = dx * dx + dy * dy
                    if dd < r0 * r0:
                        xx, yy = (x0 + dx) % T, (y0 + dy) % T
                        r, g, b = px[xx, yy]
                        f = 1 - 0.08 * (1 - dd / (r0 * r0))
                        px[xx, yy] = (int(r * f), int(g * f), int(b * f))
    elif kind == 'solar':
        # photovoltaic cell grid + diagonal sheen
        for k in range(0, T, 32):
            d.line([(k, 4), (k, T - 4)], fill=(150, 150, 150), width=2)
            d.line([(4, k), (T - 4, k)], fill=(150, 150, 150), width=2)
        for y in range(T):
            for x in range(T):
                s = math.sin((x + y) * 0.02)
                if s > 0.6:
                    r, g, b = px[x, y]
                    a = int((s - 0.6) * 40)
                    px[x, y] = (min(255, r + a), min(255, g + a), min(255, b + a))

    d = ImageDraw.Draw(img, 'RGB')
    ao = Image.new('L', (T, T), 0)
    edge_ao(ImageDraw.Draw(ao), T, 60, 30)
    # subtract edge AO
    out = Image.new('RGB', (T, T))
    opx, ipx, apx = out.load(), img.load(), ao.load()
    for y in range(T):
        for x in range(T):
            r, g, b = ipx[x, y]
            a = apx[x, y]
            opx[x, y] = (max(0, r - a), max(0, g - a), max(0, b - a))
    return out

tiles = {'plate': (0, 0), 'steel': (1, 0), 'concrete': (2, 0), 'solar': (3, 0)}
for kind, (tx, ty) in tiles.items():
    ATLAS.paste(make_tile(kind), (tx * T, ty * T))
ATLAS = ATLAS.filter(ImageFilter.GaussianBlur(0.5))
ATLAS.save('/home/user/zillions/assets/textures/colony-atlas.png', optimize=True)
print('atlas saved')

# Terrain grain: tileable multi-octave mottle, near-white mean, subtle.
S = 512
random.seed(31)
g1 = value_noise(S, (8, 16, 32, 64), 1.2)
grain = Image.new('RGB', (S, S))
gp, np_ = grain.load(), g1.load()
for y in range(S):
    for x in range(S):
        n = (np_[x, y] - 128) / 128.0
        v = int(max(0, min(255, 236 + n * 26)))
        gp[x, y] = (v, v, v)
# speckle: sparse darker pips (pebble/soil grain)
for _ in range(2600):
    x, y = random.randint(0, S - 2), random.randint(0, S - 2)
    v = random.randint(190, 220)
    gp[x, y] = (v, v, v)
    if random.random() < 0.4:
        gp[x + 1, y] = (v + 8, v + 8, v + 8)
grain = grain.filter(ImageFilter.GaussianBlur(0.6))
grain.save('/home/user/zillions/assets/textures/terrain-grain.png', optimize=True)
print('grain saved')
