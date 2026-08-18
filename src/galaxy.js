// The galaxy — the map above the map.
//
// `src/overworld.js` owns what a WORLD is: a descriptor
// ({ id, name, seed, size, spawn, regions }) that stitches into a walkable
// planet. This module owns what a GALAXY is: a deterministic generator of
// those descriptors, laid out as star systems on spiral arms with Earth at
// the hub. Travel outward and the war gets worse — the threat multiplier is
// the same monotonic ladder `levelById()` already publishes, so the galaxy
// map and the simulation can never disagree about how hard a world is.
//
// Two rules keep this honest:
//
//   1. Nothing here invents level data. A frontier world's landform, palette,
//      boss, hives and difficulty come from `levelById(levelId)` — the one
//      lookup the simulation uses. This module decides WHERE a world sits and
//      WHAT KIND it is; `config.js` decides what fighting on it is like.
//   2. Nothing here imports three.js. Like terrain.js and overworld.js, the
//      whole galaxy builds headless in Node, and `scripts/galaxy-check.mjs`
//      generates it, hashes it, and plays a sample of its worlds for real.
//
// World kinds (tagged onto every descriptor as `kind`):
//   standard  — a campaign world: found a colony, take the lanes, raze hives.
//   holdout   — a survival world: fewer hives, harder pressure, hold ground.
//   derelict  — an exploration world: a labyrinth hulk sits on its surface.
import { LEVELS, LABYRINTH_LEVELS, levelById, galaxyWorldKind, GALAXY_WORLD_KINDS, shiftHue } from './config.js';
import { earthWorldDescriptor } from './overworld.js';
import { makeRNG, clamp } from './utils.js';

// The known galaxy: one seed, one galaxy, the same for every player and every
// lockstep peer. A different seed is a different universe — the check builds
// both to prove the generator actually consumes it.
export const GALAXY_SEED = 0x2110;
export const GALAXY_ARMS = 4;
export const GALAXY_SYSTEMS = 32;      // Sol plus 31 frontier systems
export const GALAXY_WORLDS_MIN = 1;    // worlds in the smallest system
export const GALAXY_WORLDS_MAX = 3;    // ...and the largest

// Threat bands, one per point of the level multiplier past Earth's last front
// (Earth ends at x2.0). Band 0 is Earth itself; band 9 is everything the far
// rim throws at you and has no ceiling above it.
export const THREAT_TIERS = [
  { tier: 0, label: 'Homeworld', hint: 'The war you already know.' },
  { tier: 1, label: 'Fringe', hint: 'One jump out. The hives are thinner here.' },
  { tier: 2, label: 'Verge', hint: 'Past the shipping lanes. Nobody is coming.' },
  { tier: 3, label: 'Reach', hint: 'Deep frontier. Hives muster in numbers.' },
  { tier: 4, label: 'Deepmarch', hint: 'Contested for a century. Everything here has been fought over.' },
  { tier: 5, label: 'Shroud', hint: 'Starlight thins. So does your margin.' },
  { tier: 6, label: 'Blight', hint: 'Worlds the hives finished and kept.' },
  { tier: 7, label: 'Maelstrom', hint: 'The arm breaks up here. So do fleets.' },
  { tier: 8, label: 'Abyss', hint: 'Between the arms. Nothing survives that is not already dead.' },
  { tier: 9, label: 'Terminus', hint: 'The rim. There is no deeper, only more of it.' },
];

const SYSTEM_PREFIXES = [
  'Kepler', 'Vela', 'Tycho', 'Corvid', 'Halcyon', 'Meridian', 'Sable', 'Ferrous',
  'Auric', 'Cygnet', 'Lumen', 'Perihelion', 'Obsidian', 'Cinder', 'Requiem',
  'Vesper', 'Tenebrae', 'Aster', 'Corvus', 'Rime', 'Cathedra', 'Sagitta',
  'Antaris', 'Pallid', 'Thren', 'Ossuary', 'Kestrel', 'Nadir',
];
const SYSTEM_SUFFIXES = [
  'Reach', 'Cluster', 'Sink', 'Cradle', 'Shoal', 'Anchorage',
  'Spur', 'Verge', 'Gate', 'Rift', 'Hollow', 'Wake',
];
const ARM_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];

// The threat band a world's level multiplier falls in. One band per point of
// multiplier, clamped at the rim — deliberately a pure function of `mult` so
// the band a player reads on the map is the band the simulation gives them.
export function threatTierFor(mult) {
  const m = Number.isFinite(mult) ? mult : 0;
  if (m <= 2) return 0;
  return clamp(Math.ceil(m - 2), 1, THREAT_TIERS.length - 1);
}

export function threatTierInfo(tier) {
  return THREAT_TIERS[clamp(tier | 0, 0, THREAT_TIERS.length - 1)];
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------
// Systems sit on `arms` logarithmic spiral arms. System 0 is Sol at the hub;
// every other system takes the next slot on the next arm, so ring k holds one
// system per arm and the radius only ever grows. Level ids are handed out in
// that order, which is why "further out" and "harder" are the same statement.
export function generateGalaxy(seed = GALAXY_SEED, opts = {}) {
  const systemCount = Math.max(1, opts.systems || GALAXY_SYSTEMS);
  const arms = Math.max(1, opts.arms || GALAXY_ARMS);
  const rng = makeRNG(seed >>> 0);
  const rings = Math.max(1, Math.ceil((systemCount - 1) / arms));
  const ringGap = rings > 1 ? 0.86 / (rings - 1) : 0.86;
  const jitter = (amp) => (rng() - 0.5) * 2 * amp;

  const systems = [];
  const worlds = [];
  const usedNames = new Set();
  let nextLevelId = LEVELS.length + 1;

  // Sol: Earth is a galaxy world like any other as far as travel is concerned,
  // and nothing like one as far as content is concerned — its descriptor is
  // the authored five-front campaign planet.
  const sol = {
    id: 'sys-sol', name: 'Sol', designation: 'Sol', index: 0, arm: 0, ring: 0,
    seed: seed >>> 0, position: { x: 0, y: 0, z: 0 }, polar: { r: 0, theta: 0 },
    threatTier: 0, worlds: [],
  };
  const earth = {
    id: 'earth', name: 'Earth', systemId: sol.id, systemName: sol.name,
    levelId: null, seed: seed >>> 0, kind: 'home',
    kindLabel: 'Homeworld', kindIcon: '\u{1F30D}',
    index: 0, orbit: 0, distance: 0, threatTier: 0, threatLabel: THREAT_TIERS[0].label,
    mult: 2, size: null, nests: 0, terrain: LEVELS[0].theme.terrain, city: LEVELS[0].theme.city,
    palette: LEVELS[0].theme.palette, boss: { icon: LEVELS[4].boss.icon, name: LEVELS[4].boss.name },
    blurb: 'Five fronts, one homeworld. The war that taught you the war.',
    position: { x: 0, y: 0, z: 0 },
  };
  sol.worlds.push(earth);
  systems.push(sol);
  worlds.push(earth);

  for (let i = 1; i < systemCount; i++) {
    const slot = i - 1;
    const arm = slot % arms;
    const ring = Math.floor(slot / arms);
    // Radial jitter stays well under half a ring gap so no amount of noise can
    // reorder the systems — distance order IS level-id order, always.
    const r = 0.14 + ring * ringGap + jitter(ringGap * 0.22);
    const theta = (arm / arms) * Math.PI * 2 + ring * 0.62 + jitter(0.09);
    const position = {
      x: Math.cos(theta) * r,
      y: Math.sin(theta) * r,
      z: Math.sin(theta * 2 + ring) * r * 0.07,
    };
    let name = `${SYSTEM_PREFIXES[(i * 5) % SYSTEM_PREFIXES.length]} ${SYSTEM_SUFFIXES[(i * 7) % SYSTEM_SUFFIXES.length]}`;
    const designation = `${ARM_NAMES[arm % ARM_NAMES.length]}-${ring + 1}`;
    if (usedNames.has(name)) name = `${name} ${designation}`;
    usedNames.add(name);

    const span = GALAXY_WORLDS_MAX - GALAXY_WORLDS_MIN + 1;
    const worldCount = GALAXY_WORLDS_MIN + Math.floor(rng() * span);
    const system = {
      id: `sys-${i}`, name, designation, index: i, arm, ring,
      seed: (seed ^ (i * 0x9e3779b1)) >>> 0,
      position, polar: { r, theta }, threatTier: 0, worlds: [],
    };
    for (let w = 0; w < worldCount; w++) {
      const levelId = nextLevelId++;
      const angle = (w / Math.max(1, worldCount)) * Math.PI * 2 + theta;
      const spread = 0.018 + w * 0.012;
      system.worlds.push(makeWorld(levelId, system, w, {
        x: position.x + Math.cos(angle) * spread,
        y: position.y + Math.sin(angle) * spread,
        z: position.z,
      }));
    }
    system.threatTier = system.worlds[0].threatTier;
    systems.push(system);
    worlds.push(...system.worlds);
  }

  const galaxy = {
    seed: seed >>> 0, arms, rings,
    systems, worlds,
    worldCount: worlds.length,
    frontierCount: worlds.length - 1,
    firstLevelId: LEVELS.length + 1,
    lastLevelId: nextLevelId - 1,
  };
  galaxy.hash = galaxyHash(galaxy);
  return galaxy;
}

// One frontier world. Everything that decides how it PLAYS is read back out of
// `levelById()`; everything decided here is where it sits and how it reads.
function makeWorld(levelId, system, orbit, position) {
  const level = levelById(levelId);
  const kind = level.worldKind || galaxyWorldKind(levelId);
  const kindInfo = GALAXY_WORLD_KINDS[kind] || GALAXY_WORLD_KINDS.standard;
  const tier = threatTierFor(level.mult);
  return {
    id: `frontier-${levelId}`,
    name: level.name,
    systemId: system.id,
    systemName: system.name,
    levelId,
    seed: level.seed,
    kind,
    kindLabel: kindInfo.label,
    kindIcon: kindInfo.icon,
    kindDesc: kindInfo.desc,
    index: levelId - LEVELS.length,
    orbit,
    distance: Math.hypot(position.x, position.y),
    threatTier: tier,
    threatLabel: threatTierInfo(tier).label,
    mult: level.mult,
    size: level.size,
    nests: level.nests,
    terrain: level.theme.terrain,
    city: level.theme.city,
    palette: level.theme.palette,
    boss: { icon: level.boss.icon, name: level.boss.name },
    blurb: level.blurb,
    position,
  };
}

// ---------------------------------------------------------------------------
// Lookups and progress
// ---------------------------------------------------------------------------
export function findSystem(galaxy, systemId) {
  return galaxy.systems.find((s) => s.id === systemId) || null;
}

export function findWorld(galaxy, worldId) {
  return galaxy.worlds.find((w) => w.id === worldId) || null;
}

export function worldByLevelId(galaxy, levelId) {
  return galaxy.worlds.find((w) => w.levelId === (levelId | 0)) || null;
}

// The galaxy opens once Earth is retaken, and then one world at a time — the
// same ladder `overworld.js` publishes, so both agree about what is reachable.
export function worldUnlocked(world, campaignCleared = 0) {
  if (!world || world.id === 'earth') return true;
  return campaignCleared >= LEVELS.length && world.levelId <= campaignCleared + 1;
}

export function worldCleared(world, campaignCleared = 0) {
  if (!world) return false;
  if (world.id === 'earth') return campaignCleared >= LEVELS.length;
  return world.levelId <= campaignCleared;
}

// The mission a world starts. Holdouts run the survival rules; everything else
// runs the campaign rules. Read at launch — the world never runs a mode of its
// own, it just says which one it is.
export function worldMissionMode(world) {
  return world && world.kind === 'holdout' ? 'survival' : 'campaign';
}

export function galaxyProgress(galaxy, campaignCleared = 0) {
  const frontier = galaxy.worlds.filter((w) => w.id !== 'earth');
  const cleared = frontier.filter((w) => worldCleared(w, campaignCleared));
  const next = frontier.find((w) => worldUnlocked(w, campaignCleared) && !worldCleared(w, campaignCleared)) || null;
  return {
    cleared: cleared.length,
    total: frontier.length,
    earthRetaken: campaignCleared >= LEVELS.length,
    deepestTier: cleared.reduce((t, w) => Math.max(t, w.threatTier), 0),
    highestMult: cleared.reduce((m, w) => Math.max(m, w.mult), campaignCleared >= LEVELS.length ? 2 : 0),
    next,
  };
}

// A destination list shaped exactly like `overworld.galaxyDestinations()` —
// id / name / subtitle / levelId / unlocked / cleared / threat — so existing
// UI renders a generated galaxy with no changes, plus the extra fields
// (system, kind, tier, position) a galaxy map can draw with.
export function galaxyDestinationList(galaxy, campaignCleared = 0, depth = Infinity) {
  const out = [];
  for (const world of galaxy.worlds) {
    if (world.id !== 'earth' && world.index > depth) continue;
    out.push({
      id: world.id,
      name: world.name,
      subtitle: world.id === 'earth' ? 'Humanity\'s starting world' : world.blurb,
      levelId: world.levelId,
      unlocked: worldUnlocked(world, campaignCleared),
      cleared: worldCleared(world, campaignCleared),
      threat: world.id === 'earth' ? 0 : world.index,
      tier: world.threatTier,
      tierLabel: world.threatLabel,
      mult: world.mult,
      kind: world.kind,
      kindLabel: world.kindLabel,
      kindIcon: world.kindIcon,
      system: world.systemName,
      systemId: world.systemId,
      position: world.position,
      mode: worldMissionMode(world),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// World descriptors
// ---------------------------------------------------------------------------
// A generated planet is the same kind of object Earth is: regions with their
// own landform, palette, gate and lock state. Region ORDER is band order —
// the landing shelf owns the near half of the diagonal, the warzone the far
// half — and a derelict adds a bounded crag region for its hulk.
const DESCRIPTOR_SIZES = { standard: 96, holdout: 88, derelict: 112 };

// The landform a world's landing shelf uses: never the warzone's own, so the
// two bands always read as two places.
const SHELF_TERRAIN = {
  moor: 'hills', fen: 'moor', wastes: 'fen', hills: 'wastes', vale: 'moor',
};

export function descriptorForWorld(world, campaignCleared = 0) {
  if (!world) return earthWorldDescriptor(campaignCleared);
  if (world.id === 'earth') return earthWorldDescriptor(campaignCleared);
  const level = levelById(world.levelId);
  const N = DESCRIPTOR_SIZES[world.kind] || DESCRIPTOR_SIZES.standard;
  const rng = makeRNG((level.seed ^ 0x6a11a7) >>> 0);
  const at = (fx, fz, wobble = 0.03) => ({
    x: clamp(Math.round(N * (fx + (rng() - 0.5) * wobble)), 8, N - 9),
    z: clamp(Math.round(N * (fz + (rng() - 0.5) * wobble)), 8, N - 9),
  });
  const palette = level.theme.palette;
  // The landing shelf is the same world seen from the other side: one hue step
  // off the warzone's palette, on a sibling landform. Two bands, one planet.
  const shelfPalette = {};
  const shelfShift = 26 + ((world.levelId * 13) % 40);
  for (const [k, v] of Object.entries(palette)) shelfPalette[k] = shiftHue(v, shelfShift);
  const shelfTerrain = SHELF_TERRAIN[level.theme.terrain] || 'moor';

  const locked = !worldUnlocked(world, campaignCleared);
  const cleared = worldCleared(world, campaignCleared);
  const regions = [
    {
      id: `${world.id}-orbit`, kind: 'portal', label: 'Orbital Lift',
      blurb: 'Return to the starship and navigate the galaxy.',
      palette: shelfPalette, terrain: shelfTerrain,
      gate: at(0.24, 0.28), locked: false, cleared: false,
    },
    {
      id: `${world.id}-mission`, kind: 'level', levelId: world.levelId,
      label: world.kind === 'holdout' ? `${level.name} Holdout` : `${level.name} Warzone`,
      blurb: level.blurb,
      boss: { icon: level.boss.icon, name: level.boss.name },
      palette, terrain: level.theme.terrain,
      gate: at(0.68, 0.72), locked, cleared,
    },
  ];
  if (world.kind === 'derelict') {
    // The hulk: authored crag around a mouth, exactly like Earth's labyrinth
    // knuckle. The trials inside it are the existing gauntlet — a derelict is
    // a reason to walk into one, not a new set of them.
    const centre = at(0.80, 0.20, 0.02);
    regions.push({
      id: `${world.id}-hulk`, kind: 'labyrinth',
      label: `The ${level.name} Hulk`,
      blurb: 'A dead colony ship half-buried in the crust. Something is still moving in it.',
      trials: LABYRINTH_LEVELS.map((l) => ({ id: l.id, name: l.name })),
      palette: LABYRINTH_LEVELS[0].theme.palette, terrain: 'labyrinth',
      gate: { x: centre.x - 3, z: centre.z + 3 },
      center: centre, radius: Math.round(N * 0.15),
      locked: false, cleared: false,
    });
  }
  return {
    id: world.id,
    name: world.name,
    seed: (level.seed ^ 0x6a11a7) >>> 0,
    size: N,
    spawn: { x: Math.round(N * 0.13), z: Math.round(N * 0.13) },
    regions,
    // Galaxy metadata rides along with the descriptor so whoever loads a world
    // knows what kind of place it is without re-deriving it.
    kind: world.kind,
    kindLabel: world.kindLabel,
    mode: worldMissionMode(world),
    levelId: world.levelId,
    systemId: world.systemId,
    systemName: world.systemName,
    threatTier: world.threatTier,
    threatLabel: world.threatLabel,
    mult: world.mult,
  };
}

// Resolve any world id against a galaxy — the galaxy-side twin of
// `overworld.galaxyWorldDescriptor()`. Unknown ids fall back to Earth rather
// than stranding a player on a planet that does not exist.
export function descriptorForWorldId(galaxy, worldId, campaignCleared = 0) {
  if (!worldId || worldId === 'earth') return earthWorldDescriptor(campaignCleared);
  const world = findWorld(galaxy, worldId);
  if (!world) return earthWorldDescriptor(campaignCleared);
  return descriptorForWorld(world, campaignCleared);
}

// ---------------------------------------------------------------------------
// Structure hash
// ---------------------------------------------------------------------------
// FNV-1a over the fields that define the galaxy's SHAPE. Two runs of the same
// seed must produce the same hash; the check pins the shipped galaxy's hash so
// a change to the layout can never land silently.
export function galaxyHash(galaxy) {
  const parts = [`g:${galaxy.seed}:${galaxy.arms}`];
  for (const system of galaxy.systems) {
    parts.push(`s:${system.id}:${system.name}:${system.seed}:${system.threatTier}`
      + `:${system.position.x.toFixed(5)}:${system.position.y.toFixed(5)}:${system.position.z.toFixed(5)}`);
    for (const world of system.worlds) {
      parts.push(`w:${world.id}:${world.name}:${world.kind}:${world.levelId}:${world.seed}`
        + `:${world.threatTier}:${world.mult.toFixed(3)}`);
    }
  }
  let h = 0x811c9dc5;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// The shipped galaxy, built once. Every caller shares it — generation is pure,
// so a second copy would only cost memory.
let _galaxy = null;
export function knownGalaxy() {
  if (!_galaxy) _galaxy = generateGalaxy(GALAXY_SEED);
  return _galaxy;
}
