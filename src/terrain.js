// Terrain generation — the landform half of a map, with no renderer attached.
//
// This file is deliberately free of three.js so a map can be generated (and
// checked) in plain Node: `scripts/map-check.mjs` builds every campaign level
// here and asserts it is distinct, connected and worth playing. `GameMap` in
// `map.js` extends this class and adds the meshes.
//
// The rule that shapes everything below: two planets must never read the same.
// A map is not "noise with a different palette" — it is a LANDFORM. One is a
// drowned fen of islands and fords, one is an ash plain cut by crag walls, one
// is a rift with two passes through it. The archetype decides the pattern; the
// coverage quantiles decide how much of it there is, so a map is playable no
// matter how the noise landed.
import { MAP_SIZE, TILE, TILE_INFO } from './config.js';
import { makeRNG, makeNoise, clamp } from './utils.js';

// ---------------------------------------------------------------------------
// Landform archetypes
// ---------------------------------------------------------------------------
// `elev` paints a pattern in 0..1; `cover` says what fraction of the map ends
// up water / mountain / forest, applied as quantiles over that pattern. Pattern
// gives identity, coverage gives playability.
export const TERRAIN_SHAPES = {
  // Open rolling moorland: room to manoeuvre, a river to cross, copses of pine.
  // The teaching map — you can see what is coming and there is space to answer.
  moor: {
    label: 'rolling moorland',
    cover: { water: 0.07, mountain: 0.07, forest: 0.22 },
    rivers: 1,
    ore: { gold: 9, stone: 9 },
    nodes: { ore: 4, ford: 2, clearing: 3, barrow: 1, quarry: 2 },
    elev: (x, z, S) => S.base(x, z, 0.045, 4) * 0.85 + S.region(x, z) * 0.15,
  },
  // A drowned fen: broad shallow basins, so the land is a web of causeways and
  // fords. Movement is the puzzle here — a third of the map is water.
  fen: {
    label: 'drowned fen',
    cover: { water: 0.27, mountain: 0.03, forest: 0.17 },
    rivers: 2,
    ore: { gold: 8, stone: 7 },
    nodes: { ford: 5, ore: 3, clearing: 2, quarry: 2, barrow: 0 },
    elev: (x, z, S) => S.base(x, z, 0.055, 3) * 0.45 + S.region(x, z, 0.02) * 0.55,
  },
  // Ash plains cut by long crag walls. Ridged noise puts the mountains on thin
  // sinuous contour lines, so the map is a system of canyons and passes.
  wastes: {
    label: 'ash canyons',
    cover: { water: 0.02, mountain: 0.19, forest: 0.06 },
    rivers: 0,
    ore: { gold: 10, stone: 12 },
    nodes: { quarry: 4, ore: 4, ford: 3, barrow: 1, clearing: 0 },
    elev: (x, z, S) => {
      const r = S.ridge(S.base(x, z, 0.035, 2));
      return 0.25 + Math.pow(r, 2.2) * 0.7 + S.fine(x, z) * 0.05;
    },
  },
  // Grave hills: dozens of separate rounded mounds with crag caps, and hollows
  // between them. Broken sightlines, lots of small defensible shelves.
  hills: {
    label: 'barrow hills',
    cover: { water: 0.08, mountain: 0.16, forest: 0.15 },
    rivers: 1,
    ore: { gold: 9, stone: 10 },
    nodes: { barrow: 4, ford: 3, ore: 3, quarry: 2, clearing: 0 },
    elev: (x, z, S) => {
      const mound = S.ridge(S.fine(x, z, 0.07, 2));
      return S.base(x, z, 0.06, 3) * 0.4 + Math.pow(mound, 1.6) * 0.6;
    },
  },
  // A rift: one great mountain wall snaking across the planet with a handful of
  // passes through it. The far side is another country.
  vale: {
    label: 'riven vale',
    cover: { water: 0.09, mountain: 0.20, forest: 0.18 },
    rivers: 1,
    ore: { gold: 9, stone: 11 },
    nodes: { ford: 4, barrow: 3, ore: 3, quarry: 2, clearing: 1 },
    elev: (x, z, S) => {
      const N = S.N;
      // Wall centre-line: a sine snaking left to right across the map.
      const line = N * 0.5 + Math.sin((x / N) * Math.PI * 2.1 + 0.6) * N * 0.15;
      const d = Math.abs(z - line);
      let band = Math.exp(-((d / (N * 0.05)) ** 2));
      // Passes: three gaps punched through the wall, the only ways across.
      for (const px of [0.2, 0.52, 0.83]) {
        const gap = Math.exp(-(((x - N * px) / (N * 0.05)) ** 2));
        band *= 1 - gap * 0.96;
      }
      return S.base(x, z, 0.05, 3) * 0.55 + band * 0.45;
    },
  },
  // The Labyrinth: not a planet to conquer but a fixed gauntlet to survive.
  // `_buildLabyrinthLayout` replaces these provisional paint values with its
  // authored rooms and corridors. It is absent from SHAPE_ORDER, so no
  // campaign or galaxy seed may ever roll it.
  labyrinth: {
    label: 'sunless labyrinth',
    cover: { water: 0.04, mountain: 0.55, forest: 0.09 },
    rivers: 0,
    ore: { gold: 4, stone: 6 },
    nodes: { barrow: 3, quarry: 2, clearing: 2, ore: 2, ford: 0 },
    elev: (x, z, S) => {
      const N = S.N;
      const t = z / N;
      // Canyon spine: a doubled serpentine so the way down is never straight.
      const line = N * (0.5 + Math.sin(t * Math.PI * 2.6 + 1.7) * 0.2 + Math.sin(t * Math.PI * 5.9) * 0.06);
      const d = Math.abs(x - line);
      // Chambers: the spine swells into arenas at fixed depths. Trials place
      // their brood nests in these — the widest ground on the map.
      let width = N * 0.035;
      for (const zc of [0.12, 0.3, 0.48, 0.66, 0.85]) {
        width += Math.exp(-(((t - zc) / 0.05) ** 2)) * N * 0.065;
      }
      const carve = Math.exp(-((d / width) ** 2));
      // Off the spine, ridged noise shatters the high ground into pockets and
      // blind alleys — the dead ends the labyrinth is named for. The frontier
      // connector will thread a few causeways into them; they lead nowhere.
      const shatter = Math.pow(S.ridge(S.base(x, z, 0.05, 3)), 1.7);
      return 0.62 + shatter * 0.33 - carve * (0.5 + S.fine(x, z) * 0.06);
    },
  },
};

const SHAPE_ORDER = ['moor', 'fen', 'wastes', 'hills', 'vale'];

// Site character: what the ground around a candidate city site actually is.
// The player picks one of three sites at the start of a run, so the choice has
// to be legible — a name and one honest line about what holding it means.
const SITE_FLAVOR = {
  crossroads: {
    names: ['Old Crossroads', 'The Meeting Stones', 'Waymeet', 'Kingsford Bend'],
    hint: 'Open ground on every side. Everything can reach you — and you can reach everything.',
  },
  lakeshore: {
    names: ['Sunken Reach', 'Drowned Landing', 'Still Water', 'The Causeway'],
    hint: 'Backed by water. Fewer ways in, but the good ground is thin.',
  },
  highland: {
    names: ['High Shelf', 'Craghold', 'The Overlook', 'Stonewatch'],
    hint: 'Crags at your back. Hard to surround, slow to expand out of.',
  },
  woodland: {
    names: ['Pinefall', 'The Deep Stand', 'Blackwood Clearing', 'Timberhold'],
    hint: 'Woods close in around it. They come out of the trees with no warning.',
  },
  orefield: {
    names: ['Gilt Hollow', 'Assay Camp', 'The Rich Cut', 'Coinground'],
    hint: 'Ore veins in reach of the walls. Rich — and worth taking from you.',
  },
};

// Enough of a thing around a site that it names the place outright, whatever
// the rest of the planet looks like.
const SITE_ENOUGH = { lakeshore: 0.13, highland: 0.10, woodland: 0.24, orefield: 0.005 };

export class TerrainField {
  // theme (optional): per-level landform archetype + palette overrides.
  // opts: { size, nests } — frontier maps are big and carry hive-nest spots
  // (enemy bases) plus 3 candidate city sites.
  constructor(seed, theme = null, opts = {}) {
    this.seed = seed;
    this.theme = theme;
    this.size = opts.size || MAP_SIZE;
    this.nestCount = opts.nests || 3;
    // Archetype comes from the level; without one, pick a stable archetype from
    // the seed so a custom/random map still gets a real landform.
    const named = theme && theme.terrain;
    this.terrainKind = TERRAIN_SHAPES[named]
      ? named
      : SHAPE_ORDER[Math.abs((seed | 0) % SHAPE_ORDER.length)];
    this.shape = TERRAIN_SHAPES[this.terrainKind];
    this.tiles = new Uint8Array(this.size * this.size);
    this.rng = makeRNG(seed);
    this.generate();
  }

  idx(x, z) { return z * this.size + x; }
  inBounds(x, z) { return x >= 0 && z >= 0 && x < this.size && z < this.size; }
  tileAt(x, z) { return this.inBounds(x, z) ? this.tiles[this.idx(x, z)] : TILE.WATER; }
  isWalkable(x, z) { return this.inBounds(x, z) && TILE_INFO[this.tiles[this.idx(x, z)]].walk; }
  isBuildable(x, z) { return this.inBounds(x, z) && TILE_INFO[this.tiles[this.idx(x, z)]].build; }

  // Name for impassable terrain, for the blocked-movement banner. Walkable
  // ground returns null: a block there came from a building, not the land.
  terrainLabel(t) {
    if (t === TILE.WATER) return this.theme?.liquidName || 'Deep water';
    if (t === TILE.FOREST) return 'Dense woods';
    if (t === TILE.MOUNTAIN) return 'Sheer crags';
    return null;
  }

  generate() {
    const shape = this.shape;
    const elev = this._elevationField(shape);
    // The elevation field survives generation: tiles decide walkability, but
    // the field decides the SILHOUETTE — rolling ground, real peaks, deep
    // basins. Rendering and unit placement read it through heightAt/groundY.
    this.elev = elev;
    this.sites = this._pickSites(elev);
    this._flattenSites(elev);
    this._paintTiles(elev, shape);
    if (this.terrainKind === 'labyrinth') {
      this._buildLabyrinthLayout();
      return;
    }
    this._carveRivers(shape.rivers || 0, elev);
    this._clearSiteFootprints();
    const ore = shape.ore || {};
    this._orePatches(TILE.GOLDORE, ore.gold ?? 9);
    this._orePatches(TILE.STONEORE, ore.stone ?? 10);
    this.nestSpots = this._pickNests();
    this._carveWarRoads();
    // Lane nodes are read BEFORE the frontier connector runs, so the connector
    // can guarantee they are reachable — a node marooned behind water or crag
    // is a broken map, not flavor. Chokes are read AFTER every terrain pass
    // that can still rewrite tiles (war roads, frontier bridges, pocket
    // causeways) so the fences and watchtowers built on them stay valid.
    this.nodeSpots = this._findNodeFeatures();
    this._connectFrontier();
    this._prepareNodeFoundations();
    this._connectPockets();
    this.chokeSpots = this._findChokepoints();
    this._nameSites();
  }

  // The Labyrinth is one authored level. It does not mirror, roll rooms, or
  // change topology with the seed. Players can learn this place; difficulty
  // comes from the pursuit and fights, not arbitrary navigation.
  _buildLabyrinthLayout() {
    const N = this.size;
    const point = (x, z, kind, label) => ({
      x: Math.round(N * x),
      z: Math.round(N * z), kind, label,
    });
    const rooms = [
      point(0.50, 0.91, 'start', 'The Last Lantern'),
      point(0.50, 0.78, 'junction', 'Fork of Teeth'),
      point(0.27, 0.68, 'brood', 'The Ash Bridge'),
      point(0.73, 0.67, 'brood', 'The Red Reliquary'),
      point(0.50, 0.56, 'brood', 'The Blood Cross'),
      point(0.25, 0.43, 'brood', 'The Drowned Cells'),
      point(0.75, 0.42, 'brood', 'The Bone Gallery'),
      point(0.50, 0.30, 'brood', 'Crown Gate'),
      point(0.50, 0.12, 'boss', 'The Sunless Throne'),
      point(0.88, 0.28, 'reward', 'The Blind Vault'),
    ];
    const edges = [
      [0, 1], [1, 2], [1, 3], [2, 4], [3, 4],
      [4, 5], [4, 6], [5, 7], [6, 7], [7, 8], [6, 9], [9, 7],
    ];

    this.tiles.fill(TILE.MOUNTAIN);
    const carveDisc = (cx, cz, radius, tile = TILE.GRASS) => {
      const r = Math.ceil(radius);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const x = cx + dx, z = cz + dz;
        if (this.inBounds(x, z)) this.tiles[this.idx(x, z)] = tile;
      }
    };
    const carveCorridor = (a, b, width = 3.3) => {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 1.5);
      for (let i = 0; i <= steps; i++) {
        const t = i / Math.max(1, steps);
        const x = Math.round(a.x + (b.x - a.x) * t);
        const z = Math.round(a.z + (b.z - a.z) * t);
        carveDisc(x, z, width, TILE.PATH);
      }
    };
    for (const [a, b] of edges) carveCorridor(rooms[a], rooms[b]);
    rooms.forEach((room) => carveDisc(room.x, room.z,
      room.kind === 'start' ? 8 : room.kind === 'junction' ? 6 : 9));

    // Each combat room has its own silhouette and floor language. These are
    // authored set pieces, not renamed copies of one circular arena.
    const carveBox = (cx, cz, rx, rz, tile = TILE.GRASS) => {
      for (let z = cz - rz; z <= cz + rz; z++) for (let x = cx - rx; x <= cx + rx; x++) {
        if (this.inBounds(x, z)) this.tiles[this.idx(x, z)] = tile;
      }
    };
    carveBox(rooms[2].x, rooms[2].z, 12, 4, TILE.PATH); // narrow bridge defense
    carveDisc(rooms[3].x, rooms[3].z, 11, TILE.SAND);   // reliquary rotunda
    carveBox(rooms[4].x, rooms[4].z, 10, 10, TILE.PATH);
    carveBox(rooms[4].x, rooms[4].z, 3, 12, TILE.PATH); // blood-cross transepts
    carveBox(rooms[4].x, rooms[4].z, 12, 3, TILE.PATH);
    carveBox(rooms[5].x, rooms[5].z, 11, 7, TILE.SAND); // drowned causeway hall
    carveBox(rooms[6].x, rooms[6].z, 14, 5, TILE.STONEORE); // long bone gallery
    carveBox(rooms[7].x, rooms[7].z, 12, 7, TILE.PATH); // crown gate holdout
    carveDisc(rooms[8].x, rooms[8].z, 14, TILE.STONEORE); // final throne amphitheatre

    // Environmental hazards and landmarks leave wide co-op lanes intact.
    for (const dx of [-8, 8]) for (const dz of [-4, 4]) {
      carveDisc(rooms[5].x + dx, rooms[5].z + dz, 2.6, TILE.WATER);
    }
    for (const dx of [-8, 8]) carveDisc(rooms[3].x + dx, rooms[3].z, 1.8, TILE.GOLDORE);
    for (const dx of [-9, 9]) carveDisc(rooms[8].x + dx, rooms[8].z + 2, 2.3, TILE.MOUNTAIN);

    // Small landmark inlays keep side rooms recognizable at gameplay zoom.
    carveDisc(rooms[3].x, rooms[3].z, 2.2, TILE.GOLDORE);
    carveDisc(rooms[9].x, rooms[9].z, 2.2, TILE.STONEORE);

    const broodRooms = rooms.filter((r) => r.kind === 'brood');
    this.nestSpots = broodRooms.map((r) => [r.x, r.z]);
    this.sites = [{ ...rooms[0], name: rooms[0].label, hint: 'The only safe ground behind you.' }];
    this.nodeSpots = [];
    this.chokeSpots = [];
    const encounters = [
      { room: 2, from: [1], nest: 0, key: 'ash_bridge', kind: 'bridge', choice: 'first', waves: 2 },
      { room: 3, from: [1], nest: 1, key: 'red_reliquary', kind: 'seals', choice: 'first', waves: 2 },
      { room: 4, from: [2, 3], nest: 2, key: 'blood_cross', kind: 'ambush', waves: 3 },
      { room: 5, from: [4], nest: 3, key: 'drowned_cells', kind: 'causeway', choice: 'second', waves: 2 },
      { room: 6, from: [4], nest: 4, key: 'bone_gallery', kind: 'crypts', choice: 'second', waves: 3 },
      { room: 7, from: [5, 6], nest: 5, key: 'crown_gate', kind: 'holdout', waves: 4 },
    ];
    this.labyrinthLayout = { rooms, edges, encounters, start: rooms[0], boss: rooms[8], reward: rooms[9] };

    // Match the rendered relief to the carved floor. High tiles stay crag;
    // walkable rooms and corridors sit in a readable lower plane.
    if (this.elev) {
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        if (this.isWalkable(x, z)) this.elev[this.idx(x, z)] *= 0.55;
      }
    }
    this._nameSites();
  }

  // ---- landform ---------------------------------------------------------

  _elevationField(shape) {
    const N = this.size;
    const nBase = makeNoise(this.rng);
    const nRegion = makeNoise(this.rng);
    const nFine = makeNoise(this.rng);
    this._moistNoise = makeNoise(this.rng);
    const S = {
      N, cx: N / 2, cz: N / 2,
      base: (x, z, f = 0.045, o = 4) => nBase(x * f, z * f, o),
      region: (x, z, f = 0.018, o = 2) => nRegion(x * f + 40, z * f + 40, o),
      fine: (x, z, f = 0.11, o = 2) => nFine(x * f + 90, z * f + 90, o),
      ridge: (v) => 1 - Math.abs(v * 2 - 1),
    };
    const elev = new Float32Array(N * N);
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        // Fade the outermost tiles down so the planet ends in coast/scree
        // instead of a hard cut — and so nothing spawns pinned to the edge.
        const edge = clamp(Math.min(x, z, N - 1 - x, N - 1 - z) / 7, 0, 1);
        const v = shape.elev(x, z, S);
        elev[z * N + x] = v * (0.35 + 0.65 * edge);
      }
    }
    return elev;
  }

  // Sites sit on ground the city can actually be raised on, so pull the
  // elevation around each one toward the SITE'S OWN level before classifying
  // tiles. Flattening to the site (not to global mid-height) keeps the site's
  // identity: a Craghold really does stand on a shelf above the plain, a
  // lakeshore city really is down by the water — the Thronefall rule that
  // elevation is hierarchy, with the keep visibly above or below the war.
  _flattenSites(elev) {
    const N = this.size;
    const targets = this.sites.map((s) => {
      // The site's level, softened toward mid so no city ends up in a pit or
      // painted onto a summit the tile classifier would turn to crag.
      const e = elev[Math.round(s.z) * N + Math.round(s.x)];
      return e * 0.6 + 0.5 * 0.4;
    });
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        let near = 0, target = 0.5;
        this.sites.forEach((s, i) => {
          const w = clamp(1 - Math.hypot(x - s.x, z - s.z) / 26, 0, 1);
          if (w > near) { near = w; target = targets[i]; }
        });
        if (!near) continue;
        const i = z * N + x;
        const w = near * 0.7;
        elev[i] = elev[i] * (1 - w) + target * w;
      }
    }
  }

  // Value at the given fraction of the sorted field. Coverage targets are
  // expressed as quantiles so "19% of this map is crag" holds whatever shape
  // the noise happened to take.
  _quantile(elev, frac) {
    const N = this.size;
    const sample = [];
    for (let z = 1; z < N; z += 2) {
      for (let x = 1; x < N; x += 2) sample.push(elev[z * N + x]);
    }
    sample.sort((a, b) => a - b);
    const i = clamp(Math.round(frac * (sample.length - 1)), 0, sample.length - 1);
    return sample[i];
  }

  _paintTiles(elev, shape) {
    const N = this.size;
    const th = this.theme || {};
    const cover = { ...shape.cover, ...(th.cover || {}) };
    const waterT = this._quantile(elev, cover.water);
    const sandT = this._quantile(elev, Math.min(0.98, cover.water + 0.025));
    const mountT = this._quantile(elev, 1 - cover.mountain);
    // heightAt() needs these to turn the raw field into world-space relief.
    this._levels = { waterT, sandT, mountT };
    const moist = this._moistNoise;

    // Forest is moisture-led, but only on the land that is left over, so the
    // coverage number stays honest.
    const land = [];
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const e = elev[z * N + x];
        if (e >= sandT && e <= mountT) land.push(moist(x * 0.06 + 100, z * 0.06 + 100, 3));
      }
    }
    land.sort((a, b) => a - b);
    const wantForest = clamp((cover.forest * N * N) / Math.max(1, land.length), 0, 1);
    const forestT = land.length
      ? land[clamp(Math.round((1 - wantForest) * (land.length - 1)), 0, land.length - 1)]
      : 1;

    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const e = elev[z * N + x];
        let t = TILE.GRASS;
        if (e < waterT) t = TILE.WATER;
        else if (e < sandT) t = TILE.SAND;
        else if (e > mountT) t = TILE.MOUNTAIN;
        else if (moist(x * 0.06 + 100, z * 0.06 + 100, 3) > forestT) t = TILE.FOREST;
        this.tiles[z * N + x] = t;
      }
    }
  }

  // A river is a chokepoint generator: it splits the ground into halves joined
  // by a handful of fords, and `_findNodeFeatures` reads those fords as the
  // ground worth holding.
  _carveRivers(count, elev) {
    if (!count) return;
    const N = this.size;
    for (let r = 0; r < count; r++) {
      // Start on one edge, aim across the map, meander toward low ground.
      const vertical = this.rng() < 0.5;
      let x = vertical ? 6 + this.rng() * (N - 12) : 2;
      let z = vertical ? 2 : 6 + this.rng() * (N - 12);
      let ang = vertical ? Math.PI / 2 : 0;
      let guard = 0;
      let sinceFord = 0;
      const width = this.rng() < 0.5 ? 1 : 2;
      while (this.inBounds(x | 0, z | 0) && guard++ < N * 3) {
        // Steer downhill a little so the channel sits in real valleys.
        let bestA = ang, bestE = Infinity;
        for (const da of [-0.5, -0.25, 0, 0.25, 0.5]) {
          const nx = clamp((x + Math.cos(ang + da) * 4) | 0, 0, N - 1);
          const nz = clamp((z + Math.sin(ang + da) * 4) | 0, 0, N - 1);
          const e = elev[nz * N + nx];
          if (e < bestE) { bestE = e; bestA = ang + da; }
        }
        ang = bestA + (this.rng() - 0.5) * 0.25;
        x += Math.cos(ang); z += Math.sin(ang);
        sinceFord++;
        // Every so often the channel shallows out — that gap is a ford, and a
        // ford is where the war happens.
        if (sinceFord > 14 && this.rng() < 0.12) { sinceFord = 0; continue; }
        if (sinceFord === 0) continue;
        for (let dz = -width; dz <= width; dz++) {
          for (let dx = -width; dx <= width; dx++) {
            if (dx * dx + dz * dz > width * width + 0.5) continue;
            const tx = (x | 0) + dx, tz = (z | 0) + dz;
            if (!this.inBounds(tx, tz)) continue;
            // Never flood the ground a city can be founded on.
            if (this.sites.some((s) => Math.hypot(tx - s.x, tz - s.z) < 16)) continue;
            this.tiles[this.idx(tx, tz)] = TILE.WATER;
          }
        }
      }
    }
  }

  _clearSiteFootprints() {
    const N = this.size;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        for (const s of this.sites) {
          if (Math.hypot(x - s.x, z - s.z) < 10) { this.tiles[this.idx(x, z)] = TILE.GRASS; break; }
        }
      }
    }
  }

  // ---- city sites -------------------------------------------------------

  // Three candidate sites, read out of the ground rather than dropped on a
  // ring: one at the heart of the map, two out on the frontier, all three on
  // ground flat and dry enough to actually raise a city on.
  _pickSites(elev) {
    const N = this.size;
    const waterT = this._quantile(elev, 0.14);
    const mountT = this._quantile(elev, 0.88);
    const cands = [];
    for (let z = 24; z < N - 24; z += 4) {
      for (let x = 24; x < N - 24; x += 4) {
        const e = elev[z * N + x];
        if (e < waterT || e > mountT) continue;
        // Flatness: how much the ground moves inside a city footprint.
        let lo = Infinity, hi = -Infinity, wet = 0, n = 0;
        for (let dz = -9; dz <= 9; dz += 3) {
          for (let dx = -9; dx <= 9; dx += 3) {
            const v = elev[(z + dz) * N + (x + dx)];
            lo = Math.min(lo, v); hi = Math.max(hi, v);
            if (v < waterT) wet++;
            n++;
          }
        }
        if (wet > n * 0.25) continue;             // half-drowned: not a city
        const flat = 1 - clamp((hi - lo) * 2.5, 0, 1);
        // Prominence: ground a little above its surroundings makes a keep that
        // overlooks the approaches — height is hierarchy, so favor it.
        let ring = 0, rn = 0;
        for (let a = 0; a < 8; a++) {
          const rx = x + Math.round(Math.cos(a * 0.785) * 14);
          const rz = z + Math.round(Math.sin(a * 0.785) * 14);
          if (rx >= 0 && rz >= 0 && rx < N && rz < N) { ring += elev[rz * N + rx]; rn++; }
        }
        const prom = rn ? clamp((e - ring / rn) * 3, -0.35, 0.45) : 0;
        cands.push({ x, z, score: flat + prom + this.rng() * 0.25 });
      }
    }
    cands.sort((a, b) => b.score - a.score);

    const cx = N / 2, cz = N / 2;
    const sites = [];
    const pick = (filter) => {
      for (const c of cands) {
        if (sites.some((s) => Math.hypot(c.x - s.x, c.z - s.z) < N * 0.26)) continue;
        if (!filter(c)) continue;
        sites.push({ x: c.x, z: c.z });
        return true;
      }
      return false;
    };
    // The heart of the map first — someone always wants the crossroads.
    pick((c) => Math.hypot(c.x - cx, c.z - cz) < N * 0.16)
      || pick((c) => Math.hypot(c.x - cx, c.z - cz) < N * 0.3)
      || pick(() => true);
    // Then two frontier grounds, kept well apart from the heart and each other.
    for (let i = 0; i < 2; i++) {
      pick((c) => Math.hypot(c.x - cx, c.z - cz) > N * 0.2) || pick(() => true);
    }
    // A map with almost no viable ground still has to be playable.
    while (sites.length < 3) {
      const ang = sites.length * 2.2;
      sites.push({
        x: clamp(Math.round(cx + Math.cos(ang) * N * 0.22), 24, N - 24),
        z: clamp(Math.round(cz + Math.sin(ang) * N * 0.22), 24, N - 24),
      });
    }
    return sites;
  }

  // Once the tiles exist, each site can be told what it IS — which is what the
  // player is really choosing between when they ride out to found the city.
  //
  // Character is RELATIVE to the planet: a shore on the fen is not remarkable,
  // a shore on the ash canyons is the whole story. And no two sites get the
  // same label, because three identical flags is not a choice.
  _nameSites() {
    const N = this.size, area = N * N;
    const global = {
      lakeshore: this.countNearby(N / 2, N / 2, N, TILE.WATER) / area,
      highland: this.countNearby(N / 2, N / 2, N, TILE.MOUNTAIN) / area,
      woodland: this.countNearby(N / 2, N / 2, N, TILE.FOREST) / area,
      orefield: this.countNearby(N / 2, N / 2, N, TILE.GOLDORE) / area,
    };
    const R = 18, local = (R * 2 + 1) ** 2;
    const scored = [];
    this.sites.forEach((s, i) => {
      const x = Math.round(s.x), z = Math.round(s.z);
      const near = {
        lakeshore: this.countNearby(x, z, R, TILE.WATER) / local,
        highland: this.countNearby(x, z, R, TILE.MOUNTAIN) / local,
        woodland: this.countNearby(x, z, R, TILE.FOREST) / local,
        orefield: this.countNearby(x, z, R, TILE.GOLDORE) / local,
      };
      for (const [kind, frac] of Object.entries(near)) {
        // Two ways to earn a label: plainly a lot of it, or notably more of it
        // than the rest of this planet has.
        const plenty = frac >= SITE_ENOUGH[kind];
        if (!plenty && frac < 0.03) continue;
        scored.push({ i, kind, score: frac / Math.max(0.01, global[kind]) + (plenty ? 1 : 0) });
      }
    });
    scored.sort((a, b) => b.score - a.score);

    const kindOf = new Array(this.sites.length).fill(null);
    const usedKinds = new Set();
    for (const c of scored) {
      if (kindOf[c.i] || usedKinds.has(c.kind) || c.score < 1.1) continue;
      kindOf[c.i] = c.kind;
      usedKinds.add(c.kind);
    }

    const usedNames = new Set();
    this.sites.forEach((s, i) => {
      const kind = kindOf[i] || 'crossroads';
      const flavor = SITE_FLAVOR[kind];
      let name = flavor.names.find((n) => !usedNames.has(n)) || `${flavor.names[0]} ${i + 1}`;
      usedNames.add(name);
      s.kind = kind;
      s.name = name;
      s.hint = flavor.hint;
    });
  }

  // ---- hives ------------------------------------------------------------

  // Hives are lairs, not a ring of pins. They want ground that is far from
  // every city site and ugly to fight through — deep woods, crag country, the
  // far shore — and they want to be spread out from each other.
  _pickNests() {
    const N = this.size;
    const minFromSite = N * 0.28;
    let minApart = N * 0.24;
    const cands = [];
    for (let z = 12; z < N - 12; z += 3) {
      for (let x = 12; x < N - 12; x += 3) {
        if (!this.isWalkable(x, z)) continue;
        let dSite = Infinity;
        for (const s of this.sites) dSite = Math.min(dSite, Math.hypot(x - s.x, z - s.z));
        if (dSite < minFromSite) continue;
        // A lair reads better with cover around it than in the open — and it
        // wants room around it, not to be pinned against the map edge.
        const cover = this.countNearby(x, z, 6, TILE.FOREST) + this.countNearby(x, z, 6, TILE.MOUNTAIN);
        const room = clamp(Math.min(x, z, N - 1 - x, N - 1 - z) / (N * 0.16), 0, 1);
        cands.push({ x, z, score: (dSite / N) * 0.8 + cover * 0.004 + room * 0.25 + this.rng() * 0.12 });
      }
    }
    cands.sort((a, b) => b.score - a.score);

    const spots = [];
    for (let pass = 0; pass < 4 && spots.length < this.nestCount; pass++) {
      for (const c of cands) {
        if (spots.length >= this.nestCount) break;
        if (spots.some(([x, z]) => Math.hypot(c.x - x, c.z - z) < minApart)) continue;
        spots.push([c.x, c.z]);
      }
      minApart *= 0.7; // relax rather than ship a map missing a hive
    }
    while (spots.length < this.nestCount) {
      const ang = (spots.length / this.nestCount) * Math.PI * 2;
      const x = clamp(Math.round(N / 2 + Math.cos(ang) * N * 0.36), 6, N - 6);
      const z = clamp(Math.round(N / 2 + Math.sin(ang) * N * 0.36), 6, N - 6);
      spots.push(this._nearestWalkable(x, z));
    }

    // Stamp a blighted clearing so a nest reads from across the map.
    for (const [x, z] of spots) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dz * dz > 11 || !this.inBounds(x + dx, z + dz)) continue;
          this.tiles[this.idx(x + dx, z + dz)] = TILE.GRASS;
        }
      }
    }
    return spots;
  }

  _nearestWalkable(x, z) {
    for (let r = 0; r < 20; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.isWalkable(x + dx, z + dz)) return [x + dx, z + dz];
        }
      }
    }
    return [x, z];
  }

  // Forests and crags are impassable, so every hive gets a road to war: a
  // meandering pass carved from the nest toward the nearest city site.
  _carveWarRoads() {
    const N = this.size;
    for (const [x, z] of this.nestSpots) {
      let target = this.sites[0];
      let bd = Infinity;
      for (const s of this.sites) {
        const d = Math.hypot(x - s.x, z - s.z);
        if (d < bd) { bd = d; target = s; }
      }
      let px = x, pz = z, guard = 0;
      while (Math.hypot(px - target.x, pz - target.z) > 8 && guard++ < N * 3) {
        const ang = Math.atan2(target.z - pz, target.x - px) + (this.rng() - 0.5) * 0.7;
        px = clamp(px + Math.cos(ang) * 1.2, 2, N - 3);
        pz = clamp(pz + Math.sin(ang) * 1.2, 2, N - 3);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const k = this.idx((px | 0) + dx, (pz | 0) + dz);
            const t = this.tiles[k];
            if (t === TILE.FOREST || t === TILE.MOUNTAIN) this.tiles[k] = TILE.GRASS;
            else if (t === TILE.WATER) this.tiles[k] = TILE.SAND; // a causeway
          }
        }
      }
    }
  }

  // Nothing the run depends on may be marooned. Flood from the heart site and
  // bridge anything — hive or candidate site — the flood could not reach.
  _connectFrontier() {
    const targets = [
      ...this.sites.slice(1).map((s) => [Math.round(s.x), Math.round(s.z)]),
      ...this.nestSpots,
      // Lane nodes are objectives the player must be able to ride to; a node
      // marooned behind water or crag is a quest nobody can finish.
      ...(this.nodeSpots || []).map((n) => [Math.round(n.x), Math.round(n.z)]),
    ];
    const from = [Math.round(this.sites[0].x), Math.round(this.sites[0].z)];
    for (let pass = 0; pass < 3; pass++) {
      const reach = this._floodWalkable(from[0], from[1]);
      const N = this.size;
      let bridged = false;
      for (const [tx, tz] of targets) {
        if (reach[tz * N + tx]) continue;
        this._bridge(from[0], from[1], tx, tz);
        bridged = true;
      }
      if (!bridged) return;
    }
  }

  // Outposts are anchored exactly on their flags and use the 2x2 footprint
  // whose north-west corner is (node - 1). Reachability alone is not enough:
  // a ford or forest node can be easy to walk to while its future fort still
  // overlaps water, trees, or crag. Clear only that foundation so the flag
  // stays where the terrain reader placed it and the authored feature around
  // it remains intact.
  _prepareNodeFoundations() {
    for (const node of this.nodeSpots || []) {
      const x0 = (node.x | 0) - 1;
      const z0 = (node.z | 0) - 1;
      for (let dz = 0; dz < 2; dz++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = x0 + dx, z = z0 + dz;
          if (!this.inBounds(x, z) || this.isBuildable(x, z)) continue;
          const i = this.idx(x, z);
          this.tiles[i] = this.tiles[i] === TILE.WATER ? TILE.SAND : TILE.GRASS;
        }
      }
    }
  }

  // Buildable ground the player cannot walk to is not scenery — it is a
  // promised outpost or farm with no road. Flood the walkable world from the
  // heart site, find every buildable pocket outside that flood, and bridge
  // the meaningful ones (>= POCKET_MIN tiles). Small pockets stay islands on
  // purpose: they read as scenery, not broken promises.
  _connectPockets() {
    const N = this.size;
    const POCKET_MIN = 6;
    const from = [Math.round(this.sites[0].x), Math.round(this.sites[0].z)];
    for (let pass = 0; pass < 4; pass++) {
      const reach = this._floodWalkable(from[0], from[1]);
      const claimed = new Uint8Array(N * N);
      let bridgedAny = false;
      for (let i = 0; i < N * N; i++) {
        if (claimed[i] || reach[i] || !this.isBuildable(i % N, (i / N) | 0)) continue;
        // Measure this pocket with its own flood.
        const pocket = [];
        const stack = [i];
        claimed[i] = 1;
        while (stack.length) {
          const j = stack.pop();
          pocket.push(j);
          const x = j % N, z = (j / N) | 0;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
            const ni = nz * N + nx;
            if (claimed[ni] || reach[ni] || !this.isBuildable(nx, nz)) continue;
            claimed[ni] = 1;
            stack.push(ni);
          }
        }
        if (pocket.length < POCKET_MIN) continue;
        // Bridge from the pocket's centroid to the nearest reached tile.
        const cx = pocket.reduce((a, j) => a + (j % N), 0) / pocket.length;
        const cz = pocket.reduce((a, j) => a + ((j / N) | 0), 0) / pocket.length;
        let bx = -1, bz = -1, bd = Infinity;
        for (let j = 0; j < N * N; j++) {
          if (!reach[j]) continue;
          const x = j % N, z = (j / N) | 0;
          const d = Math.hypot(x - cx, z - cz);
          if (d < bd) { bd = d; bx = x; bz = z; }
        }
        if (bx < 0) continue;
        this._bridge(Math.round(cx), Math.round(cz), bx, bz);
        bridgedAny = true;
      }
      if (!bridgedAny) return;
    }
  }

  _floodWalkable(sx, sz) {
    const N = this.size;
    const seen = new Uint8Array(N * N);
    if (!this.isWalkable(sx, sz)) return seen;
    const stack = [sz * N + sx];
    seen[sz * N + sx] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % N, z = (i / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const ni = nz * N + nx;
        if (seen[ni] || !this.isWalkable(nx, nz)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    return seen;
  }

  // A straight causeway, two tiles wide: the last-resort guarantee that the
  // campaign is winnable on a map whose water landed badly.
  _bridge(x0, z0, x1, z1) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(x0 + (x1 - x0) * t), z = Math.round(z0 + (z1 - z0) * t);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!this.inBounds(x + dx, z + dz)) continue;
          const k = this.idx(x + dx, z + dz);
          const t2 = this.tiles[k];
          if (t2 === TILE.WATER) this.tiles[k] = TILE.SAND;
          else if (t2 === TILE.MOUNTAIN || t2 === TILE.FOREST) this.tiles[k] = TILE.GRASS;
        }
      }
    }
  }

  // ---- terrain reading -------------------------------------------------
  // Everything below is a pure function of the generated tiles: same map, same
  // features, on every machine. No RNG — lockstep peers must agree.

  // Count of walkable tiles in the square of radius r around each tile, via a
  // summed-area table. This one number tells us most of what we need: a low
  // count is a pass, a high count is open ground.
  _opennessField() {
    const N = this.size;
    const W = N + 1;
    const sat = new Int32Array(W * W);
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const w = this.isWalkable(x, z) ? 1 : 0;
        sat[(z + 1) * W + (x + 1)] = w + sat[z * W + (x + 1)] + sat[(z + 1) * W + x] - sat[z * W + x];
      }
    }
    return (x, z, r) => {
      const x0 = clamp(x - r, 0, N), z0 = clamp(z - r, 0, N);
      const x1 = clamp(x + r + 1, 0, N), z1 = clamp(z + r + 1, 0, N);
      return sat[z1 * W + x1] - sat[z0 * W + x1] - sat[z1 * W + x0] + sat[z0 * W + x0];
    };
  }

  // Grid clustering over tiles matching `match` — used for ore fields.
  _tileClusters(match, minSize) {
    const N = this.size;
    const seen = new Uint8Array(N * N);
    const out = [];
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        if (seen[i] || !match(this.tiles[i])) continue;
        const stack = [i];
        seen[i] = 1;
        let sx = 0, sz = 0, n = 0;
        while (stack.length) {
          const k = stack.pop();
          const kx = k % N, kz = (k / N) | 0;
          sx += kx; sz += kz; n++;
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
              const nx = kx + dx, nz = kz + dz;
              if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
              const ni = nz * N + nx;
              if (seen[ni] || !match(this.tiles[ni])) continue;
              seen[ni] = 1;
              stack.push(ni);
            }
          }
        }
        if (n >= minSize) out.push({ x: Math.round(sx / n), z: Math.round(sz / n), n });
      }
    }
    return out;
  }

  _countNear(x, z, r, tile) {
    let n = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (this.tileAt(x + dx, z + dz) === tile) n++;
      }
    }
    return n;
  }

  // Nudge a point to the nearest walkable tile that is not inside a city
  // footprint (the city levels its ground when founded) or on top of a hive.
  _settleSpot(x, z) {
    const N = this.size;
    x = clamp(Math.round(x), 4, N - 5);
    z = clamp(Math.round(z), 4, N - 5);
    for (let r = 0; r < 10; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = x + dx, nz = z + dz;
          if (nx < 4 || nz < 4 || nx > N - 5 || nz > N - 5) continue;
          if (!this.isWalkable(nx, nz)) continue;
          if (this.sites.some((s) => Math.hypot(nx - s.x, nz - s.z) < 26)) continue;
          if (this.nestSpots.some(([ex, ez]) => Math.hypot(nx - ex, nz - ez) < 9)) continue;
          return [nx, nz];
        }
      }
    }
    return null;
  }

  // Read the map and return the ground worth fighting over, tagged by what it
  // actually is. Candidates are scored, then thinned so they stay spread out.
  _findNodeFeatures() {
    const N = this.size;
    const open = this._opennessField();
    const MAX3 = 7 * 7, MAX5 = 11 * 11;
    const cands = [];

    // Ore fields: the "mineral patch". The most valuable ground, and the most
    // obvious — you can see it from the ridge, which is the point.
    for (const c of this._tileClusters((t) => t === TILE.GOLDORE, 5)) {
      cands.push({ x: c.x, z: c.z, kind: 'ore', score: c.n });
    }
    for (const c of this._tileClusters((t) => t === TILE.STONEORE, 7)) {
      cands.push({ x: c.x, z: c.z, kind: 'quarry', score: c.n });
    }

    // Passes and clearings, sampled on a coarse lattice so the scan is cheap
    // and the results are evenly spread rather than clumped on one ridge.
    for (let z = 6; z < N - 6; z += 3) {
      for (let x = 6; x < N - 6; x += 3) {
        if (!this.isWalkable(x, z)) continue;
        const o3 = open(x, z, 3);
        const o5 = open(x, z, 5);
        // A ford is pinched close in but opens out further away — that is what
        // separates a real pass from a dead-end nook.
        const pinched = o3 < MAX3 * 0.52 && o3 > MAX3 * 0.18;
        const leadsSomewhere = o5 > MAX5 * 0.42;
        if (pinched && leadsSomewhere) {
          cands.push({ x, z, kind: 'ford', score: (MAX3 - o3) + (o5 - MAX5 * 0.42) * 0.35 });
          continue;
        }
        // Sheltered clearing: wide open, but ringed by woods rather than being
        // the middle of a featureless plain.
        if (o3 >= MAX3 * 0.96 && this._countNear(x, z, 7, TILE.FOREST) > 26) {
          cands.push({ x, z, kind: 'clearing', score: this._countNear(x, z, 7, TILE.FOREST) });
          continue;
        }
        // Barrow shelf: walkable ground tucked under crags.
        const crags = this._countNear(x, z, 4, TILE.MOUNTAIN);
        if (crags > 22 && o3 > MAX3 * 0.35) {
          cands.push({ x, z, kind: 'barrow', score: crags });
        }
      }
    }

    // Draw round-robin from each kind rather than strictly by score, so every
    // planet gets a mix. Sorting purely by score buried the barrows and
    // clearings under a dozen ore fields and made all five maps read the same.
    // The quota is per-landform: a fen is a map OF fords, the wastes are stone
    // and ore, the barrow hills are graves. What a planet pays you, and how it
    // pays, is part of what makes it its own place.
    const QUOTA = { ore: 4, ford: 4, barrow: 2, clearing: 2, quarry: 2, ...(this.shape.nodes || {}) };
    const ORDER = ['ore', 'ford', 'barrow', 'clearing', 'quarry'];
    const pools = {};
    for (const kind of ORDER) {
      pools[kind] = cands.filter((c) => c.kind === kind)
        .sort((p, q) => (q.score - p.score) || (p.x - q.x) || (p.z - q.z));
    }

    const NAMES = {
      ore: ['Gilt Seam', 'Coinvein', 'The Glitter', 'Old Assay', 'Bright Cut', 'Deepcut'],
      quarry: ['Stonecrop', 'The Quarry', 'Grey Steps', 'Breakstone'],
      ford: ['The Crossing', 'Ashen Ford', 'The Cut', 'The Narrows', 'Broken Span', 'Thorn Gate'],
      barrow: ['Gallows Hill', 'Weeping Rock', 'Widow Bluff', 'Hangman Reach'],
      clearing: ['Kiln Yard', 'Rust Hollow', 'Ember Walk', 'The Moot'],
    };

    const spots = [];
    const taken = {};
    const MIN_SEP = 15;
    const MAX_NODES = 12;
    const place = (c) => {
      const settled = this._settleSpot(c.x, c.z);
      if (!settled) return false;
      const [x, z] = settled;
      if (spots.some((sp) => Math.hypot(x - sp.x, z - sp.z) < MIN_SEP)) return false;
      taken[c.kind] = taken[c.kind] || 0;
      const list = NAMES[c.kind];
      spots.push({ x, z, kind: c.kind, name: list[taken[c.kind] % list.length] });
      taken[c.kind]++;
      return true;
    };

    for (let round = 0; round < 6 && spots.length < MAX_NODES; round++) {
      for (const kind of ORDER) {
        if (spots.length >= MAX_NODES) break;
        if ((taken[kind] || 0) >= QUOTA[kind]) continue;
        const pool = pools[kind];
        while (pool.length) {
          if (place(pool.shift())) break;
        }
      }
    }
    // Still thin (a map with almost no features)? Top up from whatever is left.
    if (spots.length < 7) {
      const rest = ORDER.flatMap((k) => pools[k]);
      for (const c of rest) {
        if (spots.length >= MAX_NODES) break;
        place(c);
      }
    }
    return spots;
  }

  // Natural chokepoints: a short run of open ground pinched between two masses
  // of crag, water or deep wood, with room to walk on both sides of it.
  //
  // This is the oldest trick in fortification. A promontory fort walls the neck
  // and lets the cliffs do the rest; Dún Aonghasa runs its wall cliff to cliff;
  // Great Zimbabwe's walls simply span between the granite boulders; every
  // field army since has anchored its line on a marsh or a ridge and only built
  // across what was left. So the map hands the player the same offer: here is
  // the gap, a fence across it is cheap, and a tower beside it makes it a wall.
  //
  // Pure function of the tiles — no RNG, because lockstep peers must agree.
  _findChokepoints() {
    const N = this.size;
    const MAX_W = 9;    // wider than this is a field, not a gap
    const LOOK = 10;    // how far to look for the anchor on each side
    const dirs = [[0, 1], [1, 0]]; // a fence runs north-south or east-west
    const cands = [];

    const anchorAt = (x, z, dx, dz) => {
      for (let i = 1; i <= LOOK; i++) {
        const nx = x + dx * i, nz = z + dz * i;
        if (!this.inBounds(nx, nz)) return -1;
        if (!this.isWalkable(nx, nz)) return i;
      }
      return -1;
    };

    for (let z = 8; z < N - 8; z += 2) {
      for (let x = 8; x < N - 8; x += 2) {
        if (!this.isWalkable(x, z)) continue;
        for (const [ax, az] of dirs) {
          const a = anchorAt(x, z, ax, az);
          const b = anchorAt(x, z, -ax, -az);
          if (a < 0 || b < 0) continue;
          const width = a + b - 1;
          if (width < 2 || width > MAX_W) continue;
          // Traffic runs across the fence line, so both approaches to the gap
          // have to be open ground — otherwise this is a dead-end nook.
          const px = az, pz = ax;
          let openA = 0, openB = 0;
          for (let i = 2; i <= 6; i++) {
            if (this.isWalkable(x + px * i, z + pz * i)) openA++;
            if (this.isWalkable(x - px * i, z - pz * i)) openB++;
          }
          if (openA < 4 || openB < 4) continue;
          const tiles = [];
          for (let i = -(b - 1); i <= a - 1; i++) tiles.push([x + ax * i, z + az * i]);
          const mid = tiles[tiles.length >> 1];
          cands.push({
            x: mid[0], z: mid[1], width, tiles,
            axis: ax ? 'x' : 'z',
            score: (MAX_W - width) * 2 + openA + openB,
          });
        }
      }
    }

    cands.sort((p, q) => (q.score - p.score) || (p.x - q.x) || (p.z - q.z));
    const NAMES = [
      'The Neck', 'Hollow Way', 'Stone Gate', 'The Pinch', 'Dead Mans Gap',
      'Split Rock', 'The Sluice', 'Wolf Step', 'Cold Gap', 'The Throat',
    ];
    const kept = [];
    for (const c of cands) {
      if (kept.length >= 16) break;
      if (kept.some((k) => Math.hypot(k.x - c.x, k.z - c.z) < 12)) continue;
      if (this.sites.some((s) => Math.hypot(c.x - s.x, c.z - s.z) < 12)) continue;
      if (this.nestSpots.some(([x, z]) => Math.hypot(c.x - x, c.z - z) < 11)) continue;
      c.name = NAMES[kept.length % NAMES.length];
      kept.push(c);
    }
    return kept;
  }

  _orePatches(oreTile, count) {
    const N = this.size, cx = N / 2, cz = N / 2;
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 4000) {
      const x = 4 + Math.floor(this.rng() * (N - 8));
      const z = 4 + Math.floor(this.rng() * (N - 8));
      const d = Math.hypot(x - cx, z - cz);
      if (d < 10 || d > N * 0.46) continue;
      if (this.tiles[this.idx(x, z)] !== TILE.GRASS) continue;
      // Blob of 5-9 tiles.
      const blob = 5 + Math.floor(this.rng() * 5);
      let done = 0, bx = x, bz = z;
      for (let i = 0; i < blob * 3 && done < blob; i++) {
        if (this.inBounds(bx, bz) && this.tiles[this.idx(bx, bz)] === TILE.GRASS) {
          this.tiles[this.idx(bx, bz)] = oreTile;
          done++;
        }
        bx += Math.floor(this.rng() * 3) - 1;
        bz += Math.floor(this.rng() * 3) - 1;
      }
      if (done > 0) placed++;
    }
  }

  // World-space height of a tile. Tiles stay the authority on walkability and
  // the sim never reads height — this is the silhouette of the land, derived
  // fresh from (elev, tile) every call so causeways, leveled city ground and
  // war roads carved after generation are always up to date.
  //
  // Walkable ground rolls gently and never dips below the waterline; crag
  // climbs with the field so ranges have real peaks instead of a uniform mesa;
  // water deepens with the basin.
  heightAt(x, z) {
    if (!this.inBounds(x, z)) return -0.7;
    const i = this.idx(x, z);
    const t = this.tiles[i];
    const L = this._levels || { waterT: 0.2, sandT: 0.23, mountT: 0.75 };
    const e = this.elev ? this.elev[i] : (L.waterT + L.mountT) / 2;
    const span = Math.max(0.001, L.mountT - L.waterT);
    if (t === TILE.WATER) {
      const depth = clamp((L.waterT - e) / span, 0, 1);
      return -0.35 - depth * 0.45;
    }
    if (t === TILE.MOUNTAIN) {
      // Tall and steep on purpose: over the single transition tile the ground
      // jumps a full body height, so crag reads as a wall, not a hillock you
      // could stroll up.
      const up = clamp((e - L.mountT) / Math.max(0.001, 1 - L.mountT), 0, 1);
      return 1.5 + up * 1.8;
    }
    // Everything walkable (and forest floor): a gentle roll. Ground that was
    // reclaimed from water or crag (causeways, cut approaches) clamps into the
    // same band, so it reads as built-up ground instead of a hole.
    const g = clamp((e - L.waterT) / span, 0, 1);
    return 0.05 + g * 0.85;
  }

  // Corner height = average of the 4 adjacent tiles' heights, for smooth slopes.
  // GameMap caches the grid at mesh-build time; the fallback path computes it
  // fresh (map-check and other renderer-free consumers land here).
  cornerHeight(x, z) {
    if (this._cornerH && x >= 0 && z >= 0 && x < this._cornerW && z < this._cornerW) {
      return this._cornerH[z * this._cornerW + x];
    }
    let sum = 0, n = 0;
    for (let dz = -1; dz <= 0; dz++) {
      for (let dx = -1; dx <= 0; dx++) {
        const tx = x + dx, tz = z + dz;
        if (this.inBounds(tx, tz)) { sum += this.heightAt(tx, tz); n++; }
      }
    }
    return n ? sum / n : 0;
  }

  // Smooth ground height at a world position: bilinear over the tile's four
  // corner heights, so a unit walking a slope glides instead of stair-stepping.
  groundY(x, z) {
    const tx = Math.floor(x), tz = Math.floor(z);
    const fx = clamp(x - tx, 0, 1), fz = clamp(z - tz, 0, 1);
    const h00 = this.cornerHeight(tx, tz);
    const h10 = this.cornerHeight(tx + 1, tz);
    const h01 = this.cornerHeight(tx, tz + 1);
    const h11 = this.cornerHeight(tx + 1, tz + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  countNearby(x0, z0, radius, tile) {
    let n = 0;
    for (let z = z0 - radius; z <= z0 + radius; z++) {
      for (let x = x0 - radius; x <= x0 + radius; x++) {
        if (this.inBounds(x, z) && this.tiles[this.idx(x, z)] === tile) n++;
      }
    }
    return n;
  }
}
