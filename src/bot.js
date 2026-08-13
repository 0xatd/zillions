// The Overseer: an AI governor that runs the colony's economy so the player
// can focus on their hero. Builds power, food, housing, income, then defense.
// One action every few seconds — deliberately unhurried, always leaves a gold
// reserve so the player can train troops.
import { BUILDINGS, TILE } from './config.js';

const RESERVE = 120;

export class Overseer {
  constructor(game) {
    this.g = game;
    this.t = 4;
    this.ring = null;
    this.greeted = false;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 2.4;
    const g = this.g;
    if (!g.hq || !g.hq.alive) return;
    if (!this.greeted) {
      this.greeted = true;
      g.msg('🤖 Overseer online — I\'ll run the economy and defenses. You do the killing.', 'info');
    }

    const e = g.eco;
    let spendable = g.res.gold - RESERVE;

    // A standing army, trained alongside construction (not instead of it).
    if (this._count('barracks')) {
      const army = g.units.filter((u) => !u.hero && !u.turret && !u.summon && !u.dead).length;
      if (army < 3 + g.day * 2 && spendable > 250) {
        const kind = g.day < 3 ? 'ranger' : army % 3 === 2 && spendable > 500 ? 'sniper' : 'soldier';
        if (g.trainUnit(kind)) spendable = g.res.gold - RESERVE;
      }
    }

    // Priority ladder — one action per tick. Income snowball first, cheap
    // walls dead last (they used to starve the whole economy).
    if (e.energyProd - e.energyUse < 2 && this._build('mill', 5, 14)) return;
    if (e.food < 1 && spendable > 0 && this._build('farm', 5, 16)) return;
    if (e.popCap - e.workersUsed < 2 && spendable > 100 && this._build('tent', 5, 14)) return;
    if (this._count('sawmill') < 2 && spendable > 150 && this._build('sawmill', 5, 26)) return;
    // Tents are the gold engine — keep stacking them as income lags the day.
    if (e.gold < 6 + g.day * 1.5 && spendable > 120 && this._build('tent', 5, 16)) return;
    if (!this._count('barracks') && spendable > 320 && this._build('barracks', 5, 14)) return;
    if (!this._count('quarry') && spendable > 220 && this._buildOnOre('quarry')) return;

    const towers = this._count('tower');
    if (towers < Math.min(16, 2 + Math.floor(g.day * 1.7)) && spendable > 230 && this._buildTower()) return;

    const mines = this._count('mine');
    if (mines < 2 && g.day >= 2 + mines * 2 && spendable > 380 && this._buildOnOre('mine')) return;

    if (towers >= 4 && g.res.wood > 150 && spendable > 250 && this._buildWalls(4)) return;

    // Spare cash → keep growing.
    if (spendable > 900) this._build('tent', 5, 16);
  }

  _count(key) {
    let n = 0;
    for (const b of this.g.buildings) if (b.key === key && b.alive) n++;
    return n;
  }

  _build(key, rMin, rMax) {
    const g = this.g;
    const c = { x: g.hq.cx, z: g.hq.cz };
    const size = BUILDINGS[key].size;
    for (let r = rMin; r <= rMax; r++) {
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2 + r * 0.37;
        const x = Math.round(c.x + Math.cos(a) * r - size / 2);
        const z = Math.round(c.z + Math.sin(a) * r - size / 2);
        if (g.canPlace(key, x, z).ok) { g.place(key, x, z); return true; }
      }
    }
    return false;
  }

  _buildOnOre(key) {
    const g = this.g, map = g.map;
    const want = key === 'mine' ? TILE.GOLDORE : TILE.STONEORE;
    const c = { x: g.hq.cx, z: g.hq.cz };
    let best = null, bd = Infinity;
    for (let z = 1; z < map.size - 3; z++) {
      for (let x = 1; x < map.size - 3; x++) {
        if (map.tiles[z * map.size + x] !== want) continue;
        const d = (x - c.x) ** 2 + (z - c.z) ** 2;
        if (d < bd && g.canPlace(key, x - 1, z - 1).ok) { bd = d; best = [x - 1, z - 1]; }
      }
    }
    // Don't chase deposits too far from the walls to defend.
    if (best && bd < 42 * 42) { g.place(key, best[0], best[1]); return true; }
    return false;
  }

  _buildTower() {
    const g = this.g;
    const c = { x: g.hq.cx, z: g.hq.cz };
    for (const r of [10, 13, 16]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + (r === 13 ? 0.4 : 0);
        const x = Math.round(c.x + Math.cos(a) * r) - 1;
        const z = Math.round(c.z + Math.sin(a) * r) - 1;
        let crowded = false;
        for (const b of g.buildings) {
          if (b.key === 'tower' && b.alive && (b.cx - (x + 1)) ** 2 + (b.cz - (z + 1)) ** 2 < 25) { crowded = true; break; }
        }
        if (crowded) continue;
        if (g.canPlace('tower', x, z).ok) { g.place('tower', x, z); return true; }
      }
    }
    return false;
  }

  _buildWalls(maxSegs) {
    const g = this.g;
    if (!this.ring) {
      const c = { x: Math.round(g.hq.cx), z: Math.round(g.hq.cz) }, R = 15;
      this.ring = [];
      for (let x = -R; x <= R; x++) this.ring.push([c.x + x, c.z - R], [c.x + x, c.z + R]);
      for (let z = -R + 1; z < R; z++) this.ring.push([c.x - R, c.z + z], [c.x + R, c.z + z]);
    }
    let placed = 0;
    for (const [x, z] of this.ring) {
      if (placed >= maxSegs) break;
      if (g.res.wood < 20 || g.res.gold < RESERVE + 30) break;
      if (g.canPlace('wall', x, z).ok) { g.place('wall', x, z); placed++; }
    }
    return placed > 0;
  }
}
