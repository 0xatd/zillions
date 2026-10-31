# Cottages, a haystack and a well for the founded town.
#
# Walls and roofs are kitbashed from the Quaternius Medieval Village MegaKit
# standard pack (CC0). Hay and the well are original low-poly meshes. Textures
# are flattened to a matte palette so the pieces match the rest of the town.
#
#   blender --background --python tools/blender/build_village.py
#
# The pack is not committed. Point QUATERNIUS_KIT at the glTF folder, or leave
# the extracted copy at /tmp/qv/glTF. Download:
# https://opengameart.org/sites/default/files/medieval_village_megakitstandard.zip

import math
import os

import bpy
import bmesh

ROOT = os.getcwd()
KIT = os.environ.get('QUATERNIUS_KIT') or '/tmp/qv/glTF'
OUT = os.environ.get('VILLAGE_OUT') or os.path.join(ROOT, 'assets', 'town', 'village')
os.makedirs(OUT, exist_ok=True)


def rgb(hex_color):
    return ((hex_color >> 16) / 255, ((hex_color >> 8) & 255) / 255, (hex_color & 255) / 255)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def solid(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 1
    bsdf.inputs['Metallic'].default_value = 0
    return mat


def tint(obj):
    for slot in list(obj.material_slots):
        src = (slot.material.name if slot.material else '').lower()
        if 'tile' in src or 'roof' in src:
            col = rgb(0xb55238)
            label = 'roof'
        elif 'wood' in src or 'trim' in src:
            col = rgb(0x6a4630)
            label = 'wood'
        elif 'brick' in src:
            col = rgb(0xa15a3c)
            label = 'brick'
        elif 'plaster' in src:
            col = rgb(0xefe4d0)
            label = 'plaster'
        elif 'metal' in src:
            col = rgb(0x8a9094)
            label = 'metal'
        else:
            col = rgb(0xc8bba6)
            label = 'stone'
        slot.material = solid(label, col)


def load_piece(name):
    before = set(bpy.data.objects)
    path = os.path.join(KIT, name + '.gltf')
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [obj for obj in bpy.data.objects if obj not in before and obj.type == 'MESH']
    obj = meshes[0]
    if obj.parent:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    tint(obj)
    return obj


def place(name, x, y, z, rz=0.0, scale=(1.0, 1.0, 1.0)):
    obj = load_piece(name)
    obj.scale = scale
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


def bmesh_object(bm, name, mat):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def box(bm, cx, cy, cz, w, h, d):
    geom = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=geom['verts'], vec=(w, h, d))
    bmesh.ops.translate(bm, verts=geom['verts'], vec=(cx, cy, cz))


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
    bpy.ops.mesh.remove_doubles(threshold=0.01)
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


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


def emit(builder, filename, height):
    reset()
    builder()
    obj = join_all('cottage')
    sit_and_fit(obj, height)
    export(obj, filename)


def cottage(body_color, front, window):
    # A closed plaster or brick body, then the kit door, window, roof and
    # chimney. The wall modules alone are frames and read as an open scaffold.
    stone = solid('plinth', rgb(0xc8bba6))
    body = solid('body', body_color)
    wood = solid('door', rgb(0x6a4630))
    bm = bmesh.new()
    box(bm, 0, 0, 0.1, 2.5, 2.15, 0.2)
    bmesh_object(bm, 'plinth', stone)
    bm = bmesh.new()
    box(bm, 0, 0, 1.35, 2.05, 1.7, 2.15)
    bmesh_object(bm, 'body', body)
    bm = bmesh.new()
    box(bm, 0, -0.88, 1.05, 0.62, 0.08, 1.35)
    bmesh_object(bm, 'doorleaf', wood)
    place(front, 0, -0.95, 0.2, math.pi, (0.72, 0.85, 0.7))
    place(window, 0.0, 0.92, 0.85, 0, (0.55, 0.85, 0.48))
    place('Roof_RoundTiles_4x6', 0, 0, 2.15, 0, (3.05 / 5.52, 2.55 / 7.58, 1.45 / 4.24))
    place('Prop_Chimney', 0.45, 0.2, 2.7, 0, (0.38, 0.38, 0.32))


def plaster():
    cottage(rgb(0xefe4d0), 'Wall_Plaster_Door_Flat', 'Wall_Plaster_Window_Wide_Flat')


def brick():
    cottage(rgb(0xa15a3c), 'Wall_UnevenBrick_Door_Flat', 'Wall_UnevenBrick_Window_Thin_Round')


def timber():
    cottage(rgb(0xefe4d0), 'Wall_Plaster_Door_Flat', 'Wall_Plaster_WoodGrid')


def hay():
    gold = solid('hay', rgb(0xd2b15a))
    dark = solid('hay-dark', rgb(0x8a6a2e))
    bm = bmesh.new()
    for i, (z, r) in enumerate(((0.28, 0.55), (0.62, 0.42), (0.9, 0.28))):
        cone = bmesh.ops.create_cone(bm, cap_ends=True, segments=7, radius1=r, radius2=r * 0.72, depth=0.36)
        bmesh.ops.translate(bm, verts=cone['verts'], vec=(0.04 * i, -0.03 * i, z))
    bmesh_object(bm, 'stack', gold)
    bm = bmesh.new()
    band = bmesh.ops.create_cone(bm, cap_ends=True, segments=7, radius1=0.5, radius2=0.5, depth=0.06)
    bmesh.ops.translate(bm, verts=band['verts'], vec=(0, 0, 0.4))
    bmesh_object(bm, 'bind', dark)


def well():
    stone = solid('stone', rgb(0xc8bba6))
    dark = solid('water', rgb(0x3a4650))
    wood = solid('wood', rgb(0x6a4630))
    bm = bmesh.new()
    ring = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.58, radius2=0.5, depth=0.72)
    bmesh.ops.translate(bm, verts=ring['verts'], vec=(0, 0, 0.36))
    bmesh_object(bm, 'ring', stone)
    bm = bmesh.new()
    hole = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.32, radius2=0.32, depth=0.08)
    bmesh.ops.translate(bm, verts=hole['verts'], vec=(0, 0, 0.7))
    bmesh_object(bm, 'hole', dark)
    bm = bmesh.new()
    box(bm, -0.42, 0, 1.05, 0.1, 0.1, 0.9)
    box(bm, 0.42, 0, 1.05, 0.1, 0.1, 0.9)
    box(bm, 0, 0, 1.48, 1.05, 0.1, 0.1)
    bmesh_object(bm, 'frame', wood)


def main():
    if not os.path.isdir(KIT):
        raise SystemExit(f'missing Quaternius glTF folder: {KIT}')
    emit(plaster, 'cottage-plaster.glb', 1.15)
    emit(brick, 'cottage-brick.glb', 1.15)
    emit(timber, 'cottage-timber.glb', 1.15)
    emit(hay, 'hay.glb', 0.72)
    emit(well, 'well.glb', 0.95)


if __name__ == '__main__':
    main()
