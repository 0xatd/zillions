import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'assets', 'art-slice');

const specs = {
  hero_scott: { maxTriangles: 8000, maxMaterials: 4, nodes: ['asset_root', 'body', 'weapon', 'socket_muzzle', 'leg_l', 'leg_r'] },
  human_rifleman: { maxTriangles: 4000, maxMaterials: 4, nodes: ['asset_root', 'body', 'weapon', 'socket_muzzle', 'leg_l', 'leg_r'] },
  hive_drone: { maxTriangles: 3500, maxMaterials: 3, nodes: ['asset_root', 'body', 'weak_point', 'socket_ability'] },
  human_mine: { maxTriangles: 8000, maxMaterials: 4, nodes: ['asset_root', 'part_rotor'] },
  human_wall: { maxTriangles: 2500, maxMaterials: 3, nodes: ['asset_root'] },
  human_gate: { maxTriangles: 2500, maxMaterials: 4, nodes: ['asset_root'] },
};
for (const family of ['hq', 'tower', 'barracks']) {
  for (let tier = 1; tier <= 3; tier++) {
    specs[`human_${family}_t${tier}`] = {
      maxTriangles: family === 'hq' ? 18000 : 8000,
      maxMaterials: family === 'hq' ? 5 : 4,
      nodes: ['asset_root'],
    };
  }
}

function readGlb(file) {
  const data = fs.readFileSync(file);
  if (data.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${file}: invalid GLB magic`);
  if (data.readUInt32LE(4) !== 2) throw new Error(`${file}: GLB version must be 2`);
  if (data.readUInt32LE(8) !== data.length) throw new Error(`${file}: declared length does not match file`);
  const jsonLength = data.readUInt32LE(12);
  const jsonType = data.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error(`${file}: first chunk is not JSON`);
  return { json: JSON.parse(data.toString('utf8', 20, 20 + jsonLength)), bytes: data.length };
}

function triangleCount(json) {
  let total = 0;
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      const mode = primitive.mode ?? 4;
      if (mode !== 4) throw new Error(`unsupported primitive mode ${mode}`);
      const accessor = json.accessors?.[primitive.indices ?? primitive.attributes?.POSITION];
      total += Math.floor((accessor?.count || 0) / 3);
    }
  }
  return total;
}

let totalBytes = 0;
for (const [name, spec] of Object.entries(specs)) {
  const file = path.join(DIR, `${name}.glb`);
  if (!fs.existsSync(file)) throw new Error(`missing ${path.relative(ROOT, file)}`);
  const { json, bytes } = readGlb(file);
  const triangles = triangleCount(json);
  const materials = (json.materials || []).length;
  const nodes = new Set((json.nodes || []).map((node) => node.name));
  if (triangles > spec.maxTriangles) throw new Error(`${name}: ${triangles} triangles exceeds ${spec.maxTriangles}`);
  if (materials > spec.maxMaterials) throw new Error(`${name}: ${materials} materials exceeds ${spec.maxMaterials}`);
  for (const node of spec.nodes) if (!nodes.has(node)) throw new Error(`${name}: missing node ${node}`);
  if ((json.cameras || []).length) throw new Error(`${name}: cameras are not permitted`);
  if ((json.extensionsUsed || []).includes('KHR_lights_punctual')) throw new Error(`${name}: lights are not permitted`);
  totalBytes += bytes;
  console.log(`${name}: ${triangles} triangles, ${materials} materials, ${(bytes / 1024).toFixed(1)} KiB`);
}

if (totalBytes > 8 * 1024 * 1024) throw new Error(`art slice exceeds 8 MiB (${totalBytes} bytes)`);
console.log(`art asset check passed: ${Object.keys(specs).length} GLBs, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);
