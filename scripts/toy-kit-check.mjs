// Toy-kit integrity: every asset each built culture lists exists as a GLB
// with vertex colours and the named parts the renderer animates, and each
// culture authors its own base and army (not a re-tint of another).
// Regenerate with: blender --background --python tools/art/toy_kit/build.py
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CULTURES, CULTURE_ORDER, DEFAULT_CULTURE, SHARED_KIT, kitBuildingKey } from '../src/cultures.js';
import { CULTURE_ARMIES } from '../src/config.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
assert.equal(CULTURES[DEFAULT_CULTURE].status, 'built', 'default culture must be built');
assert.deepEqual(Object.keys(CULTURES), ['european', 'asian', 'south_american', 'middle_eastern'], 'four cultures registered');
assert.deepEqual(CULTURE_ORDER, Object.keys(CULTURES), 'culture order matches the registry');
assert.deepEqual(Object.keys(CULTURE_ARMIES), Object.keys(CULTURES), 'every culture has an army (config.js)');

function readGlb(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('utf8', 0, 4), 'glTF', `${file} is not a GLB`);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}
const need = (name) => {
  if (/^(tower|outpost)_t/.test(name)) return ['part_turret'];
  if (/^(mill|mine)_t/.test(name)) return ['part_rotor'];
  if (name === 'castle_t4') return ['part_core'];
  if (/^(unit|hero)_[a-z]+$/.test(name) && !name.startsWith('hero_forge')) return ['arm_l', 'arm_r'];
  if (/^unit_/.test(name)) return ['leg_l', 'leg_r'];
  if (/^enemy_/.test(name)) return ['body', 'arms', 'eyes'];
  if (/^prop_tree/.test(name)) return ['trunk', 'canopy'];
  if (/^prop_/.test(name)) return ['rock'];
  return [];
};
const own = {};
const report = [];
for (const c of Object.values(CULTURES)) {
  assert.equal(c.status, 'built', `${c.key} is not built`);
  const dir = path.join(root, c.kitPath);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.culture, c.key, `${c.key}: manifest is for ${manifest.culture}`);
  assert.deepEqual([...manifest.assets].sort(), [...c.assets].sort(), `${c.key}: kit manifest and cultures.js asset list differ — rebuild the kit`);
  let tris = 0;
  for (const name of c.assets) {
    const j = readGlb(path.join(dir, `${name}.glb`));
    const nodes = new Set(j.nodes.map((n) => n.name));
    for (const part of need(name)) assert.ok(nodes.has(part), `${name}: missing part ${part}`);
    if (/^unit_/.test(name)) for (const p of ['leg_l', 'leg_r']) assert.ok(nodes.has(p), `${name}: missing ${p}`);
    for (const m of j.meshes) for (const p of m.primitives) {
      assert.ok(p.attributes.COLOR_0 !== undefined, `${name}: mesh ${m.name} has no vertex colours`);
      tris += j.accessors[p.attributes.POSITION].count / 3;
    }
    for (const mat of j.materials || []) assert.ok(['toy', 'glow'].includes(mat.name), `${name}: unexpected material ${mat.name}`);
  }
  // Every plot kind/tier the sim can reach resolves to a kit piece (walls stay procedural).
  const tiers = { hq: 4, house: 4, farm: 3, mill: 3, mine: 3, tower: 4, camp_militia: 3, camp_ranger: 3, camp_sniper: 3, outpost: 4, workshop: 3, hero_forge: 3 };
  for (const [kind, max] of Object.entries(tiers)) {
    for (let t = 1; t <= max; t++) {
      const key = kitBuildingKey(kind, t, c);
      assert.ok(key && c.assets.includes(key), `${kind} T${t} has no kit model`);
    }
  }
  own[c.key] = Object.fromEntries(['castle_t4', 'tower_t2', 'house_t2', 'gate_t2', 'wall_t2_seg', 'unit_soldier', 'unit_ranger', 'unit_sniper', 'camp_militia_t2']
    .map((n) => [n, fs.readFileSync(path.join(dir, `${n}.glb`)).length]));
  report.push(`${c.key} ${c.assets.length} assets ~${Math.round(tris / 1000)}k tris`);
}
// Each culture's signature pieces are its own geometry, not a re-tint.
for (const a of Object.keys(own)) for (const b of Object.keys(own)) {
  if (a >= b) continue;
  for (const n of Object.keys(own[a])) assert.notEqual(own[a][n], own[b][n], `${a} and ${b} share the same ${n} — author a culture piece`);
}
assert.ok(SHARED_KIT.has('hero_danny') && !SHARED_KIT.has('castle_t1'), 'shared kit is heroes/horde/props only');
// The seven named heroes share one chibi figurine each, always from the
// European kit. A missing or cloned model drops that hero back to the old rig.
const HERO_FIGURINES = ['hero_scott', 'hero_alexander', 'hero_danny', 'hero_turtle', 'hero_john', 'hero_tiger', 'hero_aaron'];
const euroDir = path.join(root, CULTURES[DEFAULT_CULTURE].kitPath);
const heroHashes = HERO_FIGURINES.map((name) => {
  assert.ok(CULTURES[DEFAULT_CULTURE].assets.includes(name), `${name} missing from the shared kit`);
  assert.ok(SHARED_KIT.has(name), `${name} must stay on the shared European kit`);
  const file = path.join(euroDir, `${name}.glb`);
  const buf = fs.readFileSync(file);
  const json = readGlb(file);
  const nodes = new Set(json.nodes.map((n) => n.name));
  for (const part of ['arm_l', 'arm_r', 'body']) assert.ok(nodes.has(part), `${name} missing ${part}`);
  return buf.toString('hex');
});
assert.equal(new Set(heroHashes).size, HERO_FIGURINES.length, 'each hero figurine must be its own model');
console.log(`toy-kit-check: ${report.join(', ')}, ok`);
