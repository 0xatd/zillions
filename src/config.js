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
    range: 11, dmg: 16, rof: 1.7,
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
    energy: 14, gold: 2, food: 2, hp: 4500,
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
  { day: 8,  size: 190, types: { walker: 0.72, runner: 0.24, brute: 0.04 } },
  { day: FINAL_DAY, size: 380, types: { walker: 0.66, runner: 0.27, brute: 0.07 }, final: true },
];

// ---------- WC3-style heroes ----------

export const HERO_MAX_LEVEL = 10;
export const XP_RADIUS = 14;                       // hero earns XP for kills nearby
export const xpForLevel = (lvl) => 90 + 80 * (lvl - 1);   // XP to go from lvl -> lvl+1
export const rankReqLevel = (rank) => [1, 3, 5][rank - 1] || 99; // ability rank -> hero level needed
export const ULT_REQ_LEVEL = 6;

// Three space marines with kits honoring the squad's favorite heroes.
// Scott: Diablo's Barbarian (+ a taste of Lina/Invoker/Omniknight).
// Alexander: Nature's Prophet / Sniper / Pudge.
// Danny: Necrophos / Weaver / Riki.
export const HEROES = {
  scott: {
    key: 'scott', name: 'Captain Scott', icon: '⚔️', color: 0x8f1f1f, trim: 0xc9a44a,
    tagline: 'Close combat. A whirlwind of steel with fire in his fists.',
    hp: 440, dmg: 28, range: 1.8, rof: 1.1, speed: 4.2, noise: 4,
    levelHp: 44, levelDmg: 4, regen: 2.6, melee: true,
    abilities: [
      { key: 'whirlwind', name: 'Whirlwind', icon: '🌪️', hotkey: 'Q', maxRank: 3, cd: 14,
        cast: 'whirlwind', radius: 2.5, dur: [3, 4, 5], dps: [45, 70, 100],
        desc: 'Scott spins into a cyclone of steel — grinds everything around him while he keeps moving.' },
      { key: 'warcry', name: 'War Cry', icon: '📣', hotkey: 'W', maxRank: 3, cd: 16,
        cast: 'buff', radius: 9, mult: [1.35, 1.55, 1.8], dur: 7,
        desc: 'A barbarian bellow — nearby troops deal bonus damage for 7s.' },
      { key: 'holy', name: 'Purifying Light', icon: '✨', hotkey: 'E', maxRank: 3, cd: 15,
        cast: 'pulse', radius: 6, dmg: [40, 70, 105], heal: [50, 85, 130],
        desc: 'A burst of holy light — heals Scott and nearby troops, sears the dead around them.' },
      { key: 'sunstrike', name: 'Sun Strike', icon: '☀️', hotkey: 'R', ult: true, maxRank: 1, cd: 80,
        cast: 'aoeDmg', radius: 8.5, dmg: [360], stun: [2.5], knock: 2.6,
        desc: 'ULTIMATE: calls down a column of pure solar fire onto everything around him.' },
    ],
  },
  alexander: {
    key: 'alexander', name: 'Alexander', icon: '🌿', color: 0x1f3a6e, trim: 0xc9a44a,
    tagline: 'Mid range. Roots, teleports, and a rifle that never misses twice.',
    hp: 320, dmg: 24, range: 7, rof: 1.8, speed: 4.5, noise: 14,
    levelHp: 32, levelDmg: 3.5, regen: 2.0,
    abilities: [
      { key: 'roots', name: 'Entangling Roots', icon: '🌿', hotkey: 'Q', maxRank: 3, cd: 12,
        cast: 'aoeDmg', radius: 5.5, dmg: [15, 25, 35], stun: [2.2, 2.8, 3.4],
        desc: 'Roots erupt from the soil — every zombie around Alexander is held fast while you line up shots.' },
      { key: 'teleport', name: 'Teleportation', icon: '🌀', hotkey: 'W', maxRank: 3, cd: [50, 40, 30],
        cast: 'teleport', channel: 2,
        desc: 'Channels for 2s, then teleports ANYWHERE on the map. Defend every front at once. Higher ranks recharge faster.' },
      { key: 'focus', name: 'Marksman’s Focus', icon: '🎯', hotkey: 'E', maxRank: 3, passive: true,
        stunChance: [0.18, 0.24, 0.3], stunDur: 0.5, heap: [0.3, 0.5, 0.7], heapCap: [40, 70, 100],
        desc: 'PASSIVE: shots have a chance to mini-stun. Every kill permanently sharpens his aim — bonus damage that never fades (up to a cap).' },
      { key: 'assassinate', name: 'Assassinate', icon: '🎯', hotkey: 'R', ult: true, maxRank: 1, cd: 60,
        cast: 'assassinate', radius: 20, dmg: [600],
        desc: 'ULTIMATE: takes aim… and deletes the biggest zombie in a huge radius.' },
    ],
  },
  danny: {
    key: 'danny', name: 'Danny', icon: '🗡️', color: 0x36503a, trim: 0xa8b394,
    tagline: 'Long range. Now you see him. They never do.',
    hp: 270, dmg: 32, range: 13, rof: 1.1, speed: 4.5, noise: 12,
    levelHp: 25, levelDmg: 4.5, regen: 1.8,
    abilities: [
      { key: 'deathpulse', name: 'Death Pulse', icon: '💀', hotkey: 'Q', maxRank: 3, cd: 9,
        cast: 'pulse', radius: 5.5, dmg: [45, 75, 110], heal: [35, 60, 90],
        desc: 'A wave of necrotic energy — damages the dead around Danny and mends his allies.' },
      { key: 'swarm', name: 'Beetle Swarm', icon: '🐞', hotkey: 'W', maxRank: 3, cd: 15,
        cast: 'swarm', radius: 11, count: [4, 6, 8], dps: 10, dur: 6, slow: 0.85,
        desc: 'Releases a swarm of flesh-eating beetles that latch onto nearby zombies and gnaw them down.' },
      { key: 'cloak', name: 'Cloak & Dagger', icon: '🗡️', hotkey: 'E', maxRank: 3, passive: true,
        fade: [5, 3.5, 2], backstab: [2.2, 2.6, 3.0],
        desc: 'PASSIVE: stop firing for a few seconds and Danny vanishes — zombies cannot see him. His next shot from the shadows deals massive bonus damage.' },
      { key: 'timelapse', name: 'Time Lapse', icon: '⏪', hotkey: 'R', ult: true, maxRank: 1, cd: 60,
        cast: 'timelapse', back: 5,
        desc: 'ULTIMATE: rewinds Danny 5 seconds — back to where he stood, with the health he had.' },
    ],
  },
};

// Loot drops (WC3 creep-style): brutes always drop, walkers/runners rarely.
export const DROPS = {
  bruteGold: 90, smallGold: 30, smallChance: 0.04, healAmount: 100, life: 40,
};

// ---------- Campaign: 5 levels, 5 maps, 5 bosses ----------
// Fixed seeds mean every player fights on the same battlegrounds.

export const LEVELS = [
  {
    id: 1, name: 'Greenfall Marches', seed: 20101, mult: 0.8,
    blurb: 'Rolling moorland and black pines. Learn to hold a line.',
    theme: { water: 0.33, mountain: 0.74, forest: 0.55,
      palette: { grass: 0x4e5c38, forest: 0x33422a, water: 0x24384e, mountain: 0x5c5a54, sand: 0x8a7d5e } },
    boss: { name: 'The Butcher', icon: '🔪', hp: 2600, dmg: 60, speed: 1.1, chase: 2.1, scale: 3.0,
      color: 0x9c2f2f, score: 60, enrage: 0.5,
      desc: 'A mountain of meat and cleavers. Enrages at half health.' },
  },
  {
    id: 2, name: 'Rotmire', seed: 20202, mult: 1.0,
    blurb: 'A drowned fen. Chokepoints everywhere — and so is the water.',
    theme: { water: 0.40, mountain: 0.78, forest: 0.52,
      palette: { grass: 0x46543a, forest: 0x2e3d2a, water: 0x1e3a35, mountain: 0x565a50, sand: 0x74705a } },
    boss: { name: 'Plague Mother', icon: '🪳', hp: 3400, dmg: 40, speed: 0.9, chase: 1.7, scale: 3.2,
      color: 0x6e8f3a, score: 80, spawn: { every: 9, count: 5, type: 'walker' },
      desc: 'Every few seconds she births another brood. Kill her fast.' },
  },
  {
    id: 3, name: 'Cinder Wastes', seed: 20303, mult: 1.3,
    blurb: 'Ash plains under a burnt sky. Wood is scarce; the dead are not.',
    theme: { water: 0.28, mountain: 0.66, forest: 0.66,
      palette: { grass: 0x6a5f4a, forest: 0x4a4434, water: 0x2e3440, mountain: 0x4e4a44, sand: 0x8a7a60 } },
    boss: { name: 'The Shrieker', icon: '🦇', hp: 4200, dmg: 45, speed: 1.3, chase: 2.6, scale: 2.8,
      color: 0x8a5fae, score: 100, roar: { every: 12, radius: 13, dur: 4 },
      desc: 'Its scream overloads sentry towers, silencing them for seconds at a time.' },
  },
  {
    id: 4, name: 'Barrow Hills', seed: 20404, mult: 1.6,
    blurb: 'Grave-cold hills. The ground itself is on their side.',
    theme: { water: 0.30, mountain: 0.70, forest: 0.60,
      palette: { grass: 0x4c4a56, forest: 0x35334a, water: 0x232840, mountain: 0x5a5866, sand: 0x6e6a78 } },
    boss: { name: 'Gravelord', icon: '⚰️', hp: 5600, dmg: 55, speed: 0.95, chase: 1.8, scale: 3.4,
      color: 0x3f4b66, score: 130, armor: 0.35, spawn: { every: 12, count: 8, type: 'walker' },
      desc: 'Bone-plated (takes 35% less damage) and raises the dead as it walks.' },
  },
  {
    id: 5, name: 'The Black Vale', seed: 20505, mult: 2.0,
    blurb: 'Where the plague began. Everything ends here.',
    theme: { water: 0.31, mountain: 0.72, forest: 0.62,
      palette: { grass: 0x3a4032, forest: 0x252e22, water: 0x1a2432, mountain: 0x46443e, sand: 0x5e584a } },
    boss: { name: 'The Zillion', icon: '👁️', hp: 9000, dmg: 75, speed: 1.0, chase: 2.2, scale: 4.2,
      color: 0x2f1f3f, score: 250, enrage: 0.4, armor: 0.2,
      spawn: { every: 10, count: 6, type: 'runner' }, roar: { every: 15, radius: 14, dur: 3.5 },
      desc: 'All of it, at once: armored, enraging, screaming, and endlessly spawning.' },
  },
];

export const DIFFICULTY = {
  casual: { label: 'Casual', mult: 0.5, ambient: 0.6 },
  normal: { label: 'Normal', mult: 1.0, ambient: 1.0 },
  brutal: { label: 'Brutal', mult: 1.7, ambient: 1.5 },
};

export const START_RESOURCES = { gold: 650, wood: 320, stone: 120 };
