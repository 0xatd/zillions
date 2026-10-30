"""Kitbash CC0 Quaternius characters into Zillions heroes and zombies.

Source (download once, not committed):

  https://opengameart.org/content/animated-characters-pack
  ultimate_animated_character_pack_by_quaternius.zip  (Quaternius, CC0)

    blender --background --python tools/blender/build_characters.py -- \\
        --src "/path/to/Ultimate Animated Character Pack - Nov 2019/FBX" \\
        --out assets/characters

Heroes keep the pack rig and its clips (idle, walk, punch or shoot, victory,
hit, defeat). Weapons, shields and trim are original kitbash meshes parented
to that rig. Zombies start from Zombie_Male, gain a hive silhouette per type,
and are baked to a vertex-animation texture the instanced horde can play.

Flat materials only: no textures, roughness 1, metal 0. Exported heroes are
about 1.35 units tall so the in-game group scale of 0.82 reads at the same
size as the terrain pass.
"""
import math
import os
import struct
import sys

import bpy
from mathutils import Matrix, Vector

HERO_HEIGHT = 1.35
ZOMBIE_HEIGHT = 1.35

# Material-slot colours. Unlisted slots fall back to a neutral so a new
# slot cannot ship as an untextured white.
HEROES = [
    {
        'key': 'scott', 'file': 'Viking_Male.fbx', 'attack': 'Punch', 'wide': (1.08, 1.0),
        'colors': {
            'Skin': 0xf0c8a0, 'Light': 0xb32020, 'Main': 0x8a1a16, 'Pants': 0x2c313c,
            'Hair': 0x6b3f22, 'Face': 0xf0c8a0,
        },
        'props': 'hammer',
    },
    {
        'key': 'alexander', 'file': 'Soldier_Male.fbx', 'attack': 'Shoot_OneHanded', 'wide': (1.0, 1.0),
        'colors': {
            'Skin': 0xf0c8a0, 'Main': 0x2f8f46, 'Black': 0x1a2820, 'DarkGreen': 0x1b5c30,
            'Face': 0xf0c8a0, 'Helmet': 0xf3c53d,
        },
        'props': 'rifle',
    },
    {
        'key': 'danny', 'file': 'Ninja_Male.fbx', 'attack': 'Punch', 'wide': (0.92, 1.0),
        'colors': {
            'Skin': 0x9eb0c8, 'Main': 0x3a8ef0, 'Details': 0x7dffb2, 'Grey': 0x243044, 'Face': 0xd5e4f8,
        },
        'props': 'blades',
    },
    {
        'key': 'turtle', 'file': 'Knight_Male.fbx', 'attack': 'Punch', 'wide': (1.28, 1.05),
        'colors': {
            'Skin': 0xf0c8a0, 'Armor': 0x3f6b5e, 'Armor_Dark': 0x243e36, 'Detail': 0xb8ae86,
            'Red': 0x8fd0ff,
        },
        'props': 'shield',
    },
    {
        'key': 'john', 'file': 'Pirate_Male.fbx', 'attack': 'Punch', 'wide': (1.06, 1.0),
        'colors': {
            'Skin': 0xf0c8a0, 'Beige': 0xf0ece0, 'Clothes': 0x3a3a3f, 'Gold': 0xf4f0e4,
            'Brown': 0x6b5334, 'Face': 0xf0c8a0, 'Black': 0x1a1a1c, 'Red': 0xd23b32,
        },
        'props': 'keg',
    },
    {
        'key': 'tiger', 'file': 'Elf.fbx', 'attack': 'Punch', 'wide': (0.9, 0.92),
        'colors': {
            'Skin': 0xf0c8a0, 'Clothes': 0xd8721f, 'Belt': 0x1c1a18, 'Gold': 0xffa64d,
            'Hat': 0x1c1a18, 'Face': 0xf0c8a0,
        },
        'props': 'ears',
    },
    {
        'key': 'aaron', 'file': 'Wizard.fbx', 'attack': 'Shoot_OneHanded', 'wide': (1.0, 1.0),
        'colors': {
            'Skin': 0xf0c8a0, 'Clothes': 0x6a4fae, 'Belt': 0xf0d060, 'Gold': 0xf0d060,
            'Hat': 0x4a3488, 'Hair': 0xd9d3c8, 'Face': 0xf0c8a0,
        },
        'props': 'staff',
    },
]

# Dark hive bodies. The accent is a ragged part or the eyes, not a candy color.
# wide.z is chosen so config scale * this height lands near the hero:
# walker ~1x, runner a bit under, brute and sieger ~1.5x.
ZOMBIES = [
    {
        'key': 'walker', 'wide': (1.0, 1.0, 1.0), 'lean': 0.22, 'shape': 'shambler',
        'colors': {
            'Skin': 0x3c3834, 'Clothes': 0x241f1c, 'Guts': 0x5a2824, 'Pants': 0x1a1614,
            'DarkClothes': 0x12100e, 'Bones': 0x8a8074, 'Brain': 0x4a242c, 'Face': 0x2a221c,
        },
    },
    {
        'key': 'runner', 'wide': (0.7, 0.74, 0.94), 'lean': 0.5, 'shape': 'runner',
        'colors': {
            'Skin': 0x3a3828, 'Clothes': 0x1c1a12, 'Guts': 0x5c4020, 'Pants': 0x14120c,
            'DarkClothes': 0x100e0a, 'Bones': 0x9a8c68, 'Brain': 0x4a3818, 'Face': 0x241e12,
        },
    },
    {
        'key': 'brute', 'wide': (1.34, 1.16, 0.86), 'lean': 0.12, 'shape': 'brute',
        'colors': {
            'Skin': 0x342838, 'Clothes': 0x221820, 'Guts': 0x4a2838, 'Pants': 0x140e16,
            'DarkClothes': 0x100c12, 'Bones': 0x7a6c80, 'Brain': 0x3a2030, 'Face': 0x1c141c,
        },
    },
    {
        'key': 'spitter', 'wide': (1.02, 1.08, 0.98), 'lean': 0.2, 'shape': 'spitter',
        'colors': {
            'Skin': 0x343428, 'Clothes': 0x1c1e14, 'Guts': 0x6a7428, 'Pants': 0x12140c,
            'DarkClothes': 0x0e100a, 'Bones': 0x8a8860, 'Brain': 0x3a3c18, 'Face': 0x1a1c10,
        },
    },
    {
        'key': 'burrower', 'wide': (1.28, 1.18, 0.62), 'lean': 0.34, 'shape': 'burrower',
        'colors': {
            'Skin': 0x2c2834, 'Clothes': 0x18161e, 'Guts': 0x3a2848, 'Pants': 0x100e14,
            'DarkClothes': 0x0c0a10, 'Bones': 0xb0a4c4, 'Brain': 0x2a2030, 'Face': 0x16121a,
        },
    },
    {
        'key': 'sieger', 'wide': (1.2, 1.16, 0.94), 'lean': 0.1, 'shape': 'sieger',
        'colors': {
            'Skin': 0x3a2c24, 'Clothes': 0x241812, 'Guts': 0x6a3a22, 'Pants': 0x140e0a,
            'DarkClothes': 0x100c08, 'Bones': 0xc4b09a, 'Brain': 0x3a2418, 'Face': 0x1c1410,
        },
    },
    {
        'key': 'caller', 'wide': (0.78, 0.88, 1.0), 'lean': 0.22, 'shape': 'caller',
        'colors': {
            'Skin': 0x243430, 'Clothes': 0x142220, 'Guts': 0x2a5048, 'Pants': 0x0e1614,
            'DarkClothes': 0x0a1010, 'Bones': 0x8ec8c0, 'Brain': 0x1a3030, 'Face': 0x101816,
        },
    },
]


def argv():
    raw = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {'src': '', 'out': 'assets/characters', 'only': None}
    i = 0
    while i < len(raw):
        if raw[i] == '--src':
            out['src'] = raw[i + 1]
            i += 2
        elif raw[i] == '--out':
            out['out'] = raw[i + 1]
            i += 2
        elif raw[i] == '--only':
            out['only'] = set(raw[i + 1].split(','))
            i += 2
        else:
            i += 1
    return out


def hex_rgba(hex_color, emit=False):
    r = ((hex_color >> 16) & 255) / 255.0
    g = ((hex_color >> 8) & 255) / 255.0
    b = (hex_color & 255) / 255.0
    return (r, g, b, 1.0)


def flatten_material(mat, hex_color, emit=0.0):
    rgba = hex_rgba(hex_color)
    mat.use_nodes = True
    mat.blend_method = 'OPAQUE'
    nt = mat.node_tree
    for node in list(nt.nodes):
        if node.type == 'TEX_IMAGE':
            nt.nodes.remove(node)
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        if out:
            nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = rgba
    if 'Roughness' in bsdf.inputs:
        bsdf.inputs['Roughness'].default_value = 1.0
    if 'Metallic' in bsdf.inputs:
        bsdf.inputs['Metallic'].default_value = 0.0
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = rgba
        bsdf.inputs['Emission Strength'].default_value = emit
    elif 'Emission' in bsdf.inputs:
        bsdf.inputs['Emission'].default_value = rgba
    mat.diffuse_color = rgba


def paint(obj, colors, emit_names=()):
    for mat in obj.data.materials:
        if mat is None:
            continue
        hex_color = colors.get(mat.name, 0x8a8490)
        flatten_material(mat, hex_color, 0.8 if mat.name in emit_names else 0.0)


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30


def import_fbx(path):
    fresh()
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    mesh = max(meshes, key=lambda o: len(o.data.vertices))
    for extra in meshes:
        if extra is mesh:
            continue
        bpy.data.objects.remove(extra, do_unlink=True)
    return arm, mesh


def bone_tail(arm, name):
    bone = arm.data.bones[name]
    return arm.matrix_world @ bone.tail_local


def bone_head(arm, name):
    bone = arm.data.bones[name]
    return arm.matrix_world @ bone.head_local


def new_mat(name, hex_color, emit=0.0):
    mat = bpy.data.materials.new(name)
    flatten_material(mat, hex_color, emit)
    return mat


def add_cube(name, loc, size, hex_color, emit=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(new_mat(name, hex_color, emit))
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def add_cylinder(name, loc, radius, depth, hex_color, emit=0.0, verts=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(new_mat(name, hex_color, emit))
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def add_cone(name, loc, radius, depth, hex_color, emit=0.0, rot=None):
    """Cone with its base on `loc` and its tip at local +Z * depth, then rotated."""
    bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=radius, depth=depth, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    for v in obj.data.vertices:
        v.co.z += depth * 0.5
    if rot is not None:
        obj.rotation_euler = rot
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(rotation=True)
    obj.data.materials.append(new_mat(name, hex_color, emit))
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def add_blob(name, loc, radius, hex_color, emit=0.0, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(new_mat(name, hex_color, emit))
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def weight_to(obj, bone):
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')


def bone_points(arm, bone_name):
    bone = arm.data.bones[bone_name]
    head = arm.matrix_world @ bone.head_local
    tail = arm.matrix_world @ bone.tail_local
    direction = tail - head
    if direction.length < 1e-5:
        direction = Vector((0, -1, 0))
    return tail, direction.normalized()


def parent_keep(obj, arm, bone_name):
    """Parent without moving the prop. It then rides that bone in the clip."""
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = bone_name
    obj.matrix_world = world
    bpy.context.view_layer.update()


def pose_action(arm, name):
    act = None
    for candidate in bpy.data.actions:
        if candidate.name == name or candidate.name.split('|')[-1] == name:
            act = candidate
            break
    if act is None:
        return
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    bpy.context.scene.frame_set(int(act.frame_range[0]) + 10)
    bpy.context.view_layer.update()


def posed_tail(arm, name):
    bpy.context.view_layer.update()
    return arm.matrix_world @ arm.pose.bones[name].tail


def into_bind(obj, arm, bone_name):
    """`obj` is where it should sit in the current pose. Store bind-space verts
    so skinning puts it back there when that pose plays."""
    bpy.context.view_layer.update()
    pose_world = arm.matrix_world @ arm.pose.bones[bone_name].matrix
    rest_world = arm.matrix_world @ arm.data.bones[bone_name].matrix_local
    correction = rest_world @ pose_world.inverted()
    world = obj.matrix_world.copy()
    for vert in obj.data.vertices:
        vert.co = correction @ (world @ vert.co)
    obj.matrix_world = Matrix.Identity(4)


def put(kind, loc, size, color, bone, emit=0.0, radius=0.05, depth=0.2, rot=None):
    if kind == 'cube':
        obj = add_cube(bone + '_prop', loc, size, color, emit)
    elif kind == 'cone':
        obj = add_cone(bone + '_prop', loc, radius, depth, color, emit, rot=rot)
    else:
        obj = add_cylinder(bone + '_prop', loc, radius, depth, color, emit)
    arm = getattr(put, 'arm', None)
    if arm is not None:
        into_bind(obj, arm, bone)
    weight_to(obj, bone)
    return obj


def join_into(mesh, parts):
    if not parts:
        return mesh
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def shade_flat(mesh):
    for p in mesh.data.polygons:
        p.use_smooth = False


def aim(obj, direction, axis):
    """Rotate so a local axis follows `direction`, then bake it into the verts."""
    direction = direction.normalized()
    up = 'X' if axis == 'Z' else 'Z'
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = direction.to_track_quat(axis, up)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(rotation=True)


def grip_forward(lift=0.0):
    """Pack faces Blender -Y. The fist bone points sideways, so a prop along it
    floats off the hand as a bar."""
    return Vector((0.0, -1.0, 0.15 + lift)).normalized()


def grip_up():
    """Forward and up from the fist. Purely sideways follows the T-pose hand and
    reads as a floating bar. Purely up clears the house. This keeps the weapon
    in the hand, about 0.6–0.8 of body height, under a hab roof."""
    return Vector((0.0, -0.85, 0.7)).normalized()


def held(kind, fist, bone, length, color, thick, emit=0.0, direction=None):
    """A prop gripped at the fist. The near end sits on the hand."""
    forward = (direction or grip_up()).normalized()
    center = fist + forward * (length * 0.5)
    if kind == 'cube':
        obj = add_cube(bone + '_w', center, (thick, length, thick * 1.35), color, emit)
        aim(obj, forward, 'Y')
    else:
        obj = add_cylinder(bone + '_w', center, thick, length, color, emit)
        aim(obj, forward, 'Z')
    arm = getattr(held, 'arm', None)
    if arm is not None:
        into_bind(obj, arm, bone)
    weight_to(obj, bone)
    return obj, forward


def hero_props(kind, arm, height):
    """Props weighted to the fist. Melee length is 0.6–0.8 of the body. Guns stay compact.

    Placement is in the idle pose. into_bind stores that grip in the bind pose
    so the hanging arm does not swing the weapon out to the side.
    """
    pose_action(arm, 'Idle')
    put.arm = arm
    held.arm = arm
    H = height
    parts = []
    if kind == 'hammer':
        fist = posed_tail(arm, 'Fist.R')
        length = 0.68 * H
        _handle, forward = held('cyl', fist, 'Fist.R', length, 0x3a3228, 0.05 * H)
        parts.append(_handle)
        head = add_cube('hammer_head', fist + forward * (length * 0.92), (0.2 * H, 0.14 * H, 0.2 * H), 0xd5dbe0)
        into_bind(head, arm, 'Fist.R')
        weight_to(head, 'Fist.R')
        parts.append(head)
    elif kind == 'rifle':
        fist = posed_tail(arm, 'Fist.R')
        length = 0.42 * H
        gun, forward = held('cube', fist, 'Fist.R', length, 0x232820, 0.11 * H)
        parts.append(gun)
        muzzle = add_cube('muzzle', fist + forward * (length * 0.72), (0.12 * H, 0.1 * H, 0.1 * H), 0xf3c53d)
        into_bind(muzzle, arm, 'Fist.R')
        weight_to(muzzle, 'Fist.R')
        parts.append(muzzle)
    elif kind == 'blades':
        for bone in ('Fist.L', 'Fist.R'):
            fist = posed_tail(arm, bone)
            blade, _forward = held('cube', fist, bone, 0.7 * H, 0xe7e1d4, 0.055 * H)
            parts.append(blade)
    elif kind == 'shield':
        fist = posed_tail(arm, 'Fist.L')
        forward = grip_forward(0)
        board = fist + forward * (0.05 * H) + Vector((0, 0, 0.12 * H))
        parts.append(put('cube', board, (0.4 * H, 0.07 * H, 0.52 * H), 0xb8ae86, 'Fist.L'))
        parts.append(put('cube', board + forward * (0.04 * H), (0.28 * H, 0.05 * H, 0.36 * H), 0x3f6b5e, 'Fist.L'))
        parts.append(put('cube', board + forward * (0.06 * H), (0.1 * H, 0.04 * H, 0.1 * H), 0x8fd0ff, 'Fist.L', emit=0.6))
        mace, _fwd = held('cube', posed_tail(arm, 'Fist.R'), 'Fist.R', 0.48 * H, 0xd5dbe0, 0.08 * H)
        parts.append(mace)
    elif kind == 'keg':
        tail, _direction = bone_points(arm, 'Torso')
        parts.append(put('cyl', tail + Vector((0.16 * H, 0.02 * H, -0.02 * H)), None, 0x6b5334, 'Torso', radius=0.12 * H, depth=0.2 * H))
    elif kind == 'ears':
        head, _direction = bone_points(arm, 'Head')
        for side in (-1, 1):
            parts.append(put(
                'cone', head + Vector((side * 0.08 * H, 0.0, 0.06 * H)), None, 0x1c1a18, 'Head',
                radius=0.05 * H, depth=0.18 * H, rot=(0.2, 0, side * 1.2),
            ))
        for bone in ('Fist.L', 'Fist.R'):
            blade, _forward = held('cube', posed_tail(arm, bone), bone, 0.66 * H, 0xe7e1d4, 0.05 * H)
            parts.append(blade)
    elif kind == 'staff':
        fist = posed_tail(arm, 'Fist.R')
        length = 0.62 * H
        shaft, forward = held('cyl', fist, 'Fist.R', length, 0xf0d060, 0.045 * H)
        parts.append(shaft)
        crystal = add_cone('crystal', fist + forward * length, 0.07 * H, 0.14 * H, 0xf0d060, emit=0.85)
        into_bind(crystal, arm, 'Fist.R')
        weight_to(crystal, 'Fist.R')
        parts.append(crystal)
    put.arm = None
    held.arm = None
    return parts


def crush_brain(mesh, arm):
    """The pack head is an exposed brain. Shrink that shell into the skull."""
    idx = next((i for i, mat in enumerate(mesh.data.materials) if mat and mat.name == 'Brain'), None)
    if idx is None:
        return
    ids = set()
    for poly in mesh.data.polygons:
        if poly.material_index == idx:
            ids.update(int(v) for v in poly.vertices)
    if not ids:
        return
    inv = mesh.matrix_world.inverted()
    center = inv @ bone_head(arm, 'Head')
    center.z += 0.15
    for i in ids:
        v = mesh.data.vertices[i]
        v.co = center + (v.co - center) * 0.4
    mesh.data.update()


def hive_eyes(parts, arm, height):
    """Two hot pits on the face. The crowd shader emits only these bright verts."""
    H = height
    head = bone_head(arm, 'Head')
    for side in (-1, 1):
        eye = add_blob(
            f'eye_{side}',
            head + Vector((side * 0.05 * H, -0.1 * H, 0.08 * H)),
            0.032 * H, 0xff3a12, scale=(1.0, 0.6, 0.7),
        )
        weight_to(eye, 'Head')
        parts.append(eye)


def rags(parts, arm, height, color):
    H = height
    torso = bone_head(arm, 'Torso')
    for side in (-1, 1):
        rag = add_cube(
            f'rag_{side}',
            torso + Vector((side * 0.14 * H, -0.02 * H, 0.02 * H)),
            (0.035 * H, 0.06 * H, 0.14 * H),
            color,
        )
        weight_to(rag, 'Torso')
        parts.append(rag)


def zombie_props(shape, arm, height):
    """Small ragged parts. They name the type without outgrowing the body."""
    H = height
    parts = []
    hive_eyes(parts, arm, H)
    rags(parts, arm, H, 0x1a1612)
    head = bone_head(arm, 'Head')
    torso = bone_head(arm, 'Torso')
    fist_r = bone_tail(arm, 'Fist.R')
    fist_l = bone_tail(arm, 'Fist.L')
    forward = (math.pi / 2, 0, 0)
    if shape == 'brute':
        for side in (-1, 1):
            pad = add_blob(
                f'pad_{side}', torso + Vector((side * 0.14 * H, 0.0, 0.06 * H)),
                0.07 * H, 0x3a3044, scale=(1.35, 0.8, 0.85),
            )
            weight_to(pad, 'Torso')
            parts.append(pad)
        hump = add_blob('hump', torso + Vector((0, 0.05 * H, 0.12 * H)), 0.08 * H, 0x2a2030, scale=(1.15, 0.8, 0.7))
        weight_to(hump, 'Torso')
        parts.append(hump)
    elif shape == 'spitter':
        sac = add_blob(
            'sac', torso + Vector((0.0, -0.12 * H, -0.02 * H)),
            0.08 * H, 0x8aaa32, scale=(0.9, 1.15, 0.85),
        )
        weight_to(sac, 'Torso')
        parts.append(sac)
    elif shape == 'burrower':
        for side, fist, bone in ((-1, fist_l, 'Fist.L'), (1, fist_r, 'Fist.R')):
            claw = add_cone(
                f'claw_{side}', fist + Vector((side * 0.02 * H, -0.02 * H, -0.02 * H)),
                0.035 * H, 0.28 * H, 0xc8bdd4, rot=(math.pi / 2 + 0.5, 0, side * 0.3),
            )
            weight_to(claw, bone)
            parts.append(claw)
    elif shape == 'sieger':
        shell = add_blob(
            'shell', torso + Vector((0, 0.02 * H, 0.08 * H)),
            0.1 * H, 0x6a4030, scale=(1.35, 0.7, 0.85),
        )
        ram = add_cone(
            'ram', torso + Vector((0, -0.14 * H, 0.0)),
            0.06 * H, 0.2 * H, 0xc4b09a, rot=forward,
        )
        weight_to(shell, 'Torso')
        weight_to(ram, 'Torso')
        parts += [shell, ram]
    elif shape == 'caller':
        fin = add_cube(
            'fin', head + Vector((0, -0.02 * H, 0.16 * H)),
            (0.04 * H, 0.16 * H, 0.22 * H), 0x7ec8c0,
        )
        weight_to(fin, 'Head')
        parts.append(fin)
    elif shape == 'runner':
        spine = add_cube(
            'spine', torso + Vector((0, 0.04 * H, 0.1 * H)),
            (0.03 * H, 0.05 * H, 0.16 * H), 0x9a8c68,
        )
        weight_to(spine, 'Torso')
        parts.append(spine)
    return parts


def rename_actions(attack_src):
    wanted = {
        'Idle': 'idle',
        'Walk': 'run',
        attack_src: 'attack',
        'Victory': 'ability',
        'RecieveHit': 'hit',
        'Defeat': 'death',
    }
    kept = []
    for act in list(bpy.data.actions):
        short = act.name.split('|')[-1]
        if short in wanted:
            act.name = wanted[short]
            kept.append(act)
        else:
            bpy.data.actions.remove(act)
    return kept


def push_nla(arm, actions):
    if arm.animation_data is None:
        arm.animation_data_create()
    ad = arm.animation_data
    for track in list(ad.nla_tracks):
        ad.nla_tracks.remove(track)
    for act in actions:
        track = ad.nla_tracks.new()
        track.name = act.name
        track.strips.new(act.name, int(act.frame_range[0]), act)
    ad.action = None


def export_glb(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kwargs = dict(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_animations=True,
        export_skins=True,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
        export_materials='EXPORT',
    )
    try:
        bpy.ops.export_scene.gltf(export_animation_mode='NLA_TRACKS', **kwargs)
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)


def find_action(name):
    for act in bpy.data.actions:
        if act.name == name or act.name.split('|')[-1] == name:
            return act
    raise KeyError(name)


def bake_frames(arm, mesh, action, count, scale=1.0):
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    start, end = action.frame_range
    frames_pos, frames_nrm = [], []
    steps = [start + (end - start) * i / max(1, count - 1) for i in range(count)]
    for frame in steps:
        bpy.context.scene.frame_set(int(round(frame)))
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(deps)
        me = ev.to_mesh()
        pos, nrm = [], []
        for v in me.vertices:
            # Blender Z-up to glTF Y-up: (x, z, -y). `lean` shears the body
            # toward -Y (the pack's forward) so a runner reads hunched.
            sx, sy, sz = getattr(bake_frames, 'squash', (1.0, 1.0, 1.0))
            lean = getattr(bake_frames, 'lean', 0.0)
            by = v.co.y - lean * max(0.0, v.co.z)
            pos.append((v.co.x * sx * scale, v.co.z * sz * scale, -by * sy * scale))
            nx = v.normal.x / max(sx, 1e-4)
            ny = v.normal.y / max(sy, 1e-4)
            nz = v.normal.z / max(sz, 1e-4)
            length = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
            nrm.append((nx / length, nz / length, -ny / length))
        ev.to_mesh_clear()
        frames_pos.append(pos)
        frames_nrm.append(nrm)
    return frames_pos, frames_nrm


def write_vat(path, mesh, clips, pos_frames, nrm_frames):
    """ZV02: clips, triangle indices, vertex colours, then position and normal frames.

    The runtime builds the crowd mesh from this file alone so a glTF export
    cannot reorder vertices out from under the animation texture.
    """
    data = mesh.data
    data.calc_loop_triangles()
    indices = []
    for tri in data.loop_triangles:
        indices.extend(int(i) for i in tri.vertices)
    colors = bytearray()
    attr = data.color_attributes.get('Col')
    for i in range(len(data.vertices)):
        rgba = attr.data[i].color if attr else (1, 1, 1, 1)
        colors += bytes(max(0, min(255, int(c * 255))) for c in rgba)
    vert = len(pos_frames[0])
    if vert != len(data.vertices):
        raise RuntimeError(f'vat verts {vert} != mesh {len(data.vertices)}')
    blob = bytearray()
    blob += b'ZV02'
    blob += struct.pack('<IIII', vert, len(pos_frames), len(clips), len(indices))
    for name, start, length in clips:
        blob += name.encode('ascii')[:16].ljust(16, b'\0')
        blob += struct.pack('<II', start, length)
    blob += struct.pack('<' + 'I' * len(indices), *indices)
    blob += colors
    for frame in pos_frames:
        if len(frame) != vert:
            raise RuntimeError(f'vat vertex count changed ({len(frame)} != {vert})')
        for x, y, z in frame:
            blob += struct.pack('<fff', x, y, z)
    for frame in nrm_frames:
        for x, y, z in frame:
            blob += struct.pack('<fff', x, y, z)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(blob)


def vertex_colors_from_materials(mesh):
    data = mesh.data
    # Drop anything the FBX importer already stored so the glTF exporter
    # writes this attribute as COLOR_0.
    for name in list(data.color_attributes.keys()):
        data.color_attributes.remove(data.color_attributes[name])
    attr = data.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    colors = [(0.5, 0.5, 0.5, 1.0)] * len(data.vertices)
    for poly in data.polygons:
        mat = data.materials[poly.material_index] if data.materials else None
        rgba = mat.diffuse_color if mat else (0.5, 0.5, 0.5, 1.0)
        for vi in poly.vertices:
            colors[vi] = rgba
    for i, rgba in enumerate(colors):
        attr.data[i].color = rgba


def build_hero(spec, src_dir, out_dir):
    arm, mesh = import_fbx(os.path.join(src_dir, spec['file']))
    paint(mesh, spec['colors'])
    # Do not apply a scale to the armature. That desyncs the clip from the
    # mesh. The runtime fits the figure to HERO_HEIGHT before the 0.82 group.
    parts = hero_props(spec['props'], arm, mesh.dimensions.z or HERO_HEIGHT)
    mesh = join_into(mesh, parts)
    shade_flat(mesh)
    actions = rename_actions(spec['attack'])
    push_nla(arm, actions)
    export_glb(os.path.join(out_dir, 'heroes', f"hero_{spec['key']}.glb"), [arm, mesh])
    print(f"hero {spec['key']} -> {len(mesh.data.vertices)} verts, actions {[a.name for a in actions]}")


def build_zombie(spec, src_dir, out_dir):
    arm, mesh = import_fbx(os.path.join(src_dir, 'Zombie_Male.fbx'))
    paint(mesh, spec['colors'])
    crush_brain(mesh, arm)
    # Same rule as the heroes: never apply a scale to this armature.
    body_h = mesh.dimensions.z or 1.0
    parts = zombie_props(spec['shape'], arm, body_h)
    mesh = join_into(mesh, parts)
    shade_flat(mesh)
    vertex_colors_from_materials(mesh)
    # One flat material. Colour lives on the vertices the crowd shader reads.
    body = new_mat('body', 0xffffff)
    nt = body.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    vcol = nt.nodes.new('ShaderNodeVertexColor')
    vcol.layer_name = 'Col'
    nt.links.new(vcol.outputs['Color'], bsdf.inputs['Base Color'])
    mesh.data.materials.clear()
    mesh.data.materials.append(body)
    # Sample before renaming so the source ranges stay put, then rename.
    order = [('idle', 'Idle', 8), ('walk', 'Walk', 10), ('attack', 'Punch', 8), ('death', 'Defeat', 10)]
    # Fit the body (measured before props) so a crest or ram can stick out
    # without shrinking the figure into the prop.
    fit = ZOMBIE_HEIGHT / body_h
    pos_all, nrm_all, clips = [], [], []
    for name, src, count in order:
        act = find_action(src)
        bake_frames.squash = spec['wide']
        bake_frames.lean = spec.get('lean', 0.0)
        pos, nrm = bake_frames(arm, mesh, act, count, scale=fit)
        clips.append((name, len(pos_all), count))
        pos_all.extend(pos)
        nrm_all.extend(nrm)
    vat_path = os.path.join(out_dir, 'zombies', f"zombie_{spec['key']}.vat.bin")
    write_vat(vat_path, mesh, clips, pos_all, nrm_all)
    print(f"zombie {spec['key']} -> {len(mesh.data.vertices)} verts, {len(pos_all)} frames")


def main():
    args = argv()
    if not args['src']:
        raise SystemExit('pass --src /path/to/FBX')
    only = args['only']
    for spec in HEROES:
        if only and spec['key'] not in only and f"hero_{spec['key']}" not in only:
            continue
        build_hero(spec, args['src'], args['out'])
    for spec in ZOMBIES:
        if only and spec['key'] not in only and f"zombie_{spec['key']}" not in only:
            continue
        build_zombie(spec, args['src'], args['out'])


if __name__ == '__main__':
    main()
