// Original low-poly props for the diorama look. Vertex colours carry the two
// tones (sun face / shade face, pale rock tops). Instance colour tints the
// canopy or the stone. Presentation only. Geometries are shared; do not dispose
// them with a mesh.
import * as THREE from 'three';

const SUN = new THREE.Vector3(-0.72, 0.42, -0.48).normalize();

function finish(geometry) {
  geometry.computeVertexNormals();
  geometry.userData.kitShared = true;
  return geometry;
}

function faceColor(normal, paleTop) {
  const sun = Math.max(0, normal.dot(SUN));
  const up = Math.max(0, normal.y);
  if (paleTop && up > 0.62) {
    const t = 0.82 + sun * 0.18;
    return [t, t * 0.98, t * 0.9];
  }
  const t = 0.34 + sun * 0.5 + up * 0.22;
  return [t, t * 0.97, t * 0.9];
}

function paint(geometry, paleTop) {
  const src = geometry.toNonIndexed();
  const pos = src.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
    else n.normalize();
    const rgb = faceColor(n, paleTop);
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = rgb[0];
      col[(i + k) * 3 + 1] = rgb[1];
      col[(i + k) * 3 + 2] = rgb[2];
    }
  }
  src.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return finish(src);
}

function cone(radius, height, y, sides) {
  const g = new THREE.ConeGeometry(radius, height, sides);
  g.translate(0, y + height / 2, 0);
  return g;
}

let pineGeo = null;
let lollipopGeo = null;
let bushGeo = null;
let trunkGeo = null;
const boulders = [];

export function makePineGeometry() {
  if (pineGeo) return pineGeo;
  const parts = [
    cone(0.62, 1.25, 0.42, 6),
    cone(0.46, 1.15, 1.15, 6),
    cone(0.28, 1.05, 1.9, 5),
  ];
  pineGeo = paint(mergeParts(parts), false);
  return pineGeo;
}

export function makeLollipopGeometry() {
  if (lollipopGeo) return lollipopGeo;
  const g = new THREE.IcosahedronGeometry(0.58, 0);
  g.scale(1, 1.22, 1);
  g.translate(0, 1.35, 0);
  lollipopGeo = paint(g, false);
  return lollipopGeo;
}

export function makeBushGeometry() {
  if (bushGeo) return bushGeo;
  const g = new THREE.IcosahedronGeometry(0.42, 0);
  g.scale(1.15, 0.62, 1.05);
  g.translate(0, 0.28, 0);
  bushGeo = paint(g, false);
  return bushGeo;
}

export function makeTrunkGeometry() {
  if (trunkGeo) return trunkGeo;
  trunkGeo = new THREE.CylinderGeometry(0.045, 0.07, 0.7, 5);
  trunkGeo.translate(0, 0.35, 0);
  trunkGeo.userData.kitShared = true;
  return trunkGeo;
}

export function makeBoulderGeometry(variant = 0) {
  if (boulders[variant]) return boulders[variant];
  const g = new THREE.DodecahedronGeometry(0.72, 0);
  const p = g.attributes.position;
  const v = variant + 1;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const h = Math.abs(Math.sin((x * 12.3 + z * 4.7) * v + y * 3.1));
    const top = y > 0.05 ? 1.12 + h * 0.18 : 0.78 + h * 0.22;
    const wide = y > 0.2 ? 1.05 : 0.92;
    p.setXYZ(i, x * wide * (0.9 + h * 0.25), y * top, z * wide * (0.88 + h * 0.2));
  }
  p.needsUpdate = true;
  boulders[variant] = paint(g, true);
  return boulders[variant];
}

function mergeParts(geometries) {
  let count = 0;
  for (const g of geometries) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const g of geometries) {
    const src = g.toNonIndexed();
    const p = src.attributes.position;
    for (let i = 0; i < p.count; i++) {
      pos[o++] = p.getX(i);
      pos[o++] = p.getY(i);
      pos[o++] = p.getZ(i);
    }
    src.dispose();
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return merged;
}
