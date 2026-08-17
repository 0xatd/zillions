// The pre-designed city.
//
// Every level raises a city with a PLAN: a silhouette, a number of gates, a
// street pattern and a way of laying out its districts. A ringed bastion is not
// a square fort is not a star fort — the wall you defend, the ground you have
// to build on, and the number of ways in all change with the plan, so no two
// campaign levels feel like the same base with a different colour.
//
// And the plan is only half of it: the GROUND finishes the design. Where the
// rampart line crosses crag, deep water or thick wood, nothing is built there —
// the land is already a wall. Walls are raised across the gaps between those
// anchors, and only the gaps can hold a gate. That is how real fortification
// has always worked: a promontory fort walls the neck and lets the cliffs do
// the rest, Dún Aonghasa runs its wall cliff to cliff, Great Zimbabwe spans
// between granite boulders, and field armies anchored their lines on a marsh
// or a ridge and built across what was left. See docs/fortress-inspiration.md.
//
// What every plan guarantees, because the game depends on it:
//   - a Keep at the centre, on levelled ground
//   - a boundary with NO holes: every tile of it is wall, crag, water or wood
//   - at least two entrances, each a ward — flanking towers and its own
//     muster camp, so the troops that hold a gate and the troops that push out
//     of it start at the gate
//   - all three camp kinds somewhere in the city
//   - enough plots for a full build-out
//
// Deterministic from the map, the site and the level alone, so every peer in a
// lockstep match generates the identical city.
import { TILE, CITY_WALL_R } from './config.js';
import { makeRNG } from './utils.js';

const TAU = Math.PI * 2;
// Ward camps are handed out cheapest-first, so a two-gate city can still afford
// to man both entrances early.
const CAMP_KINDS = ['camp_ranger', 'camp_militia', 'camp_sniper'];
// Past this much free wall the site stops being a bargain and starts being a
// bye — the founders cut another approach rather than ship an unassailable city.
const MAX_NATURAL_SHARE = 0.72;

// A square silhouette, clamped so the corners cannot run away to infinity.
const square = (t, R) => Math.min(R * 1.33, R / Math.max(Math.abs(Math.cos(t)), Math.abs(Math.sin(t))));

// ---------------------------------------------------------------------------
// City plans
// ---------------------------------------------------------------------------
// `radius(t, R)` is the rampart silhouette in the city's own frame, where t=0
// points at the enemy. `gates` are angles in that same frame, so a plan always
// turns its face toward the hives. `inner` adds a second, concentric ward
// around the Keep — the last chokepoint, the way Krak des Chevaliers and a
// Japanese honmaru put another wall between the enemy and the lord.
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
  // gridded streets, and an inner bailey around the Keep.
  fort: {
    key: 'fort',
    label: 'square fort',
    blurb: 'Bastioned corners, gridded streets and an inner bailey. Three ways in.',
    scale: 0.95,
    gates: [0, Math.PI / 2, -Math.PI / 2],
    radius: square,
    inner: { radius: 7.8 },
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
  // A tight body with a long walled throat jutting at the enemy, and an inner
  // ward behind it. Everything that wants in walks the throat.
  keyhole: {
    key: 'keyhole',
    label: 'throat keep',
    blurb: 'A walled throat, a postern, and an inner ward. They come up the corridor or not at all.',
    scale: 0.95,
    gates: [0, Math.PI],
    radius: (t, R) => {
      const a = Math.atan2(Math.sin(t), Math.cos(t));
      return R * (0.74 + 0.68 * Math.exp(-((a / 0.22) ** 2)));
    },
    inner: { radius: 7.4 },
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
const angDiff = (a, b) => {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
};

export function generatePlots(map, anchor = null, opts = {}) {
  const N = map.size;
  const cx = anchor ? anchor.x : N / 2;
  const cz = anchor ? anchor.z : N / 2;
  const plan = pickPlan(map, opts);
  const rng = makeRNG(map.seed * 7 + 13 + (opts.siteIdx || 0) * 101);
  const R = CITY_WALL_R * plan.scale;
  const facing = cityFacing(map, cx, cz);
  let plots = [];
  const taken = new Set(); // tile keys reserved by already-placed plots

  const radiusAt = (t) => plan.radius(t, R);
  let reach = 0;
  for (let i = 0; i < 64; i++) reach = Math.max(reach, radiusAt((i / 64) * TAU));

  // --- Found the city: level the INTERIOR to clean ground. The rampart band
  // itself is left exactly as the land made it — that band is where crag,
  // water and wood get to be the wall. The founders grade the earth too:
  // interior elevation is pulled toward the keep's ground, hard at the plaza
  // and fading toward the wall, so districts sit on terraced ground while the
  // rampart keeps the hill it was raised on.
  const keepElev = map.elev ? map.elev[Math.round(cz) * N + Math.round(cx)] : null;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      const d = Math.hypot(dx, dz);
      if (d > reach) continue;
      const edge = radiusAt(Math.atan2(dz, dx) - facing) - 2.2;
      if (d > edge) continue;
      const t = map.tiles[z * N + x];
      if (t !== TILE.GOLDORE && t !== TILE.STONEORE) map.tiles[z * N + x] = TILE.GRASS;
      if (keepElev != null) {
        const w = Math.min(1, Math.max(0, (edge - d) / 6)) * 0.85;
        const i = z * N + x;
        // The keep's motte: the plaza rises above the town on a graded mound,
        // so the seat of the city is visibly the top of it — height is
        // hierarchy, read at a glance from anywhere inside the walls.
        const motte = Math.max(0, 1 - d / 9) * 0.06;
        map.elev[i] = map.elev[i] * (1 - w) + keepElev * w + motte;
      }
    }
  }

  // --- The founders cut their own way in. The plan's two principal gates are
  // always opened through whatever the land put there, so a site can never be
  // sealed in with no way to sortie — everything else is left to the ground.
  const cutApproach = (t) => {
    const world = t + facing;
    for (let d = -3; d <= 5; d += 0.5) {
      const r = radiusAt(t) + d;
      for (let s = -0.22; s <= 0.221; s += 0.03) {
        const x = Math.round(cx + Math.cos(world + s) * r);
        const z = Math.round(cz + Math.sin(world + s) * r);
        if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
        const k = z * N + x;
        const tile = map.tiles[k];
        if (tile === TILE.WATER) map.tiles[k] = TILE.SAND;       // a causeway
        else if (tile === TILE.MOUNTAIN || tile === TILE.FOREST) map.tiles[k] = TILE.GRASS;
      }
    }
  };
  plan.gates.slice(0, 2).forEach(cutApproach);

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

  const wallIdBase = nextId;
  // --- A ring of rampart. Walk the silhouette one tile at a time so the line
  // stays 4-connected however sharply it turns, then let the terrain decide
  // which parts of it actually have to be built.
  const traceRing = (radiusFn, gateAngles, { role, useTerrain, ox = cx, oz = cz }) => {
    const ringTiles = [];
    const seen = new Set();
    let last = null;
    const put = (x, z, ang) => {
      const k = z * N + x;
      if (seen.has(k)) return;
      seen.add(k);
      ringTiles.push({ x, z, ang });
    };
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
    const steps = 2400;
    for (let s = 0; s < steps; s++) {
      const t = (s / steps) * TAU - Math.PI;
      const world = t + facing;
      const r = radiusFn(t);
      walkTo(Math.round(ox + Math.cos(world) * r), Math.round(oz + Math.sin(world) * r), t);
    }
    if (ringTiles[0]) walkTo(ringTiles[0].x, ringTiles[0].z, ringTiles[0].ang);

    // Each gate angle owns the stretch of ring nearest to it.
    const groups = gateAngles.map(() => []);
    for (const tile of ringTiles) {
      let best = 0, bd = Infinity;
      gateAngles.forEach((g, i) => {
        const d = angDiff(tile.ang, g);
        if (d < bd) { bd = d; best = i; }
      });
      groups[best].push(tile);
    }

    const made = [];
    let natural = 0;
    gateAngles.forEach((t, i) => {
      const group = groups[i];
      if (!group.length) return;
      // Where the land is already impassable there is nothing to build. What is
      // left is the gap, and the gap is what a wall is for.
      const open = useTerrain ? group.filter((tile) => map.isWalkable(tile.x, tile.z)) : group;
      natural += group.length - open.length;
      if (!open.length) return;   // this whole side is cliff, lake or deep wood
      // The gate goes on the tile nearest the plan's gate angle — but only if
      // there is enough open wall here to hang a gatehouse on.
      let gateTile = null;
      if (open.length >= 4) {
        let bd = Infinity;
        for (const tile of open) {
          const d = angDiff(tile.ang, t);
          if (d < bd) { bd = d; gateTile = tile; }
        }
      }
      const mid = gateTile || open[open.length >> 1];
      const world = mid.ang + facing;
      const p = {
        id: nextId++, kind: 'wall', role,
        name: `${compassName(world)} ${role === 'inner' ? 'Ward' : gateTile ? 'Gate' : 'Wall'}`,
        x: open[0].x, z: open[0].z, size: 1,
        cx: mid.x + 0.5, cz: mid.z + 0.5,
        tiles: open.map((tile) => [tile.x, tile.z]),
        gate: gateTile ? [gateTile.x, gateTile.z] : null,
        anchor: [mid.x, mid.z],
        tier: 0, paid: 0, branch: null,
      };
      for (const [x, z] of p.tiles) taken.add(z * N + x);
      // The gate is an ARCH, not a slot: every wall tile in this plot within
      // arm's reach of the gate tile opens with it. A ring traced along
      // diagonal or stair-stepped ground is two tiles thick exactly where the
      // gate wants to be, and a one-tile door in a two-tile wall is just a
      // wall (QA 2026-08-16: full-built cities sealed their own gates).
      if (gateTile) {
        p.arch = open
          .filter((tile) => Math.hypot(tile.x - gateTile.x, tile.z - gateTile.z) <= 1.5)
          .map((tile) => [tile.x, tile.z]);
      }
      plots.push(p);
      if (gateTile) made.push({ gate: p.gate, ang: world, t: mid.ang, plot: p });
    });
    return { gates: made, natural, length: ringTiles.length };
  };

  const gateAngles = [...plan.gates];
  let rampart = traceRing(radiusAt, gateAngles, { role: 'rampart', useTerrain: true });
  // Ground that closes almost the whole line leaves nothing to defend and
  // nothing to pay for. A sheltered site should be a real advantage, not a bye,
  // so past a point the founders cut one more way in — through the rock if they
  // have to. That is another gate to hold as well as another way out.
  if (rampart.length && (rampart.natural / rampart.length > MAX_NATURAL_SHARE || rampart.gates.length < 2)) {
    // Put it in the widest stretch of wall with no gate on it.
    const sorted = [...gateAngles].map((t) => Math.atan2(Math.sin(t), Math.cos(t))).sort((a, b) => a - b);
    let bestGap = -1, bestMid = Math.PI / 2;
    for (let i = 0; i < sorted.length; i++) {
      const a0 = sorted[i], a1 = sorted[(i + 1) % sorted.length] + (i + 1 === sorted.length ? TAU : 0);
      if (a1 - a0 > bestGap) { bestGap = a1 - a0; bestMid = (a0 + a1) / 2; }
    }
    gateAngles.push(bestMid);
    cutApproach(bestMid);
    for (const p of plots.filter((pl) => pl.kind === 'wall')) {
      for (const [x, z] of p.tiles) taken.delete(z * N + x);
    }
    plots = plots.filter((pl) => pl.kind !== 'wall');
    nextId = wallIdBase;
    rampart = traceRing(radiusAt, gateAngles, { role: 'rampart', useTerrain: true });
  }
  const gates = rampart.gates;
  // Every gate's exit is a road out. A gate that opens onto a pocket of crag
  // or thick wood is a gate to nowhere — the sortie dies in the doorway
  // (QA 2026-08-16: four of a throat keep's seven gates did). Cut a causeway
  // radially outward from each rampart gate until it meets ground the whole
  // map can walk. The ray leaves the ring only at the gate itself — the ring
  // is single-valued in radius around the keep — so it can never open the
  // boundary anywhere else.
  {
    const outside = new Uint8Array(N * N);
    const stack = [];
    for (let i = 0; i < N; i++) {
      for (const [x, z] of [[i, 0], [i, N - 1], [0, i], [N - 1, i]]) {
        if (!outside[z * N + x] && map.isWalkable(x, z)) { outside[z * N + x] = 1; stack.push([x, z]); }
      }
    }
    while (stack.length) {
      const [x, z] = stack.pop();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N || outside[nz * N + nx]) continue;
        if (!map.isWalkable(nx, nz)) continue;
        outside[nz * N + nx] = 1;
        stack.push([nx, nz]);
      }
    }
    for (const g of gates) {
      const gx = g.gate[0] + 0.5, gz = g.gate[1] + 0.5;
      const len = Math.hypot(gx - cx, gz - cz) || 1;
      const ux = (gx - cx) / len, uz = (gz - cz) / len;
      const px = -uz, pz = ux;
      let linked = false;
      for (let d = 2.5; d <= 26 && !linked; d += 0.5) {
        for (const w of (d < 4 ? [0] : [-1, 0, 1])) {
          const x = Math.round(gx + ux * d + px * w);
          const z = Math.round(gz + uz * d + pz * w);
          if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
          if (outside[z * N + x]) { linked = true; break; }
          const t = map.tiles[z * N + x];
          if (t === TILE.WATER) map.tiles[z * N + x] = TILE.SAND;
          else if (t === TILE.MOUNTAIN || t === TILE.FOREST) map.tiles[z * N + x] = TILE.GRASS;
        }
      }
    }
  }

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

  // --- The inner ward, for the plans that keep one: a second wall around the
  // Keep with its own gates, so losing the outer line is not losing the city.
  let inner = null;
  if (plan.inner) {
    const ir = plan.inner.radius;
    inner = traceRing(() => ir, [plan.gates[0], plan.gates[0] + Math.PI],
      { role: 'inner', useTerrain: false });
    // Towers stand OUTSIDE the inner gates, in the yard between the two walls:
    // whatever gets through the outer line has to cross that yard under fire.
    for (const g of inner.gates) {
      for (const side of [-1, 1]) add('tower', ...gateFlank(g, side, -2.2, 2.2), 2);
    }
  }

  // --- Streets: from every gate to the plaza, before anything is built, so
  // the streets are streets and not the gaps between buildings — and so the
  // city can never grow itself shut (QA 2026-08-16: a full-built city sealed
  // its own plaza; the hero reached 0 of 4 gates). Where there is an inner
  // ward the road bends to the ward's own gate first — the bent approach that
  // Krak des Chevaliers made famous, and a longer walk under the towers. The
  // lines run gate tile to gate tile (not to a radius), so a road cannot stop
  // short and leave the last stretch to the districts to close.
  for (const g of gates) {
    if (inner) {
      let best = null, bd = Infinity;
      for (const ig of inner.gates) {
        const d = angDiff(g.ang, ig.ang);
        if (d < bd) { bd = d; best = ig; }
      }
      if (best) markPathLine(g.gate[0], g.gate[1], best.gate[0], best.gate[1]);
    } else {
      markPathLine(g.gate[0], g.gate[1], cx, cz);
    }
  }
  if (inner) for (const ig of inner.gates) markPathLine(ig.gate[0], ig.gate[1], cx, cz);

  const campPlots = [];
  const addCamp = (kind, x, z, maxR = 6) => {
    const camp = add(kind, x, z, 2, {}, maxR);
    if (camp) campPlots.push(camp);
    return camp;
  };

  // --- Every entrance is a WARD. Towers flanking the gate, and a muster camp
  // inside it: the squads that hold this gate and the squads that push out of
  // it start here, not on the other side of town. Mycenae's gate bastion, a
  // hillfort's guarded passage, a bailey's barracks — same idea, same reason.
  gates.forEach((g, i) => {
    for (const side of [-1, 1]) add('tower', ...gateFlank(g, side), 2);
    const camp = addCamp(CAMP_KINDS[i % CAMP_KINDS.length], ...gateFlank(g, i % 2 ? 1 : -1, 6.5, 4.2));
    if (camp) { g.camp = camp; g.plot.ward = camp.kind; }
  });

  const C = {
    map, N, cx, cz, R, plan, facing, rng, gates, radiusAt,
    add, at, spot, road, gateFlank, addCamp, inner,
  };
  plan.layout(C);

  // Major progression lives in-world. Place support after the plan districts
  // so each workshop lands beside structures it can actually maintain.
  add('hero_forge', ...spot(5.0, -Math.PI / 2), 2, {}, 10);
  const supportAnchors = plots.filter((p) => p.kind === 'house' || p.kind === 'farm');
  const placeWorkshop = (anchor, fallbackAngle) => {
    if (anchor) {
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
        const workshop = add('workshop', anchor.x + dx, anchor.z + dz, 2, {}, 3);
        if (workshop) return workshop;
      }
    }
    return add('workshop', ...spot(7.0, fallbackAngle), 2, {}, 10);
  };
  placeWorkshop(supportAnchors[0], Math.PI);
  placeWorkshop(supportAnchors.at(-1), 0);

  // --- Whatever camp kinds the entrances did not cover get a home behind the
  // Keep, so the player always has all three doctrines available.
  CAMP_KINDS.forEach((kind, i) => {
    if (campPlots.some((c) => c.kind === kind)) return;
    for (const [r, t] of [[9.4, Math.PI + (i - 1) * 0.55], [11.5, Math.PI + (i - 1) * 0.9],
      [8.0, Math.PI / 2 + i], [12.5, -Math.PI / 2 - i * 0.6]]) {
      if (addCamp(kind, ...spot(r, t))) return;
    }
    addCamp(kind, ...spot(10.5, Math.PI), 10);
  });

  // --- Gold mines on real ore veins (the risky money), with a guard tower ---
  const clusters = oreClusters(map, cx, cz);
  for (const cl of clusters.slice(0, 3)) {
    const mine = add('mine', cl.x - 1, cl.z - 1, 2);
    if (mine) add('tower', mine.x + 3, mine.z, 2);
  }

  // --- Outer works: the land's own chokepoints, out on the approaches. A fence
  // between two crags is cheap (a barrier costs by the tile) and it turns a gap
  // into a gate you own. A tower behind it makes the gap a killing ground.
  const outer = pickOuterWorks(map, cx, cz, facing, reach);
  outer.forEach((c, i) => {
    const usable = c.tiles.filter(([x, z]) => map.isBuildable(x, z) && !taken.has(z * N + x));
    if (usable.length < 2) return;
    const mid = usable[usable.length >> 1];
    const p = {
      id: nextId++, kind: 'wall', role: 'outer', wild: true,
      name: `${c.name} Palisade`,
      x: usable[0][0], z: usable[0][1], size: 1,
      cx: mid[0] + 0.5, cz: mid[1] + 0.5,
      // Always a gate: your own squads have to be able to march out through
      // your own fence, and a gate is where the horde funnels — under the
      // tower behind it. A fence with no way through is a wall you built
      // against yourself.
      tiles: usable, gate: mid,
      anchor: [mid[0], mid[1]],
      tier: 0, paid: 0, branch: null,
    };
    for (const [x, z] of usable) taken.add(z * N + x);
    plots.push(p);
    // A watchtower behind the fence, on the city side of the gap.
    const toCity = Math.atan2(cz - mid[1], cx - mid[0]);
    add('tower', Math.round(mid[0] + Math.cos(toCity) * 3 - 1), Math.round(mid[1] + Math.sin(toCity) * 3 - 1), 2, {}, 4);
  });

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
      entrances: gates.length,
      natural: rampart.natural,
      naturalShare: rampart.length ? rampart.natural / rampart.length : 0,
      inner: !!inner,
      outerWorks: plots.filter((p) => p.role === 'outer').length,
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

// What the ground at a candidate site would do for the city raised on it:
// how much of the rampart line the land already closes, before a coin is spent.
// The player rides up to a flag and gets told this, because "half your wall is
// already there" is the whole reason to prefer one site over another.
export function surveySite(map, site, opts = {}) {
  const plan = pickPlan(map, opts);
  const R = CITY_WALL_R * plan.scale;
  const facing = cityFacing(map, site.x, site.z);
  const cut = plan.gates.slice(0, 2); // the two gates the founders always cut open
  let total = 0, natural = 0;
  for (let i = 0; i < 240; i++) {
    const t = (i / 240) * TAU - Math.PI;
    if (cut.some((g) => angDiff(t, g) < 0.19)) continue;
    const world = t + facing;
    const r = plan.radius(t, R);
    const x = Math.round(site.x + Math.cos(world) * r);
    const z = Math.round(site.z + Math.sin(world) * r);
    total++;
    if (!map.isWalkable(x, z)) natural++;
  }
  return { plan, natural: total ? natural / total : 0 };
}

// Which of the land's chokepoints are worth offering the player: close enough
// to the city to matter, out on the side the horde comes from, and spread out
// so they are three separate decisions rather than one wall in three pieces.
function pickOuterWorks(map, cx, cz, facing, reach) {
  const spots = map.chokeSpots || [];
  if (!spots.length) return [];
  const scored = [];
  for (const c of spots) {
    const d = Math.hypot(c.x - cx, c.z - cz);
    if (d < reach + 7 || d > 46) continue;
    const toward = Math.atan2(c.z - cz, c.x - cx);
    const facingAlign = Math.cos(toward - facing); // 1 = square on the war road
    scored.push({ ...c, d, score: c.score + facingAlign * 9 - d * 0.22 });
  }
  // A site with no pinch in easy reach still gets offered the nearest one on
  // the planet — a longer ride to the works, never a site with no works at all.
  if (!scored.length) {
    let best = null, bd = Infinity;
    for (const c of spots) {
      const d = Math.hypot(c.x - cx, c.z - cz);
      if (d < reach + 7 || d >= bd) continue;
      bd = d; best = { ...c, d, score: c.score };
    }
    if (best) scored.push(best);
  }
  scored.sort((a, b) => (b.score - a.score) || (a.x - b.x) || (a.z - b.z));
  const kept = [];
  for (const c of scored) {
    if (kept.length >= 3) break;
    if (kept.some((k) => Math.hypot(k.x - c.x, k.z - c.z) < 16)) continue;
    kept.push(c);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Layouts — one per plan. All of them work in the city's local frame, where
// +u is the direction the horde comes from. Gate towers and ward camps are
// placed for every plan by `generatePlots`; a layout only lays out the
// districts and the towers that are its own idea.
// ---------------------------------------------------------------------------

// Concentric and even-handed: houses around the plaza, farms and mills on the
// diagonals, and a second tower ring behind the wall.
function layoutBastion(C) {
  const { add, spot, R } = C;
  for (let i = 0; i < 8; i++) add('house', ...spot(6.8, (i / 8) * TAU + Math.PI / 8), 2);
  for (let i = 0; i < 4; i++) add('farm', ...spot(10.4, (i / 4) * TAU + Math.PI / 4), 2);
  add('mill', ...spot(10.4, -Math.PI / 2 + 0.4), 2);
  add('mill', ...spot(10.4, Math.PI / 2 - 0.4), 2);
  for (let i = 0; i < 4; i++) add('tower', ...spot(13.0, (i / 4) * TAU + Math.PI / 4), 2);
  // Two far fields for greedy players, outside the wall entirely.
  for (let i = 0; i < 2; i++) add('farm', ...spot(R + 4 + C.rng() * 3, C.rng() * TAU), 2);
}

// Gridded streets inside a bastioned square, with the economy in the quarter
// behind the Keep — the ground the back wall protects.
function layoutFort(C) {
  const { add, at, road, R } = C;
  const S = R * 0.92;
  road(0, -S, 0, S);                 // the cross street between the side gates
  road(-6, -S * 0.75, -6, S * 0.75); // a back lane behind the Keep
  // Corner bastions: the square's whole point.
  for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    add('tower', ...at(su * (S - 3.6), sv * (S - 3.6)), 2);
  }
  for (const u of [3.5, -3.5]) {
    for (const v of [-10, -5.5, 5.5, 10]) add('house', ...at(u, v), 2);
  }
  for (const v of [-9.5, -4.5, 4.5, 9.5]) add('farm', ...at(-9.5, v), 2);
  add('mill', ...at(-13, -4), 2);
  add('mill', ...at(-13, 4), 2);
}

// Five towered spurs. The wall has no room behind it, so the farms live
// outside — a real bargain, not a free lunch.
function layoutStar(C) {
  const { add, spot, R } = C;
  for (let i = 0; i < 5; i++) add('tower', ...spot(R * 1.17 - 2.8, (i / 5) * TAU), 2);
  for (let i = 0; i < 7; i++) add('house', ...spot(6.6, (i / 7) * TAU + 0.3), 2);
  add('mill', ...spot(9.6, 0.9), 2);
  add('mill', ...spot(9.6, -0.9), 2);
  for (let i = 0; i < 3; i++) add('tower', ...spot(11.0, Math.PI + (i - 1) * 0.9), 2);
  for (const t of [Math.PI - 0.9, Math.PI - 0.35, Math.PI + 0.35, Math.PI + 0.9]) {
    add('farm', ...spot(R * 1.42, t), 2);
  }
}

// One street from the heavy front gate to the postern at the back, houses
// lining it, and every spare tower stacked on the arc that faces the horde.
function layoutCrescent(C) {
  const { add, at, spot, road, R, radiusAt } = C;
  road(R * 1.0, 0, -R * 0.5, 0);
  road(3, -9, 3, 9);
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
}

// The throat is the whole design: towers down its length and a pair covering
// its mouth, so the corridor is under fire from end to end.
function layoutKeyhole(C) {
  const { add, at, road, R } = C;
  road(R * 1.3, 0, -R * 0.55, 0);
  road(-5, -R * 0.5, -5, R * 0.5);
  for (const v of [-2.6, 2.6]) add('tower', ...at(R * 1.12, v), 2);
  for (const v of [-5.0, 5.0]) add('tower', ...at(R * 0.66, v), 2);
  for (const u of [-1, -5.5]) {
    for (const v of [-9, -5, 5, 9]) add('house', ...at(u, v), 2);
  }
  for (const v of [-8, -3, 3, 8]) add('farm', ...at(-10, v), 2);
  add('mill', ...at(-13.5, -3.5), 2);
  add('mill', ...at(-13.5, 3.5), 2);
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
