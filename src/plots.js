// The pre-designed city: every map gets a fixed, aesthetic layout of build
// plots arranged around the Keep — plaza houses, farm lanes, mills, mines on
// the ore, tower rings, and a walled rampart with gates at the compass points.
// Deterministic from the map alone, so every peer generates the same city.
import { TILE } from './config.js';
import { makeRNG } from './utils.js';

export function generatePlots(map) {
  const N = map.size;
  const c = N / 2;
  const rng = makeRNG(map.seed * 7 + 13);
  const plots = [];
  const taken = new Set(); // tile keys reserved by already-placed plots

  const reserve = (x, z, size, pad = 1) => {
    for (let dz = -pad; dz < size + pad; dz++) {
      for (let dx = -pad; dx < size + pad; dx++) taken.add((z + dz) * N + (x + dx));
    }
  };
  const free = (x, z, size) => {
    for (let dz = 0; dz < size; dz++) {
      for (let dx = 0; dx < size; dx++) {
        if (!map.isBuildable(x + dx, z + dz)) return false;
        if (taken.has((z + dz) * N + (x + dx))) return false;
      }
    }
    return true;
  };

  // Spiral out from (x,z) to the nearest clear spot for a size×size plot.
  const findSpot = (x, z, size, maxR = 6) => {
    x |= 0; z |= 0;
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = x + dx, nz = z + dz;
          if (nx < 2 || nz < 2 || nx + size > N - 2 || nz + size > N - 2) continue;
          if (free(nx, nz, size)) return [nx, nz];
        }
      }
    }
    return null;
  };

  let nextId = 1;
  const add = (kind, x, z, size, extra = {}) => {
    const spot = findSpot(x, z, size);
    if (!spot) return null;
    const p = {
      id: nextId++, kind, x: spot[0], z: spot[1], size,
      cx: spot[0] + size / 2, cz: spot[1] + size / 2,
      tier: 0, paid: 0, branch: null, ...extra,
    };
    reserve(spot[0], spot[1], size);
    plots.push(p);
    return p;
  };

  // --- The Keep, dead center (tier 0 here; the game constructs it at start) ---
  add('hq', c - 2, c - 2, 4);
  reserve(c - 4, c - 4, 8, 0); // keep the plaza clear around it

  const ringSpot = (r, ang) => [c + Math.cos(ang) * r - 1, c + Math.sin(ang) * r - 1];

  // --- Plaza ring: houses close to the Keep, angled like a real square ---
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const [x, z] = ringSpot(6.8, ang);
    add('house', x, z, 2);
  }

  // --- Second ring: farms on the diagonals, mills north & south, camps south ---
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const [x, z] = ringSpot(10.4, ang);
    add('farm', x, z, 2);
  }
  add('mill', ...ringSpot(10.4, -Math.PI / 2), 2);
  add('mill', ...ringSpot(10.4, Math.PI / 2), 2);

  const campKinds = ['camp_militia', 'camp_ranger', 'camp_sniper'];
  campKinds.forEach((kind, i) => {
    const ang = Math.PI / 2 + (i - 1) * 0.55; // fan just south of the Keep
    const [x, z] = ringSpot(8.6, ang);
    add(kind, x, z, 2);
  });

  // --- Tower ring: 8 towers between the houses and the wall ---
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const [x, z] = ringSpot(13.2, ang);
    add('tower', x, z, 2);
  }

  // --- Wall: a rampart ring split into 4 segments, gates at the compass points ---
  const WALL_R = 15.6;
  const segDefs = [
    { name: 'North Wall', a0: -Math.PI * 0.75, a1: -Math.PI * 0.25, gate: -Math.PI / 2 },
    { name: 'East Wall', a0: -Math.PI * 0.25, a1: Math.PI * 0.25, gate: 0 },
    { name: 'South Wall', a0: Math.PI * 0.25, a1: Math.PI * 0.75, gate: Math.PI / 2 },
    { name: 'West Wall', a0: Math.PI * 0.75, a1: Math.PI * 1.25, gate: Math.PI },
  ];
  for (const seg of segDefs) {
    const tiles = [];
    const seen = new Set();
    const steps = 90;
    for (let s = 0; s <= steps; s++) {
      const ang = seg.a0 + (s / steps) * (seg.a1 - seg.a0);
      const x = Math.round(c + Math.cos(ang) * WALL_R);
      const z = Math.round(c + Math.sin(ang) * WALL_R);
      const k = z * N + x;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!map.isBuildable(x, z) || taken.has(k)) continue; // terrain makes natural gaps
      tiles.push([x, z]);
    }
    if (tiles.length < 6) continue;
    // Gate: the wall tile closest to the segment's compass point.
    const gx = c + Math.cos(seg.gate) * WALL_R, gz = c + Math.sin(seg.gate) * WALL_R;
    let gate = tiles[0], gd = Infinity;
    for (const t of tiles) {
      const d = (t[0] - gx) ** 2 + (t[1] - gz) ** 2;
      if (d < gd) { gd = d; gate = t; }
    }
    const p = {
      id: nextId++, kind: 'wall', name: seg.name,
      x: tiles[0][0], z: tiles[0][1], size: 1,
      cx: c + Math.cos((seg.a0 + seg.a1) / 2) * WALL_R,
      cz: c + Math.sin((seg.a0 + seg.a1) / 2) * WALL_R,
      tiles, gate, tier: 0, paid: 0, branch: null,
    };
    for (const [x, z] of tiles) taken.add(z * N + x);
    plots.push(p);
  }

  // --- Gold mines on real ore veins (the risky money), with a guard tower ---
  const clusters = oreClusters(map, c);
  for (const cl of clusters.slice(0, 3)) {
    const mine = add('mine', cl.x - 1, cl.z - 1, 2);
    if (mine) add('tower', mine.x + 3, mine.z, 2);
  }

  // --- A couple of far farms for greedy players (outside the wall) ---
  for (let i = 0; i < 2; i++) {
    const ang = rng() * Math.PI * 2;
    const [x, z] = ringSpot(19 + rng() * 3, ang);
    add('farm', x, z, 2);
  }

  return plots;
}

// Find clusters of gold-ore tiles, nearest-to-center first.
function oreClusters(map, c) {
  const N = map.size;
  const ore = [];
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (map.tiles[z * N + x] === TILE.GOLDORE) ore.push([x, z]);
    }
  }
  const clusters = [];
  const used = new Set();
  for (let i = 0; i < ore.length; i++) {
    if (used.has(i)) continue;
    const stack = [i];
    used.add(i);
    const members = [];
    while (stack.length) {
      const j = stack.pop();
      members.push(ore[j]);
      for (let k = 0; k < ore.length; k++) {
        if (used.has(k)) continue;
        if (Math.abs(ore[k][0] - ore[j][0]) + Math.abs(ore[k][1] - ore[j][1]) < 7) {
          used.add(k);
          stack.push(k);
        }
      }
    }
    const x = Math.round(members.reduce((s, m) => s + m[0], 0) / members.length);
    const z = Math.round(members.reduce((s, m) => s + m[1], 0) / members.length);
    const d = Math.hypot(x - c, z - c);
    if (d > 12 && d < 42) clusters.push({ x, z, d, n: members.length });
  }
  return clusters.sort((a, b) => a.d - b.d);
}
