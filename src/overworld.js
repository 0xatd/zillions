// The overworld — the space between wars.
//
// Instead of a static menu backdrop, the five campaign fronts are stitched
// onto ONE small walkable planet: Greenfall's moor in the south-west, then
// Rotmire's fen, Cinder's ash canyons, the Barrow hills and finally the Black
// Vale at the north-east end of the road. Each region is painted by its own
// level's landform archetype and palette, so the world reads as the campaign
// itself — a Thronefall-style level select you walk with your hero.
//
// Like terrain.js and menu-vignette.js, this module never imports three.js:
// `scripts/overworld-check.mjs` builds the whole planet headless in Node and
// asserts it is deterministic, connected and honest about lock state. The
// renderer half (gate meshes, the walking hero, ghosts) lives in main.js and
// only consumes the data classes here.
import { TILE, LEVELS, LABYRINTH_LEVELS } from './config.js';
import { TerrainField, TERRAIN_SHAPES } from './terrain.js';
import { makeRNG, makeNoise, clamp } from './utils.js';

// Fixed planet: the overworld must be the same world for every player, every
// boot — ghosts walk it together, and the check asserts byte-stable tiles.
export const OVERWORLD_SEED = 5150;
export const OVERWORLD_SIZE = 128;

// Multiplayer ghosts are best-effort presence, never game netcode. One flag
// so the whole feature can be darkened without touching the lockstep pipe.
export const OVERWORLD_GHOSTS = true;

// The road south-west → north-east, by gate position on the diagonal.
// Gate i sits inside its own region band ((x+z)/2N in [i/5, (i+1)/5]) so the
// biome you stand in when you read the banner IS the biome you will fight in.
const gatePos = (i, N) => Math.round(N * (0.16 + i * 0.19));
const CAVE = { cx: 0.86, cz: 0.14 };  // labyrinth mouth, north-east corner

export function overworldLayout(N = OVERWORLD_SIZE) {
  const gates = LEVELS.map((lv, i) => {
    const g = gatePos(i, N);
    return {
      levelId: lv.id, name: lv.name, blurb: lv.blurb,
      boss: { icon: lv.boss.icon, name: lv.boss.name },
      x: g, z: g, region: i,
    };
  });
  const cave = {
    cave: true, name: 'The Labyrinth',
    x: Math.round(N * CAVE.cx) - 3, z: Math.round(N * CAVE.cz) + 3,
    cx: Math.round(N * CAVE.cx), cz: Math.round(N * CAVE.cz),
    trials: LABYRINTH_LEVELS.map((l) => ({ id: l.id, name: l.name })),
    region: LEVELS.length,
  };
  return { gates, cave, spawn: { x: 14, z: 14 } };
}

// Paint the stitched planet onto any TerrainField-shaped map (the headless
// OverworldField, or GameMap's renderer-backed subclass in main.js).
// Region per tile comes from the diagonal projection; each region is then
// classified with its OWN landform archetype and LOCAL coverage quantiles,
// so a fen is still a third water even though it shares the planet with a
// desert. Deterministic end to end: one rng, one fixed walk order.
export function stitchOverworld(map, { blight = [] } = {}) {
  const N = map.size;
  const rng = map.rng;
  const nBase = makeNoise(rng), nRegion = makeNoise(rng), nFine = makeNoise(rng);
  const nMoist = makeNoise(rng);
  const S = {
    N,
    base: (x, z, f = 0.045, o = 4) => nBase(x * f, z * f, o),
    region: (x, z, f = 0.018, o = 2) => nRegion(x * f + 40, z * f + 40, o),
    fine: (x, z, f = 0.11, o = 2) => nFine(x * f + 90, z * f + 90, o),
    ridge: (v) => 1 - Math.abs(v * 2 - 1),
  };
  const layout = overworldLayout(N);
  map.overworldLayout = layout;
  map.region = new Uint8Array(N * N);
  const elev = new Float32Array(N * N);
  const shapes = LEVELS.map((lv) => TERRAIN_SHAPES[lv.theme.terrain] || TERRAIN_SHAPES.moor);

  // Pass 1 — raw elevation per tile from its region's own archetype.
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const edge = clamp(Math.min(x, z, N - 1 - x, N - 1 - z) / 7, 0, 1);
      // The labyrinth corner is its own place: a crag knuckle off the road,
      // far from every region band it overlaps.
      const caveD = Math.hypot(x - layout.cave.cx, z - layout.cave.cz);
      const r = caveD < 20 ? LEVELS.length : clamp(Math.floor(((x + z) / (2 * (N - 1))) * LEVELS.length), 0, LEVELS.length - 1);
      map.region[i] = r;
      // Region 5 (the cave crag) is authored, not generated: a high knuckle.
      elev[i] = r === LEVELS.length
        ? 0.9 + S.fine(x, z) * 0.06
        : shapes[r].elev(x, z, S) * (0.35 + 0.65 * edge);
    }
  }
  map.elev = elev;

  // Pass 2 — classify each region with its own cover quantiles. Local
  // thresholds are what make five biomes share one planet honestly: the
  // fen keeps its drowned thirds, the wastes keep their canyon walls.
  for (let r = 0; r < LEVELS.length; r++) {
    const cover = shapes[r].cover;
    const sample = [];
    let regionTiles = 0;
    for (let z = 1; z < N; z += 2) for (let x = 1; x < N; x += 2) {
      if (map.region[z * N + x] === r) { sample.push(elev[z * N + x]); regionTiles += 4; }
    }
    if (!sample.length) continue;
    sample.sort((a, b) => a - b);
    const q = (f) => sample[clamp(Math.round(f * (sample.length - 1)), 0, sample.length - 1)];
    const waterT = q(cover.water), sandT = q(Math.min(0.98, cover.water + 0.03)), mountT = q(1 - cover.mountain);
    // Forest from the same moisture field, thresholded on this region's land.
    const land = [];
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (map.region[i] !== r) continue;
      const m = nMoist(x * 0.06 + 100, z * 0.06 + 100, 3);
      if (elev[i] >= sandT && elev[i] <= mountT) land.push(m);
    }
    land.sort((a, b) => a - b);
    const forestT = land.length
      ? land[clamp(Math.round((1 - clamp(cover.forest * regionTiles / Math.max(1, land.length), 0, 1)) * (land.length - 1)), 0, land.length - 1)]
      : 1;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (map.region[i] !== r) continue;
      const e = elev[i];
      let t = TILE.GRASS;
      if (e < waterT) t = TILE.WATER;
      else if (e < sandT) t = TILE.SAND;
      else if (e > mountT) t = TILE.MOUNTAIN;
      else if (nMoist(x * 0.06 + 100, z * 0.06 + 100, 3) > forestT) t = TILE.FOREST;
      map.tiles[i] = t;
    }
  }
  // The cave crag: solid mountain with a dark mouth, punched after the biome
  // pass so no archetype can soften it.
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (map.region[z * N + x] === LEVELS.length) map.tiles[z * N + x] = TILE.MOUNTAIN;
  }
  const disc = (cx, cz, rad, tile) => {
    const R = Math.ceil(rad);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > rad * rad) continue;
      const x = cx + dx, z = cz + dz;
      if (map.inBounds(x, z)) map.tiles[map.idx(x, z)] = tile;
    }
  };
  // Pass 3 — the road. Gate terraces are flattened walkable discs; the road
  // is a causeway stamped gate to gate, so every front is reachable on foot
  // whatever the noise did between them.
  disc(layout.cave.x, layout.cave.z, 3.4, TILE.PATH);
  for (const g of layout.gates) disc(g.x, g.z, 5.5, TILE.GRASS);
  disc(layout.spawn.x, layout.spawn.z, 4.5, TILE.GRASS);
  const road = (a, b) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)) * 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(Math.round(a.x + (b.x - a.x) * t), Math.round(a.z + (b.z - a.z) * t), 1.7, TILE.PATH);
    }
  };
  let prev = layout.spawn;
  for (const g of [...layout.gates, layout.cave]) { road(prev, g); prev = g; }

  // Blight where the war has not reached: the check and the renderer agree
  // on stained ground around every still-locked gate.
  map.nestSpots = blight.map((g) => [g.x, g.z]);
  map.sites = [];
  map._levels = { waterT: 0.3, sandT: 0.34, mountT: 0.72 };
}

// The headless planet. GameMap's subclass in main.js reuses stitchOverworld
// for the renderer-backed twin of exactly this landform.
export class OverworldField extends TerrainField {
  constructor(seed = OVERWORLD_SEED, opts = {}) {
    super(seed, null, { size: OVERWORLD_SIZE, nests: 0 });
    void opts;
    // super() already ran generate() → stitchOverworld above.
  }

  generate() { stitchOverworld(this, {}); }
}

// Flood walkable ground from the spawn; map-check's reachability idea applied
// to the road planet. Returns a Set of reachable tile indices.
export function overworldReachable(map) {
  const N = map.size;
  const { spawn } = map.overworldLayout;
  const seen = new Set();
  const q = [[spawn.x | 0, spawn.z | 0]];
  if (!map.isWalkable(q[0][0], q[0][1])) return seen;
  while (q.length) {
    const [x, z] = q.pop();
    const i = z * N + x;
    if (seen.has(i)) continue;
    seen.add(i);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (map.isWalkable(nx, nz)) q.push([nx, nz]);
    }
  }
  return seen;
}

// Lock state is profile data, not landform: a front opens when the one before
// it is won. Cleared gates fly the victory colour instead of the war colour.
export function gateState(gate, campaignCleared = 0) {
  if (gate.cave) return { locked: false, cleared: false };
  return { locked: gate.levelId > campaignCleared + 1, cleared: gate.levelId <= campaignCleared };
}

// The walking half: hero movement with terrain collision, click-to-move, gate
// proximity triggers and ghost bookkeeping. Pure data — main.js owns every
// mesh and mirrors this state onto the scene each frame.
const WALK_SPEED = 7;       // overworld stride, ~2.5s per region
const GATE_RADIUS = 3.4;    // walk-in trigger distance
const GATE_COOLDOWN = 1.6;  // seconds before the same gate may re-trigger

export class Overworld {
  constructor(map, { campaign = 0 } = {}) {
    this.map = map;
    this.campaign = campaign;
    this.hero = { x: map.overworldLayout.spawn.x + 0.5, z: map.overworldLayout.spawn.z + 0.5, facing: 0, moving: false };
    this.dir = { x: 0, z: 0 };
    this.target = null;
    this.ghosts = new Map();  // id -> {x, z, hero, name, seen}
    this._cool = new Map();
    this.time = 0;
  }

  setDir(x, z) { this.dir.x = x; this.dir.z = z; if (x || z) this.target = null; }
  setTarget(x, z) { this.target = { x, z }; }

  _walkable(x, z) {
    return this.map.isWalkable(Math.floor(x), Math.floor(z));
  }

  // Axis-separated collision: slide along walls the way the in-game hero
  // does, with a small body radius so the hero cannot clip a crag corner.
  _tryMove(nx, nz) {
    const R = 0.32;
    const ok = (x, z) => this._walkable(x - R, z) && this._walkable(x + R, z)
      && this._walkable(x, z - R) && this._walkable(x, z + R);
    if (ok(nx, this.hero.z)) this.hero.x = nx;
    if (ok(this.hero.x, nz)) this.hero.z = nz;
  }

  update(dt) {
    this.time += dt;
    let dx = this.dir.x, dz = this.dir.z;
    if ((!dx && !dz) && this.target) {
      const tx = this.target.x - this.hero.x, tz = this.target.z - this.hero.z;
      if (tx * tx + tz * tz < 0.2 * 0.2) this.target = null;
      else { const l = Math.hypot(tx, tz); dx = tx / l; dz = tz / l; }
    }
    const len = Math.hypot(dx, dz);
    this.hero.moving = len > 0.01;
    if (this.hero.moving) {
      dx /= len; dz /= len;
      this._tryMove(this.hero.x + dx * WALK_SPEED * dt, this.hero.z + dz * WALK_SPEED * dt);
      this.hero.facing = Math.atan2(dx, dz);
    }
    // Gate triggers: entering the ring fires once, then the gate rests.
    const events = [];
    const all = [...this.map.overworldLayout.gates, this.map.overworldLayout.cave];
    for (const g of all) {
      const d = Math.hypot(this.hero.x - g.x, this.hero.z - g.z);
      const cool = this._cool.get(g.name) || 0;
      if (d < GATE_RADIUS && this.time > cool) {
        this._cool.set(g.name, this.time + GATE_COOLDOWN);
        events.push({ t: 'gate', gate: g, state: gateState(g, this.campaign) });
      }
    }
    return events;
  }

  // ----- ghosts (presence, not netcode) -----
  ghostUpsert(id, payload, now = this.time) {
    this.ghosts.set(id, {
      x: payload.x, z: payload.z, hero: payload.hero || 'alexander',
      name: payload.name || 'Commander', seen: now,
    });
  }
  ghostSweep(ttl = 6, now = this.time) {
    for (const [id, g] of this.ghosts) if (now - g.seen > ttl) this.ghosts.delete(id);
  }
}
