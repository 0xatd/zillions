// Cultures: a culture = a palette + a building shape set + a unit set.
//
// The art kit is generated per culture by tools/art/toy_kit/build.py into
// assets/kit/<culture>/. Only the European culture is built; it is the
// default and the only one the game loads. Asian, South American and Middle
// Eastern are registered as proposals (palette previews) so adding one is a
// data change plus a shape set, not a new system. There is NO faction
// gameplay here — this module is presentation only.

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
    tiers: { castle: 4, tower: 4, house: 4, outpost: 4, farm: 3, mill: 3, mine: 3, workshop: 3, hero_forge: 3, camp: 3 },
  },
  asian: { key: 'asian', name: 'Asian', status: 'proposal' },
  south_american: { key: 'south_american', name: 'South American', status: 'proposal' },
  middle_eastern: { key: 'middle_eastern', name: 'Middle Eastern', status: 'proposal' },
};

export function culture(key = DEFAULT_CULTURE) {
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
