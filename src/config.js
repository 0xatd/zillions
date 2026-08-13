// Game balance & static definitions.

export const MAP_SIZE = 120;
export const DAY_LENGTH = 75;          // seconds per day at 1x speed
export const FINAL_DAY = 10;           // final horde arrives at the start of this day
export const SIM_DT = 1 / 30;          // fixed simulation timestep
export const ZOMBIE_CAP = 1600;
export const UNIT_CAP = 40;

export const TILE = {
  GRASS: 0, FOREST: 1, WATER: 2, MOUNTAIN: 3, SAND: 4, GOLDORE: 5, STONEORE: 6,
};

// Grimdark palette: ashen moorland, black pines, oily water, bone-dry ash.
export const TILE_INFO = {
  [TILE.GRASS]:    { walk: true,  build: true,  color: 0x4e5c38 },
  [TILE.FOREST]:   { walk: true,  build: false, color: 0x33422a },
  [TILE.WATER]:    { walk: false, build: false, color: 0x24384e },
  [TILE.MOUNTAIN]: { walk: false, build: false, color: 0x5c5a54 },
  [TILE.SAND]:     { walk: true,  build: true,  color: 0x8a7d5e },
  [TILE.GOLDORE]:  { walk: true,  build: true,  color: 0x6e6240 },
  [TILE.STONEORE]: { walk: true,  build: true,  color: 0x5e6a72 },
};

// Buildings. Rates are per second at 1x. `workers` are consumed, `pop` adds capacity.
export const BUILDINGS = {
  tent: {
    key: 'tent', name: 'Hab-Tent', icon: '⛺', hotkey: '1', size: 2,
    cost: { gold: 100, wood: 40, stone: 0 }, workers: 0, pop: 4,
    energy: -1, gold: 1.6, food: -1, hp: 260,
    desc: 'Houses 4 colonists. Colonists pay taxes in gold, but eat food. If zombies destroy it, the residents join the horde…',
  },
  farm: {
    key: 'farm', name: 'Hydro-Farm', icon: '🌾', hotkey: '2', size: 3,
    cost: { gold: 160, wood: 60, stone: 0 }, workers: 3, pop: 0,
    energy: -1, food: 6, hp: 320,
    desc: 'Produces +6 food. Must be built on open grassland.',
    needs: 'grass',
  },
  sawmill: {
    key: 'sawmill', name: 'Sawmill', icon: '🪵', hotkey: '3', size: 2,
    cost: { gold: 140, wood: 0, stone: 0 }, workers: 3, pop: 0,
    energy: -1, wood: 1.5, hp: 320,
    desc: 'Produces +1.5 wood/s. Must be placed near a forest.',
    needs: 'forest',
  },
  quarry: {
    key: 'quarry', name: 'Quarry', icon: '⛏️', hotkey: '4', size: 3,
    cost: { gold: 200, wood: 80, stone: 0 }, workers: 4, pop: 0,
    energy: -2, stone: 1.0, hp: 420,
    desc: 'Produces +1 stone/s. Must be placed on a stone deposit (pale blue crystals).',
    needs: 'stoneore',
  },
  mine: {
    key: 'mine', name: 'Gold Mine', icon: '💰', hotkey: '5', size: 3,
    cost: { gold: 260, wood: 100, stone: 0 }, workers: 4, pop: 0,
    energy: -2, gold: 4.5, hp: 420,
    desc: 'Produces +4.5 gold/s. Must be placed on a gold deposit (yellow crystals).',
    needs: 'goldore',
  },
  mill: {
    key: 'mill', name: 'Wind Generator', icon: '🌀', hotkey: '6', size: 2,
    cost: { gold: 120, wood: 80, stone: 0 }, workers: 1, pop: 0,
    energy: 8, hp: 280,
    desc: 'Generates +8 energy to power your other buildings.',
  },
  tower: {
    key: 'tower', name: 'Sentry Tower', icon: '🏹', hotkey: '7', size: 2,
    cost: { gold: 200, wood: 70, stone: 50 }, workers: 1, pop: 0,
    energy: -1, hp: 650,
    range: 11, dmg: 14, rof: 1.6,
    desc: 'Automated defense. Shoots zombies within range. Loud — attracts stragglers.',
  },
  wall: {
    key: 'wall', name: 'Palisade Wall', icon: '🧱', hotkey: '8', size: 1,
    cost: { gold: 12, wood: 8, stone: 0 }, workers: 0, pop: 0,
    energy: 0, hp: 420, drag: true,
    desc: 'Cheap wooden palisade. Zombies must chew through it — buy time for your towers. Drag to build lines.',
  },
  barracks: {
    key: 'barracks', name: 'Barracks', icon: '⚔️', hotkey: '9', size: 3,
    cost: { gold: 300, wood: 120, stone: 60 }, workers: 4, pop: 0,
    energy: -2, hp: 650,
    desc: 'Trains Scouts, Troopers and Snipers to defend the colony.',
  },
  hq: {
    key: 'hq', name: 'Fortress Command', icon: '🏛️', size: 4,
    cost: { gold: 0, wood: 0, stone: 0 }, workers: 0, pop: 10,
    energy: 14, gold: 2, food: 2, hp: 3200,
    desc: 'The heart of the colony. If it falls, all is lost.',
  },
};

export const BUILD_ORDER = ['tent', 'farm', 'sawmill', 'quarry', 'mine', 'mill', 'tower', 'wall', 'barracks'];

export const UNITS = {
  ranger: {
    key: 'ranger', name: 'Scout', icon: '🏹', hotkey: 'U',
    cost: 90, hp: 70, dmg: 7, range: 7, rof: 1.4, speed: 4.6,
    noise: 6, color: 0x4a6e3a,
    desc: 'Fast and quiet. Bow shots barely attract zombies. Great for clearing the map early.',
  },
  soldier: {
    key: 'soldier', name: 'Trooper', icon: '🔫', hotkey: 'I',
    cost: 170, hp: 130, dmg: 16, range: 8, rof: 2.2, speed: 3.4,
    noise: 16, color: 0x3a566e,
    desc: 'Solid damage and armor, but gunfire is LOUD and wakes nearby zombies.',
  },
  sniper: {
    key: 'sniper', name: 'Sniper', icon: '🎯', hotkey: 'O',
    cost: 300, hp: 90, dmg: 65, range: 14, rof: 0.55, speed: 3.0,
    noise: 24, color: 0x5c4a72,
    desc: 'Massive damage at extreme range. Every shot echoes across the map.',
  },
};

// Plague-glow palette: sickly greens, jaundiced runners, bruised-purple brutes.
export const ZOMBIES = {
  walker:  { hp: 32,  dmg: 5,  speed: 1.15, chase: 2.3, color: 0x7fa843, scale: 1.0, score: 1 },
  runner:  { hp: 26,  dmg: 4,  speed: 1.7,  chase: 4.2, color: 0xa8983a, scale: 0.92, score: 2 },
  brute:   { hp: 420, dmg: 26, speed: 0.85, chase: 1.6, color: 0x6e4a82, scale: 1.75, score: 8 },
};

// Horde waves: day → config. Sizes get multiplied by difficulty.
export const WAVES = [
  { day: 2,  size: 26,  types: { walker: 1 } },
  { day: 4,  size: 60,  types: { walker: 0.9, runner: 0.1 } },
  { day: 6,  size: 120, types: { walker: 0.8, runner: 0.18, brute: 0.02 } },
  { day: 8,  size: 210, types: { walker: 0.72, runner: 0.24, brute: 0.04 } },
  { day: FINAL_DAY, size: 420, types: { walker: 0.66, runner: 0.27, brute: 0.07 }, final: true },
];

// ---------- WC3-style heroes ----------

export const HERO_MAX_LEVEL = 10;
export const XP_RADIUS = 14;                       // hero earns XP for kills nearby
export const xpForLevel = (lvl) => 90 + 80 * (lvl - 1);   // XP to go from lvl -> lvl+1
export const rankReqLevel = (rank) => [1, 3, 5][rank - 1] || 99; // ability rank -> hero level needed
export const ULT_REQ_LEVEL = 6;

// Three space marines. Close / mid / long range.
export const HEROES = {
  scott: {
    key: 'scott', name: 'Captain Scott', icon: '⚔️', color: 0x8f1f1f, trim: 0xc9a44a,
    tagline: 'Close combat. Crimson-armored breacher — his chainblade never sleeps.',
    hp: 420, dmg: 28, range: 1.8, rof: 1.1, speed: 4.2, noise: 4,
    levelHp: 42, levelDmg: 4, regen: 2.4, melee: true,
    abilities: [
      { key: 'cleave', name: 'Chainblade Sweep', icon: '🌀', hotkey: 'Q', maxRank: 3, cd: 7,
        cast: 'aoeDmg', radius: 3.6, dmg: [45, 80, 120],
        desc: 'A roaring sweep of the chainblade — shreds every zombie around Scott.' },
      { key: 'warcry', name: 'War Cry', icon: '📣', hotkey: 'W', maxRank: 3, cd: 16,
        cast: 'buff', radius: 9, mult: [1.35, 1.55, 1.8], dur: 7,
        desc: 'A thunderous roar — nearby troops deal bonus damage for 7s.' },
      { key: 'stomp', name: 'Seismic Stomp', icon: '💥', hotkey: 'E', maxRank: 3, cd: 13,
        cast: 'aoeDmg', radius: 4.6, dmg: [25, 40, 60], stun: [1.6, 2.1, 2.6],
        desc: 'Power-armored boots crack the earth — damages and stuns the dead around him.' },
      { key: 'quake', name: 'Orbital Strike', icon: '☄️', hotkey: 'R', ult: true, maxRank: 1, cd: 80,
        cast: 'aoeDmg', radius: 8.5, dmg: [340], stun: [2.6],
        desc: 'ULTIMATE: calls fire from the heavens onto everything around him.' },
    ],
  },
  alexander: {
    key: 'alexander', name: 'Alexander', icon: '🔥', color: 0x1f3a6e, trim: 0xc9a44a,
    tagline: 'Mid range. Run-and-gun. Never stops moving, never stops shooting.',
    hp: 310, dmg: 22, range: 7, rof: 2.1, speed: 4.6, noise: 14,
    levelHp: 30, levelDmg: 3.5, regen: 2.0,
    abilities: [
      { key: 'frag', name: 'Frag Grenade', icon: '🧨', hotkey: 'Q', maxRank: 3, cd: 9,
        cast: 'aoeDmg', radius: 5.5, dmg: [45, 75, 110],
        desc: 'Cooks a grenade and drops it at his feet — shreds everything around Alexander.' },
      { key: 'surge', name: 'Adrenal Rush', icon: '⚡', hotkey: 'W', maxRank: 3, cd: 16,
        cast: 'surge', mult: [1.6, 1.9, 2.3], move: 1.6, dur: [5, 6, 7],
        desc: 'Adrenaline floods his veins — he runs AND shoots dramatically faster for a few seconds.' },
      { key: 'ricochet', name: 'Ricochet Rounds', icon: '🔫', hotkey: 'E', maxRank: 3, passive: true,
        chain: [1, 2, 3], chainDmg: 0.6, chainRange: 4.5,
        desc: 'PASSIVE: every shot ricochets into extra nearby zombies for 60% damage.' },
      { key: 'barrage', name: 'Storm of Lead', icon: '🌪️', hotkey: 'R', ult: true, maxRank: 1, cd: 80,
        cast: 'barrage', radius: 9.5, dmg: [230],
        desc: 'ULTIMATE: empties every magazine he carries — hits EVERY zombie around him.' },
    ],
  },
  danny: {
    key: 'danny', name: 'Danny', icon: '🎯', color: 0x36503a, trim: 0xa8b394,
    tagline: 'Long range. Master sniper — one shell, one corpse.',
    hp: 260, dmg: 34, range: 13, rof: 1.0, speed: 4.5, noise: 12,
    levelHp: 24, levelDmg: 5, regen: 1.5,
    abilities: [
      { key: 'volley', name: 'Kill Volley', icon: '🎯', hotkey: 'Q', maxRank: 3, cd: 8,
        cast: 'volley', radius: 14, count: [4, 6, 9], dmg: [50, 65, 85],
        desc: 'Danny rapid-cycles his long rifle — instantly executes several zombies in range.' },
      { key: 'adren', name: 'Combat Stims', icon: '⚡', hotkey: 'W', maxRank: 3, cd: 18,
        cast: 'haste', mult: [1.8, 2.2, 2.7], dur: [5, 6, 7],
        desc: 'Battle-stimulants flood his armor — dramatically faster fire for a few seconds.' },
      { key: 'toxin', name: 'Incendiary Shells', icon: '🧪', hotkey: 'E', maxRank: 3, passive: true,
        slow: [0.72, 0.6, 0.45], dur: 2.5,
        desc: 'PASSIVE: burning rounds sear the dead, slowing them.' },
      { key: 'storm', name: 'Frag Storm', icon: '🌪️', hotkey: 'R', ult: true, maxRank: 1, cd: 80,
        cast: 'aoeDmg', radius: 7.5, dmg: [300],
        desc: 'ULTIMATE: a ring of frag charges shreds everything around Danny.' },
    ],
  },
};

// Loot drops (WC3 creep-style): brutes always drop, walkers/runners rarely.
export const DROPS = {
  bruteGold: 90, smallGold: 30, smallChance: 0.04, healAmount: 100, life: 40,
};

export const DIFFICULTY = {
  casual: { label: 'Casual', mult: 0.6, ambient: 0.6 },
  normal: { label: 'Normal', mult: 1.0, ambient: 1.0 },
  brutal: { label: 'Brutal', mult: 1.7, ambient: 1.5 },
};

export const START_RESOURCES = { gold: 650, wood: 320, stone: 120 };
