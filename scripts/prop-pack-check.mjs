// The committed Kenney props are CC0, untextured, and small enough to instance.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'assets', 'props', 'kenney');
const LICENSE = fs.readFileSync(path.join(ROOT, 'assets', 'props', 'LICENSES.md'), 'utf8');

const required = [
  'tree_cone.glb', 'tree_fat.glb', 'plant_bush.glb', 'rock_largeA.glb', 'rock_smallA.glb',
  'cliff_block_stone.glb', 'cliff_large_stone.glb', 'grass.glb', 'flower_yellowA.glb',
  'fence_simple.glb', 'log_stack.glb', 'wall.glb', 'gate.glb', 'tower-square.glb',
  'tower-square-base.glb', 'tower-square-top-roof.glb', 'tower-hexagon-roof.glb',
  'flag-banner-short.glb',
];

if (!/CC0/.test(LICENSE)) throw new Error('LICENSES.md must name CC0');
if (!/kenney\.nl\/assets\/nature-kit/.test(LICENSE)) throw new Error('LICENSES.md must link the Nature Kit');
if (!/kenney\.nl\/assets\/castle-kit/.test(LICENSE)) throw new Error('LICENSES.md must link the Castle Kit');
if (!/Kenney/.test(LICENSE)) throw new Error('LICENSES.md must name Kenney');

function readGlb(file) {
  const data = fs.readFileSync(file);
  if (data.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${file}: invalid GLB`);
  const jsonLen = data.readUInt32LE(12);
  const json = JSON.parse(data.toString('utf8', 20, 20 + jsonLen));
  return { json, bytes: data.length };
}

const onDisk = fs.readdirSync(DIR).filter((n) => n.endsWith('.glb'));
let bytes = 0;
for (const name of onDisk) {
  const { json, bytes: n } = readGlb(path.join(DIR, name));
  if ((json.images || []).length || (json.textures || []).length) throw new Error(`${name}: textures are not allowed`);
  if (!(json.meshes || []).length) throw new Error(`${name}: no mesh`);
  const roles = new Set((json.nodes || []).map((node) => node.name));
  if (!roles.size) throw new Error(`${name}: no nodes`);
  bytes += n;
}
for (const name of required) {
  if (!onDisk.includes(name)) throw new Error(`missing ${name}`);
  if (!LICENSE.includes(name)) throw new Error(`LICENSES.md does not list ${name}`);
}
if (bytes > 1024 * 1024) throw new Error(`prop pack exceeds 1 MiB (${bytes} bytes)`);
console.log(`prop pack check passed: ${onDisk.length} GLBs, ${(bytes / 1024).toFixed(1)} KiB`);
