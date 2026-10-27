"""Toy-kit core: vertex-coloured, flat-shaded, low-poly geometry for bpy.

Authoring happens in GAME coordinates (x right, y up, +z = the way a figure
faces, which matches unit.facing = atan2(dx, dz) in the sim). Each Part is a
bmesh; on export every vertex is mapped to Blender space (x, -z, y) so the
glTF exporter's Y-up conversion lands it back on game axes.

One material per mesh ("toy" or "glow"), colour carried in a COLOR_0
attribute. The runtime swaps in its own flat Lambert / unlit materials, so
nothing here depends on Blender shading.
"""
import math
import os

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


def lin(hexv):
    out = []
    for sh in (16, 8, 0):
        c = ((hexv >> sh) & 255) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


def shade(hexv, f):
    r = min(255, int(((hexv >> 16) & 255) * f))
    g = min(255, int(((hexv >> 8) & 255) * f))
    b = min(255, int((hexv & 255) * f))
    return (r << 16) | (g << 8) | b


def xform(x=0, y=0, z=0, rx=0, ry=0, rz=0, sx=1, sy=1, sz=1):
    rot = Euler((rx, ry, rz), 'YXZ').to_matrix().to_4x4()
    return Matrix.Translation((x, y, z)) @ rot @ Matrix.Diagonal((sx, sy, sz, 1))


class Part:
    """One output mesh. Geometry is emitted in game space."""

    def __init__(self, name, origin=(0, 0, 0), glow=False):
        self.name = name
        self.origin = Vector(origin)
        self.glow = glow
        self.bm = bmesh.new()
        self.cl = self.bm.loops.layers.float_color.new('Color')

    def empty(self):
        return len(self.bm.faces) == 0

    def emit(self, verts, faces, color, M):
        M = Matrix.Translation(-self.origin) @ M
        vs = [self.bm.verts.new(M @ Vector(v)) for v in verts]
        c = lin(color)
        for f in faces:
            try:
                face = self.bm.faces.new([vs[i] for i in f])
            except ValueError:
                continue
            for lp in face.loops:
                lp[self.cl] = c

    # ---- primitives (all bottom-anchored at y unless noted) ----
    def box(self, c, w, h, d, x=0, y=0, z=0, rx=0, ry=0, rz=0):
        hw, hd = w / 2, d / 2
        v = [(-hw, 0, -hd), (hw, 0, -hd), (hw, 0, hd), (-hw, 0, hd),
             (-hw, h, -hd), (hw, h, -hd), (hw, h, hd), (-hw, h, hd)]
        f = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        self.emit(v, f, c, xform(x, y, z, rx, ry, rz))

    def prism(self, c, n, rb, rt, h, x=0, y=0, z=0, phase=0.0, rx=0, ry=0, rz=0, sx=1, sz=1):
        """n-gon frustum (cylinder / cone / pyramid when rt == 0)."""
        v = []
        for i in range(n):
            a = phase + i / n * math.tau
            v.append((math.cos(a) * rb, 0, math.sin(a) * rb))
        f = [tuple(range(n))]
        if rt <= 1e-4:
            v.append((0, h, 0))
            for i in range(n):
                f.append((i, n, (i + 1) % n))
        else:
            for i in range(n):
                a = phase + i / n * math.tau
                v.append((math.cos(a) * rt, h, math.sin(a) * rt))
            f.append(tuple(range(2 * n - 1, n - 1, -1)))
            for i in range(n):
                j = (i + 1) % n
                f.append((i, n + i, n + j, j))
        self.emit(v, f, c, xform(x, y, z, rx, ry, rz, sx, 1, sz))

    def gable(self, c, w, h, d, x=0, y=0, z=0, ry=0, overhang=0.08):
        """Triangular roof: ridge along z, eaves at y."""
        hw, hd = w / 2 + overhang, d / 2 + overhang
        v = [(-hw, 0, -hd), (hw, 0, -hd), (0, h, -hd), (-hw, 0, hd), (hw, 0, hd), (0, h, hd)]
        f = [(0, 2, 1), (3, 4, 5), (0, 3, 5, 2), (1, 2, 5, 4), (0, 1, 4, 3)]
        self.emit(v, f, c, xform(x, y, z, 0, ry, 0))

    def ico(self, c, r, x=0, y=0, z=0, sx=1, sy=1, sz=1, sub=1, ry=0):
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=sub, radius=r)
        verts = [tuple(vv.co) for vv in tmp.verts]
        idx = {vv: i for i, vv in enumerate(tmp.verts)}
        faces = [tuple(idx[vv] for vv in fc.verts) for fc in tmp.faces]
        tmp.free()
        self.emit(verts, faces, c, xform(x, y, z, 0, ry, 0, sx, sy, sz))

    def octa(self, c, r, h, x=0, y=0, z=0, ry=0):
        """Crystal: square bipyramid, centre at y."""
        v = [(r, 0, 0), (0, 0, r), (-r, 0, 0), (0, 0, -r), (0, h, 0), (0, -h, 0)]
        f = [(0, 4, 1), (1, 4, 2), (2, 4, 3), (3, 4, 0), (1, 5, 0), (2, 5, 1), (3, 5, 2), (0, 5, 3)]
        self.emit(v, f, c, xform(x, y, z, 0, ry, 0))

    # ---- to Blender ----
    def to_object(self, mats, parent):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for vv in bm.verts:
            x, y, z = vv.co
            vv.co = Vector((x, -z, y))
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = False
        me.materials.append(mats['glow' if self.glow else 'toy'])
        ob = bpy.data.objects.new(self.name, me)
        o = self.origin
        ob.location = (o.x, -o.z, o.y)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        return ob


class Kit:
    """One asset under construction: B (body), G (glow) + named moving parts."""

    def __init__(self, name):
        self.name = name
        self.B = Part('body')
        self.G = Part('glow', glow=True)
        self.parts = []

    def part(self, name, origin=(0, 0, 0), glow=False):
        p = Part(name, origin, glow)
        self.parts.append(p)
        return p


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def materials():
    mats = {}
    for key, emissive in (('toy', False), ('glow', True)):
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Color'
        nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 1.0
        bsdf.inputs['Metallic'].default_value = 0.0
        if emissive:
            nt.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 1.0
        mats[key] = m
    return mats


def export_kit(kit, out_dir):
    reset_scene()
    mats = materials()
    root = bpy.data.objects.new('asset_root', None)
    bpy.context.scene.collection.objects.link(root)
    for p in [kit.B, kit.G] + kit.parts:
        if not p.empty():
            p.to_object(mats, root)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f'{kit.name}.glb')
    bpy.ops.object.select_all(action='SELECT')
    kwargs = dict(filepath=path, export_format='GLB', use_selection=True,
                  export_cameras=False, export_lights=False, export_apply=True,
                  export_yup=True)
    try:
        bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kwargs)
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)
    return path
