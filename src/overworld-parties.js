// Faction traffic on the walkable overworld — the roads between settlements,
// and who is on them.
//
// The overworld used to hold exactly three kinds of object: terrain, the
// gates, and the player (plus other humans' presence ghosts). Nothing else
// moved, so a planet at war looked abandoned. This module fills the space
// between the gates with faction parties that actually route from settlement
// to settlement over walkable ground, rest when they arrive, and set off
// again — so the road ahead is a thing you can read and decide about.
//
// Like `overworld.js` and `terrain.js`, this module never imports three.js:
// `scripts/overworld-parties-check.mjs` walks whole planets headless in Node
// and asserts the traffic is deterministic and stays on walkable ground. The
// renderer half (party meshes, banners, labels) lives in `main.js` and only
// consumes the data here.
//
// Determinism is the contract, not a nicety. Every party, every destination
// and every dwell comes off a seeded stream derived from the world seed, so
// two players standing on the same planet see the same convoy on the same
// road. Nothing here may call `Math.random()`.
//
// This is the CLIENT-SIDE layer, and deliberately so: it renders traffic on
// the planet you walk. The hosted living world (`living-world-*.js`, and the
// faction AI in `supabase/migrations`) remains the authority for persistent
// party state, and `applyLivingWorldParties()` is the seam where its
// projection replaces these local parties without the renderer noticing.
import { makeRNG, clamp } from './utils.js';
import { FACTIONS, factionByKey } from './factions.js';

const factionOfId = (id) => FACTIONS.find((f) => f.id === id) || null;

// How a party behaves on the road. These names deliberately mirror the goals
// the hosted faction AI already speaks ('patrol', 'trade', 'raid',
// 'reinforce'), so a server projection can drop into the same renderer.
export const PARTY_ARCHETYPES = Object.freeze({
  patrol: Object.freeze({
    key: 'patrol', label: 'Patrol', speed: 2.6,
    dwell: [6, 14], strength: [18, 40], hostileOnly: false,
  }),
  trade: Object.freeze({
    key: 'trade', label: 'Caravan', speed: 2.0,
    dwell: [10, 20], strength: [8, 20], hostileOnly: false,
  }),
  raid: Object.freeze({
    key: 'raid', label: 'Raiders', speed: 3.2,
    dwell: [4, 9], strength: [24, 60], hostileOnly: true,
  }),
  reinforce: Object.freeze({
    key: 'reinforce', label: 'Column', speed: 2.2,
    dwell: [8, 16], strength: [40, 90], hostileOnly: true,
  }),
});

export const PARTY_ARCHETYPE_KEYS = Object.freeze(Object.keys(PARTY_ARCHETYPES));

// Traffic density. Kept low deliberately: this is a planet you walk across,
// not a strategy map you look down on, so a handful of parties on the roads
// reads as a war and thirty reads as noise.
export const PARTIES_PER_SETTLEMENT = 1.5;
export const MAX_OVERWORLD_PARTIES = 24;

// A party is "at" a settlement inside this radius — the same scale as the
// gate trigger ring, so arrival lines up with what the player sees.
export const PARTY_ARRIVE_RADIUS = 1.1;

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const range = (rng, [lo, hi]) => lo + rng() * (hi - lo);

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------
// A* over the walkable grid. Parties must follow ground a player could walk,
// or they wade across bays and clip through crags — the two things that would
// make the traffic read as fake immediately.
//
// Determinism: the open set is kept in ascending (f, index) order and ties
// break on the lower grid index, so the same planet always yields the same
// road. No Set/Map iteration order is relied on for ordering.
const NEIGHBOURS = Object.freeze([
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]);

export function findOverworldPath(walkable, size, from, to, maxNodes = 60000) {
  const sx = clamp(Math.round(from.x), 0, size - 1), sz = clamp(Math.round(from.z), 0, size - 1);
  const tx = clamp(Math.round(to.x), 0, size - 1), tz = clamp(Math.round(to.z), 0, size - 1);
  const idx = (x, z) => z * size + x;
  const start = idx(sx, sz), goal = idx(tx, tz);
  if (!walkable(sx, sz) || !walkable(tx, tz)) return null;
  if (start === goal) return [{ x: sx + 0.5, z: sz + 0.5 }];

  const g = new Float64Array(size * size).fill(Infinity);
  const from_ = new Int32Array(size * size).fill(-1);
  const closed = new Uint8Array(size * size);
  const h = (x, z) => {
    const dx = Math.abs(x - tx), dz = Math.abs(z - tz);
    return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };
  g[start] = 0;
  // Sorted-insert open list: small enough for a 128² planet, and its order is
  // fully determined by (f, index) rather than by heap sift order.
  const open = [{ f: h(sx, sz), i: start }];
  const insert = (node) => {
    let lo = 0, hi = open.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const o = open[mid];
      if (o.f < node.f || (o.f === node.f && o.i < node.i)) lo = mid + 1;
      else hi = mid;
    }
    open.splice(lo, 0, node);
  };

  let visited = 0;
  while (open.length) {
    const { i: current } = open.shift();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === goal) break;
    if (++visited > maxNodes) return null;
    const cx = current % size, cz = (current / size) | 0;
    for (const [dx, dz, cost] of NEIGHBOURS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      if (!walkable(nx, nz)) continue;
      // No corner-cutting: a diagonal needs both orthogonals open, or parties
      // slip through the diagonal seam between two crags.
      if (dx && dz && (!walkable(cx + dx, cz) || !walkable(cx, cz + dz))) continue;
      const n = idx(nx, nz);
      if (closed[n]) continue;
      const tentative = g[current] + cost;
      if (tentative >= g[n]) continue;
      g[n] = tentative;
      from_[n] = current;
      insert({ f: tentative + h(nx, nz), i: n });
    }
  }
  if (from_[goal] === -1 && goal !== start) return null;

  const cells = [];
  for (let at = goal; at !== -1; at = from_[at]) {
    cells.push({ x: (at % size) + 0.5, z: ((at / size) | 0) + 0.5 });
    if (at === start) break;
  }
  cells.reverse();
  return simplifyPath(cells, walkable);
}

// Grid paths are stair-stepped. Drop every waypoint the party can see past,
// so a column moves in long straight legs like something following a road
// rather than a unit walking a tile grid.
export function simplifyPath(cells, walkable) {
  if (cells.length <= 2) return cells.slice();
  const clear = (a, b) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 3);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (!walkable(Math.floor(x), Math.floor(z))) return false;
    }
    return true;
  };
  const out = [cells[0]];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) {
    if (clear(cells[anchor], cells[i])) continue;
    out.push(cells[i - 1]);
    anchor = i - 1;
  }
  out.push(cells[cells.length - 1]);
  return out;
}

// Every settlement pair that can actually be walked between, computed once.
// A pair with no land route (an island front) is simply absent, and parties
// never choose it.
export function buildOverworldRoads(settlements, walkable, size) {
  const roads = new Map();
  for (let a = 0; a < settlements.length; a++) {
    for (let b = a + 1; b < settlements.length; b++) {
      const path = findOverworldPath(walkable, size, settlements[a], settlements[b]);
      if (!path || path.length < 2) continue;
      roads.set(roadKey(settlements[a].id, settlements[b].id), path);
      roads.set(roadKey(settlements[b].id, settlements[a].id), [...path].reverse());
    }
  }
  return roads;
}

export const roadKey = (fromId, toId) => `${fromId}>${toId}`;

export function destinationsFrom(roads, settlements, fromId) {
  return settlements.filter((s) => s.id !== fromId && roads.has(roadKey(fromId, s.id)));
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------
// The gates ARE the settlements: each front's gate is the place its traffic
// runs to and from. Portals and the labyrinth mouth are excluded — nothing
// trades with a hole in the ground.
export function overworldSettlements(layout) {
  return (layout?.gates || [])
    .filter((gate) => !gate.portal && !gate.cave)
    .map((gate, i) => ({
      id: `gate:${gate.levelId ?? i}`,
      name: gate.name || `Site ${i + 1}`,
      x: gate.x + 0.5,
      z: gate.z + 0.5,
      levelId: gate.levelId,
      locked: !!gate.locked,
      cleared: !!gate.cleared,
    }));
}

// Who holds a settlement decides who walks out of it. A cleared front flies
// the Remnant's colours; everything still contested belongs to the enemy that
// holds it, so the roads around unfinished fronts carry hostile traffic.
export function settlementHolder(settlement, factions = FACTIONS) {
  const hostile = factions.filter((f) => f.war?.hostile);
  const friendly = factions.filter((f) => !f.war?.hostile);
  if (settlement.cleared) return friendly[0] || factions[0];
  const pool = hostile.length ? hostile : factions;
  let hash = 2166136261;
  for (let i = 0; i < settlement.id.length; i++) {
    hash ^= settlement.id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return pool[(hash >>> 0) % pool.length];
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------
export function spawnOverworldParties(seed, layout, walkable, size, options = {}) {
  const settlements = overworldSettlements(layout);
  if (settlements.length < 2) return { parties: [], roads: new Map(), settlements };
  const roads = options.roads || buildOverworldRoads(settlements, walkable, size);
  const rng = makeRNG((seed ^ 0x9e3779b9) >>> 0);
  const target = Math.min(
    options.max || MAX_OVERWORLD_PARTIES,
    Math.max(2, Math.round(settlements.length * (options.density ?? PARTIES_PER_SETTLEMENT))),
  );

  const parties = [];
  for (let i = 0; i < target; i++) {
    const home = settlements[i % settlements.length];
    const reachable = destinationsFrom(roads, settlements, home.id);
    if (!reachable.length) continue;
    const holder = settlementHolder(home);
    const hostile = !!holder.war?.hostile;
    const kinds = PARTY_ARCHETYPE_KEYS.filter((k) => !PARTY_ARCHETYPES[k].hostileOnly || hostile);
    const archetype = PARTY_ARCHETYPES[pick(rng, kinds)];
    const destination = pick(rng, reachable);
    const party = {
      id: `ow-party:${i}`,
      factionKey: holder.key,
      factionId: holder.id,
      hostile,
      kind: archetype.key,
      label: archetype.label,
      name: `${holder.short || holder.name} ${archetype.label}`,
      strength: Math.round(range(rng, archetype.strength)),
      speed: archetype.speed,
      x: home.x, z: home.z, facing: 0, moving: false,
      atId: home.id, fromId: home.id, toId: destination.id,
      path: roads.get(roadKey(home.id, destination.id)) || null,
      leg: 1,
      // Stagger the first departure so the roads do not all fill at once on
      // the frame the player arrives.
      dwell: range(rng, [0, archetype.dwell[1]]),
      trips: 0,
      seed: (seed ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0,
    };
    parties.push(party);
  }
  return { parties, roads, settlements };
}

// One tick of traffic. Returns the events worth reacting to — arrivals and
// departures — so the caller can surface them without polling every party.
export function updateOverworldParties(parties, dt, context = {}) {
  const { roads, settlements } = context;
  const events = [];
  if (!parties?.length || !roads || !settlements?.length) return events;

  for (const party of parties) {
    if (party.dwell > 0) {
      party.dwell -= dt;
      party.moving = false;
      if (party.dwell > 0) continue;
      const next = chooseDestination(party, roads, settlements);
      if (!next) { party.dwell = 4; continue; }
      party.fromId = party.atId;
      party.toId = next.id;
      party.path = roads.get(roadKey(party.fromId, party.toId)) || null;
      party.leg = 1;
      party.atId = null;
      party.trips++;
      events.push({ t: 'depart', party, from: party.fromId, to: party.toId });
      if (!party.path) { party.dwell = 4; party.atId = party.fromId; }
      continue;
    }
    if (!party.path) { party.dwell = 4; continue; }

    let budget = party.speed * dt;
    while (budget > 0 && party.leg < party.path.length) {
      const node = party.path[party.leg];
      const dx = node.x - party.x, dz = node.z - party.z;
      const d = Math.hypot(dx, dz);
      if (d <= budget) {
        party.x = node.x; party.z = node.z;
        budget -= d;
        party.leg++;
        if (d > 1e-6) party.facing = Math.atan2(dx, dz);
      } else {
        party.x += (dx / d) * budget;
        party.z += (dz / d) * budget;
        party.facing = Math.atan2(dx, dz);
        budget = 0;
      }
    }
    party.moving = true;

    if (party.leg >= party.path.length) {
      const arrived = settlements.find((s) => s.id === party.toId);
      party.atId = party.toId;
      party.moving = false;
      party.path = null;
      const archetype = PARTY_ARCHETYPES[party.kind] || PARTY_ARCHETYPES.patrol;
      const rng = makeRNG((party.seed ^ Math.imul(party.trips + 1, 0xc2b2ae35)) >>> 0);
      party.dwell = range(rng, archetype.dwell);
      events.push({ t: 'arrive', party, at: party.toId, settlement: arrived || null });
    }
  }
  return events;
}

// Where a party goes next. Raiders and columns push toward fronts still held
// against the player; patrols and caravans prefer the quiet roads. Seeded on
// the party's own identity and trip count, so it replays identically.
export function chooseDestination(party, roads, settlements) {
  const options = destinationsFrom(roads, settlements, party.atId || party.fromId);
  if (!options.length) return null;
  const rng = makeRNG((party.seed ^ Math.imul(party.trips + 7, 0x27d4eb2f)) >>> 0);
  const aggressive = party.kind === 'raid' || party.kind === 'reinforce';
  const preferred = options.filter((s) => (aggressive ? !s.cleared : s.cleared));
  const pool = preferred.length ? preferred : options;
  // Never turn straight back the way it came when there is anywhere else.
  const onward = pool.filter((s) => s.id !== party.fromId);
  return pick(rng, onward.length ? onward : pool);
}

// Parties the player is close enough to read — the hook the renderer uses to
// name what is on the road ahead, and the seam interception will hang off.
export function partiesNear(parties, x, z, radius) {
  const r2 = radius * radius;
  return (parties || [])
    .map((party) => ({ party, d2: (party.x - x) ** 2 + (party.z - z) ** 2 }))
    .filter((entry) => entry.d2 <= r2)
    .sort((a, b) => a.d2 - b.d2 || (a.party.id < b.party.id ? -1 : 1))
    .map((entry) => entry.party);
}

// A one-line reading of a party, for the banner and the label.
export function describeParty(party, settlements = []) {
  const destination = settlements.find((s) => s.id === party.toId);
  const faction = factionByKey(party.factionKey);
  const who = `${faction?.name || party.factionKey} ${party.label.toLowerCase()}`;
  const strength = `${party.strength} strong`;
  if (party.moving && destination) return `${who} — ${strength} — bound for ${destination.name}`;
  const here = settlements.find((s) => s.id === party.atId);
  return here ? `${who} — ${strength} — holding at ${here.name}` : `${who} — ${strength}`;
}

// The seam for the hosted living world: hand it the authoritative projection
// and the same renderer draws server parties instead of local traffic. Local
// traffic is a stand-in for an empty road, never a competing authority.
export function applyLivingWorldParties(projectionParties, settlements) {
  return (projectionParties || []).map((entry, i) => {
    const faction = factionByKey(entry.factionKey) || factionOfId(entry.owner);
    const archetype = PARTY_ARCHETYPES[entry.goal] || PARTY_ARCHETYPES.patrol;
    return {
      id: String(entry.id || `lw-party:${i}`),
      factionKey: faction?.key || 'creed',
      factionId: faction?.id ?? 0,
      hostile: !!faction?.war?.hostile,
      kind: archetype.key,
      label: archetype.label,
      name: entry.name || `${faction?.short || 'Unknown'} ${archetype.label}`,
      strength: Number(entry.strength) || 0,
      speed: archetype.speed,
      x: Number(entry.x) || 0, z: Number(entry.y ?? entry.z) || 0,
      facing: 0, moving: !!entry.moving,
      atId: entry.locationId || null, fromId: entry.originId || null, toId: entry.destinationId || null,
      path: null, leg: 0, dwell: 0, trips: 0, seed: 0,
      authoritative: true,
    };
  });
}
