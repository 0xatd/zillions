# Culture keeps and houses from the Kenney Fantasy Town Kit (CC0).
# The kit pieces carry the stone, windows, doors and stairs. Culture roofs
# are added on top: spires, pagoda tiers, a temple cap, domes and minarets.
#
#   blender --background --python tools/blender/build_keeps.py
#
# Output: assets/keeps/<culture>-keep.glb and <culture>-house.glb
# Authored short of the building visual scale. A keep is about 2.4 tall here
# so it stands about two and a half times a house after the game scales them.

import math
import os

import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = os.getcwd()
KIT = '/tmp/ftk/Models/GLB format'
if not os.path.isdir(KIT):
    KIT = os.path.join(ROOT, 'assets', 'town', 'kenney')
OUT = os.path.join(ROOT, 'assets', 'keeps')
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


def drop(name, x, y, z, rz=0.0):
    obj = load_piece(name)
    obj.rotation_euler.z = rz
    bpy.context.view_layer.update()
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    mz = min(p.z for p in pts)
    obj.location.x += x - cx
    obj.location.y += y - cy
    obj.location.z += z - mz
    return obj


def solid(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 1
    bsdf.inputs['Metallic'].default_value = 0
    return mat


def paint_object(obj, color):
    mesh = obj.data
    attr = mesh.color_attributes.get('Color')
    if attr is None:
        attr = mesh.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    for datum in attr.data:
        datum.color = (*color, 1)
    mesh.color_attributes.render_color_index = mesh.color_attributes.find('Color')


def bmesh_object(bm, name, mat):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
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


def join_all(name):
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
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


def blocks(xs, ys, z):
    for x in xs:
        for y in ys:
            drop('wall-block', x, y, z)


def european_keep():
    # Solid storeys, a gabled roof, and two spired turrets. Thin wall panels
    # read as fins from the play camera, so the mass is wall blocks.
    blocks((-1, 0, 1), (-1, 0, 1), 0)
    blocks((-0.5, 0.5), (-0.5, 0.5), 1)
    drop('wall-door', 0, -1.55, 0, SIDE)
    drop('wall-window-stone', -1, -1.55, 0.1, SIDE)
    drop('wall-window-stone', 1, -1.55, 0.1, SIDE)
    for x in (-0.7, 0, 0.7):
        drop('roof-high-gable', x, 0, 2.0, SIDE)
    for x in (-1.65, 1.65):
        drop('wall-block', x, -1.15, 0)
        drop('wall-block', x, -1.15, 1)
        drop('roof-point', x, -1.15, 2.05)
    drop('stairs-stone', 0, -2.25, 0, SIDE)
    drop('banner-red', -1.65, -1.15, 2.45)
    drop('chimney', 0.35, 0.2, 2.7)


def asian_keep(pal):
    blocks((-0.7, 0.7), (-0.7, 0.7), 0)
    drop('wall-block', 0, 0, 1)
    drop('wall-door', 0, -1.25, 0, SIDE)
    drop('wall-window-small', -0.7, -1.25, 0.15, SIDE)
    drop('wall-window-small', 0.7, -1.25, 0.15, SIDE)
    mat = solid('jade', pal)
    bm = bmesh.new()
    # Three pagoda roofs, each wider than the floor under it, eaves turned up.
    tiers = ((0.95, 2.4, 2.0), (1.55, 1.7, 1.45), (2.15, 1.15, 1.0))
    for z, w, d in tiers:
        box(bm, 0, -0.05, z, w, d * 0.55, 0.08, rot=(0.28, 0, 0))
        box(bm, 0, 0.05, z, w, d * 0.55, 0.08, rot=(-0.28, 0, 0))
        box(bm, 0, -d * 0.32, z - 0.02, 0.35, 0.12, 0.1, rot=(0.9, 0, 0))
        box(bm, 0, d * 0.32, z - 0.02, 0.35, 0.12, 0.1, rot=(-0.9, 0, 0))
    bmesh_object(bm, 'roofs', mat)


def south_keep(pal):
    blocks((-1, 0, 1), (-1, 0, 1), 0)
    blocks((-0.45, 0.45), (-0.45, 0.45), 1)
    drop('wall-door', 0, -1.55, 0, SIDE)
    drop('stairs-wide-stone', 0, -2.3, 0, SIDE)
    mat = solid('temple', pal['stone'])
    gold = solid('gold', pal['trim'])
    bm = bmesh.new()
    box(bm, 0, 0, 1.7, 2.2, 1.6, 0.16)
    box(bm, 0, 0, 1.95, 1.3, 0.9, 0.35)
    box(bm, 0, 0, 2.2, 1.5, 1.05, 0.1)
    bmesh_object(bm, 'cap', mat)
    bm = bmesh.new()
    box(bm, 0, -0.5, 2.05, 0.22, 0.06, 0.22)
    bmesh_object(bm, 'disc', gold)


def eastern_keep(pal):
    blocks((-0.7, 0.7), (-0.7, 0.7), 0)
    drop('wall-block', 0, 0, 1)
    drop('wall-doorway-round', 0, -1.25, 0, SIDE)
    drop('wall-window-round', -0.7, -1.25, 0.1, SIDE)
    drop('wall-window-round', 0.7, -1.25, 0.1, SIDE)
    for x in (-1.7, 1.7):
        drop('pillar-stone', x, -0.35, 0)
        drop('wall-block', x, -0.35, 0.2)
    mat = solid('dome', pal['roof'])
    sand = solid('sand', pal['stone'])
    bm = bmesh.new()
    for x in (-1.85, 1.85):
        geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.28, radius2=0.22, depth=1.3)
        bmesh.ops.translate(bm, verts=geom['verts'], vec=(x, -0.4, 2.3))
    dome = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.85)
    lower = [v for v in dome['verts'] if v.co.z < -0.05]
    bmesh.ops.delete(bm, geom=lower, context='VERTS')
    rest = [v for v in dome['verts'] if v.is_valid]
    bmesh.ops.translate(bm, verts=rest, vec=(0, 0, 1.7))
    bmesh_object(bm, 'domes', mat)
    bm = bmesh.new()
    box(bm, 0, 0, 1.15, 2.4, 1.8, 0.12)
    bmesh_object(bm, 'band', sand)


def european_house():
    blocks((-0.55, 0.55), (-0.45, 0.45), 0)
    drop('wall-door', 0, -1.05, 0, SIDE)
    drop('roof-gable', 0, 0, 1.0, SIDE)
    drop('chimney', 0.35, 0.05, 1.45)


def asian_house(pal):
    blocks((-0.5, 0.5), (0,), 0)
    drop('wall-door', 0, -0.85, 0, SIDE)
    mat = solid('jade', pal)
    bm = bmesh.new()
    box(bm, 0, -0.04, 1.15, 2.3, 1.15, 0.08, rot=(0.22, 0, 0))
    box(bm, 0, 0.04, 1.15, 2.3, 1.15, 0.08, rot=(-0.22, 0, 0))
    bmesh_object(bm, 'roof', mat)


def south_house(pal):
    blocks((-0.55, 0.55), (0,), 0)
    drop('wall-door', 0, -0.85, 0, SIDE)
    drop('stairs-stone', 0, -1.5, 0, SIDE)
    mat = solid('stone', pal['stone'])
    bm = bmesh.new()
    box(bm, 0, 0, 1.05, 1.8, 1.2, 0.12)
    box(bm, 0, 0, 1.22, 0.7, 0.5, 0.22)
    bmesh_object(bm, 'cap', mat)


def eastern_house(pal):
    blocks((-0.5, 0.5), (0,), 0)
    drop('wall-doorway-round', 0, -0.85, 0, SIDE)
    mat = solid('dome', pal['roof'])
    bm = bmesh.new()
    dome = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.55)
    lower = [v for v in dome['verts'] if v.co.z < -0.02]
    bmesh.ops.delete(bm, geom=lower, context='VERTS')
    rest = [v for v in dome['verts'] if v.is_valid]
    bmesh.ops.translate(bm, verts=rest, vec=(0, 0, 1.05))
    bmesh_object(bm, 'dome', mat)


BUILDS = {
    'european': (european_keep, european_house, None),
    'asian': (lambda: asian_keep(rgb(0x2f9a80)), lambda: asian_house(rgb(0x2f9a80)), None),
    'south_american': (
        lambda: south_keep({'stone': rgb(0xe6dab0), 'trim': rgb(0xf2b632)}),
        lambda: south_house({'stone': rgb(0xe6dab0)}),
        None,
    ),
    'middle_eastern': (
        lambda: eastern_keep({'roof': rgb(0x2fa6c4), 'stone': rgb(0xf2e0bc)}),
        lambda: eastern_house({'roof': rgb(0x2fa6c4)}),
        None,
    ),
}


def emit(builder, filename, height):
    reset()
    builder()
    obj, raw = join_all('keep')
    print(filename, 'raw height', round(raw, 2))
    sit_and_fit(obj, height)
    export(obj, filename)


def main():
    emit(european_keep, 'european-keep.glb', 2.45)
    emit(european_house, 'european-house.glb', 1.15)
    emit(lambda: asian_keep(rgb(0x2f9a80)), 'asian-keep.glb', 2.45)
    emit(lambda: asian_house(rgb(0x2f9a80)), 'asian-house.glb', 1.15)
    emit(lambda: south_keep({'stone': rgb(0xe6dab0), 'trim': rgb(0xf2b632)}), 'south_american-keep.glb', 2.45)
    emit(lambda: south_house({'stone': rgb(0xe6dab0)}), 'south_american-house.glb', 1.15)
    emit(lambda: eastern_keep({'roof': rgb(0x2fa6c4), 'stone': rgb(0xf2e0bc)}), 'middle_eastern-keep.glb', 2.45)
    emit(lambda: eastern_house({'roof': rgb(0x2fa6c4)}), 'middle_eastern-house.glb', 1.15)


if __name__ == '__main__':
    main()
