// The seven heroes ship with the six presentation clips, and each zombie
// type ships a vertex clip the instanced horde can play. Presentation only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const heroes = ['scott', 'alexander', 'danny', 'turtle', 'john', 'tiger', 'aaron'];
const zombies = ['walker', 'runner', 'brute', 'spitter', 'burrower', 'sieger', 'caller'];
const clips = ['idle', 'run', 'attack', 'ability', 'hit', 'death'];

function readGlb(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('utf8', 0, 4), 'glTF', `${file} is not a GLB`);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}

for (const key of heroes) {
  const file = path.join(root, 'assets/characters/heroes', `hero_${key}.glb`);
  const json = readGlb(file);
  const names = new Set((json.animations || []).map((a) => a.name));
  for (const clip of clips) assert.ok(names.has(clip), `${key} missing clip ${clip}`);
  assert.ok((json.skins || []).length >= 1, `${key} has no skin`);
  const bytes = fs.statSync(file).size;
  assert.ok(bytes < 4_000_000, `${key} glb is ${bytes} bytes`);
}

for (const key of zombies) {
  const file = path.join(root, 'assets/characters/zombies', `zombie_${key}.vat.bin`);
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('utf8', 0, 4), 'ZV02', `${key} vat header`);
  const verts = buf.readUInt32LE(4);
  const frames = buf.readUInt32LE(8);
  const nclips = buf.readUInt32LE(12);
  assert.ok(verts > 200 && verts < 4000, `${key} has ${verts} verts`);
  assert.equal(frames, 36, `${key} frame count`);
  assert.equal(nclips, 4, `${key} clip count`);
}

const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const anim = fs.readFileSync(path.join(root, 'src/character-anim.js'), 'utf8');
assert.ok(main.includes('g.scale.setScalar(0.82)'), 'hero group scale must stay 0.82');
assert.ok(!main.includes('kit.node.scale.multiplyScalar(1.25)'), 'hero kit must not be scaled up past 0.82');
assert.ok(main.includes('zb.def.scale * ZOMBIE_VISUAL'), 'zombie draw scale stays a visual multiplier');
assert.ok(anim.includes('export const ZOMBIE_VISUAL'), 'zombie visual scale is presentation-only');
const game = fs.readFileSync(path.join(root, 'src/game.js'), 'utf8');
assert.ok(!game.includes('ZOMBIE_VISUAL'), 'simulation must not read the visual zombie scale');
console.log('character-anim-check: 7 heroes, 7 zombie clips, scale 0.82');
