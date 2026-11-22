// Deterministic marine recipes for the modular marine kit
// (assets/art-marines/kit/marine_kit.glb, built by
// tools/art/build_hero_marines.py --kit).
//
// Pure data + a seeded RNG, no three.js, so the simulation, tests and the
// Blender demo can all share it. The same seed + options always produce the
// same recipe, on every peer, which keeps co-op/online marines identical.
// Presentation only: nothing here feeds the deterministic simulation.

export const MARINE_PARTS = Object.freeze({
  body: ['light', 'standard', 'heavy'],
  helmet: ['visor', 'lenses', 'heavy', 'crest', 'hood'],
  head: ['square', 'round', 'long', 'sculpted'],
  hair: ['bald', 'buzz', 'flattop', 'mohawk', 'swept', 'topknot', 'long', 'crew'],
  beard: ['none', 'stubble', 'mustache', 'goatee', 'full', 'braided'],
  face: ['plain', 'scar', 'bionic', 'warpaint'],
  pauldron: ['dome', 'tiered', 'block', 'swept'],
  backpack: ['reactor', 'jump', 'shell', 'comms'],
  weapon: ['rifle', 'carbine', 'sniper', 'shotgun', 'hammer', 'blade'],
  emblem: ['leaf', 'crescent', 'hex', 'paw', 'claw', 'star', 'chevron', 'shield'],
});

export const SKIN_TONES = Object.freeze([0xf3cfb0, 0xe8b48e, 0xd99c74, 0xc08260, 0xa06a48, 0x82502f, 0x633a22, 0x4a2a18]);
export const HAIR_COLORS = Object.freeze([0x111111, 0x22170f, 0x3b2616, 0x5c3a1e, 0x8a5a2b, 0xb98b4e, 0xd9c49a, 0x8c8c8c, 0xd8d8d8, 0x7a2412]);

// Chapters: shared armour language, own colours and a narrow set of armour
// pieces (armour varies less than the people inside it).
export const CHAPTERS = Object.freeze({
  verdant: { name: 'Verdant Wardens', armor: 0x2f8f46, armorDark: 0x153d20, trim: 0xf3c53d, glow: 0x59e8d8, cloth: 0x1d3d26, emblem: 'leaf', pauldrons: ['dome', 'tiered'], helmets: ['visor', 'crest'] },
  cobalt: { name: 'Cobalt Veil', armor: 0x2468c9, armorDark: 0x16294a, trim: 0x2a2e36, glow: 0x8cff5e, cloth: 0x10182a, emblem: 'crescent', pauldrons: ['swept', 'dome'], helmets: ['hood', 'lenses'] },
  tidewall: { name: 'Tidewall', armor: 0x3f6b5e, armorDark: 0x1a2e29, trim: 0xc9bc86, glow: 0x8fd0ff, cloth: 0x2b3a33, emblem: 'hex', pauldrons: ['block', 'tiered'], helmets: ['heavy', 'visor'] },
  ember: { name: 'Ember Pride', armor: 0xe0781f, armorDark: 0x2a1c12, trim: 0x161412, glow: 0xffd23a, cloth: 0x161412, emblem: 'claw', pauldrons: ['swept', 'block'], helmets: ['crest', 'visor'] },
  violet: { name: 'Violet Choir', armor: 0x6a4fae, armorDark: 0x241840, trim: 0xf0d060, glow: 0x8fd6ff, cloth: 0x3a2470, emblem: 'star', pauldrons: ['tiered', 'dome'], helmets: ['lenses', 'visor'] },
  crimson: { name: 'Crimson Verdict', armor: 0xb32020, armorDark: 0x3e0a0a, trim: 0xf4f1e8, glow: 0x7aa8ff, cloth: 0x3a0c0c, emblem: 'chevron', pauldrons: ['tiered', 'block'], helmets: ['crest', 'heavy'] },
  panda: { name: 'Last Call', armor: 0x3a3a3f, armorDark: 0x161619, trim: 0xf0ece0, glow: 0xffa53a, cloth: 0xa0522d, emblem: 'paw', pauldrons: ['dome', 'block'], helmets: ['visor', 'heavy'] },
});

// Unit roles: body weight, weapons, kit and how often the helmet is on.
export const ROLES = Object.freeze({
  soldier: { body: { light: 2, standard: 6, heavy: 2 }, weapon: { rifle: 6, carbine: 3, shotgun: 1 }, backpack: { reactor: 6, comms: 2, jump: 1 }, helmet: 0.55 },
  ranger: { body: { light: 6, standard: 3 }, weapon: { carbine: 6, rifle: 2, shotgun: 1 }, backpack: { jump: 4, comms: 3, reactor: 2 }, helmet: 0.4 },
  sniper: { body: { light: 5, standard: 4 }, weapon: { sniper: 1 }, backpack: { comms: 4, reactor: 3 }, helmet: 0.45 },
  heavy: { body: { standard: 2, heavy: 8 }, weapon: { hammer: 4, shotgun: 3, blade: 2 }, backpack: { reactor: 4, shell: 3 }, helmet: 0.7 },
  melee: { body: { light: 2, standard: 5, heavy: 3 }, weapon: { blade: 5, hammer: 3 }, backpack: { jump: 4, reactor: 3 }, helmet: 0.5 },
  default: { body: { light: 3, standard: 5, heavy: 2 }, weapon: { rifle: 5, carbine: 3, sniper: 1, shotgun: 1, hammer: 1, blade: 1 }, backpack: { reactor: 5, jump: 2, comms: 2, shell: 1 }, helmet: 0.5 },
});

// FNV-1a over the string form of the inputs -> uint32 seed.
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  const s = parts.map((p) => String(p)).join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// mulberry32: tiny, fast, identical on every JS engine.
export function makeMarineRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: (list) => list[Math.floor(next() * list.length) % list.length],
    weighted: (weights) => {
      const entries = Object.entries(weights);
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [k, w] of entries) { r -= w; if (r < 0) return k; }
      return entries[entries.length - 1][0];
    },
    range: (lo, hi) => lo + (hi - lo) * next(),
  };
}

const round3 = (v) => Math.round(v * 1000) / 1000;

// Shift a 0xRRGGBB colour's brightness by f (1 = unchanged).
export function shadeHex(hex, f) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (c((hex >> 16) & 255) << 16) | (c((hex >> 8) & 255) << 8) | c(hex & 255);
}

// Build a recipe. opts: { chapter: key | palette object, role, palette:
// partial colour overrides, helmetChance, heroic }.
export function pickMarine(seed, opts = {}) {
  const rng = makeMarineRng(typeof seed === 'number' ? seed : hashSeed(seed));
  const chapter = typeof opts.chapter === 'object' && opts.chapter ? opts.chapter
    : CHAPTERS[opts.chapter] || CHAPTERS.verdant;
  const role = ROLES[opts.role] || ROLES.default;
  const pal = { ...chapter, ...(opts.palette || {}) };
  if (opts.palette?.armor != null && opts.palette.armorDark == null) pal.armorDark = shadeHex(opts.palette.armor, 0.42);
  // Fixed draw order: never reorder these calls or old seeds change look.
  const body = rng.weighted(role.body);
  const weapon = rng.weighted(role.weapon);
  const backpack = rng.weighted(role.backpack);
  const pauldron = rng.next() < 0.8 ? (chapter.pauldrons?.[0] || 'dome') : rng.pick(chapter.pauldrons || MARINE_PARTS.pauldron);
  const helmetRoll = rng.next();
  const helmetPick = rng.pick(chapter.helmets || MARINE_PARTS.helmet);
  const head = rng.pick(MARINE_PARTS.head);
  const hair = rng.weighted({ bald: 2, buzz: 5, flattop: 2, mohawk: 1, swept: 2, topknot: 1, long: 1 });
  const beard = rng.weighted({ none: 6, stubble: 3, mustache: 2, goatee: 2, full: 2, braided: 1 });
  const face = rng.weighted({ plain: 8, scar: 3, bionic: 2, warpaint: 1 });
  const skin = rng.pick(SKIN_TONES);
  const hairColor = rng.pick(HAIR_COLORS);
  const height = round3(rng.range(0.96, 1.04));
  const width = round3(rng.range(0.95, 1.05));
  const helmetChance = opts.helmetChance ?? role.helmet;
  const recipe = {
    seed: typeof seed === 'number' ? seed >>> 0 : hashSeed(seed),
    body, weapon, backpack, pauldron,
    emblem: pal.emblem || chapter.emblem || 'shield',
    helmet: helmetRoll < helmetChance ? helmetPick : null,
    head, hair, beard, face,
    height, width,
    colors: {
      armor: pal.armor, armorDark: pal.armorDark ?? shadeHex(pal.armor, 0.42), trim: pal.trim, glow: pal.glow,
      skin, hair: hairColor, cloth: pal.cloth ?? 0x2a2a2a,
    },
  };
  return recipe;
}

// Flags: on by default. URL ?marines=0 / ?marineHeroes=0 (or localStorage
// zillions_<name> = '0') opts out; '1' forces on. Safe to call in Node.
export function marineFlag(name, def = true) {
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search);
      if (q.has(name)) return q.get(name) !== '0';
    }
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(`zillions_${name}`);
      if (v === '0' || v === '1') return v === '1';
    }
  } catch { /* ignore */ }
  return def;
}
