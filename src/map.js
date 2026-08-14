// Procedural map generation + terrain / decoration meshes.
import * as THREE from 'three';
import { MAP_SIZE, TILE, TILE_INFO } from './config.js';
import { makeRNG, makeNoise, clamp } from './utils.js';

export class GameMap {
  // theme (optional): per-level generation thresholds + palette overrides.
  constructor(seed, theme = null) {
    this.seed = seed;
    this.theme = theme;
    this.size = MAP_SIZE;
    this.tiles = new Uint8Array(this.size * this.size);
    this.rng = makeRNG(seed);
    this.generate();
  }

  colorOf(t) {
    if (this.theme && this.theme.palette) {
      const p = this.theme.palette;
      const map = { [TILE.GRASS]: p.grass, [TILE.FOREST]: p.forest, [TILE.WATER]: p.water, [TILE.MOUNTAIN]: p.mountain, [TILE.SAND]: p.sand };
      if (map[t] !== undefined) return map[t];
    }
    return TILE_INFO[t].color;
  }

  idx(x, z) { return z * this.size + x; }
  inBounds(x, z) { return x >= 0 && z >= 0 && x < this.size && z < this.size; }
  tileAt(x, z) { return this.inBounds(x, z) ? this.tiles[this.idx(x, z)] : TILE.WATER; }
  isWalkable(x, z) { return this.inBounds(x, z) && TILE_INFO[this.tiles[this.idx(x, z)]].walk; }
  isBuildable(x, z) { return this.inBounds(x, z) && TILE_INFO[this.tiles[this.idx(x, z)]].build; }

  generate() {
    const N = this.size;
    const elevNoise = makeNoise(this.rng);
    const moistNoise = makeNoise(this.rng);
    const cx = N / 2, cz = N / 2;

    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const e = elevNoise(x * 0.045, z * 0.045, 4);
        const m = moistNoise(x * 0.06 + 100, z * 0.06 + 100, 3);
        // Keep the middle of the map (start area) mild.
        const dc = Math.hypot(x - cx, z - cz);
        const centerFlat = clamp(1 - dc / 26, 0, 1);
        const elev = e * (1 - centerFlat * 0.55) + 0.45 * centerFlat * 0.55;

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

    // Clear the exact start footprint.
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (Math.hypot(x - cx, z - cz) < 9) this.tiles[this.idx(x, z)] = TILE.GRASS;
      }
    }

    // Sprinkle ore patches on grass, biased to mid-distance from center.
    this._orePatches(TILE.GOLDORE, 7);
    this._orePatches(TILE.STONEORE, 8);

    // Precompute tile heights (corners get averaged later).
    this.heightOf = (t) => (t === TILE.WATER ? -0.55 : t === TILE.MOUNTAIN ? 1.5 : 0);
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

    // Terrain: 2 triangles per tile, flat-shaded, per-tile color with variation.
    const positions = new Float32Array(N * N * 6 * 3);
    const colors = new Float32Array(N * N * 6 * 3);
    const col = new THREE.Color();
    const rng = makeRNG(1234);
    let p = 0;

    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const t = this.tiles[this.idx(x, z)];
        col.setHex(this.colorOf(t));
        const v = (rng() - 0.5) * 0.07;
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

    // Water plane above sunken tiles.
    const waterGeo = new THREE.PlaneGeometry(N, N);
    const waterMat = new THREE.MeshLambertMaterial({
      color: this.theme && this.theme.palette ? this.theme.palette.water : 0x27435e,
      transparent: true, opacity: 0.8,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(N / 2, -0.22, N / 2);
    group.add(water);

    group.add(this._buildTrees());
    group.add(this._buildRocks());
    group.add(this._buildOre());
    return group;
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
    const spots = this._scatter(TILE.FOREST, (rng) => (rng() < 0.75 ? 1 : 2));
    const g = new THREE.Group();
    const trunkGeo = new THREE.CylinderGeometry(0.07, 0.1, 0.5, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3e3020 });
    const canopyGeo = new THREE.ConeGeometry(0.42, 1.15, 6);
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
      // Black-pine palette: desaturated, murky greens.
      c.setHSL(0.27 + rng() * 0.05, 0.28 + rng() * 0.15, 0.15 + rng() * 0.08);
      canopies.setColorAt(i, c);
    }
    g.add(trunks, canopies);
    return g;
  }

  _buildRocks() {
    const spots = this._scatter(TILE.MOUNTAIN, (rng) => (rng() < 0.4 ? 1 : 0));
    const geo = new THREE.DodecahedronGeometry(0.4, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x6a675f });
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
        c.setHex(this.colorOf(this.tiles[this.idx(x, z)]));
        const o = (z * N + x) * 4;
        img.data[o] = c.r * 255; img.data[o + 1] = c.g * 255; img.data[o + 2] = c.b * 255; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
