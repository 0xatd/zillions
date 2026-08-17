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

export function unitPose(state, phase, cues = {}) {
  const cycle = Math.sin(phase);
  const pulse = clamp(cues.pulse || 0, 0, 1);
  switch (state) {
    case 'run':
      return { y: Math.abs(cycle) * 0.09, z: 0, pitch: 0.12, roll: cycle * 0.05, stride: cycle * 0.62 };
    case 'attack':
      return { y: pulse * 0.08, z: pulse * (cues.melee ? 0.34 : 0.13), pitch: -pulse * (cues.melee ? 0.75 : 0.24), roll: pulse * 0.18, stride: 0 };
    case 'cast':
      return { y: pulse * 0.16, z: -pulse * 0.06, pitch: -pulse * 0.2, roll: cycle * 0.035, stride: 0 };
    case 'hit':
      return { y: 0.03, z: -pulse * 0.22, pitch: pulse * 0.34, roll: -pulse * 0.2, stride: 0 };
    case 'down':
      return { y: -0.12, z: 0, pitch: 0, roll: Math.PI * 0.48, stride: 0 };
    default:
      return { y: cycle * 0.02, z: 0, pitch: 0, roll: cycle * 0.018, stride: 0 };
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
