// Multi-source Dijkstra flow field: zombies descend the distance gradient
// toward the colony. Buildings/walls are expensive-but-passable so hordes
// will chew through walls rather than give up.
import { TILE, TILE_INFO } from './config.js';

const WALL_COST = 55;
const GATE_COST = 16; // hordes prefer pouring through gates — into the tower crossfire

export class FlowField {
  constructor(map) {
    this.map = map;
    const n = map.size * map.size;
    // dist MUST be float64: storing float64 relaxations into a Float32Array
    // can round *up*, making the same relaxation an "improvement" forever —
    // an infinite Dijkstra loop.
    this.dist = new Float64Array(n);
    this.cost = new Float64Array(n);
  }

  // occ: Int32Array of building ids per tile, 0 = empty. gateIds: building ids
  // that are gates — cheaper to path through, so hordes funnel at chokepoints.
  // impassableWalls: friendlies mode — stone is stone, not something to chew;
  // non-gate buildings become truly blocking and the field reads "how does a
  // living squad reach a gate" instead of "how does a horde reach the keep".
  compute(occ, sourceTiles, gateIds = null, impassableWalls = false) {
    const { map } = this;
    const N = map.size, n = N * N;
    const dist = this.dist, cost = this.cost;
    dist.fill(Infinity);

    for (let i = 0; i < n; i++) {
      const t = map.tiles[i];
      if (!TILE_INFO[t].walk) { cost[i] = Infinity; continue; }
      let c = t === TILE.FOREST ? 1.6 : 1;
      if (occ[i] > 0) c = gateIds && gateIds.has(occ[i]) ? GATE_COST : (impassableWalls ? Infinity : WALL_COST);
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
