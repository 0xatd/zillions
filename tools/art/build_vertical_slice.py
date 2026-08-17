"""Build the first Zillions production-art vertical slice as GLB files.

This is source art, not runtime code. Run it with Blender 4.x in background
mode. The generated models use a shared stylized material language and named
parts that the Three.js runtime can bind.
"""

import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
OUT = os.path.join(ROOT, "assets", "art-slice")
os.makedirs(OUT, exist_ok=True)

PALETTE = {
    "hull": (0.72, 0.69, 0.60, 1),
    "hull_light": (0.90, 0.86, 0.73, 1),
    "frame": (0.055, 0.065, 0.08, 1),
    "steel": (0.19, 0.23, 0.28, 1),
    "orange": (0.92, 0.25, 0.055, 1),
    "cyan": (0.04, 0.72, 0.78, 1),
    "red": (0.52, 0.025, 0.025, 1),
    "white": (0.92, 0.91, 0.84, 1),
    "hive": (0.15, 0.055, 0.19, 1),
    "hive_shell": (0.29, 0.10, 0.34, 1),
    "hive_glow": (0.84, 0.08, 0.92, 1),
}


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)


def material(name, color, metallic=0.0, roughness=0.72, emission=None):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = 2.5
    return m


def mats():
    return {
        "hull": material("mat_hull", PALETTE["hull"], 0.28, 0.66),
        "hull_light": material("mat_hull_light", PALETTE["hull_light"], 0.18, 0.72),
        "frame": material("mat_frame", PALETTE["frame"], 0.55, 0.38),
        "steel": material("mat_steel", PALETTE["steel"], 0.72, 0.3),
        "orange": material("mat_hazard", PALETTE["orange"], 0.25, 0.48),
        "cyan": material("mat_power", PALETTE["cyan"], 0.15, 0.28, PALETTE["cyan"]),
        "red": material("mat_scott_red", PALETTE["red"], 0.4, 0.42),
        "white": material("mat_scott_white", PALETTE["white"], 0.2, 0.62),
        "hive": material("mat_hive", PALETTE["hive"], 0.0, 0.82),
        "hive_shell": material("mat_hive_shell", PALETTE["hive_shell"], 0.05, 0.66),
        "hive_glow": material("mat_hive_glow", PALETTE["hive_glow"], 0.0, 0.35, PALETTE["hive_glow"]),
    }


def finish(obj, mat, bevel=0.04):
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("edge_chamfer", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    obj.select_set(True)
    return obj


def cube(name, loc, scale, mat, bevel=0.04, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(o, mat, bevel)
    if parent:
        o.parent = parent
    return o


def cyl(name, loc, radius, depth, mat, vertices=12, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    finish(o, mat, min(0.04, radius * 0.12))
    if parent:
        o.parent = parent
    return o


def cone(name, loc, r1, r2, depth, mat, vertices=10, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    finish(o, mat, 0.035)
    if parent:
        o.parent = parent
    return o


def sphere(name, loc, scale, mat, parent=None, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(o, mat, 0)
    if parent:
        o.parent = parent
    return o


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o


def export(name):
    path = os.path.join(OUT, f"{name}.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=True,
    )
    print(f"exported {path}")


def root():
    return empty("asset_root")


def powered_strip(z, y, width, m, parent):
    return cube("part_power_strip", (0, z, y), (width, 0.045, 0.07), m["cyan"], 0.01, parent=parent)


def build_hq(tier, m):
    r = root()
    cube("foundation", (0, 0, 0.18), (2.35, 2.35, 0.18), m["frame"], 0.1, parent=r)
    cube("command_hall", (0, 0, 1.05), (1.75, 1.75, 0.78), m["hull"], 0.18, parent=r)
    cube("ops_band", (0, -1.76, 1.25), (1.32, 0.05, 0.18), m["cyan"], 0.02, parent=r)
    for sx, sy in [(-1, -1), (1, -1), (-1, 1), (1, 1)][:tier + 1]:
        cone("support_pylon", (sx * 1.55, sy * 1.55, 1.55), 0.32, 0.18, 2.65, m["hull"], parent=r)
        cube("pylon_light", (sx * 1.55, sy * 1.55, 2.92), (0.14, 0.14, 0.12), m["orange"], 0.02, parent=r)
    spire_h = 2.1 + tier * 0.75
    cone("command_spire", (0, 0, 2.1 + spire_h / 2), 0.72, 0.38, spire_h, m["hull"], 12, r)
    cyl("part_core", (0, 0, 2.7 + spire_h * 0.62), 0.84, 0.16, m["cyan"], 16, r)
    cube("crown", (0, 0, 2.2 + spire_h), (1.15, 1.15, 0.18), m["frame"], 0.09, parent=r)
    if tier >= 2:
        for x in (-1.15, 1.15):
            cube("operations_wing", (x, 0, 2.25), (0.62, 1.45, 0.48), m["hull"], 0.12, parent=r)
    if tier >= 3:
        cyl("orbital_relay", (0, 0, 6.25), 0.16, 2.1, m["frame"], 10, r)
        cone("relay_dish", (0.35, 0, 7.2), 0.68, 0.12, 0.32, m["hull"], 16, r, (0, math.radians(62), 0))
        cube("socket_ability", (0, 0, 7.55), (0.04, 0.04, 0.04), m["cyan"], 0, parent=r)


def build_tower(tier, m):
    r = root()
    cube("foundation", (0, 0, 0.18), (0.95, 0.95, 0.18), m["frame"], 0.08, parent=r)
    h = 2.25 + tier * 0.62
    cone("armored_shaft", (0, 0, 0.35 + h / 2), 0.72, 0.48, h, m["hull"], 12, r)
    cyl("sensor_band", (0, 0, h * 0.7), 0.57, 0.14, m["cyan"], 16, r)
    cube("gun_deck", (0, 0, h + 0.48), (0.92, 0.92, 0.22), m["frame"], 0.12, parent=r)
    turret = empty("part_turret", (0, 0, h + 0.78), r)
    cube("turret_housing", (0, 0, 0), (0.55 + tier * 0.08, 0.48, 0.28), m["hull"], 0.1, parent=turret)
    for x in (-0.27, 0.27) if tier >= 2 else (0,):
        cube("weapon", (x, 0.62, 0.02), (0.09, 0.72, 0.1), m["frame"], 0.025, parent=turret)
    cube("socket_muzzle", (0, 1.38, 0.02), (0.04, 0.04, 0.04), m["orange"], 0, parent=turret)
    if tier >= 3:
        for a in range(4):
            x, y = math.cos(a * math.pi / 2) * 0.75, math.sin(a * math.pi / 2) * 0.75
            cube("reactive_armor", (x, y, h + 0.5), (0.23, 0.23, 0.26), m["orange"], 0.04, parent=r)


def build_barracks(tier, m):
    r = root()
    cube("muster_pad", (0, 0, 0.12), (1.15, 1.15, 0.12), m["frame"], 0.08, parent=r)
    cube("bay", (0, 0.1, 0.92), (0.95, 0.88, 0.8), m["hull"], 0.2, parent=r)
    cube("deployment_door", (0, 0.93, 0.72), (0.52, 0.04, 0.56), m["frame"], 0.03, parent=r)
    cube("doctrine_light", (0, 0.99, 1.5), (0.76, 0.04, 0.08), m["orange"], 0.02, parent=r)
    if tier >= 2:
        cube("armory_wing", (-0.83, -0.2, 0.68), (0.44, 0.72, 0.58), m["hull"], 0.12, parent=r)
        cyl("ammo_drum", (0.82, -0.4, 0.52), 0.36, 0.95, m["frame"], 12, r, (math.pi / 2, 0, 0))
    if tier >= 3:
        cube("command_bridge", (0, -0.18, 2.0), (0.72, 0.52, 0.38), m["hull"], 0.1, parent=r)
        cyl("part_core", (0, 0, 2.62), 0.28, 0.72, m["cyan"], 12, r)


def build_mine(m):
    r = root()
    cube("extractor_pad", (0, 0, 0.12), (1.05, 1.05, 0.12), m["frame"], 0.08, parent=r)
    for x in (-0.66, 0.66):
        cone("gantry", (x, 0, 1.25), 0.18, 0.11, 2.3, m["hull"], 8, r)
    cube("gantry_beam", (0, 0, 2.35), (0.92, 0.18, 0.18), m["hull"], 0.06, parent=r)
    rotor = empty("part_rotor", (0, 0, 2.35), r)
    cyl("extractor_wheel", (0, 0, 0), 0.58, 0.18, m["orange"], 16, rotor, (math.pi / 2, 0, 0))
    for a in range(6):
        cube("wheel_spoke", (math.cos(a * math.pi / 3) * 0.28, 0, math.sin(a * math.pi / 3) * 0.28), (0.07, 0.08, 0.42), m["frame"], 0.02, rot=(0, a * math.pi / 3, 0), parent=rotor)
    cone("ore_chute", (0, 0.45, 0.7), 0.62, 0.32, 1.1, m["frame"], 10, r, (math.pi / 2, 0, 0))


def build_wall(gate, m):
    r = root()
    if not gate:
        cube("wall_panel", (0, 0, 0.62), (0.5, 0.2, 0.62), m["hull"], 0.08, parent=r)
        cube("wall_cap", (0, 0, 1.28), (0.52, 0.24, 0.08), m["frame"], 0.04, parent=r)
        cube("perimeter_light", (0, 0, 1.42), (0.1, 0.12, 0.08), m["orange"], 0.02, parent=r)
    else:
        for x in (-0.64, 0.64):
            cone("gate_pylon", (x, 0, 1.15), 0.34, 0.24, 2.3, m["hull"], 10, r)
            cube("gate_light", (x, 0, 2.36), (0.18, 0.18, 0.1), m["orange"], 0.03, parent=r)
        cube("gate_arch", (0, 0, 2.15), (0.84, 0.2, 0.13), m["frame"], 0.05, parent=r)
        cube("portal_light", (0, 0, 2.42), (0.88, 0.23, 0.06), m["cyan"], 0.03, parent=r)


def build_humanoid(hero, m):
    r = root()
    body = empty("body", parent=r)
    primary = m["red"] if hero else m["hull"]
    secondary = m["white"]
    leg_l = empty("leg_l", (-0.20, 0, 0.70), body)
    leg_r = empty("leg_r", (0.20, 0, 0.70), body)
    for leg in (leg_l, leg_r):
        cone("thigh_armor", (0, 0, -0.12), 0.15, 0.19, 0.38, primary, 6, leg)
        cone("greave", (0, 0.015, -0.48), 0.17, 0.115, 0.40, m["frame"], 6, leg)
        cube("boot", (0, 0.12, -0.73), (0.17, 0.27, 0.13), m["frame"], 0.055, parent=leg)
    cone("torso", (0, 0, 1.23), 0.34 if hero else 0.29, 0.52 if hero else 0.43, 0.78, primary, 8, body)
    cone("waist", (0, 0, 0.82), 0.27, 0.35, 0.28, m["frame"], 10, body)
    cube("chest_plate", (0, 0.30, 1.30), (0.30 if hero else 0.24, 0.055, 0.20), secondary, 0.045, parent=body)
    cube("power_core", (0, 0.365, 1.29), (0.09, 0.025, 0.06), m["cyan"], 0.015, parent=body)
    arm_l = empty("arm_l", (-0.50 if hero else -0.41, 0, 1.42), body)
    arm_r = empty("arm_r", (0.50 if hero else 0.41, 0, 1.42), body)
    for arm in (arm_l, arm_r):
        sphere("pauldron", (0, 0, 0), (0.25 if hero else 0.19, 0.28, 0.20), primary, arm)
        cone("upper_arm", (0, 0.01, -0.24), 0.13, 0.16, 0.35, secondary, 6, arm)
        cone("forearm", (0, 0.06, -0.51), 0.15, 0.105, 0.34, m["frame"], 6, arm)
    sphere("helmet", (0, 0, 1.86), (0.30 if hero else 0.25, 0.285, 0.27), m["white"], body)
    cube("helmet_brow", (0, 0.255, 1.91), (0.27 if hero else 0.22, 0.065, 0.09), primary, 0.035, parent=body)
    cube("visor", (0, 0.327, 1.89), (0.20 if hero else 0.17, 0.025, 0.055), m["cyan"], 0.015, parent=body)
    cone("helmet_crest", (0, -0.02, 2.15), 0.06, 0.14, 0.28, primary, 6, body)
    cube("backpack", (0, -0.31, 1.30), (0.33, 0.16, 0.38), m["frame"], 0.07, parent=body)
    for x in (-0.19, 0.19):
        cyl("power_cell", (x, -0.49, 1.31), 0.075, 0.46, m["cyan"], 10, body)
    weapon = empty("weapon", (0.34, 0.39, 1.18), body)
    weapon.rotation_euler[1] = math.radians(-12)
    cube("rifle_body", (0, 0.18, 0), (0.12, 0.56 if hero else 0.47, 0.12), m["frame"], 0.045, parent=weapon)
    cube("rifle_shroud", (0, 0.27, 0), (0.17, 0.25, 0.17), primary, 0.05, parent=weapon)
    if hero:
        cube("second_barrel", (-0.20, 0.22, 0), (0.095, 0.53, 0.095), m["frame"], 0.03, parent=weapon)
        hammer = empty("silhouette_hammer", (-0.46, -0.28, 1.32), body)
        hammer.rotation_euler[1] = math.radians(-22)
        cube("hammer_haft", (0, 0, 0), (0.055, 0.055, 0.72), m["frame"], 0.025, parent=hammer)
        cube("hammer_head", (0, 0, 0.67), (0.38, 0.20, 0.21), m["white"], 0.075, parent=hammer)
        cube("hammer_core", (0, 0.21, 0.67), (0.14, 0.025, 0.09), m["cyan"], 0.015, parent=hammer)
    cube("socket_muzzle", (0, 0.76 if hero else 0.68, 0), (0.035, 0.035, 0.035), m["cyan"], 0, parent=weapon)


def build_zombie(m):
    r = root()
    body = empty("body", parent=r)
    sphere("thorax", (0, 0.06, 0.82), (0.38, 0.48, 0.42), m["hive_shell"], body)
    sphere("abdomen", (0, -0.32, 0.54), (0.44, 0.52, 0.36), m["hive"], body)
    sphere("weak_point", (0, 0.35, 0.88), (0.14, 0.08, 0.13), m["hive_glow"], body)
    for side in (-1, 1):
        for row in range(3):
            a = (-0.48 + row * 0.38)
            leg = empty("leg_l" if side < 0 and row == 1 else "leg_r" if side > 0 and row == 1 else "limb", (side * 0.25, a, 0.65), body)
            cone("limb_upper", (side * 0.26, 0, -0.17), 0.1, 0.065, 0.62, m["hive_shell"], 7, leg, (0, math.radians(side * 52), 0))
            cone("limb_claw", (side * 0.55, 0.02, -0.44), 0.07, 0.015, 0.48, m["hive"], 7, leg, (0, math.radians(side * 68), 0))
    cone("head", (0, 0.46, 0.98), 0.28, 0.08, 0.5, m["hive_shell"], 8, body, (math.radians(72), 0, 0))
    cube("socket_ability", (0, 0.72, 1.0), (0.035, 0.035, 0.035), m["hive_glow"], 0, parent=body)


BUILDERS = []
for t in (1, 2, 3):
    BUILDERS.extend([
        (f"human_hq_t{t}", lambda m, t=t: build_hq(t, m)),
        (f"human_tower_t{t}", lambda m, t=t: build_tower(t, m)),
        (f"human_barracks_t{t}", lambda m, t=t: build_barracks(t, m)),
    ])
BUILDERS.extend([
    ("human_mine", build_mine),
    ("human_wall", lambda m: build_wall(False, m)),
    ("human_gate", lambda m: build_wall(True, m)),
    ("hero_scott", lambda m: build_humanoid(True, m)),
    ("human_rifleman", lambda m: build_humanoid(False, m)),
    ("hive_drone", build_zombie),
])

for asset_name, builder in BUILDERS:
    clear()
    builder(mats())
    export(asset_name)
