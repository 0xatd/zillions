// Pure combat-feel rules. No rendering, no randomness, no simulation state.

export const SHAKE_CAP = 0.22;

const TYPES = ['kinetic', 'thermal', 'shock', 'void'];

export const HIT_STYLE = {
  kinetic: { color: 0xe8edf4, pool: 'spark' },
  thermal: { color: 0xff8a3c, pool: 'flame' },
  shock: { color: 0x9ad8ff, pool: 'shock' },
  void: { color: 0xd2b6ff, pool: 'void' },
  spit: { color: 0xc6d85a, pool: 'shock' },
};

export function leadDamageType(types) {
  if (!types) return 'kinetic';
  let best = 'kinetic';
  let share = -1;
  for (const key of TYPES) {
    const s = Number(types[key]) || 0;
    if (s > share) { share = s; best = key; }
  }
  return best;
}

export function shotFeel(kind, dtype) {
  if (dtype && HIT_STYLE[dtype]) return HIT_STYLE[dtype];
  if (kind === 'flame') return HIT_STYLE.thermal;
  if (kind === 'spit') return HIT_STYLE.spit;
  return HIT_STYLE.kinetic;
}

// Light shake. Later hits refresh it; they do not stack into a long rumble.
export function addShake(current, amount, enabled = true) {
  if (!enabled || !(amount > 0)) return current > 0 ? current : 0;
  return Math.min(SHAKE_CAP, Math.max(current || 0, Math.min(SHAKE_CAP, amount)));
}

export function shakeAmplitude(shake, enabled = true) {
  if (!enabled || !(shake > 0)) return 0;
  return Math.min(shake, SHAKE_CAP);
}

// Most-significant digit first, clamped to 1..999. `out` is a reused 3-slot array.
export function writeDigits(value, out) {
  let n = Math.round(Number(value) || 0);
  if (n < 1) n = 1;
  if (n > 999) n = 999;
  const hundreds = (n / 100) | 0;
  const tens = ((n / 10) | 0) % 10;
  const ones = n % 10;
  let count = 0;
  if (hundreds) out[count++] = hundreds;
  if (hundreds || tens) out[count++] = tens;
  out[count++] = ones;
  return count;
}

export function numberScale(crit) {
  return crit ? 1.62 : 1;
}

export function isTowerShot(kind) {
  return kind === 'tower' || kind === 'ballista' || kind === 'outpost'
    || kind === 'outpostSiege' || kind === 'flame';
}

export function isArcherShot(kind) {
  return isTowerShot(kind) || kind === 'ranger' || kind === 'sniper'
    || kind === 'hero' || kind === 'soldier';
}

// A surge is spent when the extra bodies it added are gone.
export function waveCleared(living, base, hot) {
  return !!hot && living <= base;
}
