// Core simulation: economy, buildings, zombies, units, hordes, win/lose.
// Pure logic — rendering/audio consume `game.events` each frame.
import {
  BUILDINGS, UNITS, ZOMBIES, WAVES, TILE, DAY_LENGTH, NIGHT_START_FRAC, FINAL_DAY,
  START_RESOURCES, ZOMBIE_CAP, UNIT_CAP, DIFFICULTY, LEVELS,
  HEROES, HERO_MAX_LEVEL, XP_RADIUS, xpForLevel, rankReqLevel, ULT_REQ_LEVEL, DROPS,
} from './config.js';
import { FlowField, findPath } from './flowfield.js';
import {
  generatePlots, plotComplete, plotCost, plotCostText, plotEffectText, PLOT_PAY_RADIUS, PLOT_PAY_RATE,
} from './plots.js';
import { clamp, dist2, makeRNG } from './utils.js';

const IDLE = 0, WANDER = 1, AGGRO = 2;

let nextId = 1;
const getNextId = () => nextId;
const setNextId = (v) => { nextId = v; };

export class Game {
  // heroKeys: a hero key string (solo) or an array of keys (co-op, one per player).
  constructor(map, difficulty = 'normal', heroKeys = 'alexander', snap = null, levelId = 1, mode = 'survival-plots') {
    this.map = map;
    this.diffKey = difficulty;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.levelId = snap ? snap.level : levelId;
    this.mode = 'survival-plots';
    this.plotMode = true;
    this.level = LEVELS[(this.levelId || 1) - 1] || LEVELS[0];
    this.boss = null;
    this.rng = makeRNG(999);

    this.res = { ...START_RESOURCES, wood: 0, stone: 0 };
    this.plots = this.plotMode ? generatePlots(map) : [];
    this.activePlot = null;
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

    this.stats = { kills: 0, built: 0, lost: 0, plots: 0 };

    this.eco = { energyProd: 0, energyUse: 0, workersUsed: 0, popCap: 0, gold: 0, wood: 0, stone: 0, food: 0 };
    this.starving = false;

    this.heroKeys = Array.isArray(heroKeys) ? heroKeys : [heroKeys];
    this.heroes = [];
    this.hero = null;            // heroes[0], kept for solo call sites
    this.pickups = [];
    this.fields = [];            // ability ground zones
    this.autoBuild = false;

    if (snap) this._restore(snap);
    else this._setupStart();
  }

  // ---------- save / restore ----------
  // A snapshot is plain JSON: enough state to resume a run identically on
  // every machine (co-op peers all load the same snapshot). Transient AI
  // timers reset on load — identically for everyone, so lockstep holds.

  snapshot() {
    const unit = (u) => ({
      id: u.id, k: u.key, x: +u.x.toFixed(3), z: +u.z.toFixed(3),
      hp: +u.hp.toFixed(2), maxHp: u.maxHp,
      turret: !!u.turret, summon: !!u.summon, life: u.life,
      sourceId: u.sourceId || null,
      facing: +(u.facing || 0).toFixed(3),
      def: (u.turret || u.summon) ? { ...u.def } : undefined,
    });
    return {
      v: 1, seed: this.map.seed, diff: this.diffKey, heroKeys: this.heroKeys, level: this.levelId, mode: this.mode,
      time: this.time, res: { gold: +this.res.gold.toFixed(3), wood: +this.res.wood.toFixed(3), stone: +this.res.stone.toFixed(3) },
      autoBuild: this.autoBuild, finalSpawned: this.finalSpawned,
      wavesDone: [...this.wavesDone], pendingWave: this.pendingWave || null,
      ambientTimer: this.ambientTimer, stats: { ...this.stats },
      rng: this.rng.getState(), nextId: getNextId(),
      plots: this.plotMode ? this.plots.map((p) => ({
        id: p.id, built: !!p.built, paid: {
          gold: +(p.paid.gold || 0).toFixed(2),
          wood: +(p.paid.wood || 0).toFixed(2),
          stone: +(p.paid.stone || 0).toFixed(2),
        },
      })) : undefined,
      buildings: this.buildings.map((b) => ({ id: b.id, k: b.key, x: b.x, z: b.z, hp: +b.hp.toFixed(1), p: b.plotId || 0 })),
      units: this.units.filter((u) => !u.hero).map(unit),
      heroes: this.heroes.map((h) => ({
        k: h.key, x: +h.x.toFixed(3), z: +h.z.toFixed(3), hp: +h.hp.toFixed(1),
        dead: !!h.dead, reviveT: +(h.reviveT || 0).toFixed(1),
        level: h.level, xp: Math.round(h.xp), points: h.points,
        abil: h.abil.map((a) => ({ r: a.rank, cd: +a.cd.toFixed(1) })),
        bonusDmg: +(h.bonusDmg || 0).toFixed(1),
      })),
      zombies: this.zombies.map((z) => [z.type, +z.x.toFixed(2), +z.z.toFixed(2), +z.hp.toFixed(1), z.state, z.wave ? 1 : 0, z.boss ? 1 : 0, z.enraged ? 1 : 0]),
      pickups: this.pickups.map((p) => ({ ...p })),
    };
  }

  _restore(snap) {
    this.time = snap.time;
    this.res = { ...snap.res };
    this.autoBuild = snap.autoBuild;
    this.finalSpawned = snap.finalSpawned;
    this.wavesDone = new Set(snap.wavesDone);
    this.pendingWave = snap.pendingWave || null;
    this.ambientTimer = snap.ambientTimer;
    this.stats = { ...snap.stats };
    if (this.plotMode && Array.isArray(snap.plots)) {
      for (const ps of snap.plots) {
        const plot = this.plots.find((p) => p.id === ps.id);
        if (!plot) continue;
        plot.built = !!ps.built;
        plot.paid = {
          gold: ps.paid?.gold || 0,
          wood: ps.paid?.wood || 0,
          stone: ps.paid?.stone || 0,
        };
      }
    }

    for (const b of snap.buildings) {
      const d = BUILDINGS[b.k];
      const nb = {
        id: b.id, key: b.k, def: d, x: b.x, z: b.z, size: d.size,
        cx: b.x + d.size / 2, cz: b.z + d.size / 2,
        hp: b.hp, maxHp: d.hp, alive: true, cooldown: 0, plotId: b.p || null,
      };
      this.buildings.push(nb);
      for (let dz = 0; dz < d.size; dz++) for (let dx = 0; dx < d.size; dx++) {
        this.occ[(b.z + dz) * this.map.size + (b.x + dx)] = b.id;
      }
      if (b.k === 'hq') this.hq = nb;
    }

    for (const u of snap.units) {
      const def = u.def || UNITS[u.k];
      this.units.push({
        id: u.id, key: u.k, def, x: u.x, z: u.z, hp: u.hp, maxHp: u.maxHp,
        turret: u.turret || undefined, summon: u.summon || undefined, life: u.life,
        sourceId: u.sourceId || null,
        path: null, pathI: 0, cooldown: 0, target: null, selected: false,
        facing: u.facing, retargetT: 0,
      });
    }

    for (const hs of snap.heroes) {
      const h = this._spawnHero(hs.k, hs.x, hs.z);
      h.hp = hs.hp;
      h.level = hs.level; h.xp = hs.xp; h.points = hs.points;
      h.maxHp = h.def.hp + h.def.levelHp * (h.level - 1);
      h.abil = hs.abil.map((a) => ({ rank: a.r, cd: a.cd }));
      h.bonusDmg = hs.bonusDmg;
      if (hs.dead) {
        h.dead = true;
        h.reviveT = hs.reviveT;
        this.units = this.units.filter((u) => u !== h);
      }
    }

    // Zombies re-roll their idle timers from the restored RNG — identical on
    // every peer since they all restore the same stream position afterwards.
    for (const [type, x, z, hp, state, wave, boss, enraged] of snap.zombies) {
      if (boss) {
        this._spawnBoss(0);
        const zb = this.boss;
        zb.x = x; zb.z = z; zb.hp = hp;
        if (enraged) {
          zb.enraged = true;
          zb.def = { ...zb.def, speed: zb.def.speed * 1.5, chase: zb.def.chase * 1.5, dmg: Math.round(zb.def.dmg * 1.3) };
        }
        continue;
      }
      const zb = this._spawnZombie(type, x, z, state === 2, !!wave);
      if (zb) { zb.hp = hp; zb.state = state; }
    }
    this.pickups = (snap.pickups || []).map((p) => ({ ...p }));

    this.rng.setState(snap.rng);
    setNextId(snap.nextId);
    this.recalcEconomy();
    this.flowDirty = true;
    this._wasNight = this.isNight;
    this.msg('📂 Colony restored — the fight continues.', 'info');
  }

  // ---------- setup ----------

  _setupStart() {
    const c = (this.map.size / 2) | 0;
    this.hq = this._placeRaw('hq', c - 2, c - 2);
    this.heroKeys.forEach((k, i) => this._spawnHero(k, c - 1 + i * 2.5, c + 4));
    this._scatterInitialZombies();
    this.recalcEconomy();
    this.msg('Survival online: spend the day raising plots. At night, defend what you built.', 'info');
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
  get isNight() { return this.dayFrac > NIGHT_START_FRAC; }

  waveTime(day) {
    return (day - 1) * DAY_LENGTH + DAY_LENGTH * NIGHT_START_FRAC;
  }

  nextWave() {
    for (const w of WAVES) {
      if (!this.wavesDone.has(w.day)) return { ...w, at: this.waveTime(w.day) };
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

  canPlace(key, x, z, opts = {}) {
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
    if (!opts.ignoreCost && (this.res.gold < d.cost.gold || this.res.wood < d.cost.wood || this.res.stone < (d.cost.stone || 0))) {
      return { ok: false, why: 'Not enough resources' };
    }
    if (!opts.ignoreCost && (d.workers || 0) > 0 && this.eco.workersUsed + d.workers > this.eco.popCap) {
      return { ok: false, why: 'Not enough colonists — build hab-tents' };
    }
    if (!opts.ignoreCost && d.energy < 0 && this.eco.energyProd - this.eco.energyUse + d.energy < 0) {
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

  _placeRaw(key, x, z, opts = {}) {
    const d = BUILDINGS[key];
    const b = {
      id: nextId++, key, def: d, x, z, size: d.size,
      cx: x + d.size / 2, cz: z + d.size / 2,
      hp: d.hp, maxHp: d.hp, alive: true, cooldown: 0,
      plotId: opts.plotId || null,
    };
    this.buildings.push(b);
    for (let dz = 0; dz < d.size; dz++) for (let dx = 0; dx < d.size; dx++) {
      this.occ[(z + dz) * this.map.size + (x + dx)] = b.id;
    }
    this.flowDirty = true;
    this.recalcEconomy();
    return b;
  }

  buildPlot(id, charge = true) {
    if (!this.plotMode) return null;
    const plot = this.plots.find((p) => p.id === id);
    if (!plot || plot.built) return null;
    const b = charge ? this.place(plot.key, plot.x, plot.z) : this._constructPlot(plot);
    if (b) {
      b.plotId = plot.id;
      plot.built = true;
      plot.paid = { ...plotCost(plot.key) };
      plot.buildingId = b.id;
      if (charge) this.stats.plots = (this.stats.plots || 0) + 1;
    }
    return b;
  }

  _constructPlot(plot) {
    const chk = this.canPlace(plot.key, plot.x, plot.z, { ignoreCost: true });
    if (!chk.ok) {
      this.emit({ type: 'deny' });
      this.msg(`Could not build ${BUILDINGS[plot.key].name}: ${chk.why}`, 'warn');
      return null;
    }
    const b = this._placeRaw(plot.key, plot.x, plot.z, { plotId: plot.id });
    plot.built = true;
    plot.buildingId = b.id;
    this.stats.built++;
    this.stats.plots = (this.stats.plots || 0) + 1;
    this.emit({ type: 'build', key: plot.key, x: b.cx, z: b.cz });
    this.msg(`${BUILDINGS[plot.key].icon} ${BUILDINGS[plot.key].name} funded and built.`, 'info');
    if (plot.key === 'barracks') {
      const made = this._spawnBarracksSquad(b);
      if (made) {
        this.emit({ type: 'train' });
        this.msg(`⚔️ Barracks squad rallies: ${made} fighter${made > 1 ? 's' : ''}.`, 'info');
      }
    }
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
    if (this.plotMode && b.plotId) {
      const plot = this.plots.find((p) => p.id === b.plotId);
      if (plot) {
        plot.built = false;
        plot.buildingId = null;
        plot.paid = { gold: 0, wood: 0, stone: 0 };
      }
    }
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
    if (this.plotMode) {
      this.msg('Barracks rally and replenish squads automatically at dawn.', 'info');
      this.emit({ type: 'deny' });
      return null;
    }
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

  _spawnUnit(key, x, z, opts = {}) {
    const d = UNITS[key];
    const u = {
      id: nextId++, key, def: d, x, z, hp: d.hp, maxHp: d.hp,
      path: null, pathI: 0, cooldown: 0, target: null, selected: false,
      facing: 0, holdX: x, holdZ: z, retargetT: 0,
      sourceId: opts.sourceId || null,
    };
    this.units.push(u);
    return u;
  }

  _spawnBarracksSquad(b) {
    if (!b || !b.alive || b.key !== 'barracks') return 0;
    const roster = ['ranger', 'soldier', 'sniper'];
    let made = 0;
    for (let i = 0; i < roster.length && this.units.length < UNIT_CAP; i++) {
      const key = roster[i];
      const alive = this.units.some((u) => !u.dead && !u.hero && !u.turret && u.sourceId === b.id && u.key === key);
      if (alive) continue;
      const a = -Math.PI / 2 + i * 0.72;
      const r = 2.1;
      this._spawnUnit(key, b.cx + Math.cos(a) * r, b.cz + Math.sin(a) * r, { sourceId: b.id });
      made++;
    }
    return made;
  }

  _replenishBarracksSquads() {
    let made = 0;
    for (const b of this.buildings) {
      if (b.alive && b.key === 'barracks') made += this._spawnBarracksSquad(b);
    }
    if (made) {
      this.emit({ type: 'train' });
      this.msg(`⚔️ Dawn muster: ${made} fighter${made > 1 ? 's' : ''} report from the barracks.`, 'info');
    }
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
      reviveT: 0, buildHold: false, buildHoldT: 0,
    };
    this.units.push(h);
    this.heroes.push(h);
    if (!this.hero) this.hero = h;
    return h;
  }

  // Central command entry point — local UI and remote co-op players both go
  // through here, so the sim stays deterministic under lockstep.
  exec(c) {
    switch (c.t) {
      case 'place': this.place(c.k, c.x, c.z); break;
      case 'quietPlace': if (this.canPlace(c.k, c.x, c.z).ok) this.place(c.k, c.x, c.z); break;
      case 'plotBuild': this.buildPlot(c.id, true); break;
      case 'demolish': { const b = this.buildings.find((o) => o.id === c.id); if (b) this.demolish(b); break; }
      case 'train': this.trainUnit(c.k); break;
      case 'move': {
        const units = c.ids.map((id) => this.units.find((u) => u.id === id)).filter(Boolean);
        if (units.length) this.orderMove(units, c.x, c.z);
        break;
      }
      case 'heroDir': {
        const h = this.heroes[c.p || 0];
        if (!h) break;
        const x = c.x || 0, z = c.z || 0;
        const len = Math.hypot(x, z);
        h.moveX = len ? x / len : 0;
        h.moveZ = len ? z / len : 0;
        h.sprint = !!c.s;
        if (len) {
          h.path = null;
          h.pathI = 0;
          h.target = null;
          h.moveOrderX = null;
          h.moveOrderZ = null;
        }
        break;
      }
      case 'heroBuild': {
        const h = this.heroes[c.p || 0];
        if (!h) break;
        h.buildHold = !!c.on;
        if (!h.buildHold) h.buildHoldT = 0;
        break;
      }
      case 'stop': {
        const units = c.ids.map((id) => this.units.find((u) => u.id === id)).filter(Boolean);
        for (const u of units) {
          u.path = null;
          u.pathI = 0;
          u.target = null;
          u.moveOrderX = null;
          u.moveOrderZ = null;
          u.holdX = u.x;
          u.holdZ = u.z;
          u.retargetT = 0;
        }
        break;
      }
      case 'cast': this.castAbility(c.i, c.x, c.z, c.p || 0); break;
      case 'learn': this.learnAbility(c.i, c.p || 0); break;
      case 'auto': this.autoBuild = !!c.on; break;
    }
  }

  heroDmg(h) {
    return h.def.dmg + h.def.levelDmg * (h.level - 1) + (h.bonusDmg || 0);
  }

  addXp(h, amount) {
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

  canLearn(i, p = 0) {
    const h = this.heroes[p];
    if (!h || h.points <= 0) return false;
    const ab = h.def.abilities[i];
    const st = h.abil[i];
    if (st.rank >= ab.maxRank) return false;
    if (ab.ult) return h.level >= ULT_REQ_LEVEL;
    return h.level >= rankReqLevel(st.rank + 1);
  }

  learnAbility(i, p = 0) {
    if (!this.canLearn(i, p)) { this.emit({ type: 'deny' }); return; }
    const h = this.heroes[p];
    h.abil[i].rank++;
    h.points--;
    this.emit({ type: 'learn' });
    this.msg(`${h.def.abilities[i].icon} ${h.def.abilities[i].name} — rank ${h.abil[i].rank}`, 'info');
  }

  castAbility(i, tx, tz, p = 0) {
    const h = this.heroes[p];
    if (!h || h.dead) return;
    const ab = h.def.abilities[i];
    const st = h.abil[i];
    if (ab.passive) return;
    if (st.rank === 0 || st.cd > 0 || h.channelT > 0) { this.emit({ type: 'deny' }); return; }
    const r = st.rank - 1;

    // Targeted casts fizzle without a target — don't burn the cooldown.
    if (ab.cast === 'hook' || ab.cast === 'assassinate' || ab.cast === 'swarm') {
      const rr = (ab.range || ab.radius) ** 2;
      if (!this.zombies.some((zb) => !zb.dead && dist2(h.x, h.z, zb.x, zb.z) <= rr)) {
        this.msg('No target in range.', 'warn');
        this.emit({ type: 'deny' });
        return;
      }
    }
    st.cd = Array.isArray(ab.cd) ? ab.cd[r] : ab.cd;

    switch (ab.cast) {
      case 'teleport':
        if (tx == null) { st.cd = 0; return; }
        h.channelT = ab.channel;
        h.tpX = tx; h.tpZ = tz;
        h.path = null; h.target = null;
        this.msg('Channeling teleport…', 'info');
        break;
      case 'whirlwind':
        h.whirlT = ab.dur[r];
        h.whirlDps = ab.dps[r];
        h.whirlR = ab.radius;
        break;
      case 'pulse': {
        const r2 = ab.radius * ab.radius;
        for (const zb of this.zombies) {
          if (!zb.dead && dist2(h.x, h.z, zb.x, zb.z) <= r2) this.damageZombie(zb, ab.dmg[r], h.x, h.z);
        }
        for (const u of this.units) {
          if (!u.dead && !u.turret && dist2(h.x, h.z, u.x, u.z) <= r2) u.hp = Math.min(u.maxHp, u.hp + ab.heal[r]);
        }
        break;
      }
      case 'hook': {
        const rr = ab.range * ab.range;
        let best = null, bd = rr;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          const d = dist2(h.x, h.z, zb.x, zb.z);
          if (d < bd && d > 2) { bd = d; best = zb; }
        }
        if (best) {
          this.emit({ type: 'hook', fx: h.x, fz: h.z, tx: best.x, tz: best.z });
          const dx = best.x - h.x, dz = best.z - h.z;
          const d = Math.hypot(dx, dz) || 1;
          const nx = h.x + (dx / d) * 1.2, nz = h.z + (dz / d) * 1.2;
          if (this.map.isWalkable(nx | 0, nz | 0) && this.occ[(nz | 0) * this.map.size + (nx | 0)] === 0) {
            best.x = nx; best.z = nz;
          }
          best.stunT = Math.max(best.stunT || 0, ab.stun);
          this.damageZombie(best, ab.dmg[r]);
        }
        break;
      }
      case 'zone':
        this.fields.push({
          x: h.x, z: h.z, r: ab.radius,
          t: Array.isArray(ab.dur) ? ab.dur[r] : ab.dur,
          dps: ab.dps ? ab.dps[r] : 0,
          slow: ab.slow || 1, blind: !!ab.blind, fx: ab.fx,
        });
        break;
      case 'summon': {
        for (let i = 0; i < ab.count[r]; i++) {
          const a = (i / ab.count[r]) * Math.PI * 2;
          this.units.push({
            id: nextId++, key: 'treant', summon: true,
            def: { name: 'Treant', dmg: ab.dmg, range: 1.3, rof: 1.1, speed: ab.speed, noise: 0, color: 0x3a5c2e },
            x: h.x + Math.cos(a) * 1.5, z: h.z + Math.sin(a) * 1.5,
            hp: ab.hp, maxHp: ab.hp, life: ab.life,
            path: null, pathI: 0, cooldown: 0, target: null, selected: false,
            facing: 0, retargetT: 0,
          });
        }
        this.emit({ type: 'treants', x: h.x, z: h.z });
        break;
      }
      case 'swarm': {
        const rr = ab.radius * ab.radius;
        const targets = this.zombies
          .filter((zb) => !zb.dead && dist2(h.x, h.z, zb.x, zb.z) <= rr)
          .sort((a, b) => dist2(h.x, h.z, a.x, a.z) - dist2(h.x, h.z, b.x, b.z))
          .slice(0, ab.count[r]);
        for (const zb of targets) {
          zb.dotT = ab.dur;
          zb.dotDps = ab.dps;
          zb.slowT = ab.dur;
          zb.slowMul = ab.slow;
          this.emit({ type: 'shot', kind: 'ricochet', fx: h.x, fz: h.z, tx: zb.x, tz: zb.z, fy: 0.9 });
        }
        break;
      }
      case 'assassinate': {
        const rr = ab.radius * ab.radius;
        let best = null, bhp = -1;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          if (dist2(h.x, h.z, zb.x, zb.z) <= rr && zb.hp > bhp) { bhp = zb.hp; best = zb; }
        }
        if (best) {
          this.emit({ type: 'shot', kind: 'sniper', fx: h.x, fz: h.z, tx: best.x, tz: best.z, fy: 1.0 });
          this.damageZombie(best, ab.dmg[r], h.x, h.z);
        }
        break;
      }
      case 'timelapse': {
        const hist = h.hist && h.hist.length ? h.hist[0] : null;
        if (hist) {
          const [hx, hz, hhp] = hist;
          if (this.map.isWalkable(hx | 0, hz | 0) && this.occ[(hz | 0) * this.map.size + (hx | 0)] === 0) {
            h.x = hx; h.z = hz;
          }
          h.hp = Math.min(h.maxHp, Math.max(h.hp, hhp));
          h.path = null; h.target = null;
          h.hist.length = 0;
          this.emit({ type: 'revive', x: h.x, z: h.z });
        }
        break;
      }
      case 'aoeDmg': {
        const r2 = ab.radius * ab.radius;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          const d2v = dist2(h.x, h.z, zb.x, zb.z);
          if (d2v <= r2) {
            if (ab.stun) zb.stunT = Math.max(zb.stunT || 0, ab.stun[r]);
            if (ab.slow) { zb.slowT = ab.slowDur; zb.slowMul = ab.slow; }
            // Ultimate shockwaves physically hurl survivors backward.
            if (ab.knock) {
              const d = Math.sqrt(d2v) || 1;
              const k = ab.knock * (1 - (d / ab.radius) * 0.6);
              const nx = zb.x + ((zb.x - h.x) / d) * k;
              const nz = zb.z + ((zb.z - h.z) / d) * k;
              if (this.map.isWalkable(nx | 0, nz | 0) && this.occ[(nz | 0) * this.map.size + (nx | 0)] === 0) {
                zb.x = nx; zb.z = nz;
              }
            }
            this.damageZombie(zb, ab.dmg[r], h.x, h.z);
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
      case 'surge':
        h.hasteT = ab.dur[r];
        h.hasteMult = ab.mult[r];
        h.moveT = ab.dur[r];
        h.moveMult = ab.move;
        break;
      case 'barrage': {
        const r2 = ab.radius * ab.radius;
        let tracers = 0;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          if (dist2(h.x, h.z, zb.x, zb.z) <= r2) {
            if (tracers++ < 24) this.emit({ type: 'shot', kind: 'ricochet', fx: h.x, fz: h.z, tx: zb.x, tz: zb.z, fy: 0.9 });
            this.damageZombie(zb, ab.dmg[r]);
          }
        }
        break;
      }
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
    for (const h of this.heroes) this._updateHeroOne(h, dt);
  }

  _updateHeroOne(h, dt) {
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
    if (h.moveT > 0) h.moveT -= dt;

    // Teleport channel.
    if (h.channelT > 0) {
      h.channelT -= dt;
      if (h.channelT <= 0 && h.tpX != null) {
        let placed = false;
        outer: for (let ring = 0; ring < 6 && !placed; ring++) {
          for (let dz = -ring; dz <= ring; dz++) {
            for (let dx = -ring; dx <= ring; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
              const nx = (h.tpX | 0) + dx, nz = (h.tpZ | 0) + dz;
              if (this.map.isWalkable(nx, nz) && this.occ[nz * this.map.size + nx] === 0) {
                h.x = nx + 0.5; h.z = nz + 0.5;
                placed = true;
                break outer;
              }
            }
          }
        }
        h.tpX = null;
        this.emit({ type: 'revive', x: h.x, z: h.z });
      }
    }

    // Cloak & Dagger: fade to invisibility after a few quiet seconds.
    const ci = h.def.abilities.findIndex((a) => a.key === 'cloak');
    if (ci >= 0 && h.abil[ci].rank > 0) {
      h.sinceAtk = (h.sinceAtk || 0) + dt;
      const fade = h.def.abilities[ci].fade[h.abil[ci].rank - 1];
      if (!h.stealth && h.sinceAtk >= fade) {
        h.stealth = true;
        this.emit({ type: 'stealth', x: h.x, z: h.z });
      }
    }

    // Position/HP history for Time Lapse (~5s window, sampled 4x/s).
    h.histT = (h.histT || 0) - dt;
    if (h.histT <= 0) {
      h.histT = 0.25;
      if (!h.hist) h.hist = [];
      h.hist.push([h.x, h.z, h.hp]);
      if (h.hist.length > 20) h.hist.shift();
    }

    // Whirlwind channel: grind everything nearby while it lasts.
    if (h.whirlT > 0) {
      h.whirlT -= dt;
      h.whirlTick = (h.whirlTick || 0) - dt;
      if (h.whirlTick <= 0) {
        h.whirlTick = 0.3;
        const r2 = h.whirlR * h.whirlR;
        for (const zb of this.zombies) {
          if (!zb.dead && dist2(h.x, h.z, zb.x, zb.z) <= r2) this.damageZombie(zb, h.whirlDps * 0.3);
        }
        this.emit({ type: 'whirl', x: h.x, z: h.z, r: h.whirlR });
      }
    }
    // Toxin Arrows-style passives are applied at attack time in _updateUnits.
  }

  _updateFields(dt) {
    if (!this.fields.length) return;
    for (const f of this.fields) {
      f.t -= dt;
      const r2 = f.r * f.r;
      for (const zb of this.zombies) {
        if (zb.dead) continue;
        if (dist2(zb.x, zb.z, f.x, f.z) > r2) continue;
        if (f.dps) this.damageZombie(zb, f.dps * dt);
        if (f.slow < 1) {
          zb.slowT = Math.max(zb.slowT || 0, 0.2);
          zb.slowMul = f.slow;
        }
        if (f.blind) zb.blindT = 0.25;
      }
    }
    this.fields = this.fields.filter((f) => f.t > 0);
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
      if (u.turret || u.summon || u.dead) continue;
      const ang = (i / Math.max(1, units.length)) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.9 + 0.55 * Math.floor((i - 1) / 6);
      const dx = tx + Math.cos(ang) * r, dz = tz + Math.sin(ang) * r;
      if (u.path && Number.isFinite(u.moveOrderX) && Number.isFinite(u.moveOrderZ) &&
        Math.hypot(u.moveOrderX - dx, u.moveOrderZ - dz) < 0.35) {
        i++;
        continue;
      }
      const p = findPath(this.map, this.occ, u.x, u.z, dx, dz);
      if (p) {
        let pathI = 0;
        while (pathI < p.length - 1 && Math.hypot(p[pathI][0] - u.x, p[pathI][1] - u.z) < 0.45) pathI++;
        u.path = p;
        u.pathI = pathI;
        u.target = null;
        u.moveOrderX = dx;
        u.moveOrderZ = dz;
      }
      i++;
    }
    if (units.length) this.emit({ type: 'move' });
  }

  _moveUnitDirect(u, dx, dz, speed, dt) {
    const step = speed * dt;
    const tryMove = (mx, mz) => {
      if (!mx && !mz) return false;
      const nx = u.x + mx, nz = u.z + mz;
      const tx = nx | 0, tz = nz | 0;
      if (this.map.isWalkable(tx, tz) && this.occ[tz * this.map.size + tx] === 0) {
        u.x = nx;
        u.z = nz;
        return true;
      }
      return false;
    };
    const moved = tryMove(dx * step, dz * step) ||
      tryMove(dx * step, 0) ||
      tryMove(0, dz * step);
    if (moved) u.facing = Math.atan2(dx, dz);
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

  _spawnBoss(edge) {
    const N = this.map.size;
    const B = this.level.boss;
    let x = N / 2, z = N / 2;
    if (edge === 0) z = 4; else if (edge === 1) x = N - 4; else if (edge === 2) z = N - 4; else x = 4;
    // Nudge to walkable ground.
    for (let r = 0; r < 12; r++) {
      if (this.map.isWalkable((x | 0) + r, z | 0)) { x = (x | 0) + r; break; }
      if (this.map.isWalkable((x | 0) - r, z | 0)) { x = (x | 0) - r; break; }
    }
    const def = {
      hp: Math.round(B.hp * this.diff.mult), dmg: B.dmg, speed: B.speed, chase: B.chase,
      color: B.color, scale: B.scale, score: B.score,
    };
    const zb = {
      id: nextId++, type: 'boss', def, x, z,
      hp: def.hp, maxHp: def.hp,
      state: AGGRO, dirX: 0, dirZ: 0, timer: 0,
      atkT: 0, targetU: null, phase: this.rng() * Math.PI * 2,
      wave: true, hitFlash: 0, boss: true,
      armor: B.armor || 0, spawnT: B.spawn ? B.spawn.every : 0, roarT: B.roar ? B.roar.every : 0,
    };
    this.zombies.push(zb);
    this.boss = zb;
    this.msg(`${B.icon} ${B.name} has entered the field: "${B.desc}"`, 'bad');
    this.emit({ type: 'bossspawn', x, z });
    this.emit({ type: 'ping', x, z });
  }

  _updateBoss(zb, dt) {
    const B = this.level.boss;
    // Bosses shrug off most crowd control.
    if (zb.stunT > 0.8) zb.stunT = 0.8;
    if (zb.slowT > 0 && zb.slowMul < 0.75) zb.slowMul = 0.75;
    if (B.spawn) {
      zb.spawnT -= dt;
      if (zb.spawnT <= 0) {
        zb.spawnT = B.spawn.every;
        for (let i = 0; i < B.spawn.count; i++) {
          const a = (i / B.spawn.count) * Math.PI * 2;
          this._spawnZombie(B.spawn.type, zb.x + Math.cos(a) * 2, zb.z + Math.sin(a) * 2, true, true);
        }
        this.emit({ type: 'brood', x: zb.x, z: zb.z });
      }
    }
    if (B.roar) {
      zb.roarT -= dt;
      if (zb.roarT <= 0) {
        zb.roarT = B.roar.every;
        const r2 = B.roar.radius * B.roar.radius;
        let hit = 0;
        for (const b of this.buildings) {
          if (b.alive && b.key === 'tower' && dist2(zb.x, zb.z, b.cx, b.cz) <= r2) { b.stunT = B.roar.dur; hit++; }
        }
        this.emit({ type: 'roarwave', x: zb.x, z: zb.z, r: B.roar.radius });
        if (hit) this.msg(`${B.icon} The shriek overloads ${hit} sentry tower${hit > 1 ? 's' : ''}!`, 'warn');
      }
    }
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
    if (zb.armor) dmg *= 1 - zb.armor;
    zb.hp -= dmg;
    if (zb.boss && this.level.boss.enrage && !zb.enraged && zb.hp < zb.maxHp * this.level.boss.enrage) {
      zb.enraged = true;
      zb.def = { ...zb.def, speed: zb.def.speed * 1.5, chase: zb.def.chase * 1.5, dmg: Math.round(zb.def.dmg * 1.3) };
      this.msg(`${this.level.boss.icon} ${this.level.boss.name} ENRAGES!`, 'bad');
      this.emit({ type: 'enrage', x: zb.x, z: zb.z });
    }
    zb.hitFlash = 0.15;
    if (zb.state !== AGGRO) zb.state = AGGRO;
    if (zb.hp <= 0) {
      zb.dead = true;
      this.stats.kills++;
      if (zb.boss) {
        this.boss = null;
        this.msg(`🏆 ${this.level.boss.name} IS SLAIN! Purge the stragglers!`, 'info');
        this.emit({ type: 'bossdown', x: zb.x, z: zb.z });
      }
      // Launch vector for corpse physics: away from the damage source.
      let ldx, ldz;
      if (sx !== undefined) {
        ldx = zb.x - sx; ldz = zb.z - sz;
        const ld = Math.hypot(ldx, ldz) || 1;
        ldx /= ld; ldz /= ld;
      } else {
        const a = this.rng() * Math.PI * 2;
        ldx = Math.cos(a); ldz = Math.sin(a);
      }
      const force = dmg >= 150 ? 2.4 : dmg >= 60 ? 1.4 : 0.8;
      this.emit({ type: 'zdeath', x: zb.x, z: zb.z, big: zb.type === 'brute', dx: ldx, dz: ldz, force });
      // WC3-style shared XP for kills near any hero (co-op: both can earn).
      for (const h of this.heroes) {
        if (!h.dead && dist2(h.x, h.z, zb.x, zb.z) < XP_RADIUS * XP_RADIUS) {
          this.addXp(h, zb.def.score * 8);
        }
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
    b.hitT = this.time;
    this.emit({ type: 'bhit', x: b.cx, z: b.cz });
    // WC3-style "under attack" warning, throttled.
    if (this.time - (this._uaT || -99) > 20) {
      this._uaT = this.time;
      this.msg('⚔️ Your colony is under attack!', 'warn');
      this.emit({ type: 'ping', x: b.cx, z: b.cz });
      this.emit({ type: 'underattack' });
    }
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

    // Day/night announcements.
    const night = this.isNight;
    if (night && !this._wasNight) { this.msg('🌙 Night raid begins — hold the line.', 'warn'); this.emit({ type: 'night' }); }
    else if (!night && this._wasNight) this._onDawn();
    this._wasNight = night;

    this._updateWaves(prevTime);
    this._updateEconomy(dt);
    if (this.plotMode) this._updatePlotFunding(dt);
    this._updateFlow(dt);
    this._updateZombies(dt);
    this._updateUnits(dt);
    this._updateTowers(dt);
    this._updateHero(dt);
    this._updateFields(dt);
    this._updatePickups(dt);
    this._cleanup();
    this._checkEnd();
  }

  _updateWaves(prevTime) {
    // Second pulse of the final horde.
    if (this.pendingWave && this.time >= this.pendingWave.at) {
      const p = this.pendingWave;
      this.pendingWave = null;
      this._spawnHorde(p.size, p.edges, p.types);
      const N = this.map.size;
      const mid = [[N / 2, 3], [N - 3, N / 2], [N / 2, N - 3], [3, N / 2]];
      for (const ed of p.edges) this.emit({ type: 'ping', x: mid[ed][0], z: mid[ed][1] });
      this.msg('☠️ The second pulse of the horde crashes in!', 'bad');
      this.emit({ type: 'horde', final: true });
    }
    for (const w of WAVES) {
      const at = this.waveTime(w.day);
      if (prevTime < at && this.time >= at && !this.wavesDone.has(w.day)) {
        this.wavesDone.add(w.day);
        let size = Math.round(w.size * this.diff.mult * this.level.mult);
        let edges;
        if (w.final) {
          // Two fronts, two pulses — an epic but defensible finale.
          const e1 = (this.rng() * 4) | 0;
          const e2 = (e1 + 1 + ((this.rng() * 3) | 0)) % 4;
          edges = [e1, e2];
          const pulse2 = Math.round(size * 0.4);
          size -= pulse2;
          this.pendingWave = { at: this.time + 45, size: pulse2, edges, types: w.types };
        } else {
          edges = [(this.rng() * 4) | 0];
        }
        this._spawnHorde(size, edges, w.types);
        if (w.final) this._spawnBoss(edges[0]);
        // WC3-style minimap pings at the spawn edges.
        const N = this.map.size;
        const edgeMid = [[N / 2, 3], [N - 3, N / 2], [N / 2, N - 3], [3, N / 2]];
        for (const ed of edges) this.emit({ type: 'ping', x: edgeMid[ed][0], z: edgeMid[ed][1] });
        const dirName = w.final ? 'ALL DIRECTIONS' : ['the NORTH', 'the EAST', 'the SOUTH', 'the WEST'][edges[0]];
        this.msg(w.final
          ? `☠️ THE FINAL HORDE HAS ARRIVED FROM ${dirName}! Survive this and the land is yours!`
          : `⚠️ A horde of ${size} approaches from ${dirName}!`, 'bad');
        this.emit({ type: 'horde', final: !!w.final });
        if (w.final) this.finalSpawned = true;
      }
    }
    // Ambient night stragglers belong to the old RTS mode. Plot Survival gets
    // one clear raid each night so the rhythm stays legible.
    this.ambientTimer -= 1 / 30;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 22 + this.rng() * 15;
      if (this.isNight && !this.plotMode && !this.finalSpawned) {
        const n = Math.round((2 + this.rng() * 4) * this.diff.ambient);
        this._spawnHorde(n, [(this.rng() * 4) | 0], { walker: 0.9, runner: 0.1 });
      }
    }
  }

  _updateEconomy(dt) {
    const e = this.eco;
    this.starving = e.food < 0;
    if (this.plotMode) {
      this.res.wood = 0;
      this.res.stone = 0;
      for (const b of this.buildings) {
        if (b.alive && b.hp < b.maxHp && this.time - (b.hitT || 0) > 12) {
          b.hp = Math.min(b.maxHp, b.hp + (2 + b.maxHp * 0.004) * dt);
        }
      }
      return;
    }
    // Starving slows the economy rather than freezing it — less punishing micro.
    const goldRate = this.starving ? e.gold * 0.4 : e.gold;
    this.res.gold = Math.max(0, this.res.gold + goldRate * dt);
    this.res.wood += e.wood * dt;
    this.res.stone += e.stone * dt;

    // Buildings slowly mend themselves once zombies leave them alone.
    for (const b of this.buildings) {
      if (b.alive && b.hp < b.maxHp && this.time - (b.hitT || 0) > 12) {
        b.hp = Math.min(b.maxHp, b.hp + (2 + b.maxHp * 0.004) * dt);
      }
    }
  }

  _dawnIncomeFor(b) {
    if (!b?.alive) return 0;
    const table = {
      hq: 90,
      tent: 45,
      farm: 70,
      sawmill: 55,
      quarry: 85,
      mine: 130,
      mill: 45,
    };
    return table[b.key] || 0;
  }

  _onDawn() {
    let payout = 0;
    for (const b of this.buildings) payout += this._dawnIncomeFor(b);
    payout = Math.round(payout);
    if (payout > 0) this.res.gold += payout;
    this._replenishBarracksSquads();
    this.msg(payout > 0
      ? `☀️ Dawn breaks. The city pays ${payout} coins. Build before nightfall.`
      : '☀️ Dawn breaks. Build before nightfall.', 'info');
  }

  _updatePlotFunding(dt) {
    this.activePlot = null;
    for (const h of this.heroes) {
      if (!h || h.dead) continue;
      let best = null;
      let bd = PLOT_PAY_RADIUS * PLOT_PAY_RADIUS;
      for (const plot of this.plots) {
        plot.payFx = Math.max(0, (plot.payFx || 0) - dt);
        if (plot.built) continue;
        const d = dist2(h.x, h.z, plot.cx, plot.cz);
        if (d < bd) { bd = d; best = plot; }
      }
      if (!best) {
        h.buildHoldT = 0;
        continue;
      }
      this.activePlot = best;
      if (this._activePlotId !== best.id) {
        this._activePlotId = best.id;
        this.msg(`${BUILDINGS[best.key].name}: ${plotEffectText(best.key)} Hold Space to build: ${plotCostText(best)}.`, 'info');
      }
      if (this.isNight) {
        if (h.buildHold && this.time - (this._plotNightMsgT || -99) > 1.5) {
          this._plotNightMsgT = this.time;
          this.msg('Build during the day. Defend through the night.', 'warn');
        }
        continue;
      }
      if (!h.buildHold) {
        h.buildHoldT = 0;
        continue;
      }
      const cost = plotCost(best.key);
      let paid = false;
      for (const res of ['gold', 'wood', 'stone']) {
        const need = cost[res] - (best.paid[res] || 0);
        if (need <= 0) continue;
        const spend = Math.min(need, this.res[res] || 0, (PLOT_PAY_RATE[res] || 80) * dt);
        if (spend <= 0) continue;
        this.res[res] -= spend;
        best.paid[res] = (best.paid[res] || 0) + spend;
        paid = true;
      }
      if (paid) {
        h.buildHoldT = (h.buildHoldT || 0) + dt;
        if ((best.payFx || 0) <= 0) {
          best.payFx = 0.35;
          this.emit({ type: 'plotpay', x: best.cx, z: best.cz, key: best.key });
        }
      } else if (this.time - (this._plotNoCoinMsgT || -99) > 1.5) {
        this._plotNoCoinMsgT = this.time;
        this.msg('Need more coins before this foundation can keep building.', 'warn');
      }
      if (plotComplete(best)) this._constructPlot(best);
    }
    if (!this.activePlot) this._activePlotId = null;
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

      if (zb.boss) this._updateBoss(zb, dt);

      // Hero ability debuffs.
      if (zb.dotT > 0) { zb.dotT -= dt; this.damageZombie(zb, zb.dotDps * dt); if (zb.dead) continue; }
      if (zb.stunT > 0) { zb.stunT -= dt; continue; }
      if (zb.blindT > 0) {
        // Blinded: shuffle harmlessly, no targets, no attacks.
        zb.blindT -= dt;
        const a = zb.phase + this.time * 0.7;
        this._moveZombie(zb, Math.cos(a), Math.sin(a), zb.def.speed * 0.35, dt, false);
        continue;
      }
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
      // 1) Chase a nearby living unit if close. Stealthed heroes are invisible.
      if (zb.targetU && (zb.targetU.dead || zb.targetU.stealth || dist2(zb.x, zb.z, zb.targetU.x, zb.targetU.z) > 130)) zb.targetU = null;
      zb.retarget = (zb.retarget || 0) - dt;
      if (!zb.targetU && zb.retarget <= 0) {
        zb.retarget = 0.4 + this.rng() * 0.3;
        let best = null, bd = 100; // within 10 tiles
        for (const u of this.units) {
          if (u.dead || (u.hero && u.stealth)) continue;
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
      if (u.turret || u.summon) {
        u.life -= dt;
        if (u.life <= 0) { u.dead = true; this.emit({ type: 'turretend', x: u.x, z: u.z }); continue; }
      }

      // Thronefall-style hero steering. W/S/A/D maps directly to minimap north/south/west/east.
      if (u.hero && (u.moveX || u.moveZ) && (u.channelT || 0) <= 0) {
        const moveMult = (u.moveT > 0 ? u.moveMult : 1) * (u.sprint ? 1.45 : 1);
        this._moveUnitDirect(u, u.moveX || 0, u.moveZ || 0, u.def.speed * moveMult, dt);
      } else if (u.path) {
        const [wx, wz] = u.path[u.pathI];
        const dx = wx - u.x, dz = wz - u.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.15) {
          u.pathI++;
          if (u.pathI >= u.path.length) {
            u.path = null;
            u.moveOrderX = null;
            u.moveOrderZ = null;
            u.holdX = u.x;
            u.holdZ = u.z;
          }
        } else {
          const moveMult = u.hero && u.moveT > 0 ? u.moveMult : 1;
          const sp = u.def.speed * moveMult * dt;
          u.x += (dx / d) * Math.min(sp, d);
          u.z += (dz / d) * Math.min(sp, d);
          u.facing = Math.atan2(dx, dz);
        }
      }

      // Heroes can't act while channeling a teleport.
      if (u.hero && u.channelT > 0) continue;

      // Auto-attack — Dota-style, units fire even while moving.
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
      // Summons chase their prey instead of waiting for it.
      if (u.summon && !u.path && u.target && !u.target.dead) {
        const dx = u.target.x - u.x, dz = u.target.z - u.z;
        const d = Math.hypot(dx, dz);
        if (d > u.def.range * 0.9) {
          const nx = u.x + (dx / d) * u.def.speed * dt;
          const nz = u.z + (dz / d) * u.def.speed * dt;
          if (this.map.isWalkable(nx | 0, nz | 0) && this.occ[(nz | 0) * this.map.size + (nx | 0)] === 0) {
            u.x = nx; u.z = nz;
          }
          u.facing = Math.atan2(dx, dz);
        }
      }
      if (u.target && !u.target.dead && u.cooldown <= 0) {
        const zb = u.target;
        if (dist2(u.x, u.z, zb.x, zb.z) <= u.def.range * u.def.range) {
          const haste = u.hero && u.hasteT > 0 ? u.hasteMult : 1;
          u.cooldown = 1 / (u.def.rof * haste);
          u.facing = Math.atan2(zb.x - u.x, zb.z - u.z);
          let dmg = u.hero ? this.heroDmg(u) : u.def.dmg;
          if (u.buffT > 0) dmg *= u.buffMult;
          // Cloak & Dagger: the shot that breaks stealth hits like a truck.
          if (u.hero && u.stealth) {
            const ci = u.def.abilities.findIndex((a) => a.key === 'cloak');
            if (ci >= 0 && u.abil[ci].rank > 0) dmg *= u.def.abilities[ci].backstab[u.abil[ci].rank - 1];
            u.stealth = false;
            this.emit({ type: 'backstab', x: zb.x, z: zb.z });
          }
          u.sinceAtk = 0;
          this.damageZombie(zb, dmg, u.x, u.z);
          // Marksman's Focus: chance to mini-stun; kills permanently add damage.
          if (u.hero) {
            const fi = u.def.abilities.findIndex((a) => a.key === 'focus');
            if (fi >= 0 && u.abil[fi].rank > 0) {
              const ab = u.def.abilities[fi];
              const rk = u.abil[fi].rank - 1;
              if (!zb.dead && this.rng() < ab.stunChance[rk]) zb.stunT = Math.max(zb.stunT || 0, ab.stunDur);
              if (zb.dead) u.bonusDmg = Math.min(ab.heapCap[rk], (u.bonusDmg || 0) + ab.heap[rk]);
            }
          }
          const kind = u.summon ? 'melee' : u.hero ? (u.def.melee ? 'melee' : 'hero') : u.key;
          this.emit({ type: 'shot', kind, fx: u.x, fz: u.z, tx: zb.x, tz: zb.z, fy: u.hero ? 0.9 : 0.7 });
          if (u.def.noise > 0) this.wakeZombies(u.x, u.z, u.def.noise);
        } else {
          u.target = null;
        }
      }
    }
  }

  _updateTowers(dt) {
    for (const b of this.buildings) {
      if (!b.alive || b.key !== 'tower') continue;
      b.cooldown -= dt;
      if (b.rofBuffT > 0) b.rofBuffT -= dt;
      if (b.stunT > 0) { b.stunT -= dt; continue; }
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
    if (this.finalSpawned && !this.pendingWave) {
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
