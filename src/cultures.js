// Cultures: a culture = a palette + a building shape set + a unit set.
//
// The art kit is generated per culture by tools/art/toy_kit/build.py into
// assets/kit/<culture>/. All four cultures are built. European is the
// default and always loaded (it also supplies the shared heroes, horde and
// map props); the active culture's own pieces load on top when a match
// starts. The army each culture's camps muster is sim data and lives in
// config.js (CULTURE_ARMIES); this module is presentation only.

export const DEFAULT_CULTURE = 'european';

const KIT_ASSETS = [
  ...[1, 2, 3, 4].flatMap((t) => [`castle_t${t}`, `tower_t${t}`, `house_t${t}`, `outpost_t${t}`]),
  ...[1, 2, 3].flatMap((t) => [
    `farm_t${t}`, `mill_t${t}`, `mine_t${t}`, `workshop_t${t}`, `hero_forge_t${t}`,
    `camp_militia_t${t}`, `camp_ranger_t${t}`, `camp_sniper_t${t}`,
    `wall_t${t}_seg`, `wall_t${t}_post`, `gate_t${t}`,
  ]),
  'unit_soldier', 'unit_ranger', 'unit_sniper',
  'hero_scott', 'hero_alexander', 'hero_danny',
  'enemy_walker', 'enemy_runner', 'enemy_brute', 'enemy_spitter', 'enemy_burrower', 'enemy_sieger', 'enemy_caller',
  'prop_tree_round', 'prop_tree_pine', 'prop_rock_a', 'prop_rock_b', 'prop_cliff',
  'bridge_span',
];

// Highest authored tier per building family (higher sim tiers reuse it).
const TIERS = { castle: 4, tower: 4, house: 4, outpost: 4, farm: 3, mill: 3, mine: 3, workshop: 3, hero_forge: 3, camp: 3 };

// Pieces every culture shares (always taken from the European kit): the
// heroes keep one look in every base, the horde is the horde, and the map
// props belong to the terrain, not the base.
export const SHARED_KIT = new Set(KIT_ASSETS.filter((n) => /^(hero_|enemy_|prop_|bridge_)/.test(n)));

export const CULTURES = {
  european: {
    key: 'european', name: 'European', status: 'built',
    // Sci-fi knightly star-fortress: cream stone and steel, slate-blue roofs,
    // gold trim, blue-and-gold banners, cyan energy lamps.
    palette: {
      stone: 0xeee5cf, stone2: 0xd8ccb1, stone3: 0xb5a68a, roof: 0x3f70c8, roof2: 0x2f569e,
      trim: 0xf2c14e, banner: 0x3f70c8, accent: 0xc4473b, wood: 0x9a6b44, steel: 0x9aa6b6,
      dark: 0x343c4c, glow: 0x8ff3ff, warm: 0xffd27a, pad: 0x8ff3ff, padBuilt: 0xf2c14e,
    },
    kitPath: 'assets/kit/european',
    assets: KIT_ASSETS,
    // Highest authored tier per building family (higher sim tiers reuse it).
    tiers: TIERS,
  },
  asian: {
    key: 'asian', name: 'Asian', status: 'built',
    // Jade Lantern Dynasty: white plaster on dark stone, jade-tiled hipped
    // roofs with gold eave horns, red lacquer, warm lantern light.
    palette: {
      stone: 0xf3ece0, stone2: 0xd9c9b2, stone3: 0x5f5a66, roof: 0x2f9a80, roof2: 0x237463,
      trim: 0xe8bb48, banner: 0xc8463a, accent: 0xc8463a, wood: 0xa8392e, steel: 0xa7b0bc,
      dark: 0x2c2830, glow: 0xffb45e, warm: 0xffcf7a, pad: 0xffb45e, padBuilt: 0xe8bb48,
    },
    kitPath: 'assets/kit/asian',
    assets: KIT_ASSETS,
    tiers: TIERS,
  },
  south_american: {
    key: 'south_american', name: 'South American', status: 'built',
    // Sun Terrace Guard: limestone step terraces, teal bands, thatch, gold
    // sun discs with yellow light.
    palette: {
      stone: 0xe6dab0, stone2: 0xc9b98a, stone3: 0x8c8a66, roof: 0x1f9a8a, roof2: 0x177466,
      trim: 0xf2b632, banner: 0x1f9a8a, accent: 0xe0662a, wood: 0x8a5a36, steel: 0xa7a08a,
      dark: 0x2d2a24, glow: 0xffd34a, warm: 0xffc86a, pad: 0xffd34a, padBuilt: 0xf2b632,
    },
    kitPath: 'assets/kit/south_american',
    assets: KIT_ASSETS,
    tiers: TIERS,
  },
  middle_eastern: {
    key: 'middle_eastern', name: 'Middle Eastern', status: 'built',
    // Mirage Court: warm sandstone, turquoise domes and tile bands, pointed
    // arches, minarets, gold finials, cyan light.
    palette: {
      stone: 0xf2e0bc, stone2: 0xdcc290, stone3: 0xb48c5c, roof: 0x2fa6c4, roof2: 0x1f74a0,
      trim: 0xf0c75a, banner: 0x2f8fb0, accent: 0xb8432f, wood: 0x8a5a36, steel: 0xb0b8c4,
      dark: 0x2a2c38, glow: 0x7fe8ff, warm: 0xffd890, pad: 0x7fe8ff, padBuilt: 0xf0c75a,
    },
    kitPath: 'assets/kit/middle_eastern',
    assets: KIT_ASSETS,
    tiers: TIERS,
  },
};

export const CULTURE_ORDER = ['european', 'asian', 'south_american', 'middle_eastern'];

let ACTIVE = DEFAULT_CULTURE;

// The culture whose base is on screen (set when a match starts).
export function setActiveCulture(key) {
  ACTIVE = CULTURES[key]?.status === 'built' ? key : DEFAULT_CULTURE;
  return ACTIVE;
}
export function activeCulture() { return ACTIVE; }

export function culture(key = ACTIVE) {
  const c = CULTURES[key];
  return c && c.status === 'built' ? c : CULTURES[DEFAULT_CULTURE];
}

// Plot kind + sim tier -> kit asset name for a culture.
export function kitBuildingKey(kind, tier, c = culture()) {
  const t = Math.max(1, Number(tier) || 1);
  const fam = kind === 'hq' ? 'castle' : kind.startsWith('camp_') ? 'camp' : kind;
  const max = c.tiers[fam];
  if (!max) return null;
  const tt = Math.min(max, t);
  if (fam === 'camp') return `${kind}_t${tt}`;
  return `${fam}_t${tt}`;
}
