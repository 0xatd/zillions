// Multi-source Dijkstra flow field: zombies descend the distance gradient
// toward the colony. Buildings/walls are expensive-but-passable so hordes
// will chew through walls rather than give up.
import { TILE, TILE_INFO } from './config.js';

const WALL_COST = 55;

export class FlowField {
  constructor(map) {
    this.map = map;
    const n = map.size * map.size;
    this.dist = new Float32Array(n);
    this.cost = new Float32Array(n);
  }

  // occ: Int32Array of building ids (+1) per tile, 0 = empty.
  compute(occ, sourceTiles) {
    const { map } = this;
    const N = map.size, n = N * N;
    const dist = this.dist, cost = this.cost;
    dist.fill(Infinity);

    for (let i = 0; i < n; i++) {
      const t = map.tiles[i];
      if (!TILE_INFO[t].walk) { cost[i] = Infinity; continue; }
      let c = t === TILE.FOREST ? 1.6 : 1;
      if (occ[i] > 0) c = WALL_COST;
      cost[i] = c;
    }

    // Binary heap of [dist, index].
    const heap = [];
    const push = (d, i) => {
      heap.push([d, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let s = k;
          if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
          if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
          if (s === k) break;
          [heap[s], heap[k]] = [heap[k], heap[s]];
          k = s;
        }
      }
      return top;
    };

    for (const i of sourceTiles) {
      if (dist[i] !== 0) { dist[i] = 0; push(0, i); }
    }

    const DIAG = Math.SQRT2;
    while (heap.length) {
      const [d, i] = pop();
      if (d > dist[i]) continue;
      const x = i % N, z = (i / N) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const ni = nz * N + nx;
          const c = cost[ni];
          if (c === Infinity) continue;
          // No diagonal corner cutting through blocked tiles.
          if (dx !== 0 && dz !== 0) {
            if (cost[z * N + nx] === Infinity || cost[nz * N + x] === Infinity) continue;
          }
          const nd = d + c * (dx !== 0 && dz !== 0 ? DIAG : 1);
          if (nd < dist[ni]) { dist[ni] = nd; push(nd, ni); }
        }
      }
    }
  }

  // Direction of steepest descent at tile (x,z). Returns null if nowhere to go.
  dirAt(x, z) {
    const N = this.map.size;
    if (x < 0 || z < 0 || x >= N || z >= N) return null;
    const here = this.dist[z * N + x];
    let best = here, bx = 0, bz = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        if (dx !== 0 && dz !== 0) {
          if (this.cost[z * N + nx] === Infinity || this.cost[nz * N + x] === Infinity) continue;
        }
        const d = this.dist[nz * N + nx];
        if (d < best) { best = d; bx = dx; bz = dz; }
      }
    }
    if (bx === 0 && bz === 0) return null;
    const len = Math.hypot(bx, bz);
    return [bx / len, bz / len];
  }

  distAt(x, z) {
    const N = this.map.size;
    if (x < 0 || z < 0 || x >= N || z >= N) return Infinity;
    return this.dist[z * N + x];
  }
}

// A* for unit move orders on the walkable grid (buildings block).
export function findPath(map, occ, sx, sz, tx, tz) {
  const N = map.size;
  sx = Math.max(0, Math.min(N - 1, sx | 0)); sz = Math.max(0, Math.min(N - 1, sz | 0));
  tx = Math.max(0, Math.min(N - 1, tx | 0)); tz = Math.max(0, Math.min(N - 1, tz | 0));

  const blocked = (x, z) => !map.isWalkable(x, z) || occ[z * N + x] > 0;

  // If target is blocked, spiral out to the nearest free tile.
  if (blocked(tx, tz)) {
    let found = false;
    outer: for (let r = 1; r < 10; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = tx + dx, nz = tz + dz;
          if (nx >= 0 && nz >= 0 && nx < N && nz < N && !blocked(nx, nz)) {
            tx = nx; tz = nz; found = true; break outer;
          }
        }
      }
    }
    if (!found) return null;
  }
  if (sx === tx && sz === tz) return [[tx + 0.5, tz + 0.5]];

  const open = [];
  const g = new Map(), from = new Map();
  const key = (x, z) => z * N + x;
  const h = (x, z) => Math.hypot(x - tx, z - tz);
  const pushO = (f, k) => {
    open.push([f, k]);
    let i = open.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (open[p][0] <= open[i][0]) break;
      [open[p], open[i]] = [open[i], open[p]];
      i = p;
    }
  };
  const popO = () => {
    const t = open[0], l = open.pop();
    if (open.length) {
      open[0] = l;
      let i = 0;
      for (;;) {
        const a = i * 2 + 1, b = a + 1;
        let s = i;
        if (a < open.length && open[a][0] < open[s][0]) s = a;
        if (b < open.length && open[b][0] < open[s][0]) s = b;
        if (s === i) break;
        [open[s], open[i]] = [open[i], open[s]];
        i = s;
      }
    }
    return t;
  };

  const sk = key(sx, sz);
  g.set(sk, 0);
  pushO(h(sx, sz), sk);
  let expanded = 0;

  while (open.length && expanded < 9000) {
    const [, k] = popO();
    const x = k % N, z = (k / N) | 0;
    if (x === tx && z === tz) {
      const path = [];
      let cur = k;
      while (cur !== undefined) {
        path.push([(cur % N) + 0.5, ((cur / N) | 0) + 0.5]);
        cur = from.get(cur);
      }
      path.reverse();
      return path;
    }
    expanded++;
    const gk = g.get(k);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        if (blocked(nx, nz)) continue;
        if (dx !== 0 && dz !== 0 && (blocked(x, nz) || blocked(nx, z))) continue;
        const nk = key(nx, nz);
        const ng = gk + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          from.set(nk, k);
          pushO(ng + h(nx, nz), nk);
        }
      }
    }
  }
  return null;
}
