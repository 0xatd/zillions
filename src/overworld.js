// The overworld — the space between wars.
//
// A world descriptor ({ id, name, seed, size, spawn, regions }) fully defines
// a walkable planet: each region carries its own landform archetype, palette,
// gate position and lock state. The five-front Earth campaign is just ONE
// such descriptor (`earthWorldDescriptor()`); the architecture is deliberate:
// eventually different servers host different universes and travelling to a
// planet swaps in that planet's descriptor and rebuilds the scene — zero
// changes to the walking, gate or ghost code here. Adding a galaxy world is
// authoring a descriptor, not forking this module.
//
// Like terrain.js and menu-vignette.js, this module never imports three.js:
// `scripts/overworld-check.mjs` builds whole planets headless in Node and
// asserts they are deterministic, connected and honest about lock state. The
// renderer half (gate meshes, the walking hero, ghosts) lives in main.js and
// only consumes the data classes here.
import { TILE, LEVELS, LABYRINTH_LEVELS, levelById } from './config.js';
import { TerrainField, TERRAIN_SHAPES } from './terrain.js';
import { makeRNG, makeNoise, clamp } from './utils.js';

// The start world's fixed seed: the Earth overworld must be the same planet
// for every player, every boot — ghosts walk it together, and the check
// asserts byte-stable tiles.
export const OVERWORLD_SEED = 5150;
export const OVERWORLD_SIZE = 128;

// Multiplayer ghosts are best-effort presence, never game netcode. One flag
// so the whole feature can be darkened without touching the lockstep pipe.
export const OVERWORLD_GHOSTS = true;

// Ghost presence is scoped per planet: two worlds are two rooms. The check
// asserts the naming rule so every server agrees on it.
export const overworldChannel = (worldId) => `zl-overworld:${worldId}`;

// ---------------------------------------------------------------------------
// World descriptors
// ---------------------------------------------------------------------------
// region: {
//   id, kind: 'level' | 'labyrinth' | 'portal',
//   levelId?        — the level a 'level' gate starts
//   label           — gate/banner name
//   palette         — the biome's tile colours
//   terrain         — TERRAIN_SHAPES archetype name painting this region
//   gate: { x, z }  — where the gate stands (tile coords)
//   radius?         — bounded region: owns its disc outright and is painted
//                     authored crag (the labyrinth kind) instead of banded
//   center?         — the disc's centre (defaults to the gate position)
//   locked?, cleared?  — war state, baked into banners and blight
//   ...flavour      — blurb/boss/trials flow straight through to the UI
// }
// Regions without a radius are BANDED: band k of the diagonal is band-index
// k of the banded regions in descriptor order, so the biome you stand in
// when you read a banner IS the biome you will fight in.
//
// The Earth campaign world: the five fronts march the diagonal south-west →
// north-east, and the labyrinth keeps a crag mouth in the north-east corner.
export function earthWorldDescriptor(campaignCleared = 0) {
  const N = OVERWORLD_SIZE;
  const gatePos = (i) => Math.round(N * (0.16 + i * 0.19));
  const regions = [];
  // The custom-games arch: a stone gate off the causeway near spawn, first
  // band of the diagonal. Portals do not start levels — they carry an
  // `action` the walk-in trigger reads (the renderer opens the WC3-style
  // browser for this one; other worlds may yet aim portals at the stars).
  {
    const g = gatePos(0);
    regions.push({
      id: 'earth-custom',
      kind: 'portal',
      action: 'custom',
      label: 'Custom Games',
      blurb: 'Stone arch, borrowed wars. Any map, any host.',
      palette: { grass: 0x5e6b4f, water: 0x3d6e8a, sand: 0x9c8f6a, forest: 0x39502f, mountain: 0x5c5a58 },
      terrain: 'moor',
      gate: { x: g + 7, z: g - 7 },
      locked: false,
      cleared: false,
    });
  }
  regions.push(...LEVELS.map((lv, i) => {
    const g = gatePos(i);
    return {
      id: `earth-l${lv.id}`,
      kind: 'level',
      levelId: lv.id,
      label: lv.name,
      blurb: lv.blurb,
      boss: { icon: lv.boss.icon, name: lv.boss.name },
      palette: lv.theme.palette,
      terrain: lv.theme.terrain,
      gate: { x: g, z: g },
      locked: lv.id > campaignCleared + 1,
      cleared: lv.id <= campaignCleared,
    };
  }));
  const cx = Math.round(N * 0.86), cz = Math.round(N * 0.14);
  regions.push({
    id: 'earth-labyrinth',
    kind: 'labyrinth',
    label: 'The Labyrinth',
    trials: LABYRINTH_LEVELS.map((l) => ({ id: l.id, name: l.name })),
    palette: LABYRINTH_LEVELS[0].theme.palette,
    terrain: 'labyrinth',
    gate: { x: cx - 3, z: cz + 3 },
    // The cave owns a wide crag knuckle around its mouth.
    center: { x: cx, z: cz }, radius: 20,
    locked: false,
    cleared: false,
  });
  regions.push({
    id: 'earth-orbital-lift',
    kind: 'portal',
    label: 'Orbital Lift',
    blurb: 'Return to the starship and choose another destination.',
    palette: LEVELS[0].theme.palette,
    terrain: LEVELS[0].theme.terrain,
    gate: { x: 16, z: 29 },
    center: { x: 16, z: 29 }, radius: 6,
    locked: false,
    cleared: false,
  });
  return {
    id: 'earth',
    name: 'Earth',
    seed: OVERWORLD_SEED,
    size: N,
    spawn: { x: 14, z: 14 },
    regions,
  };
}

// A frontier planet is a persistent place wrapped around one currently
// playable instance. The Zillions battlefield is temporary content inside
// that destination; galaxy travel and world identity do not depend on its
// eventual art or encounter design.
export function frontierWorldDescriptor(levelId, campaignCleared = 0) {
  const level = levelById(levelId);
  const size = 80;
  const palette = level.theme.palette;
  return {
    id: `frontier-${levelId}`,
    name: level.name,
    seed: (level.seed ^ 0x6a11a7) >>> 0,
    size,
    spawn: { x: 12, z: 12 },
    regions: [
      {
        id: `frontier-${levelId}-mission`, kind: 'level', levelId,
        label: `${level.name} Warzone`, blurb: level.blurb,
        boss: { icon: level.boss.icon, name: level.boss.name },
        palette, terrain: level.theme.terrain,
        gate: { x: 48, z: 46 }, locked: levelId > campaignCleared + 1,
        cleared: levelId <= campaignCleared,
      },
      {
        id: `frontier-${levelId}-orbit`, kind: 'portal', label: 'Orbital Lift',
        blurb: 'Return to the starship and navigate the galaxy.',
        palette, terrain: level.theme.terrain,
        gate: { x: 18, z: 22 }, locked: false, cleared: false,
      },
    ],
  };
}

export function galaxyDestinations(campaignCleared = 0, depth = 6) {
  const destinations = [{
    id: 'earth', name: 'Earth', subtitle: 'Humanity\'s starting world',
    levelId: null, unlocked: true, cleared: campaignCleared >= LEVELS.length,
  }];
  for (let i = 1; i <= depth; i++) {
    const levelId = LEVELS.length + i;
    const level = levelById(levelId);
    destinations.push({
      id: `frontier-${levelId}`,
      name: level.name,
      subtitle: level.blurb,
      levelId,
      unlocked: campaignCleared >= LEVELS.length && levelId <= campaignCleared + 1,
      cleared: levelId <= campaignCleared,
      threat: Math.max(1, levelId - LEVELS.length),
    });
  }
  return destinations;
}

export function galaxyWorldDescriptor(worldId, campaignCleared = 0) {
  if (!worldId || worldId === 'earth') return earthWorldDescriptor(campaignCleared);
  const match = /^frontier-(\d+)$/.exec(worldId);
  if (!match) return earthWorldDescriptor(campaignCleared);
  return frontierWorldDescriptor(Number(match[1]), campaignCleared);
}

// The gate layout a renderer walks: level and portal regions become march-
// order gates, the labyrinth region becomes the cave. Pure projection of the
// descriptor — no Earth knowledge lives below this line.
export function overworldLayout(world) {
  const gates = [];
  let cave = null;
  world.regions.forEach((r, i) => {
    if (r.kind === 'labyrinth') {
      cave = {
        cave: true, name: r.label,
        x: r.gate.x, z: r.gate.z, region: i,
        trials: r.trials || [], locked: !!r.locked, cleared: !!r.cleared,
      };
    } else {
      gates.push({
        levelId: r.levelId, name: r.label, blurb: r.blurb, boss: r.boss,
        portal: r.kind === 'portal' || undefined,
        action: r.kind === 'portal' ? r.action : undefined,
        x: r.gate.x, z: r.gate.z, region: i, locked: !!r.locked, cleared: !!r.cleared,
      });
    }
  });
  return { gates, cave, spawn: { ...world.spawn }, worldId: world.id };
}

// ---------------------------------------------------------------------------
// Stitching
// ---------------------------------------------------------------------------
// Paint a descriptor's planet onto any TerrainField-shaped map (the headless
// OverworldField, or GameMap's renderer-backed subclass in main.js). Banded
// regions take diagonal stripes; bounded regions own their disc outright.
// Each region is classified with its OWN archetype and LOCAL coverage
// quantiles, so a fen is still a third water even though it shares the
// planet with a desert. Deterministic end to end: one rng derived from the
// world seed, one fixed walk order.
export function stitchOverworld(map, world) {
  const N = map.size;
  // Derive the stitch's own rng from the seed so generate() is idempotent —
  // the renderer-backed subclass re-stitches once the campaign is known.
  const rng = map.rng = makeRNG(map.seed ^ 0x5150);
  const nBase = makeNoise(rng), nRegion = makeNoise(rng), nFine = makeNoise(rng);
  const nMoist = makeNoise(rng);
  const S = {
    N,
    base: (x, z, f = 0.045, o = 4) => nBase(x * f, z * f, o),
    region: (x, z, f = 0.018, o = 2) => nRegion(x * f + 40, z * f + 40, o),
    fine: (x, z, f = 0.11, o = 2) => nFine(x * f + 90, z * f + 90, o),
    ridge: (v) => 1 - Math.abs(v * 2 - 1),
  };
  map.overworldWorld = world;
  map.overworldLayout = overworldLayout(world);
  map.region = new Uint8Array(N * N);
  const elev = new Float32Array(N * N);
  const regions = world.regions;
  const banded = regions.map((r, i) => (r.radius == null ? i : -1)).filter((i) => i >= 0);
  const bounded = regions.map((r, i) => (r.radius != null ? i : -1)).filter((i) => i >= 0);
  const centers = regions.map((r) => r.center || r.gate);
  const shapes = regions.map((r) => TERRAIN_SHAPES[r.terrain] || TERRAIN_SHAPES.moor);
  const crag = (r) => regions[r].kind === 'labyrinth' && regions[r].radius != null;

  // Pass 1 — raw elevation per tile from its region's own archetype. Bounded
  // regions claim their disc first; everything else falls to its diagonal
  // band. The labyrinth kind is authored crag rather than a generated biome.
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const edge = clamp(Math.min(x, z, N - 1 - x, N - 1 - z) / 7, 0, 1);
      let r = -1;
      for (const b of bounded) {
        const c = centers[b];
        if (Math.hypot(x - c.x, z - c.z) < regions[b].radius) { r = b; break; }
      }
      if (r < 0) r = banded[clamp(Math.floor(((x + z) / (2 * (N - 1))) * banded.length), 0, banded.length - 1)];
      map.region[i] = r;
      elev[i] = crag(r)
        ? 0.9 + S.fine(x, z) * 0.06
        : shapes[r].elev(x, z, S) * (0.35 + 0.65 * edge);
    }
  }
  map.elev = elev;

  // Pass 2 — classify each banded region with its own cover quantiles. Local
  // thresholds are what make several biomes share one planet honestly: the
  // fen keeps its drowned thirds, the wastes keep their canyon walls.
  for (const r of banded) {
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
    // Forest from the shared moisture field, thresholded on this region's land.
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
  // Authored crag (bounded labyrinth regions): solid mountain, punched after
  // the biome pass so no archetype can soften it.
  for (const r of bounded) {
    if (!crag(r)) continue;
    for (let i = 0; i < map.tiles.length; i++) if (map.region[i] === r) map.tiles[i] = TILE.MOUNTAIN;
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
  // is a causeway stamped spawn → gate → gate in descriptor order, so every
  // gate is reachable on foot whatever the noise did between them.
  for (const r of bounded) disc(regions[r].gate.x, regions[r].gate.z, 3.4, TILE.PATH);
  for (const r of banded) disc(regions[r].gate.x, regions[r].gate.z, 5.5, TILE.GRASS);
  disc(world.spawn.x, world.spawn.z, 4.5, TILE.GRASS);
  const road = (a, b) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)) * 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(Math.round(a.x + (b.x - a.x) * t), Math.round(a.z + (b.z - a.z) * t), 1.7, TILE.PATH);
    }
  };
  let prev = world.spawn;
  for (const r of [...banded, ...bounded]) { road(prev, regions[r].gate); prev = regions[r].gate; }

  // Blight where the war has not reached: the check and the renderer agree
  // on stained ground around every locked gate.
  map.nestSpots = regions.filter((r) => r.locked).map((r) => [r.gate.x, r.gate.z]);
  map.sites = [];
  map._levels = { waterT: 0.3, sandT: 0.34, mountT: 0.72 };
}

// The headless planet for a descriptor (default: Earth). GameMap's subclass
// in main.js reuses stitchOverworld for the renderer-backed twin of exactly
// this landform; both re-stitch through generate(), idempotent on a fresh rng.
export class OverworldField extends TerrainField {
  constructor(world = null) {
    super((world && world.seed) || OVERWORLD_SEED, null, { size: (world && world.size) || OVERWORLD_SIZE, nests: 0 });
    this._world = world; // null → generate() falls back to Earth
    this.generate();
  }

  generate() { stitchOverworld(this, this._world || earthWorldDescriptor()); }
}

// Flood walkable ground from the spawn; map-check's reachability idea applied
// to any descriptor's road planet. Returns a Set of reachable tile indices.
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

// Lock state was resolved by whoever authored the descriptor (the Earth
// factory applies the campaign ladder); the walk-in trigger just reads it.
export function gateState(gate) {
  return { locked: !!gate.locked, cleared: !!gate.cleared };
}

// The walking half: hero movement with terrain collision, click-to-move, gate
// proximity triggers and ghost bookkeeping. Pure data — main.js owns every
// mesh and mirrors this state onto the scene each frame.
const WALK_SPEED = 7;       // overworld stride, ~2.5s per region
const GATE_RADIUS = 3.4;    // walk-in trigger distance
const GATE_COOLDOWN = 1.6;  // seconds before the same gate may re-trigger

export class Overworld {
  constructor(map, { world = null } = {}) {
    this.map = map;
    this.world = world || map.overworldWorld;
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
    // Gate triggers: entering the ring fires once, then the gate rests. The
    // list is whatever this world's descriptor put on the road — no Earth
    // knowledge here.
    const events = [];
    const all = [...this.map.overworldLayout.gates];
    if (this.map.overworldLayout.cave) all.push(this.map.overworldLayout.cave);
    for (const g of all) {
      const d = Math.hypot(this.hero.x - g.x, this.hero.z - g.z);
      const cool = this._cool.get(g.name) || 0;
      if (d < GATE_RADIUS && this.time > cool) {
        this._cool.set(g.name, this.time + GATE_COOLDOWN);
        events.push({ t: 'gate', gate: g, state: gateState(g) });
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
