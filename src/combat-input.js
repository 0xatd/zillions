// Pointer orders, ability slots, camera keys, and impact cues.
//
// None of this rolls the simulation. A rebound key still issues the same
// command: the slot or the order kind is chosen from the action, not the letter.
// Impact cues are presentation hints. They never write simulation state.

export function quantizeOrder(x, z) {
  const q = (n) => Math.round(Number(n) * 64) / 64;
  return { x: q(x), z: q(z) };
}

// Right-click is a smart order. An armed attack-move click is always an attack.
// A plain left click inspects and does not order.
export function pointerOrder({ button = -1, armed = false, enemy = false } = {}) {
  if (button !== 0 && button !== 2) return null;
  if (button === 0 && !armed) return null;
  return { t: 'horder', k: enemy || armed ? 'attack' : 'move' };
}

// Slots 0–3 are the four ability keys. The secondary bar shifts the first two
// into slots 4 and 5. Rebinding the key does not change the slot.
export function castSlot(action, secondBar = false) {
  const base = { ability1: 0, ability2: 1, ability3: 2, ability4: 3 }[action];
  if (base == null) return null;
  return secondBar && base < 2 ? base + 4 : base;
}

const WASD = { w: 'up', a: 'left', s: 'down', d: 'right' };

// Arrow (or rebound) camera keys always pan. WASD pans only while that option
// is on and the letter is not already a battle action.
export function cameraAxisHeld(binds, keys, axis, { wasdCamera = false, actionFor, isHeld, cameraAction } = {}) {
  if (typeof isHeld === 'function' && cameraAction && isHeld(binds, keys, cameraAction)) return true;
  if (!wasdCamera || typeof actionFor !== 'function') return false;
  for (const [key, dir] of Object.entries(WASD)) {
    if (dir !== axis || !keys.has(key)) continue;
    const owner = actionFor(binds, key, 'battle');
    if (!owner || owner === cameraAction) return true;
  }
  return false;
}

const ULTIMATES = new Set(['meridian', 'unmake', 'choir', 'hammer']);

// Render-side only. Callers apply shake, hit-stop, and samples. The sim
// never reads this.
export function impactCue(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.type === 'zdeath') {
    return {
      shake: event.big ? 0.2 : 0.06,
      hitStop: event.big ? 0.07 : 0.045,
      sample: event.big ? 'heavy' : 'hit',
    };
  }
  if (event.type === 'shot' && event.damage > 0) {
    const heavy = !!event.crit || event.damage >= 90;
    return {
      shake: heavy ? 0.1 : 0,
      hitStop: heavy ? 0.04 : 0,
      sample: heavy ? 'heavy' : 'hit',
      number: true,
    };
  }
  if (event.type === 'cast') {
    const ult = ULTIMATES.has(event.key);
    return {
      shake: ult ? 0.18 : 0.05,
      hitStop: ult ? 0.05 : 0,
      sample: ult ? 'ultimate' : 'cast',
    };
  }
  return null;
}

export function scaledShake(amount, { reduceShake = false, reduceMotion = false } = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || reduceMotion) return 0;
  return n * (reduceShake ? 0.22 : 1);
}
