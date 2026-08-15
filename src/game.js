// Core simulation — Thronefall-style: a pre-designed city of plots you bring
// to life with coins, a wave every night, direct hero control, rally-to-me
// troops. Pure logic — rendering/audio consume `game.events` each frame.
import {
  PLOT_KINDS, UNITS, ZOMBIES, TILE, DIFFICULTY, LEVELS,
  NIGHT_MAX, FINAL_NIGHT, waveForNight,
  START_GOLD, COIN_CAP, COIN_RADIUS, PAY_RADIUS, PAY_RATE,
  ZOMBIE_CAP, UNIT_CAP, DROPS, itemMods,
  HEROES, HERO_MAX_LEVEL, XP_RADIUS, xpForLevel, abilityRank,
} from './config.js';
import { FlowField } from './flowfield.js';
import { generatePlots } from './plots.js';
import { dist2, makeRNG } from './utils.js';

const IDLE = 0, WANDER = 1, AGGRO = 2;

let nextId = 1000;
const getNextId = () => nextId;
const setNextId = (v) => { nextId = v; };

export class Game {
  // heroKeys: a hero key string (solo) or an array of keys (co-op, one per player).
  constructor(map, difficulty = 'normal', heroKeys = 'alexander', snap = null, levelId = 1, mode = 'campaign') {
    this.map = map;
    this.diffKey = difficulty;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.levelId = snap ? snap.level : levelId;
    this.mode = snap ? snap.mode || 'campaign' : mode;
    this.level = LEVELS[(this.levelId || 1) - 1] || LEVELS[0];
    this.boss = null;
    this.rng = makeRNG(999);

    this.gold = START_GOLD;
    this.coins = [];             // physical coins on the ground
    this.site = -1;              // chosen city site index (-1 = not founded yet)
    this.plots = [];             // generated when the city is founded
    this.buildings = [];
    this.units = [];
    this.zombies = [];
    this.occ = new Int32Array(map.size * map.size); // building id per tile
    this.gateIds = new Set();    // building ids friendlies may pass through
    this.flow = new FlowField(map);
    this.flowDirty = true;
    this.flowTimer = 0;

    // Hive nests: the enemy's bases. Nightly waves march from them, and they
    // can be razed — raze them all on a campaign map and the land is won.
    this.nests = (map.nestSpots || []).map((s, i) => {
      const hp = Math.round(2200 * this.level.mult * Math.max(0.6, this.diff.mult));
      return { id: i, x: s[0] + 0.5, z: s[1] + 0.5, hp, maxHp: hp, alive: true };
    });

    this.stance = 'defend';      // army stance: defend | guard | attack (no micro)
    this.time = 0;
    this.night = 1;              // current day/night number (1..FINAL_NIGHT)
    this.phase = 'day';
    this.phaseT = 0;             // day: counts up (untimed); night: counts down
    this.belling = false;
    this.nightPlan = null;
    this.over = false;
    this.won = false;

    this.events = [];            // consumed by renderer/audio each frame
    this.messages = [];          // consumed by UI

    this.stats = { kills: 0, built: 0, lost: 0, coins: 0, nests: 0, heroDeaths: 0, bossKillT: null };

    // heroKeys entries: 'scott' (fresh) or { k, camp: { level, xp, items, relics } }
    // — the WC3-style persistent campaign hero each player brings along.
    this.heroSetups = (Array.isArray(heroKeys) ? heroKeys : [heroKeys])
      .map((e) => (typeof e === 'string' ? { k: e, camp: null } : { k: e.k, camp: e.camp || null }));
    this.heroKeys = this.heroSetups.map((e) => e.k);
    this.relics = [];
    for (const e of this.heroSetups) {
      for (const r of (e.camp && e.camp.relics) || []) if (!this.relics.includes(r)) this.relics.push(r);
    }
    this.relicMods = itemMods(this.relics);
    this.heroes = [];
    this.hero = null;            // heroes[0], kept for solo call sites

    if (snap) this._restore(snap);
    else this._setupStart();
  }

  // ---------- save / restore (v2: plot economy) ----------

  snapshot() {
    return {
      v: 3, seed: this.map.seed, diff: this.diffKey, heroKeys: this.heroKeys, level: this.levelId, mode: this.mode,
      time: +this.time.toFixed(3), night: this.night, phase: this.phase, phaseT: +this.phaseT.toFixed(3),
      belling: this.belling ? +this.bellT.toFixed(3) : -1,
      gold: +this.gold.toFixed(3),
      site: this.site,
      stance: this.stance,
      relics: [...this.relics],
      nests: this.nests.map((n) => [Math.round(n.hp), n.alive ? 1 : 0]),
      nightPlan: this.nightPlan ? { ...this.nightPlan } : null,
      stats: { ...this.stats },
      rng: this.rng.getState(), nextId: getNextId(),
      plots: this.plots.map((p) => ({ id: p.id, tier: p.tier, paid: +p.paid.toFixed(3), branch: p.branch })),
      buildings: this.buildings.map((b) => ({
        id: b.id, p: b.plotId, x: b.x, z: b.z, hp: +b.hp.toFixed(1), g: b.gate ? 1 : 0,
      })),
      coins: this.coins.map((cn) => [+cn.x.toFixed(2), +cn.z.toFixed(2), cn.v]),
      units: this.units.filter((u) => !u.hero).map((u) => ({
        id: u.id, k: u.key, x: +u.x.toFixed(3), z: +u.z.toFixed(3),
        hp: +u.hp.toFixed(2), camp: u.camp || 0,
        hx: +(u.holdX || u.x).toFixed(2), hz: +(u.holdZ || u.z).toFixed(2),
      })),
      heroes: this.heroes.map((h) => ({
        id: h.id, k: h.key, x: +h.x.toFixed(3), z: +h.z.toFixed(3), hp: +h.hp.toFixed(1),
        dead: !!h.dead, reviveT: +(h.reviveT || 0).toFixed(1),
        level: h.level, xp: Math.round(h.xp), cd: +h.abilCd.toFixed(1),
        items: [...(h.items || [])],
      })),
      zombies: this.zombies.map((z) => [z.type, +z.x.toFixed(2), +z.z.toFixed(2), +z.hp.toFixed(1), z.state, z.wave ? 1 : 0, z.boss ? 1 : 0, z.enraged ? 1 : 0]),
    };
  }

  _restore(snap) {
    this.time = snap.time;
    this.night = snap.night;
    this.phase = snap.phase;
    this.phaseT = snap.phaseT;
    if (snap.belling != null && snap.belling >= 0) { this.belling = true; this.bellT = snap.belling; }
    this.gold = snap.gold;
    this.site = snap.site ?? -1;
    this.stance = snap.stance || 'defend';
    if (this.site >= 0) this.plots = generatePlots(this.map, this.map.sites[this.site]);
    this.relics = [...(snap.relics || [])];
    this.relicMods = itemMods(this.relics);
    (snap.nests || []).forEach(([hp, alive], i) => {
      if (this.nests[i]) { this.nests[i].hp = hp; this.nests[i].alive = !!alive; }
    });
    this.nightPlan = snap.nightPlan ? { ...snap.nightPlan } : null;
    this.stats = { nests: 0, heroDeaths: 0, bossKillT: null, ...snap.stats };

    for (const ps of snap.plots) {
      const p = this.plots.find((o) => o.id === ps.id);
      if (p) { p.tier = ps.tier; p.paid = ps.paid; p.branch = ps.branch; }
    }
    for (const bs of snap.buildings) {
      const plot = this.plots.find((o) => o.id === bs.p);
      if (!plot) continue;
      const def = this.tierDef(plot, plot.tier);
      this._addBuilding(plot, bs.x, bs.z, def, !!bs.g, bs.id, bs.hp);
    }
    this.hq = this.buildings.find((b) => b.kind === 'hq');
    this.coins = snap.coins.map(([x, z, v]) => ({ id: nextId++, x, z, v }));

    for (const us of snap.units) {
      const u = this._spawnUnit(us.k, us.x, us.z, us.camp || null);
      u.id = us.id; // keep saved ids so they can't collide with future spawns
      u.hp = us.hp;
      u.holdX = us.hx; u.holdZ = us.hz;
    }
    for (const hs of snap.heroes) {
      const h = this._spawnHero(hs.k, hs.x, hs.z, { level: hs.level, xp: hs.xp, items: hs.items || [] });
      if (hs.id) h.id = hs.id;
      h.hp = hs.hp;
      h.abilCd = hs.cd;
      if (hs.dead) {
        h.dead = true;
        h.reviveT = hs.reviveT;
        this.units = this.units.filter((u) => u !== h);
      }
    }
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

    this.rng.setState(snap.rng);
    setNextId(snap.nextId);
    this.flowDirty = true;
    this.msg('📂 The city stands as you left it — the fight continues.', 'info');
  }

  // ---------- setup ----------

  // The run opens un-founded: heroes ride a wild frontier dotted with marked
  // city sites and hive nests. Claim a site to raise the city there.
  _setupStart() {
    this.phase = 'found';
    const c = this.map.size / 2;
    this.heroSetups.forEach((e, i) => this._spawnHero(e.k, c - 1 + i * 2, c + 3.5, e.camp));
    this._scatterCreeps();
    this.msg('🏳️ The frontier is yours to claim. Ride to a marked site and press SPACE to found your city.', 'info');
  }

  foundCity(siteIdx, p = 0) {
    if (this.phase !== 'found' || this.over) return;
    const site = this.map.sites[siteIdx];
    if (!site) return;
    this.site = siteIdx;
    this.plots = generatePlots(this.map, site);
    const hqPlot = this.plots.find((pl) => pl.kind === 'hq');
    this._construct(hqPlot, true); // the Keep rises with the founding
    this.hq = this.buildings.find((b) => b.kind === 'hq');
    this.heroes.forEach((h, i) => {
      if (!h.dead) { h.x = this.hq.cx - 1 + i * 2; h.z = this.hq.cz + 3.5; }
    });
    this.phase = 'day';
    this.phaseT = 0;
    this.flowDirty = true;
    this._planNight();
    this.emit({ type: 'founded', site: siteIdx, x: site.x, z: site.z });
    const founder = this.heroes[p];
    this.msg(`🏰 ${founder ? founder.def.name : 'The company'} founds the city! Collect coins, hold B at foundations — night is coming.`, 'info');
  }

  _scatterCreeps() {
    const N = this.map.size;
    const count = Math.round(110 * this.diff.ambient);
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 30) {
      const x = 2 + this.rng() * (N - 4), z = 2 + this.rng() * (N - 4);
      if (this.map.sites.some((s) => Math.hypot(x - s.x, z - s.z) < 26)) continue;
      if (!this.map.isWalkable(x | 0, z | 0)) continue;
      const type = this.rng() < 0.92 ? 'walker' : 'runner';
      this._spawnZombie(type, x, z, false);
      placed++;
    }
    // Every hive nest keeps a garrison — razing one is a fight, not a stroll.
    for (const n of this.nests) {
      const guards = 6 + Math.round(4 * this.diff.mult);
      for (let i = 0; i < guards; i++) {
        const a = this.rng() * Math.PI * 2, r = 2 + this.rng() * 4;
        const x = n.x + Math.cos(a) * r, z = n.z + Math.sin(a) * r;
        if (this.map.isWalkable(x | 0, z | 0)) {
          this._spawnZombie(this.rng() < 0.85 ? 'walker' : 'runner', x, z, false);
        }
      }
    }
  }

  // ---------- helpers ----------

  msg(text, kind = 'info') { this.messages.push({ text, kind, t: this.time }); }
  emit(e) { this.events.push(e); }

  get day() { return this.night; }
  get isNight() { return this.phase === 'night'; }

  // ---------- plots & construction ----------

  // Definition of a plot's tier (1-based). Handles wall per-tile cost & branches.
  tierDef(plot, tier) {
    const kind = PLOT_KINDS[plot.kind];
    const t = kind.tiers[tier - 1];
    if (!t) return null;
    if (t.branch) {
      const opt = t.options[plot.branch];
      if (!opt) return null;
      const def = { ...opt, branch: plot.branch };
      if (kind.perTile) def.cost = Math.ceil(def.cost * plot.tiles.length);
      return def;
    }
    if (kind.perTile) {
      return { ...t, cost: Math.ceil(t.cost * plot.tiles.length) };
    }
    return t;
  }

  // What the next purchase on this plot is, or null when maxed / awaiting a branch pick.
  nextTier(plot) {
    const kind = PLOT_KINDS[plot.kind];
    const idx = plot.tier + 1;
    if (idx > kind.tiers.length) return null;
    const t = kind.tiers[idx - 1];
    if (t && t.branch && !plot.branch) return { branch: true, options: t.options };
    const def = this.tierDef(plot, idx);
    return def ? { def, cost: def.cost } : null;
  }

  // Where you stand to fund a plot. Foundations: stand on them. Built
  // structures: a discrete pay plate at their foot (Thronefall's buy plates),
  // so sweeping dawn coins never dribbles gold into upgrades by accident.
  payPoint(plot) {
    if (plot.kind === 'wall') return [plot.gate[0] + 0.5, plot.gate[1] + 0.5];
    if (plot.tier === 0) return [plot.cx, plot.cz];
    if (!plot._plate) {
      const s = plot.size;
      const cands = [
        [plot.cx, plot.z + s + 0.9], [plot.cx, plot.z - 0.9],
        [plot.x + s + 0.9, plot.cz], [plot.x - 0.9, plot.cz],
      ];
      plot._plate = cands.find(([x, z]) => this.map.isWalkable(x | 0, z | 0)) || cands[0];
    }
    return plot._plate;
  }

  // The hero's nearest fundable plot — what holding the build key would pay
  // into. Shared by the sim and by the HUD prompt.
  buildTargetFor(h) {
    let best = null, bd = PAY_RADIUS * PAY_RADIUS, bestNt = null;
    for (const plot of this.plots) {
      const nt = this.nextTier(plot);
      if (!nt || nt.branch) continue;
      const [px, pz] = this.payPoint(plot);
      const d = dist2(h.x, h.z, px, pz);
      if (d <= bd) { bd = d; best = plot; bestNt = nt; }
    }
    return best ? { plot: best, nt: bestNt } : null;
  }

  // Thronefall building: walk to a foundation and HOLD the build key — coins
  // fly from your purse into the plot one by one until it rises. Partial
  // payments persist, so letting go never wastes anything.
  _updatePlots(dt) {
    if (this.over) return;
    if (this.phase !== 'day') return; // no building at night — fight!
    for (const h of this.heroes) {
      if (h.dead || !h.payHold) continue;
      const target = this.buildTargetFor(h);
      if (!target) continue;
      const { plot, nt } = target;
      const need = nt.cost - plot.paid;
      const pay = Math.min(PAY_RATE * dt, this.gold, need);
      if (pay <= 0) continue;
      this.gold -= pay;
      plot.paid += pay;
      plot.payFx = 0.3; // renderer hint
      // Emit one arc-coin per whole gold piece — the Thronefall purse animation.
      const [px, pz] = this.payPoint(plot);
      h._coinAcc = (h._coinAcc || 0) + pay;
      if (h._coinAcc >= 1) {
        const n = Math.floor(h._coinAcc);
        h._coinAcc -= n;
        this.emit({ type: 'paycoin', fx: h.x, fz: h.z, tx: px, tz: pz, n: Math.min(n, 4) });
      }
      if (plot.paid >= nt.cost - 1e-6) {
        plot.paid = 0;
        this._construct(plot);
      }
    }
  }

  _construct(plot, free = false) {
    plot.tier++;
    const def = this.tierDef(plot, plot.tier);
    if (!free) this.stats.built++;

    if (plot.kind === 'wall') {
      // One building per rampart tile; the gate tile lets friendlies through.
      if (plot.tier === 1) {
        for (const [x, z] of plot.tiles) {
          this._addBuilding(plot, x, z, def, x === plot.gate[0] && z === plot.gate[1]);
        }
      } else {
        for (const b of this.buildings) {
          if (b.plotId === plot.id) { b.def = def; b.maxHp = this._bhp(def); b.hp = b.maxHp; }
        }
      }
    } else if (plot.tier === 1) {
      this._addBuilding(plot, plot.x, plot.z, def, false);
    } else {
      for (const b of this.buildings) {
        if (b.plotId === plot.id) { b.def = def; b.maxHp = this._bhp(def); b.hp = b.maxHp; }
      }
    }

    // Camps field a squad immediately (and refill at dawn).
    if (PLOT_KINDS[plot.kind].unit) this._refillCamp(plot);

    this.emit({ type: 'build', kind: plot.kind, plotId: plot.id, tier: plot.tier, x: plot.cx, z: plot.cz });
    if (!free) this.msg(`${PLOT_KINDS[plot.kind].icon} ${def.name} ${plot.tier > 1 ? 'upgraded' : 'raised'}!`, 'info');
  }

  // Structure HP through the civilization's relics (Masonry Codex et al).
  _bhp(def) { return Math.round(def.hp * (1 + this.relicMods.buildingHp)); }

  _addBuilding(plot, x, z, def, gate, id = null, hp = null) {
    const size = plot.kind === 'wall' ? 1 : plot.size;
    const maxHp = this._bhp(def);
    const b = {
      id: id || nextId++, plotId: plot.id, kind: plot.kind, key: plot.kind,
      def, x, z, size,
      cx: x + size / 2, cz: z + size / 2,
      hp: hp != null ? hp : maxHp, maxHp, alive: true, cooldown: 0, gate,
    };
    this.buildings.push(b);
    for (let dz = 0; dz < size; dz++) for (let dx = 0; dx < size; dx++) {
      this.occ[(z + dz) * this.map.size + (x + dx)] = b.id;
    }
    if (gate) this.gateIds.add(b.id);
    // Eject anyone standing on the fresh foundation — you pay standing ON the
    // plot, so the new walls must not entomb you.
    for (const u of this.units) {
      const ux = u.x | 0, uz = u.z | 0;
      if (ux >= x && ux < x + size && uz >= z && uz < z + size) this._ejectActor(u, b);
    }
    this.flowDirty = true;
    return b;
  }

  _ejectActor(u, b) {
    const N = this.map.size;
    for (let r = 1; r < 8; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = (b.x + (b.size >> 1)) + dx, nz = (b.z + (b.size >> 1)) + dz;
          if (nx < 1 || nz < 1 || nx >= N - 1 || nz >= N - 1) continue;
          if (this.map.isWalkable(nx, nz) && this.occ[nz * N + nx] === 0) {
            u.x = nx + 0.5; u.z = nz + 0.5;
            return;
          }
        }
      }
    }
  }

  _refillCamp(plot) {
    const kindDef = PLOT_KINDS[plot.kind];
    const def = this.tierDef(plot, plot.tier);
    if (!def) return;
    const have = this.units.filter((u) => u.camp === plot.id && !u.dead).length;
    for (let i = have; i < def.count && this.units.length < UNIT_CAP; i++) {
      const a = (i / def.count) * Math.PI * 2;
      this._spawnUnit(kindDef.unit, plot.cx + Math.cos(a) * 1.6, plot.cz + 1.4 + Math.sin(a) * 0.8, plot.id);
    }
  }

  chooseBranch(plotId, branch, p = 0) {
    const plot = this.plots.find((o) => o.id === plotId);
    if (!plot) return;
    const nt = this.nextTier(plot);
    if (!nt || !nt.branch || !nt.options[branch]) return;
    plot.branch = branch;
    this.emit({ type: 'branch', x: plot.cx, z: plot.cz });
    this.msg(`${nt.options[branch].icon} Doctrine chosen: ${nt.options[branch].name}. Hold B beside it to fund it.`, 'info');
  }

  _destroyBuilding(b, byZombie) {
    b.alive = false;
    b.hp = 0;
    for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) {
      const i = (b.z + dz) * this.map.size + (b.x + dx);
      if (this.occ[i] === b.id) this.occ[i] = 0;
    }
    this.gateIds.delete(b.id);
    this.buildings = this.buildings.filter((o) => o !== b);
    this.flowDirty = true;
    if (byZombie) {
      this.stats.lost++;
      this.emit({ type: 'bdestroyed', x: b.cx, z: b.cz });
      if (b.kind === 'hq') { this._gameOver(false); return; }
      // Thronefall-style: ruins rebuild free at dawn — the real price is a
      // night without that tower/income/camp.
      this.msg(b.kind === 'wall' ? '🧱 The wall is breached!' : `${PLOT_KINDS[b.kind].icon} ${b.def.name} destroyed! It will be rebuilt at dawn.`, 'bad');
    }
  }

  // ---------- day / night cycle ----------

  _planNight() {
    // Co-op: the same city, the same shared purse — but more heroes on the
    // field means the hive sends more dead (+40% wave size per extra player).
    const coopMult = 1 + 0.4 * (this.heroKeys.length - 1);
    const w = waveForNight(this.night, this.diff.mult * this.level.mult * coopMult);
    // The wave marches from living hive nests (the enemy's bases). Fewer
    // nests left standing = fewer directions to defend.
    const alive = this.nests.filter((n) => n.alive);
    const picks = [];
    const pool = alive.map((n) => n.id);
    for (let i = 0; i < Math.min(w.edges, pool.length); i++) {
      picks.push(pool.splice((this.rng() * pool.length) | 0, 1)[0]);
    }
    const final = this.mode === 'campaign' && w.final;
    // Survival: a boss leads every 5th night, cycling the campaign roster
    // with ever-growing health.
    const bossNight = this.mode === 'survival' && this.night % 5 === 0;
    this.nightPlan = { size: w.size, types: w.types, nests: picks, final, boss: final || bossNight };
    this.emit({ type: 'nightplan', spots: picks.map((id) => [this.nests[id].x, this.nests[id].z]) });
  }

  // Which boss stalks this night (survival cycles the roster).
  nightBossDef() {
    if (this.mode === 'campaign') return this.level.boss;
    const base = LEVELS[Math.max(0, (((this.night / 5) | 0) - 1) % LEVELS.length)].boss;
    return { ...base, hp: Math.round(base.hp * (0.8 + this.night * 0.06)) };
  }

  // Thronefall-exact: the day is untimed — night begins only when someone
  // rings the bell (then a short dusk countdown).
  bell(p = 0) {
    if (this.phase !== 'day' || this.over || this.belling) return;
    this.belling = true;
    this.phaseT = 3;
    const h = this.heroes[p];
    this.msg(`🔔 ${h ? h.def.name : 'The city'} rings the bell — night falls!`, 'warn');
    this.emit({ type: 'bell' });
  }

  _updatePhase(dt) {
    if (this.phase === 'found') return; // the clock starts when the city does
    if (this.phase === 'day') {
      // Castle-defense alternate victory: raze every hive and the land is won.
      if (this.mode === 'campaign' && this.site >= 0 && this.nests.length && this.nests.every((n) => !n.alive)) {
        this.msg('🔥 Every hive lies in ashes. The source is cleansed!', 'info');
        this._gameOver(true);
        return;
      }
      this.phaseT += dt; // day length is informational only
      if (this.belling) {
        this.bellT = (this.bellT ?? 3) - dt;
        if (this.bellT <= 0) { this.belling = false; this.bellT = null; this._startNight(); }
      }
    } else {
      this.phaseT -= dt;
      // Night ends when the wave is destroyed (or the safety timer runs out).
      let waveLeft = 0;
      for (const zb of this.zombies) if (zb.wave && !zb.dead) waveLeft++;
      if (waveLeft === 0) {
        if (this.nightPlan && this.nightPlan.final) { this._gameOver(true); return; }
        this._startDay();
      } else if (this.phaseT <= 0 && !(this.nightPlan && this.nightPlan.final)) {
        // Safety valve — but the final night only ends in victory or defeat.
        this._startDay();
      }
    }
  }

  // Compass label for a nest as seen from the city.
  _dirName(x, z) {
    const cx = this.hq ? this.hq.cx : this.map.size / 2;
    const cz = this.hq ? this.hq.cz : this.map.size / 2;
    const a = Math.atan2(z - cz, x - cx);
    const names = ['EAST', 'SOUTHEAST', 'SOUTH', 'SOUTHWEST', 'WEST', 'NORTHWEST', 'NORTH', 'NORTHEAST'];
    return names[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  }

  _startNight() {
    this.phase = 'night';
    this.phaseT = NIGHT_MAX;
    const plan = this.nightPlan;
    this._spawnHorde(plan.size, plan.nests || [], plan.types);
    if (plan.boss) this._spawnBoss((plan.nests || [])[0]);
    for (const id of plan.nests || []) this.emit({ type: 'ping', x: this.nests[id].x, z: this.nests[id].z });
    const dirNames = [...new Set((plan.nests || []).map((id) => this._dirName(this.nests[id].x, this.nests[id].z)))];
    this.msg(plan.final
      ? `☠️ THE FINAL NIGHT. Everything they have, all at once. Survive this and the land is yours!`
      : `🌙 Night ${this.night}: ${plan.size} of the dead march from the ${dirNames.length ? dirNames.join(' and ') : 'wilds'}!${plan.boss ? ' Something enormous walks among them…' : ''}`, 'bad');
    this.emit({ type: 'horde', final: !!plan.final });
    this.emit({ type: 'night' });
  }

  _startDay() {
    // Straggling wave zombies (safety timeout) keep fighting, but the sun
    // rises. Bosses stay "wave" — a night is never clear while one stands.
    for (const zb of this.zombies) if (zb.wave && !zb.boss) zb.wave = false;
    this.night++;
    this.phase = 'day';
    this.phaseT = 0;
    this.belling = false;
    this.bellT = null;
    this._dawnPayout();
    this._repairCity();
    this._planNight();
    this.msg(`☀️ Dawn of day ${this.night}. The city pays its taxes — go collect!`, 'info');
    this.emit({ type: 'dawn' });
  }

  _dawnPayout() {
    for (const b of this.buildings) {
      const inc = b.def.income ? Math.round(b.def.income * (1 + this.relicMods.income)) : 0;
      if (!inc || !b.alive) continue;
      // Split income into a handful of coins fountaining around the building.
      const n = Math.min(6, Math.max(2, Math.round(inc / 3)));
      const each = Math.floor(inc / n);
      let rem = inc - each * n;
      const plot = this.plots.find((p) => p.id === b.plotId);
      const plate = plot ? this.payPoint(plot) : null;
      for (let i = 0; i < n; i++) {
        const a = this.rng() * Math.PI * 2;
        const r = 1.4 + this.rng() * 1.8;
        let x = b.cx + Math.cos(a) * r, z = b.cz + Math.sin(a) * r;
        // Keep coins off the pay plate so sweeping them never funds upgrades
        // by accident.
        if (plate && dist2(x, z, plate[0], plate[1]) < 4) { x = 2 * b.cx - x; z = 2 * b.cz - z; }
        if (!this.map.isWalkable(x | 0, z | 0)) { x = b.cx; z = b.cz + b.size / 2 + 0.8; }
        this._spawnCoin(x, z, each + (rem-- > 0 ? 1 : 0), b.cx, b.cz);
      }
    }
  }

  _repairCity() {
    for (const b of this.buildings) if (b.alive) b.hp = b.maxHp;
    // Ruined structures (and breached wall tiles) rise again with the sun.
    for (const plot of this.plots) {
      if (plot.tier === 0) continue;
      const def = this.tierDef(plot, plot.tier);
      if (plot.kind === 'wall') {
        for (const [x, z] of plot.tiles) {
          if (this.occ[z * this.map.size + x] === 0) {
            this._addBuilding(plot, x, z, def, x === plot.gate[0] && z === plot.gate[1]);
            this.emit({ type: 'build', kind: 'wall', plotId: plot.id, tier: plot.tier, x: x + 0.5, z: z + 0.5, quiet: true });
          }
        }
      } else if (!this.buildings.some((b) => b.plotId === plot.id)) {
        this._addBuilding(plot, plot.x, plot.z, def, false);
        this.emit({ type: 'build', kind: plot.kind, plotId: plot.id, tier: plot.tier, x: plot.cx, z: plot.cz, quiet: true });
      }
    }
    // Camps refill their fallen.
    for (const plot of this.plots) {
      if (PLOT_KINDS[plot.kind].unit && plot.tier > 0) this._refillCamp(plot);
    }
  }

  // ---------- coins ----------

  _spawnCoin(x, z, v, fx, fz) {
    if (v <= 0) return;
    if (this.coins.length >= COIN_CAP) {
      // Merge into the nearest coin instead of flooding the ground.
      let best = null, bd = Infinity;
      for (const cn of this.coins) {
        const d = dist2(cn.x, cn.z, x, z);
        if (d < bd) { bd = d; best = cn; }
      }
      if (best) best.v += v;
      return;
    }
    this.coins.push({ id: nextId++, x, z, v });
    this.emit({ type: 'coinspawn', x, z, fx, fz, v });
  }

  _updateCoins() {
    if (!this.coins.length) return;
    let collected = false;
    for (const cn of this.coins) {
      for (const h of this.heroes) {
        if (h.dead) continue;
        const r = COIN_RADIUS + h.mods.magnet;
        if (dist2(h.x, h.z, cn.x, cn.z) <= r * r) {
          cn.gone = true;
          collected = true;
          this.gold += cn.v;
          this.stats.coins += cn.v;
          this.emit({ type: 'coin', x: cn.x, z: cn.z, hx: h.x, hz: h.z, v: cn.v });
          break;
        }
      }
    }
    if (collected) this.coins = this.coins.filter((cn) => !cn.gone);
  }

  // ---------- units ----------

  _spawnUnit(key, x, z, camp = null) {
    const d = UNITS[key];
    const u = {
      id: nextId++, key, def: d, x, z, hp: d.hp, maxHp: d.hp,
      camp, path: null, pathI: 0, cooldown: 0, target: null,
      facing: 0, holdX: x, holdZ: z, retargetT: 0,
    };
    this.units.push(u);
    return u;
  }

  // Army stance — DotA-creep control: no unit micro, just one order for the
  // whole army. DEFEND holds the city, GUARD escorts the heroes, ATTACK
  // marches out to hunt the dead and push the hives on its own.
  setStance(st, p = 0) {
    if (!['defend', 'guard', 'attack'].includes(st) || st === this.stance) return;
    this.stance = st;
    // Defenders remember where home is right now.
    if (st === 'defend') for (const u of this.units) if (!u.hero && !u.dead) { u.holdX = u.x; u.holdZ = u.z; }
    const h = this.heroes[p];
    this.msg(st === 'defend' ? '🛡️ The army falls back to hold the line.'
      : st === 'guard' ? `🚩 The army forms up around ${h ? h.def.name : 'the heroes'}.`
      : '⚔️ The army marches out to hunt!', 'info');
    this.emit({ type: st === 'defend' ? 'hold' : 'rally', x: h ? h.x : 0, z: h ? h.z : 0 });
  }

  // ---------- hero ----------

  // camp: the persistent campaign hero — { level, xp, items } (WC3-style).
  _spawnHero(key, x, z, camp = null) {
    const d = HEROES[key];
    const items = camp && camp.items ? [...camp.items] : [];
    const mods = itemMods(items);
    const level = Math.min(HERO_MAX_LEVEL, (camp && camp.level) || 1);
    const maxHp = d.hp + d.levelHp * (level - 1) + mods.hp;
    const h = {
      id: nextId++, key, def: d, hero: true, x, z,
      hp: maxHp, maxHp,
      mx: 0, mz: 0, sprint: false,
      cooldown: 0, target: null, facing: 0, retargetT: 0,
      level, xp: (camp && camp.xp) || 0, abilCd: 0,
      items, mods,
      reviveT: 0, hasteT: 0, hasteMult: 1,
    };
    this.units.push(h);
    this.heroes.push(h);
    if (!this.hero) this.hero = h;
    return h;
  }

  // Central command entry point — local input and remote co-op players both go
  // through here, so the sim stays deterministic under lockstep.
  exec(c) {
    switch (c.t) {
      case 'hdir': { // hero movement input: direction + sprint flag
        const h = this.heroes[c.p || 0];
        if (h) { h.mx = c.x; h.mz = c.z; h.sprint = !!c.s; }
        break;
      }
      case 'cast': this.castAbility(c.p || 0); break;
      case 'pay': { // hold-to-build: the build key is down/up
        const h = this.heroes[c.p || 0];
        if (h) h.payHold = !!c.on;
        break;
      }
      case 'stance': this.setStance(c.s, c.p || 0); break;
      case 'choose': this.chooseBranch(c.id, c.b, c.p || 0); break;
      case 'bell': this.bell(c.p || 0); break;
      case 'found': this.foundCity(c.s, c.p || 0); break;
    }
  }

  heroDmg(h) {
    return (h.def.dmg + h.def.levelDmg * (h.level - 1)) * (1 + h.mods.dmg);
  }

  addXp(h, amount) {
    if (!h || h.dead || h.level >= HERO_MAX_LEVEL) return;
    h.xp += amount;
    while (h.level < HERO_MAX_LEVEL && h.xp >= xpForLevel(h.level)) {
      h.xp -= xpForLevel(h.level);
      h.level++;
      h.maxHp = h.def.hp + h.def.levelHp * (h.level - 1) + h.mods.hp;
      h.hp = h.maxHp; // full heal on level up
      this.emit({ type: 'levelup', x: h.x, z: h.z });
      const r = abilityRank(h.level);
      const wasR = abilityRank(h.level - 1);
      this.msg(`⭐ ${h.def.name} reached level ${h.level}!${r > wasR ? ` ${h.def.ability.icon} ${h.def.ability.name} rank ${r}!` : ''}`, 'info');
    }
    if (h.level >= HERO_MAX_LEVEL) h.xp = 0;
  }

  castAbility(p = 0) {
    const h = this.heroes[p];
    if (!h || h.dead) return;
    const ab = h.def.ability;
    if (h.abilCd > 0) { this.emit({ type: 'deny' }); return; }
    const r = abilityRank(h.level) - 1;
    h.abilCd = ab.cd * (1 - h.mods.cdr);

    switch (ab.cast) {
      case 'aoeDmg': {
        const r2 = ab.radius * ab.radius;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          if (dist2(h.x, h.z, zb.x, zb.z) <= r2) {
            if (ab.stun) zb.stunT = Math.max(zb.stunT || 0, ab.stun[r]);
            this.damageZombie(zb, ab.dmg[r], h.x, h.z);
          }
        }
        break;
      }
      case 'grenade': {
        // Concussion grenade ahead + a small hop back (Sniper's scepter trick).
        const dirX = Math.sin(h.facing), dirZ = Math.cos(h.facing);
        const ox = h.x, oz = h.z;
        const bx = h.x + dirX * (ab.range || 4), bz = h.z + dirZ * (ab.range || 4);
        const r2 = ab.radius * ab.radius;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          const d2v = dist2(bx, bz, zb.x, zb.z);
          if (d2v > r2) continue;
          const d = Math.sqrt(d2v) || 1;
          // Fling away from the blast (bosses are too heavy to throw).
          if (!zb.boss) {
            const push = ab.knock[r] * (1 - d / (ab.radius + 0.001)) + 0.6;
            const nx = zb.x + ((zb.x - bx) / d) * push, nz = zb.z + ((zb.z - bz) / d) * push;
            if (this.map.isWalkable(nx | 0, nz | 0) && this.occ[(nz | 0) * this.map.size + (nx | 0)] === 0) {
              zb.x = nx; zb.z = nz;
            }
          }
          zb.stunT = Math.max(zb.stunT || 0, ab.stun[r]);
          this.damageZombie(zb, ab.dmg[r], bx, bz);
        }
        for (let step = ab.hop || 3; step > 0.4; step -= 0.4) {
          const nx = ox - dirX * step, nz = oz - dirZ * step;
          if (this.map.isWalkable(nx | 0, nz | 0) && this.occ[(nz | 0) * this.map.size + (nx | 0)] === 0) {
            h.x = nx; h.z = nz;
            break;
          }
        }
        this.emit({ type: 'grenade', fx: ox, fz: oz, tx: bx, tz: bz, r: ab.radius });
        break;
      }
      case 'weave':
        // Shukuchi-style: invisible and fast, passing through the horde —
        // damage lands on everything Danny brushes (see _updateHeroOne).
        h.stealth = true;
        h.weaveT = ab.dur[r];
        h.weaveDmg = ab.dmg[r];
        h.weaveKey = (h.weaveKey || 0) + 1;
        this.emit({ type: 'stealth', x: h.x, z: h.z });
        break;
    }
    this.wakeZombies(h.x, h.z, 8);
    this.emit({ type: 'cast', x: h.x, z: h.z, radius: ab.radius || 3, icon: ab.icon, key: ab.key });
  }

  _updateHero(dt) {
    for (const h of this.heroes) this._updateHeroOne(h, dt);
  }

  _updateHeroOne(h, dt) {
    if (h.abilCd > 0) h.abilCd -= dt;
    if (h.dead) {
      h.reviveT -= dt;
      if (h.reviveT <= 0) {
        h.dead = false;
        h.hp = h.maxHp;
        h.x = (this.hq ? this.hq.cx : this.map.size / 2) + 2.5;
        h.z = (this.hq ? this.hq.cz : this.map.size / 2) + 2.5;
        this.units.push(h);
        this.emit({ type: 'revive', x: h.x, z: h.z });
        this.msg(`${h.def.icon} ${h.def.name} has returned to the fight!`, 'info');
      }
      return;
    }
    const regen = h.def.regen + 0.25 * (h.level - 1) + h.mods.regen;
    h.hp = Math.min(h.maxHp, h.hp + regen * dt);
    if (h.hasteT > 0) h.hasteT -= dt;

    // The Weave: while it lasts, cut everything brushed against (once per cast).
    if (h.weaveT > 0) {
      h.weaveT -= dt;
      const tag = h.id + ':' + h.weaveKey;
      for (const zb of this.zombies) {
        if (zb.dead || zb._weaveTag === tag) continue;
        if (dist2(h.x, h.z, zb.x, zb.z) <= 1.8) {
          zb._weaveTag = tag;
          this.damageZombie(zb, h.weaveDmg, h.x, h.z);
          this.emit({ type: 'weavehit', x: zb.x, z: zb.z });
        }
      }
      if (h.weaveT <= 0 && h.stealth) h.stealth = false;
    }

    // Direct WASD movement (Thronefall-style): slide along blockers, pass
    // gates. `moving` tracks ACTUAL movement — pressing into a building counts
    // as standing, so nuzzling a structure funds its upgrade.
    if (h.mx !== 0 || h.mz !== 0) {
      const len = Math.hypot(h.mx, h.mz) || 1;
      // Thronefall gallop rule: sprint only at full health.
      const canSprint = h.sprint && h.hp >= h.maxHp - 0.5;
      const spd = h.def.speed * (1 + 0.025 * (h.level - 1)) * (1 + h.mods.speed) * (canSprint ? 1.5 : 1)
        * (h.weaveT > 0 ? h.def.ability.speed || 1.5 : 1);
      h.moving = this._moveActor(h, h.mx / len, h.mz / len, spd, dt);
      h.facing = Math.atan2(h.mx, h.mz);
    } else {
      h.moving = false;
    }
  }

  // Shared friendly movement: walkable check + axis slide, gates passable.
  _moveActor(a, dx, dz, speed, dt) {
    const step = speed * dt;
    // If somehow inside a building footprint, any walkable step out is legal.
    const trapped = this.occ[(a.z | 0) * this.map.size + (a.x | 0)] > 0;
    const pass = (x, z) => {
      if (!this.map.isWalkable(x | 0, z | 0)) return false;
      if (trapped) return true;
      const id = this.occ[(z | 0) * this.map.size + (x | 0)];
      return id === 0 || this.gateIds.has(id);
    };
    const nx = a.x + dx * step, nz = a.z + dz * step;
    if (pass(nx, nz)) { a.x = nx; a.z = nz; return true; }
    if (pass(nx, a.z)) { a.x = nx; return true; }
    if (pass(a.x, nz)) { a.z = nz; return true; }
    return false;
  }

  // ---------- zombies ----------

  _spawnZombie(type, x, z, aggro, wave = false) {
    if (this.zombies.length >= ZOMBIE_CAP) return null;
    const d = ZOMBIES[type];
    const zb = {
      id: nextId++, type, def: d, x, z,
      hp: d.hp, maxHp: d.hp,
      state: aggro ? AGGRO : IDLE,
      dirX: 0, dirZ: 0, timer: this.rng() * 4,
      atkT: 0, targetU: null, phase: this.rng() * Math.PI * 2,
      wave, hitFlash: 0,
    };
    this.zombies.push(zb);
    return zb;
  }

  _spawnBoss(nestId) {
    const B = this.nightBossDef();
    this.bossDef = B;
    const nest = nestId != null ? this.nests[nestId] : null;
    let [x, z] = nest ? [nest.x, nest.z] : this._edgeSpawnPoint();
    for (let r = 0; r < 12; r++) {
      if (this.map.isWalkable((x | 0) + r, z | 0)) { x = (x | 0) + r; break; }
      if (this.map.isWalkable((x | 0) - r, z | 0)) { x = (x | 0) - r; break; }
    }
    this.bossSpawnT = this.time;
    const def = {
      hp: Math.round(B.hp * this.diff.mult), dmg: B.dmg, speed: B.speed, chase: B.chase,
      color: B.color, scale: B.scale, score: B.score,
    };
    const zb = {
      id: nextId++, type: 'boss', def, x, z,
      hp: def.hp, maxHp: def.hp,
      state: AGGRO, dirX: 0, dirZ: 0, timer: 0,
      atkT: 0, targetU: null, phase: this.rng() * Math.PI * 2,
      wave: true, hitFlash: 0, boss: true, cfg: B,
      armor: B.armor || 0, spawnT: B.spawn ? B.spawn.every : 0, roarT: B.roar ? B.roar.every : 0,
    };
    this.zombies.push(zb);
    this.boss = zb;
    this.msg(`${B.icon} ${B.name} has entered the field: "${B.desc}"`, 'bad');
    this.emit({ type: 'bossspawn', x, z });
    this.emit({ type: 'ping', x, z });
  }

  _updateBoss(zb, dt) {
    const B = zb.cfg || this.level.boss;
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
          if (b.alive && b.kind === 'tower' && dist2(zb.x, zb.z, b.cx, b.cz) <= r2) { b.stunT = B.roar.dur; hit++; }
        }
        this.emit({ type: 'roarwave', x: zb.x, z: zb.z, r: B.roar.radius });
        if (hit) this.msg(`${B.icon} The shriek overloads ${hit} tower${hit > 1 ? 's' : ''}!`, 'warn');
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

  // A random spawn point at the map rim — survival's fallback once every
  // nest is ash, and the escape hatch for marooned wave zombies.
  _edgeSpawnPoint() {
    const N = this.map.size;
    const edge = (this.rng() * 4) | 0;
    const along = this.rng() * (N - 4) + 2;
    const depth = this.rng() * 5;
    if (edge === 0) return [along, 1 + depth];
    if (edge === 1) return [N - 2 - depth, along];
    if (edge === 2) return [along, N - 2 - depth];
    return [1 + depth, along];
  }

  _spawnHorde(size, nestIds, types) {
    let spawned = 0, guard = 0;
    const pickType = () => {
      let roll = this.rng(), acc = 0;
      for (const [t, p] of Object.entries(types)) { acc += p; if (roll <= acc) return t; }
      return 'walker';
    };
    while (spawned < size && guard++ < size * 30) {
      let x, z;
      if (nestIds.length) {
        // The horde boils out of its hives.
        const n = this.nests[nestIds[(this.rng() * nestIds.length) | 0]];
        const a = this.rng() * Math.PI * 2, r = 1.5 + this.rng() * 6;
        x = n.x + Math.cos(a) * r; z = n.z + Math.sin(a) * r;
      } else {
        [x, z] = this._edgeSpawnPoint();
      }
      if (!this.map.isWalkable(x | 0, z | 0)) continue;
      // Only spawn where the city is actually reachable, so hordes always
      // arrive (and every night can always be cleared).
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
    const bcfg = zb.cfg;
    if (zb.boss && bcfg && bcfg.enrage && !zb.enraged && zb.hp < zb.maxHp * bcfg.enrage) {
      zb.enraged = true;
      zb.def = { ...zb.def, speed: zb.def.speed * 1.5, chase: zb.def.chase * 1.5, dmg: Math.round(zb.def.dmg * 1.3) };
      this.msg(`${bcfg.icon} ${bcfg.name} ENRAGES!`, 'bad');
      this.emit({ type: 'enrage', x: zb.x, z: zb.z });
    }
    zb.hitFlash = 0.15;
    if (zb.state !== AGGRO) zb.state = AGGRO;
    if (zb.hp <= 0) {
      zb.dead = true;
      this.stats.kills++;
      if (zb.boss) {
        this.boss = null;
        this.stats.bossKillT = Math.round(this.time - (this.bossSpawnT || 0));
        this.msg(`🏆 ${(zb.cfg || this.level.boss).name} IS SLAIN! Purge the stragglers!`, 'info');
        this.emit({ type: 'bossdown', x: zb.x, z: zb.z });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          this._spawnCoin(zb.x + Math.cos(a) * 1.4, zb.z + Math.sin(a) * 1.4, Math.ceil(DROPS.bossCoins / 5), zb.x, zb.z);
        }
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
      // Shared XP for kills near any hero.
      for (const h of this.heroes) {
        if (!h.dead && dist2(h.x, h.z, zb.x, zb.z) < XP_RADIUS * XP_RADIUS) {
          this.addXp(h, zb.def.score * 8);
        }
      }
      // Thronefall-style coin drops.
      if (zb.type === 'brute') this._spawnCoin(zb.x, zb.z, DROPS.bruteCoins, zb.x, zb.z);
      else if (this.rng() < DROPS.smallChance) this._spawnCoin(zb.x, zb.z, 1, zb.x, zb.z);
    }
  }

  _damageBuilding(b, dmg) {
    if (!b.alive) return;
    b.hp -= dmg;
    b.hitT = this.time;
    this.emit({ type: 'bhit', x: b.cx, z: b.cz });
    if (this.time - (this._uaT || -99) > 20) {
      this._uaT = this.time;
      this.msg('⚔️ The city is under attack!', 'warn');
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
        this.stats.heroDeaths++;
        u.reviveT = 12 + 2.5 * u.level;
        this.emit({ type: 'herodown' });
        this.msg(`☠️ ${u.def.name} has fallen! Reviving at the Keep in ${Math.round(u.reviveT)}s…`, 'bad');
      }
    }
  }

  _gameOver(won) {
    if (this.over) return;
    this.over = true;
    this.won = won;
    // Side quests are judged at the end of a campaign run; rewards persist
    // (the renderer grants them to the profile — WC3-style loot that stays).
    const quests = this.mode === 'campaign' ? this.level.quests || [] : [];
    this.questResults = quests.map((q) => ({
      id: q.id, name: q.name, desc: q.desc, reward: q.reward, done: won && !!q.check(this),
    }));
    this.emit({ type: won ? 'victory' : 'defeat' });
  }

  // ---------- main update ----------

  update(dt) {
    if (this.over) return;
    this.time += dt;
    this._updatePhase(dt);
    if (this.over) return;
    this._updatePlots(dt);
    this._updateCoins();
    this._updateFlow(dt);
    this._updateZombies(dt);
    this._updateAuras(dt);
    this._updateUnits(dt);
    this._updateTowers(dt);
    this._updateHero(dt);
    this._cleanup();
  }

  // Hero auras — the passive third of the kit (auto-attack, aura, special).
  // Each hero hums one effect into the ground around them, always on.
  _updateAuras(dt) {
    for (const u of this.units) if (!u.hero) u.auraDmg = 1;
    for (const h of this.heroes) {
      if (h.dead) continue;
      const aura = h.def.aura;
      if (!aura) continue;
      const radius = aura.radius * (1 + h.mods.auraR);
      const r2 = radius * radius;
      if (aura.dmgMult || aura.regen) {
        for (const u of this.units) {
          if (u.dead || u === h) continue;
          if (dist2(h.x, h.z, u.x, u.z) > r2) continue;
          if (aura.dmgMult && !u.hero) u.auraDmg = Math.max(u.auraDmg, aura.dmgMult);
          if (aura.regen) u.hp = Math.min(u.maxHp, u.hp + aura.regen * dt);
        }
      }
      if (aura.slow || aura.drain) {
        h._auraT = (h._auraT || 0) - dt;
        if (h._auraT <= 0) {
          const tick = 0.3;
          h._auraT = tick;
          let drained = 0;
          for (const zb of this.zombies) {
            if (zb.dead) continue;
            if (dist2(h.x, h.z, zb.x, zb.z) > r2) continue;
            if (aura.slow) {
              zb.slowT = Math.max(zb.slowT || 0, 0.5);
              zb.slowMul = aura.slow;
            }
            if (aura.drain) {
              const bite = Math.min(zb.hp, aura.drain * tick);
              this.damageZombie(zb, aura.drain * tick);
              drained += bite;
            }
          }
          if (drained > 0 && aura.leech) h.hp = Math.min(h.maxHp, h.hp + drained * aura.leech);
        }
      }
    }
  }

  _updateFlow(dt) {
    this.flowTimer -= dt;
    if (this.flowDirty || this.flowTimer <= 0) {
      const sources = [];
      for (const b of this.buildings) {
        if (!b.alive || b.kind === 'wall') continue;
        for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) {
          sources.push((b.z + dz) * this.map.size + (b.x + dx));
        }
      }
      this.flow.compute(this.occ, sources, this.gateIds);
      this.flowDirty = false;
      this.flowTimer = 2.5;
    }
  }

  _updateZombies(dt) {
    const N = this.map.size;
    const nightMul = this.isNight ? 1.2 : 1;

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
        // Wake only when the city practically touches them — days are for
        // building; creeps are optional XP out in the wild.
        if (this.flow.distAt(zb.x | 0, zb.z | 0) < 5) zb.state = AGGRO;
        continue;
      }

      if (zb.state === WANDER) {
        if (zb.timer <= 0) { zb.burst = false; zb.state = zb.wave ? AGGRO : IDLE; zb.timer = 3 + this.rng() * 6; continue; }
        if (!zb.burst && this.flow.distAt(zb.x | 0, zb.z | 0) < 5) { zb.state = AGGRO; continue; }
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
        // Marooned on ground the city can't be reached from (e.g. shoved
        // across water)? Relocate the horde zombie to a valid spawn edge so
        // every night can always be finished.
        if (zb.wave && this.flow.distAt(zb.x | 0, zb.z | 0) === Infinity) {
          const aliveNests = this.nests.filter((n) => n.alive);
          for (let tries = 0; tries < 60; tries++) {
            let x, z;
            if (aliveNests.length) {
              const n = aliveNests[(this.rng() * aliveNests.length) | 0];
              const a = this.rng() * Math.PI * 2, r = 2 + this.rng() * 5;
              x = n.x + Math.cos(a) * r; z = n.z + Math.sin(a) * r;
            } else {
              [x, z] = this._edgeSpawnPoint();
            }
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
      // 1) Chase a nearby living unit if close. Veiled heroes are invisible.
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

      // 2) Follow the flow field toward the city.
      const dir = this.flow.dirAt(zb.x | 0, zb.z | 0);
      if (dir) {
        this._moveZombie(zb, dir[0], dir[1], zb.def.chase * zb.speedMul, dt, true);
      } else if (this.hq && this.hq.alive) {
        // Off the flow field (local dead spot) — shamble straight at the Keep
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
      // Chew on whatever is in the way (gates included).
      if (zb.atkT <= 0) {
        zb.atkT = 0.85;
        const b = this.buildings.find((o) => o.id === occId);
        if (b) {
          this._damageBuilding(b, zb.def.dmg);
          // Shock fence: every bite bites back.
          if (b.def.zap) {
            this.damageZombie(zb, b.def.zap, b.cx, b.cz);
            zb.slowT = Math.max(zb.slowT || 0, 0.9);
            zb.slowMul = Math.min(zb.slowMul || 1, 0.7);
            this.emit({ type: 'zap', x: zb.x, z: zb.z });
          }
        }
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
      if (u.dead || u.hero) { if (u.hero) { u.cooldown -= dt; u.retargetT -= dt; } } else {
        u.cooldown -= dt;
        u.retargetT -= dt;
      }
      if (u.dead) continue;

      if (!u.hero) {
        if (this.stance === 'guard') {
          // GUARD: escort the nearest living hero, loosely fanned out by id.
          let h = null, hd = Infinity;
          for (const hh of this.heroes) {
            if (hh.dead) continue;
            const d = dist2(u.x, u.z, hh.x, hh.z);
            if (d < hd) { hd = d; h = hh; }
          }
          if (h) {
            const a = (u.id % 8) / 8 * Math.PI * 2;
            const tx = h.x + Math.cos(a) * 1.8, tz = h.z + Math.sin(a) * 1.8;
            const dx = tx - u.x, dz = tz - u.z;
            const d = Math.hypot(dx, dz);
            if (d > 1.2) {
              const sprint = d > 7 ? 1.4 : 1;
              this._moveActor(u, dx / d, dz / d, u.def.speed * sprint, dt);
              u.facing = Math.atan2(dx, dz);
              u.moving = true;
            } else u.moving = false;
          }
        } else if (this.stance === 'attack') {
          // ATTACK: creep-wave — close on the hunted target, else push the
          // nearest hive. The army fights entirely on its own.
          let gx = null, gz = null, stopAt = 0;
          if (u.target && !u.target.dead) { gx = u.target.x; gz = u.target.z; stopAt = u.def.range * 0.85; }
          else if (u.targetNest && u.targetNest.alive) { gx = u.targetNest.x; gz = u.targetNest.z; stopAt = u.def.range + 1.2; }
          if (gx != null) {
            const dx = gx - u.x, dz = gz - u.z;
            const d = Math.hypot(dx, dz);
            if (d > stopAt) {
              this._moveActor(u, dx / d, dz / d, u.def.speed * (d > 14 ? 1.25 : 1), dt);
              u.facing = Math.atan2(dx, dz);
              u.moving = true;
            } else u.moving = false;
          } else u.moving = false;
        } else {
          // DEFEND: drift back to the hold point if shoved away.
          const dx = u.holdX - u.x, dz = u.holdZ - u.z;
          const d = Math.hypot(dx, dz);
          if (d > 1.4) {
            this._moveActor(u, dx / d, dz / d, u.def.speed * 0.8, dt);
            u.facing = Math.atan2(dx, dz);
            u.moving = true;
          } else u.moving = false;
        }
      }

      // Auto-attack — units fire even while moving. A weaving hero is a blade
      // between worlds: no gunfire until the threads release him.
      if (u.hero && u.weaveT > 0) { u.target = null; u.targetNest = null; continue; }
      if (u.retargetT <= 0 || (u.target && u.target.dead)) {
        u.retargetT = 0.25;
        // Attacking troops HUNT (see far beyond weapon range); everyone else
        // only engages what wanders into range.
        const hunting = !u.hero && this.stance === 'attack';
        const seek = hunting ? 30 : u.def.range;
        let best = null, bd = seek * seek;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          const d = dist2(u.x, u.z, zb.x, zb.z);
          if (d < bd) { bd = d; best = zb; }
        }
        u.target = best;
        // No dead around? The living turn their guns on the hive itself —
        // attackers will cross the whole map to do it.
        u.targetNest = null;
        if (!best) {
          let bn = null, bnd = hunting ? Infinity : (u.def.range + 1.5) ** 2;
          for (const n of this.nests) {
            if (!n.alive) continue;
            const d = dist2(u.x, u.z, n.x, n.z);
            if (d < bnd) { bnd = d; bn = n; }
          }
          u.targetNest = bn;
        }
      }
      const chasing = !u.hero && this.stance === 'attack'; // hunters keep far targets and close in
      const rofMult = (u.hero && u.hasteT > 0 ? u.hasteMult : 1) * (u.hero ? 1 + u.mods.rof : 1);
      const hitDmg = () => (u.hero ? this.heroDmg(u) : u.def.dmg * (u.auraDmg || 1) * (1 + this.relicMods.troopDmg));
      if (u.target && !u.target.dead && u.cooldown <= 0) {
        const zb = u.target;
        if (dist2(u.x, u.z, zb.x, zb.z) <= u.def.range * u.def.range) {
          u.cooldown = 1 / (u.def.rof * rofMult);
          u.facing = Math.atan2(zb.x - u.x, zb.z - u.z);
          const dmg = hitDmg();
          this.damageZombie(zb, dmg, u.x, u.z);
          // Shotgun spread: the blast mauls everything packed around the target.
          if (u.def.splash) {
            const s2 = u.def.splash * u.def.splash;
            for (const zb2 of this.zombies) {
              if (zb2 === zb || zb2.dead) continue;
              if (dist2(zb.x, zb.z, zb2.x, zb2.z) <= s2) this.damageZombie(zb2, dmg * 0.55, u.x, u.z);
            }
          }
          const kind = u.hero ? (u.def.melee ? 'melee' : u.def.shotgun ? 'shotgun' : 'hero') : u.key;
          this.emit({ type: 'shot', kind, fx: u.x, fz: u.z, tx: zb.x, tz: zb.z, fy: u.hero ? 0.9 : 0.7 });
          if (u.def.noise > 0) this.wakeZombies(u.x, u.z, u.def.noise);
        } else if (!chasing) {
          u.target = null;
        }
      } else if (u.targetNest && u.targetNest.alive && u.cooldown <= 0) {
        const n = u.targetNest;
        if (dist2(u.x, u.z, n.x, n.z) <= (u.def.range + 1.5) ** 2) {
          u.cooldown = 1 / (u.def.rof * rofMult);
          u.facing = Math.atan2(n.x - u.x, n.z - u.z);
          this._damageNest(n, hitDmg());
          const kind = u.hero ? (u.def.melee ? 'melee' : u.def.shotgun ? 'shotgun' : 'hero') : u.key;
          this.emit({ type: 'shot', kind, fx: u.x, fz: u.z, tx: n.x, tz: n.z, fy: u.hero ? 0.9 : 0.7 });
          if (u.def.noise > 0) this.wakeZombies(u.x, u.z, u.def.noise);
        } else if (!chasing) {
          u.targetNest = null;
        }
      }
    }
  }

  _damageNest(n, dmg) {
    if (!n.alive) return;
    n.hp -= dmg;
    this.emit({ type: 'bhit', x: n.x, z: n.z });
    if (n.hp <= 0) {
      n.alive = false;
      n.hp = 0;
      this.stats.nests++;
      // Razing a hive pays: a fountain of gold from the corpse-hoard.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this._spawnCoin(n.x + Math.cos(a) * 1.8, n.z + Math.sin(a) * 1.8, 5, n.x, n.z);
      }
      const left = this.nests.filter((o) => o.alive).length;
      this.emit({ type: 'nestdown', x: n.x, z: n.z });
      this.msg(`🔥 A hive nest is razed! ${left ? `${left} remain${left === 1 ? 's' : ''}.` : 'The land holds its breath…'}`, 'info');
    }
  }

  _updateTowers(dt) {
    for (const b of this.buildings) {
      if (!b.alive || b.kind !== 'tower' || !b.def.dmg) continue;
      b.cooldown -= dt;
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
        b.cooldown = 1 / b.def.rof;
        const tdmg = b.def.dmg * (1 + this.relicMods.towerDmg);
        if (b.def.splash) {
          const s2 = b.def.splash * b.def.splash;
          for (const zb of this.zombies) {
            if (!zb.dead && dist2(best.x, best.z, zb.x, zb.z) <= s2) this.damageZombie(zb, tdmg, b.cx, b.cz);
          }
          this.emit({ type: 'shot', kind: 'flame', fx: b.cx, fz: b.cz, tx: best.x, tz: best.z, fy: 2.6 });
        } else {
          this.damageZombie(best, tdmg, b.cx, b.cz);
          this.emit({ type: 'shot', kind: b.def.branch === 'ballista' ? 'ballista' : 'tower', fx: b.cx, fz: b.cz, tx: best.x, tz: best.z, fy: 2.6 });
        }
        b.lastTx = best.x; b.lastTz = best.z;
        this.wakeZombies(b.cx, b.cz, 9);
      }
    }
  }

  _cleanup() {
    if (this.zombies.some((z) => z.dead)) this.zombies = this.zombies.filter((z) => !z.dead);
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
  }

  aggroCount() {
    let n = 0;
    for (const zb of this.zombies) if (zb.state === AGGRO) n++;
    return n;
  }
}
