// The pre-designed city.
//
// Every level raises a city with a PLAN: a silhouette, a number of gates, a
// street pattern and a way of laying out its districts. A ringed bastion is not
// a square fort is not a star fort — the wall you defend, the ground you have
// to build on, and the number of ways in all change with the plan, so no two
// campaign levels feel like the same base with a different colour.
//
// What every plan guarantees, because the game depends on it:
//   - a Keep at the centre, on levelled ground
//   - a CLOSED rampart whose only openings are its gates
//   - towers covering every gate
//   - all three muster camps, each on a road
//   - enough plots for a full build-out
//
// Deterministic from the map, the site and the level alone, so every peer in a
// lockstep match generates the identical city.
import { TILE, CITY_WALL_R } from './config.js';
import { makeRNG } from './utils.js';

const TAU = Math.PI * 2;
const CAMP_KINDS = ['camp_militia', 'camp_ranger', 'camp_sniper'];

// A square silhouette, clamped so the corners cannot run away to infinity.
const square = (t, R) => Math.min(R * 1.33, R / Math.max(Math.abs(Math.cos(t)), Math.abs(Math.sin(t))));

// ---------------------------------------------------------------------------
// City plans
// ---------------------------------------------------------------------------
// `radius(t, R)` is the rampart silhouette in the city's own frame, where t=0
// points at the enemy. `gates` are angles in that same frame, so a plan always
// turns its face toward the hives.
export const CITY_PLANS = {
  // Four gates, one ring. The readable one — open on every side, defended
  // everywhere or nowhere. The teaching base.
  bastion: {
    key: 'bastion',
    label: 'ringed bastion',
    blurb: 'A closed ring with four gates. Nothing is safe, nothing is far.',
    scale: 1.0,
    gates: [0, Math.PI / 2, Math.PI, -Math.PI / 2],
    radius: (t, R) => R,
    layout: layoutBastion,
  },
  // A square fort with bastion corners and a solid back wall: three ways in,
  // gridded streets, and the whole rear of the town safe to build in.
  fort: {
    key: 'fort',
    label: 'square fort',
    blurb: 'Bastioned corners, a solid back wall and three gates. Build behind the line.',
    scale: 0.95,
    gates: [0, Math.PI / 2, -Math.PI / 2],
    radius: square,
    layout: layoutFort,
  },
  // Five spurs, each carrying a tower, gates sunk into the valleys between
  // them: anything at a gate is in crossfire from two spurs at once.
  star: {
    key: 'star',
    label: 'star fort',
    blurb: 'Five towered spurs. Every gate sits in a crossfire — the farms sit outside it.',
    scale: 0.98,
    gates: [Math.PI * 0.2, Math.PI, -Math.PI * 0.2],
    radius: (t, R) => R * (1 + 0.17 * Math.cos(5 * t)),
    layout: layoutStar,
  },
  // A D-fort: a broad arc thrown forward at the enemy and a straight back wall
  // closing it off. One heavy front gate, one postern, one street between them.
  crescent: {
    key: 'crescent',
    label: 'crescent hold',
    blurb: 'A broad front arc and a straight back wall. One heavy gate, one postern.',
    scale: 1.06,
    gates: [0, Math.PI],
    radius: (t, R) => {
      const c = Math.cos(t);
      const arc = R * 1.12;
      // Behind the city the wall runs dead straight, at a fixed depth.
      return c < -0.25 ? Math.min(arc, (R * 0.62) / -c) : arc;
    },
    layout: layoutCrescent,
  },
  // A tight body with a long walled throat jutting at the enemy. Everything
  // that wants in walks the throat, and the throat is lined with towers.
  keyhole: {
    key: 'keyhole',
    label: 'throat keep',
    blurb: 'A walled throat and a postern. They come up the corridor, or not at all.',
    scale: 0.95,
    gates: [0, Math.PI],
    radius: (t, R) => {
      const a = Math.atan2(Math.sin(t), Math.cos(t));
      return R * (0.74 + 0.68 * Math.exp(-((a / 0.22) ** 2)));
    },
    layout: layoutKeyhole,
  },
};

const PLAN_ORDER = Object.keys(CITY_PLANS);

function pickPlan(map, opts) {
  const named = opts.plan || (map.theme && map.theme.city);
  if (CITY_PLANS[named]) return CITY_PLANS[named];
  // No level to ask (a skirmish map, a test harness): take a stable plan from
  // the seed rather than always falling back to the same one.
  const key = ((map.seed || 0) >>> 0) + (opts.levelId || 0) * 7;
  return CITY_PLANS[PLAN_ORDER[key % PLAN_ORDER.length]];
}

// Which way is the war? The plan turns its face toward the hives, so the heavy
// gate, the towers and the camps end up on the side that gets hit.
function cityFacing(map, cx, cz) {
  const nests = map.nestSpots || [];
  if (!nests.length) return 0;
  let sx = 0, sz = 0;
  for (const [x, z] of nests) {
    const d = Math.max(1, Math.hypot(x - cx, z - cz));
    sx += (x - cx) / d; sz += (z - cz) / d;
  }
  if (Math.abs(sx) < 1e-6 && Math.abs(sz) < 1e-6) return 0;
  return Math.atan2(sz, sx);
}

const COMPASS = ['East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest', 'North', 'Northeast'];
const compassName = (ang) => COMPASS[Math.round((((ang % TAU) + TAU) % TAU) / (Math.PI / 4)) % 8];

export function generatePlots(map, anchor = null, opts = {}) {
  const N = map.size;
  const cx = anchor ? anchor.x : N / 2;
  const cz = anchor ? anchor.z : N / 2;
  const plan = pickPlan(map, opts);
  const rng = makeRNG(map.seed * 7 + 13 + (opts.siteIdx || 0) * 101);
  const R = CITY_WALL_R * plan.scale;
  const facing = cityFacing(map, cx, cz);
  const plots = [];
  const taken = new Set(); // tile keys reserved by already-placed plots

  const radiusAt = (t) => plan.radius(t, R);
  let reach = 0;
  for (let i = 0; i < 64; i++) reach = Math.max(reach, radiusAt((i / 64) * TAU));

  // --- Found the city: level everything inside the rampart to clean ground.
  // Ore veins survive (money), everything else becomes buildable grass. This
  // is what guarantees a CLOSED wall and a tidy town on any ground.
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      const d = Math.hypot(dx, dz);
      if (d > reach + 2.5) continue;
      if (d > radiusAt(Math.atan2(dz, dx) - facing) + 2.5) continue;
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
  const hq = add('hq', cx - 2, cz - 2, 4);
  reserve(cx - 4, cz - 4, 8, 0); // keep the plaza clear around it

  // --- Wall FIRST: a closed, 4-connected ring — every tile shares an edge
  // with the next, so the rendered rampart is one continuous wall with the
  // only ways in being the gates. Corner steps get a filler tile.
  const ringTiles = [];
  {
    const seen = new Set();
    const steps = 2400;
    let last = null;
    const put = (x, z, ang) => {
      const k = z * N + x;
      if (seen.has(k)) return;
      seen.add(k);
      ringTiles.push({ x, z, ang });
    };
    // Step from the previous tile to the next one axis at a time, so the ring
    // stays 4-connected however sharply the silhouette turns — a star spur or
    // the throat of a keyhole moves several tiles between samples.
    const walkTo = (x, z, ang) => {
      if (!last) { put(x, z, ang); last = [x, z]; return; }
      let [lx, lz] = last;
      let guard = 0;
      while ((lx !== x || lz !== z) && guard++ < 4 * N) {
        if (lx !== x) lx += Math.sign(x - lx);
        else lz += Math.sign(z - lz);
        put(lx, lz, ang);
      }
      last = [x, z];
    };
    for (let s = 0; s < steps; s++) {
      const t = (s / steps) * TAU - Math.PI;
      const ang = t + facing;
      const r = radiusAt(t);
      walkTo(Math.round(cx + Math.cos(ang) * r), Math.round(cz + Math.sin(ang) * r), t);
    }
    // Close the loop back onto the first tile.
    const first = ringTiles[0];
    if (first) walkTo(first.x, first.z, first.ang);
  }

  // Each gate owns the stretch of rampart nearest to it, so the wall splits
  // into one repairable segment per gate however many gates the plan has.
  const angDiff = (a, b) => {
    let d = Math.abs(a - b) % TAU;
    return d > Math.PI ? TAU - d : d;
  };
  const gateAngles = plan.gates;
  const segTiles = gateAngles.map(() => []);
  for (const tile of ringTiles) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < gateAngles.length; i++) {
      const d = angDiff(tile.ang, gateAngles[i]);
      if (d < bd) { bd = d; best = i; }
    }
    segTiles[best].push([tile.x, tile.z]);
  }

  const gates = [];
  gateAngles.forEach((t, i) => {
    const tiles = segTiles[i];
    if (tiles.length < 6) return;
    const world = t + facing;
    const gr = radiusAt(t);
    const gx = cx + Math.cos(world) * gr, gz = cz + Math.sin(world) * gr;
    let gate = tiles[0], gd = Infinity;
    for (const tile of tiles) {
      const d = (tile[0] - gx) ** 2 + (tile[1] - gz) ** 2;
      if (d < gd) { gd = d; gate = tile; }
    }
    gates.push({ gate, ang: world, t });
    plots.push({
      id: nextId++, kind: 'wall',
      name: `${compassName(world)} Wall`,
      x: tiles[0][0], z: tiles[0][1], size: 1,
      cx: gx, cz: gz,
      tiles, gate, tier: 0, paid: 0, branch: null,
    });
    for (const [x, z] of tiles) taken.add(z * N + x);
  });

  // --- Local frame helpers: u runs toward the enemy, v runs across. Layouts
  // are written in this frame, so a plan reads the same whichever way the city
  // ends up facing.
  const cosF = Math.cos(facing), sinF = Math.sin(facing);
  const world = (u, v) => [cx + u * cosF - v * sinF, cz + u * sinF + v * cosF];
  const at = (u, v, size = 2) => {
    const [x, z] = world(u, v);
    return [Math.round(x - size / 2), Math.round(z - size / 2)];
  };
  const spot = (r, t, size = 2) => at(Math.cos(t) * r, Math.sin(t) * r, size);
  const road = (u0, v0, u1, v1) => {
    const [x0, z0] = world(u0, v0);
    const [x1, z1] = world(u1, v1);
    markPathLine(x0, z0, x1, z1);
  };
  // A spot just inside a gate and off to one side of it. Measured from the
  // gate tile itself rather than from an angle, so it lands correctly on a
  // square corner, a star valley or the mouth of a throat alike.
  const gateFlank = (g, side, back = 3.0, off = 2.4, size = 2) => {
    const ix = -Math.cos(g.ang), iz = -Math.sin(g.ang);
    return [
      Math.round(g.gate[0] + 0.5 + ix * back - iz * side * off - size / 2),
      Math.round(g.gate[1] + 0.5 + iz * back + ix * side * off - size / 2),
    ];
  };

  // --- Roads from every gate to the plaza, before anything is built, so the
  // streets are streets and not the gaps between buildings.
  for (const g of gates) {
    const dx = -Math.cos(g.ang), dz = -Math.sin(g.ang);
    const inward = Math.max(2, radiusAt(g.t) - 5.4);
    for (let d = 1; d <= inward; d += 0.5) {
      markPathTile(Math.round(g.gate[0] + dx * d), Math.round(g.gate[1] + dz * d));
    }
  }

  const campPlots = [];
  const addCamps = (spots) => {
    CAMP_KINDS.forEach((kind, i) => {
      const s = spots[Math.min(i, spots.length - 1)];
      const camp = add(kind, s[0], s[1], 2);
      if (camp) campPlots.push(camp);
    });
  };

  const C = { map, N, cx, cz, R, plan, facing, rng, gates, radiusAt, add, at, spot, road, gateFlank, addCamps };
  plan.layout(C);

  // --- Gold mines on real ore veins (the risky money), with a guard tower ---
  const clusters = oreClusters(map, cx, cz);
  for (const cl of clusters.slice(0, 3)) {
    const mine = add('mine', cl.x - 1, cl.z - 1, 2);
    if (mine) add('tower', mine.x + 3, mine.z, 2);
  }

  // --- Top up: a plan may lose plots to bad ground, and a half-empty city is
  // not a city. Fill the remaining interior with housing and fields.
  const filler = ['house', 'farm'];
  let guard = 0;
  while (plots.length < 46 && guard++ < 300) {
    const t = rng() * TAU;
    const r = 5.5 + rng() * Math.max(1, radiusAt(t) - 7.5);
    add(filler[plots.length % filler.length], ...spot(r, t), 2, {}, 3);
  }

  if (hq) {
    hq.plan = {
      key: plan.key, label: plan.label, blurb: plan.blurb,
      facing, reach, gates: gates.map((g) => g.ang),
    };
  }

  // --- Camp aprons: every barracks gets a dirt apron and a spur to the plaza,
  // so a muster camp never looks dropped in a field.
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
    for (let x = camp.x - 1; x <= camp.x + camp.size; x++) {
      paintPathTile(x, camp.z - 1);
      paintPathTile(x, camp.z + camp.size);
    }
    for (let z = camp.z - 1; z <= camp.z + camp.size; z++) {
      paintPathTile(camp.x - 1, z);
      paintPathTile(camp.x + camp.size, z);
    }
    const toward = Math.atan2(cz - camp.cz, cx - camp.cx);
    paintPathLine(camp.cx, camp.cz, camp.cx + Math.cos(toward) * 6, camp.cz + Math.sin(toward) * 6);
  }

  return plots;
}

// ---------------------------------------------------------------------------
// Layouts — one per plan. All of them work in the city's local frame, where
// +u is the direction the horde comes from.
// ---------------------------------------------------------------------------

// Concentric and even-handed: houses around the plaza, farms and mills on the
// diagonals, towers flanking every gate and a second tower ring behind them.
function layoutBastion(C) {
  const { add, spot, R, gates, gateFlank } = C;
  for (const g of gates) {
    for (const side of [-1, 1]) add('tower', ...gateFlank(g, side), 2);
  }
  for (let i = 0; i < 8; i++) add('house', ...spot(6.8, (i / 8) * TAU + Math.PI / 8), 2);
  for (let i = 0; i < 4; i++) add('farm', ...spot(10.4, (i / 4) * TAU + Math.PI / 4), 2);
  add('mill', ...spot(10.4, -Math.PI / 2 + 0.4), 2);
  add('mill', ...spot(10.4, Math.PI / 2 - 0.4), 2);
  C.addCamps([spot(8.6, Math.PI - 0.6), spot(8.6, Math.PI), spot(8.6, Math.PI + 0.6)]);
  for (let i = 0; i < 4; i++) add('tower', ...spot(13.0, (i / 4) * TAU + Math.PI / 4), 2);
  // Two far fields for greedy players, outside the wall entirely.
  for (let i = 0; i < 2; i++) add('farm', ...spot(R + 4 + C.rng() * 3, C.rng() * TAU), 2);
}

// Gridded streets inside a bastioned square. The back wall has no gate, so the
// whole rear of the town is safe ground to build economy on.
function layoutFort(C) {
  const { add, at, road, R, gates, gateFlank } = C;
  const S = R * 0.92;
  road(S, 0, -S * 0.5, 0);          // the avenue, front gate to plaza
  road(0, -S, 0, S);                // the cross street between the side gates
  road(-6, -S * 0.75, -6, S * 0.75); // a back lane behind the Keep

  for (const g of gates) {
    for (const side of [-1, 1]) add('tower', ...gateFlank(g, side), 2);
  }
  // Corner bastions: the square's whole point.
  for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    add('tower', ...at(su * (S - 3.6), sv * (S - 3.6)), 2);
  }
  // Housing blocks either side of the cross street.
  for (const u of [3.5, -3.5]) {
    for (const v of [-10, -5.5, 5.5, 10]) add('house', ...at(u, v), 2);
  }
  // Economy in the safe rear quarter.
  for (const v of [-9.5, -4.5, 4.5, 9.5]) add('farm', ...at(-9.5, v), 2);
  add('mill', ...at(-13, -4), 2);
  add('mill', ...at(-13, 4), 2);
  // Barracks yard by the front gate — the muster is where the fighting is.
  C.addCamps([at(8.5, -6.5), at(8.5, 6.5), at(12, 0)]);
}

// Five towered spurs. Gates sit in the valleys between them, so anything
// chewing a gate is shot from two sides. The farms live outside the wall.
function layoutStar(C) {
  const { add, spot, R, gates, gateFlank } = C;
  for (let i = 0; i < 5; i++) add('tower', ...spot(R * 1.17 - 2.8, (i / 5) * TAU), 2);
  for (const g of gates) add('tower', ...gateFlank(g, 0, 3.2, 0), 2);
  for (let i = 0; i < 7; i++) add('house', ...spot(6.6, (i / 7) * TAU + 0.3), 2);
  add('mill', ...spot(9.6, 0.9), 2);
  add('mill', ...spot(9.6, -0.9), 2);
  for (let i = 0; i < 3; i++) add('tower', ...spot(11.0, Math.PI + (i - 1) * 0.9), 2);
  C.addCamps([spot(9.8, Math.PI - 0.35), spot(12.2, Math.PI), spot(9.8, Math.PI + 0.35)]);
  // Outside the wall, at your own risk — a star fort has no room to farm.
  for (const t of [Math.PI - 0.9, Math.PI - 0.35, Math.PI + 0.35, Math.PI + 0.9]) {
    add('farm', ...spot(R * 1.42, t), 2);
  }
}

// One street from the heavy front gate to the postern at the back, houses
// lining it, and every tower stacked on the arc that faces the horde.
function layoutCrescent(C) {
  const { add, at, spot, road, R, gates, gateFlank, radiusAt } = C;
  road(R * 1.0, 0, -R * 0.5, 0);
  road(3, -9, 3, 9);
  for (const g of gates) {
    for (const side of [-1, 1]) add('tower', ...gateFlank(g, side), 2);
  }
  // The front arc carries the weight.
  for (const t of [-0.95, -0.5, 0.5, 0.95]) add('tower', ...spot(radiusAt(t) - 2.8, t), 2);
  for (const t of [-1.5, 1.5]) add('tower', ...spot(R * 0.78, t), 2);
  for (const v of [-4, 4]) {
    for (const u of [-8.5, -4, 4.5, 9]) add('house', ...at(u, v), 2);
  }
  for (const v of [-8.5, 8.5]) {
    add('farm', ...at(-8, v), 2);
    add('mill', ...at(-3, v), 2);
  }
  add('farm', ...at(-12.5, -3), 2);
  add('farm', ...at(-12.5, 3), 2);
  C.addCamps([at(7.5, -8), at(11.5, 0), at(7.5, 8)]);
}

// A tight keep with a walled throat thrown forward. The throat is the whole
// design: four towers line it, and there is one postern out the back.
function layoutKeyhole(C) {
  const { add, at, road, R, gates, gateFlank } = C;
  road(R * 1.3, 0, -R * 0.55, 0);
  road(-5, -R * 0.5, -5, R * 0.5);
  // The kill corridor: towers down the length of the throat and a pair
  // covering its mouth, so the whole corridor is under fire.
  for (const v of [-2.6, 2.6]) add('tower', ...at(R * 1.12, v), 2);
  for (const v of [-5.0, 5.0]) add('tower', ...at(R * 0.66, v), 2);
  for (const g of gates) {
    for (const side of [-1, 1]) add('tower', ...gateFlank(g, side, 3.0, 2.0), 2);
  }
  // Dense blocks packed into the body.
  for (const u of [-1, -5.5]) {
    for (const v of [-9, -5, 5, 9]) add('house', ...at(u, v), 2);
  }
  for (const v of [-8, -3, 3, 8]) add('farm', ...at(-10, v), 2);
  add('mill', ...at(-13.5, -3.5), 2);
  add('mill', ...at(-13.5, 3.5), 2);
  C.addCamps([at(4, -8.5), at(4, 8.5), at(8.5, -5)]);
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
