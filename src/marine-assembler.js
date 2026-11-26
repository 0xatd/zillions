// Runtime marine assembler: snaps the modular kit
// (assets/art-marines/kit/marine_kit.glb) into a unique marine from a seed.
//
//   await loadMarineKit();
//   const m = assembleMarine(hashSeed(matchSeed, unit.id), { chapter: 'crimson', role: 'soldier' });
//   scene.add(m.node);  // m.limbs, m.weapon, m.recipe
//
// Same seed + options => same marine on every peer. Geometry is shared with
// the kit template (flagged kitShared so disposal skips it); tinted materials
// are cached per colour. Presentation only.
//
// LOD + batching: each marine is flattened into one merged mesh per animated
// group (body, legs, arms, weapon) and material, for the full kit and for the
// low-poly kit (marine_kit_lo.glb, ~1.5k tris). setMarineLod(node, low)
// flips between them. Merged geometry is cached by content, so legs, arms and
// weapons are shared across marines; only the torso group is per-combination.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { mergeGeometries } from '../vendor/utils/BufferGeometryUtils.js';
import { pickMarine, hashSeed, marineFlag, CHAPTERS } from './marine-recipe.js';

export { pickMarine, hashSeed, marineFlag, CHAPTERS };
export const MARINE_KIT_URL = 'assets/art-marines/kit/marine_kit.glb';
export const MARINE_KIT_LO_URL = 'assets/art-marines/kit/marine_kit_lo.glb';
const BODY_BULK = { light: 0.88, standard: 1.0, heavy: 1.18 };

let KIT = null;
let KIT_LO = null;
let loading = null;

const roleOf = (o) => o.userData?.role || o.name;

// Load the kit once. Resolves to true when ready, false when missing (the
// caller then keeps its existing model path).
function indexKit(gltf) {
  const parts = {};
  for (const node of gltf.scene.children) {
    const role = roleOf(node);
    const m = /^kit_([a-z]+)_([a-z0-9]+)$/.exec(role);
    if (!m) continue;
    node.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.userData.kitShared = true;
    });
        (parts[m[1]] = parts[m[1]] || {})[m[2]] = node;
      }
  return parts;
}

// The low kit is optional: without it marines stay full detail.
export function loadMarineKit(url = MARINE_KIT_URL, loader = new GLTFLoader(), loUrl = MARINE_KIT_LO_URL) {
  if (!loading) {
    const lo = loUrl ? loader.loadAsync(loUrl).then(indexKit).catch(() => null) : Promise.resolve(null);
    loading = Promise.all([loader.loadAsync(url).then(indexKit), lo]).then(([hi, low]) => {
      KIT = hi;
      KIT_LO = low;
      return true;
    }).catch(() => false);
  }
  return loading;
}

export const marineKitReady = () => !!KIT;
export const marineKitParts = () => (KIT ? Object.fromEntries(Object.entries(KIT).map(([k, v]) => [k, Object.keys(v)])) : null);

function findRole(root, role) {
  let found = null;
  root.traverse((o) => { if (!found && roleOf(o) === role) found = o; });
  return found;
}

function clonePart(cat, variant, kit = KIT) {
  const t = kit?.[cat]?.[variant];
  if (!t) return null;
  const c = t.clone(true);
  c.position.set(0, 0, 0);
  c.userData.kitShared = true;
  return c;
}

const SLOT_COLOR = { armor: 'armor', armor_dark: 'armorDark', trim: 'trim', glow: 'glow', skin: 'skin', hair: 'hair', cloth: 'cloth' };
const MAT_CACHE = new Map();

function tintMaterial(src, colors) {
  const name = src?.name || '';
  if (!name.startsWith('tint_')) return src; // fixed_* stays shared
  const slot = name.slice(5);
  const hex = colors[SLOT_COLOR[slot]];
  if (hex == null) return src;
  const key = `${name}:${hex}`;
  let m = MAT_CACHE.get(key);
  if (!m) {
    m = src.clone();
    m.color.setHex(hex);
    if (slot === 'glow' && m.emissive) {
      m.emissive.setHex(hex);
      m.emissiveIntensity = Math.max(1.5, m.emissiveIntensity || 1);
    }
    m.userData.kitShared = true;
    MAT_CACHE.set(key, m);
  }
  return m;
}

function attach(socket, part, scale = 1) {
  if (!socket || !part) return null;
  part.scale.multiplyScalar(scale);
  socket.add(part);
  return part;
}

// recipeOrSeed: a recipe from pickMarine, or a seed (number/string) plus opts
// for pickMarine. Returns { node, recipe, limbs, weapon } or null if the kit
// is not loaded.
function buildTree(kit, recipe) {
  const clonePart_ = (cat, variant) => clonePart(cat, variant, kit);
  const kitBody = clonePart_('body', recipe.body) || clonePart_('body', 'standard');
  if (!kitBody) return null;
  const body = findRole(kitBody, 'body');
  const root = new THREE.Group();
  root.name = 'asset_root';
  root.add(body);

  // Chest emblem first: the body's own socket_emblem is the first match.
  const chest = findRole(body, 'socket_emblem');
  attach(chest, clonePart_('emblem', recipe.emblem), 1.1);

  const bulk = BODY_BULK[recipe.body] || 1;
  const ps = (0.75 + 0.25 * bulk) * (recipe.body === 'heavy' ? 1.12 : 1);
  const pr = attach(findRole(body, 'socket_pauldron_r'), clonePart_('pauldron', recipe.pauldron), ps);
  const pl = attach(findRole(body, 'socket_pauldron_l'), clonePart_('pauldron', recipe.pauldron), ps);
  if (pl) {
    pl.scale.x *= -1; // kit pauldrons are right-handed
    attach(findRole(pl, 'socket_emblem'), clonePart_('emblem', recipe.emblem), 1.15);
  }
  void pr;

  const head = findRole(body, 'socket_head');
  if (recipe.helmet) {
    attach(head, clonePart_('helmet', recipe.helmet));
  } else {
    attach(head, clonePart_('head', recipe.head));
    if (recipe.hair && recipe.hair !== 'bald') attach(head, clonePart_('hair', recipe.hair));
    if (recipe.beard && recipe.beard !== 'none') attach(head, clonePart_('beard', recipe.beard));
    if (recipe.face && recipe.face !== 'plain') attach(head, clonePart_('face', recipe.face));
  }
  if (recipe.backpack) attach(findRole(body, 'socket_back'), clonePart_('backpack', recipe.backpack), 0.85 + 0.15 * bulk);
  const weaponPart = recipe.weapon ? attach(findRole(body, 'socket_weapon'), clonePart_('weapon', recipe.weapon)) : null;

  return { root, body, weaponPart };
}

// Animated groups: the runtime rotates/offsets these nodes; everything under
// one of them (down to the next group) is rigid relative to it.
const GROUPS = new Set(['body', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'weapon']);
const MERGE_CACHE = new Map();
const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();

// Far marines only animate the legs: arms + weapon are baked into the torso
// mesh, so a low-LOD marine is 3 draw calls.
const LO_GROUPS = new Set(['body', 'leg_l', 'leg_r']);

function groupMeshes(group, bounds = GROUPS) {
  const out = [];
  const walk = (o) => {
    for (const c of o.children) {
      if (bounds.has(roleOf(c))) continue;
      if (c.isMesh && c.visible) out.push(c);
      walk(c);
    }
  };
  walk(group);
  return out;
}

function bakeGeometry(src, matrix) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.attributes.position.clone());
  if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
  else g.computeVertexNormals();
  if (src.index) g.setIndex(src.index.clone());
  else g.setIndex([...Array(src.attributes.position.count).keys()]);
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) { // mirrored part: keep faces outward
    const idx = g.index.array;
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  return g;
}

// Merge one group's rigid meshes into one geometry per source material.
// Returns [{ geometry, material }] with geometries cached by content.
function mergeGroup(group) {
  group.updateMatrixWorld(true);
  _inv.copy(group.matrixWorld).invert();
  const byMat = new Map();
  for (const mesh of groupMeshes(group)) {
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    _rel.multiplyMatrices(_inv, mesh.matrixWorld);
    const key = mesh.geometry.uuid + ':' + _rel.elements.map((e) => e.toFixed(4)).join(',');
    const list = byMat.get(mat) || [];
    list.push({ mesh, key, rel: _rel.clone() });
    byMat.set(mat, list);
  }
  const out = [];
  for (const [mat, list] of byMat) {
    const key = mat.name + '|' + list.map((e) => e.key).join('|');
    let geometry = MERGE_CACHE.get(key);
    if (!geometry) {
      geometry = mergeGeometries(list.map((e) => bakeGeometry(e.mesh.geometry, e.rel)), false);
      if (!geometry) continue;
      geometry.computeBoundingSphere();
      geometry.userData.kitShared = true; // shared across marines; never disposed per unit
      MERGE_CACHE.set(key, geometry);
    }
    out.push({ geometry, material: mat });
  }
  return out;
}

// Low LOD: the whole group in ONE geometry with baked vertex colours (tint
// applied), drawn with a single material -> ~6 draw calls per far marine.
const _col = new THREE.Color();
function mergeGroupColored(group, colors, filter = null, prefix = 'lo', bounds = GROUPS) {
  group.updateMatrixWorld(true);
  _inv.copy(group.matrixWorld).invert();
  const parts = [];
  const keys = [];
  for (const mesh of groupMeshes(group, bounds)) {
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (filter && !filter(src)) continue;
    const mat = tintMaterial(src, colors);
    _rel.multiplyMatrices(_inv, mesh.matrixWorld);
    _col.copy(mat.color || _col.set(0xffffff));
    if (/glow/.test(src.name || '')) _col.multiplyScalar(1.6);
    const hex = _col.getHexString();
    keys.push(mesh.geometry.uuid + ':' + hex + ':' + _rel.elements.map((e) => e.toFixed(4)).join(','));
    parts.push({ geometry: mesh.geometry, rel: _rel.clone(), color: _col.clone() });
  }
  if (!parts.length) return null;
  const key = prefix + '|' + keys.join('|');
  let geometry = MERGE_CACHE.get(key);
  if (!geometry) {
    const geoms = parts.map(({ geometry: g0, rel, color }) => {
      const g = bakeGeometry(g0, rel);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    });
    geometry = mergeGeometries(geoms, false);
    if (!geometry) return null;
    geometry.computeBoundingSphere();
    geometry.userData.kitShared = true;
    MERGE_CACHE.set(key, geometry);
  }
  return geometry;
}

// Full-detail batching: armour/cloth/skin share one vertex-coloured
// material, trim/steel another (keeps the metal sheen), glow keeps its own
// emissive material -> ~3 draws per group instead of ~8.
const isGlow = (m) => /glow/.test(m?.name || '') || (m?.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0.5);
const isMetal = (m) => !isGlow(m) && (m?.metalness ?? 0) >= 0.6;
const isMatte = (m) => !isGlow(m) && !isMetal(m);
const CLASS_MATS = new Map();
function classMaterial(cls, src) {
  let m = CLASS_MATS.get(cls);
  if (!m) {
    m = src.clone();
    m.name = `marine_${cls}`;
    m.color.setHex(0xffffff);
    m.vertexColors = true;
    m.map = null;
    m.userData = { kitShared: true };
    CLASS_MATS.set(cls, m);
  }
  return m;
}
function firstMat(group, filter) {
  for (const mesh of groupMeshes(group)) {
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (filter(m)) return m;
  }
  return null;
}
function mergeGroupHi(group, colors) {
  const out = [];
  for (const [cls, filter] of [['matte', isMatte], ['metal', isMetal]]) {
    const src = firstMat(group, filter);
    if (!src) continue;
    const geometry = mergeGroupColored(group, colors, filter, `hi-${cls}`);
    if (geometry) out.push({ geometry, material: classMaterial(cls, src), raw: true });
  }
  // Glow parts: per material (one tint colour each), emissive intact.
  for (const part of mergeGroup(group)) if (isGlow(part.material)) out.push(part);
  return out;
}

const LO_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15, name: 'marine_lo' });
LO_MATERIAL.userData.kitShared = true;

// After merging, a group needs only its merged meshes, its child groups and
// the runtime sockets. Re-hang those directly under the group (same world
// transform) and drop every intermediate node: ~25 nodes per marine instead
// of ~150, which keeps per-frame matrix updates cheap for big armies.
const KEEP_ROLES = new Set(['socket_muzzle', 'socket_ability']);
const _m = new THREE.Matrix4();
function flattenGroup(group) {
  group.updateMatrixWorld(true);
  _inv.copy(group.matrixWorld).invert();
  const keep = [];
  const walk = (o) => {
    for (const c of o.children) {
      const r = roleOf(c);
      if (GROUPS.has(r) || KEEP_ROLES.has(r)) { keep.push(c); continue; }
      walk(c);
    }
  };
  walk(group);
  for (const c of keep) {
    _m.multiplyMatrices(_inv, c.matrixWorld);
    c.removeFromParent();
    _m.decompose(c.position, c.quaternion, c.scale);
  }
  for (const c of [...group.children]) group.remove(c);
  for (const c of keep) group.add(c);
}

function depth(o) { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d; }

function groupsByRole(root) {
  const map = new Map();
  root.traverse((o) => { const r = roleOf(o); if (GROUPS.has(r) && !map.has(r)) map.set(r, o); });
  // A hand-held weapon root may be the part itself (role weapon); body is the trunk.
  return map;
}

// recipeOrSeed: a recipe from pickMarine, or a seed (number/string) plus opts
// for pickMarine. opts.merge (default true) batches + adds the LOD.
// Returns { node, recipe, limbs, weapon } or null if the kit is not loaded.
export function assembleMarine(recipeOrSeed, opts = {}) {
  if (!KIT) return null;
  const recipe = typeof recipeOrSeed === 'object' && recipeOrSeed ? recipeOrSeed : pickMarine(recipeOrSeed, opts);
  const built = buildTree(KIT, recipe);
  if (!built) return null;
  const { root, body, weaponPart } = built;
  // opts.ownMaterials: per-marine material copies (hit flashes mutate
  // emissive, so a shared material would flash every marine in that colour).
  const own = opts.ownMaterials ? new Map() : null;
  const tint = (m) => {
    const t = tintMaterial(m, recipe.colors);
    if (!own || !t) return t;
    let c = own.get(t);
    if (!c) { c = t.clone(); c.userData = { ...t.userData, kitShared: false }; own.set(t, c); }
    return c;
  };
  const lod = { hi: [], lo: [], low: false };
  if (opts.merge === false) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material);
      o.castShadow = true;
      o.receiveShadow = true;
    });
  } else {
    const hiGroups = groupsByRole(root);
    const loBuilt = KIT_LO ? buildTree(KIT_LO, recipe) : null;
    const loGroups = loBuilt ? groupsByRole(loBuilt.root) : null;
    const merged = [];
    const loMat = own ? LO_MATERIAL.clone() : LO_MATERIAL;
    if (own) loMat.userData = { kitShared: false };
    for (const [role, group] of hiGroups) {
      merged.push([group, mergeGroupHi(group, recipe.colors), 'hi']);
      const loGroup = LO_GROUPS.has(role) ? loGroups?.get(role) : null;
      const loGeom = loGroup ? mergeGroupColored(loGroup, recipe.colors, null, 'lo3', LO_GROUPS) : null;
      if (loGeom) merged.push([group, [{ geometry: loGeom, material: loMat, raw: true }], 'lo']);
    }
    // Flatten leaf-first so child groups keep their world transforms.
    const order = [...hiGroups.values()].sort((a, b) => depth(b) - depth(a));
    for (const group of order) flattenGroup(group);
    for (const [group, parts, level] of merged) {
      for (const { geometry, material, raw } of parts) {
        const mesh = new THREE.Mesh(geometry, raw && material === loMat ? material : tint(material));
        mesh.name = `marine_${level}`;
        mesh.castShadow = level === 'hi';
        mesh.receiveShadow = level === 'hi';
        mesh.visible = level === 'hi';
        group.add(mesh);
        lod[level].push(mesh);
      }
    }
  }
  // Small per-marine variance (horizontal width, height). glTF is Y-up.
  root.scale.set(recipe.width || 1, recipe.height || 1, recipe.width || 1);
  root.userData.marineRecipe = recipe;
  root.userData.marineLod = lod;

  return {
    node: root,
    recipe,
    weapon: weaponPart ? findRole(weaponPart, 'weapon') || weaponPart : null,
    limbs: {
      legL: findRole(body, 'leg_l'), legR: findRole(body, 'leg_r'),
      armL: findRole(body, 'arm_l'), armR: findRole(body, 'arm_r'),
    },
  };
}

// Show the low-poly kit (true) or full detail (false). Cheap; call per frame.
export function setMarineLod(node, low) {
  const lod = node?.userData?.marineLod;
  if (!lod || !lod.lo.length || lod.low === low) return false;
  lod.low = low;
  for (const m of lod.hi) m.visible = !low;
  for (const m of lod.lo) m.visible = low; // far marines skip the shadow pass
  return true;
}

export const marineMergeCacheSize = () => MERGE_CACHE.size;

// Feature flags (default ON): ?marines=0 puts colony troops back on the old
// models; ?marineHeroes=0 puts heroes back on the art-slice / animated GLBs.
// ?marineLod=hi|lo|auto (default auto) pins the troop LOD for comparisons.
function lodMode() {
  try {
    const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('marineLod') : null;
    return v === 'hi' || v === 'lo' ? v : 'auto';
  } catch { return 'auto'; }
}
export const MARINE_FLAGS = Object.freeze({ units: marineFlag('marines'), heroes: marineFlag('marineHeroes'), lod: lodMode() });

// Culture -> chapter for generic troops (armour colour still follows the
// unit trade so soldiers/rangers/snipers read apart).
const CULTURE_CHAPTER = { european: 'cobalt', asian: 'crimson', middle_eastern: 'ember', south_american: 'verdant' };
const UNIT_ROLE = { soldier: 'soldier', ranger: 'ranger', sniper: 'sniper' };

export function marineForUnit(u, { matchSeed = 0, culture = 'european' } = {}) {
  if (!KIT || !u || u.hero) return null;
  const role = UNIT_ROLE[u.key];
  if (!role) return null;
  const chapter = CULTURE_CHAPTER[culture] || 'cobalt';
  const palette = u.def?.color != null ? { armor: u.def.color } : undefined;
  return assembleMarine(hashSeed(matchSeed >>> 0, u.id, u.key), { chapter, role, palette, ownMaterials: true });
}

// Reuse the authored identity sculpt in custom heroes, without replacing their
// equipment layers or animation rig. All three views use this same builder.
export function assembleCharacterHead(identity) {
  if (!KIT) return null;
  const root = new THREE.Group();
  const face = identity.face.family, hair = identity.head.family;
  const variant = {sentinel:'square', ranger:'long', veteran:'sculpted', nomad:'round'}[face] || 'square';
  const head = clonePart('head', variant);
  if (!head) return null;
  root.add(head);
  const hairVariant = {cropped:'crew', swept:'swept', shaved:'bald', hooded:'buzz'}[hair] || 'buzz';
  const hairPart = hairVariant !== 'bald' ? clonePart('hair', hairVariant) : null;
  if (hairPart) root.add(hairPart);
  const marking = {veteran:'scar', nomad:'warpaint'}[face];
  if (marking) { const part = clonePart('face', marking); if (part) root.add(part); }
  const colors = {skin:0xd8b395,hair:0x382c25,armor:0x8493a6,armorDark:0x303b48,trim:0xbeb59f,glow:0x8fd0ff,cloth:0x30343b};
  const materials = new Map();
  root.traverse(o=>{if(!o.isMesh)return;const tint=m=>{if(!materials.has(m)){const c=tintMaterial(m,colors).clone();c.userData={...c.userData,kitShared:false};materials.set(m,c);}return materials.get(m);};o.material=Array.isArray(o.material)?o.material.map(tint):tint(o.material);});
  // Center from the face alone: hairstyles must not shift the jaw/neck.
  const bounds = new THREE.Box3().setFromObject(head);
  // The sculpt has no internal animation: batch by material before attaching
  // it to the independently animated head pivot. Preserve all authored faces.
  const batches = mergeGroup(root);
  if (batches.length) {
    root.clear();
    for (const { geometry, material } of batches) {
      const part = new THREE.Mesh(geometry, material);
      part.castShadow = true; root.add(part);
    }
  }
  root.scale.setScalar(.49);
  root.position.y = .01 - (bounds.min.y + bounds.max.y) * .245;
  return root;
}
