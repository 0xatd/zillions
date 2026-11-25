// Merge static, opaque, non-instanced meshes that already share one material
// into a single mesh. Kit geometry is left alone: it is shared with templates
// and must not be baked away. Presentation only.
import * as THREE from 'three';

function signature(geometry) {
  const names = [];
  for (const name of ['position', 'normal', 'color', 'uv']) {
    if (geometry.getAttribute(name)) names.push(name);
  }
  return names.join(',');
}

function mergeParts(parts) {
  const geos = parts.map((mesh) => {
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const baked = source.clone();
    mesh.updateWorldMatrix(true, false);
    baked.applyMatrix4(mesh.matrixWorld);
    if (source !== mesh.geometry) source.dispose();
    return baked;
  });
  const names = signature(geos[0]).split(',').filter(Boolean);
  let count = 0;
  for (const geo of geos) count += geo.getAttribute('position').count;
  const merged = new THREE.BufferGeometry();
  for (const name of names) {
    const itemSize = geos[0].getAttribute(name).itemSize;
    const array = new Float32Array(count * itemSize);
    let offset = 0;
    for (const geo of geos) {
      const attr = geo.getAttribute(name);
      array.set(attr.array, offset);
      offset += attr.array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  for (const geo of geos) geo.dispose();
  return merged;
}

export function mergeStaticMeshes(root) {
  if (!root) return 0;
  const buckets = new Map();
  const meshes = [];
  const geometryUsers = new Map();
  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    if (!node.isMesh || node.isInstancedMesh) return;
    if (node.userData.noMerge || node.userData.ink) return;
    if (node.children?.some((child) => child.isMesh)) return;
    const material = node.material;
    if (!material || Array.isArray(material) || material.transparent) return;
    if (!node.geometry || node.geometry.userData?.kitShared) return;
    geometryUsers.set(node.geometry.uuid, (geometryUsers.get(node.geometry.uuid) || 0) + 1);
    meshes.push(node);
  });
  for (const mesh of meshes) {
    if (geometryUsers.get(mesh.geometry.uuid) !== 1) continue;
    const key = `${signature(mesh.geometry)}|${materialId(mesh.material)}`;
    const bucket = buckets.get(key) || { material: mesh.material, meshes: [] };
    bucket.meshes.push(mesh);
    buckets.set(key, bucket);
  }
  let merged = 0;
  for (const bucket of buckets.values()) {
    if (bucket.meshes.length < 2) continue;
    const geometry = mergeParts(bucket.meshes);
    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.name = 'merged-static';
    mesh.castShadow = bucket.meshes.some((item) => item.castShadow);
    mesh.receiveShadow = bucket.meshes.some((item) => item.receiveShadow);
    mesh.frustumCulled = true;
    root.add(mesh);
    for (const old of bucket.meshes) {
      old.removeFromParent();
      old.geometry.dispose();
    }
    merged += bucket.meshes.length;
  }
  return merged;
}

function materialId(material) {
  return material.uuid;
}

export function bridgeInstances(geometry, material, placements, { castShadow = false, receiveShadow = false, name = 'bridge' } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.frustumCulled = true;
  const dummy = new THREE.Object3D();
  placements.forEach((place, index) => {
    dummy.position.set(place.x, place.y, place.z);
    dummy.rotation.set(place.rx || 0, place.ry || 0, place.rz || 0);
    dummy.scale.set(place.sx || 1, place.sy || 1, place.sz || 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.count = placements.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
