// Meta-progression — what a player keeps when a run ends.
//
// A run is over in twenty minutes. This is the ladder underneath all of them:
// every landing pays out Salvage Alloy against the run's score, and Alloy buys
// permanent nodes off a small tree. The rules that make it safe to wire in:
//
//   * Effects are DATA. A node's payload is a bag of numbers the game reads
//     once at run start (`metaBonuses()`); no node ever carries behaviour, so
//     this module can never change what the simulation does mid-run and can
//     never desync a lockstep peer.
//   * Scoring lives in the simulation. `runScore(game)` in `src/game.js` folds
//     a finished run into one number; this module only converts that number
//     into currency. One score, one source.
//   * Storage is a seam, not a decision. LocalStorage today under the same
//     `zillions_*` key namespace as saves and profiles; swap the backend with
//     `setMetaBackend()` and a server owns the same state with no other change.
//
// Headless and three-free like terrain.js — `scripts/galaxy-check.mjs` drives
// the whole award/spend surface in plain Node.
import { threatTierFor } from './galaxy.js';

export const META_KEY = 'zillions_meta';
export const META_VERSION = 1;

// The meta currency. One name for one concept, everywhere it is shown.
export const META_CURRENCY = { key: 'alloy', name: 'Salvage Alloy', icon: '⬡', short: 'AL' };

// Score to Alloy. A won frontier landing scores in the thousands, so this puts
// a node within a handful of runs and the whole tree within a campaign.
export const META_EARN_RATE = 0.02;

export const META_BRANCHES = {
  supply: {
    key: 'supply', name: 'Supply Line', icon: '\u{1F4E6}',
    desc: 'What the drop ship leaves you with: treasury at landing, and how fast it fills.',
  },
  warband: {
    key: 'warband', name: 'Warband', icon: '⚔️',
    desc: 'The body under the armour. Flat gains your character keeps on every world.',
  },
  command: {
    key: 'command', name: 'Command', icon: '\u{1F4E1}',
    desc: 'Ship systems: save slots, how deep the galaxy charts read, what you can carry home.',
  },
};

// Twelve nodes, four to a branch, each gated on the branch below it. `effect`
// is the payload — three groups, all additive, all read at run start:
//   economy.startGold  flat gold in the treasury at landing
//   economy.income     fractional income bonus (0.06 = +6%)
//   hero.hp/dmg/speed/cdr   the same mod keys `itemMods()` already speaks
//   unlock.*           counts and rates the shell reads (save slots, chart
//                      depth, pack slots, currency rate)
export const META_NODES = [
  {
    id: 'supply_cache', branch: 'supply', tier: 1, cost: 120,
    name: 'Drop Cache', icon: '\u{1F4B0}',
    desc: 'The lander sets down with a strongbox. +25 starting gold.',
    requires: [], effect: { economy: { startGold: 25 } },
  },
  {
    id: 'supply_depot', branch: 'supply', tier: 2, cost: 260,
    name: 'Forward Depot', icon: '\u{1F3E6}',
    desc: 'A second pallet comes down with you. +45 starting gold.',
    requires: ['supply_cache'], effect: { economy: { startGold: 45 } },
  },
  {
    id: 'supply_tithe', branch: 'supply', tier: 2, cost: 320,
    name: 'Tithe Route', icon: '\u{1F4CA}',
    desc: 'The colony pays out faster from the first minute. +6% income.',
    requires: ['supply_cache'], effect: { economy: { income: 0.06 } },
  },
  {
    id: 'supply_convoy', branch: 'supply', tier: 3, cost: 640,
    name: 'Standing Convoy', icon: '\u{1F69A}',
    desc: 'A supply run that does not stop for the war. +30 starting gold, +8% income.',
    requires: ['supply_depot', 'supply_tithe'],
    effect: { economy: { startGold: 30, income: 0.08 } },
  },
  {
    id: 'warband_vigor', branch: 'warband', tier: 1, cost: 140,
    name: 'Hardened Frame', icon: '\u{1F9BE}',
    desc: 'Bone-weave and plate under the coat. +40 hero max HP.',
    requires: [], effect: { hero: { hp: 40 } },
  },
  {
    id: 'warband_edge', branch: 'warband', tier: 2, cost: 300,
    name: 'Killing Edge', icon: '\u{1F5E1}️',
    desc: 'Every weapon you are handed is already sighted in. +6% hero damage.',
    requires: ['warband_vigor'], effect: { hero: { dmg: 0.06 } },
  },
  {
    id: 'warband_stride', branch: 'warband', tier: 2, cost: 260,
    name: 'Long Stride', icon: '\u{1F45F}',
    desc: 'You cross ground the horde has to walk. +5% hero move speed.',
    requires: ['warband_vigor'], effect: { hero: { speed: 0.05 } },
  },
  {
    id: 'warband_focus', branch: 'warband', tier: 3, cost: 620,
    name: 'Battle Focus', icon: '\u{1F9E0}',
    desc: 'The big one comes back sooner, and lands harder. +8% recharge, +4% damage.',
    requires: ['warband_edge', 'warband_stride'],
    effect: { hero: { cdr: 0.08, dmg: 0.04 } },
  },
  {
    id: 'command_slot', branch: 'command', tier: 1, cost: 180,
    name: 'Second Berth', icon: '\u{1F4BE}',
    desc: 'The ship keeps a second campaign in cold storage. +1 save slot.',
    requires: [], effect: { unlock: { saveSlots: 1 } },
  },
  {
    id: 'command_scanner', branch: 'command', tier: 2, cost: 340,
    name: 'Deep Scanner', icon: '\u{1F4E1}',
    desc: 'Charts resolve two systems further out than the ones you have taken.',
    requires: ['command_slot'], effect: { unlock: { galaxyDepth: 2 } },
  },
  {
    id: 'command_ledger', branch: 'command', tier: 2, cost: 460,
    name: 'Salvage Ledger', icon: '\u{1F4D2}',
    desc: 'Nothing is written off any more. +10% Salvage Alloy from every run.',
    requires: ['command_slot'], effect: { unlock: { currencyRate: 0.1 } },
  },
  {
    id: 'command_harness', branch: 'command', tier: 3, cost: 720,
    name: 'Extraction Harness', icon: '\u{1F9F3}',
    desc: 'One more thing comes off the field with you, and the charts read deeper still.',
    requires: ['command_scanner', 'command_ledger'],
    effect: { unlock: { packSlots: 1, galaxyDepth: 1 } },
  },
];

export const META_NODES_BY_ID = new Map(META_NODES.map((n) => [n.id, n]));

// The zero payload. Every consumer can read every field without guarding, and
// adding a key here is how a new effect group reaches the game.
export function emptyBonuses() {
  return {
    economy: { startGold: 0, income: 0 },
    hero: { hp: 0, dmg: 0, speed: 0, cdr: 0 },
    unlock: { saveSlots: 0, galaxyDepth: 0, packSlots: 0, currencyRate: 0 },
    nodes: [],
  };
}

export function emptyMeta() {
  return {
    v: META_VERSION,
    currency: 0,
    nodes: {},
    cleared: {},
    lifetime: { earned: 0, spent: 0, runs: 0, wins: 0, bestScore: 0, kills: 0 },
    records: { highestThreat: 0, highestTier: 0, worldsCleared: 0, deepestLevelId: 0 },
    updatedAt: 0,
  };
}

const nonNegInt = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const nonNeg = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Anything that comes back off disk (or, later, off a server) goes through
// here. Corrupt, ancient and hostile states all normalise to a legal profile
// rather than throwing — a bad meta file must never cost someone their game.
export function normalizeMeta(raw) {
  const base = emptyMeta();
  if (!raw || typeof raw !== 'object') return base;
  base.v = META_VERSION;
  base.currency = nonNegInt(raw.currency);
  for (const [id, owned] of Object.entries(raw.nodes || {})) {
    if (owned && META_NODES_BY_ID.has(id)) base.nodes[id] = 1;
  }
  // An owned node whose prerequisites went missing (a hand-edited file, a tree
  // that changed shape between versions) is dropped rather than honoured.
  let dropped = true;
  while (dropped) {
    dropped = false;
    for (const id of Object.keys(base.nodes)) {
      const node = META_NODES_BY_ID.get(id);
      if (node.requires.every((r) => base.nodes[r])) continue;
      delete base.nodes[id];
      dropped = true;
    }
  }
  for (const [levelId, done] of Object.entries(raw.cleared || {})) {
    const n = nonNegInt(levelId);
    if (n && done) base.cleared[n] = 1;
  }
  const life = raw.lifetime || {};
  base.lifetime = {
    earned: nonNegInt(life.earned), spent: nonNegInt(life.spent),
    runs: nonNegInt(life.runs), wins: nonNegInt(life.wins),
    bestScore: nonNegInt(life.bestScore), kills: nonNegInt(life.kills),
  };
  const rec = raw.records || {};
  base.records = {
    highestThreat: nonNeg(rec.highestThreat), highestTier: nonNegInt(rec.highestTier),
    worldsCleared: Object.keys(base.cleared).length, deepestLevelId: nonNegInt(rec.deepestLevelId),
  };
  base.updatedAt = nonNegInt(raw.updatedAt);
  return base;
}

// ---------------------------------------------------------------------------
// Storage backend
// ---------------------------------------------------------------------------
// Two methods, both synchronous, both allowed to fail. That is the whole
// contract a server implementation has to meet — write-behind on top of an
// in-memory mirror is exactly what `memoryBackend()` already is.
export function localStorageBackend(key = META_KEY) {
  return {
    read() {
      try {
        const store = globalThis.localStorage;
        if (!store) return null;
        return JSON.parse(store.getItem(key) || 'null');
      } catch { return null; }
    },
    write(state) {
      try {
        const store = globalThis.localStorage;
        if (!store) return false;
        store.setItem(key, JSON.stringify(state));
        return true;
      } catch { return false; }
    },
  };
}

export function memoryBackend(initial = null) {
  let state = initial;
  return {
    read() { return state; },
    write(next) { state = next; return true; },
  };
}

let _backend = localStorageBackend();
let _cache = null;

// Hand the meta state to something else — a server client, a test double.
// Swapping backends drops the cache so the next read comes from the new owner.
export function setMetaBackend(backend) {
  _backend = backend || localStorageBackend();
  _cache = null;
  return _backend;
}

// ---------------------------------------------------------------------------
// The API surface the shell wires in
// ---------------------------------------------------------------------------
export function loadMeta({ force = false } = {}) {
  if (!_cache || force) _cache = normalizeMeta(_backend.read());
  return _cache;
}

export function saveMeta(meta = _cache, now = 0) {
  if (!meta) return false;
  meta.updatedAt = nonNegInt(now) || meta.updatedAt;
  _cache = meta;
  return _backend.write(meta);
}

export function resetMeta() {
  _cache = emptyMeta();
  _backend.write(_cache);
  return _cache;
}

// Pure award: takes a state and a `runScore()` result, gives back a NEW state
// and what changed. `awardRun()` is this plus persistence.
export function applyAward(meta, scoreResult = {}) {
  const state = normalizeMeta(meta);
  const bonuses = bonusesFor(state);
  const score = nonNegInt(scoreResult.score);
  // Rate bonuses are multiplicative on a non-negative base, so the award can
  // only ever be zero or positive — there is no path to a negative payout.
  const earned = Math.max(0, Math.round(score * META_EARN_RATE * (1 + Math.max(0, bonuses.unlock.currencyRate))));
  const won = !!scoreResult.won;
  const levelId = nonNegInt(scoreResult.levelId);
  const cleared = scoreResult.cleared == null ? won : !!scoreResult.cleared;

  state.currency += earned;
  state.lifetime.earned += earned;
  state.lifetime.runs += 1;
  state.lifetime.kills += nonNegInt(scoreResult.kills);
  if (won) state.lifetime.wins += 1;
  state.lifetime.bestScore = Math.max(state.lifetime.bestScore, score);

  let firstClear = false;
  // A labyrinth trial is not a world and never counts as one — the same rule
  // the campaign ladder keeps.
  const isWorld = levelId > 0 && scoreResult.worldKind !== 'labyrinth';
  if (cleared && isWorld && !state.cleared[levelId]) {
    state.cleared[levelId] = 1;
    firstClear = true;
  }
  if (cleared && isWorld) {
    state.records.highestThreat = Math.max(state.records.highestThreat, nonNeg(scoreResult.mult));
    // The threat band is a pure function of the level multiplier, so a record
    // never depends on whoever assembled the score result remembering to
    // include it.
    const tier = nonNegInt(scoreResult.tier) || threatTierFor(nonNeg(scoreResult.mult));
    state.records.highestTier = Math.max(state.records.highestTier, tier);
    state.records.deepestLevelId = Math.max(state.records.deepestLevelId, levelId);
  }
  state.records.worldsCleared = Object.keys(state.cleared).length;
  return { meta: state, earned, score, firstClear, currency: state.currency };
}

// Persisting award. Call it once when a run ends, with `runScore(game)`.
export function awardRun(scoreResult, { now = 0 } = {}) {
  const result = applyAward(loadMeta(), scoreResult);
  saveMeta(result.meta, now);
  return result;
}

// Pure spend. Refuses — never throws, never goes negative — when the node is
// unknown, already owned, gated, or unaffordable.
export function applySpend(meta, nodeId) {
  const state = normalizeMeta(meta);
  const node = META_NODES_BY_ID.get(nodeId);
  if (!node) return { ok: false, reason: 'unknown', meta: state, node: null };
  if (state.nodes[node.id]) return { ok: false, reason: 'owned', meta: state, node };
  const missing = node.requires.filter((r) => !state.nodes[r]);
  if (missing.length) return { ok: false, reason: 'locked', meta: state, node, missing };
  if (state.currency < node.cost) {
    return { ok: false, reason: 'poor', meta: state, node, short: node.cost - state.currency };
  }
  state.currency -= node.cost;
  state.lifetime.spent += node.cost;
  state.nodes[node.id] = 1;
  return { ok: true, reason: 'bought', meta: state, node, currency: state.currency };
}

// Persisting spend. Nothing is written when the purchase is refused.
export function spend(nodeId, { now = 0 } = {}) {
  const result = applySpend(loadMeta(), nodeId);
  if (result.ok) saveMeta(result.meta, now);
  return result;
}

// Pure bonuses for a given state — the payload the game reads at run start.
export function bonusesFor(meta) {
  const state = normalizeMeta(meta);
  const out = emptyBonuses();
  for (const node of META_NODES) {
    if (!state.nodes[node.id]) continue;
    out.nodes.push(node.id);
    for (const [group, payload] of Object.entries(node.effect || {})) {
      if (!out[group]) continue;
      for (const [key, value] of Object.entries(payload)) {
        if (typeof out[group][key] !== 'number' || typeof value !== 'number') continue;
        out[group][key] += value;
      }
    }
  }
  return out;
}

export function metaBonuses() {
  return bonusesFor(loadMeta());
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export function nodeState(meta, nodeId) {
  const state = normalizeMeta(meta);
  const node = META_NODES_BY_ID.get(nodeId);
  if (!node) return 'unknown';
  if (state.nodes[node.id]) return 'owned';
  if (node.requires.some((r) => !state.nodes[r])) return 'locked';
  return state.currency >= node.cost ? 'available' : 'unaffordable';
}

// Everything a meta screen needs in one call: the branches, their nodes in
// tier order, and each node's current state and affordability.
export function metaTreeView(meta = loadMeta()) {
  const state = normalizeMeta(meta);
  return {
    currency: state.currency,
    currencyName: META_CURRENCY.name,
    lifetime: { ...state.lifetime },
    records: { ...state.records },
    branches: Object.values(META_BRANCHES).map((branch) => ({
      ...branch,
      nodes: META_NODES.filter((n) => n.branch === branch.key)
        .sort((a, b) => a.tier - b.tier || a.cost - b.cost)
        .map((node) => ({
          ...node,
          state: nodeState(state, node.id),
          owned: !!state.nodes[node.id],
          affordable: state.currency >= node.cost,
        })),
    })),
  };
}
