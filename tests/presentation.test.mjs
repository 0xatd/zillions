import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/resolve-three.mjs';

const THREE = await import('three');
const { dressMaterial, isPbrMaterial, shadowSpanFor } = await import('../src/presentation.js');
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
