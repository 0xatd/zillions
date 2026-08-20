import { stableHash } from './living-world.js';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value)));

export function marketPrice(basePrice, stock, targetStock, side = 'buy') {
  const base = Math.max(0, Math.floor(finite(basePrice)));
  const target = Math.max(1, finite(targetStock, 1));
  const pressure = clamp((target - Math.max(0, finite(stock))) / target, -0.5, 1);
  const midpoint = Math.max(1, Math.round(base * (1 + pressure * 0.5)));
  return side === 'sell' ? Math.max(0, Math.floor(midpoint * 0.85)) : Math.ceil(midpoint * 1.1);
}

export function logisticsConsumption({ troops = 0, moving = false, wounded = 0 } = {}) {
  return { food: Math.max(0, finite(troops)) * (moving ? 0.0015 : 0.001), medicine: Math.max(0, finite(wounded)) * 0.002, parts: moving ? Math.max(0, finite(troops)) * 0.0002 : 0 };
}

export function resolveRaid({ raidId, tick, attackerPower, defenderPower, cargo = 0 }) {
  const roll = (stableHash(`${raidId}:${tick}`) % 2001 - 1000) / 10000;
  const ratio = finite(attackerPower) / Math.max(1, finite(attackerPower) + finite(defenderPower));
  const success = clamp(ratio + roll, 0, 1) >= 0.5;
  const stolen = success ? Math.floor(Math.max(0, finite(cargo)) * clamp(0.2 + ratio * 0.5, 0.2, 0.7)) : 0;
  return { success, stolen, attackerLossRate: clamp(0.04 + (1 - ratio) * 0.16, 0.04, 0.2), defenderLossRate: clamp(0.04 + ratio * 0.16, 0.04, 0.2) };
}
