// Galaxy macro state API — the shared, server-authoritative galaxy.
//
// This route owns the V0 macro layer from `docs/macro-layer.md`:
//
//   GET                       -> current galaxy macro state (worlds, events)
//   POST { action: 'battle' } -> report a battle result (worlds flip to free)
//   POST { action: 'explore' }-> frontier exploration roll (reveal worlds)
//
// Storage is Vercel Blob (same backend as api/lobby.js), one shared JSON
// document per galaxy. All writes are server-validated and idempotent.
// The Hive tick is lazy: state advances from a seed + tick counter on read,
// so no cron job is required for V0.
//
// Determinism rule: the galaxy STRUCTURE comes from src/galaxy.js (one seed,
// lockstep-safe). This route only tracks ownership deltas and events — the
// thin mutable layer on top of the immutable galaxy.

import { get, put } from '@vercel/blob';
import { GALAXY_SEED, knownGalaxy } from '../src/galaxy.js';
import { makeRNG } from '../src/utils.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const STATE_PATH = 'galaxy/macro-state.json';
const TICK_MS = 60_000;           // one Hive tick per minute
const EVENTS_MAX = 50;            // event feed length
const EXPLORE_MAX_LY = 12;        // deepest probing distance
const EXPLORE_BASE_LY = 2;        // free safe probing distance

function send(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function cleanText(value, fallback = '') {
  return String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = typeof chunks[0] === 'string'
    ? chunks.join('')
    : Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Immutable galaxy structure (headless import — galaxy.js imports no three.js)
// ---------------------------------------------------------------------------

const GALAXY = knownGalaxy(GALAXY_SEED);
const WORLD_IDS = new Set(GALAXY.worlds.map((w) => w.id));

function worldDistances() {
  // Distance in "jumps" from Sol per system. The galaxy has no stored lane
  // graph; systems carry a deterministic `ring` (0 = Sol's hub) that already
  // encodes hops outward. Cached once per lambda instance.
  const dist = new Map([['sys-sol', 0]]);
  for (const system of GALAXY.systems) {
    if (system.id === 'sys-sol') continue;
    dist.set(system.id, Math.max(1, system.ring || 1));
  }
  return dist;
}

const SYSTEM_DISTANCE = worldDistances();

// ---------------------------------------------------------------------------
// Lazy Hive tick
// ---------------------------------------------------------------------------

function currentTick() {
  return Math.floor(Date.now() / TICK_MS);
}

// Which worlds does the Hive reclaim on a tick? Deterministic from
// (tick, seed): no stored randomness, any number of reads agree.
function hiveClaims(tick, count) {
  if (count <= 0) return [];
  const rng = makeRNG(GALAXY_SEED ^ (tick * 0x9e3779b1));
  const frontierWorlds = GALAXY.worlds.filter((w) => w.id !== 'earth');
  const claims = [];
  const used = new Set();
  while (claims.length < count && used.size < frontierWorlds.length) {
    const world = frontierWorlds[Math.floor(rng() * frontierWorlds.length)];
    if (used.has(world.id)) continue;
    used.add(world.id);
    claims.push(world.id);
  }
  return claims;
}

function applyTick(state) {
  const tick = currentTick();
  let lastTick = state.lastTick ?? 0;
  let events = state.events || [];
  let changed = false;
  // Catch up at most 100 ticks per read to bound work; the claim rate is
  // low enough that skipping ticks rarely loses events.
  while (lastTick < tick && tick - lastTick <= 100) {
    lastTick += 1;
    // Hive pressure: one claim attempt every 10 ticks (~10 minutes).
    if (lastTick % 10 === 0) {
      for (const worldId of hiveClaims(lastTick, 1)) {
        if (state.worlds[worldId]?.owner === 'free') {
          state.worlds[worldId] = { owner: 'hive', sinceTick: lastTick };
          events.unshift({ kind: 'hive_claim', worldId, tick: lastTick });
          changed = true;
        }
      }
    }
  }
  state.lastTick = tick;
  state.events = events.slice(0, EVENTS_MAX);
  state.updatedAt = new Date().toISOString();
  return changed;
}

// ---------------------------------------------------------------------------
// State load / save
// ---------------------------------------------------------------------------

function freshState() {
  // Seed ownership: hive owns everything beyond Earth until players liberate.
  const worlds = { earth: { owner: 'free', sinceTick: 0 } };
  for (const world of GALAXY.worlds) {
    if (world.id === 'earth') continue;
    worlds[world.id] = { owner: 'hive', sinceTick: 0 };
  }
  return {
    version: 1,
    seed: GALAXY_SEED,
    worlds,
    revealed: GALAXY.worlds.map((w) => w.id), // known galaxy starts revealed
    frontierJumps: Math.max(0, ...[...SYSTEM_DISTANCE.values()]),
    events: [],
    lastTick: currentTick(),
    updatedAt: new Date().toISOString(),
  };
}

async function loadState() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { state: null, error: 'blob_backend_not_configured' };
  try {
    const { blob } = await get(STATE_PATH, { cache: 'no-store' });
    // get() without a token parameter reads via the store URL.
    const text = await blob.text();
    const parsed = JSON.parse(text);
    return { state: parsed };
  } catch {
    return { state: freshState() };
  }
}

async function saveState(state) {
  await put(STATE_PATH, JSON.stringify(state, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
}

// ---------------------------------------------------------------------------
// Exploration hazard curve
// ---------------------------------------------------------------------------

// Survival odds per probe: smooth decay past the free safe distance.
// One curve, DM narrates the flavor. Deterministic per (playerId, nonce).
function explorationRoll(playerId, nonce) {
  let h = 2166136261;
  const key = `${playerId}:${nonce}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function explorationOutcome(playerId, nonce, distanceLy) {
  const safe = EXPLORE_BASE_LY;
  const depth = Math.max(0, distanceLy - safe);
  const survival = Math.exp(-0.35 * depth); // ~70% at +3ly, ~30% at +6ly
  const roll = explorationRoll(playerId, nonce);
  const survived = roll < survival;
  // Discovery value scales with depth.
  const discovery = survived && distanceLy > safe
    ? Math.min(3, Math.floor(depth / 3))
    : 0;
  return { survived, discovery, distanceLy, survivalOdds: Number(survival.toFixed(3)) };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return send(res, 503, { ok: false, error: 'blob_backend_not_configured' });
    }

    if (req.method === 'GET') {
      const { state } = await loadState();
      const changed = applyTick(state);
      if (changed || !state.savedOnce) await saveState(state);
      state.savedOnce = true;
      await saveState(state);
      return send(res, 200, {
        ok: true,
        tick: state.lastTick,
        worlds: state.worlds,
        revealed: state.revealed,
        frontierJumps: state.frontierJumps,
        events: state.events,
      });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const action = cleanText(body.action);

      if (action === 'battle') {
        // Battle result: the ONLY bridge from instances to the galaxy.
        const worldId = cleanText(body.worldId);
        const outcome = cleanText(body.outcome);
        const battleId = cleanText(body.battleId) || `${worldId}-${currentTick()}`;
        if (!WORLD_IDS.has(worldId)) return send(res, 400, { ok: false, error: 'unknown_world' });
        if (!['liberated', 'failed', 'partial'].includes(outcome)) {
          return send(res, 400, { ok: false, error: 'invalid_outcome' });
        }

        const { state } = await loadState();
        applyTick(state);
        // Idempotency: retrying the same battle must not double-apply.
        const already = (state.events || []).some(
          (e) => e.kind === 'battle_result' && e.battleId === battleId,
        );
        if (already) return send(res, 200, { ok: true, duplicate: true, worlds: state.worlds });

        if (outcome === 'liberated') {
          state.worlds[worldId] = { owner: 'free', sinceTick: state.lastTick };
        }
        state.events.unshift({ kind: 'battle_result', worldId, outcome, battleId, tick: state.lastTick });
        state.events = state.events.slice(0, EVENTS_MAX);
        await saveState(state);
        return send(res, 200, { ok: true, worlds: state.worlds });
      }

      if (action === 'explore') {
        const playerId = cleanText(body.playerId);
        const nonce = Number(body.nonce) || Date.now();
        const distanceLy = Math.min(EXPLORE_MAX_LY, Math.max(1, Number(body.distanceLy) || 1));
        if (!playerId) return send(res, 400, { ok: false, error: 'missing_player_id' });

        const { state } = await loadState();
        applyTick(state);
        const result = explorationOutcome(playerId, nonce, distanceLy);
        state.events.unshift({
          kind: 'exploration', playerId, tick: state.lastTick,
          survived: result.survived, distanceLy,
        });
        state.events = state.events.slice(0, EVENTS_MAX);
        await saveState(state);
        return send(res, 200, { ok: true, exploration: result });
      }

      return send(res, 400, { ok: false, error: 'invalid_action' });
    }

    res.setHeader('allow', 'GET, POST');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (error) {
    return send(res, 500, { ok: false, error: error?.message || 'galaxy_state_error' });
  }
}
