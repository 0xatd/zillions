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

// Menu on the title. Select on the planet / mission picker. Build while the
// field is quiet. Combat once the horde is engaged. Victory and defeat sting.
export function selectMusic(scene) {
  if (!scene || !scene.inMatch) return scene?.screen === 'select' ? 'select' : 'menu';
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

// Camera-relative gain and stereo pan. yaw 0 looks toward -Z; +pan is screen right.
// Sounds outside the view cone are quieter than sounds under the camera.
export function stereoPlacement(sx, sz, cam, {
  minDist = 7, maxDist = 48, minGain = 0.04, offscreen = 0.22,
} = {}) {
  if (!cam || !Number.isFinite(sx) || !Number.isFinite(sz)) return { gain: 1, pan: 0, dist: 0 };
  const dx = sx - cam.x;
  const dz = sz - cam.z;
  const dist = Math.hypot(dx, dz);
  let gain = distanceGain(dist, { minDist, maxDist, minGain });
  const look = Math.atan2(-Math.sin(cam.yaw || 0), -Math.cos(cam.yaw || 0));
  const bearing = Math.atan2(dx, dz);
  const rel = Math.atan2(Math.sin(bearing - look), Math.cos(bearing - look));
  const pan = Math.max(-1, Math.min(1, -Math.sin(rel)));
  const abs = Math.abs(rel);
  const edge = 0.42;
  const full = 1.05;
  if (abs >= full) gain *= offscreen;
  else if (abs > edge) gain *= 1 - (1 - offscreen) * ((abs - edge) / (full - edge));
  return { gain, pan, dist };
}

export function clamp01(v, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

// Files are already peak-normalized, so these gains are mix trims.
// voices caps how many of that cue may overlap. vol is the loudness jitter.
export const CUES = {
  'ui.click': { bus: 'ui', gain: 0.7, pitch: 0.015, vol: 0.06, cooldown: 0.04, voices: 2, positional: false },
  'ui.hover': { bus: 'ui', gain: 0.45, pitch: 0.02, vol: 0.08, cooldown: 0.035, voices: 1, positional: false },
  'ui.deny': { bus: 'ui', gain: 0.6, pitch: 0, vol: 0, cooldown: 0.08, voices: 1, positional: false },
  'build.place': { bus: 'sfx', gain: 0.95, pitch: 0.04, vol: 0.08, cooldown: 0.06, voices: 2, positional: true },
  'build.upgrade': { bus: 'sfx', gain: 1, pitch: 0.03, vol: 0.06, cooldown: 0.08, voices: 2, positional: true },
  'build.demolish': { bus: 'sfx', gain: 0.9, pitch: 0.04, vol: 0.08, cooldown: 0.08, voices: 2, positional: true },
  'coin': { bus: 'sfx', gain: 0.55, pitch: 0.02, vol: 0.08, cooldown: 0.03, voices: 3, positional: true },
  'hero.step': { bus: 'sfx', gain: 0.5, pitch: 0.07, vol: 0.12, cooldown: 0.18, voices: 2, positional: true },
  'attack.melee': { bus: 'sfx', gain: 0.72, pitch: 0.06, vol: 0.1, cooldown: 0.04, voices: 3, positional: true },
  'attack.hero': { bus: 'sfx', gain: 0.68, pitch: 0.05, vol: 0.1, cooldown: 0.04, voices: 3, positional: true },
  'attack.shotgun': { bus: 'sfx', gain: 0.8, pitch: 0.04, vol: 0.08, cooldown: 0.06, voices: 2, positional: true },
  'shot.ranger': { bus: 'sfx', gain: 0.55, pitch: 0.06, vol: 0.1, cooldown: 0.03, voices: 3, positional: true },
  'shot.soldier': { bus: 'sfx', gain: 0.58, pitch: 0.06, vol: 0.1, cooldown: 0.03, voices: 3, positional: true },
  'shot.sniper': { bus: 'sfx', gain: 0.75, pitch: 0.03, vol: 0.08, cooldown: 0.05, voices: 2, positional: true },
  'shot.tower': { bus: 'sfx', gain: 0.6, pitch: 0.05, vol: 0.1, cooldown: 0.03, voices: 4, positional: true },
  'shot.ballista': { bus: 'sfx', gain: 0.78, pitch: 0.03, vol: 0.08, cooldown: 0.05, voices: 2, positional: true },
  'shot.flame': { bus: 'sfx', gain: 0.66, pitch: 0.05, vol: 0.1, cooldown: 0.04, voices: 3, positional: true },
  'shot.outpost': { bus: 'sfx', gain: 0.6, pitch: 0.05, vol: 0.1, cooldown: 0.04, voices: 3, positional: true },
  'shot.outpostSiege': { bus: 'sfx', gain: 0.8, pitch: 0.03, vol: 0.08, cooldown: 0.06, voices: 2, positional: true },
  'impact.hit': { bus: 'sfx', gain: 0.5, pitch: 0.08, vol: 0.14, cooldown: 0.02, voices: 4, positional: true },
  'impact.flame': { bus: 'sfx', gain: 0.62, pitch: 0.05, vol: 0.1, cooldown: 0.04, voices: 3, positional: true },
  'keep.hit': { bus: 'sfx', gain: 0.85, pitch: 0.05, vol: 0.1, cooldown: 0.09, voices: 2, positional: true },
  'zombie.groan': { bus: 'sfx', gain: 0.55, pitch: 0.09, vol: 0.12, cooldown: 0.45, voices: 3, positional: true },
  'zombie.attack': { bus: 'sfx', gain: 0.62, pitch: 0.07, vol: 0.12, cooldown: 0.05, voices: 4, positional: true },
  'zombie.death': { bus: 'sfx', gain: 0.62, pitch: 0.08, vol: 0.14, cooldown: 0.02, voices: 4, positional: true },
  'wave.horn': { bus: 'sfx', gain: 0.9, pitch: 0.02, vol: 0.04, cooldown: 0.5, voices: 1, positional: false },
  'ability.generic': { bus: 'sfx', gain: 0.75, pitch: 0.04, vol: 0.08, cooldown: 0.08, voices: 2, positional: true },
  'ability.magic': { bus: 'sfx', gain: 0.72, pitch: 0.04, vol: 0.08, cooldown: 0.08, voices: 2, positional: true },
  'ability.blast': { bus: 'sfx', gain: 0.85, pitch: 0.03, vol: 0.06, cooldown: 0.1, voices: 2, positional: true },
  'ability.hook': { bus: 'sfx', gain: 0.7, pitch: 0.04, vol: 0.08, cooldown: 0.08, voices: 2, positional: true },
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

export const MUSIC_IDS = ['menu', 'select', 'build', 'combat', 'victory', 'defeat'];
export const AMBIENT_IDS = ['meadow', 'swamp', 'volcanic', 'snow', 'valley'];
export const STINGER_IDS = new Set(['victory', 'defeat']);
