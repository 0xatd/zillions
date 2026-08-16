// The pre-designed city: every map gets a fixed, aesthetic layout of build
// plots arranged around the Keep — plaza houses, farm lanes, mills, mines on
// the ore, gate-flanking towers, and a fully CLOSED rampart with gates at the
// compass points. The city footprint is levelled to clean ground first, so the
// wall always connects and the layout reads Thronefall-simple on every map.
// Deterministic from the map alone, so every peer generates the same city.
import { TILE, CITY_WALL_R } from './config.js';
import { makeRNG } from './utils.js';

export function generatePlots(map, anchor = null) {
  const N = map.size;
  const cx = anchor ? anchor.x : N / 2;
  const cz = anchor ? anchor.z : N / 2;
  const rng = makeRNG(map.seed * 7 + 13);
  const plots = [];
  const taken = new Set(); // tile keys reserved by already-placed plots

  const WALL_R = CITY_WALL_R;

  // --- Found the city: level everything inside the rampart to clean ground.
  // Ore veins survive (money), everything else becomes buildable grass. This
  // is what guarantees a CLOSED wall and a tidy, symmetric town on any map.
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > WALL_R + 2.5) continue;
      const t = map.tiles[z * N + x];
      if (t !== TILE.GOLDORE && t !== TILE.STONEORE) map.tiles[z * N + x] = TILE.GRASS;
    }
  }

  const reserve = (x, z, size, pad = 1) => {
    for (let dz = -pad; dz < size + pad; dz++) {
      for (let dx = -pad; dx < size + pad; dx++) taken.add((z + dz) * N + (x + dx));
    }
  };
  const markPathTile = (x, z) => {
    x = Math.round(x); z = Math.round(z);
    if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) return;
    const k = z * N + x;
    if (taken.has(k)) return;
    if (map.tiles[k] === TILE.GRASS || map.tiles[k] === TILE.PATH) map.tiles[k] = TILE.PATH;
    taken.add(k);
  };
  const markPathLine = (x0, z0, x1, z1) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      markPathTile(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
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
  const add = (kind, x, z, size, extra = {}, maxR = 6) => {
    const spot = findSpot(x, z, size, maxR);
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
  add('hq', cx - 2, cz - 2, 4);
  reserve(cx - 4, cz - 4, 8, 0); // keep the plaza clear around it

  // --- Wall FIRST: a closed, 4-connected ring — every tile shares an edge
  // with the next, so the rendered rampart is one continuous wall with the
  // only ways in being the 4 gates. Corner steps get a filler tile.
  const ringTiles = [];
  {
    const seen = new Set();
    const steps = 1440;
    let last = null;
    const A0 = -Math.PI * 0.75; // start on the NW diagonal (segment boundary)
    const put = (x, z, ang) => {
      const k = z * N + x;
      if (seen.has(k)) return;
      seen.add(k);
      ringTiles.push({ x, z, ang });
    };
    for (let s = 0; s < steps; s++) {
      const ang = A0 + (s / steps) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * WALL_R);
      const z = Math.round(cz + Math.sin(ang) * WALL_R);
      if (last && x !== last[0] && z !== last[1]) put(x, last[1], ang); // 4-connect the corner
      put(x, z, ang);
      last = [x, z];
    }
    // Close the loop: if the ring's tail meets its head diagonally, bridge it.
    const first = ringTiles[0];
    if (last && first && first.x !== last[0] && first.z !== last[1]) put(first.x, last[1], A0);
  }

  // Split the ring into 4 named segments at the diagonals; gate at each
  // segment's compass point.
  const norm = (a) => { while (a < -Math.PI * 0.75) a += Math.PI * 2; while (a >= Math.PI * 1.25) a -= Math.PI * 2; return a; };
  const segDefs = [
    { name: 'North Wall', a0: -Math.PI * 0.75, a1: -Math.PI * 0.25, gate: -Math.PI / 2 },
    { name: 'East Wall', a0: -Math.PI * 0.25, a1: Math.PI * 0.25, gate: 0 },
    { name: 'South Wall', a0: Math.PI * 0.25, a1: Math.PI * 0.75, gate: Math.PI / 2 },
    { name: 'West Wall', a0: Math.PI * 0.75, a1: Math.PI * 1.25, gate: Math.PI },
  ];
  const gates = [];
  for (const seg of segDefs) {
    const tiles = [];
    for (const t of ringTiles) {
      const a = norm(t.ang);
      if (a >= seg.a0 && a < seg.a1) tiles.push([t.x, t.z]);
    }
    if (tiles.length < 6) continue;
    // Gate: the wall tile closest to the segment's compass point.
    const gx = cx + Math.cos(seg.gate) * WALL_R, gz = cz + Math.sin(seg.gate) * WALL_R;
    let gate = tiles[0], gd = Infinity;
    for (const t of tiles) {
      const d = (t[0] - gx) ** 2 + (t[1] - gz) ** 2;
      if (d < gd) { gd = d; gate = t; }
    }
    gates.push({ gate, ang: seg.gate });
    const p = {
      id: nextId++, kind: 'wall', name: seg.name,
      x: tiles[0][0], z: tiles[0][1], size: 1,
      cx: cx + Math.cos(seg.gate) * WALL_R,
      cz: cz + Math.sin(seg.gate) * WALL_R,
      tiles, gate, tier: 0, paid: 0, branch: null,
    };
    for (const [x, z] of tiles) taken.add(z * N + x);
    plots.push(p);
  }

  // --- Roads: a dirt lane from each gate straight to the plaza. Purely for
  // readability — the city looks designed before a single coin is spent.
  for (const { gate, ang } of gates) {
    const dx = -Math.cos(ang), dz = -Math.sin(ang); // inward
    for (let d = 1; d <= WALL_R - 5.4; d += 0.5) {
      const x = Math.round(gate[0] + dx * d), z = Math.round(gate[1] + dz * d);
      markPathTile(x, z);
    }
  }

  const ringSpot = (r, ang) => [cx + Math.cos(ang) * r - 1, cz + Math.sin(ang) * r - 1];

  // --- Gate towers: a pair flanking every gate, just inside the wall. THIS
  // is the chokepoint kit — whatever chews the gate stands in a crossfire.
  for (const { ang } of gates) {
    for (const side of [-1, 1]) {
      const [x, z] = ringSpot(WALL_R - 2.6, ang + side * 0.22);
      add('tower', x, z, 2);
    }
  }

  // --- Plaza ring: houses close to the Keep, angled like a real square
  // (offset from the compass roads so the lanes stay open) ---
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
  add('mill', ...ringSpot(10.4, -Math.PI / 2 + 0.4), 2);
  add('mill', ...ringSpot(10.4, Math.PI / 2 - 0.4), 2);

  const campPlots = [];
  const campKinds = ['camp_militia', 'camp_ranger', 'camp_sniper'];
  campKinds.forEach((kind, i) => {
    const ang = Math.PI / 2 + (i - 1) * 0.6 + 0.3; // fan just south of the Keep
    const [x, z] = ringSpot(8.6, ang);
    const camp = add(kind, x, z, 2);
    if (camp) campPlots.push(camp);
  });

  // --- Mid towers on the diagonals: the ring between houses and wall ---
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const [x, z] = ringSpot(13.0, ang);
    add('tower', x, z, 2);
  }

  // --- Gold mines on real ore veins (the risky money), with a guard tower ---
  const clusters = oreClusters(map, cx, cz);
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

  const plotAt = (x, z) => plots.some((p) => {
    if (p.kind === 'wall') return false;
    return x >= p.x && x < p.x + p.size && z >= p.z && z < p.z + p.size;
  });
  const paintPathTile = (x, z) => {
    x = Math.round(x); z = Math.round(z);
    if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1 || plotAt(x, z)) return;
    const k = z * N + x;
    if (map.tiles[k] === TILE.GRASS || map.tiles[k] === TILE.PATH) map.tiles[k] = TILE.PATH;
  };
  const paintPathLine = (x0, z0, x1, z1) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      paintPathTile(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    }
  };
  for (const camp of campPlots) {
    // Give every barracks/camp a small dirt apron and spur. The plots still sit
    // off the main roads, but they no longer look disconnected from the city.
    for (let x = camp.x - 1; x <= camp.x + camp.size; x++) {
      paintPathTile(x, camp.z - 1);
      paintPathTile(x, camp.z + camp.size);
    }
    for (let z = camp.z - 1; z <= camp.z + camp.size; z++) {
      paintPathTile(camp.x - 1, z);
      paintPathTile(camp.x + camp.size, z);
    }
    paintPathLine(camp.cx, camp.cz, cx, cz + Math.sign(camp.cz - cz) * 6);
  }

  return plots;
}

// Find clusters of gold-ore tiles, nearest-to-the-city first.
function oreClusters(map, cx, cz) {
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
    const d = Math.hypot(x - cx, z - cz);
    if (d > 12 && d < 48) clusters.push({ x, z, d, n: members.length });
  }
  return clusters.sort((a, b) => a.d - b.d);
}
