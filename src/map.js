// Procedural map generation + terrain / decoration meshes.
import * as THREE from 'three';
import { MAP_SIZE, TILE, TILE_INFO } from './config.js';
import { makeRNG, makeNoise, clamp } from './utils.js';

export class GameMap {
  // theme (optional): per-level generation thresholds + palette overrides.
  // opts: { size, nests } — castle-defense frontier maps are bigger and carry
  // hive-nest spots (enemy bases) plus 3 candidate city sites.
  constructor(seed, theme = null, opts = {}) {
    this.seed = seed;
    this.theme = theme;
    this.size = opts.size || MAP_SIZE;
    this.nestCount = opts.nests || 3;
    this.tiles = new Uint8Array(this.size * this.size);
    this.rng = makeRNG(seed);
    this.generate();
  }

  colorOf(t) {
    if (this.theme && this.theme.palette) {
      const p = this.theme.palette;
      const map = {
        [TILE.GRASS]: p.grass, [TILE.FOREST]: p.forest, [TILE.WATER]: p.water,
        [TILE.MOUNTAIN]: p.mountain, [TILE.SAND]: p.sand, [TILE.PATH]: p.path,
      };
      if (map[t] !== undefined) return map[t];
    }
    return TILE_INFO[t].color;
  }

  idx(x, z) { return z * this.size + x; }
  inBounds(x, z) { return x >= 0 && z >= 0 && x < this.size && z < this.size; }
  tileAt(x, z) { return this.inBounds(x, z) ? this.tiles[this.idx(x, z)] : TILE.WATER; }
  isWalkable(x, z) { return this.inBounds(x, z) && TILE_INFO[this.tiles[this.idx(x, z)]].walk; }
  isBuildable(x, z) { return this.inBounds(x, z) && TILE_INFO[this.tiles[this.idx(x, z)]].build; }

  // Themes can reskin the liquid layer — Cinder Wastes runs lava, not water.
  isLava() { return this.theme?.liquid === 'lava'; }

  // Human-readable name for impassable ground, themed per planet. Returns
  // null for walkable tiles — used by the "you can't walk there" warnings.
  terrainLabel(t) {
    if (t === TILE.WATER) return this.theme?.liquidName || 'Deep water';
    if (t === TILE.FOREST) return 'Dense woods';
    if (t === TILE.MOUNTAIN) return 'High crags';
    return null;
  }

  generate() {
    const N = this.size;
    const elevNoise = makeNoise(this.rng);
    const moistNoise = makeNoise(this.rng);
    const cx = N / 2, cz = N / 2;

    // Candidate city sites: the crossroads at the heart of the map, plus two
    // frontier grounds off at seeded angles. You ride out and pick one.
    this.sites = [{ x: cx, z: cz }];
    for (let i = 0; i < 2; i++) {
      const ang = this.rng() * Math.PI * 2;
      const r = N * 0.2;
      this.sites.push({
        x: clamp(cx + Math.cos(ang) * r, 24, N - 24),
        z: clamp(cz + Math.sin(ang) * r, 24, N - 24),
      });
    }

    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const e = elevNoise(x * 0.045, z * 0.045, 4);
        const m = moistNoise(x * 0.06 + 100, z * 0.06 + 100, 3);
        // Keep the ground around every candidate site mild.
        let siteFlat = 0;
        for (const s of this.sites) {
          siteFlat = Math.max(siteFlat, clamp(1 - Math.hypot(x - s.x, z - s.z) / 24, 0, 1));
        }
        const elev = e * (1 - siteFlat * 0.55) + 0.45 * siteFlat * 0.55;

        const th = this.theme || {};
        const waterLv = th.water ?? 0.33;
        const mountainLv = th.mountain ?? 0.72;
        const forestLv = th.forest ?? 0.58;
        let t = TILE.GRASS;
        if (elev < waterLv) t = TILE.WATER;
        else if (elev < waterLv + 0.035) t = TILE.SAND;
        else if (elev > mountainLv) t = TILE.MOUNTAIN;
        else if (m > forestLv && elev > waterLv + 0.07) t = TILE.FOREST;
        this.tiles[this.idx(x, z)] = t;
      }
    }

    // Clear the exact start footprint of every candidate site.
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        for (const s of this.sites) {
          if (Math.hypot(x - s.x, z - s.z) < 9) { this.tiles[this.idx(x, z)] = TILE.GRASS; break; }
        }
      }
    }

    // Sprinkle ore patches on grass, biased to mid-distance from center.
    this._orePatches(TILE.GOLDORE, 9);
    this._orePatches(TILE.STONEORE, 10);

    // Hive nests — the enemy's bases, ringing the frontier. Waves march from
    // these at night; raze them all and the land is cleansed.
    this.nestSpots = [];
    const nestR = N * 0.36;
    for (let i = 0; i < this.nestCount; i++) {
      const ang = (i / this.nestCount) * Math.PI * 2 + this.rng() * 0.9;
      let x = Math.round(cx + Math.cos(ang) * nestR), z = Math.round(cz + Math.sin(ang) * nestR);
      x = clamp(x, 6, N - 6); z = clamp(z, 6, N - 6);
      // Nudge to walkable ground.
      outer: for (let r = 0; r < 14; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            if (this.isWalkable(x + dx, z + dz)) { x += dx; z += dz; break outer; }
          }
        }
      }
      // Stamp a blighted clearing so the nest reads from across the map.
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dz * dz > 11 || !this.inBounds(x + dx, z + dz)) continue;
          this.tiles[this.idx(x + dx, z + dz)] = TILE.GRASS;
        }
      }
      this.nestSpots.push([x, z]);
      // Forests are impassable now — carve a natural pass from every hive
      // toward the heart of the map so the horde always has a road to war.
      let px = x, pz = z;
      let guard2 = 0;
      while (Math.hypot(px - cx, pz - cz) > 6 && guard2++ < N * 3) {
        const ang2 = Math.atan2(cz - pz, cx - px) + (this.rng() - 0.5) * 0.7;
        px = clamp(px + Math.cos(ang2) * 1.2, 2, N - 3);
        pz = clamp(pz + Math.sin(ang2) * 1.2, 2, N - 3);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const k = this.idx((px | 0) + dx, (pz | 0) + dz);
            if (this.tiles[k] === TILE.FOREST || this.tiles[k] === TILE.MOUNTAIN) this.tiles[k] = TILE.GRASS;
          }
        }
      }
    }

    // Lane nodes are TERRAIN, not a ring.
    //
    // A mineral patch being somewhere does not mean the enemy base is there —
    // so the map decides where the ground worth holding IS, and the hive
    // separately decides what it has claimed (see Game._claimNodes). Nodes are
    // read out of the generated tiles: ore fields, narrow passes between water
    // or crags, sheltered clearings, and barrow shelves under the mountains.
    // Nothing sits on a ring, so no two maps share a skeleton.
    this.nodeSpots = this._findNodeFeatures();

    // Precompute tile heights (corners get averaged later).
    this.heightOf = (t) => (t === TILE.WATER ? -0.55 : t === TILE.MOUNTAIN ? 1.5 : 0);
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
          if (this.sites.some((s) => Math.hypot(nx - s.x, nz - s.z) < 20)) continue;
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
    const QUOTA = { ore: 4, ford: 4, barrow: 2, clearing: 2, quarry: 2 };
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

  // Corner height = average of the 4 adjacent tiles' heights, for smooth slopes.
  cornerHeight(x, z) {
    let sum = 0, n = 0;
    for (let dz = -1; dz <= 0; dz++) {
      for (let dx = -1; dx <= 0; dx++) {
        const tx = x + dx, tz = z + dz;
        if (this.inBounds(tx, tz)) { sum += this.heightOf(this.tiles[this.idx(tx, tz)]); n++; }
      }
    }
    return n ? sum / n : 0;
  }

  groundY(x, z) {
    // Approximate ground height at a world position (tile units).
    const t = this.tileAt(Math.floor(x), Math.floor(z));
    return this.heightOf(t);
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

  // ---------- Rendering ----------

  buildTerrain() {
    const N = this.size;
    const group = new THREE.Group();

    // Terrain: 2 triangles per tile. Cel look: large SMOOTH fields of color —
    // variation is low-frequency noise, never per-tile jitter (no checkering).
    const positions = new Float32Array(N * N * 6 * 3);
    const colors = new Float32Array(N * N * 6 * 3);
    const col = new THREE.Color();
    const varNoise = makeNoise(makeRNG(1234));
    let p = 0;

    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const t = this.tiles[this.idx(x, z)];
        col.setHex(this.colorOf(t));
        const v = (varNoise(x * 0.03, z * 0.03, 2) - 0.5) * 0.05;
        col.offsetHSL(0, 0, v);

        const h00 = this.cornerHeight(x, z);
        const h10 = this.cornerHeight(x + 1, z);
        const h01 = this.cornerHeight(x, z + 1);
        const h11 = this.cornerHeight(x + 1, z + 1);

        const verts = [
          [x, h00, z], [x, h01, z + 1], [x + 1, h10, z],
          [x + 1, h10, z], [x, h01, z + 1], [x + 1, h11, z + 1],
        ];
        for (const [vx, vy, vz] of verts) {
          positions[p] = vx; positions[p + 1] = vy; positions[p + 2] = vz;
          colors[p] = col.r; colors[p + 1] = col.g; colors[p + 2] = col.b;
          p += 3;
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    terrain.name = 'terrain';
    group.add(terrain);

    // Liquid plane above sunken tiles. Lava is unlit so it GLOWS against the
    // terrain day and night — molten channels must never read as ground.
    const waterGeo = new THREE.PlaneGeometry(N, N);
    const liquidColor = this.theme && this.theme.palette ? this.theme.palette.water : 0x3f8fb0;
    const waterMat = this.isLava()
      ? new THREE.MeshBasicMaterial({
        color: new THREE.Color(liquidColor).offsetHSL(0, 0.12, 0.08),
        transparent: true, opacity: 0.94,
      })
      : new THREE.MeshLambertMaterial({ color: liquidColor, transparent: true, opacity: 0.85 });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(N / 2, -0.22, N / 2);
    group.add(water);

    group.add(this._buildImpassableRims());
    group.add(this._buildRipples());
    group.add(this._buildTrees());
    group.add(this._buildRocks());
    group.add(this._buildOre());
    return group;
  }

  // A painted rim everywhere walkable ground meets impassable ground — the
  // single strongest passability cue in the scene. If ground has a rim you
  // cannot cross it: lava channels, deep water, woods, and crags all read
  // the same way at a glance. (The sim already agrees: FlowField marks these
  // tiles Infinity, so what players see is exactly what the AI paths around.)
  _buildImpassableRims() {
    const N = this.size;
    const INSET = 0.18;
    const lava = this.isLava();
    const positions = [];
    const colors = [];
    const col = new THREE.Color();
    const rimY = (x, z) => Math.max(this.cornerHeight(x, z), -0.1) + 0.045;

    const pushQuad = (verts) => {
      const [a, b, c2, d] = verts; // a,b = edge corners; c2,d = inset corners
      for (const [vx, vy, vz] of [a, c2, b, b, c2, d]) {
        positions.push(vx, vy, vz);
        colors.push(col.r, col.g, col.b);
      }
    };

    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (!this.isWalkable(x, z)) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nt = this.tileAt(x + dx, z + dz);
          if (TILE_INFO[nt].walk) continue;
          // Rim color: glowing crust against lava, dark ink elsewhere —
          // always themed off the blocking tile so every palette works.
          if (nt === TILE.WATER && lava) col.setHex(0xffb545);
          else { col.setHex(this.colorOf(nt)); col.multiplyScalar(0.42); }
          if (dx === 1) {
            pushQuad([
              [x + 1, rimY(x + 1, z), z], [x + 1, rimY(x + 1, z + 1), z + 1],
              [x + 1 - INSET, rimY(x + 1, z), z], [x + 1 - INSET, rimY(x + 1, z + 1), z + 1],
            ]);
          } else if (dx === -1) {
            pushQuad([
              [x, rimY(x, z), z], [x, rimY(x, z + 1), z + 1],
              [x + INSET, rimY(x, z), z], [x + INSET, rimY(x, z + 1), z + 1],
            ]);
          } else if (dz === 1) {
            pushQuad([
              [x, rimY(x, z + 1), z + 1], [x + 1, rimY(x + 1, z + 1), z + 1],
              [x, rimY(x, z + 1), z + 1 - INSET], [x + 1, rimY(x + 1, z + 1), z + 1 - INSET],
            ]);
          } else {
            pushQuad([
              [x, rimY(x, z), z], [x + 1, rimY(x + 1, z), z],
              [x, rimY(x, z), z + INSET], [x + 1, rimY(x + 1, z), z + INSET],
            ]);
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
      depthWrite: false, side: THREE.DoubleSide,
    });
    return new THREE.Mesh(geo, mat);
  }

  // White foam dashes: a bright ring hugging every shoreline plus sparse
  // open-water ripples — the hand-inked water read from the reference.
  // On lava planets the same pass paints ember crust instead of foam.
  _buildRipples() {
    const N = this.size;
    const rng = makeRNG(555);
    const spots = [];
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        if (this.tiles[this.idx(x, z)] !== TILE.WATER) continue;
        const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
          const t = this.tiles[this.idx(x + dx, z + dz)];
          return t !== TILE.WATER;
        });
        if (shore) spots.push({ x: x + 0.5, z: z + 0.5, w: 0.55 + rng() * 0.25, r: 0 });
        else if (rng() < (this.isLava() ? 0.11 : 0.055)) spots.push({ x: x + rng(), z: z + rng(), w: 0.4 + rng() * 0.4, r: 0 });
      }
    }
    const geo = new THREE.PlaneGeometry(1, 0.1);
    geo.rotateX(-Math.PI / 2);
    const mat = this.isLava()
      ? new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })
      : new THREE.MeshBasicMaterial({ color: 0xeaf4f2, transparent: true, opacity: 0.65, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    spots.forEach((s, i) => {
      q.identity();
      sc.set(s.w, 1, 1);
      pos.set(s.x, -0.16, s.z);
      m.compose(pos, q, sc);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = spots.length;
    return mesh;
  }

  _scatter(tile, perTile) {
    const spots = [];
    const rng = makeRNG(777);
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        if (this.tiles[this.idx(x, z)] !== tile) continue;
        const n = perTile(rng);
        for (let i = 0; i < n; i++) {
          spots.push({ x: x + 0.15 + rng() * 0.7, z: z + 0.15 + rng() * 0.7, s: 0.75 + rng() * 0.55, r: rng() * Math.PI * 2 });
        }
      }
    }
    return spots;
  }

  _buildTrees() {
    // Storybook pines: chunkier cones, pale trunks, sparser stands.
    const spots = this._scatter(TILE.FOREST, (rng) => (rng() < 0.62 ? 1 : rng() < 0.9 ? 0 : 2));
    const g = new THREE.Group();
    const trunkGeo = new THREE.CylinderGeometry(0.09, 0.13, 0.55, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0xcbbfa0 });
    const canopyGeo = new THREE.ConeGeometry(0.56, 1.35, 6);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, spots.length);
    trunks.castShadow = canopies.castShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const c = new THREE.Color();
    const rng = makeRNG(31);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      q.setFromAxisAngle(up, s.r);
      sc.set(s.s, s.s, s.s);
      pos.set(s.x, 0.25 * s.s, s.z);
      m.compose(pos, q, sc);
      trunks.setMatrixAt(i, m);
      pos.y = (0.5 + 0.45) * s.s;
      m.compose(pos, q, sc);
      canopies.setMatrixAt(i, m);
      // Canopies key off the map's forest color — one hue family per map.
      c.setHex(this.colorOf(TILE.FOREST));
      c.offsetHSL((rng() - 0.5) * 0.02, 0.04, (rng() - 0.5) * 0.06 - 0.02);
      canopies.setColorAt(i, c);
    }
    g.add(trunks, canopies);
    return g;
  }

  _buildRocks() {
    const spots = this._scatter(TILE.MOUNTAIN, (rng) => (rng() < 0.4 ? 1 : 0));
    const geo = new THREE.DodecahedronGeometry(0.4, 0);
    const mat = new THREE.MeshLambertMaterial({
      color: this.theme && this.theme.palette ? this.theme.palette.mountain : 0xe9e2cd,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
    mesh.castShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      q.setFromAxisAngle(up, s.r);
      sc.set(s.s, s.s * 0.8, s.s);
      pos.set(s.x, 1.5 + 0.15, s.z);
      m.compose(pos, q, sc);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = spots.length;
    return mesh;
  }

  _buildOre() {
    const g = new THREE.Group();
    for (const [tile, color] of [[TILE.GOLDORE, 0xf3c53d], [TILE.STONEORE, 0xb8ccd8]]) {
      const spots = this._scatter(tile, (rng) => 1 + (rng() < 0.5 ? 1 : 0));
      if (!spots.length) continue;
      const geo = new THREE.OctahedronGeometry(0.16, 0);
      const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 });
      const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
      mesh.castShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        q.setFromAxisAngle(up, s.r);
        sc.set(s.s, s.s * 1.6, s.s);
        pos.set(s.x, 0.12, s.z);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(i, m);
      }
      g.add(mesh);
    }
    return g;
  }

  // Draw the base terrain onto a canvas for the minimap.
  drawMinimap(canvas) {
    const N = this.size;
    canvas.width = N; canvas.height = N;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(N, N);
    const c = new THREE.Color();
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const t = this.tiles[this.idx(x, z)];
        c.setHex(this.colorOf(t));
        // Passability contrast: impassable ground darkens, walkable ground
        // lifts — corridors and fords pop on the minimap at a glance.
        const f = TILE_INFO[t].walk ? 1.08 : 0.6;
        const o = (z * N + x) * 4;
        img.data[o] = Math.min(255, c.r * 255 * f);
        img.data[o + 1] = Math.min(255, c.g * 255 * f);
        img.data[o + 2] = Math.min(255, c.b * 255 * f);
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
