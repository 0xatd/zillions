// Presentation height for the five campaign landforms and the four cultures.
// Tiles are never written here: walkability, gates and the lockstep hash stay
// on the layout the sim already built. heightAt reads ledgeH / ledgeW, and the
// renderer turns a step of about one unit into a faceted cliff.
import { TILE, TILE_INFO } from './config.js';
import { SITE_FORMS, rimRadius } from './site-plan.js';
import { activeCulture } from './cultures.js';

const FLOOR = 0.12;
const STEP = 1.0;

function wallRadius(site) {
  const rim = site.rim;
  if (!rim) return 15;
  let m = 0;
  for (let i = 0; i < 24; i++) m = Math.max(m, rimRadius(rim, (i / 24) * Math.PI * 2));
  return m;
}

function setH(map, x, z, h) {
  if (!map.inBounds(x, z)) return;
  const i = map.idx(x, z);
  if (map.swRoad && map.swRoad[i]) return;
  const t = map.tiles[i];
  if (t === TILE.WATER || t === TILE.MOUNTAIN) return;
  map.ledgeH[i] = h;
  map.ledgeW[i] = 1;
}

// Visit tiles in the ring r0..r1 around a site. `pred` may refuse a tile.
function disc(map, site, r0, r1, h, pred) {
  const cx = site.x, cz = site.z;
  const x0 = Math.round(cx), z0 = Math.round(cz);
  const R = Math.ceil(r1) + 1;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = x0 + dx, z = z0 + dz;
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d < r0 || d > r1) continue;
      const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
      if (pred && !pred(x, z, d, a)) continue;
      setH(map, x, z, h);
    }
  }
}

function liftDisc(map, site, r0, r1, add) {
  const cx = site.x, cz = site.z;
  const x0 = Math.round(cx), z0 = Math.round(cz);
  const R = Math.ceil(r1) + 1;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = x0 + dx, z = z0 + dz;
      if (!map.inBounds(x, z)) continue;
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d < r0 || d > r1) continue;
      const i = map.idx(x, z);
      const t = map.tiles[i];
      if (!TILE_INFO[t] || !TILE_INFO[t].walk) continue;
      const base = map.ledgeW[i] > 0 ? map.ledgeH[i] : FLOOR;
      setH(map, x, z, base + add);
    }
  }
}

// Two switchback ramps down a mesa. Each leg is a full terrace, offset
// sideways so the road comes at the gate on a zig-zag instead of a radius.
function ramp(map, site, ang, fromR, toR) {
  const legs = 3;
  const span = (toR - fromR) / legs;
  const c = Math.cos(ang), s = Math.sin(ang);
  const px = -s, pz = c;
  for (let leg = 0; leg < legs; leg++) {
    const h = FLOOR + (2 - leg) * STEP;
    const shift = (leg % 2 ? 1 : -1) * 2.6;
    const r0 = fromR + leg * span - 0.4;
    const r1 = fromR + (leg + 1) * span + 0.6;
    disc(map, site, Math.max(0, r0), r1, h, (x, z) => {
      const dx = x + 0.5 - site.x, dz = z + 0.5 - site.z;
      const along = dx * c + dz * s;
      const side = dx * px + dz * pz;
      return along > fromR - 1.5 && Math.abs(side - shift) < 2.5;
    });
  }
}

function gradeMap(map, site) {
  const rim = site.rim;
  if (!rim) return;
  const form = SITE_FORMS[rim.key] || null;
  const key = rim.key;
  const wallR = wallRadius(site);
  const facing = rim.facing || 0;

  if (key === 'bastion') {
    // Greenfall: a low spur. The grass ward rises one terrace; the woods
    // around it stay on the floor so the bank reads as a river cliff.
    disc(map, site, 0, wallR * 0.95, FLOOR + STEP, (x, z) => map.tileAt(x, z) !== TILE.FOREST);
    return;
  }
  if (key === 'fort' || key === 'star') {
    // Rotmire: the dry mound. Fen water around it is already the moat.
    disc(map, site, 0, wallR * 0.92, FLOOR + STEP);
    return;
  }
  if (key === 'outpost') {
    // Cinder: a two-step mesa. Two gates carry a zig-zag ramp to the floor.
    disc(map, site, 0, wallR * 0.55, FLOOR + 2 * STEP);
    disc(map, site, wallR * 0.55, wallR * 0.9, FLOOR + STEP);
    const gates = form && form.gates.length ? form.gates : [0, Math.PI];
    ramp(map, site, gates[0] + facing, wallR * 0.45, wallR + 8);
    const back = gates[Math.min(2, gates.length - 1)];
    ramp(map, site, back + facing, wallR * 0.45, wallR + 8);
    return;
  }
  if (key === 'crescent' || key === 'keyhole') {
    // Barrow Hills and Black Vale: keep on the crown, wall on the second
    // terrace, a third step down the open flank.
    const flank = key === 'keyhole' ? 11 : 7;
    disc(map, site, 0, 6.2, FLOOR + 3 * STEP);
    disc(map, site, 6.2, wallR * 0.98, FLOOR + 2 * STEP);
    disc(map, site, wallR * 0.98, wallR + flank, FLOOR + STEP);
  }
}

function gradeCulture(map, site, culture) {
  const key = site.rim && site.rim.key;
  if (culture === 'asian') {
    // Two battered plinths under the keep. The dry moat is the cliff already
    // cut by the landform; this only lifts the crown.
    liftDisc(map, site, 3.2, 6.4, 0.45);
    liftDisc(map, site, 0, 3.2, 0.9);
    return;
  }
  if (culture === 'south_american' && (key === 'bastion' || key === 'fort' || key === 'outpost')) {
    // Stacked field terraces down the slope. Cliff maps already step.
    const crown = FLOOR + 3 * STEP;
    const cx = site.x, cz = site.z;
    const R = Math.ceil(wallRadius(site)) + 8;
    const x0 = Math.round(cx), z0 = Math.round(cz);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = x0 + dx, z = z0 + dz;
        if (!map.inBounds(x, z)) continue;
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (d > R) continue;
        const t = map.tiles[map.idx(x, z)];
        if (!TILE_INFO[t] || !TILE_INFO[t].walk) continue;
        const band = Math.min(5, Math.floor(d / 4.2));
        setH(map, x, z, Math.max(FLOOR, crown - band * 0.9));
      }
    }
    return;
  }
  if (culture === 'middle_eastern') {
    // A tell: the crown lifted, and one glacis step around it.
    liftDisc(map, site, 5.5, 10, 0.5);
    liftDisc(map, site, 0, 5.5, 1.0);
  }
}

// Flatten the open floor to one terrace, snap loose crags to cliff blocks,
// then raise each city site into its landform. Authored switchbacks and
// plateau cliff lips are left as the landform pass built them.
export function applySiteGrade(map) {
  if (!map || map.terrainKind === 'labyrinth' || !map.sites) return;
  const N = map.size;
  const h = new Float32Array(N * N);
  const w = new Float32Array(N * N);
  if (map.ledgeH && map.ledgeH.length === N * N) h.set(map.ledgeH);
  if (map.ledgeW && map.ledgeW.length === N * N) w.set(map.ledgeW);
  map.ledgeH = h;
  map.ledgeW = w;

  for (let i = 0; i < N * N; i++) {
    if (map.swRoad && map.swRoad[i]) continue;
    const t = map.tiles[i];
    if (t === TILE.WATER) continue;
    if (t === TILE.MOUNTAIN) {
      if (map.ledgeW[i] >= 0.999) continue;
      const raw = map._naturalHeight(i, t);
      map.ledgeH[i] = 1.6 + Math.round((raw - 1.6) / STEP) * STEP;
      map.ledgeW[i] = 1;
      continue;
    }
    if (map.ledgeW[i] >= 0.999) continue;
    if (t === TILE.FOREST || (TILE_INFO[t] && TILE_INFO[t].walk)) {
      map.ledgeH[i] = FLOOR;
      map.ledgeW[i] = 1;
    }
  }

  const culture = activeCulture();
  for (const site of map.sites) {
    gradeMap(map, site);
    gradeCulture(map, site, culture);
  }
}

export const SITE_FLOOR = FLOOR;
export const SITE_STEP = STEP;
