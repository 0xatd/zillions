// Bake the Kenney FBX exports in /tmp/packs/glb into ground-centered GLBs.
// Official zips are not committed. Run only when those exports are present.
// Castle-scale meshes (footprint >= 15) are normalized to a 1-unit footprint.
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || '/tmp/packs/glb';
const DST = path.resolve(import.meta.dirname, '..', 'assets', 'props', 'kenney');

function readGlb(file) {
  const data = fs.readFileSync(file);
  if (data.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${file}: not a GLB`);
  const jsonLen = data.readUInt32LE(12);
  const json = JSON.parse(data.toString('utf8', 20, 20 + jsonLen));
  const binStart = 20 + jsonLen;
  const binLen = data.readUInt32LE(binStart);
  return { json, bin: data.subarray(binStart + 8, binStart + 8 + binLen) };
}

function accessor(json, bin, index) {
  const a = json.accessors[index];
  const bv = json.bufferViews[a.bufferView];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const stride = bv.byteStride || comps * 4;
  const out = [];
  for (let n = 0; n < a.count; n++) {
    const o = start + n * stride;
    const v = [];
    for (let c = 0; c < comps; c++) {
      if (a.componentType === 5126) v.push(bin.readFloatLE(o + c * 4));
      else if (a.componentType === 5123) v.push(bin.readUInt16LE(o + c * 2));
      else if (a.componentType === 5125) v.push(bin.readUInt32LE(o + c * 4));
      else throw new Error(`component ${a.componentType}`);
    }
    out.push(comps === 1 ? v[0] : v);
  }
  return out;
}

function mulPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function mulDir(m, x, y, z) {
  const o = [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
  const L = Math.hypot(o[0], o[1], o[2]) || 1;
  return [o[0] / L, o[1] / L, o[2] / L];
}

function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation || [0, 0, 0];
  const s = n.scale || [1, 1, 1];
  const q = n.rotation || [0, 0, 0, 1];
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function mulMat(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function roleOf(name) {
  const n = (name || '').toLowerCase();
  if (/leaf|grass|plant|foliage/.test(n)) return 'foliage';
  if (/wood|bark|log/.test(n)) return 'wood';
  if (/stone|dirt|rock|cliff/.test(n)) return 'stone';
  if (/yellow|red|blue|orange|pink|gold/.test(n)) return 'accent';
  return 'body';
}

function collect(file) {
  const { json, bin } = readGlb(file);
  const roles = new Map();
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const walk = (idx, parent) => {
    const n = json.nodes[idx];
    const world = mulMat(parent, nodeMatrix(n));
    if (n.mesh != null) {
      const mesh = json.meshes[n.mesh];
      for (const prim of mesh.primitives) {
        const matName = json.materials?.[prim.material]?.name || '';
        const role = roleOf(matName);
        const pos = accessor(json, bin, prim.attributes.POSITION);
        const nrm = prim.attributes.NORMAL != null ? accessor(json, bin, prim.attributes.NORMAL) : null;
        let indices = prim.indices != null ? accessor(json, bin, prim.indices) : pos.map((_, i) => i);
        const bucket = roles.get(role) || { pos: [], nrm: [], idx: [] };
        const base = bucket.pos.length / 3;
        for (const v of pos) {
          const p = mulPoint(world, v[0], v[1], v[2]);
          bucket.pos.push(p[0], p[1], p[2]);
        }
        if (nrm) {
          for (const v of nrm) {
            const d = mulDir(world, v[0], v[1], v[2]);
            bucket.nrm.push(d[0], d[1], d[2]);
          }
        } else {
          for (let i = 0; i < pos.length; i++) bucket.nrm.push(0, 1, 0);
        }
        for (const i of indices) bucket.idx.push(base + i);
        roles.set(role, bucket);
      }
    }
    for (const c of n.children || []) walk(c, world);
  };
  for (const i of json.scenes?.[0]?.nodes || []) walk(i, I);
  return roles;
}

function boundsOf(roles) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const bucket of roles.values()) {
    for (let i = 0; i < bucket.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], bucket.pos[i + k]);
        max[k] = Math.max(max[k], bucket.pos[i + k]);
      }
    }
  }
  return { min, max };
}

function transformRoles(roles, fn) {
  for (const bucket of roles.values()) {
    for (let i = 0; i < bucket.pos.length; i += 3) {
      const p = fn(bucket.pos[i], bucket.pos[i + 1], bucket.pos[i + 2]);
      bucket.pos[i] = p[0]; bucket.pos[i + 1] = p[1]; bucket.pos[i + 2] = p[2];
    }
  }
}

function writeGlb(file, roles) {
  const chunks = [];
  let byte = 0;
  const buffer = [];
  const views = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];
  const materials = [{ name: 'flat', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }];
  const align = (n) => { while (byte % n) { buffer.push(0); byte++; } };
  for (const [role, bucket] of roles) {
    align(4);
    const posOff = byte;
    const pos = Float32Array.from(bucket.pos);
    buffer.push(...Buffer.from(pos.buffer));
    byte += pos.byteLength;
    const posView = views.length;
    views.push({ buffer: 0, byteOffset: posOff, byteLength: pos.byteLength });
    const posAcc = accessors.length;
    let pmin = [Infinity, Infinity, Infinity], pmax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < bucket.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        pmin[k] = Math.min(pmin[k], bucket.pos[i + k]);
        pmax[k] = Math.max(pmax[k], bucket.pos[i + k]);
      }
    }
    accessors.push({ bufferView: posView, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: pmin, max: pmax });
    align(4);
    const nrmOff = byte;
    const nrm = Float32Array.from(bucket.nrm);
    buffer.push(...Buffer.from(nrm.buffer));
    byte += nrm.byteLength;
    const nrmView = views.length;
    views.push({ buffer: 0, byteOffset: nrmOff, byteLength: nrm.byteLength });
    const nrmAcc = accessors.length;
    accessors.push({ bufferView: nrmView, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
    align(4);
    const idxOff = byte;
    const use32 = bucket.pos.length / 3 > 65535;
    const idx = use32 ? Uint32Array.from(bucket.idx) : Uint16Array.from(bucket.idx);
    buffer.push(...Buffer.from(idx.buffer));
    byte += idx.byteLength;
    const idxView = views.length;
    views.push({ buffer: 0, byteOffset: idxOff, byteLength: idx.byteLength });
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxView, componentType: use32 ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
    meshes.push({ name: role, primitives: [{ attributes: { POSITION: posAcc, NORMAL: nrmAcc }, indices: idxAcc, material: 0 }] });
    nodes.push({ name: role, mesh: meshes.length - 1 });
  }
  align(4);
  const json = {
    asset: { version: '2.0', generator: 'bake-kenney-props' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials,
    buffers: [{ byteLength: byte }],
    bufferViews: views,
    accessors,
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  while (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.from(' ')]);
  const bin = Buffer.from(buffer);
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(out, 20);
  const binChunk = 20 + jsonBuf.length;
  out.writeUInt32LE(bin.length, binChunk);
  out.writeUInt32LE(0x004e4942, binChunk + 4);
  bin.copy(out, binChunk + 8);
  fs.writeFileSync(file, out);
}

fs.mkdirSync(DST, { recursive: true });
const names = fs.readdirSync(SRC).filter((f) => f.endsWith('.glb')).sort();
for (const name of names) {
  const roles = collect(path.join(SRC, name));
  if (!roles.size) throw new Error(`${name}: empty`);
  const box = boundsOf(roles);
  const cx = (box.min[0] + box.max[0]) / 2;
  const cz = (box.min[2] + box.max[2]) / 2;
  const span = Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]) || 1;
  const scale = span >= 15 ? 1 / span : 1;
  transformRoles(roles, (x, y, z) => [(x - cx) * scale, (y - box.min[1]) * scale, (z - cz) * scale]);
  const out = path.join(DST, name);
  writeGlb(out, roles);
  const after = boundsOf(roles);
  const h = (after.max[1] - after.min[1]).toFixed(2);
  const w = Math.max(after.max[0] - after.min[0], after.max[2] - after.min[2]).toFixed(2);
  console.log(`${name} roles=${[...roles.keys()].join('+')} h=${h} span=${w} bytes=${fs.statSync(out).size}`);
}
