// Toy-kit integrity: every asset the default culture lists exists as a GLB
// with vertex colours and the named parts the renderer animates.
// Regenerate with: blender --background --python tools/art/toy_kit/build.py
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CULTURES, DEFAULT_CULTURE, kitBuildingKey } from '../src/cultures.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const c = CULTURES[DEFAULT_CULTURE];
assert.equal(c.status, 'built', 'default culture must be built');
assert.deepEqual(Object.keys(CULTURES), ['european', 'asian', 'south_american', 'middle_eastern'], 'four cultures registered');
const dir = path.join(root, c.kitPath);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
assert.deepEqual([...manifest.assets].sort(), [...c.assets].sort(), 'kit manifest and cultures.js asset list differ — rebuild the kit');

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
console.log(`toy-kit-check: ${c.assets.length} assets, ~${Math.round(tris)} triangles, ok`);
