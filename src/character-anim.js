// Presentation-only hero skins and zombie vertex animation.
// The simulation never reads this module. Clips are retimed here; hitboxes
// stay on the unit records in game.js.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const HERO_KEYS = ['scott', 'alexander', 'danny', 'turtle', 'john', 'tiger', 'aaron'];
const ZOMBIE_KEYS = ['walker', 'runner', 'brute', 'spitter', 'burrower', 'sieger', 'caller'];

// Drawn size on top of the simulation scale in config.js. Collision, hit
// radius and the lockstep hash keep using that config scale alone.
export const ZOMBIE_VISUAL = 2.35;
const HERO_CLIP = { idle: 'idle', run: 'run', attack: 'attack', cast: 'ability', hit: 'hit', down: 'death' };

const heroes = {};
const zombies = {};
let loading = null;

function toLambert(src) {
  return new THREE.MeshLambertMaterial({
    color: src?.color ? src.color.clone() : new THREE.Color(0xffffff),
    emissive: src?.emissive ? src.emissive.clone() : new THREE.Color(0x000000),
    emissiveIntensity: src?.emissiveIntensity || 0,
    flatShading: true,
  });
}

function outlineMaterial() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x141018, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      'vec3 transformed = vec3(position) + normalize(normal) * 0.035;',
    );
  };
  return mat;
}

// Deep-clone a skinned glTF and give the copy its own skeleton. Geometry
// stays shared (charShared) so a despawn cannot free the template.
function cloneSkinned(srcScene) {
  const node = srcScene.clone(true);
  const cloneBones = new Map();
  node.traverse((o) => { if (o.isBone) cloneBones.set(o.name, o); });
  const skinned = [];
  node.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  for (const o of skinned) {
    const bones = o.skeleton.bones.map((b) => cloneBones.get(b.name)).filter(Boolean);
    const skel = new THREE.Skeleton(bones, o.skeleton.boneInverses);
    o.bind(skel, o.bindMatrix);
    o.frustumCulled = false;
    o.castShadow = true;
    o.geometry.userData.charShared = true;
    const srcMats = Array.isArray(o.material) ? o.material : [o.material];
    const lamberts = srcMats.map(toLambert);
    o.material = lamberts.length === 1 ? lamberts[0] : lamberts;
    const ink = new THREE.SkinnedMesh(o.geometry, outlineMaterial());
    ink.bind(skel, o.bindMatrix);
    ink.frustumCulled = false;
    ink.castShadow = false;
    ink.position.copy(o.position);
    ink.quaternion.copy(o.quaternion);
    ink.scale.copy(o.scale);
    (o.parent || node).add(ink);
  }
  return { node };
}

function fitHero(node) {
  // Fit the body (feet to just above the head bone) to 1.35 before the
  // group scale of 0.82. Weapons and props may stick past that box; they
  // must not shrink the figure, and the feet stay on the ground.
  node.updateMatrixWorld(true);
  const tmp = new THREE.Vector3();
  let headY = null;
  let footY = null;
  node.traverse((o) => {
    if (!o.isBone) return;
    o.getWorldPosition(tmp);
    if (o.name === 'Head') headY = tmp.y;
    if (o.name === 'Foot.L' || o.name === 'Foot.R') footY = footY == null ? tmp.y : Math.min(footY, tmp.y);
  });
  const box = new THREE.Box3().setFromObject(node);
  const base = footY == null ? box.min.y : footY;
  const crown = headY == null ? box.max.y : headY + Math.max(0.12, (headY - base) * 0.2);
  const s = 1.35 / Math.max(0.001, crown - base);
  node.scale.multiplyScalar(s);
  node.updateMatrixWorld(true);
  let planted = null;
  node.traverse((o) => {
    if (!o.isBone) return;
    if (o.name !== 'Foot.L' && o.name !== 'Foot.R') return;
    o.getWorldPosition(tmp);
    planted = planted == null ? tmp.y : Math.min(planted, tmp.y);
  });
  node.position.y -= planted == null ? new THREE.Box3().setFromObject(node).min.y : planted;
}

function playClip(player, state) {
  const name = HERO_CLIP[state] || 'idle';
  if (player.state === state) return;
  const next = player.actions[name] || player.actions.idle;
  if (!next) return;
  const fade = state === 'hit' || state === 'down' ? 0.07 : 0.16;
  next.reset();
  next.fadeIn(fade);
  if (state === 'down' || state === 'hit' || state === 'cast') {
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
  } else {
    next.setLoop(THREE.LoopRepeat, Infinity);
  }
  next.timeScale = state === 'run' ? 1.75 : state === 'attack' ? 1.25 : 1;
  next.play();
  if (player.current && player.current !== next) player.current.fadeOut(fade);
  player.current = next;
  player.state = state;
}

export function cloneHero(key) {
  const src = heroes[key];
  if (!src) return null;
  const { node } = cloneSkinned(src.scene);
  fitHero(node);
  const mixer = new THREE.AnimationMixer(node);
  const actions = {};
  for (const clip of src.clips) actions[clip.name] = mixer.clipAction(clip);
  const player = { node, mixer, actions, current: null, state: '' };
  player.play = (state) => playClip(player, state);
  player.play('idle');
  return player;
}

export function hasHero(key) {
  return !!heroes[key];
}

function packRGBA(src) {
  const n = src.length / 3;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = src[i * 3];
    out[i * 4 + 1] = src[i * 3 + 1];
    out[i * 4 + 2] = src[i * 3 + 2];
    out[i * 4 + 3] = 1;
  }
  return out;
}

function dataTex(data, width, height) {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function parseZombieVat(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'ZV02') throw new Error(`bad zombie vat ${magic}`);
  let o = 4;
  const vert = view.getUint32(o, true); o += 4;
  const frames = view.getUint32(o, true); o += 4;
  const nclips = view.getUint32(o, true); o += 4;
  const nindex = view.getUint32(o, true); o += 4;
  const clips = {};
  for (let i = 0; i < nclips; i++) {
    let name = '';
    for (let c = 0; c < 16; c++) {
      const ch = view.getUint8(o + c);
      if (ch) name += String.fromCharCode(ch);
    }
    o += 16;
    const start = view.getUint32(o, true); o += 4;
    const length = view.getUint32(o, true); o += 4;
    clips[name] = { start, length };
  }
  const index = new Uint32Array(nindex);
  for (let i = 0; i < nindex; i++) index[i] = view.getUint32(o + i * 4, true);
  o += nindex * 4;
  const colorBytes = new Uint8Array(buffer, o, vert * 4);
  o += vert * 4;
  const posSrc = new Float32Array(frames * vert * 3);
  for (let i = 0; i < posSrc.length; i++) posSrc[i] = view.getFloat32(o + i * 4, true);
  o += posSrc.length * 4;
  const nrmSrc = new Float32Array(frames * vert * 3);
  for (let i = 0; i < nrmSrc.length; i++) nrmSrc[i] = view.getFloat32(o + i * 4, true);

  const rest = new Float32Array(vert * 3);
  rest.set(posSrc.subarray(0, vert * 3));
  const colors = new Float32Array(vert * 3);
  for (let i = 0; i < vert; i++) {
    colors[i * 3] = colorBytes[i * 4] / 255;
    colors[i * 3 + 1] = colorBytes[i * 4 + 1] / 255;
    colors[i * 3 + 2] = colorBytes[i * 4 + 2] / 255;
  }
  const geometry = new THREE.BufferGeometry();
  const vatId = new Float32Array(vert);
  for (let i = 0; i < vert; i++) vatId[i] = i;
  geometry.setAttribute('position', new THREE.BufferAttribute(rest, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrmSrc.slice(0, vert * 3), 3));
  geometry.setAttribute('vatId', new THREE.BufferAttribute(vatId, 1));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.userData.charShared = true;
  geometry.computeBoundingSphere();
  return {
    geometry,
    clips,
    vert,
    frames,
    pos: dataTex(packRGBA(posSrc), vert, frames),
    nrm: dataTex(packRGBA(nrmSrc), vert, frames),
  };
}

export function zombieAnim(type) {
  return zombies[type] || null;
}

export function zombieAnimReady() {
  return ZOMBIE_KEYS.every((key) => zombies[key]);
}

export function loadCharacters() {
  if (loading) return loading;
  const loader = new GLTFLoader();
  loading = Promise.all([
    ...HERO_KEYS.map(async (key) => {
      try {
        const gltf = await loader.loadAsync(`assets/characters/heroes/hero_${key}.glb`);
        heroes[key] = { scene: gltf.scene, clips: gltf.animations };
      } catch (error) {
        console.warn('hero anim missing', key, error);
      }
    }),
    ...ZOMBIE_KEYS.map(async (key) => {
      try {
        const res = await fetch(`assets/characters/zombies/zombie_${key}.vat.bin`);
        if (!res.ok) throw new Error(String(res.status));
        zombies[key] = parseZombieVat(await res.arrayBuffer());
      } catch (error) {
        console.warn('zombie anim missing', key, error);
      }
    }),
  ]).then(() => ({ heroes: Object.keys(heroes).length, zombies: Object.keys(zombies).length }));
  return loading;
}
