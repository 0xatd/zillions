import { clamp } from './utils.js';

// Presentation-only state helpers. They must stay independent from simulation
// state so animation cannot change lockstep results.
export function unitArtState(unit, cues = {}) {
  if (unit.dead) return 'down';
  if ((cues.hitT || 0) > 0) return 'hit';
  if ((cues.castT || 0) > 0) return 'cast';
  if ((cues.attackT || 0) > 0) return 'attack';
  return unit.moving ? 'run' : 'idle';
}

// Two-handed firearms keep both hands on the weapon. The off-hand copies the
// weapon hand instead of swinging the opposite way, which walked it off the
// foregrip. Recoil is the recovery kick, windup is the shot's prep, cast is
// the ability pose. All four are presentation 0..1 signals.
export function twoHandedArmPitch(stride = 0, recoil = 0, windup = 0, cast = 0) {
  return stride * 0.12 + recoil * 0.30 - windup * 0.06 - cast * 0.35;
}

export function twoHandedArmCues(unit, artState, cuePulse = 0) {
  const duration = unit?.attack?.duration || 1;
  const windup = unit?.attack ? clamp(1 - unit.attack.t / duration, 0, 1) : 0;
  const recoil = unit?.attack ? 0 : clamp((unit?.attackRecovery || 0) / 0.24, 0, 1);
  const cast = artState === 'cast' ? clamp(cuePulse || 0, 0, 1) : 0;
  return { windup, recoil, cast };
}

export function unitPose(state, phase, cues = {}) {
  const cycle = Math.sin(phase);
  const pulse = clamp(cues.pulse || 0, 0, 1);
  switch (state) {
    case 'run':
      return { y: Math.abs(cycle) * 0.055, z: 0, pitch: 0.1, roll: cycle * 0.035, stride: cycle * 0.54 };
    case 'attack':
      return { y: pulse * 0.08, z: pulse * (cues.melee ? 0.34 : 0.13), pitch: -pulse * (cues.melee ? 0.75 : 0.24), roll: pulse * 0.18, stride: 0 };
    case 'cast':
      return { y: pulse * 0.16, z: -pulse * 0.06, pitch: -pulse * 0.2, roll: cycle * 0.035, stride: 0 };
    case 'hit':
      return { y: 0.03, z: -pulse * 0.22, pitch: pulse * 0.34, roll: -pulse * 0.2, stride: 0 };
    case 'down':
      return { y: -0.12, z: 0, pitch: 0, roll: Math.PI * 0.48, stride: 0 };
    default:
      return { y: cycle * 0.012, z: 0, pitch: 0, roll: cycle * 0.012, stride: 0 };
  }
}

export function buildingArtState(building, spawnAge = Infinity) {
  const hp = Math.max(0, Number(building.hp) || 0);
  const maxHp = Math.max(1, Number(building.maxHp) || 1);
  const health = clamp(hp / maxHp, 0, 1);
  return {
    phase: spawnAge < 0.7 ? 'constructing' : health <= 0.25 ? 'critical' : health <= 0.55 ? 'damaged' : 'operational',
    health,
    damage: 1 - health,
  };
}
