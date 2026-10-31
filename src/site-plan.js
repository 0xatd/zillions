// Terrain-adapted colony sites.
//
// A base is not a ring dropped on a pad. Each plan names a LANDFORM for its
// city — a hilltop plateau, a fen island, a ridge spur, a valley head — and
// this module describes it in the city's own frame (t = 0 points at the
// hives): the rim line, which stretches of that rim the land closes (cliff or
// water: natural walls, free and indestructible) and which stretches are open
// ground that has to be walled, and where the approaches climb onto the
// plateau (the ramps, where the gates go).
//
// The terrain raises the landform (TerrainField._shapePlateaus), the city
// generator traces its rampart along the same rim (plots.js), so the wall
// line follows the land by construction: walls on the open rim, gates at the
// ramps, cliffs everywhere else. The per-site wobble comes from a hash of the
// map seed and the site index, so every peer in a lockstep match raises the
// identical base, and two sites on one map never look alike.
//
// The one exception is `outpost` — the desert last-stand: an isolated polygon
// fort on open flat badlands, walled all the way round, gates on every side.

const TAU = Math.PI * 2;

// World heights of the terraced landform (presentation only: the sim stays on
// tiles, where cliffs are crag and ramps are the only walkable links between
// tiers). Lowland valleys the horde climbs out of, the outer terrace the
// rampart stands on, the district terrace, and the keep's crown.
export const LEDGE = { low: 0.05, out: 1.25, mid: 2.75, top: 4.25, lip: 0.28 };

const ellipse = (a, b) => (t) => 1 / Math.sqrt((Math.cos(t) / a) ** 2 + (Math.sin(t) / b) ** 2);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const angDiff = (a, b) => Math.abs(wrap(a - b));

// `base(t)` is the rim radius in units of R. `open` lists [centre, half-width]
// sectors of walled (non-natural) rim; everything else is closed by `natural`
// (per angle: 'cliff' or 'water'). `gates` sit inside the open sectors.
export const SITE_FORMS = {
  // Greenfall: a forest clearing on a gentle meadow rise. Dense old wood
  // closes the rim; three rides cut through the trees, each walled across
  // with a gate. No cliffs: the ground rolls.
  bastion: {
    label: 'river bend',
    base: (t) => 0.9 + 0.16 * Math.cos(t + 0.4),
    open: [[0, 0.24], [Math.PI, 0.16]],
    gates: [0, Math.PI],
    natural: () => 'water',
    river: { arms: [1.15, -1.15], fords: [0, Math.PI] },
    roll: 0.16,
    wobble: 0.08,
  },
  // Rotmire: a river bend. The river comes in on one flank, wraps the back
  // and leaves on the other; the neck of land facing the hives is walled with
  // two gates, and a ford across the back of the bend carries a postern.
  fort: {
    label: 'river bend',
    base: ellipse(0.92, 1.12),
    open: [[0, 0.52], [2.25, 0.2]],
    gates: [0.28, -0.28, 2.25],
    natural: () => 'water',
    river: { arms: [1.0, -1.0], fords: [2.25] },
    roll: 0.3,
    wobble: 0.1,
  },
  // Five rocky spurs; the gates sit in the valleys between them.
  star: {
    cliffs: true,
    label: 'spurred crag',
    base: (t) => 1.0 + 0.18 * Math.cos(5 * t),
    open: [[Math.PI * 0.2, 0.3], [Math.PI, 0.3], [-Math.PI * 0.2, 0.3]],
    gates: [Math.PI * 0.2, Math.PI, -Math.PI * 0.2],
    natural: () => 'cliff',
    wobble: 0.07,
  },
  // Barrow Hills: a long ridge spur pointing at the enemy. Cliffs down both
  // long flanks; a heavy gate on the nose, a postern at the heel.
  crescent: {
    cliffs: true,
    label: 'ridge spur',
    base: ellipse(1.42, 0.74),
    open: [[0, 0.32], [Math.PI, 0.24]],
    gates: [0, Math.PI],
    natural: () => 'cliff',
    wobble: 0.1,
  },
  // Black Vale: a valley head. The mountain wraps the back and both sides;
  // the valley mouth is walled across with the main gate, and a narrow side
  // gully carries a postern.
  keyhole: {
    cliffs: true,
    label: 'saddle fortress',
    base: (t) => 0.92 + 0.3 * Math.exp(-((wrap(t) / 0.5) ** 2)),
    open: [[0, 0.2], [0.72, 0.16], [Math.PI, 0.18]],
    gates: [0, 0.72, Math.PI],
    natural: () => 'cliff',
    wobble: 0.08,
  },
  // The desert last stand: an octagonal fort on open badlands. No cliffs —
  // the whole ring is wall, and there is a gate on every quarter.
  outpost: {
    cliffs: true,
    ring: true,
    label: 'mesa citadel',
    base: (t) => {
      const k = TAU / 8;
      const a = ((t % k) + k) % k - k / 2;
      return Math.cos(k / 2) / Math.cos(a);
    },
    open: [[0, 0.4], [Math.PI, 0.34]],
    gates: [0, Math.PI],
    natural: () => 'cliff',
    wobble: 0,
  },
};

// Deterministic per-site phases (no Math.random: lockstep).
function hash01(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// The rim description stored on a site by the terrain: { key, facing, R, ph }.
export function makeRim(key, facing, R, seed, siteIdx) {
  const ph = [0, 1, 2].map((k) => hash01((seed | 0) + k * 9176, siteIdx * 31 + k) * TAU);
  return { key, facing, R, ph };
}

export function rimForm(rim) {
  return SITE_FORMS[rim.key] || SITE_FORMS.bastion;
}

// Rim radius (tiles) at local angle t.
export function rimRadius(rim, t) {
  const f = rimForm(rim);
  const w = f.wobble || 0;
  const [a, b, c] = rim.ph;
  const wob = 1 + w * (Math.sin(2 * t + a) * 0.6 + Math.sin(3 * t + b) * 0.4 + Math.sin(5 * t + c) * 0.2);
  return rim.R * f.base(t) * wob;
}

// Is the rim open (walled) at local angle t, or closed by the land?
export function rimOpen(rim, t) {
  const f = rimForm(rim);
  if (f.ring) return true;
  return f.open.some(([c, hw]) => angDiff(t, c) <= hw);
}

export function rimMaxRadius(rim) {
  let m = 0;
  for (let i = 0; i < 96; i++) m = Math.max(m, rimRadius(rim, (i / 96) * TAU - Math.PI));
  return m;
}

// Which way is the war? The base turns its face toward the hives.
export function cityFacing(map, cx, cz) {
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
