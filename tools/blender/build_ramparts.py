# Culture ramparts, gatehouses, towers, keeps and houses.
#
# Regenerate from the repo root:
#   blender --background --python tools/blender/build_ramparts.py
#
# Wall curtains, corner posts, gatehouses and the rubble footing are original
# low-poly meshes. The Kenney castle-kit wall is a one-tile cube, so it cannot
# tile into a parapet. Keeps, houses and plot towers kitbash that CC0 kit
# (assets/props/kenney) and add a culture roof, door and lamps.
#
# Blender is Z-up. glTF export (Y-up) maps Blender +Z to glTF +Y and Blender
# -Y to glTF +Z. Curtain length runs along X. The outside face is Blender -Y
# so it arrives as glTF +Z, which the runtime treats as the outer face.
# A curtain module spans X = -0.5..0.5 so copies abut. Ends stay flush.

import math
import os

import bpy
import bmesh
from mathutils import Matrix

ROOT = os.getcwd()
KENNEY = os.path.join(ROOT, 'assets', 'props', 'kenney')
OUT = os.path.join(ROOT, 'assets', 'ramparts')
os.makedirs(OUT, exist_ok=True)


def rgb(hex_color):
    return ((hex_color >> 16) / 255, ((hex_color >> 8) & 255) / 255, (hex_color & 255) / 255)


def shade(color, factor):
    return tuple(max(0.0, min(1.0, c * factor)) for c in color)


PALS = {
    'european': {
        'stone': rgb(0xeee5cf), 'stone2': rgb(0xd8ccb1), 'stone3': rgb(0xb5a68a),
        'roof': rgb(0x3f70c8), 'trim': rgb(0xf2c14e), 'wood': rgb(0x9a6b44),
        'dark': rgb(0x343c4c), 'warm': rgb(0xffd27a), 'banner': rgb(0x3f70c8),
    },
    'asian': {
        'stone': rgb(0xf3ece0), 'stone2': rgb(0xd9c9b2), 'stone3': rgb(0x5f5a66),
        'roof': rgb(0x2f9a80), 'trim': rgb(0xe8bb48), 'wood': rgb(0xa8392e),
        'dark': rgb(0x2c2830), 'warm': rgb(0xffcf7a), 'banner': rgb(0xc8463a),
    },
    'south_american': {
        'stone': rgb(0xe6dab0), 'stone2': rgb(0xc9b98a), 'stone3': rgb(0x8c8a66),
        'roof': rgb(0x1f9a8a), 'trim': rgb(0xf2b632), 'wood': rgb(0x8a5a36),
        'dark': rgb(0x2d2a24), 'warm': rgb(0xffc86a), 'banner': rgb(0x1f9a8a),
    },
    'middle_eastern': {
        'stone': rgb(0xf2e0bc), 'stone2': rgb(0xdcc290), 'stone3': rgb(0xb48c5c),
        'roof': rgb(0x2fa6c4), 'trim': rgb(0xf0c75a), 'wood': rgb(0x8a5a36),
        'dark': rgb(0x2a2c38), 'warm': rgb(0xffd890), 'banner': rgb(0x2f8fb0),
    },
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material():
    mat = bpy.data.materials.new('flat')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat


def paint(obj, color):
    mesh = obj.data
    attr = mesh.color_attributes.get('Color')
    if attr is None:
        attr = mesh.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    for datum in attr.data:
        datum.color = (color[0], color[1], color[2], 1.0)
    mark_color(obj)


def new_bm():
    bm = bmesh.new()
    layer = bm.loops.layers.color.new('Color')
    return bm, layer


def _faces(verts):
    seen = set()
    out = []
    for vert in verts:
        for face in vert.link_faces:
            if face.index not in seen:
                seen.add(face.index)
                out.append(face)
    return out


def box(bm, layer, cx, cy, cz, w, h, d, color, rot=(0, 0, 0)):
    # w along X, h along Y, d along Z. Centered on (cx, cy, cz).
    geom = bmesh.ops.create_cube(bm, size=1.0)
    verts = geom['verts']
    bmesh.ops.scale(bm, verts=verts, vec=(w, h, d))
    rx, ry, rz = rot
    if abs(rx) > 1e-6:
        bmesh.ops.rotate(bm, verts=verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rx, 4, 'X'))
    if abs(ry) > 1e-6:
        bmesh.ops.rotate(bm, verts=verts, cent=(0, 0, 0), matrix=Matrix.Rotation(ry, 4, 'Y'))
    if abs(rz) > 1e-6:
        bmesh.ops.rotate(bm, verts=verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rz, 4, 'Z'))
    bmesh.ops.translate(bm, verts=verts, vec=(cx, cy, cz))
    for face in _faces(verts):
        for loop in face.loops:
            loop[layer] = (color[0], color[1], color[2], 1.0)
    return verts


def mark_color(obj):
    # glTF writes COLOR_0 only from the render color attribute. bmesh leaves
    # that index at -1, so the curtain would export white.
    mesh = obj.data
    if not mesh.color_attributes.get('Color'):
        return
    index = mesh.color_attributes.find('Color')
    mesh.color_attributes.active_color_index = index
    mesh.color_attributes.render_color_index = index


def bm_object(bm, name, mat):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    mark_color(obj)
    return obj


def bevel(obj, width=0.016):
    mod = obj.modifiers.new('Bevel', 'BEVEL')
    mod.width = width
    mod.segments = 1
    mod.limit_method = 'ANGLE'
    mod.angle_limit = 0.65
    mod.use_clamp_overlap = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def sit(objs):
    bpy.context.view_layer.update()
    body = objs[0]
    pts = [body.matrix_world @ v.co for v in body.data.vertices]
    minx = min(p.x for p in pts)
    maxx = max(p.x for p in pts)
    miny = min(p.y for p in pts)
    maxy = max(p.y for p in pts)
    minz = min(p.z for p in pts)
    delta = (-(minx + maxx) / 2, -(miny + maxy) / 2, -minz)
    for obj in objs:
        obj.location.x += delta[0]
        obj.location.y += delta[1]
        obj.location.z += delta[2]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def export(objs, filename):
    sit(objs)
    path = os.path.join(OUT, filename)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_colors=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_texcoords=False,
        export_animations=False,
    )
    tris = sum(len(obj.data.polygons) for obj in objs)
    print(f'exported {filename}  {tris} tris  {os.path.getsize(path)} bytes')


def finish(body, glow, filename, do_bevel=True):
    if do_bevel:
        bevel(body, 0.014)
    mark_color(body)
    if glow is not None:
        mark_color(glow)
    objs = [body] if glow is None else [body, glow]
    export(objs, filename)


# --- curtains ---------------------------------------------------------------

def courses(bm, layer, pal, z0, z1, depth, y=0.0):
    # Four ashlar slices. The two ends share a tone so neighbours meet cleanly.
    slices = ((-0.5, -0.25, pal['stone']), (-0.25, 0.0, pal['stone2']),
              (0.0, 0.25, pal['stone']), (0.25, 0.5, shade(pal['stone'], 0.96)))
    for x0, x1, color in slices:
        box(bm, layer, (x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0 + 0.004, depth, z1 - z0, color)


def european_wall(pal):
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 0.16, 1.0, 1.06, 0.32, pal['stone3'])
    courses(bm, layer, pal, 0.24, 2.12, 0.68)
    box(bm, layer, 0, 0, 1.15, 1.0, 0.76, 0.08, shade(pal['stone2'], 0.92))
    box(bm, layer, 0, 0, 2.16, 1.0, 0.9, 0.12, pal['stone2'])
    box(bm, layer, 0, 0.34, 2.32, 1.0, 0.1, 0.2, pal['stone'])
    for x in (-0.25, 0.25):
        box(bm, layer, x, -0.3, 2.42, 0.28, 0.22, 0.36, pal['stone'])
        box(bm, layer, x, -0.3, 2.62, 0.28, 0.16, 0.06, pal['roof'])
    # A couple of proud stones on the outer face.
    box(bm, layer, -0.12, -0.36, 0.85, 0.22, 0.06, 0.16, shade(pal['stone2'], 1.04))
    box(bm, layer, 0.22, -0.36, 1.45, 0.16, 0.06, 0.2, shade(pal['stone'], 0.94))
    box(bm, layer, 0.05, -0.36, 1.55, 0.08, 0.04, 0.22, pal['dark'])
    return bm_object(bm, 'body', material())


def asian_wall(pal):
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 0.14, 1.0, 0.96, 0.28, pal['stone3'])
    courses(bm, layer, pal, 0.2, 1.85, 0.64)
    box(bm, layer, 0, 0, 1.15, 1.0, 0.08, 0.55, pal['wood'])
    box(bm, layer, 0, 0, 1.72, 1.0, 0.72, 0.08, pal['trim'])
    # Tiled eaves. Outside is -Y. The eave turns up at its lip.
    box(bm, layer, 0, -0.02, 2.02, 1.0, 0.78, 0.08, pal['roof'], rot=(0.22, 0, 0))
    box(bm, layer, 0, 0.02, 2.02, 1.0, 0.78, 0.08, pal['roof'], rot=(-0.22, 0, 0))
    box(bm, layer, 0, 0, 2.28, 1.0, 0.16, 0.1, shade(pal['roof'], 0.85))
    box(bm, layer, 0, -0.46, 1.78, 0.7, 0.08, 0.08, pal['trim'], rot=(0.7, 0, 0))
    box(bm, layer, 0, 0.46, 1.78, 0.7, 0.08, 0.08, pal['trim'], rot=(-0.7, 0, 0))
    return bm_object(bm, 'body', material())


def south_wall(pal):
    # Fine ashlar courses with a small setback each time, so the wall reads as
    # dressed stone rather than a stack of crates. Gold is a thin inlay.
    bm, layer = new_bm()
    bands = (
        (0.40, 0.96, pal['stone3']),
        (0.36, 0.90, pal['stone']),
        (0.34, 0.84, pal['stone2']),
        (0.32, 0.78, pal['stone']),
        (0.30, 0.72, pal['stone2']),
        (0.28, 0.66, pal['stone']),
    )
    z = 0.0
    for height, depth, color in bands:
        box(bm, layer, 0, 0, z + height / 2, 1.0, depth, height + 0.012, color)
        z += height * 0.9
    box(bm, layer, 0, 0, z + 0.05, 1.0, 0.74, 0.1, pal['stone2'])
    box(bm, layer, 0, -0.40, 0.72, 1.0, 0.035, 0.055, pal['roof'])
    box(bm, layer, 0, -0.36, z - 0.08, 0.72, 0.03, 0.045, pal['trim'])
    return bm_object(bm, 'body', material())


def eastern_wall(pal):
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 0.28, 1.0, 1.02, 0.56, pal['stone3'])
    courses(bm, layer, pal, 0.4, 1.55, 0.78)
    courses(bm, layer, pal, 1.45, 2.15, 0.6)
    box(bm, layer, 0, 0, 2.12, 1.0, 0.78, 0.1, pal['roof'])
    box(bm, layer, 0, 0, 2.24, 1.0, 0.7, 0.12, pal['stone2'])
    for x in (-0.25, 0.25):
        box(bm, layer, x, -0.28, 2.36, 0.22, 0.16, 0.16, pal['stone'])
        # Rounded merlon.
        geom = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.13)
        bmesh.ops.scale(bm, verts=geom['verts'], vec=(1.15, 0.7, 1.0))
        bmesh.ops.translate(bm, verts=geom['verts'], vec=(x, -0.28, 2.5))
        for face in _faces(geom['verts']):
            for loop in face.loops:
                loop[layer] = (*pal['stone'], 1.0)
    return bm_object(bm, 'body', material())


WALLS = {
    'european': european_wall,
    'asian': asian_wall,
    'south_american': south_wall,
    'middle_eastern': eastern_wall,
}


def rubble():
    pal = PALS['european']
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 0.1, 1.0, 0.92, 0.2, shade(pal['stone3'], 0.9))
    box(bm, layer, -0.18, 0.02, 0.24, 0.42, 0.55, 0.16, shade(pal['stone2'], 0.88))
    box(bm, layer, 0.2, -0.04, 0.22, 0.34, 0.4, 0.12, shade(pal['stone'], 0.8))
    box(bm, layer, 0.02, 0.12, 0.18, 0.2, 0.28, 0.08, shade(pal['stone3'], 0.75))
    return bm_object(bm, 'body', material())


# --- posts and gates --------------------------------------------------------

def european_post(pal):
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 0.18, 1.5, 1.5, 0.36, pal['stone3'])
    box(bm, layer, 0, 0, 1.55, 1.22, 1.22, 2.4, pal['stone'])
    box(bm, layer, 0, 0, 1.2, 1.28, 0.08, 0.5, shade(pal['stone2'], 0.94))
    box(bm, layer, 0, 0, 2.82, 1.4, 1.4, 0.14, pal['stone2'])
    for x in (-0.48, 0.48):
        for y in (-0.48, 0.48):
            box(bm, layer, x, y, 3.05, 0.28, 0.28, 0.32, pal['stone'])
    box(bm, layer, 0, -0.64, 1.7, 0.16, 0.06, 0.36, pal['dark'])
    return bm_object(bm, 'body', material())


def asian_post(pal):
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 0.16, 1.35, 1.35, 0.32, pal['stone3'])
    box(bm, layer, 0, 0, 1.35, 1.05, 1.05, 2.05, pal['stone'])
    box(bm, layer, 0, 0, 1.15, 1.12, 0.08, 0.7, pal['wood'])
    box(bm, layer, 0, 0, 2.5, 1.55, 1.55, 0.08, pal['trim'])
    box(bm, layer, 0, 0, 2.72, 1.7, 1.7, 0.1, pal['roof'], rot=(0.0, 0, 0))
    box(bm, layer, 0, -0.15, 2.85, 1.45, 0.9, 0.08, pal['roof'], rot=(0.28, 0, 0))
    box(bm, layer, 0, 0.15, 2.85, 1.45, 0.9, 0.08, pal['roof'], rot=(-0.28, 0, 0))
    box(bm, layer, 0, 0, 3.15, 0.28, 0.28, 0.22, pal['trim'])
    return bm_object(bm, 'body', material())


def south_post(pal):
    bm, layer = new_bm()
    tiers = (
        (1.28, 0.42, pal['stone3']),
        (1.14, 0.38, pal['stone']),
        (1.0, 0.36, pal['stone2']),
        (0.86, 0.34, pal['stone']),
        (0.72, 0.32, pal['stone2']),
    )
    z = 0.0
    for width, height, color in tiers:
        box(bm, layer, 0, 0, z + height / 2, width, width, height, color)
        z += height * 0.88
    box(bm, layer, 0, 0, z + 0.06, 0.86, 0.86, 0.1, pal['stone'])
    box(bm, layer, 0, 0, z + 0.22, 0.48, 0.42, 0.28, pal['stone2'])
    box(bm, layer, 0, 0, z + 0.4, 0.62, 0.55, 0.08, pal['stone3'])
    box(bm, layer, 0, -0.24, z + 0.28, 0.14, 0.04, 0.14, pal['trim'])
    return bm_object(bm, 'body', material())


def eastern_post(pal):
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 0.16, 1.4, 1.4, 0.32, pal['stone3'])
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.58, radius2=0.5, depth=2.15)
    bmesh.ops.translate(bm, verts=geom['verts'], vec=(0, 0, 1.4))
    for face in _faces(geom['verts']):
        for loop in face.loops:
            loop[layer] = (*pal['stone'], 1.0)
    box(bm, layer, 0, 0, 2.5, 1.25, 1.25, 0.1, pal['roof'])
    dome = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.42)
    upper = [v for v in dome['verts'] if v.co.z < -0.02]
    bmesh.ops.delete(bm, geom=upper, context='VERTS')
    rest = [v for v in dome['verts'] if v.is_valid]
    bmesh.ops.translate(bm, verts=rest, vec=(0, 0, 2.55))
    for face in _faces(rest):
        for loop in face.loops:
            loop[layer] = (*pal['roof'], 1.0)
    box(bm, layer, 0, 0, 3.05, 0.06, 0.06, 0.28, pal['trim'])
    return bm_object(bm, 'body', material())


POSTS = {
    'european': european_post,
    'asian': asian_post,
    'south_american': south_post,
    'middle_eastern': eastern_post,
}


def arch_boxes(bm, layer, pal, radius, spring, depth, pointed=False):
    color = pal['stone2']
    if pointed:
        peak = spring + radius * 1.35
        for sign in (-1, 1):
            x0, z0 = sign * radius, spring
            x1, z1 = 0, peak
            length = math.hypot(x1 - x0, z1 - z0)
            ang = math.atan2(z1 - z0, x1 - x0)
            box(bm, layer, (x0 + x1) / 2, 0, (z0 + z1) / 2, length, depth, 0.32, color, rot=(0, math.pi / 2 - ang, 0))
        return
    steps = 8
    for i in range(steps):
        a0 = math.pi * i / steps
        a1 = math.pi * (i + 1) / steps
        am = (a0 + a1) / 2
        chord = radius * (a1 - a0) * 1.25
        x = math.cos(am) * radius
        z = spring + math.sin(am) * radius
        box(bm, layer, x, 0, z, chord, depth, 0.3, color, rot=(0, am + math.pi / 2, 0))


def door_pair(bm, layer, pal, half, height):
    for sign, ang in ((-1, 0.7), (1, math.pi - 0.7)):
        hinge_x = sign * half
        width = half * 0.92
        cx = hinge_x + math.cos(ang) * width / 2
        cy = math.sin(ang) * width / 2
        box(bm, layer, cx, cy, height / 2, width, 0.08, height, pal['wood'], rot=(0, 0, ang))
        box(bm, layer, cx, cy, height * 0.72, width * 0.55, 0.09, 0.08, pal['trim'], rot=(0, 0, ang))


def gate(pal, kind):
    bm, layer = new_bm()
    glow_bm, glow_layer = new_bm()
    span = 1.32
    if kind == 'south_american':
        # Dressed piers, a trapezoid doorway, and a corbelled temple top.
        for sign in (-1, 1):
            pier = (
                (1.05, 0.48, pal['stone3']),
                (0.92, 0.42, pal['stone']),
                (0.78, 0.4, pal['stone2']),
            )
            pz = 0.0
            for width, height, color in pier:
                box(bm, layer, sign * 1.32, 0, pz + height / 2, width, 1.08, height, color)
                pz += height * 0.9
        # Jambs lean in, so the opening is wider at the road than at the lintel.
        for sign in (-1, 1):
            box(bm, layer, sign * 0.72, 0, 0.85, 0.28, 0.9, 1.7, pal['stone'], rot=(0, 0, sign * 0.08))
        box(bm, layer, 0, 0, 1.78, 2.15, 1.12, 0.22, pal['stone2'])
        box(bm, layer, 0, 0, 2.02, 2.45, 1.28, 0.14, pal['stone'])
        box(bm, layer, 0, 0, 2.2, 2.05, 1.08, 0.12, pal['stone2'])
        box(bm, layer, 0, 0, 2.36, 1.45, 0.78, 0.12, pal['stone'])
        box(bm, layer, 0, -0.58, 2.08, 0.2, 0.05, 0.2, pal['trim'])
        box(bm, layer, 0, -0.56, 1.55, 1.35, 0.04, 0.05, pal['roof'])
        door_pair(bm, layer, pal, 0.62, 1.55)
    elif kind == 'asian':
        for sign in (-1, 1):
            box(bm, layer, sign * 1.4, 0, 1.15, 1.0, 1.15, 2.3, pal['stone'])
            box(bm, layer, sign * 1.4, 0, 0.16, 1.2, 1.3, 0.32, pal['stone3'])
        arch_boxes(bm, layer, pal, 0.95, 1.35, 0.85)
        box(bm, layer, 0, 0, 2.55, 3.5, 1.7, 0.1, pal['trim'])
        box(bm, layer, 0, -0.05, 2.85, 3.7, 1.9, 0.1, pal['roof'], rot=(0.18, 0, 0))
        box(bm, layer, 0, 0.05, 2.85, 3.7, 1.9, 0.1, pal['roof'], rot=(-0.18, 0, 0))
        box(bm, layer, 0, 0, 3.15, 3.2, 0.2, 0.12, shade(pal['roof'], 0.85))
        door_pair(bm, layer, pal, 0.78, 1.65)
        box(glow_bm, glow_layer, 0, -0.7, 2.7, 0.16, 0.1, 0.22, pal['warm'])
    elif kind == 'middle_eastern':
        for sign in (-1, 1):
            box(bm, layer, sign * 1.42, 0, 0.18, 1.15, 1.25, 0.36, pal['stone3'])
            cone = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.48, radius2=0.4, depth=2.3)
            bmesh.ops.translate(bm, verts=cone['verts'], vec=(sign * 1.42, 0, 1.5))
            for face in _faces(cone['verts']):
                for loop in face.loops:
                    loop[layer] = (*pal['stone'], 1.0)
            dome = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.36)
            lower = [v for v in dome['verts'] if v.co.z < -0.02]
            bmesh.ops.delete(bm, geom=lower, context='VERTS')
            rest = [v for v in dome['verts'] if v.is_valid]
            bmesh.ops.translate(bm, verts=rest, vec=(sign * 1.42, 0, 2.65))
            for face in _faces(rest):
                for loop in face.loops:
                    loop[layer] = (*pal['roof'], 1.0)
        arch_boxes(bm, layer, pal, 0.9, 1.15, 0.9, pointed=True)
        box(bm, layer, 0, 0, 2.55, 2.2, 1.15, 0.16, pal['stone2'])
        box(bm, layer, 0, 0, 2.15, 1.5, 0.96, 0.08, pal['roof'])
        door_pair(bm, layer, pal, 0.7, 1.7)
    else:
        for sign in (-1, 1):
            box(bm, layer, sign * 1.38, 0, 0.18, 1.15, 1.3, 0.36, pal['stone3'])
            box(bm, layer, sign * 1.38, 0, 1.55, 1.0, 1.12, 2.4, pal['stone'])
            box(bm, layer, sign * 1.38, 0, 2.82, 1.15, 1.25, 0.12, pal['stone2'])
            for x in (-0.32, 0.32):
                for y in (-0.36, 0.36):
                    box(bm, layer, sign * 1.38 + x, y, 3.02, 0.22, 0.22, 0.26, pal['stone'])
        arch_boxes(bm, layer, pal, 0.92, 1.4, 0.95)
        box(bm, layer, 0, 0, 2.55, 1.7, 1.2, 0.28, pal['stone'])
        box(bm, layer, 0, -0.42, 2.78, 1.9, 0.16, 0.22, pal['stone2'])
        door_pair(bm, layer, pal, 0.75, 1.7)
        box(bm, layer, 0, -0.55, 2.15, 0.1, 0.06, 0.28, pal['dark'])
    # Threshold, so the road reads through the arch.
    box(bm, layer, 0, 0, 0.04, span, 1.15, 0.08, shade(pal['stone3'], 0.85))
    body = bm_object(bm, 'body', material())
    glow = None
    if kind == 'asian':
        glow = bm_object(glow_bm, 'glow', material())
        paint(glow, pal['warm'])
    else:
        glow_bm.free()
    return body, glow


# --- Kenney kitbash for keeps, houses, spires ------------------------------

def import_kenney(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(KENNEY, name + '.glb'))
    created = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in created if obj.type == 'MESH']
    obj = meshes[0]
    if obj.parent:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    return obj


def put(name, x, y, z, scale, color, rot=0.0):
    obj = import_kenney(name)
    obj.location = (x, y, z)
    obj.scale = scale
    obj.rotation_euler[2] = rot
    paint(obj, color)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


def glow_boxes(spots, color):
    bm, layer = new_bm()
    for x, y, z, w, h, d in spots:
        box(bm, layer, x, y, z, w, h, d, color)
    obj = bm_object(bm, 'glow', material())
    paint(obj, color)
    return obj


def european_keep(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (1.7, 1.45, 0.28), pal['stone3']),
        put('tower-square-mid-windows', 0, 0, 0.26, (1.25, 1.05, 0.72), pal['stone']),
        put('tower-square', 0, 0, 0.98, (1.05, 0.9, 0.48), pal['stone2']),
        put('tower-square-top-roof', 0, 0, 1.42, (1.35, 1.15, 0.55), pal['roof']),
        put('tower-square', -0.55, -0.15, 1.35, (0.28, 0.28, 0.55), pal['stone3']),
        put('tower-square-top-roof', -0.55, -0.15, 1.9, (0.38, 0.38, 0.28), pal['roof']),
        put('tower-square', 0.48, 0.2, 1.4, (0.22, 0.22, 0.42), pal['stone']),
    ]
    body = join(parts, 'body')
    glow = glow_boxes([
        (-0.28, -0.58, 0.62, 0.16, 0.06, 0.2),
        (0.28, -0.58, 0.62, 0.16, 0.06, 0.2),
        (0, -0.58, 0.95, 0.14, 0.06, 0.16),
    ], pal['warm'])
    # Door on the outer face.
    bm, layer = new_bm()
    box(bm, layer, 0, -0.56, 0.38, 0.28, 0.08, 0.48, pal['dark'])
    box(bm, layer, 0, -0.6, 0.38, 0.2, 0.06, 0.4, pal['wood'])
    box(bm, layer, 0, -0.1, 2.05, 1.45, 0.85, 0.1, pal['roof'], rot=(0.5, 0, 0))
    box(bm, layer, 0, 0.1, 2.05, 1.45, 0.85, 0.1, pal['roof'], rot=(-0.5, 0, 0))
    box(bm, layer, 0.62, 0.15, 1.45, 0.24, 0.24, 0.9, pal['stone3'])
    box(bm, layer, 0.62, 0.15, 2.1, 0.32, 0.32, 0.24, pal['roof'])
    extra = bm_object(bm, 'door', material())
    body = join([body, extra], 'body')
    return body, glow


def asian_keep(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (1.55, 1.35, 0.22), pal['stone3']),
        put('tower-square-mid-windows', 0, 0, 0.2, (1.15, 1.0, 0.7), pal['stone']),
        put('wall-narrow-wood', 0, 0, 0.9, (1.45, 1.25, 0.12), pal['wood']),
        put('tower-square', 0, 0, 0.95, (0.85, 0.75, 0.45), pal['stone2']),
    ]
    body = join(parts, 'body')
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 1.5, 1.7, 1.5, 0.08, pal['trim'])
    box(bm, layer, 0, -0.08, 1.72, 1.85, 1.15, 0.08, pal['roof'], rot=(0.22, 0, 0))
    box(bm, layer, 0, 0.08, 1.72, 1.85, 1.15, 0.08, pal['roof'], rot=(-0.22, 0, 0))
    box(bm, layer, 0, 0, 2.05, 1.15, 1.0, 0.08, pal['trim'])
    box(bm, layer, 0, -0.05, 2.22, 1.3, 0.85, 0.08, pal['roof'], rot=(0.28, 0, 0))
    box(bm, layer, 0, 0.05, 2.22, 1.3, 0.85, 0.08, pal['roof'], rot=(-0.28, 0, 0))
    box(bm, layer, 0, -0.62, 0.48, 0.26, 0.08, 0.46, pal['dark'])
    extra = bm_object(bm, 'roof', material())
    body = join([body, extra], 'body')
    glow = glow_boxes([
        (0, -0.55, 1.15, 0.14, 0.08, 0.18),
        (-0.32, -0.55, 0.55, 0.12, 0.06, 0.16),
        (0.32, -0.55, 0.55, 0.12, 0.06, 0.16),
    ], pal['warm'])
    return body, glow


def south_keep(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (1.9, 1.65, 0.28), pal['stone3']),
        put('tower-square-base', 0, 0, 0.24, (1.5, 1.28, 0.26), pal['stone']),
        put('tower-square-base', 0, 0, 0.46, (1.12, 0.96, 0.24), pal['stone2']),
        put('stairs-stone', 0, -1.05, 0, (1.4, 0.75, 0.6), pal['stone2']),
        put('tower-square', 0, 0, 0.68, (0.62, 0.52, 0.42), pal['stone']),
    ]
    body = join(parts, 'body')
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 1.16, 0.78, 0.66, 0.1, pal['stone'])
    box(bm, layer, 0, 0, 1.32, 0.5, 0.42, 0.22, pal['stone2'])
    box(bm, layer, 0, -0.24, 1.28, 0.14, 0.05, 0.14, pal['trim'])
    box(bm, layer, 0, -0.52, 0.62, 1.2, 0.045, 0.06, pal['roof'])
    extra = bm_object(bm, 'top', material())
    body = join([body, extra], 'body')
    glow = glow_boxes([(0, -0.3, 0.92, 0.12, 0.06, 0.14)], pal['warm'])
    return body, glow


def eastern_keep(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (1.7, 1.5, 0.26), pal['stone3']),
        put('tower-square-mid-windows', 0, 0, 0.24, (1.3, 1.15, 0.6), pal['stone']),
        put('tower-square', 0, 0, 0.82, (1.05, 0.95, 0.45), pal['stone2']),
        put('tower-hexagon-roof', 0, 0, 1.22, (1.15, 1.15, 0.7), pal['roof']),
        put('tower-square', -0.78, 0.15, 0.2, (0.28, 0.28, 1.15), pal['stone']),
        put('tower-hexagon-roof', -0.78, 0.15, 1.35, (0.4, 0.4, 0.4), pal['roof']),
        put('tower-square', 0.78, -0.1, 0.2, (0.24, 0.24, 0.95), pal['stone2']),
        put('tower-hexagon-roof', 0.78, -0.1, 1.15, (0.34, 0.34, 0.36), pal['roof']),
    ]
    body = join(parts, 'body')
    bm, layer = new_bm()
    box(bm, layer, 0, -0.62, 0.42, 0.32, 0.08, 0.55, pal['dark'])
    box(bm, layer, 0, 0, 1.15, 0.9, 0.08, 0.08, pal['trim'])
    extra = bm_object(bm, 'door', material())
    body = join([body, extra], 'body')
    glow = glow_boxes([
        (-0.3, -0.62, 0.7, 0.12, 0.06, 0.18),
        (0.3, -0.62, 0.7, 0.12, 0.06, 0.18),
    ], pal['warm'])
    return body, glow


KEEPS = {
    'european': european_keep,
    'asian': asian_keep,
    'south_american': south_keep,
    'middle_eastern': eastern_keep,
}


def european_house(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (1.25, 1.05, 0.16), pal['stone3']),
        put('tower-square-mid-windows', 0, 0, 0.14, (1.05, 0.9, 0.62), pal['stone']),
        put('tower-square-top-roof', 0, 0, 0.74, (1.25, 1.05, 0.42), pal['roof']),
    ]
    body = join(parts, 'body')
    bm, layer = new_bm()
    box(bm, layer, 0, -0.48, 0.32, 0.2, 0.06, 0.36, pal['wood'])
    extra = bm_object(bm, 'door', material())
    body = join([body, extra], 'body')
    glow = glow_boxes([(-0.28, -0.48, 0.48, 0.12, 0.05, 0.14), (0.28, -0.48, 0.48, 0.12, 0.05, 0.14)], pal['warm'])
    return body, glow


def asian_house(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (1.2, 1.05, 0.14), pal['stone3']),
        put('tower-square-mid-windows', 0, 0, 0.12, (1.0, 0.88, 0.55), pal['stone']),
        put('wall-narrow-wood', 0, 0, 0.66, (1.3, 1.15, 0.1), pal['wood']),
    ]
    body = join(parts, 'body')
    bm, layer = new_bm()
    box(bm, layer, 0, -0.04, 0.82, 1.45, 1.2, 0.08, pal['roof'], rot=(0.2, 0, 0))
    box(bm, layer, 0, 0.04, 0.82, 1.45, 1.2, 0.08, pal['roof'], rot=(-0.2, 0, 0))
    box(bm, layer, 0, -0.48, 0.3, 0.18, 0.06, 0.32, pal['dark'])
    extra = bm_object(bm, 'roof', material())
    body = join([body, extra], 'body')
    glow = glow_boxes([(0.3, -0.48, 0.42, 0.1, 0.05, 0.12)], pal['warm'])
    return body, glow


def south_house(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (1.35, 1.15, 0.2), pal['stone3']),
        put('tower-square-base', 0, 0, 0.16, (1.05, 0.9, 0.22), pal['stone']),
        put('tower-square', 0, 0, 0.36, (0.62, 0.52, 0.36), pal['stone2']),
        put('stairs-stone', 0, -0.72, 0, (0.85, 0.48, 0.42), pal['stone2']),
    ]
    body = join(parts, 'body')
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 0.78, 0.7, 0.58, 0.08, pal['stone'])
    box(bm, layer, 0, -0.28, 0.74, 0.12, 0.04, 0.12, pal['trim'])
    extra = bm_object(bm, 'top', material())
    body = join([body, extra], 'body')
    glow = glow_boxes([(0, -0.3, 0.52, 0.1, 0.05, 0.1)], pal['warm'])
    return body, glow


def eastern_house(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (1.2, 1.05, 0.16), pal['stone3']),
        put('tower-square', 0, 0, 0.14, (0.95, 0.85, 0.55), pal['stone']),
        put('tower-hexagon-roof', 0, 0, 0.68, (0.85, 0.85, 0.48), pal['roof']),
    ]
    body = join(parts, 'body')
    bm, layer = new_bm()
    box(bm, layer, 0, -0.46, 0.28, 0.2, 0.06, 0.34, pal['dark'])
    extra = bm_object(bm, 'door', material())
    body = join([body, extra], 'body')
    glow = glow_boxes([(-0.22, -0.46, 0.48, 0.1, 0.05, 0.14), (0.22, -0.46, 0.48, 0.1, 0.05, 0.14)], pal['warm'])
    return body, glow


HOUSES = {
    'european': european_house,
    'asian': asian_house,
    'south_american': south_house,
    'middle_eastern': eastern_house,
}


def european_spire(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (0.85, 0.85, 0.18), pal['stone3']),
        put('tower-square-mid-windows', 0, 0, 0.16, (0.7, 0.7, 0.55), pal['stone']),
        put('tower-square', 0, 0, 0.7, (0.5, 0.5, 0.55), pal['stone2']),
        put('tower-square-top-roof', 0, 0, 1.22, (0.75, 0.75, 0.4), pal['roof']),
    ]
    return join(parts, 'body'), None


def asian_spire(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (0.8, 0.8, 0.14), pal['stone3']),
        put('tower-square', 0, 0, 0.12, (0.6, 0.6, 0.7), pal['stone']),
        put('wall-narrow-wood', 0, 0, 0.8, (0.95, 0.95, 0.1), pal['wood']),
    ]
    body = join(parts, 'body')
    bm, layer = new_bm()
    box(bm, layer, 0, -0.02, 1.0, 1.05, 0.85, 0.07, pal['roof'], rot=(0.25, 0, 0))
    box(bm, layer, 0, 0.02, 1.0, 1.05, 0.85, 0.07, pal['roof'], rot=(-0.25, 0, 0))
    box(bm, layer, 0, 0, 1.28, 0.45, 0.4, 0.28, pal['stone'])
    box(bm, layer, 0, 0, 1.55, 0.6, 0.5, 0.06, pal['roof'])
    extra = bm_object(bm, 'roof', material())
    return join([body, extra], 'body'), None


def south_spire(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (0.95, 0.95, 0.28), pal['stone3']),
        put('tower-square-base', 0, 0, 0.24, (0.7, 0.7, 0.32), pal['stone']),
        put('tower-square', 0, 0, 0.52, (0.45, 0.45, 0.4), pal['stone2']),
    ]
    body = join(parts, 'body')
    bm, layer = new_bm()
    box(bm, layer, 0, 0, 0.95, 0.4, 0.4, 0.08, pal['trim'])
    extra = bm_object(bm, 'top', material())
    return join([body, extra], 'body'), None


def eastern_spire(pal):
    parts = [
        put('tower-square-base', 0, 0, 0, (0.8, 0.8, 0.16), pal['stone3']),
        put('tower-square', 0, 0, 0.14, (0.55, 0.55, 0.9), pal['stone']),
        put('tower-hexagon-roof', 0, 0, 1.02, (0.7, 0.7, 0.45), pal['roof']),
    ]
    return join(parts, 'body'), None


SPIRES = {
    'european': european_spire,
    'asian': asian_spire,
    'south_american': south_spire,
    'middle_eastern': eastern_spire,
}


def main():
    only = os.environ.get('RAMPART_ONLY', '')
    keys = [k for k in PALS if not only or k == only]
    if not only:
        reset()
        body = rubble()
        finish(body, None, 'rubble.glb', do_bevel=True)
    for key in keys:
        pal = PALS[key]
        reset()
        finish(WALLS[key](pal), None, f'{key}-wall.glb')
        reset()
        finish(POSTS[key](pal), None, f'{key}-post.glb')
        reset()
        body, glow = gate(pal, key)
        finish(body, glow, f'{key}-gate.glb', do_bevel=False)
        reset()
        body, glow = KEEPS[key](pal)
        finish(body, glow, f'{key}-keep.glb', do_bevel=False)
        reset()
        body, glow = HOUSES[key](pal)
        finish(body, glow, f'{key}-house.glb', do_bevel=False)
        reset()
        body, glow = SPIRES[key](pal)
        finish(body, glow, f'{key}-spire.glb', do_bevel=False)


if __name__ == '__main__':
    main()
