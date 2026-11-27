import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HEROES, UNITS } from '../src/config.js';
import {
  MARINE_HERO_NAMES,
  allowsSeparateWeaponRecoil,
  applyTwoHandArms,
  extrasAreTwoHanded,
  isGlbBytes,
  marineHeroAssetKey,
  marineHeroLoadUrls,
  marineHeroManifest,
  marineHeroUsesLod,
  materialTextures,
  twoHandArmCues,
  twoHandArmRotation,
} from '../src/marine-hero-art.js';

test('marine hero manifest registers Rykus, Tynor and Draco on the existing sniper key', () => {
  const manifest = marineHeroManifest();
  assert.equal(manifest.marineHero_sniper, 'assets/art-marines/hero_sniper.glb');
  assert.equal(manifest.marineHero_tynor, 'assets/art-marines/hero_tynor.glb');
  assert.equal(manifest.marineHero_draco, 'assets/art-marines/hero_draco.glb');
  for (const name of ['scott', 'alexander', 'danny', 'turtle', 'john', 'tiger', 'aaron']) {
    assert.equal(manifest[marineHeroAssetKey(name)], `assets/art-marines/hero_${name}.glb`);
  }
  assert.equal(Object.keys(manifest).length, MARINE_HERO_NAMES.length);
  // The sniper hero already exists, so marineHero_${key} resolves Rykus.
  // Tynor and Draco stay loadable assets and are not roster units.
  assert.equal(HEROES.sniper.key, 'sniper');
  assert.equal(marineHeroAssetKey(HEROES.sniper.key), 'marineHero_sniper');
  assert.equal(HEROES.tynor, undefined);
  assert.equal(HEROES.draco, undefined);
  assert.equal(UNITS.sniper.key, 'sniper');
});

test('assets.js copies that manifest when marine heroes are enabled', async () => {
  const src = await readFile(new URL('../src/assets.js', import.meta.url), 'utf8');
  assert.match(src, /marineFlag\('marineHeroes'\)/);
  assert.match(src, /Object\.assign\(MANIFEST,\s*marineHeroManifest\(\)\)/);
  assert.match(src, /isGlbBytes/);
  assert.match(src, /marineHeroLoadUrls/);
  assert.match(src, /releaseRetiredHeroTextures/);
  assert.match(src, /materialTextures\(mat\)/);
});

test('LOD file loads only for the Low graphics choice', () => {
  assert.equal(marineHeroUsesLod('low'), true);
  for (const quality of ['medium', 'high', 'auto', 'Low', '', null, undefined]) {
    assert.equal(marineHeroUsesLod(quality), false, String(quality));
  }
  assert.deepEqual(marineHeroLoadUrls('sniper', 'low'), [
    'assets/art-marines/hero_sniper_lod1.glb',
    'assets/art-marines/hero_sniper.glb',
  ]);
  assert.deepEqual(marineHeroLoadUrls('tynor', 'low'), [
    'assets/art-marines/hero_tynor_lod1.glb',
    'assets/art-marines/hero_tynor.glb',
  ]);
  assert.deepEqual(marineHeroLoadUrls('draco', 'low'), [
    'assets/art-marines/hero_draco_lod1.glb',
    'assets/art-marines/hero_draco.glb',
  ]);
  assert.deepEqual(marineHeroLoadUrls('draco', 'auto'), ['assets/art-marines/hero_draco.glb']);
  assert.deepEqual(marineHeroLoadUrls('draco', 'medium'), ['assets/art-marines/hero_draco.glb']);
  assert.deepEqual(marineHeroLoadUrls('draco', 'high'), ['assets/art-marines/hero_draco.glb']);
  // Heroes without a LOD file stay on the full GLB even at Low.
  assert.deepEqual(marineHeroLoadUrls('scott', 'low'), ['assets/art-marines/hero_scott.glb']);
  assert.deepEqual(marineHeroLoadUrls('alexander', 'low'), ['assets/art-marines/hero_alexander.glb']);
  assert.deepEqual(marineHeroLoadUrls('danny', 'low'), ['assets/art-marines/hero_danny.glb']);
});

test('an LFS pointer is not treated as a GLB', () => {
  const pointer = new TextEncoder().encode('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n');
  assert.equal(isGlbBytes(pointer), false);
  assert.equal(isGlbBytes(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(isGlbBytes(new Uint8Array([0x67, 0x6c, 0x54])), false);
  assert.equal(isGlbBytes(null), false);
  assert.equal(extrasAreTwoHanded({ two_handed: true }), true);
  assert.equal(extrasAreTwoHanded({ two_handed: false }), false);
  assert.equal(extrasAreTwoHanded({}), false);
  assert.equal(extrasAreTwoHanded(undefined), false);
});

test('two-handed heroes share one arm rotation and skip the rifle recoil offset', () => {
  const walking = twoHandArmCues({ stride: 0.5, attacking: false, attackRecovery: 0.12, cast: 0 });
  assert.equal(walking.stride, 0.5);
  assert.equal(walking.recoil, 0.5);
  assert.equal(walking.windup, 0);
  assert.equal(walking.cast, 0);
  assert.equal(twoHandArmRotation(walking), 0.5 * 0.12 + 0.5 * 0.30);

  const aiming = twoHandArmCues({
    stride: -0.2, attacking: true, attackT: 0.05, attackDuration: 0.2, attackRecovery: 0.24, cast: 0,
  });
  assert.equal(aiming.recoil, 0);
  assert.ok(Math.abs(aiming.windup - 0.75) < 1e-9);
  assert.equal(twoHandArmRotation(aiming), -0.2 * 0.12 + 0 * 0.30 - 0.75 * 0.06);

  const casting = twoHandArmCues({ stride: 0.1, cast: 1 });
  assert.equal(twoHandArmRotation(casting), 0.1 * 0.12 - 0.35);

  const limbs = {
    armL: { rotation: { x: 1 } },
    armR: { rotation: { x: -1 } },
  };
  const posed = { stride: 0.25, recoil: 1, windup: 0.5, cast: 0.2 };
  const formula = 0.25 * 0.12 + 1 * 0.30 - 0.5 * 0.06 - 0.2 * 0.35;
  assert.equal(twoHandArmRotation(posed), formula);
  assert.equal(applyTwoHandArms(limbs, posed), formula);
  assert.equal(limbs.armL.rotation.x, limbs.armR.rotation.x);
  assert.equal(limbs.armL.rotation.x, formula);

  assert.equal(allowsSeparateWeaponRecoil(true, 1), false);
  assert.equal(allowsSeparateWeaponRecoil(false, 1), true);
  assert.equal(allowsSeparateWeaponRecoil(false, 0), false);
  assert.equal(allowsSeparateWeaponRecoil(false, -0.45), false);
});

test('replacing a hero releases the normal map as well as the albedo', () => {
  const albedo = { name: 'albedo' };
  const normal = { name: 'normal' };
  assert.deepEqual(materialTextures({ map: albedo, normalMap: normal }), [albedo, normal]);
  assert.deepEqual(materialTextures({ map: albedo, normalMap: albedo }), [albedo]);
  assert.deepEqual(materialTextures({}), []);
  assert.deepEqual(materialTextures(null), []);
});

test('the renderer reads two_handed from the loaded model', async () => {
  const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(src, /g\.userData\.twoHanded = marineHero\.userData\.twoHanded === true/);
  assert.match(src, /applyTwoHandArms\(limbs, twoHandArmCues\(/);
  assert.match(src, /allowsSeparateWeaponRecoil\(rec\.mesh\.userData\.twoHanded === true, attackPulse\)/);
  assert.match(src, /marineHeroUsesLod/);
  assert.match(src, /releaseRetiredHeroTextures\(\)/);
  assert.match(src, /materialTextures\(mat\)/);
  assert.doesNotMatch(src, /'scott'.*'alexander'.*'danny'/);
});
