"""Zillions marine line: original chunky power-armour heroes + a modular kit.

One shared armour frame (body, legs, arms, sockets) is re-dressed per hero with
chapter colours, armour weight and a few signature pieces. The same part
builders also export a runtime MODULAR KIT (neutral, tintable materials) that
src/marine-assembler.js snaps together from a seed.

Run headless only:
  blender -b --factory-startup -P tools/art/build_hero_marines.py -- [options]

Options (after --):
  --heroes            build + export assets/art-marines/hero_<key>.glb
  --only a,b          limit heroes
  --kit               export assets/art-marines/kit/marine_kit.glb + .json
  --kit-lod           export the low-poly LOD kit marine_kit_lo.glb + .json
  --render            per-hero renders + front lineup + RTS lineup
  --demo FILE.json    render a grid of recipes (from scripts/marine-demo-recipes.mjs)
  --random N          Blender-side randomizer: N random recipes -> variants/*.glb
  --seed S            seed for --random
  --samples N         Cycles samples (default 64)
  --threads N         CPU threads (default: half the cores)
Env: ZM_OUT (asset dir), ZM_RENDERS (render dir).
Conventions: Blender +Y forward, Z up, origin at ground centre, ~2.3 units tall.
Runtime part names (asset_root, body, leg_l, leg_r, arm_l, arm_r, weapon,
socket_muzzle, socket_ability) match the art-slice hero contract.
"""

import sys

for _p in ("/usr/lib/python3.14/lib-dynload", "/usr/lib/python3.14"):
    import os as _os
    if _os.path.isdir(_p) and _p not in sys.path:
        sys.path.insert(0, _p)

import bpy
import bmesh
import json
import math
import os
import random
from mathutils import Vector, Euler, Matrix

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        if i + 1 < len(ARGS):
            return ARGS[i + 1]
    return default


def flag(name):
    return name in ARGS


ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../.."))
OUT = os.environ.get("ZM_OUT") or os.path.join(ROOT, "assets", "art-marines")
RENDERS = os.environ.get("ZM_RENDERS") or os.path.expanduser("~/Pictures/hero-marines")
R = math.radians


# ---------------------------------------------------------------------------
# colour + materials
# ---------------------------------------------------------------------------

def lin(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def hexc(h):
    """0xRRGGBB (sRGB) -> linear rgb tuple."""
    return (lin(((h >> 16) & 255) / 255), lin(((h >> 8) & 255) / 255), lin((h & 255) / 255))


def mul(c, f):
    return tuple(min(1.0, max(0.0, x * f)) for x in c[:3])


def material(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color[:3], 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if coat and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.12
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit[:3], 1)
        b.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*color[:3], 1)
    return m


# Material slots. Kit exports neutral "tint_*" (runtime recolours) and
# "fixed_*" (never recoloured). Heroes use the same slots with real colours.
SLOTS = ("armor", "armor_dark", "trim", "glow", "skin", "hair", "cloth", "frame", "steel", "eye_white", "eye_dark")
TINT_SLOTS = ("armor", "armor_dark", "trim", "glow", "skin", "hair", "cloth")


def palette_mats(tag, armor, armor_dark, trim, glow, skin, hair, cloth, kit=False):
    """All colours linear rgb. Returns slot -> material."""
    pre = "tint_" if kit else f"{tag}_"
    fx = "fixed_" if kit else f"{tag}_"
    return {
        "armor": material(pre + "armor", armor, 0.25, 0.34, coat=0.5),
        "armor_dark": material(pre + "armor_dark", armor_dark, 0.35, 0.4),
        "trim": material(pre + "trim", trim, 0.8, 0.26),
        "glow": material(pre + "glow", glow, 0.0, 0.3, glow, 3.2),
        "skin": material(pre + "skin", skin, 0.0, 0.58),
        "hair": material(pre + "hair", hair, 0.0, 0.7),
        "cloth": material(pre + "cloth", cloth, 0.0, 0.85),
        "frame": material(fx + "frame", (0.035, 0.038, 0.045), 0.35, 0.55),
        "steel": material(fx + "steel", (0.22, 0.23, 0.25), 0.9, 0.35),
        "eye_white": material(fx + "eye_white", (0.85, 0.83, 0.78), 0.0, 0.4),
        "eye_dark": material(fx + "eye_dark", (0.02, 0.015, 0.012), 0.0, 0.3),
    }


def kit_mats():
    g = (0.72, 0.72, 0.72)
    return palette_mats("kit", g, mul(g, 0.5), (0.9, 0.9, 0.9), (1, 1, 1), (0.6, 0.45, 0.35), (0.1, 0.08, 0.06), (0.3, 0.3, 0.3), kit=True)


# ---------------------------------------------------------------------------
# mesh helpers (bmesh, baked bevels, faceted hard-surface shading)
# ---------------------------------------------------------------------------

LOW = False  # --kit-lod: low-poly variant (no bevels, few segments, no greebles)
_UID = [0]


def next_uid():
    _UID[0] += 1
    return _UID[0]


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    ob["uid"] = next_uid()  # pairs hi/lo kit nodes at runtime (same build order)


def placeholder(name, parent, loc, rot):
    """LOD stand-in for a skipped greeble: keeps the node tree identical."""
    o = bpy.data.objects.new(name, None)
    link(o)
    if parent:
        o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    return o


def empty(name, loc=(0, 0, 0), parent=None, rot=(0, 0, 0), role=None):
    o = bpy.data.objects.new(name, None)
    link(o)
    o.empty_display_size = 0.08
    if parent:
        o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    o["role"] = role or name
    return o


def bevel_bm(bm, width, seg=1, angle=35):
    if width <= 0:
        return
    edges = [e for e in bm.edges if e.is_manifold and e.calc_face_angle(0) > R(angle)]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type="OFFSET", segments=seg,
                        profile=0.5, affect="EDGES", clamp_overlap=True)


def mirror_bm(bm):
    for v in bm.verts:
        v.co.x = -v.co.x
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])


def finalize(name, bm, m, parent, loc, rot, sharp=32, mirror=False):
    if mirror:
        mirror_bm(bm)
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    if hasattr(me, "set_sharp_from_angle"):
        me.set_sharp_from_angle(angle=R(sharp))
    me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if parent:
        ob.parent = parent
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def box(name, size, m, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.03, seg=1,
        taper=(1, 1), btaper=(1, 1), shift=(0, 0), mirror=False):
    if LOW and (max(size) < 0.075 or min(size) < 0.03):
        return placeholder(name, parent, loc, rot)
    if LOW:
        bevel = 0
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    for v in bm.verts:
        top = v.co.z > 0
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
        if top:
            v.co.x = v.co.x * taper[0] + shift[0]
            v.co.y = v.co.y * taper[1] + shift[1]
        else:
            v.co.x *= btaper[0]
            v.co.y *= btaper[1]
    if min(size) >= 0.04:  # tiny greebles stay crisp (and cheap)
        bevel_bm(bm, min(bevel, min(size) * 0.42), seg if min(size) >= 0.12 else 1)
    return finalize(name, bm, m, parent, loc, rot, mirror=mirror)


def cyl(name, r1, r2, depth, m, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), seg=12, bevel=0.0, bseg=1, mirror=False):
    if LOW and max(r1, r2, depth / 2) < 0.04:
        return placeholder(name, parent, loc, rot)
    if LOW:
        seg, bevel = (seg if seg <= 6 else 6), 0.0
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth)
    lim = min(r1, r2) * 0.4 if min(r1, r2) > 0 else bevel
    bevel_bm(bm, min(bevel, depth * 0.4, lim), bseg, angle=50)
    return finalize(name, bm, m, parent, loc, rot, sharp=40, mirror=mirror)


def sphere(name, scale, m, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), useg=12, vseg=8, cut=None, bevel=0.0, mirror=False):
    if LOW and max(scale) < 0.04:
        return placeholder(name, parent, loc, rot)
    if LOW:
        useg, vseg, bevel = min(useg, 6), min(vseg, 4), 0.0
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=useg, v_segments=vseg, radius=1.0)
    if cut is not None:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, cut), plane_no=(0, 0, 1), clear_inner=True)
        boundary = [e for e in bm.edges if e.is_boundary]
        if boundary:
            bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
    for v in bm.verts:
        v.co.x *= scale[0]
        v.co.y *= scale[1]
        v.co.z *= scale[2]
    if bevel:
        bevel_bm(bm, bevel, 1, angle=55)
    return finalize(name, bm, m, parent, loc, rot, sharp=40, mirror=mirror)


def torus(name, R1, r, m, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), su=24, sv=6):
    if LOW:
        su, sv = min(su, 10), 3
    bm = bmesh.new()
    rings = []
    for i in range(su):
        a = 2 * math.pi * i / su
        ring = []
        for j in range(sv):
            b = 2 * math.pi * j / sv
            ring.append(bm.verts.new(((R1 + r * math.cos(b)) * math.cos(a), (R1 + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        rings.append(ring)
    for i in range(su):
        for j in range(sv):
            bm.faces.new((rings[i][j], rings[(i + 1) % su][j], rings[(i + 1) % su][(j + 1) % sv], rings[i][(j + 1) % sv]))
    return finalize(name, bm, m, parent, loc, rot, sharp=70)


def hexplate(name, r, depth, m, parent, loc, normal, bevel=0.012):
    o = cyl(name, r, r * 0.86, depth, m, parent, loc, seg=6, bevel=bevel)
    o.rotation_euler = Vector(normal).to_track_quat("Z", "Y").to_euler()
    return o


def aim(ob, direction, up="Z"):
    ob.rotation_euler = Vector(direction).normalized().to_track_quat("Y", up).to_euler()


# ---------------------------------------------------------------------------
# emblems (original simple geometry, built facing +Y, ~0.16 across)
# ---------------------------------------------------------------------------

EMBLEMS = ("leaf", "crescent", "hex", "paw", "claw", "star", "chevron", "shield")


def build_emblem(kind, parent, m, loc=(0, 0, 0), rot=(0, 0, 0), s=1.0, name="emblem"):
    e = empty(name, loc, parent, rot, role="emblem")
    t, g = m["trim"], m["glow"]
    d = 0.022 * s
    if kind == "leaf":
        for a in (-1, 1):
            sphere("leaf_half", (0.035 * s, d, 0.075 * s), t, e, (a * 0.022 * s, 0, 0.005), (0, R(a * 22), 0), 8, 5)
        box("leaf_vein", (0.012 * s, d * 1.3, 0.13 * s), g, e, (0, 0.004, 0), bevel=0)
    elif kind == "crescent":
        for i in range(7):
            a = R(-120 + i * 40)
            box("crescent_seg", (0.03 * s, d, 0.05 * s), t, e, (math.cos(a) * 0.06 * s, 0, math.sin(a) * 0.06 * s), (0, -a, 0), bevel=0.004)
        sphere("crescent_eye", (0.026 * s, d, 0.026 * s), g, e, (0.012 * s, 0.004, 0), useg=8, vseg=5)
    elif kind == "hex":
        cyl("hex_rim", 0.08 * s, 0.08 * s, d, t, e, rot=(R(90), 0, 0), seg=6, bevel=0.006)
        cyl("hex_core", 0.045 * s, 0.045 * s, d * 1.6, g, e, rot=(R(90), 0, 0), seg=6)
    elif kind == "paw":
        cyl("paw_pad", 0.05 * s, 0.05 * s, d, t, e, (0, 0, -0.02 * s), (R(90), 0, 0), seg=10)
        for x, z in ((-0.055, 0.04), (0, 0.065), (0.055, 0.04)):
            cyl("paw_toe", 0.022 * s, 0.022 * s, d * 1.3, g, e, (x * s, 0.002, z * s), (R(90), 0, 0), seg=8)
    elif kind == "claw":
        for i, x in enumerate((-0.045, 0, 0.045)):
            box("claw_slash", (0.022 * s, d, 0.15 * s), t if i != 1 else g, e, (x * s, 0, 0), (0, R(-20), 0), taper=(0.3, 1), bevel=0.003)
    elif kind == "star":
        for i in range(4):
            a = R(i * 90)
            box("star_ray", (0.05 * s, d, 0.09 * s), t, e, (math.sin(a) * 0.045 * s, 0, math.cos(a) * 0.045 * s), (0, a, 0), taper=(0.05, 1), bevel=0)
        cyl("star_core", 0.024 * s, 0.024 * s, d * 1.5, g, e, rot=(R(90), 0, 0), seg=8)
    elif kind == "chevron":
        for a in (-1, 1):
            box("chevron_arm", (0.035 * s, d, 0.12 * s), t, e, (a * 0.035 * s, 0, 0), (0, R(a * 40), 0), bevel=0.004)
        box("chevron_dot", (0.03 * s, d * 1.3, 0.03 * s), g, e, (0, 0.002, 0.06 * s), (0, R(45), 0), bevel=0)
    else:  # shield
        box("shield_body", (0.11 * s, d, 0.13 * s), t, e, btaper=(0.45, 1), bevel=0.01)
        box("shield_bar", (0.025 * s, d * 1.4, 0.10 * s), g, e, (0, 0.003, 0), bevel=0)
    return e


# ---------------------------------------------------------------------------
# shared armour frame
# ---------------------------------------------------------------------------

BODIES = {"light": 0.88, "standard": 1.0, "heavy": 1.18}
POSES = {
    # hand targets in body space (x scaled by bulk): right, left
    "rifle": ((0.27, 0.36, 1.08), (0.0, 0.70, 1.14)),
    "melee2h": ((0.30, 0.34, 1.04), (0.08, 0.56, 1.24)),
    "staff": ((0.60, 0.40, 1.02), (-0.50, 0.42, 1.06)),
    "twin": ((0.40, 0.56, 1.06), (-0.40, 0.56, 1.06)),
    "fists": ((0.18, 0.56, 1.30), (-0.22, 0.50, 1.20)),
    "shield": ((0.60, 0.40, 1.02), (-0.30, 0.56, 1.12)),
}
UPPER, FORE = 0.36, 0.40


def solve_arm(sh, tgt, sx):
    """Two-bone IK: elbow + hand positions reaching tgt, elbow out/back/down."""
    d = tgt - sh
    D = max(0.12, min(d.length, UPPER + FORE - 0.02))
    u = d.normalized()
    a = (UPPER ** 2 - FORE ** 2 + D * D) / (2 * D)
    h = math.sqrt(max(0.0, UPPER ** 2 - a * a))
    pole = Vector((sx * 0.8, -0.5, -0.6))
    p = (pole - u * pole.dot(u)).normalized()
    elbow = sh + u * a + p * h
    hand = sh + u * D
    return elbow, hand


def build_body(parent, m, bulk=1.0, pose="rifle", heavy_plates=False, stripes=False):
    """Legs, pelvis, torso, arms + sockets. Returns dict of nodes and hand points."""
    b = bulk
    ab = 0.55 + 0.45 * b  # limbs scale less than chest
    body = empty("body", (0, 0, 0), parent)
    out = {"body": body}
    hip = 0.80

    for side, sx in (("l", -1), ("r", 1)):
        leg = empty(f"leg_{side}", (sx * 0.21 * ab, 0, hip), body)
        out[f"leg_{side}"] = leg
        mir = sx < 0
        box("thigh_core", (0.22 * ab, 0.24, 0.32), m["frame"], leg, (0, 0, -0.15), bevel=0.04)
        box("thigh_plate", (0.29 * ab, 0.20, 0.28), m["armor"], leg, (0.015 * sx, 0.05, -0.13), bevel=0.05, seg=2, taper=(1.12, 1.05), mirror=mir)
        box("thigh_trim", (0.04, 0.03, 0.22), m["trim"], leg, (0.0, 0.155, -0.13), bevel=0.008)
        box("knee_guard", (0.24 * ab, 0.17, 0.18), m["armor_dark"], leg, (0, 0.13, -0.34), (R(-10), 0, 0), bevel=0.055, seg=2, taper=(0.82, 0.88))
        box("knee_trim", (0.12 * ab, 0.03, 0.08), m["trim"], leg, (0, 0.225, -0.34), (R(-10), 0, 0), bevel=0.012)
        box("greave", (0.30 * ab, 0.32, 0.31), m["armor"], leg, (0, 0.03, -0.50), bevel=0.06, seg=2, taper=(0.80, 0.82))
        box("greave_ridge", (0.06, 0.06, 0.24), m["armor_dark"], leg, (0, 0.19, -0.50), bevel=0.015, taper=(0.7, 1))
        box("boot", (0.33 * ab, 0.50, 0.16), m["armor_dark"], leg, (0, 0.07, -0.72), bevel=0.05, seg=2, taper=(0.82, 0.72))
        box("boot_toe", (0.22 * ab, 0.07, 0.08), m["trim"], leg, (0, 0.32, -0.74), bevel=0.015)
        box("sole", (0.34 * ab, 0.52, 0.04), m["frame"], leg, (0, 0.07, -0.78), bevel=0.012)
        if heavy_plates:
            box("thigh_lame", (0.31 * ab, 0.22, 0.06), m["armor_dark"], leg, (0, 0.05, -0.01), bevel=0.02)
            box("greave_plate", (0.33 * ab, 0.10, 0.20), m["armor_dark"], leg, (0, 0.17, -0.55), bevel=0.03, taper=(0.8, 1))

    box("pelvis", (0.50 * b, 0.36, 0.22), m["frame"], body, (0, 0, 0.87), bevel=0.05)
    box("belt", (0.60 * b, 0.42, 0.10), m["armor_dark"], body, (0, 0, 0.97), bevel=0.03)
    box("buckle", (0.16, 0.05, 0.11), m["trim"], body, (0, 0.215, 0.97), bevel=0.015)
    cyl("buckle_gem", 0.036, 0.036, 0.03, m["glow"], body, (0, 0.243, 0.97), (R(90), 0, 0), seg=8)
    for sx in (-1, 1):
        box("tasset_front", (0.21 * b, 0.05, 0.24), m["armor"], body, (sx * 0.14 * b, 0.22, 0.81), (R(-16), 0, 0), bevel=0.03, seg=2, btaper=(0.85, 1))
        box("tasset_trim", (0.21 * b, 0.055, 0.03), m["trim"], body, (sx * 0.14 * b, 0.20, 0.70), (R(-16), 0, 0), bevel=0.01)
        box("tasset_side", (0.07, 0.28, 0.27), m["armor"], body, (sx * 0.33 * b, 0, 0.83), (0, R(sx * 16), 0), bevel=0.03, seg=2, btaper=(1, 0.85))
        box("pouch", (0.10, 0.08, 0.10), m["armor_dark"], body, (sx * 0.24 * b, 0.20, 0.96), bevel=0.02)

    box("abdomen", (0.46 * b, 0.34, 0.20), m["frame"], body, (0, 0, 1.08), bevel=0.04)
    for z in (1.04, 1.12):
        box("ab_plate", (0.34 * b, 0.07, 0.07), m["armor_dark"], body, (0, 0.17, z), bevel=0.02)

    box("chest", (0.84 * b, 0.54, 0.50), m["armor"], body, (0, 0.0, 1.38), bevel=0.09, seg=2, taper=(1.06, 0.95), btaper=(0.78, 0.88))
    for sx in (-1, 1):
        box("pec_plate", (0.34 * b, 0.10, 0.30), m["armor"], body, (sx * 0.185 * b, 0.27, 1.42), (R(-8), R(sx * -8), 0), bevel=0.04, seg=2, taper=(1.05, 1), btaper=(0.8, 1), mirror=sx < 0)
        box("pec_trim", (0.30 * b, 0.04, 0.03), m["trim"], body, (sx * 0.19 * b, 0.315, 1.565), (R(-8), R(sx * -8), 0), bevel=0.008)
        box("chest_vent", (0.10, 0.06, 0.04), m["steel"], body, (sx * 0.30 * b, 0.25, 1.24), bevel=0.01)
    box("chest_keel", (0.08, 0.08, 0.30), m["armor_dark"], body, (0, 0.30, 1.39), (R(-8), 0, 0), bevel=0.02, btaper=(0.6, 1))
    box("chest_trim_lo", (0.62 * b, 0.50, 0.035), m["trim"], body, (0, 0.0, 1.15), bevel=0.012)
    box("gorget", (0.48 * b, 0.42, 0.17), m["armor_dark"], body, (0, -0.02, 1.66), bevel=0.05, taper=(0.82, 0.85))
    box("gorget_trim", (0.44 * b, 0.05, 0.035), m["trim"], body, (0, 0.18, 1.62), bevel=0.01)
    if stripes:
        for sx in (-1, 1):
            for i in range(2):
                box("stripe", (0.06, 0.03, 0.24), m["trim"], body, (sx * (0.13 + 0.10 * i) * b, 0.33 - 0.015 * i, 1.42), (R(-8), R(sx * 30), 0), taper=(0.2, 1), bevel=0.004)
    if heavy_plates:
        box("chest_armor_ext", (0.88 * b, 0.48, 0.06), m["armor_dark"], body, (0, 0.0, 1.20), bevel=0.02)

    out["socket_emblem"] = empty("socket_emblem", (0, 0.345, 1.44), body, (R(-8), 0, 0))
    out["socket_head"] = empty("socket_head", (0, 0.02, 1.64), body)
    out["socket_back"] = empty("socket_back", (0, -0.28, 1.40), body)
    out["socket_pauldron_l"] = empty("socket_pauldron_l", (-0.50 * b, 0, 1.58), body)
    out["socket_pauldron_r"] = empty("socket_pauldron_r", (0.50 * b, 0, 1.58), body)

    pr, pl = POSES[pose]
    for side, sx, t in (("l", -1, pl), ("r", 1, pr)):
        sh = Vector((sx * 0.46 * b, 0, 1.50))
        tgt = Vector((t[0] * b, t[1], t[2]))
        elbow, hand = solve_arm(sh, tgt, sx)
        pivot = empty(f"arm_{side}", sh, body)  # runtime swings this; pose lives below
        arm = empty(f"upperarm_{side}", (0, 0, 0), pivot)
        arm.rotation_mode = "QUATERNION"
        q_up = Vector((0, 0, -1)).rotation_difference((elbow - sh).normalized())
        arm.rotation_quaternion = q_up
        fore = empty(f"forearm_{side}", (0, 0, -UPPER), arm)
        fore.rotation_mode = "QUATERNION"
        local = q_up.inverted() @ (hand - elbow).normalized()
        fore.rotation_quaternion = Vector((0, 0, -1)).rotation_difference(local)
        out[f"arm_{side}"] = pivot
        out[f"forearm_{side}"] = fore
        out[f"hand_{side}"] = hand
        mir = sx < 0
        sphere("shoulder_joint", (0.13 * ab, 0.13, 0.13), m["frame"], arm, useg=10, vseg=6)
        cyl("upper_arm", 0.11 * ab, 0.10 * ab, UPPER, m["frame"], arm, (0, 0, -UPPER / 2), seg=10)
        box("bicep_plate", (0.22 * ab, 0.22, 0.20), m["armor"], arm, (0.012 * sx, 0, -0.17), bevel=0.045, seg=2, taper=(1.08, 1.05), mirror=mir)
        sphere("elbow", (0.11 * ab, 0.11, 0.11), m["armor_dark"], fore, useg=10, vseg=6)
        box("vambrace", (0.23 * ab, 0.25, 0.24), m["armor"], fore, (0, 0.0, -0.17), bevel=0.045, seg=2, taper=(0.88, 0.88), btaper=(1.1, 1.1))
        box("wrist_trim", (0.25 * ab, 0.27, 0.04), m["trim"], fore, (0, 0.0, -0.29), bevel=0.012)
        box("gauntlet", (0.19 * ab, 0.21, 0.15), m["armor_dark"], fore, (0, 0.0, -FORE + 0.01), bevel=0.04)
        box("knuckles", (0.17 * ab, 0.05, 0.06), m["steel"], fore, (0, 0.11, -FORE + 0.01), bevel=0.012)
        out[f"socket_hand_{side}"] = empty(f"socket_hand_{side}", (0, 0, -FORE), fore)

    hr, hl = out["hand_r"], out["hand_l"]
    out["shoulder_r"] = out["arm_r"].location.copy()
    out["shoulder_l"] = out["arm_l"].location.copy()
    # Child of the arm_r pivot (unrotated at rest), so the weapon swings with
    # the arm the runtime animates.
    sw = empty("socket_weapon", hr - out["shoulder_r"], out["arm_r"])
    aim(sw, Vector((0.05, 0.3, 1.0)) if pose in ("staff", "shield") else hl - hr)
    out["socket_weapon"] = sw
    out["reach"] = (hl - hr).length
    return out


# ---------------------------------------------------------------------------
# pauldrons (built for the RIGHT shoulder; mirror for left)
# ---------------------------------------------------------------------------

PAULDRONS = ("dome", "tiered", "block", "swept")


def build_pauldron(kind, parent, m, s=1.0, mirror=False, name="pauldron"):
    sx = -1 if mirror else 1
    p = empty(name, (0, 0, 0), parent, (0, R(sx * 18), 0), role="pauldron")
    mir = mirror
    if kind in ("dome", "tiered"):
        rr = 0.32 * s
        sphere("pauldron_shell", (rr, rr * 1.02, rr * 0.82), m["armor"], p, (0.03 * sx, 0, 0.02), useg=14, vseg=8, cut=-0.3, bevel=0.012, mirror=mir)
        box("pauldron_ridge", (0.07 * s, rr * 1.6, 0.05), m["armor_dark"], p, (0.03 * sx, 0, 0.02 + rr * 0.74), bevel=0.015, taper=(0.7, 0.8))
        rim_r = rr * math.sqrt(1 - 0.09) + 0.015
        cyl("pauldron_rim", rim_r + 0.012, rim_r, 0.055, m["trim"], p, (0.03 * sx, 0, 0.02 - 0.3 * rr * 0.82), seg=14, bevel=0.01)
        for yy in (-0.6, 0.0, 0.6):
            sphere("pauldron_rivet", (0.022, 0.022, 0.022), m["trim"], p, (0.03 * sx + rr * 0.80 * sx, yy * rr * 0.75, 0.02 - rr * 0.12), useg=6, vseg=4)
        if kind == "tiered":
            for i in range(2):
                z = 0.02 - 0.3 * rr * 0.82 - 0.06 - i * 0.065
                cyl("pauldron_lame", rim_r - 0.02 - i * 0.03, rim_r - 0.035 - i * 0.03, 0.06, m["armor_dark"], p, (0.05 * sx, 0, z), seg=14, bevel=0.012)
            box("pauldron_fin", (0.04, rr * 1.5, 0.08), m["armor_dark"], p, (0.03 * sx, 0, 0.02 + rr * 0.76), bevel=0.012, taper=(0.6, 0.85))
        em = (0.03 * sx + rr * 0.92 * sx, 0, 0.02)
    elif kind == "block":
        w = 0.40 * s
        box("pauldron_shell", (w, w * 1.08, w * 0.62), m["armor"], p, (0.04 * sx, 0, 0.04), bevel=0.07, seg=2, taper=(0.72, 0.82))
        box("pauldron_rim", (w * 1.06, w * 1.14, 0.06), m["trim"], p, (0.04 * sx, 0, 0.04 - w * 0.31), bevel=0.02)
        box("pauldron_lip", (w * 0.98, w * 1.04, 0.07), m["armor_dark"], p, (0.06 * sx, 0, 0.04 - w * 0.31 - 0.065), bevel=0.02)
        box("pauldron_crest", (w * 0.22, w * 0.86, 0.07), m["armor_dark"], p, (0.04 * sx, 0, 0.04 + w * 0.33), bevel=0.02, taper=(0.7, 0.9))
        em = (0.04 * sx + w * 0.44 * sx, 0, 0.03)
    else:  # swept
        w = 0.30 * s
        box("pauldron_shell", (w * 1.05, w * 1.3, w * 0.55), m["armor"], p, (0.04 * sx, -0.02, 0.03), (R(-10), 0, 0), bevel=0.05, seg=2, taper=(0.55, 0.7), shift=(0.02 * sx, -0.05))
        box("pauldron_rim", (w * 1.1, w * 1.36, 0.045), m["trim"], p, (0.04 * sx, -0.02, 0.03 - w * 0.28), (R(-10), 0, 0), bevel=0.012)
        box("pauldron_vane", (0.03, w * 1.1, 0.10), m["armor_dark"], p, (0.07 * sx, -0.06, 0.03 + w * 0.3), (R(-14), 0, 0), bevel=0.01, taper=(0.6, 0.6), shift=(0, -0.05))
        em = (0.04 * sx + w * 0.5 * sx, 0, 0.0)
    sock = empty("socket_emblem", em, p, (0, 0, R(-90 * sx)), role="socket_emblem")
    return p, sock


# ---------------------------------------------------------------------------
# helmets, bare heads, hair, beards, face details (origin = socket_head)
# ---------------------------------------------------------------------------

HELMETS = ("visor", "lenses", "heavy", "crest", "hood")
HEADS = ("square", "round", "long", "sculpted")
HAIRS = ("bald", "buzz", "flattop", "mohawk", "swept", "topknot", "long", "crew")
BEARDS = ("none", "stubble", "mustache", "goatee", "full", "braided")
FACES = ("plain", "scar", "bionic", "warpaint")


def build_helmet(kind, parent, m, name="helmet"):
    h = empty(name, (0, 0, 0), parent, role="helmet")
    cyl("neck_seal", 0.11, 0.10, 0.12, m["frame"], h, (0, 0, 0.05), seg=10)
    if kind == "heavy":
        box("helm_dome", (0.36, 0.38, 0.33), m["armor"], h, (0, 0.0, 0.25), bevel=0.09, seg=2, taper=(0.82, 0.88))
        box("helm_brow", (0.38, 0.10, 0.075), m["trim"], h, (0, 0.15, 0.31), bevel=0.02)
        box("helm_slit", (0.25, 0.04, 0.035), m["glow"], h, (0, 0.19, 0.255), bevel=0.006)
        box("helm_chin", (0.30, 0.15, 0.13), m["armor_dark"], h, (0, 0.11, 0.13), bevel=0.04, taper=(1.1, 1), btaper=(0.75, 0.9))
        for x in (-0.06, 0, 0.06):
            box("helm_vent", (0.03, 0.03, 0.07), m["steel"], h, (x, 0.19, 0.13), bevel=0.004)
        box("helm_ridge", (0.07, 0.34, 0.06), m["armor_dark"], h, (0, -0.01, 0.425), bevel=0.02)
        return h
    sphere("helm_dome", (0.19, 0.21, 0.21), m["armor"], h, (0, 0.0, 0.24), useg=14, vseg=9)
    box("helm_face", (0.25, 0.12, 0.17), m["armor"], h, (0, 0.13, 0.17), bevel=0.04, seg=2, taper=(1.08, 0.8))
    for sx in (-1, 1):
        cyl("helm_ear", 0.075, 0.07, 0.07, m["trim"], h, (sx * 0.19, -0.01, 0.23), (0, R(90), 0), seg=12, bevel=0.01)
    if kind in ("visor", "crest", "hood"):
        box("visor", (0.30, 0.06, 0.055), m["glow"], h, (0, 0.175, 0.255), bevel=0.012, taper=(0.9, 1))
        box("visor_frame", (0.32, 0.05, 0.03), m["armor_dark"], h, (0, 0.17, 0.295), bevel=0.01)
        box("grille", (0.13, 0.05, 0.07), m["steel"], h, (0, 0.205, 0.13), bevel=0.012, btaper=(0.8, 1))
    else:  # lenses
        for sx in (-1, 1):
            cyl("lens_bezel", 0.06, 0.06, 0.035, m["trim"], h, (sx * 0.075, 0.19, 0.255), (R(90), 0, 0), seg=12)
            cyl("lens", 0.045, 0.045, 0.045, m["glow"], h, (sx * 0.075, 0.197, 0.255), (R(90), 0, 0), seg=12)
        box("respirator", (0.12, 0.11, 0.10), m["armor_dark"], h, (0, 0.20, 0.14), (R(12), 0, 0), bevel=0.03, taper=(0.75, 0.7))
        for z in (0.12, 0.155):
            box("resp_slat", (0.09, 0.02, 0.012), m["steel"], h, (0, 0.255, z), bevel=0)
    box("helm_ridge", (0.05, 0.30, 0.05), m["armor_dark"], h, (0, -0.01, 0.43), bevel=0.015)
    if kind == "crest":
        box("crest_fin", (0.045, 0.36, 0.15), m["trim"], h, (0, -0.06, 0.50), bevel=0.012, taper=(0.6, 0.8), shift=(0, -0.08))
    if kind == "hood":
        build_hood(h, m)
    return h


def build_hood(h, m):
    """Open-front cloth cowl: reads as a hood from the front and from above."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=8 if LOW else 16, v_segments=6 if LOW else 10, radius=1.0)
    for v in bm.verts:
        v.co.x *= 0.27
        v.co.y *= 0.30
        v.co.z *= 0.31
    # Peak the crown backwards like a drawn-up hood.
    for v in bm.verts:
        if v.co.z > 0.12:
            k = (v.co.z - 0.12) / 0.19
            v.co.y -= 0.10 * k * k
            v.co.z += 0.05 * k * k
    drop = [f for f in bm.faces if f.calc_center_median().normalized().y > 0.42 or f.calc_center_median().z < -0.16]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.03)
    finalize("hood_shell", bm, m["cloth"], h, (0, -0.04, 0.27), (R(-6), 0, 0), sharp=60)
    rim = torus("hood_rim", 0.19, 0.026, m["trim"], h, (0, 0.165, 0.27), (R(84), 0, 0), su=20, sv=5)
    rim.scale = (0.95, 1.22, 1.0)
    cyl("hood_peak", 0.08, 0.0, 0.20, m["cloth"], h, (0, -0.28, 0.50), (R(-118), 0, 0), seg=6)
    cyl("hood_mantle", 0.34, 0.22, 0.17, m["cloth"], h, (0, -0.03, 0.02), seg=8 if LOW else 14, bevel=0.03)
    box("hood_clasp", (0.10, 0.04, 0.06), m["trim"], h, (0, 0.22, 0.06), bevel=0.01)


def build_head(kind, parent, m, name="head"):
    h = empty(name, (0, 0, 0), parent, role="head")
    sk = m["skin"]
    cyl("neck", 0.085, 0.09, 0.16, sk, h, (0, 0, 0.07), seg=10)
    if kind == "sculpted":
        build_sculpted_face(h, m)
        return h
    if kind == "round":
        sphere("skull", (0.15, 0.16, 0.17), sk, h, (0, 0.03, 0.27), useg=14, vseg=9)
        box("jaw", (0.22, 0.20, 0.10), sk, h, (0, 0.06, 0.16), bevel=0.04, seg=2, btaper=(0.8, 0.9))
        fy = 0.19
    elif kind == "long":
        box("skull", (0.25, 0.29, 0.36), sk, h, (0, 0.03, 0.29), bevel=0.09, seg=3, taper=(0.95, 1))
        box("jaw", (0.20, 0.20, 0.10), sk, h, (0, 0.07, 0.14), bevel=0.04, seg=2, btaper=(0.6, 0.85))
        fy = 0.175
    else:  # square
        box("skull", (0.28, 0.30, 0.32), sk, h, (0, 0.03, 0.29), bevel=0.10, seg=3)
        box("jaw", (0.27, 0.22, 0.12), sk, h, (0, 0.06, 0.16), bevel=0.045, seg=2, btaper=(0.92, 0.95))
        fy = 0.18
    for sx in (-1, 1):
        box("eye_white", (0.062, 0.02, 0.036), m["eye_white"], h, (sx * 0.064, fy + 0.004, 0.295), bevel=0.006)
        box("eye_iris", (0.03, 0.02, 0.032), m["eye_dark"], h, (sx * 0.06, fy + 0.012, 0.295), bevel=0.004)
        box("brow", (0.085, 0.035, 0.026), m["hair"], h, (sx * 0.066, fy + 0.012, 0.335), (0, R(sx * -10), 0), bevel=0.008)
        box("ear", (0.03, 0.07, 0.09), sk, h, (sx * 0.145, 0.02, 0.28), bevel=0.012)
    box("nose", (0.05, 0.06, 0.085), sk, h, (0, fy + 0.02, 0.255), bevel=0.012, taper=(0.55, 0.4))
    box("mouth", (0.085, 0.02, 0.014), m["eye_dark"], h, (0, fy + 0.004, 0.19), bevel=0.004)
    return h


def build_sculpted_face(h, m):
    """Heroic head from planes: skull, brow ridge, cheekbones, tapered jaw, chin, nose bridge."""
    sk = m["skin"]
    sphere("skull", (0.145, 0.158, 0.165), sk, h, (0, 0.02, 0.31), useg=12, vseg=8)
    box("face_plane", (0.215, 0.10, 0.15), sk, h, (0, 0.105, 0.275), bevel=0.035, seg=2, taper=(1.04, 0.9))
    box("jaw", (0.235, 0.17, 0.095), sk, h, (0, 0.07, 0.17), bevel=0.035, seg=2, btaper=(0.68, 0.85))
    box("chin", (0.085, 0.07, 0.06), sk, h, (0, 0.135, 0.135), bevel=0.02, btaper=(0.8, 0.9))
    box("brow_ridge", (0.215, 0.06, 0.042), sk, h, (0, 0.152, 0.335), (R(-8), 0, 0), bevel=0.016)
    for sx in (-1, 1):
        box("cheekbone", (0.07, 0.07, 0.05), sk, h, (sx * 0.083, 0.135, 0.245), (R(-10), 0, R(sx * -18)), bevel=0.018, taper=(0.8, 0.8))
        box("temple", (0.03, 0.12, 0.10), sk, h, (sx * 0.125, 0.06, 0.31), bevel=0.012)
        box("eye_white", (0.056, 0.016, 0.03), m["eye_white"], h, (sx * 0.06, 0.158, 0.297), bevel=0.005)
        box("eye_iris", (0.026, 0.016, 0.028), m["eye_dark"], h, (sx * 0.057, 0.165, 0.297), bevel=0.003)
        box("brow", (0.08, 0.03, 0.022), m["hair"], h, (sx * 0.062, 0.18, 0.333), (0, R(sx * -12), 0), bevel=0.006)
        box("ear", (0.03, 0.065, 0.085), sk, h, (sx * 0.147, 0.02, 0.285), bevel=0.012)
    box("nose", (0.045, 0.07, 0.10), sk, h, (0, 0.165, 0.26), (R(6), 0, 0), bevel=0.012, taper=(0.5, 0.3))
    box("nose_tip", (0.05, 0.04, 0.03), sk, h, (0, 0.19, 0.218), bevel=0.012)
    box("mouth", (0.08, 0.016, 0.012), m["eye_dark"], h, (0, 0.157, 0.183), bevel=0.003)
    cyl("neck", 0.085, 0.09, 0.16, sk, h, (0, 0, 0.07), seg=10)


def build_hair(kind, parent, m, name="hair"):
    if kind == "bald":
        return None
    h = empty(name, (0, 0, 0), parent, role="hair")
    hm = m["hair"]
    if kind in ("buzz", "topknot", "long"):
        box("hair_cap", (0.295, 0.315, 0.07), hm, h, (0, 0.025, 0.44), bevel=0.03)
        box("hair_back", (0.29, 0.07, 0.18), hm, h, (0, -0.125, 0.36), bevel=0.025)
        if kind == "topknot":
            sphere("knot", (0.07, 0.07, 0.07), hm, h, (0, -0.07, 0.52), useg=10, vseg=6)
            cyl("knot_band", 0.045, 0.045, 0.03, m["trim"], h, (0, -0.07, 0.465), seg=8)
        if kind == "long":
            box("hair_long", (0.30, 0.09, 0.30), hm, h, (0, -0.15, 0.24), bevel=0.03, btaper=(0.85, 1))
    elif kind == "flattop":
        box("hair_top", (0.30, 0.30, 0.13), hm, h, (0, 0.025, 0.475), bevel=0.02)
        box("hair_back", (0.29, 0.07, 0.20), hm, h, (0, -0.125, 0.37), bevel=0.02)
        for sx in (-1, 1):
            box("hair_side", (0.03, 0.18, 0.14), hm, h, (sx * 0.145, -0.03, 0.39), bevel=0.01)
    elif kind == "mohawk":
        box("mohawk", (0.07, 0.36, 0.18), hm, h, (0, -0.02, 0.52), bevel=0.02, taper=(0.5, 0.9), shift=(0, -0.04))
        box("mohawk_tail", (0.06, 0.08, 0.16), hm, h, (0, -0.17, 0.40), bevel=0.015)
        for sx in (-1, 1):
            box("shave", (0.02, 0.22, 0.12), hm, h, (sx * 0.142, -0.02, 0.38), bevel=0.006)
    elif kind == "crew":
        sphere("hair_cap", (0.153, 0.168, 0.098), hm, h, (0, -0.01, 0.41), useg=12, vseg=7)
        box("hair_quiff", (0.20, 0.08, 0.06), hm, h, (0, 0.10, 0.465), (R(-18), 0, 0), bevel=0.025, taper=(0.85, 0.8))
        for sx in (-1, 1):
            box("sideburn", (0.025, 0.05, 0.09), hm, h, (sx * 0.142, 0.07, 0.29), bevel=0.008)
    elif kind == "swept":
        box("hair_top", (0.31, 0.33, 0.10), hm, h, (0, 0.0, 0.45), bevel=0.03, taper=(0.9, 0.9))
        box("hair_quiff", (0.22, 0.10, 0.11), hm, h, (0.04, 0.13, 0.48), (R(-25), 0, R(-8)), bevel=0.025)
        box("hair_back", (0.29, 0.07, 0.20), hm, h, (0, -0.13, 0.37), bevel=0.02)
    return h


def build_beard(kind, parent, m, name="beard"):
    if kind == "none":
        return None
    b = empty(name, (0, 0, 0), parent, role="beard")
    hm = m["hair"]
    if kind == "stubble":
        box("stubble", (0.25, 0.10, 0.07), hm, b, (0, 0.11, 0.135), bevel=0.02)
    elif kind == "mustache":
        box("mustache", (0.13, 0.04, 0.035), hm, b, (0, 0.205, 0.215), bevel=0.01)
        for sx in (-1, 1):
            box("mustache_tip", (0.035, 0.035, 0.07), hm, b, (sx * 0.07, 0.198, 0.19), bevel=0.008)
    elif kind == "goatee":
        box("goatee", (0.09, 0.06, 0.08), hm, b, (0, 0.185, 0.15), bevel=0.015, btaper=(0.6, 1))
        box("mustache", (0.11, 0.035, 0.03), hm, b, (0, 0.203, 0.215), bevel=0.008)
    else:  # full / braided
        box("beard", (0.29, 0.18, 0.18), hm, b, (0, 0.10, 0.13), bevel=0.05, seg=2, btaper=(0.55, 0.8))
        box("mustache", (0.14, 0.04, 0.035), hm, b, (0, 0.205, 0.215), bevel=0.01)
        if kind == "braided":
            for i in range(3):
                box("braid", (0.06 - i * 0.008, 0.06, 0.07), hm, b, (0, 0.17, 0.02 - i * 0.07), bevel=0.015)
            cyl("braid_ring", 0.04, 0.04, 0.025, m["trim"], b, (0, 0.17, -0.02), seg=8)
    return b


def build_face(kind, parent, m, name="face"):
    if kind == "plain":
        return None
    f = empty(name, (0, 0, 0), parent, role="face")
    if kind == "scar":
        box("scar", (0.016, 0.012, 0.13), m["eye_white"], f, (0.07, 0.192, 0.29), (0, R(18), 0), bevel=0)
    elif kind == "bionic":
        box("bionic_plate", (0.08, 0.035, 0.07), m["steel"], f, (-0.066, 0.188, 0.30), bevel=0.01)
        cyl("bionic_lens", 0.022, 0.022, 0.03, m["glow"], f, (-0.066, 0.205, 0.30), (R(90), 0, 0), seg=8)
    else:  # warpaint
        box("paint", (0.27, 0.012, 0.03), m["cloth"], f, (0, 0.19, 0.262), bevel=0)
    return f


# ---------------------------------------------------------------------------
# backpacks (origin = socket_back)
# ---------------------------------------------------------------------------

BACKPACKS = ("reactor", "jump", "shell", "comms")


def build_backpack(kind, parent, m, s=1.0, name="backpack"):
    p = empty(name, (0, 0, 0), parent, role="backpack")
    if kind == "shell":
        ry, rz = 0.24, 0.44
        rx = 0.40 * s
        sphere("shell_dome", (rx, ry, rz), m["armor_dark"], p, (0, -0.10, 0.02), useg=14, vseg=10)
        spots = ((0, 0.20), (-0.5, 0.12), (0.5, 0.12), (-0.5, -0.14), (0.5, -0.14), (0, -0.20), (-0.85, -0.01), (0.85, -0.01), (0, 0.0))
        for i, (ux, uz) in enumerate(spots):
            nx, nz = ux, uz / rz
            ny = -math.sqrt(max(0.04, 1 - nx * nx - nz * nz))
            pos = (nx * rx, -0.10 + ny * ry, 0.02 + nz * rz)
            nrm = Vector((nx / rx, ny / ry, nz / rz)).normalized()
            hexplate("shell_hex", 0.085, 0.035, m["armor"] if i != 8 else m["trim"], p, pos, nrm)
        cyl("shell_core", 0.045, 0.045, 0.05, m["glow"], p, (0, -0.36, 0.02), (R(90), 0, 0), seg=6)
        return p
    box("pack", (0.50 * s, 0.24, 0.46), m["armor"], p, (0, -0.10, 0.02), bevel=0.06, seg=2, taper=(0.9, 0.9))
    box("pack_trim", (0.52 * s, 0.25, 0.035), m["trim"], p, (0, -0.10, -0.15), bevel=0.01)
    cyl("core_bezel", 0.085, 0.085, 0.04, m["trim"], p, (0, -0.225, 0.06), (R(90), 0, 0), seg=12)
    cyl("core", 0.06, 0.06, 0.05, m["glow"], p, (0, -0.235, 0.06), (R(90), 0, 0), seg=12)
    if kind == "jump":
        for sx in (-1, 1):
            cyl("thruster", 0.09, 0.07, 0.34, m["steel"], p, (sx * 0.19 * s, -0.20, -0.06), (0, R(sx * 10), 0), seg=10, bevel=0.01)
            cyl("thruster_glow", 0.065, 0.065, 0.03, m["glow"], p, (sx * 0.22 * s, -0.20, -0.235), seg=10)
            box("wing", (0.30, 0.04, 0.12), m["armor_dark"], p, (sx * 0.34 * s, -0.15, 0.18), (0, R(sx * -25), 0), bevel=0.015, taper=(0.5, 1))
    else:
        for sx in (-1, 1):
            cyl("vent", 0.065, 0.06, 0.18, m["steel"], p, (sx * 0.14 * s, -0.12, 0.31), seg=10, bevel=0.01)
            cyl("vent_glow", 0.045, 0.045, 0.02, m["glow"], p, (sx * 0.14 * s, -0.12, 0.40), seg=10)
            cyl("exhaust", 0.05, 0.05, 0.16, m["steel"], p, (sx * 0.26 * s, -0.12, -0.12), seg=8)
        if kind == "comms":
            cyl("antenna", 0.012, 0.008, 0.62, m["steel"], p, (0.17 * s, -0.16, 0.66), seg=6)
            sphere("antenna_tip", (0.025, 0.025, 0.025), m["glow"], p, (0.17 * s, -0.16, 0.98), useg=8, vseg=5)
            cyl("dish", 0.09, 0.03, 0.04, m["armor_dark"], p, (-0.16 * s, -0.22, 0.36), (R(-60), 0, 0), seg=10)
    return p


# ---------------------------------------------------------------------------
# weapons: origin at the right-hand grip, barrel along +Y; "weapon" root with
# socket_muzzle / socket_ability.
# ---------------------------------------------------------------------------

WEAPONS = ("rifle", "carbine", "sniper", "shotgun", "hammer", "blade")


def build_weapon(kind, parent, m, reach=0.55, name="weapon", loc=(0, 0, 0)):
    w = empty(name, loc, parent, role="weapon")
    ad, st, tr, gl = m["armor_dark"], m["steel"], m["trim"], m["glow"]
    if kind in ("rifle", "carbine", "sniper", "shotgun"):
        long_ = {"rifle": 1.0, "carbine": 0.8, "sniper": 1.45, "shotgun": 0.85}[kind]
        wide = 1.35 if kind == "shotgun" else 1.0
        rl = 0.52 * long_
        box("receiver", (0.11 * wide, rl, 0.17), ad, w, (0, rl * 0.32, 0.05), bevel=0.025, taper=(0.9, 1))
        box("grip", (0.065, 0.07, 0.15), m["frame"], w, (0, -0.01, -0.06), (R(-18), 0, 0), bevel=0.015)
        box("stock", (0.08, 0.26, 0.13), ad, w, (0, -0.20, 0.0), bevel=0.025, taper=(1, 0.8))
        box("stock_pad", (0.085, 0.04, 0.15), m["frame"], w, (0, -0.335, 0.0), bevel=0.01)
        box("rail_glow", (0.115 * wide, rl * 0.55, 0.022), gl, w, (0, rl * 0.36, 0.115), bevel=0.004)
        box("side_plate", (0.125 * wide, rl * 0.42, 0.07), tr, w, (0, rl * 0.18, 0.03), bevel=0.01)
        box("handguard", (0.10 * wide, 0.22, 0.10), ad, w, (0, max(reach, rl * 0.6), 0.035), bevel=0.02)
        if kind == "shotgun":
            for sx in (-1, 1):
                cyl("barrel", 0.034, 0.034, 0.34, st, w, (sx * 0.038, rl * 0.6 + 0.16, 0.07), (R(-90), 0, 0), seg=10)
            box("muzzle", (0.15, 0.06, 0.08), st, w, (0, rl * 0.6 + 0.33, 0.07), bevel=0.012)
            tip = rl * 0.6 + 0.37
        else:
            bl = 0.28 * long_ + (0.25 if kind == "sniper" else 0)
            cyl("barrel", 0.028, 0.028, bl, st, w, (0, rl * 0.6 + bl / 2, 0.07), (R(-90), 0, 0), seg=10)
            box("muzzle", (0.07, 0.10, 0.075), st, w, (0, rl * 0.6 + bl, 0.07), bevel=0.012)
            tip = rl * 0.6 + bl + 0.05
            box("magazine", (0.07, 0.10, 0.17), m["frame"], w, (0, rl * 0.22, -0.10), (R(15), 0, 0), bevel=0.012)
        if kind in ("sniper", "rifle"):
            sc = 1.6 if kind == "sniper" else 1.0
            cyl("scope", 0.032 * sc, 0.032 * sc, 0.18 * sc, ad, w, (0, rl * 0.22, 0.18), (R(-90), 0, 0), seg=10)
            cyl("scope_lens", 0.026 * sc, 0.026 * sc, 0.012, gl, w, (0, rl * 0.22 + 0.09 * sc + 0.006, 0.18), (R(-90), 0, 0), seg=10)
        empty("socket_muzzle", (0, tip, 0.07), w, role="socket_muzzle")
        empty("socket_ability", (0, rl * 0.3, 0.2), w, role="socket_ability")
    elif kind == "hammer":
        hl = max(reach + 0.35, 0.95)
        cyl("haft", 0.032, 0.032, hl + 0.3, st, w, (0, hl / 2 - 0.15, 0), (R(-90), 0, 0), seg=8)
        for y in (0.0, reach):
            cyl("haft_wrap", 0.04, 0.04, 0.12, m["frame"], w, (0, y, 0), (R(-90), 0, 0), seg=8)
        box("hammer_head", (0.20, 0.22, 0.46), ad, w, (0, hl, 0), bevel=0.05, seg=2)
        for z in (-0.17, 0.17):
            box("hammer_face", (0.22, 0.24, 0.06), tr, w, (0, hl, z), bevel=0.015)
        box("hammer_core", (0.225, 0.10, 0.10), gl, w, (0, hl, 0), bevel=0.01)
        cyl("pommel", 0.05, 0.04, 0.08, tr, w, (0, -0.32, 0), (R(-90), 0, 0), seg=8)
        empty("socket_muzzle", (0, hl, 0.25), w, role="socket_muzzle")
        empty("socket_ability", (0, hl, 0), w, role="socket_ability")
    else:  # blade
        bl = 0.95
        cyl("hilt", 0.03, 0.03, 0.30 + reach, m["frame"], w, (0, (reach - 0.3) / 2, 0), (R(-90), 0, 0), seg=8)
        box("guard", (0.08, 0.06, 0.30), tr, w, (0, reach + 0.13, 0), bevel=0.015)
        box("blade", (0.035, 0.12, bl), st, w, (0, reach + 0.16 + bl / 2, 0), (R(-90), 0, 0), bevel=0.01, taper=(0.4, 0.15))
        box("blade_edge", (0.04, 0.025, bl * 0.9), gl, w, (0, reach + 0.16 + bl * 0.45, 0.055), (R(-90), 0, 0), bevel=0, taper=(0.4, 0.4))
        cyl("pommel", 0.045, 0.035, 0.07, tr, w, (0, -0.17, 0), (R(-90), 0, 0), seg=8)
        empty("socket_muzzle", (0, reach + 0.16 + bl, 0), w, role="socket_muzzle")
        empty("socket_ability", (0, reach + 0.4, 0), w, role="socket_ability")
    return w


# ---------------------------------------------------------------------------
# assemble a marine from a recipe (same picks the runtime assembler makes)
# ---------------------------------------------------------------------------

def assemble(recipe, m, root_name="asset_root", hero_extras=None, bake_width=True):
    """bake_width: heroes bake width into the frame; runtime-style recipes scale the root instead."""
    r = empty(root_name, role="asset_root")
    width = recipe.get("width", 1.0)
    bulk = BODIES.get(recipe["body"], 1.0) * (width if bake_width else 1.0)
    weapon = recipe.get("weapon", "rifle")
    pose = recipe.get("pose") or ("melee2h" if weapon in ("hammer", "blade") else "rifle")
    f = build_body(r, m, bulk, pose, heavy_plates=recipe["body"] == "heavy", stripes=recipe.get("stripes", False))
    ps = recipe.get("pauldronScale", 1.0) * (0.75 + 0.25 * bulk) * (1.12 if recipe["body"] == "heavy" else 1.0)
    for side, mirror in (("l", True), ("r", False)):
        kind = recipe.get(f"pauldron{side.upper()}", recipe.get("pauldron", "dome"))
        p, sock = build_pauldron(kind, f[f"socket_pauldron_{side}"], m, ps, mirror)
        if recipe.get("emblem") and (side == "l" or recipe.get("emblemBoth")):
            build_emblem(recipe["emblem"], sock, m, s=1.15 * ps)
    if recipe.get("emblem"):
        build_emblem(recipe["emblem"], f["socket_emblem"], m, s=1.1)
    if recipe.get("helmet") is None:
        recipe.pop("helmet", None)
    hs = f["socket_head"]
    if recipe.get("helmet"):
        build_helmet(recipe["helmet"], hs, m)
    else:
        build_head(recipe.get("head", "square"), hs, m)
        build_hair(recipe.get("hair") or "bald", hs, m)
        build_beard(recipe.get("beard", "none"), hs, m)
        build_face(recipe.get("face", "plain"), hs, m)
    if recipe.get("backpack"):
        build_backpack(recipe["backpack"], f["socket_back"], m, 0.85 + 0.15 * bulk)
    if weapon and weapon != "custom":
        build_weapon(weapon, f["socket_weapon"], m, f["reach"] if bake_width else 0.55)
    if hero_extras:
        hero_extras(r, f, m, recipe)
    w = 1.0 if bake_width else width
    r.scale = (w, w, recipe.get("height", 1.0))
    return r, f


# ---------------------------------------------------------------------------
# hero signature extras
# ---------------------------------------------------------------------------

def cape(f, m, mat, width=0.62, length=1.05):
    c = empty("cape", (0, -0.54, 1.62), f["body"], (R(10), 0, 0))
    box("cape_cloth", (width, 0.035, length), mat, c, (0, -0.02, -length / 2), bevel=0.012, taper=(0.75, 1), btaper=(1.25, 1))
    box("cape_hem", (width * 1.24, 0.045, 0.05), m["trim"], c, (0, -0.02, -length + 0.02), bevel=0.01)
    for sx in (-1, 1):
        cyl("cape_clasp", 0.05, 0.05, 0.04, m["trim"], f["body"], (sx * 0.26, 0.14, 1.64), (R(90), 0, 0), seg=10)


def extras_alexander(r, f, m, rec):
    for i in range(3):
        sphere("nanite_pod", (0.035, 0.035, 0.035), m["glow"], f["socket_back"], ((i - 1) * 0.13, -0.24, 0.31), useg=8, vseg=5)
    band = empty("bandolier", (0, 0.02, 1.40), f["body"], (0, R(-35), 0))
    box("bandolier_strap", (0.07, 0.04, 0.70), m["frame"], band, (0, 0.26, 0), bevel=0.01)
    for z in (-0.18, 0.0, 0.18):
        box("cell", (0.06, 0.05, 0.08), m["trim"], band, (0, 0.285, z), bevel=0.01)


def extras_danny(r, f, m, rec):
    cape(f, m, m["cloth"], 0.58, 1.10)
    for side, sx in (("l", -1), ("r", 1)):
        box("thigh_knife", (0.04, 0.05, 0.20), m["steel"], f[f"leg_{side}"], (sx * 0.15, 0.0, -0.12), bevel=0.008)
    sphere("siphon_orb", (0.05, 0.05, 0.05), m["glow"], f["socket_hand_l"], (0, 0.05, -0.08), useg=10, vseg=6)


def extras_turtle(r, f, m, rec):
    body = f["body"]
    hl = f["hand_l"]
    sh = empty("shield", hl + Vector((-0.10, 0.16, 0.02)) - f["shoulder_l"], f["arm_l"], (R(-4), 0, R(-24)))
    box("shield_slab", (0.54, 0.10, 0.82), m["armor"], sh, (0, 0, 0), bevel=0.06, seg=2, btaper=(0.7, 1))
    box("shield_rim", (0.58, 0.08, 0.06), m["trim"], sh, (0, 0.0, 0.40), bevel=0.015)
    box("shield_spine", (0.08, 0.05, 0.70), m["armor_dark"], sh, (0, 0.06, -0.02), bevel=0.015, btaper=(0.6, 1))
    for i, (x, z) in enumerate(((0, 0.19), (-0.15, 0.09), (0.15, 0.09), (-0.13, -0.10), (0.13, -0.10), (0, -0.20), (0, 0))):
        hexplate("shield_hex", 0.068 if i < 6 else 0.06, 0.03, m["trim"] if i < 6 else m["glow"], sh, (x, 0.065, z), (0, 1, 0))
    for side in ("l", "r"):
        box("knee_spike_plate", (0.12, 0.05, 0.08), m["trim"], f[f"leg_{side}"], (0, 0.22, -0.30), bevel=0.01)


def extras_john(r, f, m, rec):
    for side in ("l", "r"):
        arm = f[f"forearm_{side}"]
        box("power_fist", (0.27, 0.29, 0.24), m["armor_dark"], arm, (0, 0.0, -0.40), bevel=0.05, seg=2, btaper=(1.1, 1.1))
        box("fist_plate", (0.28, 0.10, 0.12), m["armor"], arm, (0, 0.07, -0.33), bevel=0.03)
        for x in (-0.08, -0.027, 0.027, 0.08):
            box("knuckle", (0.05, 0.06, 0.06), m["steel"], arm, (x, 0.15, -0.44), bevel=0.012)
        box("fist_glow", (0.20, 0.03, 0.03), m["glow"], arm, (0, 0.145, -0.35), bevel=0.004)
    body = f["body"]
    # Panda pattern: bone-white torso, charcoal limbs and shoulders.
    black = ("thigh_plate", "greave", "bicep_plate", "vambrace", "pauldron_shell", "tasset", "boot", "power_fist")
    for o in body.children_recursive:
        if o.type == "MESH" and o.name.startswith(black):
            o.data.materials[0] = m["armor_dark"]
        elif o.type == "MESH" and o.name.startswith(("knee_guard", "greave_ridge", "elbow")):
            o.data.materials[0] = m["armor"]
    sphere("gourd", (0.07, 0.07, 0.09), m["cloth"], body, (0.27, 0.12, 0.92), useg=10, vseg=7)
    sphere("gourd_top", (0.045, 0.045, 0.05), m["cloth"], body, (0.27, 0.12, 1.02), useg=8, vseg=5)
    cyl("gourd_cork", 0.02, 0.02, 0.04, m["trim"], body, (0.27, 0.12, 1.07), seg=6)
    w = empty("weapon", f["hand_r"] - f["shoulder_r"], f["arm_r"], role="weapon")
    empty("socket_muzzle", (0, 0.2, 0), w, role="socket_muzzle")
    empty("socket_ability", (0, 0.1, 0.25), w, role="socket_ability")


def extras_tiger(r, f, m, rec):
    body = f["body"]
    w = empty("weapon", f["hand_r"] - f["shoulder_r"], f["arm_r"], role="weapon")
    for side in ("r", "l"):
        sx = 1 if side == "r" else -1
        holder = w if side == "r" else empty("weapon_offhand", f["hand_l"] - f["shoulder_l"], f["arm_l"])
        g = empty("claw_mount", (0, 0, 0), holder)
        aim(g, Vector((sx * 0.12, 1.0, -0.12)))
        box("claw_grip", (0.08, 0.10, 0.10), m["armor_dark"], g, (0, 0.02, 0), bevel=0.02)
        for i, x in enumerate((-0.045, 0.0, 0.045)):
            ln = 0.50 - abs(i - 1) * 0.08
            box("claw_blade", (0.018, 0.08, ln), m["steel"], g, (x, 0.05 + ln / 2, 0), (R(-90), 0, 0), bevel=0.004, taper=(0.4, 0.1))
            box("claw_edge", (0.02, 0.015, ln * 0.85), m["glow"], g, (x, 0.05 + ln * 0.45, 0.035), (R(-90), 0, 0), bevel=0, taper=(0.4, 0.3))
    empty("socket_muzzle", (0, 0.5, 0.2), w, role="socket_muzzle")
    empty("socket_ability", (0, 0.2, 0.2), w, role="socket_ability")


def extras_aaron(r, f, m, rec):
    body = f["body"]
    cape(f, m, m["cloth"], 0.66, 1.08)
    hs = f["socket_head"]
    torus("halo", 0.24, 0.018, m["glow"], hs, (0, -0.16, 0.36), (R(78), 0, 0), su=22, sv=5)
    w = empty("weapon", f["hand_r"] - f["shoulder_r"], f["arm_r"], role="weapon")
    cyl("staff_shaft", 0.03, 0.03, 2.05, m["steel"], w, (0, 0, 0.12), seg=8)
    for z in (0.0, 0.62):
        cyl("staff_wrap", 0.04, 0.04, 0.10, m["trim"], w, (0, 0, z), seg=8)
    cyl("staff_foot", 0.05, 0.02, 0.10, m["trim"], w, (0, 0, -0.93), seg=8)
    cyl("staff_crown", 0.04, 0.10, 0.10, m["trim"], w, (0, 0, 1.16), seg=8)
    for i in range(3):
        a = R(i * 120)
        box("staff_prong", (0.03, 0.03, 0.26), m["trim"], w, (math.cos(a) * 0.09, math.sin(a) * 0.09, 1.30), (math.sin(a) * R(-14), math.cos(a) * R(14), 0), bevel=0.006, taper=(0.3, 0.3))
    crystal = empty("crystal", (0, 0, 1.40), w)
    box("crystal_top", (0.10, 0.10, 0.16), m["glow"], crystal, (0, 0, 0.08), (0, 0, R(45)), bevel=0, taper=(0.02, 0.02))
    box("crystal_bot", (0.10, 0.10, 0.12), m["glow"], crystal, (0, 0, -0.06), (R(180), 0, R(45)), bevel=0, taper=(0.02, 0.02))
    torus("crystal_ring", 0.14, 0.012, m["trim"], crystal, (0, 0, 0), (R(70), R(20), 0), su=20, sv=5)
    empty("socket_muzzle", (0, 0, 1.40), w, role="socket_muzzle")
    empty("socket_ability", (0, 0, 1.40), w, role="socket_ability")
    sphere("ward_orb", (0.055, 0.055, 0.055), m["glow"], f["socket_hand_l"], (0, 0.06, -0.06), useg=10, vseg=6)


def extras_scott(r, f, m, rec):
    body = f["body"]
    for o in body.children_recursive:
        if o.type == "MESH" and o.name.startswith(("pauldron_ridge", "pauldron_fin")):
            o.data.materials[0] = m["trim"]
    for i in range(4):
        cyl("shell_round", 0.024, 0.024, 0.07, m["trim"], body, (-0.27 + i * 0.05, 0.225, 0.97), seg=8)
    gh = empty("gravity_hammer", (0.0, -0.56, 1.30), body, (0, R(35), 0))
    cyl("gh_haft", 0.025, 0.025, 0.85, m["steel"], gh, (0, 0, 0), seg=8)
    box("gh_head", (0.30, 0.16, 0.16), m["armor_dark"], gh, (0, 0, 0.45), bevel=0.03)
    box("gh_core", (0.31, 0.06, 0.06), m["glow"], gh, (0, 0.0, 0.45), bevel=0)


# ---------------------------------------------------------------------------
# hero line-up: identity from src/config.js (color / trim) + role
# ---------------------------------------------------------------------------

HEROES = {
    "alexander": dict(
        armor=0x2f8f46, armor_dark=0x153d20, trim=0xf3c53d, glow=0x59e8d8, skin=0xe2a982, hair=0x4a2e1a, cloth=0x1d3d26,
        recipe=dict(body="standard", head="sculpted", hair="crew", beard="mustache", face="plain", pauldron="dome", backpack="reactor", weapon="sniper", emblem="leaf"),
        extras=extras_alexander,
        note="Verdant green + polished gold, standard weight; bareheaded flattop commander with gold laurels, nanite pods and a long scoped marksman rifle."),
    "danny": dict(
        armor=0x2468c9, armor_dark=0x16294a, trim=0x8a93a3, glow=0x8cff5e, skin=0xd9a07a, hair=0x1a1410, cloth=0x1f2c4f,
        recipe=dict(body="light", helmet="hood", pauldron="swept", backpack="comms", weapon="sniper", emblem="crescent", width=0.95),
        extras=extras_danny,
        note="Cobalt blue + gunmetal, light frame; hooded stalker with toxic-green visor, swept pauldrons, cloak, comms mast and an extra-long sniper."),
    "turtle": dict(
        armor=0x2f5a4c, armor_dark=0x16271f, trim=0xc9bc86, glow=0x8fd0ff, skin=0xc8906a, hair=0x2a2018, cloth=0x2b3a33,
        recipe=dict(body="heavy", helmet="heavy", pauldron="block", backpack="shell", weapon="hammer", pose="shield", emblem="hex", width=1.08, pauldronScale=1.12),
        extras=extras_turtle,
        note="Sea-green + brass, heaviest frame; slab helm, huge block pauldrons, hex-plated turtle-shell reactor, hex tower shield and a war hammer."),
    "john": dict(
        armor=0xe9e5da, armor_dark=0x1d1d22, trim=0xd09a3a, glow=0xffa53a, skin=0xd8a27c, hair=0x111111, cloth=0xa0522d,
        recipe=dict(body="heavy", head="round", hair="topknot", beard="full", face="scar", pauldron="dome", backpack="reactor", weapon="custom", pose="fists", emblem="paw", width=0.98, emblemBoth=True),
        extras=extras_john,
        note="Panda bone-white torso + charcoal limbs and shoulders with amber trim, heavy brawler; bearded topknot with a scar, giant power fists with amber knuckle glow and a brew gourd."),
    "tiger": dict(
        armor=0xe0781f, armor_dark=0x2a1c12, trim=0x161412, glow=0xffd23a, skin=0xc98e66, hair=0x161412, cloth=0x161412,
        recipe=dict(body="standard", head="long", hair="mohawk", beard="goatee", face="warpaint", pauldron="swept", backpack="jump", weapon="custom", pose="twin", emblem="claw", stripes=True, width=0.94, pauldronScale=1.25, emblemBoth=True),
        extras=extras_tiger,
        note="Tiger orange with black stripes, lean standard frame; mohawk + war paint, jump pack, twin glowing triple claws."),
    "aaron": dict(
        armor=0x6a4fae, armor_dark=0x241840, trim=0xf0d060, glow=0x8fd6ff, skin=0xe4b08c, hair=0x2a1a10, cloth=0x3a2470,
        recipe=dict(body="standard", helmet="lenses", pauldron="tiered", backpack="reactor", weapon="custom", pose="staff", emblem="star", width=0.95),
        extras=extras_aaron,
        note="Royal violet + gold, standard frame; twin-lens warden helm with a floating halo, tiered pauldrons, cape and a crystal-crowned staff."),
    "scott": dict(
        armor=0xb32020, armor_dark=0x3e0a0a, trim=0xf4f1e8, glow=0x7aa8ff, skin=0xe0a47e, hair=0x3a2412, cloth=0x3a0c0c,
        recipe=dict(body="heavy", helmet="crest", pauldron="tiered", backpack="reactor", weapon="shotgun", emblem="chevron"),
        extras=extras_scott,
        note="Crimson + bone white, heavy frame; crested visor helm, banded tiered pauldrons, twin-barrel shotgun and a gravity hammer slung on his back."),
}


def hero_mats(key, h):
    c = {k: hexc(h[k]) for k in TINT_SLOTS}
    return palette_mats(key, c["armor"], c["armor_dark"], c["trim"], c["glow"], c["skin"], c["hair"], c["cloth"])


def build_hero(key):
    h = HEROES[key]
    root, f = assemble(dict(h["recipe"]), hero_mats(key, h), hero_extras=h["extras"])
    root["hero"] = key
    return root


# ---------------------------------------------------------------------------
# scene utils, export, render
# ---------------------------------------------------------------------------

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for blk in list(coll):
            if blk.users == 0:
                coll.remove(blk)


def hierarchy(root):
    return [root] + list(root.children_recursive)


def tri_count(root):
    n = 0
    for o in hierarchy(root):
        if o.type == "MESH":
            o.data.calc_loop_triangles()
            n += len(o.data.loop_triangles)
    return n


def turn_around(objs):
    """Rotate a whole hierarchy 180 deg about Z *inside every local frame*.

    The game faces units along +Z (facing = atan2(dx, dz)); Blender +Y exports
    to glTF -Z. Conjugating every node transform (R M R^-1) and every mesh by
    R makes each pivot's local axes face the game's forward too, so the
    runtime arm swing / attack raise / recoil (rotation.x, position.z) move
    the right way. R is its own inverse, so calling this twice restores.
    """
    rot = Matrix.Rotation(math.pi, 4, "Z")
    seen = set()
    for o in objs:
        if o.type == "MESH" and o.data.name not in seen:
            seen.add(o.data.name)
            o.data.transform(rot)
            o.data.update()
    for o in objs:
        o.matrix_basis = rot @ o.matrix_basis @ rot
    bpy.context.view_layer.update()


def export(objs, path):
    objs = list(objs)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    turn_around(objs)
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_cameras=False,
                                  export_lights=False, export_extras=True, export_apply=True)
    finally:
        turn_around(objs)


def setup_render(res, samples, threads):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    sc.cycles.device = "CPU"
    sc.render.threads_mode = "FIXED"
    sc.render.threads = threads
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    try:
        sc.view_settings.look = "Medium High Contrast"
    except Exception:
        pass
    sc.view_settings.exposure = -0.55
    w = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.05, 0.06, 0.08, 1)
    bg.inputs[1].default_value = 0.6


def add_light(name, loc, target, energy, color, size):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.color = color
    ld.size = size
    o = bpy.data.objects.new(name, ld)
    link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    o["render_only"] = True
    return o


def three_point(center, s=1.0):
    cx, cy, cz = center
    add_light("key", (cx - 4 * s, cy + 5 * s, cz + 5 * s), (cx, cy, cz), 2200 * s * s, (1.0, 0.92, 0.82), 3.0 * s)
    add_light("fill", (cx + 5 * s, cy + 3.5 * s, cz + 1.2 * s), (cx, cy, cz), 700 * s * s, (0.72, 0.84, 1.0), 4.0 * s)
    add_light("rim", (cx + 2.5 * s, cy - 5 * s, cz + 4 * s), (cx, cy, cz + 0.3), 2600 * s * s, (0.85, 0.95, 1.0), 2.0 * s)
    add_light("rim2", (cx - 3.5 * s, cy - 4 * s, cz + 2.5 * s), (cx, cy, cz + 0.3), 1200 * s * s, (1.0, 0.85, 0.7), 2.0 * s)


def ground(size=40):
    me = bpy.data.meshes.new("shadow_catcher")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    bm.to_mesh(me)
    bm.free()
    g = bpy.data.objects.new("shadow_catcher", me)
    link(g)
    g.is_shadow_catcher = True
    g["render_only"] = True
    return g


def camera(loc, target, ortho=None, lens=60):
    cd = bpy.data.cameras.new("cam")
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    else:
        cd.lens = lens
        cd.sensor_fit = "VERTICAL"
        cd.sensor_height = 24
    cd.clip_end = 300
    o = bpy.data.objects.new("cam", cd)
    link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = o
    o["render_only"] = True
    return o


def cam_orbit(target, dist, az_deg, el_deg):
    az, el = R(az_deg), R(el_deg)
    tx, ty, tz = target
    return (tx + dist * math.cos(el) * math.sin(az), ty + dist * math.cos(el) * math.cos(az), tz + dist * math.sin(el))


def render_to(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("rendered", path)


def clear_render_only():
    for o in list(bpy.data.objects):
        if o.get("render_only"):
            bpy.data.objects.remove(o, do_unlink=True)


# ---------------------------------------------------------------------------
# modular kit export
# ---------------------------------------------------------------------------

def export_kit(low=False):
    global LOW
    LOW = low
    clear_scene()
    _UID[0] = 0
    m = kit_mats()
    parts = {}
    roots = []

    def part(cat, var, fn):
        root = empty(f"kit_{cat}_{var}", role=f"kit_{cat}_{var}")
        root["kit_category"] = cat
        root["kit_variant"] = var
        fn(root)
        roots.append(root)
        parts.setdefault(cat, []).append(var)

    for var, bulk in BODIES.items():
        def mk(root, bulk=bulk, var=var):
            f = build_body(root, m, bulk, "rifle", heavy_plates=var == "heavy")
            root["reach"] = round(f["reach"], 4)
        part("body", var, mk)
    for var in HELMETS:
        part("helmet", var, lambda root, v=var: build_helmet(v, root, m))
    for var in HEADS:
        part("head", var, lambda root, v=var: build_head(v, root, m))
    for var in HAIRS[1:]:
        part("hair", var, lambda root, v=var: build_hair(v, root, m))
    for var in BEARDS[1:]:
        part("beard", var, lambda root, v=var: build_beard(v, root, m))
    for var in FACES[1:]:
        part("face", var, lambda root, v=var: build_face(v, root, m))
    for var in PAULDRONS:
        part("pauldron", var, lambda root, v=var: build_pauldron(v, root, m, 1.0, False))
    for var in BACKPACKS:
        part("backpack", var, lambda root, v=var: build_backpack(v, root, m))
    for var in WEAPONS:
        part("weapon", var, lambda root, v=var: build_weapon(v, root, m, 0.55))
    for var in EMBLEMS:
        part("emblem", var, lambda root, v=var: build_emblem(v, root, m))
    objs = [o for r in roots for o in hierarchy(r)]
    base = "marine_kit_lo" if low else "marine_kit"
    path = os.path.join(OUT, "kit", base + ".glb")
    export(objs, path)
    manifest = {
        "version": 1,
        "file": base + ".glb",
        "lod": "low" if low else "high",
        "parts": parts,
        "triangles": {r.name: tri_count(r) for r in roots},
        "tintSlots": list(TINT_SLOTS),
        "materials": sorted({ms.material.name for o in objs if o.type == "MESH" for ms in o.material_slots if ms.material}),
        "sockets": {
            "body": ["socket_head", "socket_back", "socket_pauldron_l", "socket_pauldron_r", "socket_emblem", "socket_weapon", "socket_hand_l", "socket_hand_r"],
            "pauldron": ["socket_emblem"],
            "weapon": ["socket_muzzle", "socket_ability"],
        },
        "conventions": "Every node carries extras.role (three.js userData.role). Part roots are kit_<category>_<variant>. Pauldrons are right-handed; mirror x for socket_pauldron_l. head/helmet/hair/beard/face attach at socket_head; weapons at socket_weapon (origin = right-hand grip, barrel forward). Materials tint_* are recoloured at runtime, fixed_* are not.",
    }
    with open(os.path.join(OUT, "kit", base + ".json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print("kit exported", path, "parts", sum(len(v) for v in parts.values()))


# ---------------------------------------------------------------------------
# Blender-side randomizer (runtime picks live in src/marine-recipe.js)
# ---------------------------------------------------------------------------

SKINS = [0xf1c7a5, 0xe2a982, 0xc98e66, 0xa86b48, 0x7d4a2e, 0x5a3420]
HAIR_COLS = [0x111111, 0x2a1a10, 0x4a2e1a, 0x7a4a22, 0xb08040, 0xd8c8a0, 0x8a8a8a, 0x8a2a14]


def random_recipe(rng):
    rec = dict(
        body=rng.choices(list(BODIES), [3, 5, 2])[0],
        pauldron=rng.choice(PAULDRONS), backpack=rng.choice(BACKPACKS), weapon=rng.choices(WEAPONS, [5, 3, 2, 2, 1, 1])[0],
        emblem=rng.choice(EMBLEMS), height=round(rng.uniform(0.96, 1.04), 3), width=round(rng.uniform(0.95, 1.05), 3),
        colors=dict(armor=rng.choice([0x2f8f46, 0x2468c9, 0xb32020, 0x6a4fae, 0x3f6b5e, 0xe0781f, 0x3a3a3f]),
                    trim=rng.choice([0xf3c53d, 0xf4f1e8, 0xc9bc86, 0x2a2e36]), glow=rng.choice([0x59e8d8, 0xff6a3a, 0x8fd6ff, 0x8cff5e]),
                    skin=rng.choice(SKINS), hair=rng.choice(HAIR_COLS), cloth=0x2a2a2a),
    )
    if rng.random() < 0.45:
        rec["helmet"] = rng.choice(HELMETS)
    else:
        rec.update(head=rng.choice(HEADS), hair=rng.choice(HAIRS), beard=rng.choice(BEARDS), face=rng.choices(FACES, [6, 2, 1, 1])[0])
    return rec


def recipe_mats(tag, rec):
    c = rec.get("colors", {})
    a = hexc(c.get("armor", 0x777777))
    ad = c.get("armorDark")
    return palette_mats(tag, a, hexc(ad) if ad is not None else mul(a, 0.45), hexc(c.get("trim", 0xdddddd)), hexc(c.get("glow", 0x8fd6ff)),
                        hexc(c.get("skin", 0xe2a982)), hexc(c.get("hair", 0x2a1a10)), hexc(c.get("cloth", 0x2a2a2a)))


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    samples = int(opt("--samples", 64))
    threads = int(opt("--threads", max(2, (os.cpu_count() or 4) // 2)))
    only = opt("--only")
    keys = [k for k in HEROES if not only or k in only.split(",")]
    stats = {}

    if flag("--heroes"):
        for k in keys:
            clear_scene()
            root = build_hero(k)
            stats[k] = tri_count(root)
            mats = {ms.material.name for o in hierarchy(root) if o.type == "MESH" for ms in o.material_slots}
            export(hierarchy(root), os.path.join(OUT, f"hero_{k}.glb"))
            print(f"hero {k}: {stats[k]} tris, {len(mats)} materials")
        with open(os.path.join(OUT, "hero_stats.json"), "w") as fh:
            json.dump({"triangles": stats, "notes": {k: HEROES[k]["note"] for k in stats}}, fh, indent=2)

    if flag("--kit"):
        export_kit()
    if flag("--kit-lod"):
        export_kit(low=True)
    LOW_SAVED = False  # noqa: heroes/renders below always use the full kit
    globals()["LOW"] = LOW_SAVED

    if flag("--render"):
        os.makedirs(RENDERS, exist_ok=True)
        if not flag("--lineups-only"):
            for k in keys:
                clear_scene()
                build_hero(k)
                setup_render((800, 1200), samples, threads)
                ground()
                three_point((0, 0, 1.2))
                camera(cam_orbit((0, 0, 1.2), 8.8, 28, 12), (0, 0, 1.2), lens=60)
                render_to(os.path.join(RENDERS, f"hero-{k}.png"))
        clear_scene()
        spacing = 1.75
        n = len(keys)
        for i, k in enumerate(keys):
            build_hero(k).location.x = (i - (n - 1) / 2) * spacing
        width = n * spacing + 0.6
        setup_render((2400, 1000), samples, threads)
        ground(80)
        three_point((0, 0, 1.2), 1.8)
        camera(cam_orbit((0, 0, 1.2), 30, 0, 6), (0, 0, 1.2), ortho=width)
        render_to(os.path.join(RENDERS, "lineup-front.png"))
        clear_render_only()
        setup_render((2400, 1300), samples, threads)
        ground(80)
        three_point((0, 0, 1.0), 1.8)
        camera(cam_orbit((0, 0.2, 0.9), 30, 32, 52), (0, 0.2, 0.9), ortho=width * 0.95)
        render_to(os.path.join(RENDERS, "lineup-rts.png"))

    demo = opt("--demo")
    if demo or opt("--random"):
        if demo:
            with open(demo) as fh:
                data = json.load(fh)
            recipes = data["recipes"] if isinstance(data, dict) else data
        else:
            rng = random.Random(int(opt("--seed", 1)))
            recipes = [random_recipe(rng) for _ in range(int(opt("--random")))]
        clear_scene()
        cols = min(8, len(recipes))
        rows = math.ceil(len(recipes) / cols)
        sp = 1.6
        roots = []
        for i, rec in enumerate(recipes):
            r, _ = assemble(rec, recipe_mats(f"demo{i}", rec), root_name=f"marine_{i}", bake_width=False)
            roots.append((r, ((i % cols - (cols - 1) / 2) * sp, -(i // cols) * sp * 1.3, 0)))
        if opt("--random"):
            for r, _ in roots:
                export(hierarchy(r), os.path.join(OUT, "variants", f"{r.name}.glb"))
            with open(os.path.join(OUT, "variants", "recipes.json"), "w") as fh:
                json.dump(recipes, fh, indent=1)
        for r, loc in roots:
            r.location = loc
        cy = -(rows - 1) * sp * 0.65
        setup_render((2400, 1350), samples, threads)
        ground(120)
        three_point((0, cy, 1.0), 2.4)
        camera(cam_orbit((0, cy, 0.9), 40, 18, 38), (0, cy, 0.9), ortho=cols * sp + 0.8)
        render_to(os.path.join(RENDERS, opt("--demo-out", "kit-demo-grid.png")))


main()
