import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/resolve-three.mjs';

const THREE = await import('three');
const { rememberInstances, cullInstances } = await import('../src/instance-cull.js');

function frustumLookingAtCanopy() {
  const camera = new THREE.PerspectiveCamera(12, 1, 0.1, 40);
  camera.position.set(0, 3, 8);
  camera.lookAt(0, 3, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

test('instance cull keeps a canopy whose bounds sit above the mesh origin', () => {
  const geo = new THREE.SphereGeometry(0.3, 6, 4);
  geo.translate(0, 3, 0);
  geo.computeBoundingSphere();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), 2);
  const dummy = new THREE.Object3D();
  dummy.updateMatrix();
  mesh.setMatrixAt(0, dummy.matrix);
  dummy.position.set(40, 0, 0);
  dummy.updateMatrix();
  mesh.setMatrixAt(1, dummy.matrix);
  mesh.count = 2;
  rememberInstances(mesh);

  const frustum = frustumLookingAtCanopy();
  const canopy = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 0.3);
  const origin = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 0.3);
  assert.equal(frustum.intersectsSphere(canopy), true);
  assert.equal(frustum.intersectsSphere(origin), false);

  cullInstances(mesh, frustum, { pad: 0 });
  assert.equal(mesh.count, 1);
});

test('culling uses a camera rotation made this frame, not the previous render', async () => {
 const {cameraFrustum,sphereVisible}=await import('../src/unit-impostors.js');
 const camera=new THREE.PerspectiveCamera(30,1,.1,100);
 camera.updateMatrixWorld();
 camera.rotation.y=Math.PI;
 const frustum=cameraFrustum(camera,new THREE.Frustum());
 assert.equal(sphereVisible(frustum,0,0,10,1),true);
 assert.equal(sphereVisible(frustum,0,0,-10,1),false);
});

test('Low LOD preserves actionable enemy silhouettes instead of anonymous boxes', async () => {
  const { combatSilhouette } = await import('../src/unit-impostors.js');
  const hero={x:0,z:0,dead:false};
  assert.equal(combatSilhouette({type:'spitter',x:8,z:0},hero),true);
  assert.equal(combatSilhouette({type:'brute',x:12,z:0},hero),true);
  assert.equal(combatSilhouette({type:'walker',x:12,z:0},hero),false);
  assert.equal(combatSilhouette({type:'spitter',x:40,z:0},hero),false);
  assert.equal(combatSilhouette({type:'walker',x:12,z:0,windup:{}},hero),true);
  assert.equal(combatSilhouette({boss:true,x:40,z:0},hero),true);
  const target={type:'walker',x:12,z:0};hero.target=target;
  assert.equal(combatSilhouette(target,hero),true);
});
