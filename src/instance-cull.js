// Per-instance frustum (and optional distance) cull for static instanced
// props. The mesh's own bounding sphere covers the whole map, so Three.js
// never rejects it. Compacting the instance buffer each frame keeps off-screen
// trees and rocks out of the vertex work without changing what is on screen.
// Presentation only.
import * as THREE from 'three';

const _sphere = new THREE.Sphere();

export function rememberInstances(mesh) {
  if (!mesh?.isInstancedMesh || mesh.userData.fullMatrices) return;
  mesh.userData.fullMatrices = new Float32Array(mesh.instanceMatrix.array);
  mesh.userData.fullCount = mesh.count;
  if (mesh.instanceColor) mesh.userData.fullColors = new Float32Array(mesh.instanceColor.array);
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  mesh.userData.baseRadius = mesh.geometry.boundingSphere?.radius || 1;
  mesh.frustumCulled = false;
}

export function cullInstances(mesh, frustum, { maxDistance = 0, focusX = 0, focusZ = 0, pad = 0 } = {}) {
  const full = mesh.userData.fullMatrices;
  if (!full || !frustum) return;
  const colors = mesh.userData.fullColors;
  const dst = mesh.instanceMatrix.array;
  const colorDst = mesh.instanceColor?.array;
  const base = (mesh.userData.baseRadius || 1) + pad;
  const total = mesh.userData.fullCount;
  const limitSq = maxDistance > 0 ? maxDistance * maxDistance : 0;
  let n = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 16;
    const x = full[o + 12];
    const y = full[o + 13];
    const z = full[o + 14];
    const sx = Math.hypot(full[o], full[o + 1], full[o + 2]);
    const sy = Math.hypot(full[o + 4], full[o + 5], full[o + 6]);
    const sz = Math.hypot(full[o + 8], full[o + 9], full[o + 10]);
    const radius = base * Math.max(sx, sy, sz, 0.001);
    if (limitSq) {
      const dx = x - focusX;
      const dz = z - focusZ;
      const reach = maxDistance + radius;
      if (dx * dx + dz * dz > reach * reach) continue;
    }
    _sphere.center.set(x, y, z);
    _sphere.radius = radius;
    if (!frustum.intersectsSphere(_sphere)) continue;
    dst.set(full.subarray(o, o + 16), n * 16);
    if (colors && colorDst) colorDst.set(colors.subarray(i * 3, i * 3 + 3), n * 3);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = n > 0;
  if (n > 0 && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
