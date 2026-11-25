// One instanced stand-in for units far from the camera focus. A short box
// keeps the toy silhouette without the horde's merged capsules or a troop's
// skinned mesh. Presentation only.
import * as THREE from 'three';

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export class UnitImpostors {
  constructor(scene, max) {
    const geo = new THREE.BoxGeometry(0.46, 0.92, 0.3);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.name = 'unit-impostors';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.max = max;
    this.cursor = 0;
  }

  begin() { this.cursor = 0; }

  write(x, y, z, yaw, sx, sy, sz, color) {
    const i = this.cursor;
    if (i >= this.max) return;
    this.cursor = i + 1;
    _dummy.position.set(x, y, z);
    _dummy.rotation.set(0, yaw, 0);
    _dummy.scale.set(sx, sy, sz);
    _dummy.updateMatrix();
    this.mesh.setMatrixAt(i, _dummy.matrix);
    _color.set(color);
    this.mesh.setColorAt(i, _color);
  }

  commit() {
    this.mesh.count = this.cursor;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

const _proj = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

export function cameraFrustum(camera, frustum) {
  _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(_proj);
  return frustum;
}

export function sphereVisible(frustum, x, y, z, radius) {
  _sphere.center.set(x, y, z);
  _sphere.radius = radius;
  return frustum.intersectsSphere(_sphere);
}
