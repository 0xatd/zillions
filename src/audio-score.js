// Pure audio decisions. No AudioContext, no Math.random, no simulation state.
// The runtime in src/soundscape.js reads this table; tests can too.

export const BIOME_AMBIENT = {
  moor: 'meadow',
  fen: 'swamp',
  wastes: 'volcanic',
  hills: 'snow',
  vale: 'valley',
  labyrinth: 'volcanic',
};

export function biomeAmbient(terrainKind) {
  return BIOME_AMBIENT[terrainKind] || 'meadow';
}

// Menu while no match is running. Build while founding or while the field is
// quiet. Combat once the horde is engaged. Victory and defeat are stingers.
export function selectMusic(scene) {
  if (!scene || !scene.inMatch) return 'menu';
  if (scene.over) return scene.won ? 'victory' : 'defeat';
  if (scene.phase === 'found') return 'build';
  return scene.combat ? 'combat' : 'build';
}

// Hysteresis so one wanderer does not flip the combat bed on and off.
export function nextCombat(wasCombat, aggro, { engage = 2, release = 0 } = {}) {
  const n = Number(aggro) || 0;
  if (wasCombat) return n > release;
  return n >= engage;
}

export function distanceGain(dist, { minDist = 6, maxDist = 38, minGain = 0.05 } = {}) {
  const d = Math.max(0, Number(dist) || 0);
  if (d <= minDist) return 1;
  if (d >= maxDist) return minGain;
  const t = (d - minDist) / (maxDist - minDist);
  const curve = (1 - t) * (1 - t);
  return minGain + (1 - minGain) * curve;
}

export function pitchScale(rand, amount = 0.06) {
  const n = Number(typeof rand === 'function' ? rand() : rand);
  const u = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
  const span = Math.max(0, Number(amount) || 0);
  return 1 + (u * 2 - 1) * span;
}

export function clamp01(v, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

// bus, linear gain, pitch jitter (fraction), cooldown seconds, positional.
export const CUES = {
  'ui.click': { bus: 'ui', gain: 0.42, pitch: 0.02, cooldown: 0.045, positional: false },
  'ui.hover': { bus: 'ui', gain: 0.18, pitch: 0.03, cooldown: 0.04, positional: false },
  'ui.deny': { bus: 'ui', gain: 0.34, pitch: 0, cooldown: 0.08, positional: false },
  'build.place': { bus: 'sfx', gain: 0.55, pitch: 0.05, cooldown: 0.05, positional: true },
  'build.upgrade': { bus: 'sfx', gain: 0.5, pitch: 0.03, cooldown: 0.08, positional: true },
  'build.demolish': { bus: 'sfx', gain: 0.6, pitch: 0.04, cooldown: 0.08, positional: true },
  'coin': { bus: 'sfx', gain: 0.32, pitch: 0.015, cooldown: 0.02, positional: true },
  'hero.step': { bus: 'sfx', gain: 0.28, pitch: 0.07, cooldown: 0.16, positional: true },
  'attack.melee': { bus: 'sfx', gain: 0.4, pitch: 0.06, cooldown: 0.05, positional: true },
  'attack.hero': { bus: 'sfx', gain: 0.38, pitch: 0.05, cooldown: 0.04, positional: true },
  'attack.shotgun': { bus: 'sfx', gain: 0.5, pitch: 0.04, cooldown: 0.06, positional: true },
  'shot.ranger': { bus: 'sfx', gain: 0.32, pitch: 0.05, cooldown: 0.03, positional: true },
  'shot.soldier': { bus: 'sfx', gain: 0.34, pitch: 0.05, cooldown: 0.03, positional: true },
  'shot.sniper': { bus: 'sfx', gain: 0.46, pitch: 0.03, cooldown: 0.05, positional: true },
  'shot.tower': { bus: 'sfx', gain: 0.36, pitch: 0.045, cooldown: 0.03, positional: true },
  'shot.ballista': { bus: 'sfx', gain: 0.48, pitch: 0.03, cooldown: 0.05, positional: true },
  'shot.flame': { bus: 'sfx', gain: 0.4, pitch: 0.04, cooldown: 0.04, positional: true },
  'shot.outpost': { bus: 'sfx', gain: 0.36, pitch: 0.04, cooldown: 0.04, positional: true },
  'shot.outpostSiege': { bus: 'sfx', gain: 0.5, pitch: 0.03, cooldown: 0.06, positional: true },
  'impact.hit': { bus: 'sfx', gain: 0.3, pitch: 0.06, cooldown: 0.03, positional: true },
  'impact.flame': { bus: 'sfx', gain: 0.42, pitch: 0.04, cooldown: 0.05, positional: true },
  'keep.hit': { bus: 'sfx', gain: 0.46, pitch: 0.04, cooldown: 0.08, positional: true },
  'zombie.groan': { bus: 'sfx', gain: 0.34, pitch: 0.08, cooldown: 1.15, positional: true },
  'zombie.attack': { bus: 'sfx', gain: 0.4, pitch: 0.06, cooldown: 0.12, positional: true },
  'zombie.death': { bus: 'sfx', gain: 0.4, pitch: 0.07, cooldown: 0.05, positional: true },
  'wave.horn': { bus: 'sfx', gain: 0.62, pitch: 0.02, cooldown: 0.4, positional: false },
  'ability.generic': { bus: 'sfx', gain: 0.48, pitch: 0.04, cooldown: 0.08, positional: true },
  'ability.magic': { bus: 'sfx', gain: 0.46, pitch: 0.03, cooldown: 0.08, positional: true },
  'ability.blast': { bus: 'sfx', gain: 0.58, pitch: 0.03, cooldown: 0.1, positional: true },
  'ability.hook': { bus: 'sfx', gain: 0.44, pitch: 0.04, cooldown: 0.08, positional: true },
};

export const SHOT_CUES = {
  melee: 'attack.melee',
  shotgun: 'attack.shotgun',
  hero: 'attack.hero',
  ranger: 'shot.ranger',
  soldier: 'shot.soldier',
  sniper: 'shot.sniper',
  tiger_clone: 'shot.soldier',
  tower: 'shot.tower',
  ballista: 'shot.ballista',
  flame: 'shot.flame',
  outpost: 'shot.outpost',
  outpostSiege: 'shot.outpostSiege',
};

export function shotCue(kind) {
  return SHOT_CUES[kind] || 'shot.soldier';
}

// Procedural fallback keeps the previous kind mapping when a sample is missing.
const PROCEDURAL_SHOT = {
  hero: 'soldier',
  ballista: 'sniper',
  outpostSiege: 'sniper',
  outpost: 'tower',
  flame: 'tower',
  tiger_clone: 'soldier',
  melee: 'melee',
};

export function proceduralShotKind(kind) {
  return PROCEDURAL_SHOT[kind] || kind || 'soldier';
}

export const ABILITY_CUES = {
  hook: 'ability.hook',
  assassinate: 'ability.hook',
  shrapnel: 'ability.blast',
  grenade: 'ability.blast',
  sunstrike: 'ability.blast',
  hammer: 'ability.blast',
  smoke: 'ability.magic',
  weave: 'ability.magic',
  stealth: 'ability.magic',
  teleport: 'ability.magic',
  timelapse: 'ability.magic',
  roots: 'ability.magic',
  swarm: 'ability.magic',
  whirlwind: 'ability.blast',
  warcry: 'ability.generic',
  holy: 'ability.magic',
  deathpulse: 'ability.magic',
  shieldup: 'ability.generic',
  splash: 'ability.blast',
  shimmer: 'ability.magic',
  fortify: 'ability.generic',
  brew: 'ability.blast',
  clone: 'ability.magic',
  summon: 'ability.magic',
};

export function abilityCue(key) {
  return ABILITY_CUES[key] || 'ability.generic';
}

export const MUSIC_IDS = ['menu', 'build', 'combat', 'victory', 'defeat'];
export const AMBIENT_IDS = ['meadow', 'swamp', 'volcanic', 'snow', 'valley'];
export const STINGER_IDS = new Set(['victory', 'defeat']);
