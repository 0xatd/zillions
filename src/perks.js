// Between-map campaign perks.
//
// After a campaign map is cleared the player picks one of three perks. The
// stack stays with that campaign run and is active on every later campaign
// map. It is match setup: the signed ticket records it, the report repeats
// it, and a replay builds the same Game from it. Offers are a pure function
// of the perks already taken, so the server can reject a list that was not
// a legal sequence of picks. Nothing here reads the simulation RNG.

import { cultureKey } from './config.js';
import { hashString } from './items.js';
import { makeRNG } from './utils.js';

const unitMul = (mods, key, field, factor) => {
  const row = mods.units[key] || (mods.units[key] = {});
  if (field === 'range' || field === 'armor' || field === 'thorns') row[field] = (row[field] || 0) + factor;
  else row[field] = (row[field] || 1) * factor;
};

// `bounds` scale the plausibility ceilings in src/match-rewards.js. A perk
// that can raise a counter has to widen that counter, or a real run is rejected.
export const PERKS = {
  war_chest: {
    key: 'war_chest', name: 'War Chest', icon: '🪙', category: 'economy',
    desc: 'Start each map with 80 more gold.',
    bounds: { coinSlack: 80 },
    apply(mods) { mods.startGold += 80; },
  },
  tithe: {
    key: 'tithe', name: 'Field Tithe', icon: '🌾', category: 'economy',
    desc: 'Buildings pay 20% more income.',
    bounds: { coins: 1.25 },
    apply(mods) { mods.income *= 1.2; },
  },
  mason_rite: {
    key: 'mason_rite', name: "Mason's Rite", icon: '🧱', category: 'economy',
    desc: 'Walls, camps and towers cost 15% less.',
    bounds: { built: 1.2 },
    apply(mods) { mods.buildCost *= 0.85; },
  },
  rampart_oath: {
    key: 'rampart_oath', name: 'Rampart Oath', icon: '🏰', category: 'defense',
    desc: 'Every structure has 25% more health.',
    apply(mods) { mods.buildingHp *= 1.25; },
  },
  gate_guns: {
    key: 'gate_guns', name: 'Gate Guns', icon: '🎯', category: 'defense',
    desc: 'Towers and outposts hit 20% harder.',
    bounds: { kills: 1.2 },
    apply(mods) { mods.towerDmg *= 1.2; },
  },
  firm_ground: {
    key: 'firm_ground', name: 'Firm Ground', icon: '🪨', category: 'defense',
    desc: 'Structures take 15% less damage.',
    apply(mods) { mods.buildingTaken *= 0.85; },
  },
  veterans_eye: {
    key: 'veterans_eye', name: "Veteran's Eye", icon: '👁️', category: 'hero',
    desc: 'Your hero deals 15% more damage.',
    bounds: { kills: 1.15 },
    apply(mods) { mods.heroDmg += 0.15; },
  },
  second_wind: {
    key: 'second_wind', name: 'Second Wind', icon: '💚', category: 'hero',
    desc: 'Your hero regenerates 1.5 more health each second.',
    apply(mods) { mods.heroRegen += 1.5; },
  },
  long_stride: {
    key: 'long_stride', name: 'Long Stride', icon: '👢', category: 'hero',
    desc: 'Your hero moves 12% faster.',
    apply(mods) { mods.heroSpeed += 0.12; },
  },
  star_oath: {
    key: 'star_oath', name: 'Star Oath', icon: '⭐', category: 'culture', culture: 'european',
    desc: 'European soldiers gain 18% health and 10% damage. Other cultures: soldiers gain 8% health.',
    bounds: { kills: 1.1 },
    apply(mods, culture) {
      if (culture === 'european') {
        unitMul(mods, 'soldier', 'hp', 1.18);
        unitMul(mods, 'soldier', 'dmg', 1.1);
      } else unitMul(mods, 'soldier', 'hp', 1.08);
    },
  },
  jade_volley: {
    key: 'jade_volley', name: 'Jade Volley', icon: '🎋', category: 'culture', culture: 'asian',
    desc: 'Jade Lantern archers fire 20% faster. Other cultures: archers fire 8% faster.',
    bounds: { kills: 1.12 },
    apply(mods, culture) {
      unitMul(mods, 'ranger', 'rof', culture === 'asian' ? 1.2 : 1.08);
    },
  },
  obsidian_sun: {
    key: 'obsidian_sun', name: 'Obsidian Sun', icon: '☀️', category: 'culture', culture: 'south_american',
    desc: 'Sun Terrace shieldbearers gain armour and thorns. Other cultures: soldiers gain a little armour.',
    bounds: { kills: 1.08 },
    apply(mods, culture) {
      if (culture === 'south_american') {
        unitMul(mods, 'soldier', 'armor', 0.12);
        unitMul(mods, 'soldier', 'thorns', 0.15);
      } else unitMul(mods, 'soldier', 'armor', 0.06);
    },
  },
  mirage_sight: {
    key: 'mirage_sight', name: 'Mirage Sight', icon: '🌙', category: 'culture', culture: 'middle_eastern',
    desc: 'Mirage longguns gain range and damage. Other cultures: snipers gain a little range.',
    bounds: { kills: 1.12 },
    apply(mods, culture) {
      if (culture === 'middle_eastern') {
        unitMul(mods, 'sniper', 'range', 1.5);
        unitMul(mods, 'sniper', 'dmg', 1.12);
      } else unitMul(mods, 'sniper', 'range', 0.6);
    },
  },
};

export const PERK_LIST = Object.values(PERKS);
export const PERK_KEYS = PERK_LIST.map((perk) => perk.key);
export const PERK_CATEGORIES = ['economy', 'defense', 'hero', 'culture'];

const blankMods = () => ({
  startGold: 0, income: 1, buildCost: 1, buildingHp: 1, buildingTaken: 1, towerDmg: 1,
  heroDmg: 0, heroHp: 0, heroSpeed: 0, heroRegen: 0, units: {},
});

// Drop unknown keys and duplicates. Order is the order the player picked them.
export function normalizePerks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const key of raw) {
    if (typeof key !== 'string' || !Object.hasOwn(PERKS, key) || out.includes(key)) continue;
    out.push(key);
    if (out.length >= PERK_KEYS.length) break;
  }
  return out;
}

export function samePerkList(a, b) {
  const left = a == null ? [] : a;
  const right = b == null ? [] : b;
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((key, index) => key === right[index]);
}

// Three perks, spread across categories when the pool allows. Deterministic
// from the perks already owned, so every client and the server agree.
export function perkOffer(owned) {
  const have = new Set(normalizePerks(owned));
  const pool = PERK_LIST.filter((perk) => !have.has(perk.key));
  if (!pool.length) return [];
  const seed = hashString(`perk:${[...have].join('.')}`) || 1;
  const rng = makeRNG(seed);
  const start = seed % PERK_CATEGORIES.length;
  const picked = [];
  for (let step = 0; step < PERK_CATEGORIES.length && picked.length < 3; step++) {
    const category = PERK_CATEGORIES[(start + step) % PERK_CATEGORIES.length];
    const choices = pool.filter((perk) => perk.category === category && !picked.includes(perk));
    if (!choices.length) continue;
    picked.push(choices[Math.floor(rng() * choices.length)]);
  }
  const rest = pool.filter((perk) => !picked.includes(perk));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  for (const perk of rest) {
    if (picked.length >= 3) break;
    picked.push(perk);
  }
  return picked.map((perk) => perk.key);
}

// A list the server will sign onto a ticket. Each entry must have been one of
// the three offered when the player owned only the perks before it, and the
// player cannot carry more perks than campaign maps they have already cleared.
// Returns the cleaned list, or null when the claim is not a legal chain.
export function legalPerkList(raw, campaignCleared = 0) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const cap = Math.max(0, Math.floor(Number(campaignCleared)) || 0);
  if (raw.length > PERK_KEYS.length || raw.length > cap) return null;
  const owned = [];
  for (const key of raw) {
    if (typeof key !== 'string' || !Object.hasOwn(PERKS, key) || owned.includes(key)) return null;
    if (!perkOffer(owned).includes(key)) return null;
    owned.push(key);
  }
  return owned;
}

// Resolved numbers the simulation reads. Culture perks look at the match culture.
export function resolvePerkMods(perks, culture = 'european') {
  const mods = blankMods();
  const which = cultureKey(culture);
  for (const key of normalizePerks(perks)) PERKS[key].apply(mods, which);
  return mods;
}

// How far the plausibility ceilings move for this exact perk list.
export function perkBoundScale(perks) {
  const scale = { kills: 1, coins: 1, built: 1, coinSlack: 0 };
  for (const key of normalizePerks(perks)) {
    const bounds = PERKS[key].bounds;
    if (!bounds) continue;
    if (bounds.kills) scale.kills *= bounds.kills;
    if (bounds.coins) scale.coins *= bounds.coins;
    if (bounds.built) scale.built *= bounds.built;
    if (bounds.coinSlack) scale.coinSlack += bounds.coinSlack;
  }
  scale.kills = Math.min(scale.kills, 3);
  scale.coins = Math.min(scale.coins, 3);
  scale.built = Math.min(scale.built, 2.5);
  return scale;
}
