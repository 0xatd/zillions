// Game balance & static definitions — Thronefall-style build-by-plots economy.

export const MAP_SIZE = 120;
export const SIM_DT = 1 / 30;          // fixed simulation timestep
export const ZOMBIE_CAP = 1600;
export const UNIT_CAP = 60;

export const DAY_TIME = 65;            // seconds of daylight (build & collect)
export const NIGHT_MAX = 150;          // safety: a night never lasts longer than this
export const FINAL_NIGHT = 10;         // survive this many nights to win
export const COIN_CAP = 360;           // max coin entities on the ground
export const COIN_RADIUS = 3.0;        // heroes hoover coins within this range
export const PAY_RADIUS = 1.7;         // stand this close to a pay plate to fund it
export const PAY_RATE = 22;            // gold per second streamed into a plot (hold B)
export const CITY_WALL_R = 15.6;       // rampart ring radius around the Keep

export const TILE = {
  GRASS: 0, FOREST: 1, WATER: 2, MOUNTAIN: 3, SAND: 4, GOLDORE: 5, STONEORE: 6, PATH: 7,
};

// Grimdark palette: ashen moorland, black pines, oily water, bone-dry ash.
export const TILE_INFO = {
  [TILE.GRASS]:    { walk: true,  build: true,  color: 0x5a8a52 },
  [TILE.FOREST]:   { walk: false, build: false, color: 0x35603c }, // woods are walls — hordes funnel around them
  [TILE.WATER]:    { walk: false, build: false, color: 0x3fa0a8 },
  [TILE.MOUNTAIN]: { walk: false, build: false, color: 0xb8b4a6 },
  [TILE.SAND]:     { walk: true,  build: true,  color: 0xb8a878 },
  [TILE.GOLDORE]:  { walk: true,  build: true,  color: 0x9a8448 },
  [TILE.STONEORE]: { walk: true,  build: true,  color: 0x8a9490 },
  [TILE.PATH]:     { walk: true,  build: true,  color: 0x8a7a5e },
};

// ---------- Plots: the city is pre-designed; you buy it to life ----------
// Every plot kind has tiers. Building/upgrading = standing next to the plot
// while your gold streams into it. `income` pays out as coins at dawn.

export const PLOT_KINDS = {
  hq: {
    name: 'The Keep', icon: '🏰',
    tiers: [
      { name: 'The Keep', cost: 0, hp: 4200, income: 10 },
      { name: 'Stone Keep', cost: 70, hp: 6500, income: 18 },
      { name: 'High Keep', cost: 150, hp: 9000, income: 30 },
    ],
    desc: 'The heart of the city. If it falls, all is lost. Upgrades add income and armor.',
  },
  house: {
    name: 'House', icon: '🏠',
    tiers: [
      { name: 'Cottage', cost: 10, hp: 300, income: 6 },
      { name: 'House', cost: 22, hp: 420, income: 12 },
      { name: 'Manor', cost: 45, hp: 560, income: 22 },
    ],
    desc: 'Home to taxpaying settlers. Pays coins every dawn.',
  },
  farm: {
    name: 'Farm', icon: '🌾',
    tiers: [
      { name: 'Field', cost: 6, hp: 240, income: 4 },
      { name: 'Farm', cost: 14, hp: 320, income: 8 },
    ],
    desc: 'Cheap early coins from the soil.',
  },
  mill: {
    name: 'Mill', icon: '🌀',
    tiers: [
      { name: 'Windmill', cost: 18, hp: 380, income: 9 },
      { name: 'Great Mill', cost: 36, hp: 500, income: 18 },
    ],
    desc: 'Grinds a steady stream of coins.',
  },
  mine: {
    name: 'Gold Mine', icon: '⛏️',
    tiers: [
      { name: 'Gold Mine', cost: 28, hp: 480, income: 14 },
      { name: 'Deep Mine', cost: 55, hp: 640, income: 26 },
    ],
    desc: 'Rich veins, far from safety. The best coins are the hardest to hold.',
  },
  tower: {
    name: 'Tower', icon: '🏹',
    tiers: [
      { name: 'Watchtower', cost: 18, hp: 560, dmg: 14, rof: 1.5, range: 10 },
      { name: 'Guard Tower', cost: 36, hp: 720, dmg: 26, rof: 1.6, range: 11 },
      {
        branch: true, // walk up and choose a doctrine before paying
        options: {
          ballista: { name: 'Ballista Tower', icon: '🎯', cost: 60, hp: 850, dmg: 72, rof: 0.7, range: 15,
            blurb: 'Slow, huge single hits at extreme range. Boss killer.' },
          flame: { name: 'Flame Tower', icon: '🔥', cost: 60, hp: 850, dmg: 13, rof: 1.7, range: 8.5, splash: 2.4,
            blurb: 'Fast burning splash. Melts packed hordes up close.' },
        },
      },
    ],
    desc: 'Automated defense. At the top tier, choose ballista or flame.',
  },
  wall: {
    name: 'Wall', icon: '🧱',
    perTile: true, // cost scales with segment length
    tiers: [
      { name: 'Palisade', cost: 1.4, hp: 380 },
      { name: 'Stone Wall', cost: 2.6, hp: 820 },
    ],
    desc: 'A rampart with a gate your troops can pass. The dead must chew through.',
  },
  camp_militia: {
    name: 'Militia Camp', icon: '⚔️',
    unit: 'soldier',
    tiers: [
      { name: 'Militia Camp', cost: 22, hp: 460, count: 3 },
      { name: 'War Camp', cost: 42, hp: 600, count: 5 },
    ],
    desc: 'Sturdy troopers. The fallen are replaced free at every dawn.',
  },
  camp_ranger: {
    name: 'Ranger Camp', icon: '🏹',
    unit: 'ranger',
    tiers: [
      { name: 'Ranger Camp', cost: 16, hp: 420, count: 3 },
      { name: 'Ranger Lodge', cost: 32, hp: 540, count: 5 },
    ],
    desc: 'Fast, quiet scouts. Great early screen for your walls.',
  },
  camp_sniper: {
    name: 'Sniper Nest', icon: '🎯',
    unit: 'sniper',
    tiers: [
      { name: 'Sniper Nest', cost: 38, hp: 420, count: 2 },
      { name: 'Marksman Hall', cost: 66, hp: 540, count: 3 },
    ],
    desc: 'Massive damage at extreme range — every shot echoes.',
  },
};

export const START_GOLD = 14;

export const UNITS = {
  ranger: {
    key: 'ranger', name: 'Ranger', icon: '🏹',
    hp: 70, dmg: 7, range: 7, rof: 1.4, speed: 4.6, noise: 6, color: 0x5f9e56,
  },
  soldier: {
    key: 'soldier', name: 'Trooper', icon: '🔫',
    hp: 140, dmg: 16, range: 8, rof: 2.2, speed: 3.4, noise: 16, color: 0x4a7ab8,
  },
  sniper: {
    key: 'sniper', name: 'Sniper', icon: '🎯',
    hp: 90, dmg: 65, range: 14, rof: 0.55, speed: 3.0, noise: 24, color: 0x8a6ac8,
  },
};

// Plague-glow palette: sickly greens, jaundiced runners, bruised-purple brutes.
export const ZOMBIES = {
  walker:  { hp: 32,  dmg: 5,  speed: 1.15, chase: 2.3, color: 0x86c24e, scale: 1.0, score: 1 },
  runner:  { hp: 26,  dmg: 4,  speed: 1.7,  chase: 4.2, color: 0xd0c052, scale: 0.92, score: 2 },
  brute:   { hp: 420, dmg: 26, speed: 0.85, chase: 1.6, color: 0xa060d8, scale: 1.75, score: 8 },
};

// A wave EVERY night, Thronefall-style, growing to a final-night crescendo.
export function waveForNight(night, mult) {
  const size = Math.min(520, Math.round(8 * Math.pow(1.42, night - 1) * mult));
  const brute = night >= 5 ? Math.min(0.07, 0.015 * (night - 4)) : 0;
  const runner = night >= 3 ? Math.min(0.28, 0.07 * (night - 2)) : 0;
  const types = { walker: 1 - brute - runner, runner, brute };
  const edges = night >= 9 ? 3 : night >= 5 ? 2 : 1;
  return { size, types, edges, final: night === FINAL_NIGHT };
}

// ---------- Heroes: auto-attack + passive AURA + ONE signature ability ----------
// The whole kit, Thronefall-simple: you steer, your weapon fires itself, an
// aura hums around you, and SPACE at night fires the special.
// Rank scales automatically with hero level (1 → 2 at lvl 4 → 3 at lvl 7).

export const HERO_MAX_LEVEL = 10;
export const XP_RADIUS = 14;                       // hero earns XP for kills nearby
export const xpForLevel = (lvl) => 80 + 70 * (lvl - 1);   // XP to go from lvl -> lvl+1
export const abilityRank = (lvl) => (lvl >= 7 ? 3 : lvl >= 4 ? 2 : 1);

export const HEROES = {
  scott: {
    key: 'scott', name: 'Scott English', icon: '💥', color: 0x8f1f1f, trim: 0xc9a44a,
    tagline: 'Short range. Every trigger-pull is a verdict.',
    hp: 480, dmg: 62, range: 4.5, rof: 0.55, speed: 4.3, noise: 8,
    levelHp: 46, levelDmg: 8, regen: 3.0, shotgun: true, splash: 1.7,
    aura: {
      key: 'gravity', name: 'Heavy Gravity', icon: '🪐', radius: 5.5, slow: 0.65, color: 0x7a9cf0,
      desc: 'Space itself thickens around Scott — the dead crawl 35% slower in his field.',
    },
    ability: {
      key: 'hammer', name: 'Gravity Hammer', icon: '🔨', cd: 13,
      cast: 'aoeDmg', radius: 3.6, dmg: [350, 550, 800], stun: [0.8, 1.0, 1.3],
      desc: 'Scott swings the gravity maul in a full circle — one cataclysmic blow, ten times the shotgun, everything close is paste.',
    },
  },
  alexander: {
    key: 'alexander', name: 'Alexander Thomas', icon: '🌿', color: 0x1f3a6e, trim: 0xc9a44a,
    tagline: 'Long range. The horizon is his firing line.',
    hp: 350, dmg: 32, range: 11, rof: 1.2, speed: 4.5, noise: 16,
    levelHp: 34, levelDmg: 4.5, regen: 2.2,
    aura: {
      key: 'nanites', name: 'Nanite Swarm', icon: '🧬', radius: 5.5, regen: 6, color: 0x59c8b8,
      desc: 'A cloud of repair nanites knits the wounds of nearby troops and heroes (+6 hp/s).',
    },
    ability: {
      key: 'grenade', name: 'Concussion Grenade', icon: '💣', cd: 11,
      cast: 'grenade', radius: 4, range: 4.5, hop: 3,
      dmg: [60, 100, 150], knock: [2.0, 2.6, 3.2], stun: [0.6, 0.7, 0.8],
      desc: 'Alexander lobs a concussion charge ahead and kicks himself backward — the blast flings the dead away and buys back the range he loves.',
    },
  },
  danny: {
    key: 'danny', name: 'Danny Donovan', icon: '🗡️', color: 0x36503a, trim: 0xa8b394,
    tagline: 'Long range. Now you see him. They never do.',
    hp: 290, dmg: 34, range: 13, rof: 1.1, speed: 4.6, noise: 12,
    levelHp: 27, levelDmg: 5, regen: 2.0,
    aura: {
      key: 'siphon', name: 'Nutrient Siphon', icon: '💀', radius: 5.5, drain: 5, leech: 0.5, color: 0x7fd85e,
      desc: 'A necrotic field wicks the juices out of the dead near Danny (5 hp/s) and feeds them back to him.',
    },
    ability: {
      key: 'weave', name: 'The Weave', icon: '🕸️', cd: 12,
      cast: 'weave', dur: [3, 4, 5], dmg: [50, 85, 130], speed: 1.6,
      desc: 'Danny slips between the threads of the world — invisible, untouchable, walking THROUGH the dead and cutting every one he passes.',
    },
  },
};

// Coin drops from kills (Thronefall-style loot).
export const DROPS = {
  smallChance: 0.05, bruteCoins: 4, bossCoins: 20,
};

// ---------- Items: WC3-style persistent gear ----------
// Hero gear rides with a hero across the whole campaign; town relics belong
// to the civilization and empower every city you found. All passive — the
// kit stays auto-attack + aura + one special; items just make it meaner.

export const ITEMS = {
  // Hero gear (quest rewards)
  targeting_optic: { name: 'Targeting Optic', icon: '🔭', kind: 'hero', dmg: 0.20, desc: '+20% attack damage.' },
  blast_padding: { name: 'Blast Padding', icon: '🦺', kind: 'hero', hp: 120, desc: '+120 max HP.' },
  servo_legs: { name: 'Servo Legs', icon: '🦿', kind: 'hero', speed: 0.10, desc: '+10% move speed.' },
  magnet_gauntlet: { name: 'Magnet Gauntlet', icon: '🧲', kind: 'hero', magnet: 2, desc: 'Coins leap to you from 2 tiles further.' },
  stim_rig: { name: 'Stim Rig', icon: '⚡', kind: 'hero', rof: 0.15, desc: '+15% attack rate.' },
  medicae: { name: 'Medicae Implant', icon: '💉', kind: 'hero', regen: 3, desc: '+3 HP/s regeneration.' },
  aura_amp: { name: 'Aura Amplifier', icon: '📡', kind: 'hero', auraR: 0.4, desc: '+40% aura radius.' },
  reactor_core: { name: 'Reactor Core', icon: '⚛️', kind: 'hero', cdr: 0.25, desc: 'Special recharges 25% faster.' },
  void_shard: { name: 'Void Shard', icon: '🔮', kind: 'hero', dmg: 0.35, desc: '+35% attack damage. It hums.' },
  chrono_loop: { name: 'Chrono Loop', icon: '⏳', kind: 'hero', cdr: 0.2, rof: 0.1, desc: 'Special -20% cooldown, +10% attack rate.' },
  // Boss signatures (dropped on first campaign kill)
  butchers_cleaver: { name: "Butcher's Cleaver", icon: '🔪', kind: 'hero', dmg: 0.25, desc: '+25% attack damage. Still warm.' },
  broodmother_heart: { name: "Broodmother's Heart", icon: '🫀', kind: 'hero', regen: 4, desc: '+4 HP/s. It still beats.' },
  shrieker_lung: { name: "Shrieker's Lung", icon: '🫁', kind: 'hero', auraR: 0.5, desc: '+50% aura radius.' },
  gravelord_plate: { name: "Gravelord's Plate", icon: '🛡️', kind: 'hero', hp: 200, desc: '+200 max HP.' },
  zillion_eye: { name: "The Zillion's Eye", icon: '👁️', kind: 'hero', cdr: 0.3, dmg: 0.1, desc: 'Special -30% cooldown, +10% damage.' },
  // Town relics (the civilization's treasures — help every city you found)
  masonry_codex: { name: 'Masonry Codex', icon: '📜', kind: 'relic', buildingHp: 0.25, desc: 'All structures +25% HP.' },
  tithe_ledger: { name: 'Tithe Ledger', icon: '📒', kind: 'relic', income: 0.2, desc: 'Dawn income +20%.' },
  banner_keep: { name: 'Banner of the Keep', icon: '🚩', kind: 'relic', troopDmg: 0.2, desc: 'Troops +20% damage.' },
  ballistics_manual: { name: 'Ballistics Manual', icon: '📘', kind: 'relic', towerDmg: 0.2, desc: 'Towers +20% damage.' },
  warlord_crest: { name: "Warlord's Crest", icon: '🏵️', kind: 'relic', troopDmg: 0.15, towerDmg: 0.15, desc: 'Troops and towers +15% damage.' },
};

export const BOSS_DROPS = { 1: 'butchers_cleaver', 2: 'broodmother_heart', 3: 'shrieker_lung', 4: 'gravelord_plate', 5: 'zillion_eye' };

const MOD_KEYS = ['hp', 'regen', 'magnet', 'dmg', 'rof', 'speed', 'cdr', 'auraR', 'troopDmg', 'towerDmg', 'buildingHp', 'income'];
export function itemMods(items) {
  const m = {};
  for (const k of MOD_KEYS) m[k] = 0;
  for (const key of items || []) {
    const it = ITEMS[key];
    if (!it) continue;
    for (const k of MOD_KEYS) if (it[k]) m[k] += it[k];
  }
  return m;
}

// ---------- Campaign: 5 levels, 5 maps, 5 bosses ----------
// Fixed seeds mean every player fights on the same battlegrounds.
// Castle-defense shape: each map is a big frontier with hive nests (the
// enemy's bases — nightly waves march out of them, and they can be razed)
// and 3 candidate city sites. Ride out, pick your ground, found the city.
// Each map also carries 3 side quests; rewards are items and relics that
// persist across the campaign (WC3-style).

export const LEVELS = [
  {
    id: 1, name: 'Greenfall Marches', seed: 20101, mult: 0.8, size: 160, nests: 3,
    quests: [
      { id: 'l1q1', name: 'First Blood', desc: 'Slay 150 of the dead', reward: 'targeting_optic', check: (g) => g.stats.kills >= 150 },
      { id: 'l1q2', name: 'Not One Stone', desc: 'Win without losing a single building', reward: 'masonry_codex', check: (g) => g.stats.lost === 0 },
      { id: 'l1q3', name: 'Burn the Nest', desc: 'Raze a hive nest', reward: 'blast_padding', check: (g) => g.stats.nests >= 1 },
    ],
    blurb: 'Rolling moorland and black pines. Learn to hold a line.',
    theme: { water: 0.33, mountain: 0.74, forest: 0.55,
      palette: { grass: 0x5a8a52, forest: 0x35603c, water: 0x3fa0a8, mountain: 0xb8b4a6, sand: 0xb8a878, path: 0x8a7a5e, sky: 0x9cc4b0 } },
    boss: { name: 'The Butcher', icon: '🔪', hp: 2600, dmg: 60, speed: 1.1, chase: 2.1, scale: 3.0,
      color: 0x9c2f2f, score: 60, enrage: 0.5,
      desc: 'A mountain of meat and cleavers. Enrages at half health.' },
  },
  {
    id: 2, name: 'Rotmire', seed: 20202, mult: 1.0, size: 160, nests: 3,
    quests: [
      { id: 'l2q1', name: 'Drain the Fen', desc: 'Raze 2 hive nests', reward: 'tithe_ledger', check: (g) => g.stats.nests >= 2 },
      { id: 'l2q2', name: 'Untouchable', desc: 'Win without your hero falling', reward: 'servo_legs', check: (g) => g.stats.heroDeaths === 0 },
      { id: 'l2q3', name: 'Deep Pockets', desc: 'Collect 250 gold in one run', reward: 'magnet_gauntlet', check: (g) => g.stats.coins >= 250 },
    ],
    blurb: 'A drowned fen. Chokepoints everywhere — and so is the water.',
    theme: { water: 0.40, mountain: 0.78, forest: 0.52,
      palette: { grass: 0x4e6a4a, forest: 0x314e38, water: 0x4e9a68, mountain: 0x9a9488, sand: 0x8a8562, path: 0x6e6a4e, sky: 0x8aa896 } },
    boss: { name: 'Plague Mother', icon: '🪳', hp: 3400, dmg: 40, speed: 0.9, chase: 1.7, scale: 3.2,
      color: 0x6e8f3a, score: 80, spawn: { every: 9, count: 5, type: 'walker' },
      desc: 'Every few seconds she births another brood. Kill her fast.' },
  },
  {
    id: 3, name: 'Cinder Wastes', seed: 20303, mult: 1.3, size: 160, nests: 4,
    quests: [
      { id: 'l3q1', name: 'Swift Execution', desc: 'Kill the Shrieker within 90s', reward: 'stim_rig', check: (g) => g.stats.bossKillT != null && g.stats.bossKillT <= 90 },
      { id: 'l3q2', name: 'High Keep', desc: 'Upgrade the Keep to its final tier', reward: 'banner_keep', check: (g) => { const hq = g.plots.find((p) => p.kind === 'hq'); return hq && hq.tier >= 3; } },
      { id: 'l3q3', name: 'Ashes to Ashes', desc: 'Slay 600 of the dead', reward: 'medicae', check: (g) => g.stats.kills >= 600 },
    ],
    blurb: 'Ash plains under a burnt sky. Nothing grows here but the horde.',
    theme: { water: 0.28, mountain: 0.66, forest: 0.66,
      palette: { grass: 0xa86a42, forest: 0x6e4e36, water: 0xc25a2e, mountain: 0xcf9a6a, sand: 0xc28a58, path: 0x8a5e40, sky: 0xd8a878 } },
    boss: { name: 'The Shrieker', icon: '🦇', hp: 4200, dmg: 45, speed: 1.3, chase: 2.6, scale: 2.8,
      color: 0x8a5fae, score: 100, roar: { every: 12, radius: 13, dur: 4 },
      desc: 'Its scream overloads towers, silencing them for seconds at a time.' },
  },
  {
    id: 4, name: 'Barrow Hills', seed: 20404, mult: 1.6, size: 160, nests: 4,
    quests: [
      { id: 'l4q1', name: 'Tomb Raider', desc: 'Raze 3 hive nests', reward: 'ballistics_manual', check: (g) => g.stats.nests >= 3 },
      { id: 'l4q2', name: 'Deathless', desc: 'Win without your hero falling', reward: 'aura_amp', check: (g) => g.stats.heroDeaths === 0 },
      { id: 'l4q3', name: 'A City That Stands', desc: 'End with 20 buildings standing (walls aside)', reward: 'reactor_core', check: (g) => g.buildings.filter((b) => b.alive && b.kind !== 'wall').length >= 20 },
    ],
    blurb: 'Grave-cold hills. The ground itself is on their side.',
    theme: { water: 0.30, mountain: 0.70, forest: 0.60,
      palette: { grass: 0x4e5c80, forest: 0x38466a, water: 0x5a9ac8, mountain: 0xc8d2e0, sand: 0x7a84a0, path: 0x8a7a88, sky: 0x7a8ab0 } },
    boss: { name: 'Gravelord', icon: '⚰️', hp: 5600, dmg: 55, speed: 0.95, chase: 1.8, scale: 3.4,
      color: 0x3f4b66, score: 130, armor: 0.35, spawn: { every: 12, count: 8, type: 'walker' },
      desc: 'Bone-plated (takes 35% less damage) and raises the dead as it walks.' },
  },
  {
    id: 5, name: 'The Black Vale', seed: 20505, mult: 2.0, size: 160, nests: 5,
    quests: [
      { id: 'l5q1', name: 'Blind the Eye', desc: 'Kill The Zillion within 120s', reward: 'void_shard', check: (g) => g.stats.bossKillT != null && g.stats.bossKillT <= 120 },
      { id: 'l5q2', name: 'Scour the Vale', desc: 'Raze every hive nest', reward: 'warlord_crest', check: (g) => g.nests.length > 0 && g.nests.every((n) => !n.alive) },
      { id: 'l5q3', name: 'Legend', desc: 'Slay 1500 of the dead', reward: 'chrono_loop', check: (g) => g.stats.kills >= 1500 },
    ],
    blurb: 'Where the plague began. Everything ends here.',
    theme: { water: 0.31, mountain: 0.72, forest: 0.62,
      palette: { grass: 0x453a5e, forest: 0x2f2848, water: 0x6a4a9a, mountain: 0x8a7aa2, sand: 0x5e5578, path: 0x6a5a72, sky: 0x584e78 } },
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
