// Deterministic item generation — the gear layer.
//
// An item is a STRING. That is the whole design, and it is what lets rolled
// loot land in a codebase whose snapshot, pack, drop command and profile blob
// all carry item keys and nothing else.
//
//   "scatter_mk2:7f3a91:62:2"     base : roll seed : item level : rarity
//
// Everything that stores, compares, serialises or drops a string keeps working
// untouched. `resolveItem()` turns the string back into the full item, and it
// is pure: the same key produces the same affixes on every peer, every
// machine, and every reload, forever. Nothing is stored but the key.
//
// A key with no ':' is an authored item from `ITEMS` in config.js. Those stay
// exactly as they were and are the uniques of this system, so every profile
// written before this module existed keeps resolving.
//
// Headless and three-free like terrain.js and meta.js —
// `scripts/item-check.mjs` drives the whole surface in plain Node.
//
// Local and global mods are kept apart, and that separation is load-bearing.
// A weapon's own "+% damage" scales THAT WEAPON. The same roll on a coat
// scales the hero. Merge the two and every weapon mod double-dips.

// ---------- stat vocabulary ----------

// The additive bag every consumer already speaks. `itemMods()` in config.js
// zeroes each of these, so adding a key here is how a new effect reaches the
// game. Keys past `income` are new with the gear layer.
export const MOD_KEYS = [
  'hp', 'regen', 'magnet', 'dmg', 'rof', 'range', 'speed', 'cdr', 'auraR',
  'troopDmg', 'towerDmg', 'buildingHp', 'income',
  // gear layer
  'critChance', 'critMult', 'armor', 'evadeChance', 'thorns',
  // attributes — gate weapon bases and pay out small stats of their own
  'frame', 'reflex', 'signal',
  // increased damage of one type, additive with `dmg`
  'kinetic', 'thermal', 'shock', 'void',
];

// Four types, not five. This is the smallest number where a scattergun rolls
// differently from a psi-focus and a resistance is worth reading. Every
// authored weapon and every enemy defaults to kinetic with no resistance, so
// introducing the axis changes no existing number.
export const DAMAGE_TYPES = ['kinetic', 'thermal', 'shock', 'void'];

// A resistance can never make a target immune. The cap is what keeps a
// resistant enemy a reason to switch weapons rather than a wall.
export const RESIST_CAP = 0.75;
// How much armour void damage still has to chew through.
export const VOID_ARMOR_SHARE = 0.35;

export const DAMAGE_TYPE_INFO = {
  kinetic: { name: 'Kinetic', icon: '⦿', color: '#c9cdd6', desc: 'Mass and velocity. Nothing exotic, nothing resisted.' },
  thermal: { name: 'Thermal', icon: '🔥', color: '#e08a4b', desc: 'Burn-through. Strong against massed soft targets.' },
  shock: { name: 'Shock', icon: '⚡', color: '#6fb8e8', desc: 'Arc discharge. Strong against armoured and mechanical.' },
  void: { name: 'Void', icon: '☲', color: '#a07fd0', desc: 'Unmaking. Ignores a share of armour, resisted by little.' },
};

export const ATTRIBUTES = {
  frame: { key: 'frame', name: 'Frame', icon: '🦴', desc: 'Bone, plate and load-bearing mass. Heavy weapons want it.' },
  reflex: { key: 'reflex', name: 'Reflex', icon: '🌀', desc: 'Nerve speed and hand. Precision weapons want it.' },
  signal: { key: 'signal', name: 'Signal', icon: '📶', desc: 'Bandwidth into the warp. Focus weapons want it.' },
};

// ---------- rarity ----------

// Rarity is an affix budget and nothing more. It grants no hidden multiplier.
export const RARITIES = {
  1: { id: 1, key: 'normal', name: 'Standard', color: '#c9cdd6', prefixes: 0, suffixes: 0 },
  2: { id: 2, key: 'magic', name: 'Marked', color: '#6fa8dc', prefixes: 1, suffixes: 1 },
  3: { id: 3, key: 'rare', name: 'Prime', color: '#e0b34b', prefixes: 3, suffixes: 3 },
};
export const RARITY_BY_KEY = { normal: 1, magic: 2, rare: 3 };

export const SLOTS = ['weapon', 'offhand', 'armor', 'implant'];

// Where a character can put each slot. Two implant sockets share one pool.
// Two weapon sets, one body. Armour and implants are worn once; the weapon and
// off-hand exist twice, and a character swaps between them mid-fight.
export const EQUIP_SLOTS = ['weapon', 'offhand', 'weapon2', 'offhand2', 'armor', 'implant1', 'implant2'];
export const WEAPON_SETS = [
  { index: 0, weapon: 'weapon', offhand: 'offhand', name: 'SET I' },
  { index: 1, weapon: 'weapon2', offhand: 'offhand2', name: 'SET II' },
];
export const slotPool = (equipSlot) => {
  if (equipSlot === 'implant1' || equipSlot === 'implant2') return 'implant';
  if (equipSlot === 'weapon2') return 'weapon';
  if (equipSlot === 'offhand2') return 'offhand';
  return equipSlot;
};
// Which slots belong to a given weapon set — used to decide what a swap swaps.
export const setSlots = (set) => WEAPON_SETS[set === 1 ? 1 : 0];

// One weapon set's resolved Lattice payload. A payload is { mods, doctrines };
// older shapes carried the bag alone, and a snapshot written before this can
// still hold one, so both are read here rather than at every call site.
export function latticeMods(treeSets, set = 0, fallback = null) {
  const payload = treeSets && treeSets[set === 1 ? 1 : 0];
  if (!payload) return fallback;
  return payload.mods || payload;
}

// The doctrines the DRAWN set carries. A doctrine pinned to the sheathed set
// must not be in force, which is why this follows the set rather than reading
// one unconditional list.
export function latticeDoctrines(treeSets, set = 0, fallback = null) {
  const payload = treeSets && treeSets[set === 1 ? 1 : 0];
  if (payload && Array.isArray(payload.doctrines)) return [...payload.doctrines];
  return fallback ? [...fallback] : [];
}

// The keys whose GLOBAL mods apply right now. Only the drawn set's weapon and
// off-hand count — the sheathed set contributes nothing, which is what keeps
// two sets from being strictly better than one.
export function equippedKeys(equipment, set = 0) {
  if (!equipment) return [];
  const { weapon, offhand } = setSlots(set);
  return [equipment[weapon], equipment[offhand], equipment.armor, equipment.implant1, equipment.implant2]
    .filter(Boolean);
}

// Every slot a given item could go in, nearest-empty-first. A weapon can go to
// either set, an implant to either socket.
export function slotsForPool(pool) {
  if (pool === 'weapon') return ['weapon', 'weapon2'];
  if (pool === 'offhand') return ['offhand', 'offhand2'];
  if (pool === 'implant') return ['implant1', 'implant2'];
  return [pool];
}

// ---------- bases ----------
//
// A base is the frame an item rolls on: what it is before anything is rolled.
// `w` holds the weapon block, and it is the block that used to live inside a
// hero definition. `req` is the attribute a character needs to wield it, and
// that requirement is what makes the Lattice's attribute walk a decision
// rather than a stat tax.
//
// `types` splits base damage across DAMAGE_TYPES and must sum to 1.

export const ITEM_BASES = {
  // --- weapons: scatterguns. Short, brutal, splash. Frame. ---
  scatter_mk1: {
    slot: 'weapon', name: 'Scattergun', icon: '💥', class: 'scattergun', ilvl: 1, req: { frame: 8 },
    w: { dmg: 44, rof: 0.55, range: 4.2, splash: 1.6, shotgun: true, noise: 8, critChance: 0.05, critMult: 1.75, types: { kinetic: 1 } },
  },
  scatter_mk2: {
    slot: 'weapon', name: 'Breaching Scattergun', icon: '💥', class: 'scattergun', ilvl: 24, req: { frame: 22 },
    w: { dmg: 68, rof: 0.55, range: 4.5, splash: 1.8, shotgun: true, noise: 8, critChance: 0.05, critMult: 1.75, types: { kinetic: 1 } },
  },
  scatter_mk3: {
    slot: 'weapon', name: 'Siege Scattergun', icon: '💥', class: 'scattergun', ilvl: 52, req: { frame: 44 },
    w: { dmg: 104, rof: 0.52, range: 4.8, splash: 2.1, shotgun: true, noise: 9, critChance: 0.06, critMult: 1.8, types: { kinetic: 1 } },
  },

  // --- weapons: marksman rifles. Long, precise, no splash. Reflex. ---
  marksman_mk1: {
    slot: 'weapon', name: 'Marksman Rifle', icon: '🎯', class: 'marksman', ilvl: 1, req: { reflex: 8 },
    w: { dmg: 36, rof: 0.8, range: 8.5, noise: 5, critChance: 0.12, critMult: 2.0, types: { kinetic: 1 } },
  },
  marksman_mk2: {
    slot: 'weapon', name: 'Long Marksman Rifle', icon: '🎯', class: 'marksman', ilvl: 24, req: { reflex: 22 },
    w: { dmg: 55, rof: 0.8, range: 9.5, noise: 5, critChance: 0.14, critMult: 2.0, types: { kinetic: 1 } },
  },
  marksman_mk3: {
    slot: 'weapon', name: 'Anti-Materiel Rifle', icon: '🎯', class: 'marksman', ilvl: 52, req: { reflex: 44 },
    w: { dmg: 88, rof: 0.72, range: 11, noise: 6, critChance: 0.16, critMult: 2.2, types: { kinetic: 1 } },
  },

  // --- weapons: chainblades. Melee, fast, no noise. Frame. ---
  chainblade_mk1: {
    slot: 'weapon', name: 'Chainblade', icon: '🗡️', class: 'chainblade', ilvl: 1, req: { frame: 8 },
    w: { dmg: 40, rof: 1.15, range: 1.9, melee: true, noise: 0, critChance: 0.08, critMult: 1.8, types: { kinetic: 1 } },
  },
  chainblade_mk2: {
    slot: 'weapon', name: 'Reaver Chainblade', icon: '🗡️', class: 'chainblade', ilvl: 24, req: { frame: 22 },
    w: { dmg: 62, rof: 1.2, range: 2.0, melee: true, noise: 0, critChance: 0.09, critMult: 1.85, types: { kinetic: 1 } },
  },
  chainblade_mk3: {
    slot: 'weapon', name: 'Executioner Chainblade', icon: '🗡️', class: 'chainblade', ilvl: 52, req: { frame: 44 },
    w: { dmg: 96, rof: 1.25, range: 2.1, melee: true, noise: 0, critChance: 0.1, critMult: 1.95, types: { kinetic: 1 } },
  },

  // --- weapons: sidearms. Mid range, very fast, low damage. Reflex. ---
  sidearm_mk1: {
    slot: 'weapon', name: 'Sidearm', icon: '🔫', class: 'sidearm', ilvl: 1, req: { reflex: 6 },
    w: { dmg: 24, rof: 1.6, range: 5.5, noise: 4, critChance: 0.1, critMult: 1.8, types: { kinetic: 1 } },
  },
  sidearm_mk2: {
    slot: 'weapon', name: 'Machine Pistol', icon: '🔫', class: 'sidearm', ilvl: 24, req: { reflex: 20 },
    w: { dmg: 37, rof: 1.7, range: 5.8, noise: 4, critChance: 0.11, critMult: 1.8, types: { kinetic: 1 } },
  },

  // --- weapons: launchers. Slow, huge splash, thermal. Frame. ---
  launcher_mk1: {
    slot: 'weapon', name: 'Thermal Launcher', icon: '🚀', class: 'launcher', ilvl: 14, req: { frame: 18 },
    w: { dmg: 70, rof: 0.34, range: 7.5, splash: 3.0, noise: 12, critChance: 0.03, critMult: 1.6, types: { thermal: 0.75, kinetic: 0.25 } },
  },
  launcher_mk2: {
    slot: 'weapon', name: 'Firestorm Launcher', icon: '🚀', class: 'launcher', ilvl: 46, req: { frame: 40 },
    w: { dmg: 118, rof: 0.34, range: 8, splash: 3.4, noise: 13, critChance: 0.03, critMult: 1.6, types: { thermal: 0.85, kinetic: 0.15 } },
  },

  // --- weapons: arc nodes. Mid, shock, armour-shredding. Signal. ---
  arcnode_mk1: {
    slot: 'weapon', name: 'Arc Node', icon: '⚡', class: 'arcnode', ilvl: 10, req: { signal: 14 },
    w: { dmg: 33, rof: 1.0, range: 6.2, splash: 1.2, noise: 6, critChance: 0.07, critMult: 1.75, types: { shock: 0.8, kinetic: 0.2 } },
  },
  arcnode_mk2: {
    slot: 'weapon', name: 'Tempest Node', icon: '⚡', class: 'arcnode', ilvl: 42, req: { signal: 38 },
    w: { dmg: 58, rof: 1.05, range: 6.8, splash: 1.5, noise: 6, critChance: 0.08, critMult: 1.8, types: { shock: 0.85, kinetic: 0.15 } },
  },

  // --- weapons: psi-focuses. Mid, void, ignores armour. Signal. ---
  psifocus_mk1: {
    slot: 'weapon', name: 'Psi-Focus', icon: '🔮', class: 'psifocus', ilvl: 10, req: { signal: 14 },
    w: { dmg: 38, rof: 0.85, range: 6.5, noise: 2, critChance: 0.06, critMult: 1.9, types: { void: 0.85, shock: 0.15 } },
  },
  psifocus_mk2: {
    slot: 'weapon', name: 'Abyssal Focus', icon: '🔮', class: 'psifocus', ilvl: 42, req: { signal: 38 },
    w: { dmg: 64, rof: 0.88, range: 7, noise: 2, critChance: 0.07, critMult: 2.0, types: { void: 0.9, shock: 0.1 } },
  },

  // --- off-hands ---
  buckler: { slot: 'offhand', name: 'Breaching Buckler', icon: '🛡️', ilvl: 1, req: { frame: 6 }, implicit: { armor: 0.06 } },
  bulwark_shield: { slot: 'offhand', name: 'Bulwark Shield', icon: '🛡️', ilvl: 30, req: { frame: 28 }, implicit: { armor: 0.11, hp: 40 } },
  spotter_drone: { slot: 'offhand', name: 'Spotter Drone', icon: '🛰️', ilvl: 8, req: { reflex: 12 }, implicit: { range: 0.8 } },
  hunter_drone: { slot: 'offhand', name: 'Hunter Drone', icon: '🛰️', ilvl: 36, req: { reflex: 32 }, implicit: { range: 1.2, critChance: 0.04 } },
  capacitor: { slot: 'offhand', name: 'Warp Capacitor', icon: '🔋', ilvl: 8, req: { signal: 12 }, implicit: { cdr: 0.08 } },
  resonator: { slot: 'offhand', name: 'Deep Resonator', icon: '🔋', ilvl: 36, req: { signal: 32 }, implicit: { cdr: 0.13, auraR: 0.1 } },

  // --- armour ---
  flak_plate: { slot: 'armor', name: 'Flak Plate', icon: '🦺', ilvl: 1, req: { frame: 6 }, implicit: { hp: 60 } },
  siege_plate: { slot: 'armor', name: 'Siege Plate', icon: '🦺', ilvl: 28, req: { frame: 26 }, implicit: { hp: 150, armor: 0.05 } },
  weave_coat: { slot: 'armor', name: 'Weave Coat', icon: '🧥', ilvl: 1, req: { reflex: 6 }, implicit: { evadeChance: 0.05 } },
  ghost_coat: { slot: 'armor', name: 'Ghost Coat', icon: '🧥', ilvl: 28, req: { reflex: 26 }, implicit: { evadeChance: 0.09, speed: 0.05 } },
  powered_shell: { slot: 'armor', name: 'Powered Shell', icon: '🤖', ilvl: 40, req: { frame: 34 }, implicit: { hp: 220, armor: 0.09, speed: -0.05 } },
  signal_shroud: { slot: 'armor', name: 'Signal Shroud', icon: '👘', ilvl: 28, req: { signal: 26 }, implicit: { hp: 70, cdr: 0.06 } },

  // --- implants ---
  neural_shunt: { slot: 'implant', name: 'Neural Shunt', icon: '🧠', ilvl: 1, implicit: { rof: 0.05 } },
  servo_spine: { slot: 'implant', name: 'Servo Spine', icon: '🦿', ilvl: 1, implicit: { speed: 0.05 } },
  reactor_node: { slot: 'implant', name: 'Reactor Node', icon: '⚛️', ilvl: 16, implicit: { cdr: 0.07 } },
  marrow_forge: { slot: 'implant', name: 'Marrow Forge', icon: '🩸', ilvl: 16, implicit: { regen: 2 } },
  target_lattice: { slot: 'implant', name: 'Target Lattice', icon: '🔭', ilvl: 34, implicit: { critChance: 0.05 } },
  thermal_core: { slot: 'implant', name: 'Thermal Core', icon: '🔥', ilvl: 34, implicit: { thermal: 0.12 } },
  storm_core: { slot: 'implant', name: 'Storm Core', icon: '⚡', ilvl: 34, implicit: { shock: 0.12 } },
  void_core: { slot: 'implant', name: 'Void Core', icon: '☲', ilvl: 34, implicit: { void: 0.12 } },
};

export const WEAPON_CLASSES = {
  scattergun: { key: 'scattergun', name: 'Scattergun', icon: '💥', attr: 'frame', desc: 'Short range, wide blast, loud.' },
  marksman: { key: 'marksman', name: 'Marksman', icon: '🎯', attr: 'reflex', desc: 'Long range, high crit, one target.' },
  chainblade: { key: 'chainblade', name: 'Chainblade', icon: '🗡️', attr: 'frame', desc: 'Melee, fast, silent.' },
  sidearm: { key: 'sidearm', name: 'Sidearm', icon: '🔫', attr: 'reflex', desc: 'Mid range, very fast, light.' },
  launcher: { key: 'launcher', name: 'Launcher', icon: '🚀', attr: 'frame', desc: 'Slow, enormous blast, thermal.' },
  arcnode: { key: 'arcnode', name: 'Arc Node', icon: '⚡', attr: 'signal', desc: 'Mid range, shock, chains through armour.' },
  psifocus: { key: 'psifocus', name: 'Psi-Focus', icon: '🔮', attr: 'signal', desc: 'Mid range, void, unmakes armour.' },
  signature: { key: 'signature', name: 'Signature', icon: '⭐', attr: null, desc: 'The weapon this hero was written with.' },
};

export const BASES_BY_SLOT = (() => {
  const out = { weapon: [], offhand: [], armor: [], implant: [] };
  for (const [key, base] of Object.entries(ITEM_BASES)) {
    if (out[base.slot]) out[base.slot].push(key);
  }
  return out;
})();

// ---------- affixes ----------
//
// Tiers are gated by item level. A tier entry is `[minIlvl, mods]`, and the
// generator takes the best tier the item level allows. That single number is
// what ties loot quality to Threat and world tier without a second system.
//
// `local: true` means the roll modifies the WEAPON it sits on, not the hero.
// A weapon's "+% damage" is local; a coat's is global. Merge them and every
// weapon mod double-dips against itself.
//
// `group` stops one item rolling the same concept twice.

const P = 'prefix', S = 'suffix';

export const AFFIXES = [
  // --- weapon prefixes (local) ---
  { id: 'w_heavy', kind: P, group: 'wdmg', slots: ['weapon'], local: true, word: 'Heavy',
    t: [[1, { dmg: 0.15 }], [16, { dmg: 0.24 }], [38, { dmg: 0.34 }], [62, { dmg: 0.46 }]] },
  { id: 'w_tuned', kind: P, group: 'wrof', slots: ['weapon'], local: true, word: 'Tuned',
    t: [[1, { rof: 0.1 }], [16, { rof: 0.16 }], [38, { rof: 0.23 }], [62, { rof: 0.31 }]] },
  { id: 'w_bored', kind: P, group: 'wrange', slots: ['weapon'], local: true, word: 'Long',
    t: [[1, { range: 0.5 }], [20, { range: 0.9 }], [45, { range: 1.4 }]] },
  { id: 'w_honed', kind: P, group: 'wcrit', slots: ['weapon'], local: true, word: 'Honed',
    t: [[8, { critChance: 0.03 }], [26, { critChance: 0.05 }], [50, { critChance: 0.08 }]] },
  { id: 'w_incendiary', kind: P, group: 'wtype', slots: ['weapon'], local: true, word: 'Incendiary',
    t: [[10, { thermal: 0.12 }], [30, { thermal: 0.2 }], [55, { thermal: 0.3 }]] },
  { id: 'w_charged', kind: P, group: 'wtype', slots: ['weapon'], local: true, word: 'Charged',
    t: [[10, { shock: 0.12 }], [30, { shock: 0.2 }], [55, { shock: 0.3 }]] },
  { id: 'w_hollow', kind: P, group: 'wtype', slots: ['weapon'], local: true, word: 'Hollow',
    t: [[10, { void: 0.12 }], [30, { void: 0.2 }], [55, { void: 0.3 }]] },

  // --- weapon suffixes (local) ---
  { id: 'w_of_murder', kind: S, group: 'wcritm', slots: ['weapon'], local: true, word: 'of Murder',
    t: [[12, { critMult: 0.2 }], [34, { critMult: 0.35 }], [58, { critMult: 0.5 }]] },
  { id: 'w_of_spread', kind: S, group: 'wsplash', slots: ['weapon'], local: true, word: 'of the Spread',
    t: [[14, { splash: 0.3 }], [40, { splash: 0.55 }]] },

  // --- global prefixes ---
  { id: 'g_plated', kind: P, group: 'ghp', slots: ['offhand', 'armor', 'implant'], word: 'Plated',
    t: [[1, { hp: 45 }], [16, { hp: 85 }], [38, { hp: 140 }], [62, { hp: 210 }]] },
  { id: 'g_braced', kind: P, group: 'garmor', slots: ['offhand', 'armor'], word: 'Braced',
    t: [[10, { armor: 0.04 }], [32, { armor: 0.07 }], [56, { armor: 0.1 }]] },
  { id: 'g_wired', kind: P, group: 'grof', slots: ['implant', 'offhand'], word: 'Wired',
    t: [[1, { rof: 0.06 }], [22, { rof: 0.1 }], [48, { rof: 0.15 }]] },
  { id: 'g_savage', kind: P, group: 'gdmg', slots: ['offhand', 'armor', 'implant'], word: 'Savage',
    t: [[6, { dmg: 0.07 }], [26, { dmg: 0.12 }], [52, { dmg: 0.18 }]] },
  { id: 'g_hardened', kind: P, group: 'gregen', slots: ['armor', 'implant'], word: 'Hardened',
    t: [[1, { regen: 1.2 }], [24, { regen: 2.4 }], [50, { regen: 4 }]] },

  // --- global suffixes ---
  { id: 'g_of_haste', kind: S, group: 'gspeed', slots: ['offhand', 'armor', 'implant'], word: 'of Haste',
    t: [[1, { speed: 0.04 }], [20, { speed: 0.07 }], [46, { speed: 0.11 }]] },
  { id: 'g_of_focus', kind: S, group: 'gcdr', slots: ['offhand', 'armor', 'implant'], word: 'of Focus',
    t: [[8, { cdr: 0.06 }], [28, { cdr: 0.1 }], [54, { cdr: 0.15 }]] },
  { id: 'g_of_greed', kind: S, group: 'gmagnet', slots: ['offhand', 'implant'], word: 'of Greed',
    t: [[1, { magnet: 1 }], [26, { magnet: 2 }]] },
  { id: 'g_of_ghosts', kind: S, group: 'gevade', slots: ['armor', 'offhand'], word: 'of Ghosts',
    t: [[12, { evadeChance: 0.04 }], [36, { evadeChance: 0.07 }]] },
  { id: 'g_of_thorns', kind: S, group: 'gthorns', slots: ['armor', 'offhand'], word: 'of Thorns',
    t: [[16, { thorns: 0.12 }], [44, { thorns: 0.22 }]] },
  { id: 'g_of_the_beacon', kind: S, group: 'gaura', slots: ['implant', 'offhand'], word: 'of the Beacon',
    t: [[10, { auraR: 0.15 }], [38, { auraR: 0.25 }]] },
  { id: 'g_of_the_host', kind: S, group: 'gtroop', slots: ['armor', 'implant'], word: 'of the Host',
    t: [[14, { troopDmg: 0.08 }], [42, { troopDmg: 0.14 }]] },
  { id: 'g_of_the_frame', kind: S, group: 'gattr', slots: ['armor', 'offhand', 'implant', 'weapon'], word: 'of the Frame',
    t: [[1, { frame: 6 }], [24, { frame: 12 }], [50, { frame: 20 }]] },
  { id: 'g_of_reflex', kind: S, group: 'gattr', slots: ['armor', 'offhand', 'implant', 'weapon'], word: 'of Reflex',
    t: [[1, { reflex: 6 }], [24, { reflex: 12 }], [50, { reflex: 20 }]] },
  { id: 'g_of_signal', kind: S, group: 'gattr', slots: ['armor', 'offhand', 'implant', 'weapon'], word: 'of Signal',
    t: [[1, { signal: 6 }], [24, { signal: 12 }], [50, { signal: 20 }]] },
];

export const AFFIX_BY_ID = new Map(AFFIXES.map((a) => [a.id, a]));

// ---------- deterministic roll ----------
//
// Its own hash and its own stream. This never touches the simulation random
// source, so generating an item cannot move a lockstep peer's RNG by one step.

// Table lookups that take an untrusted key. `ITEM_BASES['constructor']` finds
// a function on Object.prototype and reads as a legitimate base, so every
// lookup driven by profile or snapshot data goes through here.
export const hasOwn = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);

export function hashString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function stream(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Highest tier the item level allows. Tiers are authored low to high.
function bestTier(affix, ilvl) {
  let picked = null;
  for (const [min, mods] of affix.t) {
    if (ilvl >= min) picked = mods;
  }
  return picked;
}

const clampIlvl = (v) => Math.max(1, Math.min(100, Math.floor(Number(v) || 1)));
const clampRarity = (v) => (RARITIES[Math.floor(Number(v))] && Math.floor(Number(v)) >= 1 && Math.floor(Number(v)) <= 3 ? Math.floor(Number(v)) : 1);

// Build a key. `seed` is any string or number — derive it from drop context
// (run seed, kill, world) so an item that could not have dropped from a real
// run stays detectable later, without server authority today.
export function rollItemKey(baseKey, seed, ilvl = 1, rarity = 2) {
  if (!hasOwn(ITEM_BASES, baseKey)) return null;
  const s = (typeof seed === 'number' ? seed >>> 0 : hashString(seed)) >>> 0;
  return `${baseKey}:${s.toString(36)}:${clampIlvl(ilvl)}:${clampRarity(rarity)}`;
}

export function parseItemKey(key) {
  const str = String(key || '');
  if (!str.includes(':')) return null;
  const [baseKey, seedRaw, ilvlRaw, rarityRaw] = str.split(':');
  if (!hasOwn(ITEM_BASES, baseKey)) return null;
  const seed = parseInt(seedRaw, 36);
  if (!Number.isFinite(seed)) return null;
  return { baseKey, seed: seed >>> 0, ilvl: clampIlvl(ilvlRaw), rarity: clampRarity(rarityRaw) };
}

export const isRolledKey = (key) => parseItemKey(key) !== null;

// ---------- resolve ----------
//
// The one function everything else calls. Pure, cached, and total: an
// unparseable key returns null rather than throwing, because a bad key must
// never cost someone their character.

const RESOLVE_CACHE = new Map();
const CACHE_LIMIT = 4096;

export function emptyMods() {
  const m = {};
  for (const k of MOD_KEYS) m[k] = 0;
  return m;
}

function addMods(target, src, scale = 1) {
  for (const [k, v] of Object.entries(src || {})) {
    target[k] = (target[k] || 0) + v * scale;
  }
  return target;
}

function pickAffixes(base, parsed) {
  const rarity = RARITIES[parsed.rarity];
  const rng = stream(parsed.seed ^ hashString(parsed.baseKey));
  const pool = AFFIXES.filter((a) => a.slots.includes(base.slot) && bestTier(a, parsed.ilvl));
  const used = new Set();
  const out = [];
  for (const kind of [P, S]) {
    const want = kind === P ? rarity.prefixes : rarity.suffixes;
    // Rare items roll a variable count up to their budget, so two rares of the
    // same base are not the same item with different numbers.
    const count = want <= 1 ? want : 1 + Math.floor(rng() * want);
    const candidates = pool.filter((a) => a.kind === kind);
    for (let i = 0; i < count && candidates.length; i++) {
      const open = candidates.filter((a) => !used.has(a.group));
      if (!open.length) break;
      const affix = open[Math.floor(rng() * open.length)];
      used.add(affix.group);
      out.push({ id: affix.id, word: affix.word, kind: affix.kind, local: !!affix.local, mods: bestTier(affix, parsed.ilvl) });
    }
  }
  return out;
}

function buildName(base, affixes, rarity) {
  if (rarity === 1 || !affixes.length) return base.name;
  const prefix = affixes.find((a) => a.kind === P);
  const suffix = affixes.find((a) => a.kind === S);
  let name = base.name;
  // A base can already contain the prefix's word — "Long Marksman Rifle"
  // rolling the "Long" prefix reads as "Long Long Marksman Rifle". Skip the
  // word rather than stutter; the roll still shows in the item's lines.
  const words = new Set(base.name.toLowerCase().split(/\s+/));
  if (prefix && !words.has(prefix.word.toLowerCase())) name = `${prefix.word} ${name}`;
  if (suffix) name = `${name} ${suffix.word}`;
  return name;
}

// Resolve a key to a full item. Returns null for authored keys — callers fall
// back to the `ITEMS` table in config.js, which is what keeps every profile
// written before this module kept working.
export function resolveItem(key) {
  if (RESOLVE_CACHE.has(key)) return RESOLVE_CACHE.get(key);
  const parsed = parseItemKey(key);
  if (!parsed) return null;
  const base = ITEM_BASES[parsed.baseKey];
  const affixes = pickAffixes(base, parsed);
  const rarity = RARITIES[parsed.rarity];

  // Global mods reach the hero. Local mods stay on the weapon.
  const mods = emptyMods();
  const local = {};
  addMods(mods, base.implicit || {});
  for (const affix of affixes) {
    if (affix.local) addMods(local, affix.mods);
    else addMods(mods, affix.mods);
  }

  const item = {
    key, baseKey: parsed.baseKey, base, slot: base.slot,
    name: buildName(base, affixes, parsed.rarity),
    icon: base.icon, ilvl: parsed.ilvl,
    rarity: parsed.rarity, rarityName: rarity.name, rarityColor: rarity.color,
    req: base.req || null, affixes, mods, local,
    weapon: null,
    rolled: true,
  };
  // The weapon block carries the ITEM's name, not the base's — the HUD and the
  // swap message name what the hero is actually holding.
  if (base.w) {
    item.weapon = applyLocal(base.w, local);
    item.weapon.name = item.name;
    item.weapon.icon = base.icon;
    item.weapon.key = key;
    item.weapon.class = base.class;
  }
  if (RESOLVE_CACHE.size > CACHE_LIMIT) RESOLVE_CACHE.clear();
  RESOLVE_CACHE.set(key, item);
  return item;
}

// A weapon's own rolls resolve against its own base, once, here. Nothing
// downstream re-applies them, which is the whole point of the local split.
export function applyLocal(w, local = {}) {
  const out = { ...w, types: { ...(w.types || { kinetic: 1 }) } };
  if (local.dmg) out.dmg = out.dmg * (1 + local.dmg);
  if (local.rof) out.rof = out.rof * (1 + local.rof);
  if (local.range) out.range = out.range + local.range;
  if (local.splash) out.splash = (out.splash || 0) + local.splash;
  if (local.critChance) out.critChance = (out.critChance || 0) + local.critChance;
  if (local.critMult) out.critMult = (out.critMult || 1.75) + local.critMult;
  for (const type of DAMAGE_TYPES) {
    if (local[type]) out.types[type] = (out.types[type] || 0) + local[type];
  }
  // Renormalise the split so a type roll shifts the mix without inventing
  // damage. Total output is the weapon's damage number and nothing else.
  const total = DAMAGE_TYPES.reduce((sum, t) => sum + (out.types[t] || 0), 0);
  if (total > 0) {
    for (const type of DAMAGE_TYPES) {
      if (out.types[type]) out.types[type] = out.types[type] / total;
      else delete out.types[type];
    }
  } else {
    out.types = { kinetic: 1 };
  }
  return out;
}

// Does this character meet the base's attribute requirement? `attrs` is any
// bag carrying frame/reflex/signal — gear mods, tree mods, or their sum.
export function meetsRequirement(item, attrs = {}) {
  const req = (item && item.req) || null;
  if (!req) return true;
  for (const [key, need] of Object.entries(req)) {
    if ((Number(attrs[key]) || 0) < need) return false;
  }
  return true;
}

export function requirementText(item) {
  const req = (item && item.req) || null;
  if (!req) return '';
  return Object.entries(req)
    .map(([key, need]) => `${need} ${ATTRIBUTES[key]?.name || key}`)
    .join(', ');
}

// Human-readable lines for one item, for the equipment screen and tooltips.
export function itemLines(item) {
  if (!item) return [];
  const lines = [];
  const label = (k, v) => {
    switch (k) {
      case 'hp': return `+${Math.round(v)} max HP`;
      case 'regen': return `+${v.toFixed(1)} HP/s`;
      case 'magnet': return `+${Math.round(v)} coin pickup range`;
      case 'dmg': return `+${Math.round(v * 100)}% damage`;
      case 'rof': return `+${Math.round(v * 100)}% attack rate`;
      case 'range': return `+${v.toFixed(1)} attack range`;
      case 'speed': return `${v < 0 ? '' : '+'}${Math.round(v * 100)}% move speed`;
      case 'cdr': return `special recharges ${Math.round(v * 100)}% faster`;
      case 'auraR': return `+${Math.round(v * 100)}% aura radius`;
      case 'troopDmg': return `troops +${Math.round(v * 100)}% damage`;
      case 'towerDmg': return `towers +${Math.round(v * 100)}% damage`;
      case 'buildingHp': return `structures +${Math.round(v * 100)}% HP`;
      case 'income': return `+${Math.round(v * 100)}% income`;
      case 'critChance': return `+${Math.round(v * 100)}% critical chance`;
      case 'critMult': return `+${Math.round(v * 100)}% critical damage`;
      case 'armor': return `+${Math.round(v * 100)}% armour`;
      case 'evadeChance': return `+${Math.round(v * 100)}% evasion`;
      case 'thorns': return `reflects ${Math.round(v * 100)}% of damage taken`;
      case 'splash': return `+${v.toFixed(1)} blast radius`;
      case 'frame': case 'reflex': case 'signal': return `+${Math.round(v)} ${ATTRIBUTES[k].name}`;
      case 'kinetic': case 'thermal': case 'shock': case 'void':
        return `+${Math.round(v * 100)}% ${DAMAGE_TYPE_INFO[k].name.toLowerCase()} share`;
      default: return `+${v} ${k}`;
    }
  };
  for (const [k, v] of Object.entries(item.mods || {})) {
    if (v) lines.push(label(k, v));
  }
  for (const affix of item.affixes || []) {
    if (!affix.local) continue;
    for (const [k, v] of Object.entries(affix.mods || {})) lines.push(`${label(k, v)} (this weapon)`);
  }
  return lines;
}

// Sum the GLOBAL mods of a set of rolled keys. Authored keys resolve to null
// here and are summed by `itemMods()` in config.js from the `ITEMS` table.
export function rolledMods(keys) {
  const out = emptyMods();
  for (const key of keys || []) {
    const item = resolveItem(key);
    if (item) addMods(out, item.mods);
  }
  return out;
}

// ---------- loot ----------
//
// What a world drops, and how good it is. Both answers are one number and one
// deterministic roll, so the simulation can ask for an item without carrying
// a loot system of its own.

// How deep a world's gear rolls. Item level is the single lever that ties loot
// quality to where the player is, and it is why affix tiers exist at all.
export function worldItemLevel(levelId, level = null, diff = null) {
  const base = Math.max(1, Math.min(100, Math.round((Number(levelId) || 1) * 1.6)));
  const byMult = level && level.mult ? Math.round((level.mult - 1) * 34) : 0;
  const byDiff = diff && diff.mult ? Math.round((diff.mult - 1) * 12) : 0;
  return Math.max(1, Math.min(100, base + byMult + byDiff));
}

// Roll one item key. `roll` is a caller-supplied 0..1 from the SIMULATION's
// random source — that is what keeps peers agreeing on which base dropped —
// while the affixes come from `seed`, which never touches that source.
export function rollLootKey(seed, ilvl = 1, rarity = 2, roll = 0) {
  const level = Math.max(1, Math.min(100, Math.round(Number(ilvl) || 1)));
  // Only offer bases the world is deep enough to have made.
  const legal = Object.keys(ITEM_BASES).filter((key) => ITEM_BASES[key].ilvl <= level);
  if (!legal.length) return null;
  const idx = Math.min(legal.length - 1, Math.floor(Math.max(0, Math.min(0.999999, roll)) * legal.length));
  return rollItemKey(legal[idx], seed, level, rarity);
}

// The same roll, restricted to one slot — for rewards that should be a weapon,
// or a boss that should hand back armour.
export function rollLootKeyForSlot(slot, seed, ilvl = 1, rarity = 2, roll = 0) {
  const level = Math.max(1, Math.min(100, Math.round(Number(ilvl) || 1)));
  const legal = (BASES_BY_SLOT[slot] || []).filter((key) => ITEM_BASES[key].ilvl <= level);
  if (!legal.length) return null;
  const idx = Math.min(legal.length - 1, Math.floor(Math.max(0, Math.min(0.999999, roll)) * legal.length));
  return rollItemKey(legal[idx], seed, level, rarity);
}
