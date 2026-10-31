// Building mesh construction — the colony kit, drawn like a frontier firebase.
//
// Every structure is MERGED GEOMETRY: one vertex-colored body mesh, one
// always-lit glow mesh, one night-window mesh — about three draw calls per
// building no matter how much detail it carries. That budget is what buys the
// Starship-Troopers-base density: sloped bunker glacis, ribbed armor plate,
// pipe runs, intake vents, fuel tanks, sandbag lines, floodlights, comm
// arrays and hazard striping, on every colony ever generated.
//
// Only parts that MOVE (turret heads, rotors, flames, flags, cores) stay as
// separate meshes, wired into userData exactly as the renderer expects.
//
// Presentation only: nothing here touches simulation state. Variation is
// keyed off plot ids and tile coords — deterministic, so peers agree.
import * as THREE from 'three';
import { toyMat } from './toy-style.js';
import { assetClone, assetPart, hasKit, kitClone, kitGeometry, kitMaterials } from './assets.js';
import { culture, kitBuildingKey } from './cultures.js';
import { propGeometry, propRecord } from './prop-pack.js';
import { rampartPlace } from './rampart-art.js';
import { cloneTown } from './town-kit.js';

// Visual only. A one-storey door is about the hero's height, a house is a
// little over twice that, and towers and the keep stand well above both.
export function buildingVisualScale(kind) {
  if (kind === 'hq') return 3.15;
  if (kind === 'tower' || kind === 'outpost') return 3.85;
  if (typeof kind === 'string' && kind.startsWith('camp')) return 2.05;
  if (kind === 'wall') return 1.65;
  return 2.55;
}

// Drop a wide slab that sits under the whole footprint (the kit's hex plinth
// or foundation pad). The building's own walls stay. Geometry is cloned so
// the shared kit template is untouched.
function stripGroundPad(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const src = o.geometry;
    const pos = src.attributes.position;
    const index = src.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    const vert = (slot) => {
      const vi = index ? index.getX(slot) : slot;
      return [pos.getX(vi), pos.getY(vi), pos.getZ(vi), vi];
    };
    const keep = [];
    for (let t = 0; t < triCount; t++) {
      const a = vert(t * 3), b = vert(t * 3 + 1), c = vert(t * 3 + 2);
      const maxY = Math.max(a[1], b[1], c[1]);
      const reach = Math.max(Math.hypot(a[0], a[2]), Math.hypot(b[0], b[2]), Math.hypot(c[0], c[2]));
      if (maxY < 0.34 && reach > 0.9) continue;
      keep.push(t);
    }
    if (!keep.length || keep.length === triCount) return;
    const dst = new THREE.BufferGeometry();
    const used = new Map();
    const mapVert = (vi) => {
      if (used.has(vi)) return used.get(vi);
      const n = used.size;
      used.set(vi, n);
      return n;
    };
    const idx = [];
    for (const t of keep) {
      idx.push(mapVert(vert(t * 3)[3]), mapVert(vert(t * 3 + 1)[3]), mapVert(vert(t * 3 + 2)[3]));
    }
    for (const name of Object.keys(src.attributes)) {
      const attr = src.attributes[name];
      const item = attr.itemSize;
      const arr = new Float32Array(used.size * item);
      for (const [vi, ni] of used) {
        for (let k = 0; k < item; k++) arr[ni * item + k] = attr.getComponent(vi, k);
      }
      dst.setAttribute(name, new THREE.BufferAttribute(arr, item));
    }
    dst.setIndex(idx);
    o.geometry = dst;
  });
}

// The art-slice GLBs predate the detailed procedural kit and read flatter
// than it; the kit is now the primary look. Flip to true to restore the
// authored models where they exist (hq, default towers, camps, mine).
const USE_AUTHORED_BUILDINGS = false;

// The colony kit: one hull family + one trim so every structure on the
// planet reads as the same expedition's prefab, never a random block.
const HULL = 0xe6e0d0, HULL2 = 0xcfc9b8, HULL3 = 0xb5ae9c, PAD = 0x9c968a;
const TRIM = 0xe8843c, SOLAR = 0x31506b, GLOW = 0x5fd8c8;
const STEEL = 0x4a5058, DARK = 0x2e3136, GUN = 0x3d4246;
const WINDOW = 0xffca6e;

const _euler = new THREE.Euler();
const _mat = new THREE.Matrix4();
const _vec = new THREE.Vector3();
const _col = new THREE.Color();

const shade = (hex, f) => _col.setHex(hex).multiplyScalar(f).getHex();
const _mix = new THREE.Color();
const mix = (a, b, t) => _col.setHex(a).lerp(_mix.setHex(b), t).getHex();

// ---------------- the material atlas ----------------
// A generated painted-style atlas (assets/textures/colony-atlas.png, built by
// tools' gen_textures) multiplies under the vertex colors: panel seams,
// rivets, grime streaks, brushed steel, cracked concrete — and an edge-AO
// vignette on every tile, so every mapped face gets contact shadows at its
// corners. Near-neutral luminance keeps the whole palette intact.
const ATLAS_TILE = { plate: 0, steel: 1, concrete: 2, solar: 3 };
const STEEL_HEXES = new Set([0x4a5058, 0x2e3136, 0x3d4246, 0x2b2e33, 0x2f3338,
  0x565c60, 0x4a4440, 0x35363a, 0x1e1f21, 0x6b6152, 0x2f4a48, 0x9aa0a2, 0x4d5560]);
const CONCRETE_HEXES = new Set([0x9c968a, 0x8f897d, 0x8a8069, 0x6a655a, 0xaba593, 0x8a7a5e]);
function atlasTileFor(hex) {
  if (hex === 0x31506b) return ATLAS_TILE.solar;
  if (STEEL_HEXES.has(hex)) return ATLAS_TILE.steel;
  if (CONCRETE_HEXES.has(hex)) return ATLAS_TILE.concrete;
  // fallback by luminance: dark parts read as machined steel
  _col.setHex(hex);
  const lum = 0.2126 * _col.r + 0.7152 * _col.g + 0.0722 * _col.b;
  return lum < 0.14 ? ATLAS_TILE.steel : ATLAS_TILE.plate;
}

let _atlasTex = null;
export function colonyAtlas() {
  // Browser only — headless tooling keeps working without the texture.
  if (!_atlasTex && typeof document !== 'undefined') {
    _atlasTex = new THREE.TextureLoader().load('assets/textures/colony-atlas.png');
    _atlasTex.colorSpace = THREE.SRGBColorSpace;
    _atlasTex.anisotropy = 4;
  }
  return _atlasTex;
}

// ---------------- merged-geometry builder ----------------

function merger() {
  const pos = [], nrm = [], col = [], uvs = [];
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    // YXZ: pitch/roll first, THEN yaw — so a part tilted toward its face
    // (vents, floodlights, pipes) can be aimed with ry afterwards.
    _mat.makeRotationFromEuler(_euler.set(rx, ry, rz, 'YXZ'));
    _mat.scale(_vec.set(sx, sy, sz));
    _mat.setPosition(x, y, z);
    g.applyMatrix4(_mat);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    const tile = atlasTileFor(hex);
    const tu = (tile % 4) * 0.25, tv = 0.75 - ((tile / 4) | 0) * 0.25;
    _col.setHex(hex);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(_col.r, _col.g, _col.b);
      const uu = u ? Math.min(1, Math.max(0, u.getX(i))) : 0.5;
      const vv = u ? Math.min(1, Math.max(0, u.getY(i))) : 0.5;
      uvs.push(tu + uu * 0.25, tv + vv * 0.25);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  };
  // A toy-kit GLB part merged with its OWN vertex colours (linear, from the
  // Blender kit). The shared kit geometry is cloned, never disposed.
  const kit = (geo, x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, tint = 1) => {
    const src = geo.index ? geo.toNonIndexed() : geo.clone();
    _mat.makeRotationFromEuler(_euler.set(0, ry, 0, 'YXZ'));
    _mat.scale(_vec.set(sx, sy, sz));
    _mat.setPosition(x, y, z);
    src.applyMatrix4(_mat);
    const p = src.getAttribute('position');
    const n = src.getAttribute('normal');
    const c = src.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      if (c) col.push(c.getX(i) * tint, c.getY(i) * tint, c.getZ(i) * tint);
      else col.push(tint, tint, tint);
      uvs.push(0.125, 0.875);
    }
    src.dispose();
  };
  const api = {
    kit,
    box: (hex, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
      add(new THREE.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz),
    cyl: (hex, r1, r2, h, x = 0, y = 0, z = 0, seg = 10, rx = 0, ry = 0, rz = 0) =>
      add(new THREE.CylinderGeometry(r1, r2, h, seg), hex, x, y, z, rx, ry, rz),
    cone: (hex, r, h, x = 0, y = 0, z = 0, seg = 8, rx = 0, ry = 0, rz = 0) =>
      add(new THREE.ConeGeometry(r, h, seg), hex, x, y, z, rx, ry, rz),
    ell: (hex, r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ws = 10, hs = 7) =>
      add(new THREE.SphereGeometry(r, ws, hs), hex, x, y, z, 0, 0, 0, sx, sy, sz),
    cap: (hex, r, len, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
      add(new THREE.CapsuleGeometry(r, len, 3, 9), hex, x, y, z, rx, ry, rz),
    // Battered bunker block: a square frustum (taper k = top/bottom width),
    // scaled to (w × h × d). THE core primitive of the firebase look.
    frustum: (hex, w, d, h, k, x = 0, y = 0, z = 0, ry = 0) => {
      const geo = new THREE.CylinderGeometry(Math.SQRT1_2 * k, Math.SQRT1_2, 1, 4, 1);
      geo.rotateY(Math.PI / 4);
      add(geo, hex, x, y, z, 0, ry, 0, w, h, d);
    },
    build: (material, bakeAO = false) => {
      if (bakeAO && pos.length) {
        // The Dota value-structure trick, baked per building: dark at the
        // footing, bright at the crown, with a whisper of positional grime so
        // large faces never read as one flat fill.
        let maxY = 0.001;
        for (let i = 1; i < pos.length; i += 3) maxY = Math.max(maxY, pos[i]);
        for (let i = 0; i < pos.length; i += 3) {
          const t = Math.min(1, Math.max(0, pos[i + 1] / maxY));
          const ramp = 0.78 + 0.3 * Math.pow(t, 0.7);
          const gr = Math.sin(pos[i] * 12.9898 + pos[i + 2] * 78.233 + pos[i + 1] * 37.719);
          const f = Math.min(1.06, ramp) * (1 + gr * 0.035);
          const o = i;
          col[o] *= f; col[o + 1] *= f; col[o + 2] *= f;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const mesh = new THREE.Mesh(g, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    },
    empty: () => pos.length === 0,
  };
  return api;
}

// ---------------- the firebase detail kit ----------------
// Small assemblies stamped onto any structure. B = body merger, G = glow
// merger. Everything is deterministic — no RNG anywhere in this module.

// Ribbed armor: n buttress plates along a run (local +x), leaning into the wall.
function ribs(B, hex, n, x0, x1, y, z, h, ry = 0) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const rx0 = x0 + (x1 - x0) * t;
    const px = Math.cos(ry) * rx0 + Math.sin(ry) * z;
    const pz = -Math.sin(ry) * rx0 + Math.cos(ry) * z;
    B.frustum(hex, 0.1, 0.16, h, 0.55, px, y + h / 2, pz, ry);
  }
}

// Recessed intake vent with slats.
function vent(B, x, y, z, w = 0.34, h = 0.22, ry = 0) {
  B.box(DARK, w, h, 0.05, x, y, z, 0, ry, 0);
  for (let i = 0; i < 3; i++) {
    B.box(STEEL, w - 0.06, 0.028, 0.06, x, y - h / 2 + (h / 4) * (i + 1), z, 0.5, ry, 0);
  }
}

// Pipe run: elbowed conduit along given local points [[x,y,z],...].
function pipes(B, hex, pts, r = 0.045) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.acos(Math.max(-1, Math.min(1, dy / (len || 1))));
    B.cyl(hex, r, r, len, mx, my, mz, 7, pitch, yaw, 0);
    B.ell(hex, r * 1.25, ax, ay, az, 1, 1, 1, 7, 5);
  }
  const last = pts[pts.length - 1];
  B.ell(hex, r * 1.25, last[0], last[1], last[2], 1, 1, 1, 7, 5);
}

// Fuel/coolant tank cluster with hazard band.
function tanks(B, x, z, n = 2, r = 0.16, h = 0.55) {
  for (let i = 0; i < n; i++) {
    const tx = x + (i - (n - 1) / 2) * (r * 2.3);
    B.cap(HULL2, r, h, tx, h / 2 + r * 0.6, z);
    B.box(TRIM, r * 2.1, 0.05, r * 2.1, tx, h * 0.72, z);
    B.cyl(STEEL, 0.03, 0.03, 0.16, tx, h + r * 1.35, z, 6);
  }
  B.box(PAD, n * r * 2.4 + 0.1, 0.07, r * 2.6, x, 0.035, z);
}

// Floodlight on a mast — the firebase perimeter light.
function floodlight(B, G, x, z, h = 1.6, ry = 0) {
  B.cyl(STEEL, 0.035, 0.05, h, x, h / 2, z, 6);
  B.box(STEEL, 0.06, 0.06, 0.22, x, h, z + 0.08, 0.5, ry, 0);
  B.box(DARK, 0.22, 0.14, 0.1, x, h + 0.06, z + 0.2, 0.35, ry, 0);
  G.box(0xfff2c8, 0.18, 0.1, 0.02, x, h + 0.045, z + 0.26, 0.35, ry, 0);
}

// Sandbag revetment: two stacked runs of bags along local +x, rotated ry.
function sandbags(B, cx, cz, len, ry, layers = 2) {
  const n = Math.max(2, Math.round(len / 0.24));
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < n - (l % 2); i++) {
      const t = (i + 0.5 + (l % 2) * 0.5) / n - 0.5;
      const px = cx + Math.cos(ry) * t * len;
      const pz = cz - Math.sin(ry) * t * len;
      B.cap(0x8a8069, 0.075, 0.1, px, 0.07 + l * 0.11, pz, Math.PI / 2, ry + Math.PI / 2, 0);
    }
  }
}

// Comms mast with crossbars, dish and a blinker.
function commsMast(B, G, x, z, h = 3.2, withDish = true) {
  B.cyl(STEEL, 0.03, 0.06, h, x, h / 2, z, 6);
  for (let i = 1; i <= 3; i++) {
    B.box(STEEL, 0.34 - i * 0.07, 0.025, 0.025, x, h * (0.55 + i * 0.13), z);
  }
  if (withDish) {
    B.cyl(0xd8d2c2, 0.22, 0.05, 0.1, x + 0.12, h * 0.72, z, 10, -0.7, 0, -0.3);
    B.cyl(STEEL, 0.012, 0.012, 0.2, x + 0.18, h * 0.75, z, 5, -0.7, 0, -0.3);
  }
  G.box(TRIM, 0.05, 0.05, 0.05, x, h + 0.04, z);
}

// Hazard chevron strip: alternating trim/dark blocks along local +x.
function hazard(B, x, y, z, len, ry = 0, w = 0.1) {
  const n = Math.max(3, Math.round(len / 0.22));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const px = x + Math.cos(ry) * t * len;
    const pz = z - Math.sin(ry) * t * len;
    B.box(i % 2 ? DARK : TRIM, len / n - 0.02, 0.05, w, px, y, pz, 0, ry, 0);
  }
}

// Landing-pad ring light segments.
function padLights(G, x, z, r, n, y = 0.06, hex = TRIM) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    G.box(hex, 0.16, 0.03, 0.07, x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, -a, 0);
  }
}

// Stairs up a plinth face.
function stairs(B, x, z, w, steps, rise, ry = 0) {
  for (let i = 0; i < steps; i++) {
    const d = 0.16;
    const px = x + Math.sin(ry) * (i * d);
    const pz = z + Math.cos(ry) * (i * d);
    B.box(PAD, w, rise * (steps - i), d, px, (rise * (steps - i)) / 2, pz, 0, ry, 0);
  }
}

// ---------------- the buildings ----------------

export function groundSkirt(b) {
  const r = Math.max(1.15, (b.size || 1.5) * 0.72);
  const geo = new THREE.CircleGeometry(r, 18);
  geo.rotateX(-Math.PI / 2);
  const skirt = new THREE.Mesh(geo, toyMat({ color: 0x1d2a3a, transparent: true, opacity: 0.16, depthWrite: false,
  }));
  skirt.position.y = 0.03;
  skirt.receiveShadow = true;
  skirt.userData.skirt = true; // keeps its own opacity (see main _syncBuildings)
  skirt.userData.noOutline = true;
  return skirt;
}

function authoredBuildingMesh(b) {
  if (!USE_AUTHORED_BUILDINGS) return null;
  const tier = Math.max(1, Math.min(3, Number(b.plotTier) || 1));
  let key = null;
  if (b.kind === 'hq') key = `humanHqT${tier}`;
  else if (b.kind === 'tower' && !b.branch) key = `humanTowerT${tier}`;
  else if (b.kind.startsWith('camp_')) key = `humanBarracksT${tier}`;
  else if (b.kind === 'mine') key = 'humanMine';
  if (!key) return null;
  const model = assetClone(key);
  if (!model) return null;
  const g = new THREE.Group();
  g.add(model);
  g.userData.authored = true;
  g.userData.head = assetPart(model, 'part_turret');
  g.userData.rotor = assetPart(model, 'part_rotor');
  g.userData.core = assetPart(model, 'part_core');
  return g;
}

// The toy kit (tools/art/toy_kit): one Blender-authored, vertex-coloured
// model per building kind and tier for the active culture. Each building gets
// its OWN copy of the two kit materials (damage soot and construction fade are
// per building); geometry is shared with the template.
function kitBuildingMesh(b) {
  if (b.kind === 'wall') return null;
  const key = kitBuildingKey(b.kind, b.plotTier);
  if (!key || !hasKit(key)) return null;
  const model = kitClone(key);
  if (!model) return null;
  const shared = kitMaterials();
  const body = shared.body.clone(), glow = shared.glow.clone();
  model.traverse((o) => { if (o.isMesh) o.material = o.material === shared.glow ? glow : body; });
  stripGroundPad(model);
  const g = new THREE.Group();
  g.add(model);
  g.userData.kit = key;
  g.userData.head = assetPart(model, 'part_turret');
  g.userData.rotor = assetPart(model, 'part_rotor');
  g.userData.core = assetPart(model, 'part_core');
  return g;
}

// ---------------- the toy-kit rampart ----------------
// Walls are drawn from the Blender kit (tools/art/toy_kit/walls.py): curtain
// runs scaled from each pier toward its neighbours (so the line follows the
// tile chain the terrain-adapted plan laid down), joint posts only at ends,
// junctions and every few tiles, and ONE gatehouse per gate, centred on the
// plot's principal gate tile and aligned with the local wall run. The other
// arch tiles draw nothing: they are the gatehouse's open passage.
function kitWall(b, ctx, tier, K, KG) {
  const t = Math.min(3, Math.max(1, tier | 0));
  const seg = kitGeometry(`wall_t${t}_seg`, 'body');
  const post = kitGeometry(`wall_t${t}_post`, 'body');
  const gate = kitGeometry(`gate_t${t}`, 'body');
  if (!seg || !post || !gate) return false;
  const glowOf = (name) => kitGeometry(name, 'glow');
  const N = ctx.mapSize || 0;
  const wallTiles = ctx.wallTiles || new Set();
  const has = (x, z) => wallTiles.has(z * N + x);
  const arch = ctx.archTiles || new Set();
  const isArch = (x, z) => arch.has(z * N + x);
  const shock = b.branch === 'shock', bastion = b.branch === 'bastion';
  const sy = bastion ? 1.85 : 1.7, sz = bastion ? 1.7 : 1.45;
  const tint = 1 + (((b.x * 7 + b.z * 13) % 5) - 2) * 0.025;
  const [cx, cz] = ctx.center || [N / 2, N / 2];
  const ox = b.x + 0.5 - cx, oz = b.z + 0.5 - cz;
  // local +z (the merlon/outside face) after a yaw of ry points at
  // (sin ry, cos ry); flip by pi when it faces the keep.
  const faceOut = (ry) => (Math.sin(ry) * ox + Math.cos(ry) * oz < 0 ? ry + Math.PI : ry);
  if (b.gate) {
    if (!(ctx.gateMain && ctx.gateMain.has(b.z * N + b.x))) return true;
    // the local run: principal axis of the wall chain within 3 tiles
    let sxx = 0, szz = 0, sxz = 0, n = 0;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      if (!has(b.x + dx, b.z + dz)) continue;
      sxx += dx * dx; szz += dz * dz; sxz += dx * dz; n++;
    }
    const th = n > 1 ? 0.5 * Math.atan2(2 * sxz, sxx - szz) : 0;
    const ry = faceOut(-th);
    K.kit(gate.geometry, 0, 0, 0, ry, 1, sy, 1, tint);
    const gg = glowOf(`gate_t${t}`);
    if (gg) KG.kit(gg.geometry, 0, 0, 0, ry, 1, sy, 1);
    return true;
  }
  const nbs = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (has(b.x + dx, b.z + dz)) nbs.push([dx, dz]);
  let scx = 0, scz = 0;
  for (const [dx, dz] of nbs) { scx += dx * 0.26; scz += dz * 0.26; }
  const sg = glowOf(`wall_t${t}_seg`);
  for (const [dx, dz] of nbs) {
    const ex = dx * 0.5, ez = dz * 0.5;
    const vx = ex - scx, vz = ez - scz;
    const len = Math.hypot(vx, vz) + 0.05;
    const yaw = Math.atan2(vz, vx);
    let ry = -yaw, px = scx, pz = scz;
    if (Math.sin(ry) * ox + Math.cos(ry) * oz < 0) { ry += Math.PI; px = ex + (vx / (len || 1)) * 0.05; pz = ez + (vz / (len || 1)) * 0.05; }
    K.kit(seg.geometry, px, 0, pz, ry, len, sy, sz, tint);
    if (sg) KG.kit(sg.geometry, px, 0, pz, ry, len, sy, sz);
    if (shock) {
      for (const side of [-1, 1]) {
        const nx = Math.sin(yaw) * side * 0.3, nz = -Math.cos(yaw) * side * 0.3;
        KG.box(0x6ff6ff, len * 0.92, 0.05, 0.03, (scx + ex) / 2 + nx, 0.78 * sy, (scz + ez) / 2 + nz, 0, -yaw, 0);
      }
    }
  }
  const nearArch = nbs.some(([dx, dz]) => isArch(b.x + dx, b.z + dz));
  const straight = nbs.length === 2 && nbs[0][0] === -nbs[1][0] && nbs[0][1] === -nbs[1][1];
  const joint = nbs.length !== 2 || (((b.x * 3 + b.z * 5) % 4 + 4) % 4 === 0 && !(straight && ((b.x + b.z) & 1)));
  if (!nbs.length || (joint && !nearArch)) {
    const run = nbs.length === 2 ? Math.atan2(nbs[0][1] - nbs[1][1], nbs[0][0] - nbs[1][0])
      : nbs.length ? Math.atan2(nbs[0][1], nbs[0][0]) : 0;
    const ry = faceOut(-run);
    K.kit(post.geometry, scx, 0, scz, ry, bastion ? 1.15 : 1, sy, bastion ? 1.15 : 1, tint);
    const pg = glowOf(`wall_t${t}_post`);
    if (pg) KG.kit(pg.geometry, scx, 0, scz, ry, 1, sy, 1);
    if (shock) KG.box(0x6ff6ff, 0.16, 0.16, 0.16, scx, 1.9 * sy, scz);
  }
  return true;
}

// Kenney castle pieces, merged into one vertex-coloured mesh and tinted with
// the culture palette. Plot positions stay with the caller. Missing pieces
// fall through to the colony kit.
function appendPack(buckets, geo, hex, x, y, z, ry, sx, sy, sz) {
  const src = geo.index ? geo.toNonIndexed() : geo.clone();
  _mat.makeRotationFromEuler(_euler.set(0, ry, 0, 'YXZ'));
  _mat.scale(_vec.set(sx, sy, sz));
  _mat.setPosition(x, y, z);
  src.applyMatrix4(_mat);
  const p = src.attributes.position;
  const n = src.attributes.normal;
  _col.setHex(hex);
  for (let i = 0; i < p.count; i++) {
    buckets.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    if (n) buckets.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    else buckets.nrm.push(0, 1, 0);
    buckets.col.push(_col.r, _col.g, _col.b);
  }
  src.dispose();
}

function putPack(buckets, name, hex, x, y, z, w, h, d, ry = 0) {
  const geo = propGeometry(name);
  const rec = propRecord(name);
  if (!geo || !rec || h <= 0) return 0;
  appendPack(buckets, geo, hex, x, y, z, ry, w / rec.span, h / rec.height, d / rec.span);
  return h;
}

function packPiece(group, name, mat, x, y, z, w, h, d, ry = 0) {
  const geo = propGeometry(name);
  const rec = propRecord(name);
  if (!geo || !rec || h <= 0 || w <= 0) return 0;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.scale.set(w / rec.span, h / rec.height, d / rec.span);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return h;
}

function packBox(group, mat, x, y, z, w, h, d, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function packMesh(buckets) {
  if (!buckets.pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buckets.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buckets.nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(buckets.col, 3));
  const mesh = new THREE.Mesh(geo, toyMat({ color: 0xffffff, vertexColors: true, flatShading: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.pack = true;
  return g;
}

// The keep is several castle-kit masses plus a door, windows, trim and a
// crown, so it is not one tinted cube. Local units, before visual scale.
function packKeep(pal, key, tier) {
  const kit = cloneTown(`${key}-keep`);
  if (kit) return kit;
  const authored = rampartPlace(`${key}-keep`);
  if (authored) return authored;
  const g = new THREE.Group();
  g.userData.pack = true;
  const stone = toyMat({ color: pal.stone, flatShading: true });
  const stone2 = toyMat({ color: pal.stone2, flatShading: true });
  const stone3 = toyMat({ color: pal.stone3, flatShading: true });
  const roof = toyMat({ color: pal.roof, flatShading: true });
  const wood = toyMat({ color: pal.wood, flatShading: true });
  const dark = toyMat({ color: pal.dark, flatShading: true });
  const trim = toyMat({ color: pal.trim, flatShading: true });
  const banner = toyMat({ color: pal.banner, flatShading: true });
  const warm = toyMat({ color: pal.warm, emissive: pal.warm, emissiveIntensity: 0.55, flatShading: true });
  const s = 1.05;
  let y = 0;
  y += packPiece(g, 'tower-square-base', stone3, 0, 0, 0, s * 1.45, 0.26, s * 1.28);
  const ground = key === 'middle_eastern' ? 0.86 : 0.74;
  y += packPiece(g, 'tower-square-mid-windows', stone, 0, y, 0, s * 1.12, ground, s);
  const doorY = 0.26 + ground * 0.42;
  const face = s * 0.52;
  packBox(g, dark, 0, doorY, face, 0.32, 0.48, 0.08);
  packBox(g, wood, 0, doorY, face + 0.03, 0.24, 0.4, 0.05);
  const windowAt = (x, wy, z, thin) => {
    packBox(g, dark, x, wy, z, thin ? 0.08 : 0.2, 0.22, thin ? 0.2 : 0.08);
    packBox(g, warm, x, wy, z + (thin ? 0 : 0.03), thin ? 0.04 : 0.13, 0.14, thin ? 0.13 : 0.04);
  };
  windowAt(-0.38, doorY + 0.06, face, false);
  windowAt(0.38, doorY + 0.06, face, false);
  windowAt(s * 0.58, doorY, 0.2, true);
  windowAt(-s * 0.58, doorY, -0.15, true);
  if (key === 'south_american') {
    y += packPiece(g, 'tower-square-base', stone2, 0, y, 0, s * 0.92, 0.42, s * 0.82);
    y += packPiece(g, 'tower-square-mid-windows', stone, 0, y, 0, s * 0.7, 0.48, s * 0.62);
    packPiece(g, 'stairs-stone', stone2, 0, 0.02, s * 0.85, 0.7, 0.42, 0.48);
  } else if (key === 'middle_eastern') {
    y += packPiece(g, 'tower-square', stone2, 0, y, 0, s * 0.72, 0.7, s * 0.72);
    windowAt(-0.22, y - 0.28, s * 0.38, false);
    windowAt(0.22, y - 0.28, s * 0.38, false);
  } else {
    y += packPiece(g, 'tower-square-mid-windows', stone2, 0, y, 0, s * 0.82, 0.58 + tier * 0.04, s * 0.74);
    windowAt(-0.22, y - 0.28, s * 0.4, false);
    windowAt(0.22, y - 0.28, s * 0.4, false);
  }
  packBox(g, trim, 0, y, 0, s * (key === 'asian' ? 1.45 : 1.2), 0.07, s * (key === 'asian' ? 1.28 : 1.08));
  if (key === 'asian') packPiece(g, 'wall-narrow-wood', wood, 0, y - 0.02, 0, s * 1.55, 0.16, s * 1.35);
  const roofName = key === 'middle_eastern' ? 'tower-hexagon-roof' : 'tower-square-top-roof';
  const roofH = key === 'middle_eastern' ? 0.78 : key === 'south_american' ? 0.36 : 0.52;
  y += packPiece(g, roofName, roof, 0, y, 0, s * (key === 'asian' ? 1.35 : 1.12), roofH, s * (key === 'asian' ? 1.22 : 1.02));
  if (key === 'european') {
    packPiece(g, 'tower-square', stone3, s * 0.32, y - 0.08, s * 0.16, 0.22, 0.62, 0.22);
    packBox(g, dark, s * 0.32, y + 0.28, s * 0.16, 0.1, 0.12, 0.1);
  } else if (key === 'asian') {
    const lantern = packBox(g, warm, 0, y + 0.15, 0, 0.16, 0.2, 0.16);
    lantern.castShadow = false;
    packPiece(g, 'tower-square-top-roof', roof, 0, y + 0.22, 0, 0.28, 0.16, 0.28);
  } else if (key === 'south_american') {
    packBox(g, trim, 0, y + 0.08, 0, 0.28, 0.1, 0.28);
    packBox(g, warm, 0, y + 0.2, 0, 0.12, 0.16, 0.12);
  } else {
    packPiece(g, 'tower-square', stone2, s * 0.55, 0.3, -s * 0.15, 0.28, 1.35, 0.28);
    packPiece(g, 'tower-hexagon-roof', roof, s * 0.55, 1.65, -s * 0.15, 0.34, 0.42, 0.34);
    packBox(g, trim, 0, y + 0.02, 0, 0.08, 0.28, 0.08);
  }
  const flagL = packPiece(g, 'flag-banner-short', banner, -s * 0.78, 0.85, face * 0.2, 0.2, 0.85, 0.2, Math.PI / 2);
  const flag = g.children[g.children.length - 1];
  if (flagL) g.userData.flag = flag;
  packPiece(g, 'flag-banner-short', key === 'european' ? pal.accent : banner, s * 0.78, 0.85, face * 0.2, 0.2, 0.85, 0.2, -Math.PI / 2);
  return g;
}

function packHouse(pal, key, tier) {
  const kit = cloneTown(`${key}-house`);
  if (kit) return kit;
  const authored = rampartPlace(`${key}-house`);
  if (authored) return authored;
  const g = new THREE.Group();
  g.userData.pack = true;
  const stone = toyMat({ color: pal.stone, flatShading: true });
  const stone2 = toyMat({ color: pal.stone2, flatShading: true });
  const roof = toyMat({ color: pal.roof, flatShading: true });
  const wood = toyMat({ color: pal.wood, flatShading: true });
  const dark = toyMat({ color: pal.dark, flatShading: true });
  const warm = toyMat({ color: pal.warm, emissive: pal.warm, emissiveIntensity: 0.4, flatShading: true });
  const trim = toyMat({ color: pal.trim, flatShading: true });
  const s = 0.92;
  let y = 0;
  y += packPiece(g, 'tower-square-base', stone2, 0, 0, 0, s * 1.15, 0.18, s);
  y += packPiece(g, 'tower-square-mid-windows', stone, 0, y, 0, s, 0.78, s * 0.88);
  const face = s * 0.46;
  packBox(g, dark, 0, 0.42, face, 0.22, 0.36, 0.06);
  packBox(g, wood, 0, 0.42, face + 0.025, 0.16, 0.3, 0.04);
  packBox(g, dark, -0.28, 0.55, face, 0.14, 0.16, 0.05);
  packBox(g, warm, -0.28, 0.55, face + 0.02, 0.09, 0.1, 0.03);
  packBox(g, dark, 0.28, 0.55, face, 0.14, 0.16, 0.05);
  packBox(g, warm, 0.28, 0.55, face + 0.02, 0.09, 0.1, 0.03);
  if (key === 'asian') packPiece(g, 'wall-narrow-wood', wood, 0, y, 0, s * 1.35, 0.12, s * 1.2);
  if (key === 'south_american') packPiece(g, 'stairs-stone', stone2, 0, 0, face + 0.15, 0.45, 0.28, 0.32);
  packBox(g, trim, 0, y, 0, s * (key === 'asian' ? 1.28 : 1.08), 0.05, s * 0.98);
  const roofName = key === 'middle_eastern' ? 'tower-hexagon-roof' : 'tower-square-top-roof';
  packPiece(g, roofName, roof, 0, y, 0, s * (key === 'asian' ? 1.3 : 1.08), key === 'middle_eastern' ? 0.55 : 0.42, s * 1.02);
  if (tier >= 2) packPiece(g, 'log', wood, s * 0.35, 0.02, s * 0.15, 0.32, 0.16, 0.18);
  return g;
}

function packBuildingMesh(b, ctx = {}) {
  // Ramparts are one continuous mesh in rampart-art.js, not a block per tile.
  if (b.kind === 'wall') return new THREE.Group();
  if (!propRecord('tower-square-base') || !propRecord('wall')) return null;
  const c = culture();
  const pal = c.palette;
  const key = c.key;
  const buckets = { pos: [], nrm: [], col: [] };
  const tier = Math.max(1, b.plotTier || 1);
  const roofName = key === 'middle_eastern' ? 'tower-hexagon-roof' : 'tower-square-top-roof';
  if (b.kind === 'hq') return packKeep(pal, key, tier);
  if (b.kind === 'house') return packHouse(pal, key, tier);
  if (b.kind === 'tower' || b.kind === 'outpost') {
    const authored = rampartPlace(`${key}-spire`);
    if (authored) return authored;
    const s = b.kind === 'outpost' ? 0.78 : 0.66;
    let y = 0;
    y += putPack(buckets, 'tower-square-base', pal.stone, 0, 0, 0, s, 0.5, s);
    const levels = Math.min(3, tier) + 1;
    for (let i = 0; i < levels; i++) {
      const shrink = 1 - i * 0.08;
      y += putPack(buckets, 'tower-square-mid-windows', i % 2 ? pal.stone2 : pal.stone, 0, y, 0, s * 0.9 * shrink, 0.42, s * 0.9 * shrink);
    }
    y += putPack(buckets, 'tower-square', pal.stone3, 0, y, 0, s * 0.42, 0.55, s * 0.42);
    y += putPack(buckets, roofName, pal.roof, 0, y, 0, key === 'asian' ? s * 1.15 : s * 0.7, key === 'middle_eastern' ? 0.48 : 0.36, s * 0.7);
    putPack(buckets, 'flag-banner-short', pal.banner, s * 0.72, y * 0.4, 0, 0.16, 0.5, 0.16, Math.PI / 2);
    return packMesh(buckets);
  }
  const camp = typeof b.kind === 'string' && b.kind.startsWith('camp');
  const wide = camp || b.kind === 'farm' ? 1.2 : b.kind === 'mine' ? 1.05 : 0.98;
  const deep = wide * 0.84;
  let y = 0;
  y += putPack(buckets, 'tower-square-base', pal.stone, 0, 0, 0, wide, b.kind === 'mine' ? 0.48 : 0.8, deep);
  if (b.kind === 'mine') putPack(buckets, 'cliff_block_stone', pal.stone3, 0.5, 0, 0.1, 0.7, 0.95, 0.55);
  if (b.kind === 'farm' || camp) {
    putPack(buckets, 'fence_simple', pal.wood, 0, 0, deep * 0.7, wide * 1.25, 0.55, 0.12);
    putPack(buckets, 'log_stack', pal.wood, -wide * 0.32, 0, -0.05, 0.5, 0.42, 0.36);
  }
  if (b.kind === 'mill') putPack(buckets, 'tower-square', pal.stone2, 0.32, y, 0, 0.32, 0.75, 0.32);
  if (b.kind === 'workshop' || b.kind === 'hero_forge') {
    putPack(buckets, 'wall-corner', pal.stone2, 0, 0, 0, wide * 0.72, 0.4, deep * 0.72);
  }
  if (key === 'south_american') putPack(buckets, 'stairs-stone', pal.stone2, 0, 0, deep * 0.7, 0.6, 0.4, 0.4);
  if (key === 'asian') putPack(buckets, 'wall-narrow-wood', pal.wood, 0, y - 0.02, 0, wide * 1.3, 0.14, deep * 1.35);
  putPack(buckets, roofName, pal.roof, 0, y, 0, key === 'asian' ? wide * 1.25 : wide * 1.08, key === 'middle_eastern' ? 0.6 : 0.46, key === 'asian' ? deep * 1.3 : deep * 1.12);
  putPack(buckets, 'flag-banner-short', b.kind === 'hero_forge' ? pal.glow : pal.banner, wide * 0.55, y * 0.45, 0, 0.16, 0.55, 0.16, Math.PI / 2);
  if (tier >= 2 && b.kind === 'house') putPack(buckets, 'log', pal.wood, wide * 0.28, 0, deep * 0.15, 0.4, 0.22, 0.22);
  return packMesh(buckets);
}

export function buildBuildingMesh(b, ctx = {}) {
  const packed = packBuildingMesh(b, ctx);
  if (packed) return packed;
  const authored = authoredBuildingMesh(b) || kitBuildingMesh(b);
  if (authored) return authored;

  const g = new THREE.Group();
  const B = merger();          // hull, steel, concrete — Lambert, shadowed
  const G = merger();          // marker lights, lenses — always lit
  const W = merger();          // habitation glass — glows at night
  const K = merger();          // toy-kit pieces with their own vertex colours
  const KG = merger();         // toy-kit glow parts
  const M = (color, e = 0) => toyMat({ color, emissive: e ? color : 0x000000, emissiveIntensity: e });
  // Separate-mesh helpers for ANIMATED parts only.
  const liveBox = (w, h, dep, color, x = 0, y = 0, z = 0, e = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), M(color, e));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const windows = (n, y, r, a0 = 0.4) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + a0;
      W.box(WINDOW, 0.16, 0.2, 0.03, Math.cos(a) * r, y, Math.sin(a) * r, 0, -a - Math.PI / 2, 0);
    }
  };
  const tier = b.plotTier || 1;
  const vid = b.plotId || b.id || 0;

  switch (b.kind) {
    case 'hq': {
      // COLONY COMMAND: a terraced firebase. Octagonal landing terrace with
      // ring lights and hazard rim, sloped bunker tiers with ribbed glacis,
      // an ops hall with a glass band, tank farm, pipe runs, floodlit
      // corners, twin comm dishes and the beacon spire over everything.
      B.cyl(PAD, 3.35, 3.55, 0.42, 0, 0.21, 0, 8);
      B.cyl(shade(PAD, 0.88), 3.6, 3.7, 0.14, 0, 0.07, 0, 8);
      padLights(G, 0, 0, 3.1, 8, 0.47);
      hazard(B, 0, 0.45, 2.9, 2.4, 0);
      hazard(B, 0, 0.45, -2.9, 2.4, 0);
      stairs(B, 0, 3.45, 1.6, 3, 0.14, 0);
      // Terraced bunker: two battered tiers with rib armor.
      B.frustum(HULL, 4.4, 4.4, 1.0, 0.82, 0, 0.92, 0);
      ribs(B, HULL2, 5, -1.8, 1.8, 0.42, 2.05, 1.0);
      ribs(B, HULL2, 5, -1.8, 1.8, 0.42, -2.05, 1.0);
      B.frustum(HULL2, 3.6, 3.6, 0.24, 0.96, 0, 1.52, 0);
      G.box(TRIM, 3.62, 0.05, 3.62, 0, 1.44, 0);            // terrace edge light
      B.frustum(HULL, 3.0, 3.0, 1.5, 0.88, 0, 2.4, 0);      // ops hall
      G.box(GLOW, 2.86, 0.13, 2.86, 0, 2.5, 0);             // ops glass band
      B.box(HULL2, 3.2, 0.22, 3.2, 0, 3.25, 0);             // hall cornice
      vent(B, 1.2, 1.9, 1.44); vent(B, -1.2, 1.9, 1.44);
      vent(B, 1.2, 1.9, -1.44, 0.34, 0.22, Math.PI); vent(B, -1.2, 1.9, -1.44, 0.34, 0.22, Math.PI);
      // Tank farm + pipes into the hall.
      tanks(B, -1.7, 1.95, 3, 0.14, 0.5);
      pipes(B, STEEL, [[-1.7, 0.55, 1.7], [-1.7, 0.55, 1.2], [-1.35, 1.6, 0.9], [-1.2, 1.6, 0.5]]);
      pipes(B, shade(STEEL, 0.8), [[1.6, 0.5, 1.8], [1.6, 0.5, 1.3], [1.3, 1.5, 1.0]], 0.035);
      // Corner pylons: floodlights + sensor cans, one per built tier.
      const corners = [[1.6, 1.6], [-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6]];
      for (let i = 0; i < Math.min(4, 1 + tier); i++) {
        const [px, pz] = corners[i];
        B.cyl(HULL2, 0.22, 0.3, 2.2, px, 1.6, pz, 8);
        B.cyl(STEEL, 0.26, 0.26, 0.1, px, 2.75, pz, 8);
        G.box(TRIM, 0.18, 0.18, 0.18, px, 2.9, pz);
        floodlight(B, G, px * 1.35, pz * 1.35, 1.5, Math.atan2(-px, -pz));
      }
      // The spire: taller with every tier, ringed, crowned with comms.
      const spireH = 2.4 + tier * 0.5;
      B.cyl(HULL, 0.55, 0.78, spireH, 0, 3.25 + spireH / 2, 0, 10);
      for (let i = 0; i < 4; i++) {                              // shaft ribs
        const a = i * Math.PI / 2 + Math.PI / 4;
        B.frustum(HULL2, 0.1, 0.16, spireH * 0.55, 0.55, Math.cos(a) * 0.66, 3.3 + spireH * 0.28, Math.sin(a) * 0.66, -a);
      }
      G.box(GLOW, 1.35, 0.1, 1.35, 0, 3.25 + spireH * 0.6, 0); // control ring
      B.cyl(HULL2, 0.85, 0.6, 0.28, 0, 3.4 + spireH, 0, 10);   // crown deck
      B.cyl(0xd8d2c2, 0.5, 0.07, 0.26, 0.42, 3.75 + spireH, 0.3, 10, -0.7, 0, -0.35);
      B.cyl(0xd8d2c2, 0.34, 0.05, 0.2, -0.4, 3.7 + spireH, -0.25, 10, -0.6, 0, 2.6);
      commsMast(B, G, -0.15, 0.1, spireH + 4.6, false);
      const beacon = liveBox(0.2, 0.2, 0.2, tier >= 4 ? 0xf3c53d : TRIM, 0, 4.9 + spireH, 0, 1.0);
      beacon.castShadow = false;
      const flag = liveBox(0.72, 0.42, 0.03, TRIM, 0.62, 3.9 + spireH, -0.2, 0.5);
      flag.material.transparent = true;
      flag.material.opacity = 0.85;
      g.userData.flag = flag;
      windows(8, 2.35, 1.52);
      windows(5, 3.25 + spireH * 0.4, 0.72);
      break;
    }
    case 'house': {
      // HAB UNIT: an armored pod, not a cottage. Sloped skirt, rounded roof
      // shell, framed solar wing, lit door with steps and an awning, AC box,
      // conduit into the ground. Bigger tiers stack a second pod. Variation
      // (roof pitch, door side, antenna, dish, tint) keys off the plot id.
      const flip = vid % 2 ? 1 : -1;
      const hullVar = new THREE.Color(HULL).offsetHSL(0, 0.004 * (vid % 3), ((vid % 5) - 2) * 0.012).getHex();
      const pod = (px, pz, w, d, h, y0 = 0) => {
        B.frustum(shade(hullVar, 0.82), w + 0.24, d + 0.24, 0.16, 0.94, px, y0 + 0.08, pz);   // skirt
        B.frustum(hullVar, w, d, h, 0.9, px, y0 + h / 2 + 0.14, pz);
        B.cap(shade(hullVar, 0.88), Math.min(w, d) * 0.36, Math.max(w, d) * 0.5, px, y0 + h + 0.06, pz, Math.PI / 2, w >= d ? Math.PI / 2 : 0, 0); // low roof shell
        B.box(shade(hullVar, 0.75), w * 0.7, 0.05, 0.1, px, y0 + h + 0.3, pz);                // roof spine
        ribs(B, shade(hullVar, 0.72), 3, px - w / 2 + 0.12, px + w / 2 - 0.12, y0 + 0.14, pz + d / 2 - 0.02, h * 0.8);
      };
      if (tier === 1) pod(0, 0, 1.3, 1.15, 0.66);
      else if (tier === 2) pod(0, 0, 1.5, 1.3, 0.95);
      else { pod(0, 0, 1.6, 1.4, 1.3); pod(0.45 * flip, 0.22, 1.0, 0.95, 0.7, 1.52); }
      const roofY = tier >= 3 ? 1.15 : tier === 2 ? 0.85 : 0.6;
      // Solar wing on a frame, always tilted the colony way.
      B.box(STEEL, 0.05, 0.3, 0.05, -0.4 * flip, roofY + 0.32, -0.25);
      B.box(STEEL, 0.05, 0.44, 0.05, 0.4 * flip, roofY + 0.38, -0.25);
      B.box(SOLAR, 1.3, 0.05, 0.85, 0, roofY + 0.54, -0.25, 0.12, 0, 0.12 * flip);
      B.box(shade(SOLAR, 1.45), 1.32, 0.02, 0.07, 0, roofY + 0.57, -0.25, 0.12, 0, 0.12 * flip);
      B.box(shade(SOLAR, 1.45), 0.07, 0.02, 0.83, 0, roofY + 0.57, -0.25, 0.12, 0, 0.12 * flip);
      // Door: recessed, lit, with steps and an awning plate.
      const doorX = 0.32 * flip, doorZ = tier >= 2 ? 0.68 : 0.6;
      B.box(DARK, 0.34, 0.5, 0.06, doorX, 0.42, doorZ);
      G.box(TRIM, 0.05, 0.44, 0.03, doorX - 0.17 * flip, 0.42, doorZ + 0.02);
      B.box(HULL2, 0.44, 0.05, 0.3, doorX, 0.72, doorZ + 0.1, 0.25);
      stairs(B, doorX, doorZ + 0.12, 0.4, 2, 0.08, 0);
      // Utilities: AC box with fan, ground conduit, antenna/dish per id.
      B.box(PAD, 0.3, 0.24, 0.24, -0.55 * flip, 0.26, 0.3);
      B.cyl(DARK, 0.09, 0.09, 0.05, -0.55 * flip, 0.26, 0.44, 8, Math.PI / 2, 0, 0);
      pipes(B, STEEL, [[-0.55 * flip, 0.36, 0.3], [-0.62 * flip, roofY * 0.6, 0.2], [-0.6 * flip, roofY * 0.6, -0.1]], 0.03);
      if (vid % 3 === 0) commsMast(B, G, -0.45 * flip, -0.35, roofY + 0.8, false);
      if (vid % 4 === 1) B.cyl(0xd8d2c2, 0.15, 0.03, 0.08, 0.45 * flip, roofY + 0.15, -0.35, 9, -0.9, 0, 0);
      windows(tier + 1, tier >= 3 ? 0.85 : 0.45, 0.72, 0.4 + vid);
      break;
    }
    case 'farm': {
      // HYDROPONIC VAULT: a ribbed greenhouse arch over glowing crop beds,
      // nutrient tank plumbed into the rows, service lamps at the corners.
      B.box(PAD, 2.0, 0.14, 2.0, 0, 0.07, 0);
      hazard(B, 0, 0.15, 0.97, 1.5, 0, 0.06);
      for (let r = 0; r < 3; r++) {
        const z = -0.6 + r * 0.6;
        B.box(HULL3, 1.74, 0.16, 0.4, 0, 0.2, z);
        B.box(tier >= 2 ? 0x5fd889 : 0x3fae64, 1.66, 0.1, 0.32, 0, 0.3, z);
        G.box(GLOW, 1.68, 0.025, 0.36, 0, 0.34, z);
        for (let k = 0; k < 5; k++) {
          B.ell(tier >= 2 ? 0x74e099 : 0x54c078, 0.075, -0.64 + k * 0.32, 0.4, z, 1, 0.85, 1, 7, 5);
        }
      }
      // The vault: arched ribs + ridge beam + glass shell (separate mesh).
      // Frames carry a faint greenhouse verdigris so farms read "grown".
      const FRAME = mix(HULL, 0x5fd889, 0.14);
      for (const hx of [-0.85, -0.28, 0.28, 0.85]) {
        B.cyl(FRAME, 0.045, 0.045, 1.05, hx, 0.5, -0.89, 7, 0.5, 0, 0);
        B.cyl(FRAME, 0.045, 0.045, 1.05, hx, 0.5, 0.89, 7, -0.5, 0, 0);
        B.cyl(FRAME, 0.04, 0.04, 0.9, hx, 0.98, 0, 7, Math.PI / 2, 0, 0);
      }
      B.box(FRAME, 1.9, 0.06, 0.08, 0, 1.02, 0);
      const glassGeo = new THREE.CylinderGeometry(0.95, 0.95, 1.8, 12, 1, true, 0, Math.PI);
      glassGeo.rotateZ(Math.PI / 2); // vault axis along the crop rows
      const glass = new THREE.Mesh(glassGeo, toyMat({ color: 0xbfe8e0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
      }));
      glass.position.y = 0.25;
      glass.scale.y = 0.5;
      g.add(glass);
      if (tier >= 2) {
        tanks(B, 0.95, 0.8, 1, 0.2, 0.6);
        pipes(B, STEEL, [[0.95, 0.5, 0.8], [0.95, 0.22, 0.4], [0.6, 0.22, 0.0], [-0.6, 0.22, 0.0]], 0.035);
      }
      floodlight(B, G, -0.95, -0.85, 1.1, 0.7);
      break;
    }
    case 'mill': {
      // POWER TURBINE: lattice mast on a sloped service bunker, transformer
      // yard with insulator stacks, cable run, blinking crown light.
      const h = tier >= 2 ? 3.3 : 2.7;
      B.frustum(PAD, 1.3, 1.3, 0.5, 0.8, 0, 0.25, 0);
      hazard(B, 0, 0.52, 0.6, 1.0, 0, 0.07);
      // Lattice: 4 legs + cross bracing panels.
      for (const [lx, lz] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) {
        B.cyl(HULL2, 0.05, 0.08, h, lx * (1 - 0.5 * 0.5), h / 2 + 0.3, lz * (1 - 0.5 * 0.5), 6, (lz > 0 ? -1 : 1) * 0.07, 0, (lx > 0 ? 1 : -1) * -0.07);
      }
      for (let i = 1; i <= 3; i++) {
        const w = 0.62 - i * 0.13;
        B.box(STEEL, w, 0.05, w, 0, 0.3 + (h - 0.4) * (i / 3), 0);
        B.box(STEEL, w * 1.3, 0.035, 0.035, 0, 0.3 + (h - 0.4) * (i / 3) - 0.15, 0, 0, 0, 0.6);
        B.box(STEEL, w * 1.3, 0.035, 0.035, 0, 0.3 + (h - 0.4) * (i / 3) - 0.15, 0, 0, Math.PI / 2, 0.6);
      }
      // Nacelle + tail vane.
      B.cap(HULL2, 0.2, 0.5, 0, h + 0.34, 0.02, Math.PI / 2, 0, 0);
      B.box(HULL, 0.04, 0.3, 0.34, 0, h + 0.36, -0.42);
      G.box(TRIM, 0.09, 0.09, 0.09, 0, h + 0.62, 0);
      // Transformer yard: cans, insulators, cable to the mast.
      B.box(PAD, 0.9, 0.1, 0.7, 0.85, 0.05, -0.55);
      for (const tx of [0.62, 0.95]) {
        B.box(GUN, 0.26, 0.4, 0.3, tx, 0.3, -0.55);
        for (let i = 0; i < 3; i++) B.cyl(0xd8d2c2, 0.035, 0.05, 0.07, tx, 0.54 + i * 0.08, -0.55, 7);
        G.box(GLOW, 0.05, 0.05, 0.02, tx, 0.36, -0.39);
      }
      pipes(B, DARK, [[0.85, 0.62, -0.55], [0.5, 0.9, -0.3], [0.15, 1.1, 0.0]], 0.028);
      const rotor = new THREE.Group();
      rotor.position.set(0, h + 0.34, 0.32);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.9, 0.04), M(0xe9e3d4));
        blade.position.y = 0.98;
        blade.castShadow = true;
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.045), M(TRIM));
        tip.position.y = 1.95;
        const pivot = new THREE.Group();
        pivot.rotation.z = (i * Math.PI * 2) / 3;
        pivot.add(blade);
        pivot.add(tip);
        rotor.add(pivot);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 8), M(STEEL));
      hub.rotation.x = Math.PI / 2;
      rotor.add(hub);
      g.add(rotor);
      g.userData.rotor = rotor;
      break;
    }
    case 'mine': {
      // DEEP BORE: an A-frame headworks over a shaft collar, conveyor ramp
      // spilling into an ore hopper, winch wheel, floodlight, tool crates.
      B.frustum(PAD, 2.0, 2.0, 0.26, 0.88, 0, 0.13, 0);
      B.cyl(DARK, 0.42, 0.5, 0.16, 0, 0.3, -0.2, 9);          // shaft collar
      G.box(TRIM, 0.06, 0.03, 0.9, -0.5, 0.28, -0.2);
      G.box(TRIM, 0.06, 0.03, 0.9, 0.5, 0.28, -0.2);
      for (const s of [-1, 1]) {                                // A-frame
        B.box(HULL, 0.14, 2.0, 0.14, s * 0.5, 1.15, -0.55, 0.35, 0, s * -0.22);
        B.box(HULL, 0.14, 2.0, 0.14, s * 0.5, 1.15, 0.15, -0.35, 0, s * -0.22);
        B.box(STEEL, 0.08, 0.9, 0.08, s * 0.36, 0.6, -0.2, 0, 0, s * -0.5);
      }
      B.box(HULL2, 1.15, 0.16, 0.5, 0, 2.05, -0.2);            // crown beam
      hazard(B, 0, 2.16, -0.2, 1.0, 0, 0.09);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 12), M(0xf3c53d));
      wheel.position.set(0, 2.0, -0.2);
      wheel.rotation.x = Math.PI / 2;
      wheel.castShadow = true;
      g.add(wheel);
      g.userData.rotor = wheel;
      pipes(B, DARK, [[0, 1.85, -0.2], [0, 0.5, -0.2]], 0.02); // hoist cable
      // Conveyor ramp + hopper + spilled ore.
      B.box(STEEL, 0.44, 0.07, 1.5, 0.65, 0.62, 0.55, 0.5, -0.5, 0);
      for (let i = 0; i < 4; i++) B.box(DARK, 0.4, 0.03, 0.06, 0.65 + i * 0.075, 0.35 + i * 0.16, 0.9 - i * 0.28, 0.5, -0.5, 0);
      B.frustum(HULL2, 0.8, 0.8, 0.55, 1.25, 1.05, 0.28, 1.05);
      for (let i = 0; i < 5; i++) B.ell(0x9a8448, 0.09, 0.95 + (i % 3) * 0.14, 0.6, 0.95 + (i % 2) * 0.16, 1, 0.8, 1, 6, 4);
      if (tier >= 2) { B.box(HULL, 1.0, 0.5, 0.7, -0.75, 0.25, 0.6); vent(B, -0.75, 0.32, 0.96); }
      floodlight(B, G, -0.85, -0.75, 1.4, 2.4);
      break;
    }
    case 'tower': {
      // DEFENSE PYLON: sandbagged sloped bunker base, ribbed shaft with a
      // sensor band and ammo conduit, armored gun deck with crenel plates —
      // then the doctrine crown (gun / incinerator / siege lance).
      const h = 2.3 + tier * 0.5;
      const hull = tier >= 3 ? 0xece6d6 : HULL;
      B.frustum(PAD, 1.9, 1.9, 0.5, 0.72, 0, 0.25, 0);
      hazard(B, 0, 0.52, 0.82, 1.4, 0, 0.07);
      sandbags(B, 0, 1.25, 1.5, 0, 2);
      sandbags(B, 1.25, 0, 1.5, Math.PI / 2, 2);
      B.cyl(hull, 0.56, 0.74, h - 0.4, 0, 0.4 + (h - 0.4) / 2, 0, 12);
      for (let i = 0; i < 4; i++) {                             // shaft ribs
        const a = i * Math.PI / 2 + Math.PI / 4;
        B.frustum(shade(hull, 0.88), 0.1, 0.16, h - 0.9, 0.55, Math.cos(a) * 0.64, 0.5 + (h - 0.9) / 2, Math.sin(a) * 0.64, -a);
      }
      G.box(GLOW, 1.28, 0.12, 1.28, 0, h * 0.46, 0);          // sensor band
      pipes(B, STEEL, [[0.55, 0.6, 0.3], [0.6, h * 0.8, 0.2], [0.35, h - 0.1, 0.1]], 0.035);
      // Gun deck in slate: the war-fighting crown reads as machined hardware
      // against the bone hull, so towers pop out of the eco skyline.
      B.cyl(mix(hull, GUN, 0.45), 0.9, 0.62, 0.42, 0, h + 0.02, 0, 12); // flared deck
      B.cyl(mix(PAD, GUN, 0.35), 0.97, 0.97, 0.1, 0, h + 0.3, 0, 12);
      for (let i = 0; i < 8; i++) {                             // crenel plates
        const a = (i / 8) * Math.PI * 2 + 0.2;
        B.box(mix(hull, GUN, 0.55), 0.34, 0.3, 0.07, Math.cos(a) * 0.9, h + 0.5, Math.sin(a) * 0.9, 0, -a - Math.PI / 2, 0);
      }
      G.box(TRIM, 0.13, 0.13, 0.13, 0, h + 0.32, 0.88);        // muzzle marker
      floodlight(B, G, -0.75, -0.75, h + 0.15, 2.4);
      windows(3, h * 0.62, 0.66);
      const head = new THREE.Group();
      head.position.y = h + 0.52;
      if (b.branch === 'flame') {
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.28, 0.35, 10), M(GUN));
        head.add(bowl);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.09, 10), M(0x2f3338));
        collar.position.y = 0.18;
        head.add(collar);
        const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 7), M(0xff7a2e, 0.9));
        fire.position.y = 0.42;
        head.add(fire);
        g.userData.flame = fire;
        for (const side of [-1, 1]) {
          const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.3, 3, 8), M(0xb0492a));
          tank.position.set(side * 0.32, -0.24, -0.34);
          tank.castShadow = true;
          head.add(tank);
          const band = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.05), M(0xe8a83c));
          band.position.set(side * 0.32, -0.14, -0.3);
          head.add(band);
        }
        const pilot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), M(0xffb45e, 1.0));
        pilot.position.set(0, 0.14, 0.42);
        head.add(pilot);
      } else {
        // Twin-barrel autocannon in an armored mantlet (ballista: rail lance).
        const mant = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.4), M(GUN));
        mant.castShadow = true;
        head.add(mant);
        const shield = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.42, 0.07), M(shade(hull, 0.85)));
        shield.position.set(0, 0.02, 0.2);
        shield.castShadow = true;
        head.add(shield);
        if (b.branch === 'ballista') {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.7), M(0x4a4440));
          rail.position.set(0, 0.06, 0.55);
          rail.castShadow = true;
          head.add(rail);
          const railGlow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.6), M(GLOW, 0.8));
          railGlow.position.set(0, 0.17, 0.55);
          head.add(railGlow);
          const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.01, 0.9, 6), M(0xd8d2c2));
          bolt.rotation.x = Math.PI / 2;
          bolt.position.set(0, 0.15, 0.9);
          head.add(bolt);
          for (const s of [-1, 1]) {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.07), M(0x565c60));
            arm.position.set(s * 0.34, 0.1, 0.35);
            arm.rotation.y = s * -0.5;
            head.add(arm);
          }
          const rack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.6), M(0x6b6152));
          rack.position.set(-0.32, 0, -0.3);
          head.add(rack);
        } else {
          for (const s of [-1, 1]) {
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.85, 7), M(0x2b2e33));
            barrel.rotation.x = Math.PI / 2;
            barrel.position.set(s * 0.11, 0.04, 0.62);
            barrel.castShadow = true;
            head.add(barrel);
            const brake = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.12), M(DARK));
            brake.position.set(s * 0.11, 0.04, 1.02);
            head.add(brake);
          }
          const belt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.3), M(0x6b6152));
          belt.position.set(0.3, -0.05, -0.24);
          head.add(belt);
        }
      }
      g.add(head);
      g.userData.head = head;
      break;
    }
    case 'wall': {
      if (hasKit('wall_t1_seg') && kitWall(b, ctx, tier, K, KG)) break;
      // THE RAMPART — still a smoothed polyline (piers chamfer toward their
      // neighbors, curtains meet at shared midpoints; the sim's tile grid is
      // untouched) — but each curtain is now real fortification: a sloped
      // glacis footing, armored plate with recessed panel seams, a merloned
      // parapet, and per-tile weathering. Gates are drum bastions.
      const N = ctx.mapSize || 0;
      const wallTiles = ctx.wallTiles || new Set();
      const nbs = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (wallTiles.has((b.z + dz) * N + (b.x + dx))) nbs.push([dx, dz]);
      }
      let scx = 0, scz = 0;
      for (const [dx, dz] of nbs) { scx += dx * 0.26; scz += dz * 0.26; }
      const segs = nbs.map(([dx, dz]) => {
        const ex = dx * 0.5, ez = dz * 0.5;
        return {
          mx: (scx + ex) / 2, mz: (scz + ez) / 2,
          len: Math.hypot(ex - scx, ez - scz) + 0.12,
          yaw: Math.atan2(ez - scz, ex - scx),
        };
      });
      const seg3 = (s, len, h, thick, color, y, dy = 0) => {
        B.box(color, len, h, thick, s.mx, y, s.mz, 0, -s.yaw, dy);
      };
      const run = nbs.length === 2
        ? Math.atan2(nbs[0][1] - nbs[1][1], nbs[0][0] - nbs[1][0])
        : nbs.length ? Math.atan2(nbs[0][1], nbs[0][0]) : 0;
      const pvx = -Math.sin(run), pvz = Math.cos(run);
      const passYaw = Math.atan2(pvz, pvx);
      const shock = b.branch === 'shock';
      const bastion = b.branch === 'bastion';
      // EUROPEAN RAMPART (toy kit): cream ashlar on a darker plinth, slate-blue
      // caps, gold trim, cyan energy lamps. Every tier is visibly MORE wall —
      // it thickens and rises; T2 grows merlons and pier turrets, T3 adds the
      // energy band, banners and men on the walk.
      const P = culture().palette;
      const wear = (((b.x * 7 + b.z * 13) % 5) - 2) * 0.02;
      const stone = shade(P.stone, 1 + wear), stone2 = P.stone2, base = P.stone3;
      const H = bastion ? 1.75 : tier >= 3 ? 1.4 : tier === 2 ? 1.05 : 0.62;
      const T = bastion ? 0.66 : tier >= 3 ? 0.56 : tier === 2 ? 0.44 : 0.3;
      const pierR = tier >= 3 || bastion ? 0.36 : tier === 2 ? 0.3 : 0.2;
      const guard = (x, z, yaw) => {
        // a toy sentry: one of YOUR men, blue tabard + steel helm + spear
        B.box(P.banner, 0.16, 0.2, 0.12, x, H + 0.24, z, 0, yaw, 0);
        B.box(0xf0c8a0, 0.11, 0.1, 0.1, x, H + 0.4, z, 0, yaw, 0);
        B.box(P.steel, 0.13, 0.06, 0.13, x, H + 0.48, z, 0, yaw, 0);
        B.box(P.wood, 0.025, 0.5, 0.025, x + Math.cos(yaw) * 0.1, H + 0.36, z - Math.sin(yaw) * 0.1);
        B.box(P.steel, 0.05, 0.08, 0.02, x + Math.cos(yaw) * 0.1, H + 0.64, z - Math.sin(yaw) * 0.1);
      };
      const banner = (x, z, h, yaw) => {
        B.box(P.steel, 0.03, h, 0.03, x, h / 2, z);
        B.box(P.banner, 0.26, 0.36, 0.02, x + Math.cos(yaw) * 0.14, h - 0.24, z - Math.sin(yaw) * 0.14, 0, yaw, 0);
        B.box(P.trim, 0.26, 0.05, 0.025, x + Math.cos(yaw) * 0.14, h - 0.08, z - Math.sin(yaw) * 0.14, 0, yaw, 0);
      };
      if (b.gate) {
        // THE GATE outranks the wall: twin round towers with slate cones,
        // a gold-trimmed arch lintel and a glowing threshold for your men.
        for (const s of segs) {
          seg3(s, s.len, H, T, stone, H / 2);
          seg3(s, s.len + 0.04, 0.12, T + 0.1, base, 0.06);
          seg3(s, s.len + 0.04, 0.1, T + 0.06, P.roof, H + 0.05);
        }
        const towH = H + 1.0 + tier * 0.25;
        for (const side of [-1, 1]) {
          const px = pvx * side * 0.55, pz = pvz * side * 0.55;
          B.cyl(stone, 0.34 + tier * 0.03, 0.4 + tier * 0.03, towH, px, towH / 2, pz, 8);
          B.cyl(base, 0.44 + tier * 0.03, 0.46 + tier * 0.03, 0.16, px, 0.08, pz, 8);
          B.cyl(P.trim, 0.42 + tier * 0.03, 0.4 + tier * 0.03, 0.08, px, towH + 0.04, pz, 8);
          B.cone(P.roof, 0.46 + tier * 0.03, 0.7 + tier * 0.12, px, towH + 0.4 + tier * 0.06, pz, 8);
          G.box(P.glow, 0.1, 0.16, 0.1, px + pvz * 0.36, towH * 0.7, pz - pvx * 0.36);
          if (tier >= 2) banner(px, pz, towH + 1.15 + tier * 0.12, -passYaw);
        }
        B.box(stone2, 1.0, 0.3, T + 0.08, 0, towH - 0.3, 0, 0, -passYaw, 0);      // lintel
        B.box(P.trim, 1.02, 0.06, T + 0.1, 0, towH - 0.13, 0, 0, -passYaw, 0);
        for (const side of [-1, 1]) {                                              // leaves, ajar
          B.box(P.wood, 0.36, H * 1.1, 0.08, pvx * side * 0.24, H * 0.55, pvz * side * 0.24, 0, -passYaw + side * 0.5, 0);
          B.box(P.steel, 0.04, H * 0.9, 0.09, pvx * side * 0.12, H * 0.55, pvz * side * 0.12, 0, -passYaw + side * 0.5, 0);
        }
        G.box(P.glow, 1.3, 0.03, 0.42, 0, 0.04, 0, 0, -passYaw, 0);                // threshold
        if (tier >= 3) for (const side of [-1, 1]) guard(pvx * side * 0.55, pvz * side * 0.55 + 0.001, -passYaw);
        break;
      }
      // Pier: a round stone drum; from T2 it caps with a slate cone turret.
      const pierH = H + (tier >= 2 ? 0.28 : 0.12);
      B.cyl(stone2, pierR, pierR + 0.05, pierH, scx, pierH / 2, scz, 8);
      B.cyl(base, pierR + 0.1, pierR + 0.12, 0.14, scx, 0.07, scz, 8);
      if (tier >= 2 || bastion) {
        B.cyl(P.trim, pierR + 0.04, pierR + 0.02, 0.06, scx, pierH + 0.03, scz, 8);
        B.cone(P.roof, pierR + 0.08, 0.5 + tier * 0.08, scx, pierH + 0.3 + tier * 0.04, scz, 8);
      } else {
        B.cyl(P.roof, pierR + 0.03, pierR + 0.03, 0.08, scx, pierH + 0.04, scz, 8);
      }
      for (const s of segs) {
        seg3(s, s.len, 0.16, T + 0.14, base, 0.08);                          // plinth
        seg3(s, s.len, H - 0.16, T, stone, (H - 0.16) / 2 + 0.16);           // curtain
        seg3(s, s.len * 0.9, 0.06, T + 0.02, stone2, H * 0.55);              // course line
        if (tier === 1 && !bastion) {
          seg3(s, s.len, 0.06, T + 0.04, P.wood, H + 0.03);                  // timber cap
          continue;
        }
        seg3(s, s.len + 0.04, 0.1, T + 0.1, stone2, H + 0.05);               // wall-walk
        const n = tier >= 3 || bastion ? 3 : 2;                              // merlons
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5) / n - 0.5;
          const ox = Math.cos(s.yaw) * u * s.len, oz = -Math.sin(s.yaw) * u * s.len;
          for (const side of [-1, 1]) {
            const nx = Math.sin(s.yaw) * side * (T / 2), nz = Math.cos(s.yaw) * side * (T / 2);
            B.box(stone, 0.16, 0.2, 0.1, s.mx + ox + nx, H + 0.2, s.mz + oz + nz, 0, -s.yaw, 0);
          }
        }
        if (tier >= 3 || shock) {
          const nx = Math.sin(s.yaw) * (T / 2 + 0.01), nz = Math.cos(s.yaw) * (T / 2 + 0.01);
          for (const side of [-1, 1]) {
            G.box(shock ? 0x6ff6ff : P.glow, s.len * 0.92, 0.05, 0.02, s.mx + nx * side, H * 0.78, s.mz + nz * side, 0, -s.yaw, 0);
          }
        }
        if (bastion) seg3(s, s.len, H * 0.5, T + 0.18, shade(stone, 0.94), H * 0.25); // battered footing
      }
      if (shock) G.box(0x6ff6ff, 0.16, 0.16, 0.16, scx, pierH + 0.95, scz);
      // T3: banners on alternate piers and a sentry on the walk.
      const odd = ((b.x + b.z) & 1) === 1;
      if (tier >= 3 && segs.length && odd) banner(scx, scz, pierH + 1.2, -run);
      if (tier >= 3 && segs.length && !odd) guard(segs[0].mx, segs[0].mz, -run + Math.PI / 2);
      if (!segs.length) B.box(stone, 0.9, H, 0.9, 0, H / 2, 0); // stranded stub
      break;
    }
    case 'outpost': {
      // FORWARD FIREBASE: sandbagged perimeter, sloped command dome with a
      // hatch and antenna farm, watch platform on legs, searchlight, and the
      // tier-2+ autocannon nest behind a shield.
      B.frustum(PAD, 2.0, 2.0, 0.28, 0.85, 0, 0.14, 0);
      for (const [sx, sz, ry] of [[-0.9, 0.9, 0.75], [0.9, -0.9, 0.75], [-0.9, -0.9, -0.75]]) {
        sandbags(B, sx, sz, 1.1, ry, 2);
      }
      B.ell(HULL, 0.85, -0.35, 0.35, -0.25, 1, 0.68, 1, 12, 8);       // command dome
      B.frustum(HULL2, 1.5, 1.5, 0.22, 0.85, -0.35, 0.12, -0.25);
      B.box(0x6a655a, 0.36, 0.3, 0.07, -0.35, 0.5, 0.32);              // hatch
      G.box(TRIM, 0.28, 0.04, 0.03, -0.35, 0.68, 0.34);
      vent(B, -0.85, 0.42, -0.35, 0.28, 0.18, Math.PI / 2);
      commsMast(B, G, -0.15, -0.75, 3.4);
      G.box(0x59b06e, 0.55, 0.38, 0.03, -0.45, 3.0, -0.75);            // relay banner
      // Watch platform: 4 legs, deck, rail, searchlight.
      B.box(HULL2, 0.9, 0.6, 0.7, 0.55, 0.3, 0.5);
      for (const [lx, lz] of [[0.25, 0.2], [0.85, 0.2], [0.25, 0.8], [0.85, 0.8]]) {
        B.cyl(STEEL, 0.04, 0.05, 1.5, lx, 1.35, lz, 6);
      }
      B.box(PAD, 0.85, 0.08, 0.75, 0.55, 2.1, 0.5);
      for (const [lx, lz] of [[0.2, 0.16], [0.9, 0.16], [0.2, 0.84], [0.9, 0.84]]) {
        B.box(STEEL, 0.04, 0.3, 0.04, lx, 2.3, lz);
      }
      B.box(STEEL, 0.74, 0.035, 0.035, 0.55, 2.42, 0.16);
      B.box(STEEL, 0.74, 0.035, 0.035, 0.55, 2.42, 0.84);
      floodlight(B, G, 0.55, 0.5, 2.55, 2.2);
      hazard(B, 0.55, 2.15, 0.12, 0.7, 0, 0.05);
      if (tier >= 2) {
        // The captured flag grows into one readable fort, not a loose cluster
        // of unrelated plots. Three full curtains and a split front curtain
        // leave a broad lane-facing gate; twin towers make the tier change
        // legible from strategy zoom.
        const fenceCol = tier >= 3 ? 0x59616b : 0x6b5842;
        B.box(fenceCol, 6.8, 0.72, 0.22, 0, 0.38, -3.35);
        B.box(fenceCol, 0.22, 0.72, 6.8, -3.35, 0.38, 0);
        B.box(fenceCol, 0.22, 0.72, 6.8, 3.35, 0.38, 0);
        B.box(fenceCol, 2.15, 0.72, 0.22, -2.28, 0.38, 3.35);
        B.box(fenceCol, 2.15, 0.72, 0.22, 2.28, 0.38, 3.35);
        const towerH = tier >= 3 ? 2.8 : 2.25;
        for (const x of [-2.75, 2.75]) {
          B.cyl(HULL2, 0.62, 0.8, towerH, x, towerH / 2, 2.75, 10);
          B.cyl(GUN, 0.72, 0.66, 0.2, x, towerH + 0.1, 2.75, 10);
          G.box(0x72cfff, 0.32, 0.16, 0.32, x, towerH + 0.35, 2.75);
        }
        const head = new THREE.Group();
        head.position.set(0.25, 1.7, -0.35);
        const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, tier >= 3 ? 1.15 : 0.8, 7), M(0x2b2e33));
        gun.rotation.x = Math.PI / 2;
        gun.position.z = 0.4;
        gun.castShadow = true;
        head.add(gun);
        const mant = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.34), M(GUN));
        head.add(mant);
        if (tier >= 3) {
          const shield = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.1), M(0x6b6152));
          shield.position.set(0, -0.02, -0.2);
          shield.castShadow = true;
          head.add(shield);
        }
        g.add(head);
        g.userData.head = head;
        B.frustum(GUN, 0.6, 0.6, 0.9, 0.8, 0.25, 0.45, -0.35);         // gun pedestal
      }
      break;
    }
    case 'workshop': {
      // FABRICATION BAY: gantry crane over a work slab, drone hall with a
      // glass band, coil stack, hot vent, parts racks, welding light.
      B.frustum(PAD, 2.0, 2.0, 0.28, 0.9, 0, 0.14, 0);
      B.frustum(HULL, 1.6, 1.35, 1.0, 0.86, 0, 0.72, -0.1);
      B.box(HULL2, 1.75, 0.16, 1.5, 0, 1.3, -0.1);
      G.box(GLOW, 1.62, 0.07, 1.38, 0, 1.2, -0.1);
      ribs(B, HULL2, 4, -0.6, 0.6, 0.28, -0.78, 0.85);
      vent(B, 0.55, 1.48, -0.55, 0.3, 0.2);
      G.box(0xff9a4d, 0.2, 0.035, 0.12, 0.55, 1.38, -0.55);
      B.cyl(STEEL, 0.12, 0.14, 0.55, -0.6, 1.65, -0.5, 8);            // coil stack
      G.box(TRIM, 0.13, 0.05, 0.13, -0.6, 1.95, -0.5);
      // Gantry over the work slab.
      B.box(STEEL, 0.1, 0.95, 0.1, -0.85, 0.48, 0.75);
      B.box(STEEL, 0.1, 0.95, 0.1, 0.85, 0.48, 0.75);
      B.box(0x565c60, 1.85, 0.1, 0.13, 0, 1.0, 0.75);
      B.box(0xe8a83c, 0.13, 0.3, 0.11, 0.25, 0.8, 0.75);
      pipes(B, DARK, [[0.25, 0.66, 0.75], [0.25, 0.5, 0.75]], 0.02);
      B.box(0x6a655a, 0.75, 0.14, 0.55, 0.25, 0.22, 0.75);            // work slab
      B.box(GUN, 0.3, 0.12, 0.2, 0.18, 0.36, 0.7);                     // the workpiece
      G.box(0x9fd8ff, 0.05, 0.03, 0.05, 0.33, 0.4, 0.75);              // weld glint
      // Parts racks.
      for (let i = 0; i < 3; i++) B.box(0x6b6152, 0.3, 0.12 + i * 0.02, 0.5, -0.8, 0.1 + i * 0.16, 0.65);
      const rotor = new THREE.Group();
      rotor.position.set(0, 1.72, -0.1);
      for (let i = 0; i < 3 + tier; i++) {
        const a = (i / (3 + tier)) * Math.PI * 2;
        const drone = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.4), M(0x55ddeb, 0.7));
        drone.position.set(Math.cos(a) * (0.7 + tier * 0.12), Math.sin(a * 2) * 0.12, Math.sin(a) * (0.7 + tier * 0.12));
        rotor.add(drone);
      }
      g.add(rotor);
      g.userData.rotor = rotor;
      break;
    }
    case 'hero_forge': {
      // ASCENSION MACHINE: stepped dais with inlaid power seams, four ribbed
      // conduit pylons feeding a levitating core, coolant loops to the base.
      B.cyl(0x8f897d, 1.15, 1.4, 0.2, 0, 0.1, 0, 12);
      B.cyl(PAD, 1.0, 1.25, 0.45, 0, 0.42, 0, 12);
      G.box(GLOW, 0.06, 0.03, 2.0, 0, 0.54, 0);
      G.box(GLOW, 2.0, 0.03, 0.06, 0, 0.54, 0);
      padLights(G, 0, 0, 1.18, 8, 0.22, GLOW);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        const px = Math.cos(a) * 0.85, pz = Math.sin(a) * 0.85;
        B.frustum(HULL2, 0.3, 0.3, 1.9 + tier * 0.25, 0.7, px, 1.0 + tier * 0.12, pz, -a);
        G.box(GLOW, 0.09, 0.5, 0.09, px, 1.5 + tier * 0.2, pz);
        B.box(STEEL, 0.1, 0.1, 0.1, px, 2.0 + tier * 0.25, pz);
        pipes(B, STEEL, [[px * 1.35, 0.1, pz * 1.35], [px * 1.15, 0.5, pz * 1.15], [px, 0.9, pz]], 0.045);
      }
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.48 + tier * 0.1, 0), M(tier >= 3 ? 0xffd75e : 0x72cfff, 1.0));
      core.position.y = 1.75 + tier * 0.2;
      core.userData.window = true;
      g.add(core);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85 + tier * 0.1, 0.07, 8, 36), M(0x72cfff, 0.8));
      ring.position.y = core.position.y;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      g.userData.rotor = ring;
      break;
    }
    case 'camp_militia':
    case 'camp_ranger':
    case 'camp_sniper': {
      // MUSTER BAY: a ribbed quonset with blast-door end wall and doctrine
      // stripe, muster pad with painted lanes, kit crates, comms, floodlight.
      const col = b.kind === 'camp_militia' ? 0x5f9ccf : b.kind === 'camp_ranger' ? 0x74c96a : 0xb98fe0;
      // Doctrine washes over the bay itself — ribs and end wall carry the
      // corps color, so the three camp kinds read apart from strategy zoom,
      // not only from the stripe.
      B.cyl(mix(HULL, col, 0.16), 0.62, 0.62, 1.5, -0.25, 0.5, 0.05, 12, 0, 0, Math.PI / 2);
      for (const rx of [-0.85, -0.5, -0.15, 0.2, 0.45]) {              // hull ribs
        B.cyl(mix(HULL2, col, 0.35), 0.65, 0.65, 0.07, rx, 0.5, 0.05, 12, 0, 0, Math.PI / 2);
      }
      B.cyl(shade(HULL, 0.9), 0.64, 0.64, 0.05, 0.51, 0.5, 0.05, 12, 0, 0, Math.PI / 2); // end ring
      B.box(mix(HULL2, col, 0.28), 0.06, 1.24, 1.24, 0.53, 0.5, 0.05); // end wall
      B.box(DARK, 0.05, 0.7, 0.5, 0.56, 0.4, 0.05);                    // blast door
      G.box(col, 0.03, 0.6, 0.05, 0.58, 0.4, 0.34);
      G.box(col, 1.52, 0.05, 0.09, -0.25, 0.99, 0.05);                 // doctrine stripe
      vent(B, -0.95, 0.6, 0.05, 0.26, 0.18, -Math.PI / 2);
      // Muster pad with painted deploy lanes.
      B.box(PAD, 1.5, 0.1, 1.95, -0.2, 0.05, 0);
      for (const lz of [-0.55, 0, 0.55]) G.box(col, 0.7, 0.02, 0.05, -0.2, 0.11, lz);
      hazard(B, -0.2, 0.11, 0.92, 1.2, 0, 0.06);
      // Kit: crate stack, ammo boxes, water tank, comms, floodlight.
      B.box(0x6b6152, 0.34, 0.3, 0.34, -0.7, 0.15, 0.75);
      B.box(0x7a7060, 0.26, 0.2, 0.26, -0.68, 0.4, 0.73, 0, 0.4, 0);
      B.box(0x565c60, 0.2, 0.12, 0.3, -0.3, 0.06, 0.8);
      tanks(B, 0.75, -0.65, 1, 0.13, 0.42);
      commsMast(B, G, 0.85, 0.75, 2.4, false);
      G.box(col, 0.45, 0.3, 0.03, 0.62, 1.9, 0.75);                    // holo banner
      floodlight(B, G, -0.95, -0.75, 1.5, 0.8);
      if (tier >= 2) { B.box(HULL2, 0.7, 0.5, 0.6, -0.6, 0.25, -0.75); vent(B, -0.6, 0.32, -0.44, 0.3, 0.18); }
      break;
    }
  }

  // Merged output: body (shadowed hull), glow (always-lit), windows (night).
  if (!K.empty()) {
    const m = K.build(kitMaterials().body.clone(), false);
    g.add(m);
  }
  if (!KG.empty()) {
    const m = KG.build(kitMaterials().glow.clone(), false);
    m.castShadow = false;
    m.userData.noOutline = true;
    g.add(m);
  }
  if (!B.empty()) {
    g.add(B.build(toyMat({ vertexColors: true, map: colonyAtlas() }), true));
  }
  if (!G.empty()) {
    const glow = G.build(new THREE.MeshBasicMaterial({ vertexColors: true }));
    glow.castShadow = false;
    g.add(glow);
  }
  if (!W.empty()) {
    const win = W.build(toyMat({ color: WINDOW, emissive: WINDOW, emissiveIntensity: 0, vertexColors: true,
    }));
    win.castShadow = false;
    win.userData.window = true;
    g.add(win);
  }

  // CC0 prop dressing (skipped gracefully when assets are unavailable).
  const dress = (assetKey, fit, x, z, ry = 0) => {
    const a = assetClone(assetKey, fit);
    if (a) { a.position.set(x, 0, z); a.rotation.y = ry; g.add(a); }
  };
  if (b.kind === 'hq') {
    dress('banner', 0.85, -1.7, 0.6);
    dress('banner', 0.85, 1.7, 0.6, Math.PI);
    dress('crates', 1.1, -1.4, 1.5, 0.4);
    dress('torch', 0.45, 1.5, 1.6);
  } else if (b.kind.startsWith('camp') || b.kind === 'outpost') {
    dress('boxes', 0.9, -0.75, -0.6, 0.7);
  } else if (b.kind === 'house' && tier >= 2) {
    dress('barrel', 0.5, 0.75, 0.6);
  } else if (b.kind === 'mine') {
    dress('crates', 0.9, 0.8, -0.8, 0.3);
  } else if (b.kind === 'mill') {
    dress('barrel', 0.5, 0.8, 0.6);
  }
  return g;
}
