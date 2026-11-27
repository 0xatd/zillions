// Presentation rules for the art-marines hero GLBs. No Three.js and no
// simulation state: the loader and the renderer both call these, and the
// tests can import them without a GPU.

export const MARINE_HERO_NAMES = Object.freeze([
  'scott', 'alexander', 'danny', 'turtle', 'john', 'tiger', 'aaron',
  'sniper', 'tynor', 'draco',
]);

// Only these exports ship a separate Low-preset file. The other marine
// heroes keep a single GLB at every graphics setting.
export const MARINE_HERO_LOD_NAMES = Object.freeze(['sniper', 'tynor', 'draco']);

export function marineHeroAssetKey(name) {
  return `marineHero_${name}`;
}

export function marineHeroFullUrl(name) {
  return `assets/art-marines/hero_${name}.glb`;
}

export function marineHeroLodUrl(name) {
  return `assets/art-marines/hero_${name}_lod1.glb`;
}

export function marineHeroHasLod(name) {
  return MARINE_HERO_LOD_NAMES.includes(name);
}

// Canonical manifest entries. The full-detail file is the registered asset.
// Low-preset loading swaps in the LOD url at fetch time.
export function marineHeroManifest() {
  const manifest = {};
  for (const name of MARINE_HERO_NAMES) manifest[marineHeroAssetKey(name)] = marineHeroFullUrl(name);
  return manifest;
}

// The Low graphics choice only (`data-q="low"`, choice === 'low').
// Medium, High, and Auto stay on the full-detail file. Auto can resolve to
// a low tier; that resolved tier is not this switch.
export function marineHeroUsesLod(quality) {
  return quality === 'low';
}

// Preferred url first. On Low, a failed LOD fetch falls through to the full file.
export function marineHeroLoadUrls(name, quality) {
  const full = marineHeroFullUrl(name);
  if (marineHeroUsesLod(quality) && marineHeroHasLod(name)) return [marineHeroLodUrl(name), full];
  return [full];
}

// glTF binary magic. A Git LFS pointer is ASCII ("version https://git-lfs...")
// and must not be handed to the parser.
export function isGlbBytes(bytes) {
  if (!bytes) return false;
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  return view.length >= 12
    && view[0] === 0x67 && view[1] === 0x6c && view[2] === 0x54 && view[3] === 0x46;
}

// asset_root.extras.two_handed, copied onto Object3D.userData by GLTFLoader.
export function extrasAreTwoHanded(extras) {
  return extras?.two_handed === true;
}

// Shared shoulder pitch for a two-handed rifle. Both arms use this same x
// so the left hand stays on the handguard. stride is the walk cycle (signed),
// recoil and windup are 0..1 attack phases, cast is the 0..1 ability pulse.
export function twoHandArmRotation({ stride = 0, recoil = 0, windup = 0, cast = 0 } = {}) {
  return stride * 0.12 + recoil * 0.30 - windup * 0.06 - cast * 0.35;
}

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

// Map the renderer's attack clock onto the formula inputs. Windup is the
// committed shot; recoil is the recovery after it. They do not stack.
export function twoHandArmCues({
  stride = 0,
  attacking = false,
  attackT = 0,
  attackDuration = 0,
  attackRecovery = 0,
  cast = 0,
} = {}) {
  const windup = attacking && attackDuration > 0
    ? clamp01(1 - attackT / attackDuration)
    : 0;
  const recoil = attacking ? 0 : clamp01(attackRecovery / 0.24);
  return { stride, recoil, windup, cast: Math.max(0, Number(cast) || 0) };
}

// Drive arm_l and arm_r with one rotation.x. `cues` is the formula input
// ({ stride, recoil, windup, cast }), usually the result of twoHandArmCues.
// Returns that angle.
export function applyTwoHandArms(limbs, cues = {}) {
  const x = twoHandArmRotation(cues);
  if (limbs?.armL) limbs.armL.rotation.x = x;
  if (limbs?.armR) limbs.armR.rotation.x = x;
  return x;
}

// The rifle is parented under arm_r. A separate recoil offset pulls it out
// of the left hand, so two-handed heroes skip it. One-handed heroes keep
// the existing kick, and only while the attack pulse is positive.
export function allowsSeparateWeaponRecoil(twoHanded, attackPulse) {
  return twoHanded !== true && attackPulse > 0;
}
