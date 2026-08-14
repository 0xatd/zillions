// Deterministic Survival foundations.
// These are pre-planned city sites around the Command Center. The normal game
// still owns buildings, resources, pathing, and combat. Plot mode only gives
// players a Thronefall-style "stand here to fund this structure" layer.
import { BUILDINGS, TILE } from './config.js';
import { makeRNG } from './utils.js';

const PLOT_KEYS = {
  tent: { color: 0xf0d68a, icon: 'H', label: 'Hab plot' },
  farm: { color: 0x72d66b, icon: 'F', label: 'Farm plot' },
  sawmill: { color: 0x9a6a3a, icon: 'S', label: 'Sawmill plot' },
  quarry: { color: 0x9fb4c0, icon: 'Q', label: 'Quarry plot' },
  mine: { color: 0xf2c94c, icon: 'M', label: 'Mine plot' },
  mill: { color: 0xb7c7ff, icon: 'E', label: 'Generator plot' },
  tower: { color: 0xff8b6e, icon: 'T', label: 'Tower plot' },
  barracks: { color: 0xe4e8ef, icon: 'B', label: 'Barracks plot' },
  wall: { color: 0xb7a184, icon: 'W', label: 'Wall plot' },
};

export const PLOT_PAY_RADIUS = 2.25;
export const PLOT_PAY_RATE = { gold: 210 };

export function plotInfo(key) {
  return PLOT_KEYS[key] || { color: 0xffffff, icon: '?', label: 'Plot' };
}

export function plotCost(key) {
  const cost = BUILDINGS[key]?.cost || {};
  const coinCost = Math.max(0, Math.ceil((cost.gold || 0) + (cost.wood || 0) * 0.9 + (cost.stone || 0) * 1.35));
  return {
    gold: coinCost,
    wood: 0,
    stone: 0,
  };
}

export function plotPaidTotal(plot) {
  const cost = plotCost(plot.key);
  const need = cost.gold + cost.wood + cost.stone;
  if (!need) return 1;
  return Math.min(1, ((plot.paid.gold || 0) + (plot.paid.wood || 0) + (plot.paid.stone || 0)) / need);
}

export function plotComplete(plot) {
  const cost = plotCost(plot.key);
  return (plot.paid.gold || 0) >= cost.gold &&
    (plot.paid.wood || 0) >= cost.wood &&
    (plot.paid.stone || 0) >= cost.stone;
}

export function plotCostText(plot) {
  const cost = plotCost(plot.key);
  const left = Math.max(0, Math.ceil(cost.gold - (plot.paid.gold || 0)));
  return left ? `${left} coins` : 'ready';
}

export function generatePlots(map) {
  const N = map.size;
  const c = N / 2;
  const rng = makeRNG(map.seed * 17 + 404);
  const plots = [];
  const taken = new Set();

  const reserve = (x, z, size, pad = 1) => {
    for (let dz = -pad; dz < size + pad; dz++) {
      for (let dx = -pad; dx < size + pad; dx++) taken.add((z + dz) * N + (x + dx));
    }
  };
  const free = (x, z, size, key) => {
    if (x < 2 || z < 2 || x + size > N - 2 || z + size > N - 2) return false;
    for (let dz = 0; dz < size; dz++) {
      for (let dx = 0; dx < size; dx++) {
        const tx = x + dx, tz = z + dz;
        if (!map.isBuildable(tx, tz)) return false;
        if (taken.has(tz * N + tx)) return false;
      }
    }
    if (key === 'farm') {
      for (let dz = 0; dz < size; dz++) {
        for (let dx = 0; dx < size; dx++) if (map.tileAt(x + dx, z + dz) !== TILE.GRASS) return false;
      }
    }
    if (key === 'sawmill') {
      const cx = x + (size >> 1), cz = z + (size >> 1);
      if (map.countNearby(cx, cz, 4, TILE.FOREST) < 4) return false;
    }
    if (key === 'mine' || key === 'quarry') {
      const want = key === 'mine' ? TILE.GOLDORE : TILE.STONEORE;
      let found = false;
      for (let dz = 0; dz < size; dz++) {
        for (let dx = 0; dx < size; dx++) if (map.tileAt(x + dx, z + dz) === want) found = true;
      }
      if (!found) return false;
    }
    return true;
  };
  const findSpot = (x, z, key, maxR = 8) => {
    const size = BUILDINGS[key].size;
    x = Math.round(x);
    z = Math.round(z);
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = x + dx, nz = z + dz;
          if (free(nx, nz, size, key)) return [nx, nz];
        }
      }
    }
    return null;
  };

  let nextId = 1;
  const add = (key, x, z, extra = {}) => {
    const size = BUILDINGS[key].size;
    const spot = findSpot(x, z, key);
    if (!spot) return null;
    const plot = {
      id: nextId++,
      key,
      x: spot[0],
      z: spot[1],
      size,
      cx: spot[0] + size / 2,
      cz: spot[1] + size / 2,
      built: false,
      paid: { gold: 0, wood: 0, stone: 0 },
      ...extra,
    };
    reserve(plot.x, plot.z, size);
    plots.push(plot);
    return plot;
  };

  // Reserve the already-built Command Center and its plaza.
  reserve(c - 5, c - 5, 10, 0);

  const ring = (r, ang, off = 0) => [
    c + Math.cos(ang + off) * r,
    c + Math.sin(ang + off) * r,
  ];

  // Close economy ring.
  for (let i = 0; i < 8; i++) {
    const [x, z] = ring(7.2, (i / 8) * Math.PI * 2, Math.PI / 8);
    add('tent', x, z);
  }
  for (let i = 0; i < 4; i++) {
    const [x, z] = ring(12.0, (i / 4) * Math.PI * 2, Math.PI / 4);
    add('farm', x, z);
  }
  add('mill', ...ring(10.8, -Math.PI / 2));
  add('mill', ...ring(10.8, Math.PI / 2));
  add('barracks', ...ring(9.6, Math.PI / 2));
  add('sawmill', ...ring(14.0, Math.PI));

  // Defense ring.
  for (let i = 0; i < 8; i++) {
    const [x, z] = ring(15.2, (i / 8) * Math.PI * 2);
    add('tower', x, z);
  }

  // Wall foundations as short buildable arcs, with gaps for gates.
  const wallR = 18.0;
  const gateAngles = new Set([0, 6, 12, 18]);
  for (let i = 0; i < 24; i++) {
    if (gateAngles.has(i)) continue;
    const [x, z] = ring(wallR, (i / 24) * Math.PI * 2);
    add('wall', x, z, { wallRing: true });
  }

  // Resource-risk plots on real deposits, nearest first.
  for (const cluster of oreClusters(map, TILE.GOLDORE, c).slice(0, 2)) {
    const mine = add('mine', cluster.x - 1, cluster.z - 1);
    if (mine) add('tower', mine.x + 4, mine.z);
  }
  for (const cluster of oreClusters(map, TILE.STONEORE, c).slice(0, 2)) {
    add('quarry', cluster.x - 1, cluster.z - 1);
  }

  // A couple of greedy far farms outside the wall.
  for (let i = 0; i < 2; i++) {
    const [x, z] = ring(23 + rng() * 4, rng() * Math.PI * 2);
    add('farm', x, z);
  }

  return plots;
}

function oreClusters(map, tile, c) {
  const N = map.size;
  const ore = [];
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) if (map.tiles[z * N + x] === tile) ore.push([x, z]);
  }
  const clusters = [];
  const used = new Set();
  for (let i = 0; i < ore.length; i++) {
    if (used.has(i)) continue;
    const stack = [i];
    const members = [];
    used.add(i);
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
    if (d > 13 && d < 46) clusters.push({ x, z, d, n: members.length });
  }
  return clusters.sort((a, b) => a.d - b.d || b.n - a.n);
}
