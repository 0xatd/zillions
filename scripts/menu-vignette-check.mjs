// Menu attract-show check: runs the MenuVignette director headless against a
// real generated landform (menu-size, like showMenuBackdrop builds) and
// asserts the loop actually loops — squads arrive, get overwhelmed, die, the
// lamp goes dark, and the next squad arrives somewhere else. Also asserts the
// show stays inside the shared instanced-pool budget and cleans up after
// itself, since it writes into the same pools the live game uses.
import assert from 'node:assert/strict';
import { TerrainField } from '../src/terrain.js';
import { MenuVignette } from '../src/menu-vignette.js';
import { LEVELS } from '../src/config.js';

const DT = 1 / 30;
const SIM_SECONDS = 300;

function stubInstanced() {
  return {
    count: 0,
    writes: 0,
    instanceMatrix: { needsUpdate: false },
    instanceColor: null,
    setMatrixAt() { this.writes++; },
    setColorAt() {},
  };
}

function stubVec() {
  return {
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
  };
}

function stubUnitMesh() {
  return {
    position: stubVec(),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { setScalar() {} },
    userData: {
      body: { position: stubVec(), rotation: { x: 0, y: 0, z: 0 } },
    },
  };
}

const level = LEVELS[0];
const map = new TerrainField(level.seed, level.theme); // menu backdrop size
const sceneObjects = new Set();
const scene = {
  add: (o) => sceneObjects.add(o),
  remove: (o) => sceneObjects.delete(o),
};
const zm = { body: stubInstanced(), head: stubInstanced(), arm: stubInstanced(), eyes: stubInstanced() };
let meshesMade = 0;
let disposed = 0;
let corpses = 0;
let fxCalls = 0;

const show = new MenuVignette({
  scene,
  map,
  makeUnitMesh: () => { meshesMade++; return stubUnitMesh(); },
  zombieMeshes: zm,
  burst: () => { fxCalls++; },
  stream: () => { fxCalls++; },
  addCorpse: () => { corpses++; },
  dispose3D: () => { disposed++; },
  light: { position: stubVec(), intensity: 0 },
  dummy: {
    position: stubVec(),
    rotation: { set() {} },
    scale: { set() {} },
    matrix: {},
    updateMatrix() {},
  },
  color: { setHex() { return this; }, setRGB() { return this; }, multiplyScalar() { return this; } },
  project: () => ({ x: 0, y: 0 }), // every stage counts as on-screen
});

let vignettesStarted = 0;
let vignettesEnded = 0;
let sawLitLamp = false;
let sawDarkAfterLight = false;
let peakMob = 0;
let lastPhase = show.phase;

const ticks = Math.round(SIM_SECONDS / DT);
for (let i = 0; i < ticks; i++) {
  const t = i * DT;
  show.update(DT, t);
  if (lastPhase === 'dark' && show.phase === 'run') vignettesStarted++;
  if (lastPhase === 'run' && show.phase === 'dark') vignettesEnded++;
  lastPhase = show.phase;
  peakMob = Math.max(peakMob, show.zombies.length);
  if (show.light.intensity > 1.5) sawLitLamp = true;
  if (sawLitLamp && show.phase === 'dark' && show.light.intensity < 0.2) sawDarkAfterLight = true;
  assert.ok(show.zombies.length <= 150, `mob exceeded its cap: ${show.zombies.length}`);
  assert.ok(zm.body.count <= 150, `instanced count exceeded the menu cap: ${zm.body.count}`);
}

assert.ok(vignettesStarted >= 2, `expected at least 2 vignettes in ${SIM_SECONDS}s, saw ${vignettesStarted}`);
assert.ok(vignettesEnded >= 2, `expected at least 2 squads to fall in ${SIM_SECONDS}s, saw ${vignettesEnded}`);
assert.ok(meshesMade >= 2, `expected real trooper meshes to be minted, saw ${meshesMade}`);
assert.ok(peakMob >= 30, `expected a real horde, peaked at ${peakMob}`);
assert.ok(corpses > 10, `expected the squad to drop zombies before falling, saw ${corpses} corpses`);
assert.ok(fxCalls > 50, `expected muzzle/tracer FX during the stand, saw ${fxCalls}`);
assert.ok(sawLitLamp, 'the squad lamp never came up');
assert.ok(sawDarkAfterLight, 'the lamp never guttered back to dark after a last stand');

// The show borrows the game's shared pools — teardown must hand them back
// empty, and every minted trooper mesh must be disposed.
show.dispose();
assert.equal(zm.body.count, 0, 'zombie pool not returned to 0 on dispose');
assert.equal(show.troopers.length, 0, 'troopers not cleared on dispose');
assert.equal(disposed, meshesMade, `minted ${meshesMade} trooper meshes but disposed ${disposed}`);
assert.ok(!sceneObjects.has(show.light), 'squad lamp left in the scene on dispose');

console.log(`menu vignette check passed: ${vignettesEnded} last stands over ${SIM_SECONDS}s, peak mob ${peakMob}, ${corpses} corpses`);
