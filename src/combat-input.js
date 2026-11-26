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

// The on-screen build button latches until the sim finishes the payment.
// In co-op the pay command is queued, so payHold stays false until the
// lockstep window applies. That gap is not completion. Clear the latch only
// after the sim has shown payHold true and then turned it off.
export function settleBuildToggle({ buttonPay = false, lastPay = false, payHold = false, acked = false } = {}) {
  const seen = !!acked || !!(buttonPay && lastPay && payHold);
  if (buttonPay && lastPay && seen && !payHold) {
    return { buttonPay: false, lastPay: false, acked: false };
  }
  return { buttonPay: !!buttonPay, lastPay: !!lastPay, acked: !!(buttonPay && lastPay && seen) };
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
      shake: event.big ? 0.2 : 0,
      hitStop: event.big ? 0.07 : 0,
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

// One freeze, then a gap. A fresh impact during either does not renew the hold,
// so a stream of deaths cannot pin actor rendering in place.
export const HIT_STOP_CAP = 0.08;
export const HIT_STOP_GAP = 0.14;

export function armHitStop(state = {}, seconds = 0) {
  const hold = Math.max(0, Number(state.hold) || 0);
  const gap = Math.max(0, Number(state.gap) || 0);
  if (hold > 0 || gap > 0) return { hold, gap };
  const next = Math.min(HIT_STOP_CAP, Math.max(0, Number(seconds) || 0));
  return { hold: next, gap: 0 };
}

export function tickHitStop(state = {}, dt = 0) {
  let hold = Math.max(0, Number(state.hold) || 0);
  let gap = Math.max(0, Number(state.gap) || 0);
  const present = hold > 0;
  const step = Math.max(0, Number(dt) || 0);
  if (hold > 0) {
    hold = Math.max(0, hold - step);
    if (hold === 0) gap = HIT_STOP_GAP;
  } else if (gap > 0) {
    gap = Math.max(0, gap - step);
  }
  return { hold, gap, present };
}
