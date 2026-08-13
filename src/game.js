// Core simulation: economy, buildings, zombies, units, hordes, win/lose.
// Pure logic — rendering/audio consume `game.events` each frame.
import {
  BUILDINGS, UNITS, ZOMBIES, WAVES, TILE, DAY_LENGTH, FINAL_DAY,
  START_RESOURCES, ZOMBIE_CAP, UNIT_CAP, DIFFICULTY,
  HEROES, HERO_MAX_LEVEL, XP_RADIUS, xpForLevel, rankReqLevel, ULT_REQ_LEVEL, DROPS,
} from './config.js';
import { FlowField, findPath } from './flowfield.js';
import { clamp, dist2, makeRNG } from './utils.js';

const IDLE = 0, WANDER = 1, AGGRO = 2;

let nextId = 1;

export class Game {
  constructor(map, difficulty = 'normal', heroKey = 'scott') {
    this.map = map;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.rng = makeRNG(999);

    this.res = { ...START_RESOURCES };
    this.buildings = [];
    this.units = [];
    this.zombies = [];
    this.occ = new Int32Array(map.size * map.size); // building id + 1
    this.flow = new FlowField(map);
    this.flowDirty = true;
    this.flowTimer = 0;

    this.time = 0;               // total sim seconds
    this.over = false;
    this.won = false;
    this.finalSpawned = false;
    this.wavesDone = new Set();
    this.ambientTimer = 20;

    this.events = [];            // consumed by renderer/audio each frame
    this.messages = [];          // consumed by UI

    this.stats = { kills: 0, built: 0, lost: 0 };

    this.eco = { energyProd: 0, energyUse: 0, workersUsed: 0, popCap: 0, gold: 0, wood: 0, stone: 0, food: 0 };
    this.starving = false;

    this.heroKey = heroKey;
    this.hero = null;
    this.pickups = [];

    this._setupStart();
  }

  // ---------- setup ----------

  _setupStart() {
    const c = (this.map.size / 2) | 0;
    this.hq = this._placeRaw('hq', c - 2, c - 2);
    for (let i = 0; i < 3; i++) this._spawnUnit('ranger', c - 4 + i * 1.5, c + 3);
    this._spawnUnit('soldier', c + 3, c + 3);
    this._spawnHero(this.heroKey, c, c + 4);
    this._scatterInitialZombies();
    this.recalcEconomy();
    this.msg('Colony founded on cursed ground. Raise hab-tents, farms and generators — the dead are coming.', 'info');
  }

  _scatterInitialZombies() {
    const N = this.map.size, c = N / 2;
    const count = Math.round(150 * this.diff.ambient);
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 30) {
      const x = 2 + this.rng() * (N - 4), z = 2 + this.rng() * (N - 4);
      if (Math.hypot(x - c, z - c) < 20) continue;
      if (!this.map.isWalkable(x | 0, z | 0)) continue;
      const type = this.rng() < 0.92 ? 'walker' : 'runner';
      this._spawnZombie(type, x, z, false);
      placed++;
    }
  }

  // ---------- helpers ----------

  msg(text, kind = 'info') { this.messages.push({ text, kind, t: this.time }); }
  emit(e) { this.events.push(e); }

  get day() { return Math.floor(this.time / DAY_LENGTH) + 1; }
  get dayFrac() { return (this.time % DAY_LENGTH) / DAY_LENGTH; }
  get isNight() { return this.dayFrac > 0.72; }

  nextWave() {
    for (const w of WAVES) {
      if (!this.wavesDone.has(w.day)) return { ...w, at: (w.day - 1) * DAY_LENGTH };
    }
    return null;
  }

  // ---------- economy ----------

  recalcEconomy() {
    const e = { energyProd: 0, energyUse: 0, workersUsed: 0, popCap: 0, gold: 0, wood: 0, stone: 0, food: 0 };
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const d = b.def;
      if (d.energy > 0) e.energyProd += d.energy; else e.energyUse += -d.energy;
      e.workersUsed += d.workers || 0;
      e.popCap += d.pop || 0;
      e.gold += d.gold || 0;
      e.wood += d.wood || 0;
      e.stone += d.stone || 0;
      e.food += d.food || 0;
    }
    this.eco = e;
  }

  canPlace(key, x, z) {
    const d = BUILDINGS[key];
    const s = d.size;
    if (x < 0 || z < 0 || x + s > this.map.size || z + s > this.map.size) return { ok: false, why: 'Out of bounds' };
    for (let dz = 0; dz < s; dz++) {
      for (let dx = 0; dx < s; dx++) {
        if (!this.map.isBuildable(x + dx, z + dz)) return { ok: false, why: 'Blocked terrain' };
        if (this.occ[(z + dz) * this.map.size + (x + dx)] > 0) return { ok: false, why: 'Occupied' };
      }
    }
    if (d.needs === 'grass') {
      for (let dz = 0; dz < s; dz++) for (let dx = 0; dx < s; dx++) {
        if (this.map.tileAt(x + dx, z + dz) !== TILE.GRASS) return { ok: false, why: 'Needs open grassland' };
      }
    } else if (d.needs === 'forest') {
      const cx = x + (s >> 1), cz = z + (s >> 1);
      if (this.map.countNearby(cx, cz, 4, TILE.FOREST) < 4) return { ok: false, why: 'Must be near a forest' };
    } else if (d.needs === 'goldore' || d.needs === 'stoneore') {
      const want = d.needs === 'goldore' ? TILE.GOLDORE : TILE.STONEORE;
      let found = false;
      for (let dz = 0; dz < s; dz++) for (let dx = 0; dx < s; dx++) {
        if (this.map.tileAt(x + dx, z + dz) === want) found = true;
      }
      if (!found) return { ok: false, why: d.needs === 'goldore' ? 'Must cover a gold deposit' : 'Must cover a stone deposit' };
    }
    if (this.res.gold < d.cost.gold || this.res.wood < d.cost.wood || this.res.stone < (d.cost.stone || 0)) {
      return { ok: false, why: 'Not enough resources' };
    }
    if ((d.workers || 0) > 0 && this.eco.workersUsed + d.workers > this.eco.popCap) {
      return { ok: false, why: 'Not enough colonists — build hab-tents' };
    }
    if (d.energy < 0 && this.eco.energyProd - this.eco.energyUse + d.energy < 0) {
      return { ok: false, why: 'Not enough energy — build generators' };
    }
    return { ok: true };
  }

  place(key, x, z) {
    const chk = this.canPlace(key, x, z);
    if (!chk.ok) { this.emit({ type: 'deny' }); this.msg(chk.why, 'warn'); return null; }
    const d = BUILDINGS[key];
    this.res.gold -= d.cost.gold; this.res.wood -= d.cost.wood; this.res.stone -= d.cost.stone || 0;
    const b = this._placeRaw(key, x, z);
    this.stats.built++;
    this.emit({ type: 'build', key, x: x + d.size / 2, z: z + d.size / 2 });
    return b;
  }

  _placeRaw(key, x, z) {
    const d = BUILDINGS[key];
    const b = {
      id: nextId++, key, def: d, x, z, size: d.size,
      cx: x + d.size / 2, cz: z + d.size / 2,
      hp: d.hp, maxHp: d.hp, alive: true, cooldown: 0,
    };
    this.buildings.push(b);
    for (let dz = 0; dz < d.size; dz++) for (let dx = 0; dx < d.size; dx++) {
      this.occ[(z + dz) * this.map.size + (x + dx)] = b.id;
    }
    this.flowDirty = true;
    this.recalcEconomy();
    return b;
  }

  demolish(b) {
    if (!b.alive || b.key === 'hq') return;
    this._destroyBuilding(b, false);
    this.res.gold += Math.floor(b.def.cost.gold * 0.5);
    this.res.wood += Math.floor(b.def.cost.wood * 0.5);
    this.res.stone += Math.floor((b.def.cost.stone || 0) * 0.5);
    this.emit({ type: 'demolish', x: b.cx, z: b.cz });
  }

  _destroyBuilding(b, byZombie) {
    b.alive = false;
    b.hp = 0;
    for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) {
      const i = (b.z + dz) * this.map.size + (b.x + dx);
      if (this.occ[i] === b.id) this.occ[i] = 0;
    }
    this.buildings = this.buildings.filter((o) => o !== b);
    this.flowDirty = true;
    this.recalcEconomy();
    if (byZombie) {
      this.stats.lost++;
      this.emit({ type: 'bdestroyed', x: b.cx, z: b.cz });
      if (b.key === 'tent') {
        // Infection! The residents rise.
        for (let i = 0; i < b.def.pop; i++) {
          this._spawnZombie('walker', b.cx + (this.rng() - 0.5) * 2, b.cz + (this.rng() - 0.5) * 2, true);
        }
        this.emit({ type: 'infection', x: b.cx, z: b.cz });
        this.msg('A hab-tent has fallen — its residents have joined the horde!', 'bad');
      } else if (b.key === 'hq') {
        this._gameOver(false);
      } else {
        this.msg(`${b.def.name} destroyed!`, 'bad');
      }
    }
  }

  // ---------- units ----------

  trainUnit(key) {
    const d = UNITS[key];
    const barracks = this.buildings.find((b) => b.key === 'barracks' && b.alive);
    if (!barracks) { this.msg('Build a Barracks first.', 'warn'); this.emit({ type: 'deny' }); return null; }
    if (this.units.length >= UNIT_CAP) { this.msg('Unit limit reached.', 'warn'); this.emit({ type: 'deny' }); return null; }
    if (this.res.gold < d.cost) { this.msg('Not enough gold.', 'warn'); this.emit({ type: 'deny' }); return null; }
    this.res.gold -= d.cost;
    const u = this._spawnUnit(key, barracks.cx + 2 + this.rng(), barracks.cz + 2 + this.rng());
    this.emit({ type: 'train' });
    return u;
  }

  _spawnUnit(key, x, z) {
    const d = UNITS[key];
    const u = {
      id: nextId++, key, def: d, x, z, hp: d.hp, maxHp: d.hp,
      path: null, pathI: 0, cooldown: 0, target: null, selected: false,
      facing: 0, holdX: x, holdZ: z, retargetT: 0,
    };
    this.units.push(u);
    return u;
  }

  // ---------- hero ----------

  _spawnHero(key, x, z) {
    const d = HEROES[key];
    const h = {
      id: nextId++, key, def: d, hero: true, x, z,
      hp: d.hp, maxHp: d.hp,
      path: null, pathI: 0, cooldown: 0, target: null, selected: false,
      facing: 0, retargetT: 0,
      level: 1, xp: 0, points: 1,
      abil: d.abilities.map(() => ({ rank: 0, cd: 0 })),
      buffT: 0, buffMult: 1, hasteT: 0, hasteMult: 1,
      reviveT: 0,
    };
    this.units.push(h);
    this.hero = h;
    return h;
  }

  heroDmg(h) {
    return h.def.dmg + h.def.levelDmg * (h.level - 1);
  }

  addXp(amount) {
    const h = this.hero;
    if (!h || h.dead || h.level >= HERO_MAX_LEVEL) return;
    h.xp += amount;
    while (h.level < HERO_MAX_LEVEL && h.xp >= xpForLevel(h.level)) {
      h.xp -= xpForLevel(h.level);
      h.level++;
      h.points++;
      h.maxHp = h.def.hp + h.def.levelHp * (h.level - 1);
      h.hp = h.maxHp; // WC3-style full heal on level up
      this.emit({ type: 'levelup', x: h.x, z: h.z });
      this.msg(`⭐ ${h.def.name} reached level ${h.level}!`, 'info');
    }
    if (h.level >= HERO_MAX_LEVEL) h.xp = 0;
  }

  canLearn(i) {
    const h = this.hero;
    if (!h || h.points <= 0) return false;
    const ab = h.def.abilities[i];
    const st = h.abil[i];
    if (st.rank >= ab.maxRank) return false;
    if (ab.ult) return h.level >= ULT_REQ_LEVEL;
    return h.level >= rankReqLevel(st.rank + 1);
  }

  learnAbility(i) {
    if (!this.canLearn(i)) { this.emit({ type: 'deny' }); return; }
    const h = this.hero;
    h.abil[i].rank++;
    h.points--;
    this.emit({ type: 'learn' });
    this.msg(`${h.def.abilities[i].icon} ${h.def.abilities[i].name} — rank ${h.abil[i].rank}`, 'info');
  }

  castAbility(i) {
    const h = this.hero;
    if (!h || h.dead) return;
    const ab = h.def.abilities[i];
    const st = h.abil[i];
    if (ab.passive) return;
    if (st.rank === 0 || st.cd > 0) { this.emit({ type: 'deny' }); return; }
    const r = st.rank - 1;
    st.cd = ab.cd;

    switch (ab.cast) {
      case 'aoeDmg': {
        const r2 = ab.radius * ab.radius;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          if (dist2(h.x, h.z, zb.x, zb.z) <= r2) {
            if (ab.stun) zb.stunT = Math.max(zb.stunT || 0, ab.stun[r]);
            if (ab.slow) { zb.slowT = ab.slowDur; zb.slowMul = ab.slow; }
            this.damageZombie(zb, ab.dmg[r]);
          }
        }
        break;
      }
      case 'volley': {
        const r2 = ab.radius * ab.radius;
        const targets = this.zombies
          .filter((zb) => !zb.dead && dist2(h.x, h.z, zb.x, zb.z) <= r2)
          .sort((a, b) => dist2(h.x, h.z, a.x, a.z) - dist2(h.x, h.z, b.x, b.z))
          .slice(0, ab.count[r]);
        for (const zb of targets) {
          this.emit({ type: 'shot', kind: 'ranger', fx: h.x, fz: h.z, tx: zb.x, tz: zb.z, fy: 0.9 });
          this.damageZombie(zb, ab.dmg[r]);
        }
        break;
      }
      case 'buff': {
        const r2 = ab.radius * ab.radius;
        for (const u of this.units) {
          if (u.dead || u.turret) continue;
          if (dist2(h.x, h.z, u.x, u.z) <= r2) { u.buffT = ab.dur; u.buffMult = ab.mult[r]; }
        }
        break;
      }
      case 'haste':
        h.hasteT = ab.dur[r];
        h.hasteMult = ab.mult[r];
        break;
      case 'towerBuff': {
        const r2 = ab.radius * ab.radius;
        for (const b of this.buildings) {
          if (!b.alive || b.key !== 'tower') continue;
          if (dist2(h.x, h.z, b.cx, b.cz) <= r2) { b.rofBuffT = ab.dur; b.rofBuffMult = ab.mult[r]; }
        }
        break;
      }
      case 'repair': {
        const r2 = ab.radius * ab.radius;
        for (const b of this.buildings) {
          if (!b.alive) continue;
          if (dist2(h.x, h.z, b.cx, b.cz) <= r2) b.hp = Math.min(b.maxHp, b.hp + ab.amount[r]);
        }
        break;
      }
      case 'turret': {
        const t = {
          id: nextId++, key: 'turret', turret: true, hero: false,
          def: { name: 'Auto-Turret', dmg: ab.dmg, range: ab.range, rof: ab.rof, speed: 0, noise: 8, color: 0x58b7c9 },
          x: h.x + 0.8, z: h.z, hp: ab.hp, maxHp: ab.hp,
          path: null, pathI: 0, cooldown: 0, target: null, selected: false,
          facing: 0, retargetT: 0, life: ab.life,
        };
        this.units.push(t);
        this.emit({ type: 'turret', x: t.x, z: t.z });
        break;
      }
    }
    this.wakeZombies(h.x, h.z, 10);
    this.emit({ type: 'cast', x: h.x, z: h.z, radius: ab.radius || 3, icon: ab.icon, key: ab.key });
  }

  _updateHero(dt) {
    const h = this.hero;
    if (!h) return;
    for (const st of h.abil) if (st.cd > 0) st.cd -= dt;
    if (h.dead) {
      h.reviveT -= dt;
      if (h.reviveT <= 0) {
        h.dead = false;
        h.hp = h.maxHp;
        h.x = this.hq.cx + 2.5;
        h.z = this.hq.cz + 2.5;
        h.path = null; h.target = null;
        this.units.push(h);
        this.emit({ type: 'revive', x: h.x, z: h.z });
        this.msg(`${h.def.icon} ${h.def.name} has returned to the fight!`, 'info');
      }
      return;
    }
    // Regen.
    const regen = h.def.regen + 0.25 * (h.level - 1);
    h.hp = Math.min(h.maxHp, h.hp + regen * dt);
    if (h.hasteT > 0) h.hasteT -= dt;
    // Toxin Arrows-style passives are applied at attack time in _updateUnits.
  }

  _updatePickups(dt) {
    for (const p of this.pickups) {
      p.t -= dt;
      if (p.t <= 0) { p.gone = true; continue; }
      for (const u of this.units) {
        if (u.dead || u.turret) continue;
        if (dist2(u.x, u.z, p.x, p.z) < 1.1) {
          p.gone = true;
          if (p.kind === 'gold') {
            this.res.gold += p.amount;
            this.msg(`💰 Scavenged ${p.amount} gold!`, 'info');
          } else {
            u.hp = Math.min(u.maxHp, u.hp + DROPS.healAmount);
            this.msg('❤️ Medkit recovered!', 'info');
          }
          this.emit({ type: 'pickup', x: p.x, z: p.z, kind: p.kind });
          break;
        }
      }
    }
    if (this.pickups.some((p) => p.gone)) this.pickups = this.pickups.filter((p) => !p.gone);
  }

  orderMove(units, tx, tz) {
    // Fan destinations out a bit so groups don't stack on one point.
    let i = 0;
    for (const u of units) {
      if (u.turret || u.dead) continue;
      const ang = (i / Math.max(1, units.length)) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.9 + 0.55 * Math.floor((i - 1) / 6);
      const dx = tx + Math.cos(ang) * r, dz = tz + Math.sin(ang) * r;
      const p = findPath(this.map, this.occ, u.x, u.z, dx, dz);
      if (p) { u.path = p; u.pathI = 0; u.target = null; }
      i++;
    }
    if (units.length) this.emit({ type: 'move' });
  }

  // ---------- zombies ----------

  _spawnZombie(type, x, z, aggro, wave = false) {
    if (this.zombies.length >= ZOMBIE_CAP) return null;
    const d = ZOMBIES[type];
    const zb = {
      id: nextId++, type, def: d, x, z,
      hp: d.hp * (wave ? 1 : 1), maxHp: d.hp,
      state: aggro ? AGGRO : IDLE,
      dirX: 0, dirZ: 0, timer: this.rng() * 4,
      atkT: 0, targetU: null, phase: this.rng() * Math.PI * 2,
      wave, hitFlash: 0,
    };
    this.zombies.push(zb);
    return zb;
  }

  wakeZombies(x, z, r) {
    const r2 = r * r;
    for (const zb of this.zombies) {
      if (zb.state === AGGRO) continue;
      if (dist2(zb.x, zb.z, x, z) < r2) zb.state = AGGRO;
    }
  }

  _spawnHorde(size, edges, types) {
    const N = this.map.size;
    let spawned = 0, guard = 0;
    const pickType = () => {
      let roll = this.rng(), acc = 0;
      for (const [t, p] of Object.entries(types)) { acc += p; if (roll <= acc) return t; }
      return 'walker';
    };
    while (spawned < size && guard++ < size * 30) {
      const edge = edges[(this.rng() * edges.length) | 0];
      let x, z;
      const along = this.rng() * (N - 4) + 2;
      const depth = this.rng() * 5;
      if (edge === 0) { x = along; z = 1 + depth; }
      else if (edge === 1) { x = N - 2 - depth; z = along; }
      else if (edge === 2) { x = along; z = N - 2 - depth; }
      else { x = 1 + depth; z = along; }
      if (!this.map.isWalkable(x | 0, z | 0)) continue;
      // Only spawn where the colony is actually reachable, so hordes always
      // arrive (and the final wave can always be cleared).
      if (this.flow.distAt(x | 0, z | 0) === Infinity && guard < size * 25) continue;
      if (this._spawnZombie(pickType(), x, z, true, true)) spawned++;
    }
    return spawned;
  }

  // ---------- damage ----------

  damageZombie(zb, dmg, sx, sz) {
    if (zb.hp <= 0) return;
    zb.hp -= dmg;
    zb.hitFlash = 0.15;
    if (zb.state !== AGGRO) zb.state = AGGRO;
    if (zb.hp <= 0) {
      zb.dead = true;
      this.stats.kills++;
      this.emit({ type: 'zdeath', x: zb.x, z: zb.z, big: zb.type === 'brute' });
      // WC3-style shared XP for kills near the hero.
      const h = this.hero;
      if (h && !h.dead && dist2(h.x, h.z, zb.x, zb.z) < XP_RADIUS * XP_RADIUS) {
        this.addXp(zb.def.score * 8);
      }
      // Creep-style loot drops.
      if (zb.type === 'brute') {
        const kind = this.rng() < 0.6 ? 'gold' : 'heal';
        this.pickups.push({ id: nextId++, x: zb.x, z: zb.z, kind, amount: DROPS.bruteGold, t: DROPS.life });
      } else if (this.rng() < DROPS.smallChance) {
        this.pickups.push({ id: nextId++, x: zb.x, z: zb.z, kind: 'gold', amount: DROPS.smallGold, t: DROPS.life });
      }
    }
  }

  _damageBuilding(b, dmg) {
    if (!b.alive) return;
    b.hp -= dmg;
    this.emit({ type: 'bhit', x: b.cx, z: b.cz });
    if (b.hp <= 0) this._destroyBuilding(b, true);
  }

  _damageUnit(u, dmg) {
    u.hp -= dmg;
    if (u.hp <= 0) {
      u.dead = true;
      this.emit({ type: 'udeath', x: u.x, z: u.z });
      if (u.hero) {
        u.reviveT = 18 + 4 * u.level;
        this.emit({ type: 'herodown' });
        this.msg(`☠️ ${u.def.name} has fallen! Reviving at the Command Center in ${Math.round(u.reviveT)}s…`, 'bad');
      } else if (!u.turret) {
        this.msg(`A ${u.def.name} has been devoured!`, 'bad');
      }
    }
  }

  _gameOver(won) {
    if (this.over) return;
    this.over = true;
    this.won = won;
    this.emit({ type: won ? 'victory' : 'defeat' });
  }

  // ---------- main update ----------

  update(dt) {
    if (this.over) return;
    const prevTime = this.time;
    this.time += dt;

    this._updateWaves(prevTime);
    this._updateEconomy(dt);
    this._updateFlow(dt);
    this._updateZombies(dt);
    this._updateUnits(dt);
    this._updateTowers(dt);
    this._updateHero(dt);
    this._updatePickups(dt);
    this._cleanup();
    this._checkEnd();
  }

  _updateWaves(prevTime) {
    for (const w of WAVES) {
      const at = (w.day - 1) * DAY_LENGTH;
      if (prevTime < at && this.time >= at && !this.wavesDone.has(w.day)) {
        this.wavesDone.add(w.day);
        const size = Math.round(w.size * this.diff.mult);
        const edges = w.final ? [0, 1, 2, 3] : [(this.rng() * 4) | 0];
        this._spawnHorde(size, edges, w.types);
        const dirName = w.final ? 'ALL DIRECTIONS' : ['the NORTH', 'the EAST', 'the SOUTH', 'the WEST'][edges[0]];
        this.msg(w.final
          ? `☠️ THE FINAL HORDE HAS ARRIVED FROM ${dirName}! Survive this and the land is yours!`
          : `⚠️ A horde of ${size} approaches from ${dirName}!`, 'bad');
        this.emit({ type: 'horde', final: !!w.final });
        if (w.final) this.finalSpawned = true;
      }
    }
    // Ambient night stragglers.
    this.ambientTimer -= 1 / 30;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 22 + this.rng() * 15;
      if (this.isNight && !this.finalSpawned) {
        const n = Math.round((2 + this.rng() * 4) * this.diff.ambient);
        this._spawnHorde(n, [(this.rng() * 4) | 0], { walker: 0.9, runner: 0.1 });
      }
    }
  }

  _updateEconomy(dt) {
    const e = this.eco;
    this.starving = e.food < 0;
    const goldRate = this.starving ? Math.min(e.gold, 0) : e.gold;
    this.res.gold = Math.max(0, this.res.gold + goldRate * dt);
    this.res.wood += e.wood * dt;
    this.res.stone += e.stone * dt;
  }

  _updateFlow(dt) {
    this.flowTimer -= dt;
    if (this.flowDirty || this.flowTimer <= 0) {
      const sources = [];
      for (const b of this.buildings) {
        if (!b.alive || b.key === 'wall') continue;
        for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) {
          sources.push((b.z + dz) * this.map.size + (b.x + dx));
        }
      }
      this.flow.compute(this.occ, sources);
      this.flowDirty = false;
      this.flowTimer = 2.5;
    }
  }

  _updateZombies(dt) {
    const N = this.map.size;
    const nightMul = this.isNight ? 1.25 : 1;

    // Cheap separation: shove apart zombies sharing a tile.
    if (!this._sepMap) this._sepMap = new Map();
    const sep = this._sepMap;
    sep.clear();
    for (const zb of this.zombies) {
      if (zb.dead) continue;
      const k = ((zb.z | 0) * N + (zb.x | 0));
      const arr = sep.get(k);
      if (arr) arr.push(zb); else sep.set(k, [zb]);
    }
    for (const arr of sep.values()) {
      if (arr.length < 2) continue;
      for (let i = 1; i < arr.length; i++) {
        const a = arr[i - 1], b = arr[i];
        let dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 0.01;
        if (d < 0.42) {
          const push = (0.42 - d) * 0.5;
          dx /= d; dz /= d;
          // Never shove a zombie onto unwalkable ground — dense hordes used
          // to ferry each other across narrow water onto unreachable shores.
          const ax = a.x - dx * push, az = a.z - dz * push;
          if (this.map.isWalkable(ax | 0, az | 0)) { a.x = ax; a.z = az; }
          const bx = b.x + dx * push, bz = b.z + dz * push;
          if (this.map.isWalkable(bx | 0, bz | 0)) { b.x = bx; b.z = bz; }
        }
      }
    }

    for (const zb of this.zombies) {
      if (zb.dead) continue;
      if (zb.hitFlash > 0) zb.hitFlash -= dt;
      zb.timer -= dt;
      zb.atkT -= dt;

      // Hero ability debuffs.
      if (zb.stunT > 0) { zb.stunT -= dt; continue; }
      let speedMul = nightMul;
      if (zb.slowT > 0) { zb.slowT -= dt; speedMul *= zb.slowMul; }
      zb.speedMul = speedMul;

      if (zb.state === IDLE) {
        if (zb.wave) { zb.state = AGGRO; continue; } // horde zombies never rest
        if (zb.timer <= 0) {
          zb.state = WANDER;
          const a = this.rng() * Math.PI * 2;
          zb.dirX = Math.cos(a); zb.dirZ = Math.sin(a);
          zb.timer = 2 + this.rng() * 4;
        }
        // Wake if the colony is close (flow distance is a free proximity metric).
        if (this.flow.distAt(zb.x | 0, zb.z | 0) < 11) zb.state = AGGRO;
        continue;
      }

      if (zb.state === WANDER) {
        if (zb.timer <= 0) { zb.burst = false; zb.state = zb.wave ? AGGRO : IDLE; zb.timer = 3 + this.rng() * 6; continue; }
        if (!zb.burst && this.flow.distAt(zb.x | 0, zb.z | 0) < 11) { zb.state = AGGRO; continue; }
        this._moveZombie(zb, zb.dirX, zb.dirZ, zb.def.speed * 0.6 * zb.speedMul, dt, false);
        continue;
      }

      // Stuck detector: an aggro zombie that hasn't gone anywhere for a few
      // seconds (wedged in a terrain notch) takes a short random walk to
      // shake free, then re-acquires the flow field.
      zb.progressT = (zb.progressT || 0) + dt;
      if (zb.progressT > 4) {
        zb.progressT = 0;
        const moved = dist2(zb.x, zb.z, zb.px || 0, zb.pz || 0);
        zb.px = zb.x; zb.pz = zb.z;
        // Marooned on ground the colony can't be reached from (e.g. shoved
        // across water)? Relocate the horde zombie to a valid spawn edge so
        // the final wave can always be finished.
        if (zb.wave && this.flow.distAt(zb.x | 0, zb.z | 0) === Infinity) {
          const N = this.map.size;
          for (let tries = 0; tries < 60; tries++) {
            const edge = (this.rng() * 4) | 0;
            const along = this.rng() * (N - 4) + 2;
            const depth = this.rng() * 5;
            let x, z;
            if (edge === 0) { x = along; z = 1 + depth; }
            else if (edge === 1) { x = N - 2 - depth; z = along; }
            else if (edge === 2) { x = along; z = N - 2 - depth; }
            else { x = 1 + depth; z = along; }
            if (this.map.isWalkable(x | 0, z | 0) && this.flow.distAt(x | 0, z | 0) < Infinity) {
              zb.x = x; zb.z = z;
              break;
            }
          }
          continue;
        }
        if (moved < 0.25 && zb.atkT <= -1) { // not moving and not attacking
          zb.state = WANDER;
          zb.burst = true;
          const a = this.rng() * Math.PI * 2;
          zb.dirX = Math.cos(a); zb.dirZ = Math.sin(a);
          zb.timer = 2 + this.rng() * 2;
          continue;
        }
      }

      // AGGRO
      // 1) Chase a nearby living unit if close.
      if (zb.targetU && (zb.targetU.dead || dist2(zb.x, zb.z, zb.targetU.x, zb.targetU.z) > 130)) zb.targetU = null;
      zb.retarget = (zb.retarget || 0) - dt;
      if (!zb.targetU && zb.retarget <= 0) {
        zb.retarget = 0.4 + this.rng() * 0.3;
        let best = null, bd = 100; // within 10 tiles
        for (const u of this.units) {
          if (u.dead) continue;
          const d = dist2(zb.x, zb.z, u.x, u.z);
          if (d < bd) { bd = d; best = u; }
        }
        zb.targetU = best;
      }

      if (zb.targetU) {
        const u = zb.targetU;
        const dx = u.x - zb.x, dz = u.z - zb.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.75) {
          if (zb.atkT <= 0) { zb.atkT = 0.8; this._damageUnit(u, zb.def.dmg); this.emit({ type: 'bite', x: u.x, z: u.z }); }
        } else {
          this._moveZombie(zb, dx / d, dz / d, zb.def.chase * zb.speedMul, dt, true);
        }
        continue;
      }

      // 2) Follow the flow field toward the colony.
      const dir = this.flow.dirAt(zb.x | 0, zb.z | 0);
      if (dir) {
        this._moveZombie(zb, dir[0], dir[1], zb.def.chase * zb.speedMul, dt, true);
      } else if (this.hq && this.hq.alive) {
        // Off the flow field (local dead spot) — shamble straight at the HQ
        // until the field picks us up again. Horde zombies never give up.
        const dx = this.hq.cx - zb.x, dz = this.hq.cz - zb.z;
        const d = Math.hypot(dx, dz) || 1;
        this._moveZombie(zb, dx / d, dz / d, zb.def.chase * 0.7 * zb.speedMul, dt, true);
        if (!zb.wave) {
          zb.stuckT = (zb.stuckT || 0) + dt;
          if (zb.stuckT > 6) { // ambient zombies do give up eventually
            zb.stuckT = 0;
            zb.state = WANDER;
            const a = this.rng() * Math.PI * 2;
            zb.dirX = Math.cos(a); zb.dirZ = Math.sin(a);
            zb.timer = 4;
          }
        }
      }
    }
  }

  _moveZombie(zb, dx, dz, speed, dt, canAttack) {
    const nx = zb.x + dx * speed * dt;
    const nz = zb.z + dz * speed * dt;
    const tx = nx | 0, tz = nz | 0;
    const occId = this.occ[tz * this.map.size + tx];
    if (occId > 0 && canAttack) {
      // Chew on whatever is in the way.
      if (zb.atkT <= 0) {
        zb.atkT = 0.85;
        const b = this.buildings.find((o) => o.id === occId);
        if (b) this._damageBuilding(b, zb.def.dmg);
      }
      return;
    }
    if (this.map.isWalkable(tx, tz) && occId === 0) {
      zb.x = nx; zb.z = nz;
      zb.dirX = dx; zb.dirZ = dz;
    } else if (!canAttack) {
      // Wanderer bumped into something — turn around.
      const a = this.rng() * Math.PI * 2;
      zb.dirX = Math.cos(a); zb.dirZ = Math.sin(a);
    } else {
      // Aggro but blocked by terrain: slide along axes.
      if (this.map.isWalkable((zb.x + dx * speed * dt) | 0, zb.z | 0) && this.occ[(zb.z | 0) * this.map.size + ((zb.x + dx * speed * dt) | 0)] === 0) {
        zb.x += dx * speed * dt;
      } else if (this.map.isWalkable(zb.x | 0, (zb.z + dz * speed * dt) | 0) && this.occ[((zb.z + dz * speed * dt) | 0) * this.map.size + (zb.x | 0)] === 0) {
        zb.z += dz * speed * dt;
      }
    }
  }

  _updateUnits(dt) {
    for (const u of this.units) {
      if (u.dead) continue;
      u.cooldown -= dt;
      u.retargetT -= dt;
      if (u.buffT > 0) u.buffT -= dt;
      if (u.turret) {
        u.life -= dt;
        if (u.life <= 0) { u.dead = true; this.emit({ type: 'turretend', x: u.x, z: u.z }); continue; }
      }

      // Movement along path.
      if (u.path) {
        const [wx, wz] = u.path[u.pathI];
        const dx = wx - u.x, dz = wz - u.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.15) {
          u.pathI++;
          if (u.pathI >= u.path.length) { u.path = null; u.holdX = u.x; u.holdZ = u.z; }
        } else {
          const sp = u.def.speed * dt;
          u.x += (dx / d) * Math.min(sp, d);
          u.z += (dz / d) * Math.min(sp, d);
          u.facing = Math.atan2(dx, dz);
        }
      }

      // Auto-attack when not moving (units fight while holding position).
      if (!u.path) {
        if (u.retargetT <= 0 || (u.target && u.target.dead)) {
          u.retargetT = 0.25;
          const r2 = u.def.range * u.def.range;
          let best = null, bd = r2;
          for (const zb of this.zombies) {
            if (zb.dead) continue;
            const d = dist2(u.x, u.z, zb.x, zb.z);
            if (d < bd) { bd = d; best = zb; }
          }
          u.target = best;
        }
        if (u.target && !u.target.dead && u.cooldown <= 0) {
          const zb = u.target;
          if (dist2(u.x, u.z, zb.x, zb.z) <= u.def.range * u.def.range) {
            const haste = u.hero && u.hasteT > 0 ? u.hasteMult : 1;
            u.cooldown = 1 / (u.def.rof * haste);
            u.facing = Math.atan2(zb.x - u.x, zb.z - u.z);
            let dmg = u.hero ? this.heroDmg(u) : u.def.dmg;
            if (u.buffT > 0) dmg *= u.buffMult;
            this.damageZombie(zb, dmg, u.x, u.z);
            // Scarlet's Toxin Arrows passive.
            if (u.hero) {
              const toxin = u.def.abilities.findIndex((a) => a.key === 'toxin');
              if (toxin >= 0 && u.abil[toxin].rank > 0) {
                const ab = u.def.abilities[toxin];
                zb.slowT = ab.dur;
                zb.slowMul = ab.slow[u.abil[toxin].rank - 1];
              }
            }
            const kind = u.hero ? (u.def.melee ? 'melee' : 'hero') : u.key;
            this.emit({ type: 'shot', kind, fx: u.x, fz: u.z, tx: zb.x, tz: zb.z, fy: u.hero ? 0.9 : 0.7 });
            if (u.def.noise > 0) this.wakeZombies(u.x, u.z, u.def.noise);
          } else {
            u.target = null;
          }
        }
      }
    }
  }

  _updateTowers(dt) {
    for (const b of this.buildings) {
      if (!b.alive || b.key !== 'tower') continue;
      b.cooldown -= dt;
      if (b.rofBuffT > 0) b.rofBuffT -= dt;
      if (b.cooldown > 0) continue;
      const r2 = b.def.range * b.def.range;
      let best = null, bd = r2;
      for (const zb of this.zombies) {
        if (zb.dead) continue;
        const d = dist2(b.cx, b.cz, zb.x, zb.z);
        if (d < bd) { bd = d; best = zb; }
      }
      if (best) {
        const haste = b.rofBuffT > 0 ? b.rofBuffMult : 1;
        b.cooldown = 1 / (b.def.rof * haste);
        this.damageZombie(best, b.def.dmg, b.cx, b.cz);
        this.emit({ type: 'shot', kind: 'tower', fx: b.cx, fz: b.cz, tx: best.x, tz: best.z, fy: 2.6 });
        this.wakeZombies(b.cx, b.cz, 9);
      }
    }
  }

  _cleanup() {
    if (this.zombies.some((z) => z.dead)) this.zombies = this.zombies.filter((z) => !z.dead);
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
  }

  _checkEnd() {
    if (this.over) return;
    if (this.finalSpawned) {
      let waveLeft = 0;
      for (const zb of this.zombies) if (zb.wave) waveLeft++;
      if (waveLeft === 0) this._gameOver(true);
    }
  }

  aggroCount() {
    let n = 0;
    for (const zb of this.zombies) if (zb.state === AGGRO) n++;
    return n;
  }
}
