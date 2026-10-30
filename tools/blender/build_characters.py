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
from mathutils import Vector

HERO_HEIGHT = 1.35
ZOMBIE_HEIGHT = 1.5

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

# Hive bodies stay dark so they hold on grass, sand and snow. The accent is
# the part you name the type by, and it is the brightest thing on the mesh.
ZOMBIES = [
    {
        'key': 'walker', 'wide': (1.0, 1.0, 1.0), 'shape': 'shambler',
        'colors': {
            'Skin': 0x6e5c7c, 'Clothes': 0x3c3348, 'Guts': 0xe45aaa, 'Pants': 0x2a2433,
            'DarkClothes': 0x241e2c, 'Bones': 0xd7c2bf, 'Brain': 0xff4ad4, 'Face': 0xff5ad8,
        },
    },
    {
        'key': 'runner', 'wide': (0.78, 0.72, 0.96), 'lean': 0.48, 'shape': 'runner',
        'colors': {
            'Skin': 0xd2c48a, 'Clothes': 0x2a261c, 'Guts': 0xffe27a, 'Pants': 0x1c1a14,
            'DarkClothes': 0x14120e, 'Bones': 0xf0e2b0, 'Brain': 0xfff0a0, 'Face': 0xfff3a8,
        },
    },
    {
        'key': 'brute', 'wide': (1.12, 1.08, 1.02), 'shape': 'brute',
        'colors': {
            'Skin': 0x5c4578, 'Clothes': 0x3a2a52, 'Guts': 0xd2b4ff, 'Pants': 0x241830,
            'DarkClothes': 0x1a1224, 'Bones': 0xe4d4ff, 'Brain': 0xff7ae0, 'Face': 0xff8ae8,
        },
    },
    {
        'key': 'spitter', 'wide': (1.05, 1.12, 0.98), 'shape': 'spitter',
        'colors': {
            'Skin': 0x6d7348, 'Clothes': 0x3a4024, 'Guts': 0xd6ff4a, 'Pants': 0x242814,
            'DarkClothes': 0x181c10, 'Bones': 0xe8f0b0, 'Brain': 0xeaff6a, 'Face': 0xf4ff80,
        },
    },
    {
        'key': 'burrower', 'wide': (1.55, 1.35, 0.48), 'shape': 'burrower',
        'colors': {
            'Skin': 0x4e446c, 'Clothes': 0x2e2844, 'Guts': 0xc8b6ff, 'Pants': 0x1c1830,
            'DarkClothes': 0x141022, 'Bones': 0xddd0ff, 'Brain': 0xff5ad0, 'Face': 0xff6ad8,
        },
    },
    {
        'key': 'sieger', 'wide': (1.18, 1.22, 1.04), 'shape': 'sieger',
        'colors': {
            'Skin': 0x6a5344, 'Clothes': 0x4a3428, 'Guts': 0xffb060, 'Pants': 0x2a1c14,
            'DarkClothes': 0x1c120c, 'Bones': 0xf0d0b0, 'Brain': 0xffc070, 'Face': 0xffc878,
        },
    },
    {
        'key': 'caller', 'wide': (0.62, 1.25, 1.18), 'shape': 'caller',
        'colors': {
            'Skin': 0x3e6460, 'Clothes': 0x243e3c, 'Guts': 0x7dfff0, 'Pants': 0x142826,
            'DarkClothes': 0x101c1c, 'Bones': 0xd8fff8, 'Brain': 0xb8fff4, 'Face': 0xd8fff8,
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


def put(kind, loc, size, color, bone, emit=0.0, radius=0.05, depth=0.2, rot=None):
    if kind == 'cube':
        obj = add_cube(bone + '_prop', loc, size, color, emit)
    elif kind == 'cone':
        obj = add_cone(bone + '_prop', loc, radius, depth, color, emit, rot=rot)
    else:
        obj = add_cylinder(bone + '_prop', loc, radius, depth, color, emit)
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


def hero_props(kind, arm, height):
    """Big props, joined and weighted so they follow the clip and read at distance 46.

    Placement is in the bind pose: out to the side or forward, not buried in
    a hanging fist. The runtime fits the body, so these may stick past it.
    """
    H = height
    parts = []
    def outward(fist):
        return -1 if fist.x < 0 else 1
    if kind == 'hammer':
        fist = bone_tail(arm, 'Fist.R')
        side = outward(fist)
        handle = fist + Vector((side * 0.18 * H, -0.02 * H, 0.08 * H))
        head = fist + Vector((side * 0.42 * H, -0.02 * H, 0.2 * H))
        parts.append(put('cyl', handle, None, 0x3a3228, 'Fist.R', radius=0.055 * H, depth=0.28 * H))
        parts.append(put('cube', head, (0.62 * H, 0.28 * H, 0.36 * H), 0xe7eef2, 'Fist.R'))
    elif kind == 'rifle':
        fist = bone_tail(arm, 'Fist.R')
        side = outward(fist)
        gun = fist + Vector((side * 0.28 * H, -0.12 * H, 0.12 * H))
        parts.append(put('cube', gun, (0.55 * H, 0.16 * H, 0.14 * H), 0x232820, 'Fist.R'))
        parts.append(put('cube', gun + Vector((side * 0.22 * H, -0.02 * H, 0.08 * H)), (0.18 * H, 0.12 * H, 0.12 * H), 0xf3c53d, 'Fist.R'))
    elif kind == 'blades':
        for bone in ('Fist.L', 'Fist.R'):
            fist = bone_tail(arm, bone)
            side = outward(fist)
            blade = fist + Vector((side * 0.28 * H, -0.08 * H, 0.06 * H))
            parts.append(put('cube', blade, (0.42 * H, 0.12 * H, 0.1 * H), 0xe7e1d4, bone))
    elif kind == 'shield':
        fist = bone_tail(arm, 'Fist.L')
        side = outward(fist)
        board = fist + Vector((side * 0.38 * H, -0.04 * H, 0.22 * H))
        parts.append(put('cube', board, (0.62 * H, 0.12 * H, 0.74 * H), 0xb8ae86, 'Fist.L'))
        parts.append(put('cube', board + Vector((0, 0, 0.02 * H)), (0.46 * H, 0.14 * H, 0.54 * H), 0x3f6b5e, 'Fist.L'))
        parts.append(put('cube', board + Vector((0, -0.02 * H, 0.04 * H)), (0.16 * H, 0.16 * H, 0.16 * H), 0x8fd0ff, 'Fist.L', emit=0.9))
        mace = bone_tail(arm, 'Fist.R')
        mside = outward(mace)
        parts.append(put('cube', mace + Vector((mside * 0.32 * H, -0.04 * H, 0.1 * H)), (0.28 * H, 0.22 * H, 0.28 * H), 0xd5dbe0, 'Fist.R'))
    elif kind == 'keg':
        tail, _direction = bone_points(arm, 'Torso')
        parts.append(put('cyl', tail + Vector((0.28 * H, 0.04 * H, 0.04 * H)), None, 0x6b5334, 'Torso', radius=0.26 * H, depth=0.34 * H))
        parts.append(put('cube', tail + Vector((0.28 * H, 0.04 * H, 0.04 * H)), (0.54 * H, 0.1 * H, 0.1 * H), 0xd23b32, 'Torso'))
    elif kind == 'ears':
        head, _direction = bone_points(arm, 'Head')
        for side in (-1, 1):
            parts.append(put(
                'cone', head + Vector((side * 0.12 * H, 0.0, 0.1 * H)), None, 0x1c1a18, 'Head',
                radius=0.1 * H, depth=0.36 * H, rot=(0.15, 0, side * 1.15),
            ))
        for bone in ('Fist.L', 'Fist.R'):
            fist = bone_tail(arm, bone)
            side = outward(fist)
            blade = fist + Vector((side * 0.26 * H, -0.06 * H, 0.06 * H))
            parts.append(put('cube', blade, (0.38 * H, 0.11 * H, 0.09 * H), 0xe7e1d4, bone))
    elif kind == 'staff':
        fist = bone_tail(arm, 'Fist.R')
        side = outward(fist)
        shaft = fist + Vector((side * 0.16 * H, -0.02 * H, 0.22 * H))
        parts.append(put('cyl', shaft, None, 0xf0d060, 'Fist.R', radius=0.045 * H, depth=0.55 * H))
        parts.append(put(
            'cone', shaft + Vector((0, 0, 0.28 * H)), None, 0xf0d060, 'Fist.R',
            emit=0.9, radius=0.18 * H, depth=0.26 * H,
        ))
    return parts


def zombie_props(shape, arm, height):
    """Kitbash a silhouette you can name at distance 46. Sizes are fractions of body height."""
    H = height
    parts = []
    head = bone_head(arm, 'Head')
    torso = bone_head(arm, 'Torso')
    fist_r = bone_tail(arm, 'Fist.R')
    fist_l = bone_tail(arm, 'Fist.L')
    # Character faces Blender -Y. Cones are base-at-loc, tip along local +Z before rot.
    forward = (math.pi / 2, 0, 0)  # tip toward -Y
    if shape == 'brute':
        for side in (-1, 1):
            pad = add_blob(
                f'pad_{side}', torso + Vector((side * 0.16 * H, 0.0, 0.1 * H)),
                0.08 * H, 0xd2b4ff, scale=(1.25, 0.85, 0.9),
            )
            weight_to(pad, 'Torso')
            parts.append(pad)
        hump = add_blob('hump', torso + Vector((0, 0.06 * H, 0.16 * H)), 0.1 * H, 0xb48cff, scale=(1.2, 0.85, 0.8))
        weight_to(hump, 'Torso')
        parts.append(hump)
    elif shape == 'spitter':
        sac = add_blob(
            'sac', torso + Vector((0.0, -0.14 * H, 0.02 * H)),
            0.11 * H, 0xd6ff4a, emit=0.7, scale=(1.05, 1.25, 1.05),
        )
        weight_to(sac, 'Torso')
        parts.append(sac)
    elif shape == 'burrower':
        for side, fist, bone in ((-1, fist_l, 'Fist.L'), (1, fist_r, 'Fist.R')):
            claw = add_cone(
                f'claw_{side}', fist + Vector((side * 0.04 * H, -0.02 * H, -0.04 * H)),
                0.05 * H, 0.42 * H, 0xc8b6ff, rot=(math.pi / 2 + 0.45, 0, side * 0.35),
            )
            weight_to(claw, bone)
            parts.append(claw)
    elif shape == 'sieger':
        shell = add_blob(
            'shell', torso + Vector((0, 0.04 * H, 0.1 * H)),
            0.13 * H, 0xffb060, scale=(1.45, 0.75, 0.95),
        )
        ram = add_cone(
            'ram', torso + Vector((0, -0.16 * H, 0.02 * H)),
            0.09 * H, 0.28 * H, 0xf0d0b0, rot=forward,
        )
        weight_to(shell, 'Torso')
        weight_to(ram, 'Torso')
        parts += [shell, ram]
    elif shape == 'caller':
        # A sail: thin across the shoulders, long front-to-back, tall.
        # From the high camera the length is what reads.
        fin = add_cube(
            'fin', head + Vector((0, -0.02 * H, 0.32 * H)),
            (0.07 * H, 0.42 * H, 0.62 * H), 0xd8fff8, emit=0.75,
        )
        weight_to(fin, 'Head')
        parts.append(fin)
    elif shape == 'runner':
        crest = add_cone(
            'crest', head + Vector((0, -0.04 * H, 0.06 * H)),
            0.035 * H, 0.28 * H, 0xfff3a8, emit=0.4, rot=(0.9, 0, 0),
        )
        weight_to(crest, 'Head')
        parts.append(crest)
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
    paint(mesh, spec['colors'], emit_names=('Face', 'Brain', 'Guts'))
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
