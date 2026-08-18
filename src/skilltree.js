// The Lattice — one shared passive tree for every MMO character.
//
// Characters have been earning a talent point per level since MMO characters
// shipped, and nothing has ever spent one. This is the spend surface.
//
// Three rules make it safe to wire into a deterministic, lockstep game:
//
//   * The tree is GENERATED, not authored. Seven hundred hand-placed nodes is
//     a decade of maintenance; a fixed seed plus a small sector table is not.
//     `terrain.js`, `lanes.js` and `galaxy.js` already work this way.
//   * Effects are DATA. A trace or a relay is a bag of numbers on the same mod
//     keys `itemMods()` already speaks, folded in once at run start. No node
//     carries behaviour, so this module can never change what the simulation
//     does mid-run and can never desync a peer.
//   * A doctrine is a FLAG. Rule-changing nodes name a rule; `game.js` owns
//     the rule in simulation code. Adding one is a code change with a
//     regression check, never a data row — that is what protects snapshot
//     restore and the lockstep hash.
//
// Headless and three-free — `scripts/skilltree-check.mjs` drives the whole
// surface in plain Node.
import { MOD_KEYS, ATTRIBUTES } from './items.js';

// Bumping this invalidates saved allocations. Every character prunes to a
// legal build on load rather than breaking, but the points come back.
export const LATTICE_VERSION = 1;

// The generator's own seed. It never touches the simulation random source.
const LATTICE_SEED = 0x5a17e;

export const LATTICE_RINGS = 8;
export const POINT_CAP = 122;          // 99 from levels, the rest from the campaign
export const REWIRE_COST = 45;         // Salvage Alloy per point refunded

// ---------- sectors ----------
//
// Nine wedges, three to an attribute. A sector decides what its traces roll
// and what its relays are about. The angular span is what puts an origin near
// some sectors and a long walk from others.
export const SECTORS = {
  bulwark: {
    key: 'bulwark', name: 'Bulwark', icon: '🛡️', attr: 'frame', color: '#8fa3c4', arc: 0,
    desc: 'Plate, mass and the refusal to fall over.',
    traces: [{ hp: 22 }, { hp: 16, regen: 0.4 }, { armor: 0.012 }],
    relays: [
      { name: 'Ironbound', mods: { hp: 90, armor: 0.03 } },
      { name: 'Unbroken Line', mods: { hp: 120, regen: 1.2 } },
      { name: 'Anvil Stance', mods: { armor: 0.06, thorns: 0.08 } },
      { name: 'Deep Reserves', mods: { hp: 150 } },
    ],
  },
  butchery: {
    key: 'butchery', name: 'Butchery', icon: '🪓', attr: 'frame', color: '#d07070', arc: 1,
    desc: 'Weight behind the swing. Everything here is about the hit landing harder.',
    traces: [{ dmg: 0.018 }, { dmg: 0.014, critMult: 0.02 }, { dmg: 0.012, hp: 8 }],
    relays: [
      { name: 'Cleaving Force', mods: { dmg: 0.09 } },
      { name: 'Red Work', mods: { dmg: 0.06, critMult: 0.12 } },
      { name: 'Overbear', mods: { dmg: 0.07, kinetic: 0.08 } },
      { name: 'Butcher’s Rhythm', mods: { dmg: 0.05, rof: 0.05 } },
    ],
  },
  siegeworks: {
    key: 'siegeworks', name: 'Siegeworks', icon: '🏗️', attr: 'frame', color: '#c9a45e', arc: 2,
    desc: 'The colony and the army under your command, not the hand on the trigger.',
    traces: [{ troopDmg: 0.014 }, { towerDmg: 0.016 }, { buildingHp: 0.018 }, { income: 0.01 }],
    relays: [
      { name: 'Standing Orders', mods: { troopDmg: 0.07 } },
      { name: 'Ranging Tables', mods: { towerDmg: 0.09 } },
      { name: 'Deep Foundations', mods: { buildingHp: 0.1 } },
      { name: 'War Tithe', mods: { income: 0.06, troopDmg: 0.04 } },
    ],
  },
  swiftness: {
    key: 'swiftness', name: 'Swiftness', icon: '🌬️', attr: 'reflex', color: '#7fd0a8', arc: 3,
    desc: 'Ground crossed and shots not taken.',
    traces: [{ speed: 0.008 }, { evadeChance: 0.008 }, { speed: 0.006, magnet: 0.15 }],
    relays: [
      { name: 'Long Stride', mods: { speed: 0.05 } },
      { name: 'Ghostwalk', mods: { evadeChance: 0.05, speed: 0.03 } },
      { name: 'Scavenger’s Eye', mods: { magnet: 1.5, speed: 0.02 } },
      { name: 'Untouchable', mods: { evadeChance: 0.07 } },
    ],
  },
  marksmanship: {
    key: 'marksmanship', name: 'Marksmanship', icon: '🎯', attr: 'reflex', color: '#7fb8e0', arc: 4,
    desc: 'Distance and the precision to use it.',
    traces: [{ range: 0.07 }, { critChance: 0.006 }, { critMult: 0.025 }],
    relays: [
      { name: 'Cold Sight', mods: { range: 0.6, critChance: 0.03 } },
      { name: 'Killing Angle', mods: { critChance: 0.04, critMult: 0.15 } },
      { name: 'Overwatch', mods: { range: 1.0 } },
      { name: 'One Breath', mods: { critMult: 0.3 } },
    ],
  },
  fusillade: {
    key: 'fusillade', name: 'Fusillade', icon: '🔥', attr: 'reflex', color: '#e0956a', arc: 5,
    desc: 'Volume of fire. More trigger-pulls, faster.',
    traces: [{ rof: 0.012 }, { rof: 0.009, dmg: 0.006 }, { cdr: 0.008 }],
    relays: [
      { name: 'Suppressing Fire', mods: { rof: 0.08 } },
      { name: 'Cycling Action', mods: { rof: 0.05, cdr: 0.05 } },
      { name: 'Sustained Rate', mods: { rof: 0.06, dmg: 0.03 } },
      { name: 'Hair Trigger', mods: { rof: 0.09, critChance: 0.02 } },
    ],
  },
  resonance: {
    key: 'resonance', name: 'Resonance', icon: '📡', attr: 'signal', color: '#a9c0e8', arc: 6,
    desc: 'What reaches past you — auras, recharge, the field you stand in.',
    traces: [{ auraR: 0.014 }, { cdr: 0.01 }, { auraR: 0.01, regen: 0.3 }],
    relays: [
      { name: 'Wide Field', mods: { auraR: 0.12 } },
      { name: 'Fast Cycle', mods: { cdr: 0.08 } },
      { name: 'Standing Wave', mods: { auraR: 0.08, cdr: 0.05 } },
      { name: 'Carrier Signal', mods: { auraR: 0.15, troopDmg: 0.04 } },
    ],
  },
  thermics: {
    key: 'thermics', name: 'Thermics', icon: '🔥', attr: 'signal', color: '#e08a4b', arc: 7,
    desc: 'Burn-through. Nothing here helps until something is on fire.',
    traces: [{ thermal: 0.016 }, { thermal: 0.012, dmg: 0.006 }, { shock: 0.014 }],
    relays: [
      { name: 'Render', mods: { thermal: 0.1 } },
      { name: 'Ignition Cascade', mods: { thermal: 0.07, rof: 0.04 } },
      { name: 'Arc Bloom', mods: { shock: 0.1 } },
      { name: 'Conductor', mods: { shock: 0.07, critChance: 0.02 } },
    ],
  },
  abyss: {
    key: 'abyss', name: 'The Abyss', icon: '☲', attr: 'signal', color: '#a07fd0', arc: 8,
    desc: 'Void work. It unmakes armour and asks for something back.',
    traces: [{ void: 0.016 }, { void: 0.012, cdr: 0.006 }, { void: 0.01, hp: -6 }],
    relays: [
      { name: 'Unmaking', mods: { void: 0.1 } },
      { name: 'Hollow Point', mods: { void: 0.07, critMult: 0.12 } },
      { name: 'Thin Places', mods: { void: 0.08, speed: 0.03 } },
      { name: 'Event Horizon', mods: { void: 0.12, hp: -40 } },
    ],
  },
};

export const SECTOR_KEYS = Object.keys(SECTORS);

// ---------- doctrines ----------
//
// A doctrine changes a RULE and states its cost. It cannot ship behaviour in
// data without breaking snapshot restore and lockstep, so each one is a flag
// and `game.js` owns the rule. `mods` is the part that is still just numbers.
//
// Adding a doctrine means adding a rule in the simulation and a check for it.
// The count is capped by what the simulation can carry, not by the tree.
export const DOCTRINES = {
  scorched_supply: {
    id: 'scorched_supply', name: 'Scorched Supply', icon: '🔥', sector: 'thermics',
    desc: 'Your fire renders everything. Enemy resistances count for half.',
    cost: 'Your colony earns 20% less.',
    rule: true, mods: { income: -0.2 },
  },
  lone_command: {
    id: 'lone_command', name: 'Lone Command', icon: '🗡️', sector: 'butchery',
    desc: 'You fight for the whole army. +45% hero damage.',
    cost: 'Your squads deal 30% less damage.',
    mods: { dmg: 0.45, troopDmg: -0.3 },
  },
  glass_lattice: {
    id: 'glass_lattice', name: 'Glass Lattice', icon: '💎', sector: 'marksmanship',
    desc: 'Every shot is a killing shot. +30% critical damage, +8% critical chance.',
    cost: 'You have 35% less maximum health.',
    mods: { critMult: 0.3, critChance: 0.08, hp: -0.35 },
  },
  immovable: {
    id: 'immovable', name: 'Immovable', icon: '🗿', sector: 'bulwark',
    desc: 'Nothing moves you. +200 health, +10% armour.',
    cost: 'You move 25% slower.',
    mods: { hp: 200, armor: 0.1, speed: -0.25 },
  },
  open_channel: {
    id: 'open_channel', name: 'Open Channel', icon: '📶', sector: 'resonance',
    desc: 'Your special recharges 40% faster and your aura reaches 30% further.',
    cost: 'Your attacks deal 20% less damage.',
    mods: { cdr: 0.4, auraR: 0.3, dmg: -0.2 },
  },
  hollow_pact: {
    id: 'hollow_pact', name: 'Hollow Pact', icon: '☲', sector: 'abyss',
    desc: 'Void damage ignores armour entirely.',
    cost: 'You lose 2 health a second, always.',
    rule: true, mods: { regen: -2 },
  },
  forced_march: {
    id: 'forced_march', name: 'Forced March', icon: '🥾', sector: 'swiftness',
    desc: 'You and your squads move 20% faster.',
    cost: 'You have 25% less armour and evasion.',
    mods: { speed: 0.2, armor: -0.25, evadeChance: -0.25 },
  },
  quartermaster: {
    id: 'quartermaster', name: 'Quartermaster', icon: '📦', sector: 'siegeworks',
    desc: 'The colony earns 30% more and structures have 25% more health.',
    cost: 'You attack 15% slower.',
    mods: { income: 0.3, buildingHp: 0.25, rof: -0.15 },
  },
  full_auto: {
    id: 'full_auto', name: 'Full Auto', icon: '💢', sector: 'fusillade',
    desc: 'You attack 35% faster.',
    cost: 'Every attack deals 20% less damage.',
    mods: { rof: 0.35, dmg: -0.2 },
  },
};

export const DOCTRINE_IDS = Object.keys(DOCTRINES);

// ---------- origins ----------
//
// One start position per class. The class does not get its own tree; it gets
// a door into the shared one. The nearby sectors are the cheap ones, and
// walking to a far sector is what a build costs.
export const ORIGINS = {
  berserker: { key: 'berserker', sector: 'butchery' },
  vox_officer: { key: 'vox_officer', sector: 'siegeworks' },
  chaplain: { key: 'chaplain', sector: 'resonance' },
  xenoshaper: { key: 'xenoshaper', sector: 'bulwark' },
  vanguard: { key: 'vanguard', sector: 'bulwark' },
  voidblade: { key: 'voidblade', sector: 'swiftness' },
  warden: { key: 'warden', sector: 'siegeworks' },
  recon: { key: 'recon', sector: 'marksmanship' },
  operative: { key: 'operative', sector: 'swiftness' },
  psion: { key: 'psion', sector: 'abyss' },
  voidbound: { key: 'voidbound', sector: 'abyss' },
  arcanist: { key: 'arcanist', sector: 'thermics' },
  engineer: { key: 'engineer', sector: 'fusillade' },
};

// ---------- generation ----------

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

const TAU = Math.PI * 2;
const RING_STEP = 100;                  // layout units between rings
const RING_COUNT = (r) => 22 + (r - 1) * 16;

// Which sector owns an angle. Nine wedges, evenly cut.
function sectorAt(angle) {
  const wedge = Math.floor((((angle % TAU) + TAU) % TAU) / (TAU / SECTOR_KEYS.length));
  return SECTORS[SECTOR_KEYS[Math.min(SECTOR_KEYS.length - 1, wedge)]];
}

// The tree, built once and cached. Same seed, same graph, on every machine.
let TREE = null;

export function buildLattice() {
  if (TREE) return TREE;
  const rng = stream(LATTICE_SEED);
  const nodes = [];
  const byId = new Map();
  const ringNodes = [];

  const add = (node) => {
    node.edges = [];
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };

  // Rings of traces, with a relay every sixth node and an attribute node every
  // fifth. Doctrines take fixed positions on the outermost ring.
  for (let r = 1; r <= LATTICE_RINGS; r++) {
    const count = RING_COUNT(r);
    const ring = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU;
      const sector = sectorAt(angle);
      const id = `n${r}_${i}`;
      const x = Math.cos(angle) * r * RING_STEP;
      const y = Math.sin(angle) * r * RING_STEP;
      let node;
      if (i % 6 === 3 && r >= 2) {
        const pool = sector.relays;
        const relay = pool[Math.floor(rng() * pool.length)];
        node = {
          id, kind: 'relay', sector: sector.key, ring: r, x, y,
          name: relay.name, icon: sector.icon, mods: { ...relay.mods },
        };
      } else if (i % 5 === 0) {
        const attr = sector.attr;
        node = {
          id, kind: 'attribute', sector: sector.key, ring: r, x, y,
          name: `+${ATTR_STEP} ${ATTRIBUTES[attr].name}`, icon: ATTRIBUTES[attr].icon,
          mods: { [attr]: ATTR_STEP },
        };
      } else {
        const pool = sector.traces;
        const trace = pool[Math.floor(rng() * pool.length)];
        node = {
          id, kind: 'trace', sector: sector.key, ring: r, x, y,
          name: traceName(trace), icon: '·', mods: { ...trace },
        };
      }
      ring.push(add(node));
    }
    ringNodes.push(ring);
  }

  // Doctrines sit beyond the last ring, one per sector, each hanging off the
  // outer ring by a single edge. Reaching one is a deliberate walk.
  const outer = ringNodes[LATTICE_RINGS - 1];
  for (const [i, id] of DOCTRINE_IDS.entries()) {
    const doctrine = DOCTRINES[id];
    const sectorIdx = SECTOR_KEYS.indexOf(doctrine.sector);
    const angle = ((sectorIdx + 0.5) / SECTOR_KEYS.length) * TAU;
    const node = add({
      id: `d_${id}`, kind: 'doctrine', sector: doctrine.sector, ring: LATTICE_RINGS + 1,
      x: Math.cos(angle) * (LATTICE_RINGS + 1) * RING_STEP,
      y: Math.sin(angle) * (LATTICE_RINGS + 1) * RING_STEP,
      name: doctrine.name, icon: doctrine.icon, mods: { ...(doctrine.mods || {}) },
      doctrine: id,
    });
    // Anchor to the nearest outer-ring node.
    let best = outer[0], bd = Infinity;
    for (const candidate of outer) {
      const d = (candidate.x - node.x) ** 2 + (candidate.y - node.y) ** 2;
      if (d < bd) { bd = d; best = candidate; }
    }
    link(node, best);
  }

  // Origins: one per class, inside ring 1, each wired to the ring-1 nodes
  // nearest its sector. An origin is free and always allocated.
  for (const [key, origin] of Object.entries(ORIGINS)) {
    const sectorIdx = SECTOR_KEYS.indexOf(origin.sector);
    const angle = ((sectorIdx + 0.5) / SECTOR_KEYS.length) * TAU;
    const node = add({
      id: `o_${key}`, kind: 'origin', sector: origin.sector, ring: 0,
      x: Math.cos(angle) * 0.42 * RING_STEP, y: Math.sin(angle) * 0.42 * RING_STEP,
      name: key, icon: '◈', mods: {}, origin: key,
    });
    const first = ringNodes[0]
      .map((n) => [n, (n.x - node.x) ** 2 + (n.y - node.y) ** 2])
      .sort((a, b) => a[1] - b[1]);
    for (const [neighbour] of first.slice(0, 2)) link(node, neighbour);
  }

  // Tangential edges, with gaps. A fully connected ring would let a build walk
  // the whole circle cheaply and every sector would be equally near.
  for (let r = 0; r < LATTICE_RINGS; r++) {
    const ring = ringNodes[r];
    for (let i = 0; i < ring.length; i++) {
      const next = ring[(i + 1) % ring.length];
      if (rng() < 0.18) continue;      // the gap
      link(ring[i], next);
    }
  }
  // Radial edges, sparse — these are the ways between rings, and their scarcity
  // is what makes one route to a relay shorter than another.
  for (let r = 1; r < LATTICE_RINGS; r++) {
    const inner = ringNodes[r - 1], outerRing = ringNodes[r];
    for (let i = 0; i < outerRing.length; i++) {
      if (rng() < 0.62) continue;
      const node = outerRing[i];
      let best = inner[0], bd = Infinity;
      for (const candidate of inner) {
        const d = (candidate.x - node.x) ** 2 + (candidate.y - node.y) ** 2;
        if (d < bd) { bd = d; best = candidate; }
      }
      link(node, best);
    }
  }

  TREE = { nodes, byId, rings: ringNodes, version: LATTICE_VERSION };
  ensureReachable(TREE);
  return TREE;
}

const ATTR_STEP = 5;

function link(a, b) {
  if (!a || !b || a === b) return;
  if (!a.edges.includes(b.id)) a.edges.push(b.id);
  if (!b.edges.includes(a.id)) b.edges.push(a.id);
}

function traceName(mods) {
  const keys = Object.keys(mods);
  const label = {
    hp: 'Vigour', regen: 'Mending', armor: 'Plating', dmg: 'Force', rof: 'Cadence',
    range: 'Reach', speed: 'Stride', cdr: 'Cycle', auraR: 'Field', critChance: 'Precision',
    critMult: 'Cruelty', evadeChance: 'Evasion', magnet: 'Avarice', troopDmg: 'Command',
    towerDmg: 'Ranging', buildingHp: 'Masonry', income: 'Tithe', thermal: 'Ignition',
    shock: 'Arc', void: 'Unmaking', kinetic: 'Impact', thorns: 'Retort',
  };
  return keys.map((k) => label[k] || k).join(' and ');
}

// Nothing may be stranded. A node no origin can reach is a node that can never
// be bought, and it would sit on the screen forever looking like a bug.
function ensureReachable(tree) {
  const originIds = Object.keys(ORIGINS).map((k) => `o_${k}`);
  const seen = new Set(originIds);
  const queue = [...originIds];
  while (queue.length) {
    const node = tree.byId.get(queue.shift());
    for (const id of node.edges) {
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(id);
    }
  }
  for (const node of tree.nodes) {
    if (seen.has(node.id)) continue;
    // Stitch a stranded node to its nearest reachable neighbour rather than
    // dropping it — the generator stays simple and the graph stays whole.
    let best = null, bd = Infinity;
    for (const other of tree.nodes) {
      if (!seen.has(other.id) || other.ring === node.ring + 2) continue;
      const d = (other.x - node.x) ** 2 + (other.y - node.y) ** 2;
      if (d < bd) { bd = d; best = other; }
    }
    if (best) {
      link(node, best);
      seen.add(node.id);
      for (const id of node.edges) if (!seen.has(id)) { seen.add(id); }
    }
  }
}

// ---------- allocation ----------
//
// An allocation is a set of node ids. Legality is graph connectivity from the
// character's origin — the same rule the screen draws and the same rule the
// server would enforce if one ever owned this.

export const originIdFor = (classKey) => (ORIGINS[classKey] ? `o_${classKey}` : null);

// How many points a character has to spend. One per level past the first,
// plus whatever the campaign has handed out, capped.
export function latticePoints(level = 1, questPoints = 0) {
  const fromLevels = Math.max(0, Math.min(99, (Number(level) || 1) - 1));
  const fromQuests = Math.max(0, Math.min(30, Math.floor(Number(questPoints) || 0)));
  return Math.min(POINT_CAP, fromLevels + fromQuests);
}

// Can this node be bought right now? It must exist, be unowned, and touch
// something already owned — with the origin always owned for free.
export function canAllocate(alloc, nodeId, classKey) {
  const tree = buildLattice();
  const node = tree.byId.get(nodeId);
  if (!node || node.kind === 'origin') return false;
  const owned = new Set(alloc || []);
  if (owned.has(nodeId)) return false;
  const originId = originIdFor(classKey);
  if (!originId) return false;
  return node.edges.some((id) => id === originId || owned.has(id));
}

// Removing a node may strand others. Legal removal means the rest still forms
// one connected body hanging off the origin.
export function canDeallocate(alloc, nodeId, classKey) {
  const owned = new Set(alloc || []);
  if (!owned.has(nodeId)) return false;
  owned.delete(nodeId);
  return reachableFrom(owned, classKey).size === owned.size;
}

// Everything in `owned` that the origin can still walk to.
export function reachableFrom(owned, classKey) {
  const tree = buildLattice();
  const originId = originIdFor(classKey);
  const set = owned instanceof Set ? owned : new Set(owned || []);
  const out = new Set();
  if (!originId) return out;
  const queue = [originId];
  const seen = new Set([originId]);
  while (queue.length) {
    const node = tree.byId.get(queue.shift());
    if (!node) continue;
    for (const id of node.edges) {
      if (seen.has(id) || !set.has(id)) continue;
      seen.add(id);
      out.add(id);
      queue.push(id);
    }
  }
  return out;
}

// Everything that could be bought next, for highlighting on the screen.
export function frontier(alloc, classKey) {
  const tree = buildLattice();
  const owned = new Set(alloc || []);
  const originId = originIdFor(classKey);
  const out = new Set();
  if (!originId) return out;
  for (const id of [originId, ...owned]) {
    const node = tree.byId.get(id);
    if (!node) continue;
    for (const edge of node.edges) {
      if (owned.has(edge)) continue;
      const target = tree.byId.get(edge);
      if (target && target.kind !== 'origin') out.add(edge);
    }
  }
  return out;
}

// The cheapest legal route from what is owned to a target, so the screen can
// show what a node really costs. Returns null when nothing connects.
export function pathTo(alloc, nodeId, classKey) {
  const tree = buildLattice();
  const target = tree.byId.get(nodeId);
  const originId = originIdFor(classKey);
  if (!target || !originId || target.kind === 'origin') return null;
  const owned = new Set(alloc || []);
  if (owned.has(nodeId)) return [];
  const start = [originId, ...owned];
  const prev = new Map();
  const seen = new Set(start);
  const queue = [...start];
  while (queue.length) {
    const id = queue.shift();
    const node = tree.byId.get(id);
    if (!node) continue;
    for (const edge of node.edges) {
      if (seen.has(edge)) continue;
      seen.add(edge);
      prev.set(edge, id);
      if (edge === nodeId) {
        const path = [];
        let cursor = edge;
        while (cursor && !owned.has(cursor) && cursor !== originId) {
          path.unshift(cursor);
          cursor = prev.get(cursor);
        }
        return path;
      }
      queue.push(edge);
    }
  }
  return null;
}

// Anything that comes back off disk or off a server goes through here. A tree
// that changed shape between releases must never brick a character: unknown
// and unreachable nodes are dropped and their points come back, exactly the
// way normalizeMeta drops a node whose prerequisites went missing.
export function pruneAlloc(alloc, classKey, points = POINT_CAP) {
  const tree = buildLattice();
  const raw = Array.isArray(alloc) ? alloc : [];
  const known = raw.filter((id) => {
    const node = tree.byId.get(id);
    return node && node.kind !== 'origin';
  });
  let owned = new Set(known);
  // Drop anything the origin cannot walk to, repeatedly — removing one node
  // can strand the node behind it.
  for (;;) {
    const reachable = reachableFrom(owned, classKey);
    if (reachable.size === owned.size) break;
    owned = reachable;
  }
  // Then trim to the point budget, outermost first, so a character who lost
  // levels keeps the core of their build rather than a scattered fringe.
  if (owned.size > points) {
    const ordered = [...owned].sort((a, b) => (tree.byId.get(b).ring || 0) - (tree.byId.get(a).ring || 0));
    for (const id of ordered) {
      if (owned.size <= points) break;
      const trimmed = new Set(owned);
      trimmed.delete(id);
      if (reachableFrom(trimmed, classKey).size === trimmed.size) owned = trimmed;
    }
    // Anything still over budget after connectivity-safe trimming goes anyway,
    // and the prune loop above cleans up whatever that stranded.
    while (owned.size > points) {
      const ordered2 = [...owned].sort((a, b) => (tree.byId.get(b).ring || 0) - (tree.byId.get(a).ring || 0));
      owned.delete(ordered2[0]);
      owned = reachableFrom(owned, classKey);
    }
  }
  return [...owned].sort();
}

// ---------- payload ----------
//
// The one thing the simulation ever reads. Resolved once at run start into a
// flat bag plus a list of doctrine flags. Nothing here is called during a run.
export function treeBonuses(alloc, classKey) {
  const tree = buildLattice();
  const mods = {};
  for (const key of MOD_KEYS) mods[key] = 0;
  const doctrines = [];
  const sectors = {};
  for (const id of pruneAlloc(alloc, classKey)) {
    const node = tree.byId.get(id);
    if (!node) continue;
    for (const [key, value] of Object.entries(node.mods || {})) {
      mods[key] = (mods[key] || 0) + value;
    }
    if (node.doctrine) doctrines.push(node.doctrine);
    sectors[node.sector] = (sectors[node.sector] || 0) + 1;
  }
  return {
    mods,
    doctrines,
    sectors,
    attributes: { frame: mods.frame || 0, reflex: mods.reflex || 0, signal: mods.signal || 0 },
    spent: pruneAlloc(alloc, classKey).length,
  };
}

// What a rewire costs, in the currency the meta tree already uses.
export const rewireCost = (spent) => Math.max(0, Math.floor(spent) * REWIRE_COST);

export function latticeNode(id) {
  return buildLattice().byId.get(id) || null;
}
