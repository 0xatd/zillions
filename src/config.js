// Game balance & static definitions — continuous-siege conquest.
// The planet is a lane graph: your camps emit squads that walk out and take
// nodes, the hives emit squads that walk in. There is no day, no night, and
// no bell — pressure is produced by both sides and the front line is wherever
// the two flows meet.

import { makeRNG } from './utils.js';

export const MAP_SIZE = 120;
export const SIM_DT = 1 / 30;          // fixed simulation timestep
export const ZOMBIE_CAP = 1600;
// Supply comes from TERRITORY. A commander who has taken half the planet can
// field more than one penned into a city — and without this the player's power
// is flat while Threat rises forever, which leaves them sitting on a pile of
// gold with nothing to buy and no way to crack the last hive.
// Measured as a SHARE of the planet, not a count of nodes. Counting nodes made
// bigger maps easier — more nodes meant more supply meant a bigger army — which
// is why the five-hive map used to finish faster than the three-hive one.
// Holding the whole planet is worth the same army whatever size the planet is.
export const SUPPLY = {
  base: 42,        // what the city alone can sustain
  perPlanet: 72,   // added at 100% of the planet's lane nodes held
  max: 130,        // absolute ceiling, for the simulation's sake
};
export const UNIT_CAP = SUPPLY.max;   // hard ceiling; the live cap is Game.unitCap()

export const COIN_CAP = 360;           // max coin entities on the ground
export const COIN_RADIUS = 3.0;        // heroes hoover coins within this range
export const PAY_RADIUS = 1.7;         // stand this close to a pay plate to fund it
export const PAY_RATE = 20;            // gold per second streamed into a plot (hold B)
export const UPGRADE_PAY_RATE = 50;    // upgrades finish quickly; the cost, not a long hold, is the commitment
export const CITY_WALL_R = 15.6;       // rampart ring radius around the Keep

// ---------- Siege: the constants that replaced day and night ----------
export const SIEGE = {
  incomeTick: 4.0,        // seconds between automatic income payouts
  incomePeriod: 40,       // a building's `income` is paid out over this many seconds
  repairHpPerGold: 45,    // structure HP restored per gold when repairing
  rebuildDiscount: 0.5,   // fraction of tier cost to raise a ruin again
  captureRadius: 7.0,     // presence radius around a lane node
  captureTime: 6.0,       // seconds of uncontested presence to flip a node
  nodeIncome: 14,         // income a held node contributes, same period as buildings
  laneMaxDist: 46,        // longest lane the graph will connect
  laneNeighbors: 3,       // lanes out of each node
  raiderShare: 0.35,      // fraction of hive output that raids nodes, not the Keep
  hiveClaim: 0.42,        // share of the map's nodes the hive already holds
  scoutRadius: 17,        // survey a node by getting this close to it
};

// ---------- Nodes: the ground is terrain, the owner is a separate question ----------
// A node's KIND is a fact about the map — an ore field is an ore field, and you
// can read it off the land. Who holds it is a different fact, and you do not
// know it until you go and look. Kinds differ in what they pay and in what a
// Forward Camp built on them becomes, so which ground you take is a real choice.

export const NODE_KINDS = {
  ore: {
    name: 'Ore Field', icon: '⛏️', income: 2.0,
    blurb: 'Rich ground. Pays double while you hold it.',
  },
  quarry: {
    name: 'Quarry', icon: '🪨', income: 1.0, outpostHp: 0.5,
    blurb: 'Stone at hand — a Forward Camp here is half again as tough.',
  },
  ford: {
    name: 'Ford', icon: '🌉', income: 0.8, outpostHp: 0.35, garrison: 1.5,
    blurb: 'A pinch in the land. Whoever holds it holds the road — and it is always guarded.',
  },
  clearing: {
    name: 'Clearing', icon: '🌾', income: 1.0, outpostCount: 1,
    blurb: 'Room to muster — a Forward Camp here fields an extra trooper.',
  },
  barrow: {
    name: 'Barrow', icon: '⚰️', income: 0.9, firstClaim: { gold: 50, xp: 280 },
    blurb: 'Old graves under the crags. Something is buried here.',
  },
};

export const NODE_UNKNOWN = { name: 'Unsurveyed', icon: '❔', income: 1.0, blurb: 'Nobody has been close enough to see what is there.' };

// The clock. Threat rises with time, with every hive left standing, and with
// your own aggression — so the player can always see what they did to earn it.
export const THREAT = {
  perSecond: 1 / 190,
  perNest: 1 / 520,        // per living nest, per second
  perCapture: 0.12,        // one-off bump when you take a node
  perNestRazed: 0.35,      // one-off bump when you raze a hive
  max: 24,
};
export const THREAT_PERIOD = 190;      // seconds per threat level at base rate

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
// while your gold streams into it. `income` pays out on the siege income tick.
// Camps carry `count` + `every`: a squad of `count` every `every` seconds.

export const PLOT_KINDS = {
  hq: {
    name: 'The Keep', icon: '🏰',
    tiers: [
      { name: 'The Keep', cost: 0, hp: 4200, income: 10 },
      { name: 'Stone Keep', cost: 56, hp: 6500, income: 24 },
      { name: 'High Keep', cost: 100, hp: 9000, income: 42 },
      { name: 'Citadel Nexus', cost: 220, hp: 14000, income: 70 },
    ],
    desc: 'The heart of the city. If it falls, all is lost. Upgrades add income and armor.',
  },
  house: {
    name: 'House', icon: '🏠',
    tiers: [
      { name: 'Cottage', cost: 12, hp: 300, income: 6 },
      { name: 'House', cost: 18, hp: 420, income: 13 },
      { name: 'Manor', cost: 34, hp: 560, income: 24 },
      { name: 'Arcology', cost: 82, hp: 900, income: 44 },
    ],
    desc: 'Home to taxpaying settlers. Pays coins on every income tick.',
  },
  farm: {
    name: 'Farm', icon: '🌾',
    tiers: [
      { name: 'Field', cost: 8, hp: 240, income: 5 },
      { name: 'Farm', cost: 15, hp: 320, income: 11 },
      { name: 'Hydroponic Estate', cost: 58, hp: 520, income: 24 },
    ],
    desc: 'Cheap early coins from the soil.',
  },
  mill: {
    name: 'Mill', icon: '🌀',
    tiers: [
      { name: 'Windmill', cost: 20, hp: 380, income: 11 },
      { name: 'Great Mill', cost: 34, hp: 500, income: 23 },
      { name: 'Matter Mill', cost: 88, hp: 760, income: 44 },
    ],
    desc: 'Grinds a steady stream of coins.',
  },
  mine: {
    name: 'Gold Mine', icon: '⛏️',
    tiers: [
      { name: 'Gold Mine', cost: 30, hp: 480, income: 18 },
      { name: 'Deep Mine', cost: 48, hp: 640, income: 36 },
      { name: 'Planetary Bore', cost: 120, hp: 980, income: 70 },
    ],
    desc: 'Rich veins, far from safety. The best coins are the hardest to hold.',
  },
  tower: {
    name: 'Tower', icon: '🏹',
    tiers: [
      { name: 'Watchtower', cost: 20, hp: 560, dmg: 14, rof: 1.5, range: 10 },
      { name: 'Guard Tower', cost: 34, hp: 720, dmg: 26, rof: 1.6, range: 11 },
      {
        branch: true, // walk up and choose a doctrine before paying
        options: {
          ballista: { name: 'Ballista Tower', icon: '🎯', cost: 54, hp: 850, dmg: 72, rof: 0.7, range: 15,
            blurb: 'Slow, huge single hits at extreme range. Boss killer.' },
          flame: { name: 'Flame Tower', icon: '🔥', cost: 54, hp: 850, dmg: 13, rof: 1.7, range: 8.5, splash: 2.4,
            blurb: 'Fast burning splash. Melts packed hordes up close.' },
        },
      },
      {
        branch: true, // preserves the chosen doctrine for its capstone
        options: {
          ballista: { name: 'Rail Bastion', icon: '☄️', cost: 145, hp: 1400, dmg: 145, rof: 0.85, range: 18, splash: 0.8,
            blurb: 'A major long-range rail battery for champions and hive sieges.' },
          flame: { name: 'Plasma Crucible', icon: '🌋', cost: 145, hp: 1400, dmg: 29, rof: 2.1, range: 10, splash: 3.4,
            blurb: 'A major plasma capstone that erases packed pressure.' },
        },
      },
    ],
    desc: 'Automated defense. Press T beside one to change what it shoots first.',
  },
  wall: {
    name: 'Barrier', icon: '🧱',
    perTile: true, // cost scales with segment length — but it's ONE purchase
    tiers: [
      { name: 'Razorwire Fence', cost: 0.75, hp: 220 },
      { name: 'Plasteel Barricade', cost: 1.45, hp: 520 },
      {
        branch: true, // stand at the gate and choose the segment's final form
        options: {
          shock: { name: 'Shock Fence', icon: '⚡', cost: 2.2, hp: 700, zap: 7,
            blurb: 'Electrified — everything chewing it takes damage and slows.' },
          bastion: { name: 'Bastion Wall', icon: '🧱', cost: 2.2, hp: 1400,
            blurb: 'Twice the armor. The dead gnaw a long time.' },
        },
      },
    ],
    desc: 'ONE payment at the gate raises this ENTIRE segment — never piece by piece. Upgrade it the same way; at the top, choose shock or bastion.',
  },
  camp_militia: {
    name: 'Militia Camp', icon: '⚔️',
    unit: 'soldier',
    tiers: [
      { name: 'Militia Camp', cost: 24, hp: 460, count: 2, every: 26 },
      { name: 'War Camp', cost: 44, hp: 600, count: 3, every: 20 },
      { name: 'Legion Foundry', cost: 110, hp: 900, count: 5, every: 16 },
    ],
    desc: 'Sturdy troopers. Musters a fresh squad on a timer, forever.',
  },
  camp_ranger: {
    name: 'Ranger Camp', icon: '🏹',
    unit: 'ranger',
    tiers: [
      { name: 'Ranger Camp', cost: 18, hp: 420, count: 2, every: 22 },
      { name: 'Ranger Lodge', cost: 34, hp: 540, count: 3, every: 17 },
      { name: 'Pathfinder Command', cost: 96, hp: 820, count: 5, every: 14 },
    ],
    desc: 'Fast, quiet scouts. The cheapest steady pressure you can buy.',
  },
  camp_sniper: {
    name: 'Sniper Nest', icon: '🎯',
    unit: 'sniper',
    tiers: [
      { name: 'Sniper Nest', cost: 34, hp: 420, count: 1, every: 30 },
      { name: 'Marksman Hall', cost: 56, hp: 540, count: 2, every: 26 },
      { name: 'Longshot Academy', cost: 132, hp: 820, count: 3, every: 20 },
    ],
    desc: 'Massive damage at extreme range — every shot echoes.',
  },
  outpost: {
    name: 'Forward Camp', icon: '⛺',
    unit: 'soldier',
    onNode: true, // only fundable on a lane node you already hold
    tiers: [
      { name: 'Forward Camp', cost: 34, hp: 620, count: 2, every: 24, income: 6 },
      { name: 'War Outpost', cost: 58, hp: 900, count: 3, every: 19, income: 12, dmg: 16, rof: 1.0, range: 6.2 },
      { name: 'Lane Bastion', cost: 86, hp: 1250, count: 4, every: 16, income: 16, dmg: 28, rof: 0.9, range: 6.8, splash: 1.1 },
      { name: 'Repair Bastion', cost: 165, hp: 1900, count: 5, every: 14, income: 24, dmg: 42, rof: 1.0, range: 7.2, splash: 1.4,
        repairRadius: 9, repairRate: 32 },
    ],
    desc: 'Raise it on ground you hold. Upgrades turn each lane into a short-range guard post that musters blockers and shoots nearby pressure.',
  },
  workshop: {
    name: 'Auto-Workshop', icon: '🔧',
    tiers: [
      { name: 'Repair Depot', cost: 46, hp: 620, repairRadius: 14, repairRate: 18 },
      { name: 'Drone Workshop', cost: 105, hp: 980, repairRadius: 18, repairRate: 42 },
      { name: 'City Fabricator', cost: 190, hp: 1450, repairRadius: 28, repairRate: 78 },
    ],
    desc: 'Automatically repairs damaged structures in range. Upgrade it to cover most of the city.',
  },
  hero_forge: {
    name: 'Hero Forge', icon: '⚛️',
    tiers: [
      { name: 'Hero Armory', cost: 55, hp: 700, heroDmg: 0.12, heroHp: 90, heroCdr: 0.05 },
      { name: 'Augmentation Forge', cost: 125, hp: 1100, heroDmg: 0.25, heroHp: 220, heroCdr: 0.12 },
      { name: 'Ascension Core', cost: 240, hp: 1700, heroDmg: 0.42, heroHp: 420, heroCdr: 0.22 },
    ],
    desc: 'A physical home for hero progression. Each tier upgrades every allied hero.',
  },
};

export const START_GOLD = 58;

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

// ---------- The horde: roles, not stat blocks ----------
// Every entry asks the player a DIFFERENT question. `ranged` outranges walls,
// `burrow` walks through them, `siege` ignores your army entirely, and `call`
// makes everything nearby worse until you kill it.
export const ZOMBIES = {
  walker:  { hp: 32,  dmg: 5,  speed: 1.15, chase: 2.3, color: 0x86c24e, scale: 1.0,  score: 1 },
  runner:  { hp: 26,  dmg: 4,  speed: 1.7,  chase: 4.2, color: 0xd0c052, scale: 0.92, score: 2 },
  brute:   { hp: 420, dmg: 26, speed: 0.85, chase: 1.6, color: 0xa060d8, scale: 1.75, score: 8 },
  spitter: {
    hp: 42, dmg: 11, speed: 1.05, chase: 1.95, color: 0xc9d84e, scale: 1.05, score: 3,
    ranged: 8.5, rof: 0.5,
    desc: 'Spits acid from beyond your wall. You cannot turtle it out.',
  },
  burrower: {
    hp: 58, dmg: 12, speed: 1.2, chase: 2.5, color: 0x8a6ad0, scale: 0.98, score: 4,
    burrow: true,
    desc: 'Tunnels under barriers and surfaces inside the rampart.',
  },
  sieger: {
    hp: 320, dmg: 36, speed: 0.8, chase: 1.5, color: 0xd0762e, scale: 1.6, score: 7,
    siege: true,
    desc: 'Walks past your army and eats your buildings. Intercept it.',
  },
  caller: {
    hp: 96, dmg: 6, speed: 1.25, chase: 2.4, color: 0x4ec9a8, scale: 1.18, score: 6,
    call: { radius: 8.5, dmg: 0.4, speed: 0.3 },
    desc: 'Goads everything nearby into a frenzy. Kill it first.',
  },
};

// Tower targeting doctrine — the free tactical toggle (press T beside a tower).
export const TOWER_PRIORITY = [
  { key: 'nearest', name: 'Nearest', icon: '🎯', desc: 'Shoots whatever is closest.' },
  { key: 'strongest', name: 'Strongest', icon: '💀', desc: 'Shoots the biggest health pool in range.' },
  { key: 'siege', name: 'Siege first', icon: '🏚️', desc: 'Prioritises building-killers, then the nearest.' },
  { key: 'ranged', name: 'Ranged first', icon: '🧪', desc: 'Prioritises spitters and callers, then the nearest.' },
];

// ---------- Hive production: the enemy's economy ----------
// A living nest musters a squad on a timer. Both the timer and the squad get
// worse as Threat climbs, so the pressure curve is a consequence, not a script.

export function hiveInterval(threat) {
  return Math.max(11, 30 - threat);
}

export function hiveSquad(threat, mult) {
  const size = Math.max(2, Math.round((2.5 + threat * 0.9) * mult));
  const runner   = threat >= 2 ? Math.min(0.26, 0.060 * (threat - 1)) : 0;
  const spitter  = threat >= 3 ? Math.min(0.15, 0.035 * (threat - 2)) : 0;
  const caller   = threat >= 4 ? Math.min(0.06, 0.015 * (threat - 3)) : 0;
  const brute    = threat >= 5 ? Math.min(0.09, 0.018 * (threat - 4)) : 0;
  const sieger   = threat >= 6 ? Math.min(0.10, 0.020 * (threat - 5)) : 0;
  const burrower = threat >= 7 ? Math.min(0.09, 0.020 * (threat - 6)) : 0;
  const rest = runner + spitter + caller + brute + sieger + burrower;
  const walker = Math.max(0.12, 1 - rest);
  return { size, types: { walker, runner, spitter, caller, brute, sieger, burrower } };
}

// Every whole Threat level, every hive musters at once. This is the drumbeat
// that replaced nightfall.
export const SURGE_MULT = 2.0;

// ---------- Heroes: auto-attack + passive AURA + ONE signature ability ----------
// The whole kit stays Thronefall-simple: you steer, your weapon fires itself,
// an aura hums around you, and SPACE/Q fires the special.
// Rank scales automatically with hero level (1 → 2 at lvl 4 → 3 at lvl 7).

// A hero's ladder runs to 100. The first ten levels are exactly what they
// always were — the campaign is paced against them — and everything past ten is
// the long tail a persistent hero grinds out over many runs. At ~150 XP a
// minute, level 100 is about 350k XP: dozens of hours, which is the point.
export const HERO_MAX_LEVEL = 100;
export const XP_RADIUS = 14;                       // hero earns XP for kills nearby
export const xpForLevel = (lvl) => 80 + 70 * (lvl - 1);   // XP to go from lvl -> lvl+1

// Stat growth tapers after the campaign band. Paying full levelHp/levelDmg for
// ninety-nine levels would hand a grinder a hero with thirteen times the damage
// the game is balanced around; a quarter-rate tail keeps the ladder worth
// climbing without turning the campaign into a walkover.
export const HERO_FULL_GROWTH_LEVEL = 10;
export const HERO_LATE_GROWTH_SCALE = 0.25;
// How many levels' worth of stat growth a hero of this level has earned.
export function heroGrowthUnits(level) {
  const lvl = Math.max(1, Math.min(HERO_MAX_LEVEL, level | 0));
  const full = Math.min(lvl, HERO_FULL_GROWTH_LEVEL) - 1;
  const late = Math.max(0, lvl - HERO_FULL_GROWTH_LEVEL);
  return full + late * HERO_LATE_GROWTH_SCALE;
}

export const HERO_UPGRADE_KEYS = ['aura', 'passive1', 'passive2', 'ult'];
export const HERO_UPGRADE_MAX = 3;
// The choice budget does NOT grow with the ladder. Four branches at rank 3 is
// twelve ranks and a hero only ever earns nine points, so something always goes
// unbought — that tension is the hero build, and levels past it are stats.
export const HERO_UPGRADE_POINT_CAP = 9;

export function normalizeHeroUpgrades(upgrades = {}) {
  const out = {};
  for (const key of HERO_UPGRADE_KEYS) {
    const raw = Number(upgrades[key]) || 0;
    out[key] = Math.max(0, Math.min(HERO_UPGRADE_MAX, raw | 0));
  }
  return out;
}

export function heroUpgradePoints(level) {
  return Math.max(0, Math.min(HERO_UPGRADE_POINT_CAP, (level | 0) - 1));
}

export function heroSpentUpgrades(upgrades = {}) {
  const u = normalizeHeroUpgrades(upgrades);
  return HERO_UPGRADE_KEYS.reduce((sum, key) => sum + u[key], 0);
}

export function heroUnspentUpgrades(level, upgrades = {}) {
  return Math.max(0, heroUpgradePoints(level) - heroSpentUpgrades(upgrades));
}

export const abilityRank = (lvl, upgrades = null) => upgrades
  ? Math.min(3, 1 + normalizeHeroUpgrades(upgrades).ult)
  : (lvl >= 7 ? 3 : lvl >= 4 ? 2 : 1);

export const HEROES = {
  scott: {
    key: 'scott', name: 'Scott English', icon: '💥', color: 0xb32020, trim: 0xf4f1e8,
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
    passives: [
      { key: 'scattercore', name: 'Scatter Core', icon: '🔩', mods: { dmg: 0.12, rof: 0.08 }, desc: 'Shotgun damage and reload speed.' },
      { key: 'siegeplate', name: 'Siege Plate', icon: '🛡️', mods: { hp: 90, regen: 0.7 }, desc: 'More health and in-combat regeneration.' },
    ],
  },
  alexander: {
    key: 'alexander', name: 'Alexander Thomas', icon: '🌿', color: 0x2f8f46, trim: 0xf3c53d,
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
    passives: [
      { key: 'deadeye', name: 'Deadeye Optics', icon: '🎯', mods: { dmg: 0.10, range: 0.55 }, desc: 'Rifle damage and attack range.' },
      { key: 'fieldkit', name: 'Field Kit', icon: '🧪', mods: { regen: 0.8, cdr: 0.06 }, desc: 'More self-repair and faster special recharge.' },
    ],
  },
  danny: {
    key: 'danny', name: 'Danny Donovan', icon: '🗡️', color: 0x2468c9, trim: 0x111318,
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
    passives: [
      { key: 'ghostmotor', name: 'Ghost Motor', icon: '👟', mods: { speed: 0.08, rof: 0.08 }, desc: 'Move speed and fire rate.' },
      { key: 'needlesight', name: 'Needle Sight', icon: '🪡', mods: { dmg: 0.10, range: 0.5 }, desc: 'Precision damage and attack range.' },
    ],
  },
};

// Coin drops. Coins are no longer paid by the calendar — income is credited
// automatically and physical coins fall from combat and conquest only.
export const DROPS = {
  enemyCoins: 1, bruteCoins: 5, bossCoins: 20, nodeCoins: 18, nestCoins: 40,
};

// ---------- Items: WC3-style persistent gear ----------

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
  // Field finds — what the frontier itself is hiding. Weaker than quest gear,
  // but you can be carrying it ten seconds into a run, and it is the only gear
  // that grows during a survival run.
  worn_scope: { name: 'Worn Scope', icon: '🔭', kind: 'field', dmg: 0.10, desc: '+10% attack damage.' },
  flak_vest: { name: 'Flak Vest', icon: '🦺', kind: 'field', hp: 70, desc: '+70 max HP.' },
  runner_boots: { name: 'Runner Boots', icon: '👢', kind: 'field', speed: 0.07, desc: '+7% move speed.' },
  coin_lure: { name: 'Coin Lure', icon: '🧲', kind: 'field', magnet: 1, desc: 'Coins leap to you from 1 tile further.' },
  field_stim: { name: 'Field Stim', icon: '💊', kind: 'field', rof: 0.10, desc: '+10% attack rate.' },
  bandage_roll: { name: 'Bandage Roll', icon: '🩹', kind: 'field', regen: 1.5, desc: '+1.5 HP/s regeneration.' },
  ration_tin: { name: 'Ration Tin', icon: '🥫', kind: 'field', hp: 45, regen: 0.8, desc: '+45 max HP, +0.8 HP/s.' },
  oath_blade: { name: 'Oath Blade', icon: '🗡️', kind: 'field', dmg: 0.22, desc: '+22% attack damage. Someone swore on it.' },
  pilgrim_plate: { name: 'Pilgrim Plate', icon: '🛡️', kind: 'field', hp: 160, desc: '+160 max HP. Dented all over.' },
  quickfire_rig: { name: 'Quickfire Rig', icon: '⚙️', kind: 'field', rof: 0.16, cdr: 0.10, desc: '+16% attack rate, special recharges 10% faster.' },
  lodestone: { name: 'Lodestone', icon: '🧭', kind: 'field', magnet: 2, speed: 0.05, desc: 'Coins leap 2 tiles further, +5% move speed.' },
  war_horn: { name: 'War Horn', icon: '📯', kind: 'field', auraR: 0.3, troopDmg: 0.1, desc: '+30% aura radius, troops +10% damage.' },
  // Town relics (the civilization's treasures — help every city you found)
  masonry_codex: { name: 'Masonry Codex', icon: '📜', kind: 'relic', buildingHp: 0.25, desc: 'All structures +25% HP.' },
  tithe_ledger: { name: 'Tithe Ledger', icon: '📒', kind: 'relic', income: 0.2, desc: 'Income +20%.' },
  banner_keep: { name: 'Banner of the Keep', icon: '🚩', kind: 'relic', troopDmg: 0.2, desc: 'Troops +20% damage.' },
  ballistics_manual: { name: 'Ballistics Manual', icon: '📘', kind: 'relic', towerDmg: 0.2, desc: 'Towers +20% damage.' },
  warlord_crest: { name: "Warlord's Crest", icon: '🏵️', kind: 'relic', troopDmg: 0.15, towerDmg: 0.15, desc: 'Troops and towers +15% damage.' },
};

export const BOSS_DROPS = { 1: 'butchers_cleaver', 2: 'broodmother_heart', 3: 'shrieker_lung', 4: 'gravelord_plate', 5: 'zillion_eye' };

// What the map hides, and what the hero can carry off it.
export const FIELD_LOOT = {
  common: ['worn_scope', 'flak_vest', 'runner_boots', 'coin_lure', 'field_stim', 'bandage_roll', 'ration_tin'],
  rare: ['oath_blade', 'pilgrim_plate', 'quickfire_rig', 'lodestone', 'war_horn'],
};
export const PACK_SLOTS = 4;          // how much a hero can carry off the field
export const LOOT_PICKUP_RADIUS = 1.6; // walk over it and it is yours
export const LOOT_REVEAL_RADIUS = 7;   // how close before you spot a hidden cache
export const LOOT_DROP_COOLDOWN = 2.5; // seconds before a dropped item can be picked up again

const MOD_KEYS = ['hp', 'regen', 'magnet', 'dmg', 'rof', 'range', 'speed', 'cdr', 'auraR', 'troopDmg', 'towerDmg', 'buildingHp', 'income'];
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

// ---------- Campaign: retaking EARTH — 5 fronts, 5 maps, 5 bosses ----------
// The authored campaign is the war for the homeworld. Win all five fronts and
// Earth is retaken — and turns out to be one star among many: the procedural
// galaxy (below) opens, and every frontier world you clear stays liberated on
// your profile.
// Fixed seeds mean every player fights on the same battlegrounds.
// Each map is a frontier lane graph: hive nests (the enemy's producing bases),
// neutral lane nodes to take, and 3 candidate city sites.
// Win by razing every hive and breaking the counterattack the last one calls.

// How much of a hive's health comes from the level's difficulty multiplier.
// Kept explicit because it is the main lever on campaign pacing.
export const NEST_HP_BASE = 9000;
export const NEST_HP_LEVEL_SHARE = 0.8;   // hp = base * (1 - share + share * level.mult)

export const LEVELS = [
  {
    id: 1, name: 'Greenfall Marches', seed: 20101, mult: 0.8, size: 160, nests: 3,
    economy: { startGold: 58, income: 1.0, pressure: 0.9 },
    quests: [
      { id: 'l1q1', name: 'First Blood', desc: 'Slay 150 of the dead', reward: 'targeting_optic', check: (g) => g.stats.kills >= 150 },
      { id: 'l1q2', name: 'Not One Stone', desc: 'Win without losing a single building', reward: 'masonry_codex', check: (g) => g.stats.lost === 0 },
      { id: 'l1q3', name: 'Ground Held', desc: 'Hold 4 lane nodes at once', reward: 'blast_padding', check: (g) => g.stats.bestHeld >= 4 },
    ],
    blurb: 'Rolling moorland and black pines. Learn to hold a line — then move it.',
    theme: { terrain: 'moor', city: 'bastion',
      palette: { grass: 0x5a8a52, forest: 0x35603c, water: 0x3fa0a8, mountain: 0xb8b4a6, sand: 0xb8a878, path: 0x8a7a5e, sky: 0x9cc4b0 } },
    boss: { name: 'The Butcher', icon: '🔪', hp: 2600, dmg: 60, speed: 1.1, chase: 2.1, scale: 3.0,
      color: 0x9c2f2f, score: 60, enrage: 0.5,
      desc: 'A mountain of meat and cleavers. Enrages at half health.' },
  },
  {
    id: 2, name: 'Rotmire', seed: 20202, mult: 1.0, size: 160, nests: 3,
    economy: { startGold: 64, income: 1.04, pressure: 0.96 },
    quests: [
      { id: 'l2q1', name: 'Drain the Fen', desc: 'Raze 2 hive nests', reward: 'tithe_ledger', check: (g) => g.stats.nests >= 2 },
      { id: 'l2q2', name: 'Untouchable', desc: 'Win without your hero falling', reward: 'servo_legs', check: (g) => g.stats.heroDeaths === 0 },
      { id: 'l2q3', name: 'Deep Pockets', desc: 'Collect 250 gold in one run', reward: 'magnet_gauntlet', check: (g) => g.stats.coins >= 250 },
    ],
    blurb: 'A drowned fen. Chokepoints everywhere — and so is the water.',
    theme: { terrain: 'fen', city: 'fort', liquidName: 'Bog water',
      palette: { grass: 0x4e6a4a, forest: 0x314e38, water: 0x4e9a68, mountain: 0x9a9488, sand: 0x8a8562, path: 0x6e6a4e, sky: 0x8aa896 } },
    boss: { name: 'Plague Mother', icon: '🪳', hp: 3400, dmg: 40, speed: 0.9, chase: 1.7, scale: 3.2,
      color: 0x6e8f3a, score: 80, spawn: { every: 9, count: 5, type: 'walker' },
      desc: 'Every few seconds she births another brood. Kill her fast.' },
  },
  {
    id: 3, name: 'Cinder Wastes', seed: 20303, mult: 1.3, size: 160, nests: 4,
    economy: { startGold: 72, income: 1.08, pressure: 1.0 },
    quests: [
      { id: 'l3q1', name: 'Swift Execution', desc: 'Kill the Shrieker within 90s', reward: 'stim_rig', check: (g) => g.stats.bossKillT != null && g.stats.bossKillT <= 90 },
      { id: 'l3q2', name: 'High Keep', desc: 'Upgrade the Keep to its final tier', reward: 'banner_keep', check: (g) => { const hq = g.plots.find((p) => p.kind === 'hq'); return hq && hq.tier >= 3; } },
      { id: 'l3q3', name: 'Ashes to Ashes', desc: 'Slay 600 of the dead', reward: 'medicae', check: (g) => g.stats.kills >= 600 },
    ],
    blurb: 'Ash plains cut by crag canyons. Whoever holds the passes holds the war.',
    // liquid: 'lava' switches the whole liquid treatment — glowing surface,
    // ember shoreline, bright crust rim — so molten channels can never be
    // mistaken for ground you can walk.
    theme: { terrain: 'wastes', city: 'star', liquid: 'lava', liquidName: 'Molten rock',
      palette: { grass: 0xa86a42, forest: 0x6e4e36, water: 0xc25a2e, mountain: 0xcf9a6a, sand: 0xc28a58, path: 0x8a5e40, sky: 0xd8a878 } },
    boss: { name: 'The Shrieker', icon: '🦇', hp: 4200, dmg: 45, speed: 1.3, chase: 2.6, scale: 2.8,
      color: 0x8a5fae, score: 100, roar: { every: 12, radius: 13, dur: 4 },
      desc: 'Its scream overloads towers, silencing them for seconds at a time.' },
  },
  {
    id: 4, name: 'Barrow Hills', seed: 20404, mult: 1.6, size: 160, nests: 4,
    economy: { startGold: 82, income: 1.12, pressure: 1.04 },
    quests: [
      { id: 'l4q1', name: 'Tomb Raider', desc: 'Raze 3 hive nests', reward: 'ballistics_manual', check: (g) => g.stats.nests >= 3 },
      { id: 'l4q2', name: 'Deathless', desc: 'Win without your hero falling', reward: 'aura_amp', check: (g) => g.stats.heroDeaths === 0 },
      { id: 'l4q3', name: 'A City That Stands', desc: 'End with 20 buildings standing (walls aside)', reward: 'reactor_core', check: (g) => g.buildings.filter((b) => b.alive && b.kind !== 'wall').length >= 20 },
    ],
    blurb: 'A field of grave mounds and blind hollows. The ground itself is on their side.',
    theme: { terrain: 'hills', city: 'crescent',
      palette: { grass: 0x4e5c80, forest: 0x38466a, water: 0x5a9ac8, mountain: 0xc8d2e0, sand: 0x7a84a0, path: 0x8a7a88, sky: 0x7a8ab0 } },
    boss: { name: 'Gravelord', icon: '⚰️', hp: 5600, dmg: 55, speed: 0.95, chase: 1.8, scale: 3.4,
      color: 0x3f4b66, score: 130, armor: 0.35, spawn: { every: 12, count: 8, type: 'walker' },
      desc: 'Bone-plated (takes 35% less damage) and raises the dead as it walks.' },
  },
  {
    id: 5, name: 'The Black Vale', seed: 20505, mult: 2.0, size: 160, nests: 5,
    economy: { startGold: 96, income: 1.16, pressure: 1.08 },
    quests: [
      { id: 'l5q1', name: 'Blind the Eye', desc: 'Kill The Zillion within 120s', reward: 'void_shard', check: (g) => g.stats.bossKillT != null && g.stats.bossKillT <= 120 },
      { id: 'l5q2', name: 'Total Occupation', desc: 'Hold 7 lane nodes at once', reward: 'warlord_crest', check: (g) => g.stats.bestHeld >= 7 },
      { id: 'l5q3', name: 'Legend', desc: 'Slay 1500 of the dead', reward: 'chrono_loop', check: (g) => g.stats.kills >= 1500 },
    ],
    blurb: 'A world split by one great rift. Three passes through it — and everything ends here.',
    theme: { terrain: 'vale', city: 'keyhole', liquidName: 'Void water',
      palette: { grass: 0x453a5e, forest: 0x2f2848, water: 0x6a4a9a, mountain: 0x8a7aa2, sand: 0x5e5578, path: 0x6a5a72, sky: 0x584e78 } },
    boss: { name: 'The Zillion', icon: '👁️', hp: 9000, dmg: 75, speed: 1.0, chase: 2.2, scale: 4.2,
      color: 0x2f1f3f, score: 250, enrage: 0.4, armor: 0.2,
      spawn: { every: 10, count: 6, type: 'runner' }, roar: { every: 15, radius: 14, dur: 3.5 },
      desc: 'All of it, at once: armored, enraging, screaming, and endlessly spawning.' },
  },
];

// ---------- The galaxy: the campaign never runs out of planets ----------
//
// The five authored planets above are the war's first front. Past them the
// galaxy is procedural: `levelById(n)` builds planet n deterministically from
// its number alone, so every player's galaxy is the same galaxy and lockstep
// peers agree without shipping data. A galaxy planet is a seeded recombination
// of the systems the authored levels introduced — landform x city plan x
// palette x boss — with difficulty climbing steadily and no ceiling.

const GALAXY_TERRAINS = ['moor', 'fen', 'wastes', 'hills', 'vale'];
const GALAXY_PLANS = ['bastion', 'fort', 'star', 'crescent', 'keyhole'];
const GALAXY_NAMES_A = ['Ashen', 'Broken', 'Cold', 'Dim', 'Far', 'Grey', 'Hollow', 'Iron', 'Last', 'Mourn', 'Null', 'Pale', 'Red', 'Silent', 'Veiled'];
const GALAXY_NAMES_B = ['Reach', 'Verge', 'Drift', 'Expanse', 'Barrens', 'Threshold', 'March', 'Deep', 'Shelf', 'Crossing', 'Waste', 'Hollow', 'Terminus'];
const GALAXY_BLURBS = {
  moor: 'Open moorland under a strange sun.',
  fen: 'A drowned world. The causeways decide everything.',
  wastes: 'Canyon country: whoever holds the passes holds the war.',
  hills: 'Mounded, blind ground. They are always closer than they look.',
  vale: 'One great rift splits it. Cross it or die on your own side.',
};
const GALAXY_BOSS_EPITHETS = ['Elder', 'Vast', 'Twice-Born', 'Howling', 'Crowned', 'Blighted', 'Ancient'];

// Shift a 0xRRGGBB colour around the hue wheel without pulling in three.js.
function shiftHue(hex, deg) {
  const r = (hex >> 16 & 255) / 255, g = (hex >> 8 & 255) / 255, b = (hex & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d > 0) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  h = ((h + deg) % 360 + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r2, g2, b2] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round(Math.max(0, Math.min(1, v + m)) * 255);
  return (to(r2) << 16) | (to(g2) << 8) | to(b2);
}

export function isGalaxyLevel(id) { return (id | 0) > LEVELS.length; }

// Planet n of the galaxy, the same for everyone, forever.
export function galaxyLevel(id) {
  const n = id - LEVELS.length;           // 1st, 2nd, ... galaxy planet
  const rng = makeRNG((0x9a1a70 ^ Math.imul(id, 0x9e3779b1)) >>> 0);
  // Walk the 25 landform x plan combos with a stride co-prime to 25, so every
  // combination appears once before any repeats and neighbours never match.
  const combo = (n * 7) % 25;
  const terrain = GALAXY_TERRAINS[combo % 5];
  const city = GALAXY_PLANS[(combo / 5) | 0];
  const donor = LEVELS.find((l) => l.theme.terrain === terrain) || LEVELS[0];
  const hue = Math.round((rng() - 0.5) * 140);
  const palette = {};
  for (const [k, v] of Object.entries(donor.theme.palette)) palette[k] = shiftHue(v, hue);

  const name = `${GALAXY_NAMES_A[(id * 7) % GALAXY_NAMES_A.length]} ${GALAXY_NAMES_B[(id * 11) % GALAXY_NAMES_B.length]}`;
  // Difficulty climbs without ceiling, but gently — the galaxy is a long war.
  const mult = 2.0 + n * 0.22;
  const baseBoss = LEVELS[(id * 3) % LEVELS.length].boss;
  const boss = {
    ...baseBoss,
    name: `${GALAXY_BOSS_EPITHETS[(id * 5) % GALAXY_BOSS_EPITHETS.length]} ${baseBoss.name}`,
    hp: Math.round(baseBoss.hp * (1 + n * 0.18)),
    dmg: Math.round(baseBoss.dmg * (1 + n * 0.06)),
  };
  const kills = 800 + n * 200;
  const held = Math.min(9, 5 + (n >> 1));
  const nests = Math.min(7, 4 + (n >> 2));
  // Frontier worlds are big and get bigger: more ground between you and the
  // hives, longer lanes, more room for the front to be a place. Capped where
  // the flow-field and mesh still stay comfortable.
  const size = Math.min(220, 172 + n * 6);
  return {
    id, name, galaxy: true, seed: (77000 + id * 613) >>> 0,
    mult, size, nests,
    economy: {
      startGold: Math.min(140, 96 + n * 4),
      income: Math.min(1.25, 1.16 + n * 0.01),
      pressure: Math.min(1.15, 1.08 + n * 0.01),
    },
    quests: [
      { id: `g${id}q1`, name: 'Deeper Still', desc: `Slay ${kills} of the dead`, reward: null, check: (g) => g.stats.kills >= kills },
      { id: `g${id}q2`, name: 'Ground Held', desc: `Hold ${held} lane nodes at once`, reward: null, check: (g) => g.stats.bestHeld >= held },
      { id: `g${id}q3`, name: 'Liberation', desc: 'Raze every hive', reward: null, check: (g) => g.stats.nests >= nests },
    ],
    blurb: `${GALAXY_BLURBS[terrain]} Frontier world ${n} — the war goes on.`,
    theme: { terrain, city, palette },
    boss,
  };
}

// The one lookup the whole game uses. Ids 1..5 are the authored war; everything
// past them is the procedural galaxy.
const _galaxyCache = new Map();
export function levelById(id) {
  const n = Math.max(1, id | 0);
  if (n <= LEVELS.length) return LEVELS[n - 1];
  if (!_galaxyCache.has(n)) _galaxyCache.set(n, galaxyLevel(n));
  return _galaxyCache.get(n);
}

export const DIFFICULTY = {
  casual: { label: 'Casual', mult: 0.5, ambient: 0.6 },
  normal: { label: 'Normal', mult: 1.0, ambient: 1.0 },
  brutal: { label: 'Brutal', mult: 1.7, ambient: 1.5 },
};
