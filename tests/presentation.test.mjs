import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/resolve-three.mjs';

const THREE = await import('three');
const { disposePresentationMaterial, dressMaterial, isPbrMaterial, shadowSpanFor } = await import('../src/presentation.js');
const { MARINE_ANIMATED_GROUPS } = await import('../src/marine-assembler.js');
const { HEROES } = await import('../src/config.js');

test('Low dresses PBR down to Lambert and High puts the original back', () => {
  const source = new THREE.MeshPhysicalMaterial({
    color: 0x2f8f46,
    metalness: 0.25,
    roughness: 0.34,
    emissive: 0x59e8d8,
    emissiveIntensity: 2.4,
    clearcoat: 0.5,
  });
  source.name = 'alexander_armor';
  const normal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  source.normalMap = normal;
  const low = dressMaterial(source, false);
  assert.equal(low.isMeshLambertMaterial, true);
  assert.equal(!!low.isMeshStandardMaterial, false);
  assert.equal(low.color.getHex(), source.color.getHex());
  assert.equal(low.emissive.getHex(), 0x59e8d8);
  assert.equal(low.emissiveIntensity, 2.4);
  assert.equal(low.normalMap || null, null);
  assert.equal(isPbrMaterial(source), true);
  const high = dressMaterial(low, true);
  assert.equal(high, source);
  assert.equal(high.clearcoat, 0.5);
  assert.equal(high.normalMap, normal);
  assert.equal(high.metalness, 0.25);
});

test('disposing either quality variant releases the hidden one too', () => {
  const source = new THREE.MeshStandardMaterial({ color: 0x336699 });
  const map = new THREE.DataTexture(new Uint8Array([8, 8, 8, 255]), 1, 1);
  source.map = map;
  const low = dressMaterial(source, false);
  const high = dressMaterial(low, true);
  assert.equal(high, source);
  assert.equal(source.userData.lambertStandIn, low);
  const disposed = [];
  source.addEventListener('dispose', () => disposed.push('pbr'));
  low.addEventListener('dispose', () => disposed.push('lambert'));
  let maps = 0;
  map.addEventListener('dispose', () => { maps += 1; });
  disposePresentationMaterial(low);
  assert.deepEqual(disposed.sort(), ['lambert', 'pbr']);
  assert.equal(maps, 1);
  const fresh = new THREE.MeshStandardMaterial({ color: 0x112233 });
  const stand = dressMaterial(fresh, false);
  const fromHigh = [];
  fresh.addEventListener('dispose', () => fromHigh.push('pbr'));
  stand.addEventListener('dispose', () => fromHigh.push('lambert'));
  disposePresentationMaterial(fresh);
  assert.deepEqual(fromHigh.sort(), ['lambert', 'pbr']);
});

test('a shared kit material stays when a mesh is disposed', () => {
  const source = new THREE.MeshStandardMaterial({ color: 0x111111 });
  source.userData.kitShared = true;
  const low = dressMaterial(source, false);
  let disposed = false;
  source.addEventListener('dispose', () => { disposed = true; });
  low.addEventListener('dispose', () => { disposed = true; });
  disposePresentationMaterial(low);
  assert.equal(disposed, false);
});

test('Lambert and basic materials are left alone', () => {
  const lambert = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  const basic = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  assert.equal(dressMaterial(lambert, true), lambert);
  assert.equal(dressMaterial(lambert, false), lambert);
  assert.equal(dressMaterial(basic, false), basic);
});

test('High shadow camera is tighter than Medium at the same zoom', () => {
  const high = shadowSpanFor({ tier: 'high' }, 28);
  const medium = shadowSpanFor({ tier: 'medium' }, 28);
  assert.ok(high < medium);
  assert.equal(high, 16);
  assert.equal(medium, 26);
});

test('marine batching still stops at the moving groups', () => {
  assert.deepEqual(
    [...MARINE_ANIMATED_GROUPS],
    ['body', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'weapon'],
  );
});

test('rifle heroes are flagged two-handed and melee heroes are not', () => {
  for (const key of ['scott', 'alexander', 'danny', 'sniper']) assert.equal(HEROES[key].two_handed, true);
  for (const key of ['turtle', 'john', 'tiger', 'aaron', 'lina', 'axe', 'sven']) assert.equal(!!HEROES[key].two_handed, false);
});
