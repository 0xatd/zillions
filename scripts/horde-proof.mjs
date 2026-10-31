// Deterministic horde-mound capture. One sim step per call, then a render.
// A driver steps it at a fixed frame count and grabs the canvas, so the
// video is constant-fps even when a frame is expensive to draw.
import * as THREE from 'three';
import { Game } from '../src/game.js';
import { HordeArt } from '../src/horde-art.js';
import { HORDE_PILE, PLOT_KINDS, SIM_DT, TILE } from '../src/config.js';
import { toyMat } from '../src/toy-style.js';

const SIZE = 80;
const WALL_Z = 46;
const GATE_X0 = 37;
const GATE_X1 = 42;

function makeMap() {
  const tiles = new Uint8Array(SIZE * SIZE).fill(TILE.GRASS);
  return {
    size: SIZE, seed: 11,
    sites: [{ x: 40, z: 62 }],
    nestSpots: [[6, 6]],
    nodeSpots: [{ x: 40, z: 30, kind: 'clearing', name: 'Gate' }],
    tiles,
    idx: (x, z) => z * SIZE + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < SIZE && z < SIZE,
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < SIZE && z < SIZE,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < SIZE && z < SIZE,
  };
}

function addBuilding(game, kind, x, z, opts) {
  const def = PLOT_KINDS[kind].tiers[0];
  const s = kind === 'hq' ? 3 : 1;
  const b = {
    id: opts.id, plotId: opts.plotId ?? -1, kind, key: kind, def,
    x, z, size: s, cx: x + s / 2, cz: z + s / 2,
    hp: 1e9, maxHp: 1e9, alive: true, cooldown: 0, gate: !!opts.gate, priority: 0,
  };
  game.buildings.push(b);
  for (let dz = 0; dz < s; dz++) for (let dx = 0; dx < s; dx++) {
    game.occ[(z + dz) * SIZE + (x + dx)] = b.id;
  }
  if (b.gate) game.gateIds.add(b.id);
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, canvas: document.getElementById('view') });
renderer.setSize(1280, 720, false);
renderer.setPixelRatio(1);
renderer.setClearColor(0x12181c, 1);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x12181c, 28, 78);
const camera = new THREE.PerspectiveCamera(32, 1280 / 720, 0.2, 200);

scene.add(new THREE.HemisphereLight(0xc5d0c8, 0x2a241c, 0.85));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.15);
sun.position.set(20, 28, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 80;
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(SIZE, SIZE),
  toyMat({ color: 0x4d6a48 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(SIZE / 2, 0, SIZE / 2);
ground.receiveShadow = true;
scene.add(ground);

const game = new Game(makeMap(), 'normal', 'scott', null, 2, 'campaign');
game.phase = 'found';
for (const nest of game.nests) nest.alive = false;
game.zombies = [];
game.heroes[0].x = 3;
game.heroes[0].z = 3;
game.heroes[0].mx = 0;
game.heroes[0].mz = 0;
game.plots.push({ id: 1, tier: 1, branch: null, kind: 'wall' });
game.plots.push({ id: 2, tier: 3, branch: null, kind: 'wall' });
let id = 5000;
addBuilding(game, 'hq', 38, 62, { id: id++ });
for (let x = 0; x < SIZE; x++) {
  const gate = x >= GATE_X0 && x <= GATE_X1;
  addBuilding(game, 'wall', x, WALL_Z, { id: id++, plotId: gate ? 2 : 1, gate });
}
game.hq = game.buildings.find((b) => b.kind === 'hq');
game.flowDirty = true;

const COUNT = 1500;
for (let i = 0; i < COUNT; i++) {
  const col = i % 48;
  const row = (i / 48) | 0;
  const type = row > 4 && i % 37 === 0 ? 'brute' : i % 9 === 0 ? 'runner' : 'walker';
  game._spawnZombie(type, 16 + col * 1.02, 8 + row * 0.92, true, true);
}

function wallMesh(w, h, d, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toyMat({ color }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
for (let x = 0; x < SIZE; x++) {
  const gate = x >= GATE_X0 && x <= GATE_X1;
  if (gate) continue;
  const seg = wallMesh(1.02, 0.92, 0.46, 0xc8bfae);
  seg.position.set(x + 0.5, 0.46, WALL_Z + 0.5);
  scene.add(seg);
  const cap = wallMesh(0.34, 0.18, 0.18, 0x8d928c);
  cap.position.set(x + 0.5, 1.0, WALL_Z + 0.72);
  scene.add(cap);
}
const gateSpan = (GATE_X1 - GATE_X0 + 1);
const gateCx = (GATE_X0 + GATE_X1 + 1) / 2;
for (const side of [-1, 1]) {
  const tower = wallMesh(1.15, 2.55, 1.15, 0xb7ad9c);
  tower.position.set(gateCx + side * (gateSpan / 2 + 0.15), 1.27, WALL_Z + 0.5);
  scene.add(tower);
  const roof = wallMesh(1.35, 0.28, 1.35, 0x5c6a78);
  roof.position.set(gateCx + side * (gateSpan / 2 + 0.15), 2.66, WALL_Z + 0.5);
  scene.add(roof);
}
const lintel = wallMesh(gateSpan + 0.2, 0.42, 0.7, 0xb7ad9c);
lintel.position.set(gateCx, 2.15, WALL_Z + 0.5);
scene.add(lintel);
const doorL = wallMesh(gateSpan * 0.46, 1.7, 0.18, 0x6a5344);
doorL.position.set(gateCx - gateSpan * 0.24, 0.85, WALL_Z + 0.5);
scene.add(doorL);
const doorR = wallMesh(gateSpan * 0.46, 1.7, 0.18, 0x5c4638);
doorR.position.set(gateCx + gateSpan * 0.24, 0.85, WALL_Z + 0.5);
scene.add(doorR);
const keep = wallMesh(3.2, 2.3, 3.2, 0xd9d2c2);
keep.position.set(39.5, 1.15, 63.5);
scene.add(keep);

const horde = new HordeArt(scene, 4000);
const shown = new Map();
const color = new THREE.Color();
const clock = { t: 0, frame: 0, maxLayer: 0, bestFrame: 0, simMs: [], renderMs: [] };

function ease(a, b, u) {
  const s = u * u * (3 - 2 * u);
  return a + (b - a) * s;
}

function placeCamera(seconds) {
  let x, y, z, lx, ly, lz;
  if (seconds < 8) {
    const u = seconds / 8;
    x = ease(22, 30, u); y = ease(18, 12, u); z = ease(2, 16, u);
    lx = 40; ly = ease(0.6, 1.4, u); lz = ease(30, 40, u);
  } else if (seconds < 17) {
    const u = (seconds - 8) / 9;
    x = ease(30, 26, u); y = ease(12, 7.5, u); z = ease(16, 34, u);
    lx = ease(40, gateCx, u); ly = ease(1.4, 2.6, u); lz = ease(40, WALL_Z + 0.4, u);
  } else {
    const u = (seconds - 17) / 8;
    x = ease(26, 52, u); y = ease(7.5, 6.4, u); z = ease(34, 36, u);
    lx = gateCx; ly = 2.5; lz = WALL_Z + 0.2;
  }
  camera.position.set(x, y, z);
  camera.lookAt(lx, ly, lz);
  sun.position.set(x + 12, 26, z - 6);
  sun.target.position.set(gateCx, 1, WALL_Z);
  sun.target.updateMatrixWorld();
}

function drawHorde(limit = Infinity) {
  const t = clock.t;
  horde.begin();
  const n = Math.min(game.zombies.length, limit, 4000);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const zb = game.zombies[i];
    if (zb.dead) continue;
    const layer = zb.vaultT > 0 ? (zb.vaultLayer || zb.layer || 0) : (zb.layer || 0);
    if (layer > top) top = layer;
    let pileY = layer * HORDE_PILE.step;
    if (zb.vaultT > 0) {
      const u = 1 - zb.vaultT / HORDE_PILE.vaultDur;
      pileY += Math.sin(Math.max(0, Math.min(1, u)) * Math.PI) * 0.35;
    }
    const prev = shown.get(zb.id);
    const y = prev == null ? pileY : prev + (pileY - prev) * 0.45;
    shown.set(zb.id, y);
    const yaw = Math.atan2(zb.dirX, zb.dirZ);
    const climb = layer > 0 || zb.vaultT > 0;
    color.setRGB(1, 1, 1);
    const far = (zb.x - camera.position.x) ** 2 + (zb.z - camera.position.z) ** 2 > 42 * 42;
    horde.write(
      zb.type, zb.x, y, zb.z,
      climb ? 0.62 : 0.16, yaw, 0,
      zb.def.scale, zb.def.scale, zb.def.scale,
      t, zb.phase || 0, 0, color, 0xff4636, !far,
    );
  }
  horde.commit();
  return top;
}

function step() {
  const t0 = performance.now();
  game.update(SIM_DT);
  if (game.events.length > 40) game.events.length = 0;
  const simMs = performance.now() - t0;
  clock.t += SIM_DT;
  clock.frame++;
  placeCamera(clock.t);
  const t1 = performance.now();
  const top = drawHorde();
  renderer.render(scene, camera);
  const renderMs = performance.now() - t1;
  if (top > clock.maxLayer) { clock.maxLayer = top; clock.bestFrame = clock.frame; }
  clock.simMs.push(simMs);
  clock.renderMs.push(renderMs);
  return { frame: clock.frame, simMs, renderMs, layer: top, alive: game.zombies.filter((z) => !z.dead).length };
}

// One timed pair: the old 1,700 instance budget, then the full mound.
function benchDraw() {
  placeCamera(18);
  const old0 = performance.now();
  drawHorde(1700);
  renderer.render(scene, camera);
  const oldMs = performance.now() - old0;
  const full0 = performance.now();
  drawHorde();
  renderer.render(scene, camera);
  const fullMs = performance.now() - full0;
  return { oldMs, fullMs, alive: game.zombies.filter((z) => !z.dead).length, layer: clock.maxLayer };
}

window.__step = step;
window.__benchDraw = benchDraw;
window.__clock = clock;
window.__ready = true;
