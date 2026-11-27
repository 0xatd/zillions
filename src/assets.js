// CC0 3D assets (KayKit Dungeon Remastered, kaylousberg.com) loaded at startup.
// Every GLB is requested from the asset host in src/asset-base.js, then from
// the same relative path on this origin. A failure leaves the template empty
// so callers keep the procedural mesh or the existing hero model.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { loadGlb } from './asset-base.js';
import { culture, CULTURES, DEFAULT_CULTURE, SHARED_KIT, activeCulture } from './cultures.js';
import { marineFlag } from './marine-recipe.js';
import {
  extrasAreTwoHanded, marineHeroAssetKey, marineHeroLoadUrls, marineHeroManifest,
  MARINE_HERO_LOD_NAMES, materialTextures,
} from './marine-hero-art.js';

const TEMPLATES = {};

const MANIFEST = {
  wall: 'assets/wall.glb',
  wallCracked: 'assets/wall_cracked.glb',
  torch: 'assets/torch.glb',
  banner: 'assets/banner_red.glb',
  crates: 'assets/crates_stacked.glb',
  boxes: 'assets/box_stacked.glb',
  barrel: 'assets/barrel.glb',
  chest: 'assets/chest_gold.glb',
  pillar: 'assets/pillar.glb',
  heroScott: 'assets/art-slice/hero_scott.glb',
  humanRifleman: 'assets/art-slice/human_rifleman.glb',
  hiveDrone: 'assets/art-slice/hive_drone.glb',
  humanHqT1: 'assets/art-slice/human_hq_t1.glb',
  humanHqT2: 'assets/art-slice/human_hq_t2.glb',
  humanHqT3: 'assets/art-slice/human_hq_t3.glb',
  humanTowerT1: 'assets/art-slice/human_tower_t1.glb',
  humanTowerT2: 'assets/art-slice/human_tower_t2.glb',
  humanTowerT3: 'assets/art-slice/human_tower_t3.glb',
  humanBarracksT1: 'assets/art-slice/human_barracks_t1.glb',
  humanBarracksT2: 'assets/art-slice/human_barracks_t2.glb',
  humanBarracksT3: 'assets/art-slice/human_barracks_t3.glb',
  humanMine: 'assets/art-slice/human_mine.glb',
  humanWall: 'assets/art-slice/human_wall.glb',
  humanGate: 'assets/art-slice/human_gate.glb',
};

// Marine heroes (default on; ?marineHeroes=0 opts out): the art-marines hero
// line. The manifest value is the full-detail GLB. Rykus, Tynor and Draco
// also have a *_lod1.glb that loadAssets fetches only for the Low preset.
if (marineFlag('marineHeroes')) Object.assign(MANIFEST, marineHeroManifest());

export const ART_SLICE_KEYS = Object.freeze([
  'heroScott', 'humanRifleman', 'hiveDrone',
  'humanHqT1', 'humanHqT2', 'humanHqT3',
  'humanTowerT1', 'humanTowerT2', 'humanTowerT3',
  'humanBarracksT1', 'humanBarracksT2', 'humanBarracksT3',
  'humanMine', 'humanWall', 'humanGate',
]);

// ---- toy kit (per culture, vertex-coloured, see tools/art/toy_kit) ----
// Shared runtime materials: every kit mesh is flat matte Lambert carrying its
// baked vertex colours; meshes named glow/eyes are unlit so lamps, pads and
// eyes read at any light level.
let _kitBody = null, _kitGlow = null;
export function kitMaterials() {
  if (!_kitBody) {
    _kitBody = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    _kitGlow = new THREE.MeshBasicMaterial({ vertexColors: true });
  }
  return { body: _kitBody, glow: _kitGlow };
}
// Loaded kits by culture. European is always loaded and is the fallback for
// any piece a culture lacks; SHARED_KIT pieces always come from it.
const KITS = {};
const KIT_LOADING = {};

function loadCultureKit(loader, key) {
  if (KIT_LOADING[key]) return KIT_LOADING[key];
  const c = CULTURES[key];
  const mats = kitMaterials();
  const out = (KITS[key] = KITS[key] || {});
  const names = key === DEFAULT_CULTURE ? c.assets : c.assets.filter((n) => !SHARED_KIT.has(n));
  KIT_LOADING[key] = Promise.all(names.map(async (name) => {
    try {
      const gltf = await loadGlb(loader, `${c.kitPath}/${name}.glb`);
      const root = gltf.scene;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.userData.kitShared = true;
        const glow = o.name === 'glow' || o.name === 'eyes' || o.material?.name === 'glow'
          || o.parent?.name === 'glow' || o.parent?.name === 'eyes';
        o.material = glow ? mats.glow : mats.body;
        o.castShadow = !glow;
        o.receiveShadow = !glow;
        if (glow) o.userData.noOutline = true;
      });
      out[name] = root;
    } catch (e) {
      // Missing kit piece — callers fall back to European, then procedural.
    }
  })).then(() => out);
  return KIT_LOADING[key];
}

function loadKit(loader) {
  return loadCultureKit(loader, DEFAULT_CULTURE);
}

let _kitLoader = null;
// Load (once) the kit for a culture so its base can be built. Resolves when
// its pieces are in; unknown or unbuilt cultures resolve to European.
export function loadKitCulture(key) {
  const c = culture(key);
  _kitLoader = _kitLoader || new GLTFLoader();
  return loadCultureKit(_kitLoader, c.key);
}

function kitNode(name) {
  const key = activeCulture();
  if (key !== DEFAULT_CULTURE && !SHARED_KIT.has(name)) {
    const own = KITS[key]?.[name];
    if (own) return own;
  }
  return KITS[DEFAULT_CULTURE]?.[name] || null;
}

export function hasKit(name) {
  return !!kitNode(name);
}

// Clone a kit asset. Geometry and the two shared materials are shared, so a
// clone is cheap; callers must not dispose them (kitShared flags this).
export function kitClone(name) {
  const t = kitNode(name);
  if (!t) return null;
  const g = t.clone(true);
  g.userData.kitShared = true;
  return g;
}

// A named part's geometry (pivot-relative, as authored) plus its pivot, for
// instanced use (horde bodies, trees, rocks).
export function kitGeometry(name, part) {
  const t = kitNode(name);
  if (!t) return null;
  let found = null;
  t.traverse((o) => {
    if (found) return;
    if (o.name === part || (o.parent && o.parent.name === part && o.isMesh)) found = o;
  });
  if (!found) return null;
  let mesh = found.isMesh ? found : null;
  if (!mesh) found.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  if (!mesh) return null;
  const pivot = found.position.clone();
  return { geometry: mesh.geometry, pivot };
}

function sceneIsTwoHanded(root) {
  let found = false;
  root?.traverse((node) => {
    if (extrasAreTwoHanded(node.userData)) found = true;
  });
  return found;
}

// Textured marine heroes keep their painted albedo and normal map on Lambert.
// Untextured kit heroes stay flat-shaded, matching the KayKit prop path.
function applyMarineHeroMaterial(mesh) {
  const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const convert = (src) => {
    if (!src) return src;
    const textured = !!(src.map || src.normalMap);
    const mat = new THREE.MeshLambertMaterial({
      flatShading: !textured,
      map: src.map || null,
      normalMap: src.normalMap || null,
      color: textured ? new THREE.Color(0xffffff) : (src.color || new THREE.Color(0x8a8478)),
    });
    if (src.normalScale?.isVector2) mat.normalScale.copy(src.normalScale);
    return mat;
  };
  const next = Array.isArray(mesh.material) ? sources.map(convert) : convert(sources[0]);
  mesh.material = next;
  for (const src of sources) {
    if (src && src !== next && !(Array.isArray(next) && next.includes(src))) src.dispose();
  }
}

// Textures from a template that was replaced. Live clones still share them, so
// they stay allocated until releaseRetiredHeroTextures(), which runs after
// those clones have been removed. A second dispose is a no-op in this Three
// build once the GPU resource is gone.
const retiredHeroTextures = [];

function retireTemplate(holder) {
  if (!holder) return;
  const seen = new Set();
  holder.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    const mats = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
    for (const mat of mats) {
      for (const texture of materialTextures(mat)) {
        if (seen.has(texture)) continue;
        seen.add(texture);
        retiredHeroTextures.push(texture);
      }
      mat.dispose();
    }
  });
}

export function releaseRetiredHeroTextures() {
  const batch = retiredHeroTextures.splice(0, retiredHeroTextures.length);
  for (const texture of batch) texture.dispose();
}

function adoptTemplate(key, root) {
  const authored = ART_SLICE_KEYS.includes(key);
  const marineHero = key.startsWith('marineHero_');
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    // Keep the authored slice's metal, roughness, and emissive response.
    // Legacy KayKit props use Lambert because they are ambient set
    // dressing and can use the cheaper material path.
    if (marineHero) applyMarineHeroMaterial(o);
    else if (!authored) {
      const src = o.material;
      o.material = new THREE.MeshLambertMaterial({ flatShading: true, map: src.map || null,
        color: src.map ? new THREE.Color(0.82, 0.78, 0.72) : (src.color || new THREE.Color(0x8a8478)),
      });
    }
  });
  // Normalize: sit on y=0, remember footprint for scaling at clone time.
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;
  const holder = new THREE.Group();
  holder.add(root);
  holder.userData.size = box.getSize(new THREE.Vector3());
  if (marineHero) holder.userData.twoHanded = sceneIsTwoHanded(root);
  return holder;
}

function storeTemplate(key, scene) {
  const previous = TEMPLATES[key];
  if (!scene) {
    if (previous) retireTemplate(previous);
    delete TEMPLATES[key];
    return false;
  }
  TEMPLATES[key] = adoptTemplate(key, scene);
  if (previous) retireTemplate(previous);
  return true;
}

// Hero paths stay repo-relative. loadGlb tries the asset host, then this
// origin, and rejects a non-GLB body (including a Git LFS pointer, HTTP 200).
// The caller then leaves the template empty so the existing hero mesh is used.
async function readHeroScene(loader, url) {
  return (await loadGlb(loader, url)).scene;
}

async function loadMarineHeroScene(loader, name, quality) {
  const urls = marineHeroLoadUrls(name, quality);
  for (const url of urls) {
    try {
      return await readHeroScene(loader, url);
    } catch {
      // Try the next url. The last failure leaves the template unset.
    }
  }
  return null;
}

function marineHeroFailed(key) {
  console.warn(`[assets] ${key} failed to parse; the existing hero model will be used`);
}

// `marineHeroQuality` is the graphics choice: low, medium, high, or auto.
// Only 'low' selects *_lod1.glb, and only for heroes that have one.
export function loadAssets(options = {}) {
  const marineHeroQuality = options.marineHeroQuality ?? 'auto';
  const loader = new GLTFLoader();
  const kit = loadKit(loader);
  return Promise.all([kit, ...Object.entries(MANIFEST).map(async ([key, url]) => {
    try {
      if (key.startsWith('marineHero_')) {
        const name = key.slice('marineHero_'.length);
        const scene = await loadMarineHeroScene(loader, name, marineHeroQuality);
        if (!storeTemplate(key, scene)) marineHeroFailed(key);
        return;
      }
      const gltf = await loadGlb(loader, url);
      storeTemplate(key, gltf.scene);
    } catch (e) {
      // Asset missing/unloadable — procedural fallback will be used.
    }
  })]);
}

// Swap the Low-preset hero files when the graphics choice crosses Low.
// Other marine heroes have no LOD file and stay as they were.
export function reloadMarineHeroes(quality) {
  const loader = new GLTFLoader();
  return Promise.all(MARINE_HERO_LOD_NAMES.map(async (name) => {
    const key = marineHeroAssetKey(name);
    if (!Object.prototype.hasOwnProperty.call(MANIFEST, key) && !TEMPLATES[key]) return;
    try {
      const scene = await loadMarineHeroScene(loader, name, quality);
      if (!storeTemplate(key, scene)) marineHeroFailed(key);
    } catch (e) {
      storeTemplate(key, null);
      marineHeroFailed(key);
    }
  }));
}

// Clone an asset scaled so its horizontal footprint fits `fit` world units
// (uniform scale). Returns a fresh Group positioned with base at y=0.
export function assetClone(key, fit) {
  const t = TEMPLATES[key];
  if (!t) return null;
  const g = t.clone(true);
  // Runtime unit meshes are disposed when they leave the battlefield. Clone
  // GPU resources so disposing one live instance cannot invalidate the cached
  // template or another instance.
  g.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry = o.geometry.clone();
    if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
    else if (o.material) o.material = o.material.clone();
  });
  if (fit) {
    const s = t.userData.size;
    const scale = fit / Math.max(s.x, s.z);
    g.scale.setScalar(scale);
  }
  return g;
}

export function assetPart(root, name) {
  let found = null;
  root?.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}
