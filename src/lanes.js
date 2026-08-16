// The lane graph — the skeleton of a planet.
//
// Capture nodes (crossroads, ore fields, ruins) are joined by lanes: real
// walkable paths carved by a breadth-first flood over the terrain. Squads from
// both sides walk these lanes, so the front line is a place on the map instead
// of a number in the HUD.
//
// Everything here is deterministic — no RNG, fixed neighbour order — because
// both peers in a lockstep co-op match must build the identical graph.

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// Flood the walkable terrain outward from one tile, returning step distance
// per tile (Infinity where unreachable). Diagonals cost slightly more so the
// extracted paths hug real ground instead of zig-zagging.
function floodFrom(map, sx, sz) {
  const N = map.size;
  const dist = new Float32Array(N * N).fill(Infinity);
  const start = sz * N + sx;
  if (!map.isWalkable(sx, sz)) return dist;
  dist[start] = 0;
  // Simple bucket queue: costs are 1 or 1.5, so a plain FIFO with relaxation
  // is close enough for path extraction and much cheaper than a heap.
  let frontier = [start];
  while (frontier.length) {
    const next = [];
    for (const idx of frontier) {
      const x = idx % N, z = (idx / N) | 0;
      const d = dist[idx];
      for (let k = 0; k < DIRS.length; k++) {
        const nx = x + DIRS[k][0], nz = z + DIRS[k][1];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        if (!map.isWalkable(nx, nz)) continue;
        const nd = d + (k < 4 ? 1 : 1.5);
        const ni = nz * N + nx;
        if (nd < dist[ni] - 1e-6) {
          dist[ni] = nd;
          next.push(ni);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

// Walk down a flood field from `to` back to its source, then reverse — giving
// a path that starts at the source node and ends at `to`.
function extractPath(map, field, tx, tz) {
  const N = map.size;
  let x = tx, z = tz;
  if (field[z * N + x] === Infinity) return null;
  const back = [[x + 0.5, z + 0.5]];
  let guard = 0;
  while (field[z * N + x] > 0 && guard++ < N * 4) {
    let bx = x, bz = z, bd = field[z * N + x];
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const d = field[nz * N + nx];
      if (d < bd) { bd = d; bx = nx; bz = nz; }
    }
    if (bx === x && bz === z) break; // stuck in a local pit — give up cleanly
    x = bx; z = bz;
    back.push([x + 0.5, z + 0.5]);
  }
  back.reverse();
  return back;
}

// Keep every `step`-th waypoint plus both ends. Squads steer STRAIGHT from one
// waypoint to the next, so the default is intentionally every tile. Compressing
// these paths made valid flood routes cut across forests, water and crags, which
// pinned units against terrain and then dropped them into direct-move fallback.
function downsample(path, step = 1) {
  if (!path || path.length <= 2) return path;
  if (step <= 1) return path;
  const out = [path[0]];
  for (let i = step; i < path.length - 1; i += step) out.push(path[i]);
  out.push(path[path.length - 1]);
  return out;
}

// points: [{ x, z }] — index in this array becomes the node id.
// Returns { adj, lanes, cost } where lanes is keyed "a:b" (both directions
// stored) and cost is the walked length of that lane.
export function buildLaneGraph(map, points, opts = {}) {
  const maxDist = opts.laneMaxDist ?? 46;
  const neighbors = opts.laneNeighbors ?? 3;
  const n = points.length;
  const adj = Array.from({ length: n }, () => []);
  const lanes = new Map();
  const cost = new Map();
  if (!n) return { adj, lanes, cost, size: 0 };

  const tiles = points.map((p) => [Math.max(0, Math.min(map.size - 1, p.x | 0)), Math.max(0, Math.min(map.size - 1, p.z | 0))]);
  const fields = tiles.map(([x, z]) => floodFrom(map, x, z));

  const walk = (i, j) => fields[i][tiles[j][1] * map.size + tiles[j][0]];

  const link = (i, j, d) => {
    const key = `${i}:${j}`;
    if (lanes.has(key)) return true;
    const path = downsample(extractPath(map, fields[i], tiles[j][0], tiles[j][1]));
    if (!path || path.length < 2) return false;
    lanes.set(key, path);
    lanes.set(`${j}:${i}`, [...path].reverse());
    cost.set(key, d);
    cost.set(`${j}:${i}`, d);
    if (!adj[i].includes(j)) adj[i].push(j);
    if (!adj[j].includes(i)) adj[j].push(i);
    return true;
  };

  // Pass 1 — nearest neighbours by WALKED distance, not by how it looks on a map.
  for (let i = 0; i < n; i++) {
    const ranked = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = walk(i, j);
      if (d === Infinity || d > maxDist) continue;
      ranked.push([d, j]);
    }
    ranked.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    for (const [d, j] of ranked.slice(0, neighbors)) link(i, j, d);
  }

  // Pass 2 — stitch the components together.
  //
  // Nearest-neighbour linking alone fragments badly on this map: the node spots
  // sit on concentric rings, so the inner ring links only to itself and the
  // outer ring only to itself, and the two shells never join. A hive stranded
  // in its own component can never be routed to, and therefore never razed,
  // which makes the map unwinnable. So: repeatedly join the two closest points
  // that are in different components until one component remains, ignoring the
  // distance cap — connectivity matters more than lane length.
  const comp = new Int32Array(n);
  const recolour = () => {
    comp.fill(-1);
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0) continue;
      const q = [i];
      comp[i] = c;
      while (q.length) {
        const a = q.pop();
        for (const b of adj[a]) if (comp[b] < 0) { comp[b] = c; q.push(b); }
      }
      c++;
    }
    return c;
  };

  let groups = recolour();
  for (let guard = 0; groups > 1 && guard < n; guard++) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j || comp[i] === comp[j]) continue;
        const d = walk(i, j);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    // Nothing left that can be walked between: the remainder is genuinely
    // marooned (an island, a lake-locked shelf). Callers drop those points.
    if (bi < 0 || !link(bi, bj, bd)) break;
    groups = recolour();
  }

  for (const list of adj) list.sort((a, b) => a - b);
  return { adj, lanes, cost, size: n, components: groups, comp };
}

// Which points share a component with `root`. Anything outside it can never be
// walked to, so it must not be left on the map as content the player can see
// but never reach.
export function reachableFrom(graph, root) {
  const seen = new Set();
  if (root == null || root < 0 || root >= graph.size) return seen;
  const q = [root];
  seen.add(root);
  while (q.length) {
    const a = q.pop();
    for (const b of graph.adj[a]) if (!seen.has(b)) { seen.add(b); q.push(b); }
  }
  return seen;
}

// Dijkstra over the node graph. Returns the node ids from `from` to `to`
// inclusive, or null when the two are on separate landmasses.
export function nodeRoute(graph, from, to) {
  if (from === to) return [from];
  const n = graph.size;
  if (from == null || to == null || from < 0 || to < 0 || from >= n || to >= n) return null;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  for (;;) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; best = i; }
    if (best < 0) break;
    if (best === to) break;
    done[best] = 1;
    for (const j of graph.adj[best]) {
      if (done[j]) continue;
      const nd = dist[best] + (graph.cost.get(`${best}:${j}`) ?? 1);
      if (nd < dist[j]) { dist[j] = nd; prev[j] = best; }
    }
  }
  if (dist[to] === Infinity) return null;
  const out = [];
  for (let at = to; at >= 0; at = prev[at]) {
    out.push(at);
    if (at === from) break;
  }
  out.reverse();
  return out[0] === from ? out : null;
}

// Concatenate the lane paths for a node route into one flat waypoint list.
export function routeWaypoints(graph, route) {
  if (!route || route.length < 2) return [];
  const out = [];
  for (let i = 0; i < route.length - 1; i++) {
    const path = graph.lanes.get(`${route[i]}:${route[i + 1]}`);
    if (!path) continue;
    for (let k = i === 0 ? 0 : 1; k < path.length; k++) out.push(path[k]);
  }
  return out;
}
