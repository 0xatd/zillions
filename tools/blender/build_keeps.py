# Culture keeps and houses from the Kenney Fantasy Town Kit (CC0).
# Stone masses are chamfered and wrapped with trim so the stack reads as one
# carved building. Culture roofs, turrets and banners sit on that mass.
# The long kit stairs are not used: they read as a stray plank in front of
# the door.
#
#   blender --background --python tools/blender/build_keeps.py
#
# Output: assets/keeps/<culture>-keep.glb and <culture>-house.glb
# A keep is authored about 2.55 tall and a house about 1.15, so after the
# game's visual scale the keep is a little under three times a house.

import math
import os

import bpy
import bmesh
from mathutils import Matrix

ROOT = os.getcwd()
KIT = '/tmp/ftk/Models/GLB format'
if not os.path.isdir(KIT):
    KIT = os.path.join(ROOT, 'assets', 'town', 'kenney')
OUT = os.environ.get('KEEP_OUT') or os.path.join(ROOT, 'assets', 'keeps')
os.makedirs(OUT, exist_ok=True)


def rgb(hex_color):
    return ((hex_color >> 16) / 255, ((hex_color >> 8) & 255) / 255, (hex_color & 255) / 255)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_piece(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(KIT, name + '.glb'))
    meshes = [obj for obj in bpy.data.objects if obj not in before and obj.type == 'MESH']
    obj = meshes[0]
    if obj.parent:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    return obj


def chamfer(obj, width=0.045):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Bevel', 'BEVEL')
    mod.width = width
    mod.segments = 1
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(32)
    if hasattr(mod, 'use_clamp_overlap'):
        mod.use_clamp_overlap = True
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except RuntimeError as exc:
        print('chamfer skipped', exc)
        obj.modifiers.remove(mod)
    obj.select_set(False)


def drop(name, x, y, z, rz=0.0, s=1.0, stone=False):
    obj = load_piece(name)
    obj.scale = (s, s, s)
    obj.rotation_euler.z = rz
    bpy.context.view_layer.update()
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    mz = min(p.z for p in pts)
    obj.location.x += x - cx
    obj.location.y += y - cy
    obj.location.z += z - mz
    if stone:
        chamfer(obj, 0.035 * s)
    return obj


def solid(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 1
    bsdf.inputs['Metallic'].default_value = 0
    return mat


def bmesh_object(bm, name, mat, bevel=0.0):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    if bevel:
        chamfer(obj, bevel)
    return obj


def box(bm, cx, cy, cz, w, h, d, rot=(0, 0, 0)):
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
    return verts


def slab(cx, cy, z, w, d, h, color, name='slab'):
    mat = solid(name, color)
    bm = bmesh.new()
    box(bm, cx, cy, z + h / 2, w, d, h)
    return bmesh_object(bm, name, mat, bevel=min(0.05, h * 0.35))


def merlons(z, x0, x1, y0, y1, color, name='merlons'):
    # A broken parapet. Gaps keep it from reading as another solid box.
    mat = solid(name, color)
    bm = bmesh.new()
    span_x = x1 - x0
    span_y = y1 - y0
    nx = max(3, int(span_x / 0.46))
    ny = max(3, int(span_y / 0.46))
    w, h, t = 0.22, 0.28, 0.16
    for i in range(nx):
        if i % 2 == 0:
            continue
        x = x0 + (i + 0.5) * span_x / nx
        box(bm, x, y0, z + h / 2, w, t, h)
        box(bm, x, y1, z + h / 2, w, t, h)
    for i in range(ny):
        if i % 2 == 0:
            continue
        y = y0 + (i + 0.5) * span_y / ny
        box(bm, x0, y, z + h / 2, t, w, h)
        box(bm, x1, y, z + h / 2, t, w, h)
    return bmesh_object(bm, name, mat, bevel=0.02)


def join_all(name):
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.012)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    height = max(p.z for p in pts) - min(p.z for p in pts)
    return obj, height


def sit_and_fit(obj, target_h):
    bpy.context.view_layer.update()
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    height = max(p.z for p in pts) - min(p.z for p in pts) or 1
    scale = target_h / height
    obj.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    obj.location.x -= (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    obj.location.y -= (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    obj.location.z -= min(p.z for p in pts)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def export(obj, filename):
    path = os.path.join(OUT, filename)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    print(f'exported {filename} {os.path.getsize(path)} bytes')


SIDE = math.pi / 2
STONE = rgb(0xcbbfa8)
STONE_DARK = rgb(0x8d7964)
CRENEL = rgb(0xb7ab96)


def blocks(xs, ys, z, s=1.0):
    for x in xs:
        for y in ys:
            drop('wall-block', x, y, z, stone=True, s=s)


def european_keep():
    slab(0, 0.05, 0.0, 4.7, 4.15, 0.38, STONE, 'plinth')
    slab(0, 0.05, 0.38, 4.15, 3.6, 0.14, STONE_DARK, 'plinth-cap')
    blocks((-0.96, 0, 0.96), (-0.96, 0, 0.96), 0.52)
    slab(0, 0, 1.52, 3.35, 3.15, 0.1, STONE_DARK, 'course')
    blocks((-0.48, 0.48), (-0.48, 0.48), 1.62)
    drop('wall-block', 0, 0, 2.62, stone=True, s=0.86)
    drop('wall-block', 0, 0, 3.48, stone=True, s=0.72)
    for x, y in ((-1.72, -1.38), (1.72, -1.38), (-1.72, 1.22), (1.72, 1.22)):
        drop('wall-block', x, y, 0.52, stone=True, s=0.7)
        drop('wall-block', x, y, 1.22, stone=True, s=0.64)
        drop('wall-block', x, y, 1.86, stone=True, s=0.56)
    merlons(2.62, -1.15, 1.15, -1.15, 1.15, CRENEL)
    merlons(4.2, -0.38, 0.38, -0.38, 0.38, CRENEL, 'tower-merlons')
    drop('wall-door', 0, -1.46, 0.52, SIDE)
    drop('wall-window-stone', -0.96, -1.46, 0.7, SIDE)
    drop('wall-window-stone', 0.96, -1.46, 0.7, SIDE)
    drop('wall-window-stone', 0, -0.55, 1.85, SIDE, s=0.8)
    for x in (-0.85, 0.85):
        drop('roof-high-gable', x, 0, 2.55, SIDE, s=0.85)
    for x, y in ((-1.72, -1.38), (1.72, -1.38), (-1.72, 1.22), (1.72, 1.22)):
        drop('roof-point', x, y, 2.42, s=0.7)
    drop('roof-point', 0, 0, 4.48, s=0.85)
    drop('banner-red', -0.42, -0.55, 4.55, s=0.8)
    drop('banner-red', 1.72, -1.38, 2.55, s=0.55)
    drop('chimney', 0.55, 0.35, 3.15, s=0.7)


def asian_keep(pal):
    slab(0, 0, 0.0, 3.8, 3.5, 0.36, STONE, 'plinth')
    slab(0, 0, 0.36, 3.35, 3.05, 0.12, STONE_DARK, 'plinth-cap')
    # A continuous tower. Each eave sits on the floor under it.
    floors = ((0.48, 1.0), (1.55, 0.78), (2.42, 0.58), (3.08, 0.46))
    for z, s in floors:
        drop('wall-block', 0, 0, z, stone=True, s=s)
    for x, y in ((-1.35, -1.05), (1.35, -1.05), (-1.35, 1.05), (1.35, 1.05)):
        drop('pillar-stone', x, y, 0.48, stone=True, s=1.05)
        drop('wall-block', x, y, 0.52, stone=True, s=0.42)
    drop('wall-door', 0, -0.62, 0.5, SIDE, s=0.72)
    drop('wall-window-small', -0.42, -0.58, 0.85, SIDE, s=0.55)
    drop('wall-window-small', 0.42, -0.58, 0.85, SIDE, s=0.55)
    mat = solid('jade', pal)
    bm = bmesh.new()
    eaves = (
        (1.42, 3.15, 2.7),
        (2.26, 2.25, 1.95),
        (2.94, 1.6, 1.4),
        (3.48, 1.1, 0.95),
    )
    for z, w, d in eaves:
        box(bm, 0, -d * 0.18, z, w, d * 0.55, 0.16, rot=(0.38, 0, 0))
        box(bm, 0, d * 0.18, z, w, d * 0.55, 0.16, rot=(-0.38, 0, 0))
        box(bm, -w * 0.18, 0, z, w * 0.55, d, 0.14, rot=(0, -0.38, 0))
        box(bm, w * 0.18, 0, z, w * 0.55, d, 0.14, rot=(0, 0.38, 0))
    bmesh_object(bm, 'roofs', mat, bevel=0.02)
    for x, y in ((-1.45, -1.15), (1.45, -1.15), (-1.45, 1.15), (1.45, 1.15)):
        bm = bmesh.new()
        box(bm, x, y - 0.02, 1.15, 0.7, 0.28, 0.05, rot=(0.4, 0, 0))
        box(bm, x, y + 0.02, 1.15, 0.7, 0.28, 0.05, rot=(-0.4, 0, 0))
        bmesh_object(bm, 'turret-roof', mat)
    drop('banner-red', 0.28, -0.32, 3.55, s=0.45)


def south_keep(pal):
    # Stepped dressed stone. The steps are the plinth, not a stair run
    # sticking out toward the camera.
    stone = pal['stone']
    trim = pal['trim']
    slab(0, 0.1, 0.0, 4.4, 3.9, 0.55, stone, 'step0')
    slab(0, 0.05, 0.55, 3.35, 2.95, 0.5, STONE, 'step1')
    slab(0, 0, 1.05, 2.35, 2.05, 0.48, stone, 'step2')
    blocks((-0.42, 0.42), (-0.42, 0.42), 1.53, s=0.82)
    drop('wall-block', 0, 0, 2.35, stone=True, s=0.68)
    drop('wall-block', 0, 0, 3.03, stone=True, s=0.52)
    for x, y in ((-1.55, -1.2), (1.55, -1.2), (-1.55, 1.15), (1.55, 1.15)):
        drop('wall-block', x, y, 0.55, stone=True, s=0.48)
        drop('wall-block', x, y, 1.03, stone=True, s=0.38)
    merlons(1.53, -1.05, 1.05, -0.95, 0.95, CRENEL, 'sa-merlons')
    drop('wall-door', 0, -1.55, 0.55, SIDE, s=0.9)
    drop('wall-window-stone', -0.42, -0.5, 1.75, SIDE, s=0.55)
    drop('wall-window-stone', 0.42, -0.5, 1.75, SIDE, s=0.55)
    mat = solid('cornice', stone)
    gold = solid('gold', trim)
    bm = bmesh.new()
    box(bm, 0, 0, 3.5, 0.95, 0.82, 0.14)
    box(bm, 0, 0, 3.68, 0.55, 0.46, 0.2)
    bmesh_object(bm, 'cap', mat, bevel=0.02)
    bm = bmesh.new()
    box(bm, 0, -0.08, 3.84, 0.22, 0.06, 0.22)
    bmesh_object(bm, 'disc', gold)
    drop('banner-red', 1.55, -1.2, 1.45, s=0.5)


def eastern_keep(pal):
    slab(0, 0, 0.0, 4.3, 3.9, 0.4, pal['stone'], 'plinth')
    slab(0, 0, 0.4, 3.7, 3.3, 0.12, STONE_DARK, 'plinth-cap')
    blocks((-0.5, 0.5), (-0.5, 0.5), 0.52)
    merlons(1.52, -1.05, 1.05, -1.05, 1.05, CRENEL, 'parapet')
    drop('wall-doorway-round', 0, -1.05, 0.52, SIDE, s=0.9)
    drop('wall-window-round', -0.5, -1.05, 0.72, SIDE, s=0.8)
    drop('wall-window-round', 0.5, -1.05, 0.72, SIDE, s=0.8)
    for x, y in ((-1.7, -1.25), (1.7, -1.25), (-1.7, 1.2), (1.7, 1.2)):
        drop('pillar-stone', x, y, 0.52, stone=True)
        drop('pillar-stone', x, y, 1.52, stone=True)
        drop('wall-block', x, y, 0.7, stone=True, s=0.38)
    mat = solid('dome', pal['roof'])
    sand = solid('sand', pal['stone'])
    bm = bmesh.new()
    for x, y in ((-1.7, -1.25), (1.7, -1.25), (-1.7, 1.2), (1.7, 1.2)):
        cone = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.22, radius2=0.05, depth=0.7)
        bmesh.ops.translate(bm, verts=cone['verts'], vec=(x, y, 2.35))
    drum = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.78, radius2=0.7, depth=0.55)
    bmesh.ops.translate(bm, verts=drum['verts'], vec=(0, 0, 1.85))
    dome = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.95)
    lower = [v for v in dome['verts'] if v.is_valid and v.co.z < -0.02]
    bmesh.ops.delete(bm, geom=lower, context='VERTS')
    dome_verts = [v for v in bm.verts if v.is_valid and v.co.z < 1.3]
    bmesh.ops.translate(bm, verts=dome_verts, vec=(0, 0, 2.05))
    bmesh_object(bm, 'domes', mat, bevel=0.02)
    bm = bmesh.new()
    box(bm, 0, 0, 1.5, 2.2, 2.05, 0.12)
    bmesh_object(bm, 'band', sand, bevel=0.02)
    drop('banner-red', 1.7, -1.25, 2.15, s=0.5)


def european_house():
    slab(0, 0, 0.0, 2.5, 2.15, 0.22, STONE, 'plinth')
    blocks((-0.55, 0.55), (-0.45, 0.45), 0.22)
    drop('wall-door', 0, -1.05, 0.22, SIDE, s=0.9)
    drop('wall-window-small', -0.55, -1.05, 0.45, SIDE, s=0.85)
    drop('roof-gable', 0, 0, 1.22, SIDE)
    drop('chimney', 0.4, 0.1, 1.7, s=0.75)


def asian_house(pal):
    slab(0, 0, 0.0, 2.4, 2.0, 0.18, STONE, 'plinth')
    blocks((-0.5, 0.5), (0,), 0.18)
    drop('wall-door', 0, -0.7, 0.18, SIDE, s=0.85)
    mat = solid('jade', pal)
    bm = bmesh.new()
    box(bm, 0, -0.04, 1.28, 2.5, 1.2, 0.07, rot=(0.28, 0, 0))
    box(bm, 0, 0.04, 1.28, 2.5, 1.2, 0.07, rot=(-0.28, 0, 0))
    box(bm, 0, -0.02, 1.72, 1.5, 0.75, 0.06, rot=(0.28, 0, 0))
    box(bm, 0, 0.02, 1.72, 1.5, 0.75, 0.06, rot=(-0.28, 0, 0))
    bmesh_object(bm, 'roof', mat, bevel=0.012)


def south_house(pal):
    slab(0, 0, 0.0, 2.45, 2.05, 0.28, pal['stone'], 'plinth')
    slab(0, 0, 0.28, 1.9, 1.55, 0.22, STONE, 'step')
    blocks((-0.5, 0.5), (0,), 0.5)
    drop('wall-door', 0, -0.7, 0.5, SIDE, s=0.85)
    mat = solid('stone', pal['stone'])
    bm = bmesh.new()
    box(bm, 0, 0, 1.55, 1.85, 1.25, 0.1)
    box(bm, 0, 0, 1.72, 0.85, 0.6, 0.2)
    bmesh_object(bm, 'cap', mat, bevel=0.015)


def eastern_house(pal):
    slab(0, 0, 0.0, 2.35, 2.0, 0.2, pal['stone'], 'plinth')
    blocks((-0.5, 0.5), (0,), 0.2)
    drop('wall-doorway-round', 0, -0.7, 0.2, SIDE, s=0.85)
    mat = solid('dome', pal['roof'])
    bm = bmesh.new()
    dome = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.62)
    lower = [v for v in dome['verts'] if v.co.z < -0.02]
    bmesh.ops.delete(bm, geom=lower, context='VERTS')
    rest = [v for v in bm.verts if v.is_valid]
    bmesh.ops.translate(bm, verts=rest, vec=(0, 0, 1.22))
    bmesh_object(bm, 'dome', mat, bevel=0.012)


def emit(builder, filename, height):
    reset()
    builder()
    obj, raw = join_all('keep')
    print(filename, 'raw height', round(raw, 2))
    sit_and_fit(obj, height)
    export(obj, filename)


def main():
    only = os.environ.get('KEEP_ONLY', '')
    jobs = [
        ('european-keep.glb', european_keep, 2.55),
        ('european-house.glb', european_house, 1.15),
        ('asian-keep.glb', lambda: asian_keep(rgb(0x2f9a80)), 2.55),
        ('asian-house.glb', lambda: asian_house(rgb(0x2f9a80)), 1.15),
        ('south_american-keep.glb', lambda: south_keep({'stone': rgb(0xe6dab0), 'trim': rgb(0xf2b632)}), 2.55),
        ('south_american-house.glb', lambda: south_house({'stone': rgb(0xe6dab0)}), 1.15),
        ('middle_eastern-keep.glb', lambda: eastern_keep({'roof': rgb(0x2fa6c4), 'stone': rgb(0xf2e0bc)}), 2.55),
        ('middle_eastern-house.glb', lambda: eastern_house({'roof': rgb(0x2fa6c4), 'stone': rgb(0xf2e0bc)}), 1.15),
    ]
    for filename, builder, height in jobs:
        if only and only not in filename:
            continue
        emit(builder, filename, height)


if __name__ == '__main__':
    main()
