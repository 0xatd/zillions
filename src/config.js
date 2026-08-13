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

export const TILE_INFO = {
  [TILE.GRASS]:    { walk: true,  build: true,  color: 0x6da24b },
  [TILE.FOREST]:   { walk: true,  build: false, color: 0x4c7d38 },
  [TILE.WATER]:    { walk: false, build: false, color: 0x3f6fae },
  [TILE.MOUNTAIN]: { walk: false, build: false, color: 0x8a8578 },
  [TILE.SAND]:     { walk: true,  build: true,  color: 0xcbb87a },
  [TILE.GOLDORE]:  { walk: true,  build: true,  color: 0x9a8a52 },
  [TILE.STONEORE]: { walk: true,  build: true,  color: 0x93a0a8 },
};

// Buildings. Rates are per second at 1x. `workers` are consumed, `pop` adds capacity.
export const BUILDINGS = {
  tent: {
    key: 'tent', name: 'Tent', icon: '⛺', hotkey: '1', size: 2,
    cost: { gold: 100, wood: 40, stone: 0 }, workers: 0, pop: 4,
    energy: -1, gold: 1.6, food: -1, hp: 260,
    desc: 'Houses 4 colonists. Colonists pay taxes in gold, but eat food. If zombies destroy it, the residents join the horde…',
  },
  farm: {
    key: 'farm', name: 'Farm', icon: '🌾', hotkey: '2', size: 3,
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
    key: 'mill', name: 'Windmill', icon: '🌀', hotkey: '6', size: 2,
    cost: { gold: 120, wood: 80, stone: 0 }, workers: 1, pop: 0,
    energy: 8, hp: 280,
    desc: 'Generates +8 energy to power your other buildings.',
  },
  tower: {
    key: 'tower', name: 'Ballista Tower', icon: '🏹', hotkey: '7', size: 2,
    cost: { gold: 200, wood: 70, stone: 50 }, workers: 1, pop: 0,
    energy: -1, hp: 650,
    range: 11, dmg: 14, rof: 1.6,
    desc: 'Automated defense. Shoots zombies within range. Loud — attracts stragglers.',
  },
  wall: {
    key: 'wall', name: 'Wall', icon: '🧱', hotkey: '8', size: 1,
    cost: { gold: 12, wood: 8, stone: 0 }, workers: 0, pop: 0,
    energy: 0, hp: 420, drag: true,
    desc: 'Cheap wooden palisade. Zombies must chew through it — buy time for your towers. Drag to build lines.',
  },
  barracks: {
    key: 'barracks', name: 'Barracks', icon: '⚔️', hotkey: '9', size: 3,
    cost: { gold: 300, wood: 120, stone: 60 }, workers: 4, pop: 0,
    energy: -2, hp: 650,
    desc: 'Trains Rangers, Soldiers and Snipers to defend the colony.',
  },
  hq: {
    key: 'hq', name: 'Command Center', icon: '🏛️', size: 4,
    cost: { gold: 0, wood: 0, stone: 0 }, workers: 0, pop: 10,
    energy: 14, gold: 2, food: 2, hp: 3200,
    desc: 'The heart of the colony. If it falls, all is lost.',
  },
};

export const BUILD_ORDER = ['tent', 'farm', 'sawmill', 'quarry', 'mine', 'mill', 'tower', 'wall', 'barracks'];

export const UNITS = {
  ranger: {
    key: 'ranger', name: 'Ranger', icon: '🏹', hotkey: 'U',
    cost: 90, hp: 70, dmg: 7, range: 7, rof: 1.4, speed: 4.6,
    noise: 6, color: 0x7dbb5e,
    desc: 'Fast and quiet. Bow shots barely attract zombies. Great for clearing the map early.',
  },
  soldier: {
    key: 'soldier', name: 'Soldier', icon: '🔫', hotkey: 'I',
    cost: 170, hp: 130, dmg: 16, range: 8, rof: 2.2, speed: 3.4,
    noise: 16, color: 0x5e8abb,
    desc: 'Solid damage and armor, but gunfire is LOUD and wakes nearby zombies.',
  },
  sniper: {
    key: 'sniper', name: 'Sniper', icon: '🎯', hotkey: 'O',
    cost: 300, hp: 90, dmg: 65, range: 14, rof: 0.55, speed: 3.0,
    noise: 24, color: 0xb08add,
    desc: 'Massive damage at extreme range. Every shot echoes across the map.',
  },
};

export const ZOMBIES = {
  walker:  { hp: 32,  dmg: 5,  speed: 1.15, chase: 2.3, color: 0x6d8f4e, scale: 1.0, score: 1 },
  runner:  { hp: 26,  dmg: 4,  speed: 1.7,  chase: 4.2, color: 0x9c7f4a, scale: 0.92, score: 2 },
  brute:   { hp: 420, dmg: 26, speed: 0.85, chase: 1.6, color: 0x5d4f6e, scale: 1.75, score: 8 },
};

// Horde waves: day → config. Sizes get multiplied by difficulty.
export const WAVES = [
  { day: 2,  size: 26,  types: { walker: 1 } },
  { day: 4,  size: 60,  types: { walker: 0.9, runner: 0.1 } },
  { day: 6,  size: 120, types: { walker: 0.8, runner: 0.18, brute: 0.02 } },
  { day: 8,  size: 210, types: { walker: 0.72, runner: 0.24, brute: 0.04 } },
  { day: FINAL_DAY, size: 420, types: { walker: 0.66, runner: 0.27, brute: 0.07 }, final: true },
];

export const DIFFICULTY = {
  casual: { label: 'Casual', mult: 0.6, ambient: 0.6 },
  normal: { label: 'Normal', mult: 1.0, ambient: 1.0 },
  brutal: { label: 'Brutal', mult: 1.7, ambient: 1.5 },
};

export const START_RESOURCES = { gold: 650, wood: 320, stone: 120 };
