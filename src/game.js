// Core simulation — continuous siege.
//
// There is no day, no night and no bell. Both sides run an economy: your camps
// muster squads on a timer and push them out along the lane graph to take
// nodes; every living hive musters its own squads and sends them back. The
// front line is wherever the two flows meet, and Threat — which rises with the
// clock, with every hive still standing, and with your own conquests — decides
// how hard the hives push.
//
// Pure logic — rendering/audio consume `game.events` each frame.
import {
  PLOT_KINDS, UNITS, ZOMBIES, TILE, DIFFICULTY, LEVELS,
  SIEGE, THREAT, SURGE_MULT, TOWER_PRIORITY, NODE_KINDS, hiveInterval, hiveSquad,
  START_GOLD, COIN_CAP, COIN_RADIUS, PAY_RADIUS, PAY_RATE,
  ZOMBIE_CAP, UNIT_CAP, SUPPLY, NEST_HP_BASE, NEST_HP_LEVEL_SHARE, DROPS, itemMods,
  HEROES, HERO_MAX_LEVEL, XP_RADIUS, xpForLevel, abilityRank,
  HERO_UPGRADE_KEYS, HERO_UPGRADE_MAX, normalizeHeroUpgrades, heroUnspentUpgrades,
} from './config.js';
import { FlowField } from './flowfield.js';
import { generatePlots } from './plots.js';
import { buildLaneGraph, nodeRoute, reachableFrom, routeWaypoints } from './lanes.js';
import { clamp, dist2, makeRNG } from './utils.js';

const IDLE = 0, WANDER = 1, AGGRO = 2;
const OUTPOST_PLOT_BASE = 5000;   // outpost plot ids never collide with city plots
const CAMP_STANDING = 5;          // a camp sustains count x this many living troops
const NEST_BLIGHT_R = 7.5;        // the poisoned ground around a living hive
const NEST_BLIGHT_DPS = 6;        // damage per second to anything standing in it
const SIEGE_GUARD_R = 3.6;        // closer than this and you deal with the guard first
const DIRECT_APPROACH_R = 24;     // inside this, walk straight at the objective

let nextId = 1000;
const getNextId = () => nextId;
const setNextId = (v) => { nextId = v; };
const snapNum = (v) => (Number.isFinite(v) ? v : 0);
const snapRoute = (route) => Array.isArray(route) ? route.map(([x, z]) => [snapNum(x), snapNum(z)]) : null;

export class Game {
  // heroKeys: a hero key string (solo) or an array of keys (co-op, one per player).
  constructor(map, difficulty = 'normal', heroKeys = 'alexander', snap = null, levelId = 1, mode = 'campaign') {
    this.map = map;
    this.diffKey = difficulty;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.levelId = snap ? snap.level : levelId;
    this.mode = snap ? snap.mode || 'campaign' : mode;
    this.level = LEVELS[(this.levelId || 1) - 1] || LEVELS[0];
    this.economy = { startGold: START_GOLD, income: 1, pressure: 1, ...(this.level.economy || {}) };
    this.boss = null;
    this.rng = makeRNG(999);

    this.gold = this.economy.startGold;
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

    // Hive nests: the enemy's producing bases. Each musters squads on its own
    // timer — raze one and you can hear the pressure drop.
    this.nests = (map.nestSpots || []).map((s, i) => {
      const hp = Math.round(
        NEST_HP_BASE * (1 - NEST_HP_LEVEL_SHARE + NEST_HP_LEVEL_SHARE * this.level.mult)
        * Math.max(0.6, this.diff.mult),
      );
      return { id: i, x: s[0] + 0.5, z: s[1] + 0.5, hp, maxHp: hp, alive: true, musterT: 8 + i * 4, defendT: 0 };
    });

    // Lane nodes: the ground worth holding.
    // A node's KIND comes from the terrain and never changes. Its OWNER is a
    // separate fact, decided below, and the player does not learn it until they
    // have been close enough to survey the place.
    this.nodes = (map.nodeSpots || []).map((s, i) => ({
      id: i, x: s.x + 0.5, z: s.z + 0.5, name: s.name || `Node ${i + 1}`,
      kind: s.kind || 'clearing', def: NODE_KINDS[s.kind] || NODE_KINDS.clearing,
      owner: 'neutral', cap: 0, capOwner: null, gi: i, seen: false, looted: false,
    }));
    this.laneGraph = null;
    this.cityGi = -1;

    this.stance = 'defend';      // army stance: defend | guard | attack (no micro)
    this.time = 0;
    this.threat = 0;             // the clock that replaced nightfall
    this.threatLevel = 1;
    this.phase = 'found';
    this.finalStand = false;     // every hive razed — the counterattack is coming
    this.over = false;
    this.won = false;

    this.incomeT = SIEGE.incomeTick;
    this._incomeAcc = 0;
    this.incomeRate = 0;
    this._nodeT = 0;
    this._campT = 0;
    this._supportT = 0;
    this.brews = [];             // John's lingering beer-blast ground zones

    this.events = [];            // consumed by renderer/audio each frame
    this.messages = [];          // consumed by UI

    this.stats = {
      kills: 0, built: 0, lost: 0, coins: 0, nests: 0, nodes: 0, bestHeld: 0,
      heroDeaths: 0, bossKillT: null, repaired: 0,
    };

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

  // ---------- save / restore (v4: continuous siege) ----------

  snapshot() {
    return {
      v: 4, seed: this.map.seed, diff: this.diffKey, heroKeys: this.heroKeys, level: this.levelId, mode: this.mode,
      time: snapNum(this.time), threat: snapNum(this.threat), threatLevel: this.threatLevel,
      phase: this.phase, finalStand: this.finalStand ? 1 : 0,
      gold: snapNum(this.gold),
      site: this.site,
      stance: this.stance,
      relics: [...this.relics],
      timers: {
        incomeT: snapNum(this.incomeT), incomeAcc: snapNum(this._incomeAcc), incomeRate: snapNum(this.incomeRate),
        nodeT: snapNum(this._nodeT), campT: snapNum(this._campT), supportT: snapNum(this._supportT), bossSpawnT: this.bossSpawnT != null ? snapNum(this.bossSpawnT) : null,
      },
      nests: this.nests.map((n) => [snapNum(n.hp), n.alive ? 1 : 0, snapNum(n.musterT), snapNum(n.defendT || 0)]),
      nodes: this.nodes.map((n) => [n.owner, snapNum(n.cap), n.capOwner || '', n.seen ? 1 : 0, n.empty ? 1 : 0, n.looted ? 1 : 0]),
      stats: { ...this.stats },
      rng: this.rng.getState(), nextId: getNextId(),
      plots: this.plots.map((p) => ({
        id: p.id, tier: p.tier, paid: snapNum(p.paid), branch: p.branch,
        ruined: p.ruined ? 1 : 0, musterT: p.musterT != null ? snapNum(p.musterT) : null,
      })),
      buildings: this.buildings.map((b) => ({
        id: b.id, p: b.plotId, x: b.x, z: b.z, hp: snapNum(b.hp), g: b.gate ? 1 : 0,
        pr: b.priority || 0, cd: snapNum(b.cooldown || 0), stun: snapNum(b.stunT || 0),
      })),
      coins: this.coins.map((cn) => [cn.id, snapNum(cn.x), snapNum(cn.z), cn.v]),
      units: this.units.filter((u) => !u.hero).map((u) => ({
        id: u.id, k: u.key, x: snapNum(u.x), z: snapNum(u.z),
        order: this.units.indexOf(u),
        hp: snapNum(u.hp), camp: u.camp || 0,
        hx: snapNum(u.holdX || u.x), hz: snapNum(u.holdZ || u.z),
        cd: snapNum(u.cooldown || 0), rt: snapNum(u.retargetT || 0), facing: snapNum(u.facing || 0),
        target: u.target ? u.target.id : null, targetNest: u.targetNest ? u.targetNest.id : null,
        node: u.targetNodeId != null ? u.targetNodeId : -1, gi: u.targetGi ?? -1,
        route: snapRoute(u.route), routeI: u.routeI || 0, routeStuck: snapNum(u.routeStuck || 0),
        routeBest: Number.isFinite(u.routeBest) ? snapNum(u.routeBest) : null, repathT: snapNum(u.repathT || 0),
        shield: snapNum(u.shieldHp || 0),
        // Temporary allies (Tiger's clones, Aaron's spirit) carry a lifespan and
        // a per-instance stat override instead of the shared UNITS[key] def.
        temp: u.temp ? 1 : 0, expire: u.expireT != null ? snapNum(u.expireT) : null,
        ownerHero: u.ownerHeroId != null ? u.ownerHeroId : null,
        defHp: u.temp ? snapNum(u.def.hp) : null, defDmg: u.temp ? snapNum(u.def.dmg) : null,
      })),
      heroes: this.heroes.map((h) => ({
        id: h.id, k: h.key, x: snapNum(h.x), z: snapNum(h.z), hp: snapNum(h.hp),
        order: this.units.indexOf(h),
        dead: !!h.dead, reviveT: snapNum(h.reviveT || 0),
        level: h.level, xp: snapNum(h.xp), cd: snapNum(h.abilCd),
        atkCd: snapNum(h.cooldown || 0), rt: snapNum(h.retargetT || 0), facing: snapNum(h.facing || 0),
        mx: snapNum(h.mx || 0), mz: snapNum(h.mz || 0), sprint: !!h.sprint, pay: !!h.payHold,
        coinAcc: snapNum(h._coinAcc || 0),
        target: h.target ? h.target.id : null, targetNest: h.targetNest ? h.targetNest.id : null,
        stealth: !!h.stealth, weaveT: snapNum(h.weaveT || 0), weaveDmg: snapNum(h.weaveDmg || 0),
        weaveKey: h.weaveKey || 0, hasteT: snapNum(h.hasteT || 0), hasteMult: snapNum(h.hasteMult || 1),
        shield: snapNum(h.shieldHp || 0),
        fortifyT: snapNum(h.fortifyT || 0), fortifyArmor: snapNum(h.fortifyArmor || 0), fortifyThorns: snapNum(h.fortifyThorns || 0),
        summonId: h._summonId != null ? h._summonId : null, procT: { ...(h._procT || {}) },
        items: [...(h.items || [])],
        upgrades: { ...h.upgrades },
      })),
      zombies: this.zombies.map((z) => [z.type, snapNum(z.x), snapNum(z.z), snapNum(z.hp), z.state, z.wave ? 1 : 0, z.boss ? 1 : 0, z.enraged ? 1 : 0, {
        id: z.id, dx: snapNum(z.dirX || 0), dz: snapNum(z.dirZ || 0),
        timer: snapNum(z.timer || 0), atk: snapNum(z.atkT || 0),
        targetU: z.targetU ? z.targetU.id : null, anim: snapNum(z.phase || 0), hit: snapNum(z.hitFlash || 0),
        stun: snapNum(z.stunT || 0), slow: snapNum(z.slowT || 0), slowMul: snapNum(z.slowMul || 1),
        progress: snapNum(z.progressT || 0), px: snapNum(z.px || 0), pz: snapNum(z.pz || 0),
        retarget: snapNum(z.retarget || 0), stuck: snapNum(z.stuckT || 0), burst: !!z.burst,
        route: snapRoute(z.route), routeI: z.routeI || 0, routeStuck: snapNum(z.routeStuck || 0),
        routeBest: Number.isFinite(z.routeBest) ? snapNum(z.routeBest) : null, repathT: snapNum(z.repathT || 0),
        frenzy: snapNum(z.frenzy || 0), speedMul: snapNum(z.speedMul || 1), raider: !!z.raider,
        armor: snapNum(z.armor || 0), maxHp: snapNum(z.maxHp || 0),
        spawnT: snapNum(z.spawnT || 0), roarT: snapNum(z.roarT || 0),
      }]),
    };
  }

  _restore(snap) {
    this.time = snap.time;
    this.threat = snap.threat || 0;
    this.threatLevel = snap.threatLevel || 1;
    this.phase = snap.phase === 'found' ? 'found' : 'live';
    this.finalStand = !!snap.finalStand;
    this.gold = snap.gold;
    this.site = snap.site ?? -1;
    this.stance = snap.stance || 'defend';
    if (this.site >= 0) {
      this.plots = generatePlots(this.map, this.map.sites[this.site]);
      this._claimed = true; // ownership comes from the save, not a fresh roll
      this._buildLaneSystems(this.map.sites[this.site]);
    }
    this.relics = [...(snap.relics || [])];
    this.relicMods = itemMods(this.relics);
    const timers = snap.timers || {};
    this.incomeT = timers.incomeT ?? this.incomeT;
    this._incomeAcc = timers.incomeAcc ?? 0;
    this.incomeRate = timers.incomeRate ?? 0;
    this._nodeT = timers.nodeT ?? 0;
    this._campT = timers.campT ?? 0;
    this._supportT = timers.supportT ?? 0;
    this.bossSpawnT = timers.bossSpawnT ?? null;
    (snap.nests || []).forEach(([hp, alive, musterT, defendT], i) => {
      if (this.nests[i]) {
        this.nests[i].hp = hp;
        this.nests[i].alive = !!alive;
        if (musterT != null) this.nests[i].musterT = musterT;
        if (defendT != null) this.nests[i].defendT = defendT;
      }
    });
    (snap.nodes || []).forEach(([owner, cap, capOwner, seen, empty, looted], i) => {
      const n = this.nodes[i];
      if (!n) return;
      n.owner = owner || 'neutral';
      n.cap = cap || 0;
      n.capOwner = capOwner || null;
      n.seen = !!seen;
      n.empty = !!empty;
      n.looted = !!looted;
    });
    this.stats = { nests: 0, nodes: 0, bestHeld: 0, heroDeaths: 0, bossKillT: null, repaired: 0, ...snap.stats };

    for (const ps of snap.plots) {
      const p = this.plots.find((o) => o.id === ps.id);
      if (p) {
        p.tier = ps.tier; p.paid = ps.paid; p.branch = ps.branch;
        p.ruined = !!ps.ruined;
        if (ps.musterT != null) p.musterT = ps.musterT;
      }
    }
    for (const bs of snap.buildings) {
      const plot = this.plots.find((o) => o.id === bs.p);
      if (!plot) continue;
      const def = this.tierDef(plot, plot.tier);
      const b = this._addBuilding(plot, bs.x, bs.z, def, !!bs.g, bs.id, bs.hp);
      if (b) {
        b.priority = bs.pr || 0;
        b.cooldown = bs.cd || 0;
        b.stunT = bs.stun || 0;
      }
    }
    this.hq = this.buildings.find((b) => b.kind === 'hq');
    this.coins = (snap.coins || []).map((saved) => {
      const [id, x, z, v] = saved.length >= 4 ? saved : [nextId++, saved[0], saved[1], saved[2]];
      return { id, x, z, v };
    });

    const actorsById = new Map();
    const zombiesById = new Map();
    const pendingActorTargets = [];
    const pendingZombieTargets = [];

    for (const us of snap.units) {
      const u = this._spawnUnit(us.k, us.x, us.z, us.camp || null);
      u.id = us.id; // keep saved ids so they can't collide with future spawns
      u.hp = us.hp;
      u.holdX = us.hx; u.holdZ = us.hz;
      u.cooldown = us.cd || 0;
      u._restoreOrder = us.order ?? Number.MAX_SAFE_INTEGER;
      u.retargetT = us.rt || 0;
      u.facing = us.facing || 0;
      if (us.node != null && us.node >= 0) u.targetNodeId = us.node;
      u.targetGi = us.gi ?? -1;
      u.route = us.route || null;
      u.routeI = us.routeI || 0;
      u.routeStuck = us.routeStuck || 0;
      u.routeBest = us.routeBest == null ? Infinity : us.routeBest;
      u.repathT = us.repathT || 0;
      u.shieldHp = us.shield || 0;
      if (us.temp) {
        u.temp = true;
        u.expireT = us.expire;
        u.ownerHeroId = us.ownerHero;
        if (us.defHp != null) u.def = { ...u.def, hp: us.defHp, dmg: us.defDmg };
        u.maxHp = us.defHp != null ? us.defHp : u.maxHp;
      }
      actorsById.set(u.id, u);
      pendingActorTargets.push([u, us]);
    }
    for (const hs of snap.heroes) {
      const h = this._spawnHero(hs.k, hs.x, hs.z, { level: hs.level, xp: hs.xp, items: hs.items || [], upgrades: hs.upgrades || {} });
      if (hs.id) h.id = hs.id;
      h.hp = hs.hp;
      h.abilCd = hs.cd || 0;
      h._restoreOrder = hs.order ?? Number.MAX_SAFE_INTEGER;
      h.cooldown = hs.atkCd || 0;
      h.retargetT = hs.rt || 0;
      h.facing = hs.facing || 0;
      h.mx = hs.mx || 0;
      h.mz = hs.mz || 0;
      h.sprint = !!hs.sprint;
      h.payHold = !!hs.pay;
      h._coinAcc = hs.coinAcc || 0;
      h.stealth = !!hs.stealth;
      h.weaveT = hs.weaveT || 0;
      h.weaveDmg = hs.weaveDmg || 0;
      h.weaveKey = hs.weaveKey || 0;
      h.hasteT = hs.hasteT || 0;
      h.hasteMult = hs.hasteMult || 1;
      h.shieldHp = hs.shield || 0;
      h.fortifyT = hs.fortifyT || 0;
      h.fortifyArmor = hs.fortifyArmor || 0;
      h.fortifyThorns = hs.fortifyThorns || 0;
      h._summonId = hs.summonId != null ? hs.summonId : null;
      h._procT = { ...(hs.procT || {}) };
      actorsById.set(h.id, h);
      pendingActorTargets.push([h, hs]);
      if (hs.dead) {
        h.dead = true;
        h.reviveT = hs.reviveT;
        this.units = this.units.filter((u) => u !== h);
      }
    }
    for (const [type, x, z, hp, state, wave, boss, enraged, meta = {}] of snap.zombies) {
      let zb = null;
      if (boss) {
        this._spawnBoss(null);
        zb = this.boss;
        if (!zb) continue;
      } else {
        zb = this._spawnZombie(type, x, z, state === 2, !!wave);
        if (!zb) continue;
      }
      if (meta.id) zb.id = meta.id;
      zb.x = x; zb.z = z; zb.hp = hp; zb.state = state;
      if (meta.maxHp) zb.maxHp = meta.maxHp;
      zb.dirX = meta.dx || 0; zb.dirZ = meta.dz || 0;
      zb.timer = meta.timer || 0; zb.atkT = meta.atk || 0;
      zb.phase = meta.anim || 0; zb.hitFlash = meta.hit || 0;
      zb.stunT = meta.stun || 0; zb.slowT = meta.slow || 0; zb.slowMul = meta.slowMul || 1;
      zb.progressT = meta.progress || 0; zb.px = meta.px || 0; zb.pz = meta.pz || 0;
      zb.retarget = meta.retarget || 0; zb.stuckT = meta.stuck || 0; zb.burst = !!meta.burst;
      zb.route = meta.route || null; zb.routeI = meta.routeI || 0;
      zb.routeStuck = meta.routeStuck || 0; zb.routeBest = meta.routeBest == null ? Infinity : meta.routeBest; zb.repathT = meta.repathT || 0;
      zb.frenzy = meta.frenzy || 0; zb.speedMul = meta.speedMul || 1; zb.raider = !!meta.raider;
      if (meta.armor) zb.armor = meta.armor;
      if (meta.spawnT != null) zb.spawnT = meta.spawnT;
      if (meta.roarT != null) zb.roarT = meta.roarT;
      if (enraged) {
        zb.enraged = true;
        zb.def = { ...zb.def, speed: zb.def.speed * 1.5, chase: zb.def.chase * 1.5, dmg: Math.round(zb.def.dmg * 1.3) };
      }
      zombiesById.set(zb.id, zb);
      pendingZombieTargets.push([zb, meta]);
    }

    for (const [u, saved] of pendingActorTargets) {
      if (saved.target != null) u.target = zombiesById.get(saved.target) || null;
      if (saved.targetNest != null) u.targetNest = this.nests[saved.targetNest] || null;
    }
    for (const [zb, meta] of pendingZombieTargets) {
      if (meta.targetU != null) zb.targetU = actorsById.get(meta.targetU) || null;
    }
    this.units.sort((a, b) => (a._restoreOrder ?? 0) - (b._restoreOrder ?? 0));
    for (const u of this.units) delete u._restoreOrder;
    if (timers.bossSpawnT != null) this.bossSpawnT = timers.bossSpawnT;

    this.rng.setState(snap.rng);
    setNextId(snap.nextId);
    this.flowDirty = true;
    this.msg('📂 The city stands as you left it — the siege continues.', 'info');
  }

  // ---------- setup ----------

  // The run opens un-founded: heroes ride a wild frontier dotted with marked
  // city sites, lane nodes and hive nests. Claim a site to raise the city.
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
    this._buildLaneSystems(site);
    this.heroes.forEach((h, i) => {
      if (!h.dead) { h.x = this.hq.cx - 1 + i * 2; h.z = this.hq.cz + 3.5; }
    });
    this.phase = 'live';
    this.flowDirty = true;
    this.emit({ type: 'founded', site: siteIdx, x: site.x, z: site.z });
    const founder = this.heroes[p];
    this.msg(`🏰 ${founder ? founder.def.name : 'The company'} founds the city! The hives are already mustering — build, then push out and take the lanes.`, 'info');
  }

  // Wire the planet's lane graph: capture nodes, then the hives, then the city.
  // Also drops a Forward Camp plot on every capture node — you can only fund it
  // once that node is yours.
  _buildLaneSystems(site) {
    const points = [
      ...this.nodes.map((n) => ({ x: n.x, z: n.z })),
      ...this.nests.map((n) => ({ x: n.x, z: n.z })),
      { x: site.x, z: site.z },
    ];
    this.nodes.forEach((n, i) => { n.gi = i; });
    this.nests.forEach((n, i) => { n.gi = this.nodes.length + i; });
    this.cityGi = this.nodes.length + this.nests.length;
    this.laneGraph = buildLaneGraph(this.map, points, SIEGE);

    // Anything the city cannot walk to is marooned — an island, a lake-locked
    // shelf. Leaving it on the map would be content the player can see and
    // never reach, and a marooned HIVE would make the map unwinnable, because
    // the win condition is razing every one of them.
    const reach = reachableFrom(this.laneGraph, this.cityGi);
    for (const node of this.nodes) node.offMap = !reach.has(node.gi);
    for (const nest of this.nests) {
      if (reach.has(nest.gi)) continue;
      nest.offMap = true;
      nest.alive = false;   // unreachable, so it can never muster or be razed
      nest.hp = 0;
    }

    if (!this._claimed) { this._claimed = true; this._claimNodes(); }

    for (const node of this.nodes) {
      if (node.offMap) continue;
      if (this.plots.some((pl) => pl.kind === 'outpost' && pl.nodeId === node.id)) continue;
      const spot = this._outpostSpot(node);
      if (!spot) continue;
      this.plots.push({
        id: OUTPOST_PLOT_BASE + node.id, kind: 'outpost', nodeId: node.id,
        x: spot[0], z: spot[1], size: 2,
        cx: spot[0] + 1, cz: spot[1] + 1,
        tier: 0, paid: 0, branch: null, ruined: false,
      });
    }
  }

  // A clear 2x2 footprint beside a node, never on top of its centre so the
  // hero can always stand in the capture ring.
  _outpostSpot(node) {
    const bx = (node.x | 0) - 1, bz = (node.z | 0) - 1;
    for (let r = 1; r <= 5; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = bx + dx, z = bz + dz;
          let ok = true;
          for (let sz = 0; sz < 2 && ok; sz++) {
            for (let sx = 0; sx < 2; sx++) {
              if (!this.map.isBuildable(x + sx, z + sz)) { ok = false; break; }
            }
          }
          if (ok) return [x, z];
        }
      }
    }
    return null;
  }

  // The hive got here first. It holds some of the good ground already — but
  // which ground is not something you can read off the terrain, so you have to
  // go and look. Seeded, so both lockstep peers claim identically.
  _claimNodes() {
    const pool = this.nodes.filter((n) => !n.offMap);
    if (!pool.length) return;
    // Deterministic shuffle, then claim from the far end of the map inward:
    // the hive's grip is strongest where you are not.
    const cx = this.hq ? this.hq.cx : this.map.size / 2;
    const cz = this.hq ? this.hq.cz : this.map.size / 2;
    const claimSeed = ((this.map.seed || 0) >>> 0)
      ^ Math.imul((this.site + 1) >>> 0, 0x9e3779b1)
      ^ Math.imul((this.levelId || 1) >>> 0, 0x85ebca6b)
      ^ Math.imul((cx | 0) + ((cz | 0) << 8), 0xc2b2ae35);
    const claimRng = makeRNG(claimSeed);
    const ranked = pool
      .map((n) => [dist2(n.x, n.z, cx, cz) * (0.75 + claimRng() * 0.5), n])
      .sort((a, b) => b[0] - a[0]);
    const want = Math.round(pool.length * SIEGE.hiveClaim);
    for (let i = 0; i < ranked.length; i++) {
      const node = ranked[i][1];
      if (i < want) node.owner = 'hive';
      // Some neutral ground is simply empty — a gift, if you find it first.
      else node.empty = claimRng() < 0.3;
    }
  }

  // Survey: get close enough and you learn who holds it and what it is.
  _updateScouting() {
    const r2 = SIEGE.scoutRadius * SIEGE.scoutRadius;
    for (const node of this.nodes) {
      if (node.seen || node.offMap) continue;
      for (const u of this.units) {
        if (u.dead) continue;
        if (dist2(u.x, u.z, node.x, node.z) > r2) continue;
        node.seen = true;
        const holder = node.owner === 'hive' ? 'The hive holds it.'
          : node.empty ? 'Nobody is on it.' : 'It is guarded.';
        this.msg(`${node.def.icon} Surveyed ${node.name} — ${node.def.name}. ${holder}`, 'info');
        this.emit({ type: 'nodeseen', x: node.x, z: node.z, id: node.id });
        break;
      }
    }
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
    // Ground is guarded in proportion to who claims it: hive-held nodes are a
    // real fight, neutral ones a skirmish, and the empty ones are free.
    for (const node of this.nodes) {
      if (node.offMap || node.empty) continue;
      const base = node.owner === 'hive' ? 7 : 3;
      const guards = Math.round((base + 2 * this.diff.mult) * (node.def.garrison || 1));
      for (let i = 0; i < guards; i++) {
        const a = this.rng() * Math.PI * 2, r = 1.5 + this.rng() * 3.5;
        const x = node.x + Math.cos(a) * r, z = node.z + Math.sin(a) * r;
        if (this.map.isWalkable(x | 0, z | 0)) {
          this._spawnZombie(node.owner === 'hive' && this.rng() < 0.25 ? 'runner' : 'walker', x, z, false);
        }
      }
    }
  }

  // ---------- helpers ----------

  msg(text, kind = 'info') { this.messages.push({ text, kind, t: this.time }); }
  emit(e) { this.events.push(e); }

  get isNight() { return false; } // kept so old call sites read false, not undefined
  // Marooned nodes are excluded everywhere: they are not capturable, not
  // counted, and not drawn.
  activeNodes() { return this.nodes.filter((n) => !n.offMap); }
  // How many troops you can field. Ground you hold is what raises it, so the
  // answer to "I am stuck and rich" is always "go take something".
  unitCap() {
    const total = this.activeNodes().length;
    const share = total ? this.heldNodes() / total : 0;
    return Math.min(SUPPLY.max, Math.round(SUPPLY.base + SUPPLY.perPlanet * share));
  }
  heldNodes() { return this.nodes.filter((n) => !n.offMap && n.owner === 'player').length; }
  liveNests() { return this.nests.filter((n) => n.alive).length; }

  // ---------- plots & construction ----------

  // Definition of a plot's tier (1-based). Handles wall per-tile cost & branches.
  tierDef(plot, tier) {
    const kind = PLOT_KINDS[plot.kind];
    const t = kind.tiers[tier - 1];
    if (!t) return null;
    // A Forward Camp is shaped by the ground under it: stone makes it tough,
    // open ground lets it muster more.
    if (plot.kind === 'outpost') {
      const node = this.nodes[plot.nodeId];
      const nd = node && node.def;
      if (nd) {
        return {
          ...t,
          hp: Math.round(t.hp * (1 + (nd.outpostHp || 0))),
          count: t.count + (nd.outpostCount || 0),
        };
      }
    }
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
    if (t && t.branch && !plot.branch) {
      const options = {};
      for (const [key, opt] of Object.entries(t.options)) {
        options[key] = { ...opt, cost: kind.perTile ? Math.ceil(opt.cost * plot.tiles.length) : opt.cost };
      }
      return { branch: true, options };
    }
    const def = this.tierDef(plot, idx);
    return def ? { def, cost: def.cost } : null;
  }

  // A Forward Camp only exists on ground you actually hold.
  plotLocked(plot) {
    if (plot.kind !== 'outpost') return false;
    const node = this.nodes[plot.nodeId];
    return !node || node.owner !== 'player';
  }

  // Health of everything standing on a plot, plus how much of it is missing.
  plotHpState(plot) {
    let hp = 0, maxHp = 0, count = 0;
    for (const b of this.buildings) {
      if (b.plotId !== plot.id || !b.alive) continue;
      hp += b.hp; maxHp += b.maxHp; count++;
    }
    const total = plot.kind === 'wall' ? plot.tiles.length : 1;
    return { hp, maxHp, count, total, missing: total - count };
  }

  // Where you stand to fund a plot. With a hero, measure reach against the
  // whole footprint so upgrades work from every side and corner.
  payPoint(plot, h = null) {
    if (plot.kind === 'wall') return [plot.gate[0] + 0.5, plot.gate[1] + 0.5];
    if (h) {
      return [
        clamp(h.x, plot.x, plot.x + plot.size),
        clamp(h.z, plot.z, plot.z + plot.size),
      ];
    }
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

  // What holding the build key beside this plot would actually do, and what it
  // costs. One verb, four jobs: raise, upgrade, rebuild a ruin, repair damage.
  plotAction(plot) {
    if (this.plotLocked(plot)) return null;
    if (plot.ruined) {
      const def = this.tierDef(plot, plot.tier);
      if (!def) return null;
      const state = this.plotHpState(plot);
      const share = plot.kind === 'wall' ? Math.max(0, state.missing) / Math.max(1, state.total) : 1;
      const cost = Math.max(1, Math.ceil(def.cost * SIEGE.rebuildDiscount * share));
      return { mode: 'rebuild', cost, def, label: `Rebuild ${def.name}` };
    }
    const nt = this.nextTier(plot);
    if (nt) return nt.branch ? { mode: 'branch', nt } : { mode: 'build', cost: nt.cost, nt, def: nt.def, label: nt.def.name };
    const state = this.plotHpState(plot);
    if (state.maxHp > 0 && state.hp < state.maxHp - 0.5) {
      const cost = Math.max(1, Math.ceil((state.maxHp - state.hp) / SIEGE.repairHpPerGold));
      return { mode: 'repair', cost, label: 'Repair' };
    }
    return null;
  }

  // The hero's nearest actionable plot — what holding the build key would pay
  // into. Shared by the sim and by the HUD prompt.
  buildTargetFor(h) {
    let best = null, bd = PAY_RADIUS * PAY_RADIUS, bestAct = null, bestPoint = null;
    for (const plot of this.plots) {
      const act = this.plotAction(plot);
      if (!act || act.mode === 'branch') continue;
      const [px, pz] = this.payPoint(plot, h);
      const d = dist2(h.x, h.z, px, pz);
      if (d <= bd) { bd = d; best = plot; bestAct = act; bestPoint = [px, pz]; }
    }
    if (!best) return null;
    // `nt` is kept for the HUD, which has always read target.nt.
    return { plot: best, act: bestAct, nt: bestAct.nt || { def: bestAct.def, cost: bestAct.cost }, payPoint: bestPoint };
  }

  // Building is always available now — and always dangerous, because nothing
  // stops while you do it.
  _updatePlots(dt) {
    if (this.over || this.phase !== 'live') return;
    const activePayments = new Set();
    const forcedRefunds = new Set();
    for (const h of this.heroes) {
      if (h.dead || !h.payHold) continue;
      const target = this.buildTargetFor(h);
      if (!target) continue;
      const { plot, act } = target;
      if (act.mode === 'build' || act.mode === 'rebuild') {
        activePayments.add(plot.id);
        plot.refundHero = this.heroes.indexOf(h);
      }
      const need = act.cost - (act.mode === 'build' || act.mode === 'rebuild' ? plot.paid : 0);
      const pay = Math.min(PAY_RATE * dt, this.gold, need);
      if (pay <= 0) continue;
      this.gold -= pay;
      const [px, pz] = target.payPoint || this.payPoint(plot, h);
      h._coinAcc = (h._coinAcc || 0) + pay;
      if (h._coinAcc >= 1) {
        const n = Math.floor(h._coinAcc);
        h._coinAcc -= n;
        this.emit({ type: 'paycoin', fx: h.x, fz: h.z, tx: px, tz: pz, n: Math.min(n, 4) });
      }
      plot.payFx = 0.3; // renderer hint

      if (act.mode === 'repair') {
        this._repairPlot(plot, pay * SIEGE.repairHpPerGold);
        this.stats.repaired += pay;
        continue;
      }
      plot.paid += pay;
      if (plot.paid >= act.cost - 1e-6) {
        plot.paid = 0;
        if (act.mode === 'rebuild') this._rebuildPlot(plot);
        else this._construct(plot);
      } else if (this.gold <= 1e-6) {
        // Thronefall rule: an incomplete purchase is not a savings account.
        // If the purse runs dry, cancel this hold and send every committed coin
        // back. The player must release and press again before another attempt.
        h.payHold = false;
        forcedRefunds.add(plot.id);
      }
    }
    for (const plot of this.plots) {
      if (plot.paid <= 1e-6) continue;
      if (forcedRefunds.has(plot.id) || !activePayments.has(plot.id)) this._refundPlot(plot);
    }
  }

  _refundPlot(plot) {
    const amount = plot.paid;
    if (amount <= 1e-6) return;
    plot.paid = 0;
    this.gold += amount;
    const h = this.heroes[plot.refundHero || 0] || this.heroes[0];
    if (h) h._coinAcc = 0;
    const [px, pz] = this.payPoint(plot, h);
    this.emit({
      type: 'refundcoin',
      fx: px, fz: pz,
      tx: h?.x ?? px, tz: h?.z ?? pz,
      n: Math.min(24, Math.max(1, Math.ceil(amount))),
      v: amount,
    });
    this.msg(`↩️ ${Math.ceil(amount)} coin${amount >= 1.5 ? 's' : ''} returned — finish the cost in one hold.`, 'info');
  }

  _repairPlot(plot, hp) {
    const damaged = this.buildings.filter((b) => b.plotId === plot.id && b.alive && b.hp < b.maxHp);
    if (!damaged.length) return;
    const each = hp / damaged.length;
    for (const b of damaged) b.hp = Math.min(b.maxHp, b.hp + each);
    this.emit({ type: 'repair', x: plot.cx, z: plot.cz });
  }

  // Raise a ruin again at a discount — the ground remembers the plan.
  _rebuildPlot(plot) {
    const def = this.tierDef(plot, plot.tier);
    if (!def) return;
    if (plot.kind === 'wall') {
      for (const [x, z] of plot.tiles) {
        if (this.occ[z * this.map.size + x] === 0) {
          this._addBuilding(plot, x, z, def, x === plot.gate[0] && z === plot.gate[1]);
          this.emit({ type: 'build', kind: 'wall', plotId: plot.id, tier: plot.tier, x: x + 0.5, z: z + 0.5, quiet: true });
        }
      }
    } else if (!this.buildings.some((b) => b.plotId === plot.id)) {
      this._addBuilding(plot, plot.x, plot.z, def, false);
      this.emit({ type: 'build', kind: plot.kind, plotId: plot.id, tier: plot.tier, x: plot.cx, z: plot.cz });
    }
    plot.ruined = false;
    if (PLOT_KINDS[plot.kind].unit) plot.musterT = def.every;
    this.msg(`${PLOT_KINDS[plot.kind].icon} ${def.name} stands again.`, 'info');
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

    // Camps are faucets: they muster a squad now, then again on their timer.
    const unitKey = PLOT_KINDS[plot.kind].unit;
    if (unitKey) {
      plot.musterT = def.every;
      this._muster(plot, def);
    }
    if (plot.kind === 'hero_forge') {
      for (const h of this.heroes) this._refreshHeroDerived(h);
      this.msg(`⚛️ ${def.name}: all heroes gain +${Math.round(def.heroDmg * 100)}% damage, +${def.heroHp} HP, and ${Math.round(def.heroCdr * 100)}% cooldown reduction.`, 'info');
    }

    this.emit({ type: 'build', kind: plot.kind, plotId: plot.id, tier: plot.tier, x: plot.cx, z: plot.cz });
    if (!free) {
      if (unitKey) {
        const unit = UNITS[unitKey];
        const guard = def.dmg ? ` Short-range guns add ${def.dmg} damage at ${def.range} tiles.` : '';
        this.msg(`${PLOT_KINDS[plot.kind].icon} ${def.name} raised: ${def.count} ${unit.name}${def.count === 1 ? '' : 's'} every ${def.every}s.${guard} 1 holds, 2 escorts, 3 pushes the lanes.`, 'info');
      } else {
        this.msg(`${PLOT_KINDS[plot.kind].icon} ${def.name} ${plot.tier > 1 ? 'upgraded' : 'raised'}!`, 'info');
      }
    }
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
      hp: hp != null ? hp : maxHp, maxHp, alive: true, cooldown: 0, gate, priority: 0,
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

  // Camps and outposts muster a fresh squad on their own timer — this is the
  // faucet that replaced the dawn refill.
  _updateCamps(dt) {
    this._campT -= dt;
    if (this._campT > 0) return;
    const step = 0.5;
    this._campT = step;
    for (const plot of this.plots) {
      const kd = PLOT_KINDS[plot.kind];
      if (!kd.unit || plot.tier === 0 || plot.ruined) continue;
      const def = this.tierDef(plot, plot.tier);
      if (!def || !def.every) continue;
      const standing = this.buildings.some((b) => b.plotId === plot.id && b.alive);
      if (!standing) continue;
      plot.musterT = (plot.musterT != null ? plot.musterT : def.every) - step;
      if (plot.musterT <= 0) {
        plot.musterT = def.every;
        this._muster(plot, def);
      }
    }
  }

  // Paid support infrastructure removes repair laps. It restores structures
  // for free after construction, but never chooses or buys upgrades for the
  // player. That keeps gold decisions intentional and co-op deterministic.
  _updateSupport(dt) {
    this._supportT -= dt;
    if (this._supportT > 0) return;
    const step = 0.5;
    this._supportT = step;
    for (const source of this.buildings) {
      if (!source.alive || !source.def.repairRate || !source.def.repairRadius) continue;
      const r2 = source.def.repairRadius * source.def.repairRadius;
      const damaged = this.buildings.filter((b) => b.alive && b !== source && b.hp < b.maxHp - 0.5
        && dist2(source.cx, source.cz, b.cx, b.cz) <= r2);
      if (!damaged.length) continue;
      const amount = source.def.repairRate * step / damaged.length;
      for (const b of damaged) b.hp = Math.min(b.maxHp, b.hp + amount);
      this.emit({ type: 'repair', x: source.cx, z: source.cz, auto: true });
    }
  }

  _muster(plot, def) {
    const kindDef = PLOT_KINDS[plot.kind];
    // Each camp sustains its own standing force, so army size scales with how
    // many camps you have bought — not with how long you have been alive.
    const standing = this.units.filter((u) => u.camp === plot.id && !u.dead).length;
    const room = def.count * CAMP_STANDING - standing;
    const cap = this.unitCap();
    let spawned = 0;
    for (let i = 0; i < Math.min(def.count, room) && this.units.length < cap; i++) {
      const a = (i / Math.max(1, def.count)) * Math.PI * 2;
      const u = this._spawnUnit(kindDef.unit, plot.cx + Math.cos(a) * 1.6, plot.cz + 1.4 + Math.sin(a) * 0.8, plot.id);
      u.homeNodeId = plot.nodeId != null ? plot.nodeId : null;
      spawned++;
    }
    if (spawned) this.emit({ type: 'muster', x: plot.cx, z: plot.cz, n: spawned, kind: plot.kind });
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

  // Cycle a nearby tower's targeting doctrine. Free, instant, and the cheapest
  // real decision on the board.
  cycleTowerPriority(p = 0) {
    const h = this.heroes[p];
    if (!h || h.dead) return;
    let best = null, bd = 9;
    for (const b of this.buildings) {
      if (!b.alive || b.kind !== 'tower' || !b.def.dmg) continue;
      const d = dist2(h.x, h.z, b.cx, b.cz);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) { this.emit({ type: 'deny' }); return; }
    best.priority = ((best.priority || 0) + 1) % TOWER_PRIORITY.length;
    const mode = TOWER_PRIORITY[best.priority];
    this.emit({ type: 'towerpriority', x: best.cx, z: best.cz });
    this.msg(`${mode.icon} ${best.def.name} now targets: ${mode.name} — ${mode.desc}`, 'info');
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
    if (b.kind === 'hero_forge') for (const h of this.heroes) this._refreshHeroDerived(h);
    this.flowDirty = true;
    if (byZombie) {
      this.stats.lost++;
      this.emit({ type: 'bdestroyed', x: b.cx, z: b.cz });
      if (b.kind === 'hq') { this._gameOver(false); return; }
      const plot = this.plots.find((p) => p.id === b.plotId);
      if (plot) plot.ruined = true;
      // Nothing rebuilds itself any more — a ruin is a bill.
      this.msg(b.kind === 'wall'
        ? '🧱 The wall is breached! Hold B at the gate to raise it again.'
        : `${PLOT_KINDS[b.kind].icon} ${b.def.name} destroyed! Hold B on the ruin to rebuild it at half price.`, 'bad');
    }
  }

  // ---------- the siege clock ----------

  _updateSiege(dt) {
    if (this.phase !== 'live' || this.over) return;

    // Threat: the clock the player can blame themselves for.
    const before = this.threatLevel;
    // Nest count is capped for the clock: a five-hive map should mean MORE
    // sieges, not a faster clock on top of more sieges. Razing below three
    // still visibly slows it, which is the reward for pushing.
    this.threat = Math.min(THREAT.max, this.threat
      + (THREAT.perSecond + THREAT.perNest * Math.min(3, this.liveNests())) * dt * this.diff.mult);
    this.threatLevel = Math.max(1, Math.floor(this.threat) + 1);
    if (this.threatLevel > before) this._surge();

    this._updateIncome(dt);
    this._updateScouting();
    this._updateHives(dt);
    this._updateNodeBlight(dt);
    this._updateNodes(dt);

    // Campaign: raze every hive and the survivors call one last counterattack.
    if (!this.finalStand && this.nests.length && !this.liveNests()) {
      this.finalStand = true;
      this.msg('🔥 Every hive lies in ashes — but something enormous is already walking. Hold the Keep!', 'bad');
      this._spawnBoss(null);
      this._edgeAssault(Math.round(48 * this.diff.mult * this.level.mult));
    }
  }

  _surge() {
    if (!this.liveNests()) return;
    this.msg(`☠️ THREAT ${this.threatLevel}. Every hive musters at once — they are coming from all sides.`, 'bad');
    for (const n of this.nests) {
      if (!n.alive) continue;
      this._hiveMuster(n, SURGE_MULT);
      this.emit({ type: 'ping', x: n.x, z: n.z });
    }
    this.emit({ type: 'surge', level: this.threatLevel });
    // Survival: a boss walks every fifth Threat level, forever.
    if (this.mode === 'survival' && this.threatLevel % 5 === 0 && !this.boss) this._spawnBoss(null);
  }

  // Income is credited automatically now. Physical coins fall from combat and
  // conquest only — no more laps around your own town at dawn.
  _updateIncome(dt) {
    let rate = 0;
    for (const b of this.buildings) if (b.alive && b.def.income) rate += b.def.income;
    rate *= this.economy.income * (1 + this.relicMods.income);
    for (const n of this.nodes) {
      if (!n.offMap && n.owner === 'player') rate += SIEGE.nodeIncome * (n.def.income || 1);
    }
    rate /= SIEGE.incomePeriod;
    this.incomeRate = rate;
    this._incomeAcc += rate * dt;
    this.incomeT -= dt;
    if (this.incomeT > 0) return;
    this.incomeT = SIEGE.incomeTick;
    const pay = Math.floor(this._incomeAcc);
    if (pay <= 0) return;
    this._incomeAcc -= pay;
    this.gold += pay;
    this.stats.coins += pay;
    if (this.hq) this.emit({ type: 'income', x: this.hq.cx, z: this.hq.cz, v: pay });
  }

  // The ground around a living hive is poison. You cannot simply park an army
  // on a nest and grind it down for free.
  _updateNodeBlight(dt) {
    const r2 = NEST_BLIGHT_R * NEST_BLIGHT_R;
    const dps = NEST_BLIGHT_DPS;
    for (const n of this.nests) {
      if (!n.alive) continue;
      for (const u of this.units) {
        if (u.dead) continue;
        if (dist2(u.x, u.z, n.x, n.z) > r2) continue;
        this._damageUnit(u, dps * dt * (u.hero ? 0.45 : 1));
      }
    }
  }

  _updateHives(dt) {
    for (const n of this.nests) {
      if (!n.alive) continue;
      n.musterT -= dt;
      if (n.musterT <= 0) {
        n.musterT = hiveInterval(this.threat);
        this._hiveMuster(n, 1);
      }
    }
  }

  _hiveMuster(nest, mult) {
    const coopMult = 1 + 0.4 * (this.heroKeys.length - 1);
    const share = 3 / Math.max(3, this.nests.length);
    const w = hiveSquad(this.threat, this.diff.mult * this.level.mult * this.economy.pressure * coopMult * mult * share);
    // Ground the hive holds is where part of its muster ACTUALLY appears. This
    // moves pressure closer to you without adding any more of it — so taking a
    // hive-held node is worth doing for position, not just for income.
    const staging = this.nodes.filter((n) => !n.offMap && n.owner === 'hive');
    let fromNest = w.size;
    let spawned = 0;
    if (staging.length) {
      const forward = Math.floor(w.size * 0.4);
      fromNest -= forward;
      for (let i = 0; i < forward; i++) {
        const node = staging[(this.rng() * staging.length) | 0];
        const a = this.rng() * Math.PI * 2, r = 1 + this.rng() * 4;
        const x = node.x + Math.cos(a) * r, z = node.z + Math.sin(a) * r;
        if (!this.map.isWalkable(x | 0, z | 0)) continue;
        if (this._spawnZombie(this._pickHiveType(w.types), x, z, true, true)) spawned++;
      }
    }
    spawned += this._spawnHorde(Math.max(0, fromNest), [nest.id], w.types);
    if (spawned) this.emit({ type: 'hivemuster', x: nest.x, z: nest.z, n: spawned });
  }

  _pickHiveType(types) {
    let roll = this.rng(), acc = 0;
    for (const [t, p] of Object.entries(types)) { acc += p; if (roll <= acc) return t; }
    return 'walker';
  }

  // The final counterattack, once no hive is left to march from.
  _edgeAssault(size) {
    const w = hiveSquad(this.threat, this.diff.mult * this.level.mult * this.economy.pressure);
    this._spawnHorde(size, [], w.types);
    this.emit({ type: 'horde', final: true });
  }

  // ---------- lane nodes ----------

  _updateNodes(dt) {
    this._nodeT -= dt;
    if (this._nodeT > 0) return;
    const step = 0.25;
    this._nodeT = step;
    const r2 = SIEGE.captureRadius * SIEGE.captureRadius;

    for (const node of this.nodes) {
      if (node.offMap) continue;
      let friendly = 0, hostile = 0;
      for (const u of this.units) {
        if (u.dead) continue;
        if (dist2(u.x, u.z, node.x, node.z) <= r2) friendly++;
      }
      for (const zb of this.zombies) {
        if (zb.dead) continue;
        if (dist2(zb.x, zb.z, node.x, node.z) <= r2) { hostile++; if (hostile > 2) break; }
      }
      node.friendly = friendly;
      node.hostile = hostile;

      let claimant = null;
      if (friendly > 0 && hostile === 0) claimant = 'player';
      else if (hostile > 0 && friendly === 0) claimant = 'hive';

      if (!claimant || claimant === node.owner) {
        // Uncontested and already settled, or nobody there — bleed back down.
        node.cap = Math.max(0, node.cap - step * 0.5);
        if (node.cap === 0) node.capOwner = null;
        continue;
      }
      if (node.capOwner !== claimant) { node.capOwner = claimant; node.cap = 0; }
      node.cap += step;
      if (node.cap >= SIEGE.captureTime) this._flipNode(node, claimant);
    }

    const held = this.heldNodes();
    if (held > this.stats.bestHeld) this.stats.bestHeld = held;
  }

  _flipNode(node, owner) {
    const was = node.owner;
    node.owner = owner;
    node.cap = 0;
    node.capOwner = null;
    if (owner === 'player') {
      this.stats.nodes++;
      node.seen = true;
      this.threat = Math.min(THREAT.max, this.threat + THREAT.perCapture);
      // Some ground has something under it. Once only.
      const prize = node.def.firstClaim;
      if (prize && !node.looted) {
        node.looted = true;
        this.gold += prize.gold;
        this.stats.coins += prize.gold;
        for (const h of this.heroes) if (!h.dead) this.addXp(h, prize.xp);
        this.msg(`${node.def.icon} You break open ${node.name}: ${prize.gold} gold and old knowledge.`, 'info');
        this.emit({ type: 'loot', x: node.x, z: node.z });
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        this._spawnCoin(node.x + Math.cos(a) * 1.6, node.z + Math.sin(a) * 1.6, Math.ceil(DROPS.nodeCoins / 4), node.x, node.z);
      }
      this.msg(`🚩 ${node.name} is yours. It pays, it spawns, and you can raise a Forward Camp on it.`, 'info');
      this.emit({ type: 'nodetaken', x: node.x, z: node.z, id: node.id });
    } else {
      // Losing a node also ruins whatever you built on it.
      const plot = this.plots.find((p) => p.kind === 'outpost' && p.nodeId === node.id);
      if (plot && plot.tier > 0) {
        for (const b of this.buildings.filter((b) => b.plotId === plot.id)) this._destroyBuilding(b, true);
      }
      if (was === 'player') {
        this.msg(`🩸 ${node.name} has been overrun.`, 'bad');
        this.emit({ type: 'nodelost', x: node.x, z: node.z, id: node.id });
      }
    }
  }

  // ---------- routing ----------

  // Nearest graph index to a world position — where a squad joins the lanes.
  _nearestGi(x, z) {
    if (!this.laneGraph) return -1;
    let best = -1, bd = Infinity;
    for (const n of this.nodes) {
      if (n.offMap) continue;
      const d = dist2(x, z, n.x, n.z);
      if (d < bd) { bd = d; best = n.gi; }
    }
    if (this.hq) {
      const d = dist2(x, z, this.hq.cx, this.hq.cz);
      if (d < bd) { bd = d; best = this.cityGi; }
    }
    return best;
  }

  _giPoint(gi) {
    if (gi < this.nodes.length) return [this.nodes[gi].x, this.nodes[gi].z];
    const ni = gi - this.nodes.length;
    if (ni < this.nests.length) return [this.nests[ni].x, this.nests[ni].z];
    return this.hq ? [this.hq.cx, this.hq.cz] : [this.map.size / 2, this.map.size / 2];
  }

  // Walk `actor` onto the lanes and out to `gi`. Returns false if unreachable.
  _routeTo(actor, gi) {
    if (!this.laneGraph || gi < 0) return false;
    // Close enough to see it? Go straight there. Lanes exist to cross terrain,
    // and forcing a short hop back out through a lane node is how squads used
    // to circle an objective they were already standing next to.
    const [gx, gz] = this._giPoint(gi);
    if (dist2(actor.x, actor.z, gx, gz) < DIRECT_APPROACH_R * DIRECT_APPROACH_R) {
      actor.route = null;
      return true;
    }
    const from = this._nearestGi(actor.x, actor.z);
    if (from < 0) return false;
    const route = nodeRoute(this.laneGraph, from, gi);
    if (!route) return false;
    const pts = routeWaypoints(this.laneGraph, route);
    const [tx, tz] = this._giPoint(gi);
    pts.push([tx, tz]);
    if (!pts.length) return false;
    // Join the path at the waypoint we are ALREADY nearest to, never at index 0.
    // A route always begins at the nearest graph node, so a squad halfway down
    // a lane was being sent back to the node behind it, arriving, re-pathing,
    // and oscillating between the two forever — the whole army marching all day
    // and never once reaching the objective.
    let start = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = dist2(actor.x, actor.z, pts[i][0], pts[i][1]);
      if (d < bd) { bd = d; start = i; }
    }
    actor.route = pts;
    actor.routeI = start;
    actor.routeStuck = 0;
    actor.routeBest = Infinity;
    return true;
  }

  // Steer one step along a route. Returns true while the route is still live.
  _followRoute(actor, speed, dt, zombie = false) {
    if (!actor.route || actor.routeI >= actor.route.length) { actor.route = null; return false; }
    const [wx, wz] = actor.route[actor.routeI];
    const dx = wx - actor.x, dz = wz - actor.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.4) {
      actor.routeI++;
      actor.routeStuck = 0;
      actor.routeBest = Infinity;
      if (actor.routeI >= actor.route.length) { actor.route = null; return false; }
      return true;
    }
    // Progress watchdog. "Did it move at all" is the wrong question — a squad
    // grinding along a shoreline moves every tick and gets nowhere. Watch the
    // distance to the waypoint instead, and when that stops falling, throw the
    // route away so a fresh one is flooded from where the squad actually is.
    // Skipping ahead to the NEXT waypoint (the old behaviour) only aims it at
    // something further past the same obstacle.
    if (d < (actor.routeBest ?? Infinity) - 0.25) {
      actor.routeBest = d;
      actor.routeStuck = 0;
    } else {
      actor.routeStuck = (actor.routeStuck || 0) + dt;
      if (actor.routeStuck > 2.5) {
        actor.routeStuck = 0;
        actor.routeBest = Infinity;
        actor.route = null;
        actor.repathT = 0;
        return false;
      }
    }
    if (zombie) this._moveZombie(actor, dx / d, dz / d, speed, dt, true);
    else this._moveActor(actor, dx / d, dz / d, speed, dt);
    actor.facing = Math.atan2(dx, dz);
    return true;
  }

  // Every squad is born into one of two jobs, decided by id so it is stable and
  // deterministic. HOLDERS take a node and stay on it — ground you do not sit
  // on does not stay yours. PUSHERS march on a hive, capturing whatever the
  // holders are already standing on as the front line moves up.
  _isHolder(u) { return (u.id % 3) === 0; }

  _rank(u, list, spread) {
    if (!list.length) return -1;
    list.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    return list[u.id % Math.min(spread, list.length)][1];
  }

  _pickPushTarget(u) {
    const openNodes = () => this.nodes
      .filter((n) => !n.offMap && n.owner !== 'player')
      .map((n) => [dist2(u.x, u.z, n.x, n.z), n.gi]);
    const liveNests = () => this.nests
      .filter((n) => n.alive)
      .map((n) => [dist2(u.x, u.z, n.x, n.z), n.gi]);

    if (this._isHolder(u)) {
      const gi = this._rank(u, openNodes(), 6);
      if (gi >= 0) return gi;
      // Everything is ours — fall in with the push.
    }
    const gi = this._rank(u, liveNests(), 2);
    if (gi >= 0) return gi;
    return this._rank(u, openNodes(), 3);
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
      route: null, routeI: 0, targetNodeId: null, targetGi: -1,
    };
    this.units.push(u);
    return u;
  }

  // Army stance — one order for the whole army, no unit micro. DEFEND holds
  // the line, GUARD escorts the heroes, ATTACK walks the lanes and takes ground.
  setStance(st, p = 0) {
    if (!['defend', 'guard', 'attack'].includes(st) || st === this.stance) return;
    this.stance = st;
    if (st === 'defend') for (const u of this.units) if (!u.hero && !u.dead) { u.holdX = u.x; u.holdZ = u.z; }
    if (st !== 'attack') for (const u of this.units) if (!u.hero) { u.route = null; u.targetGi = -1; }
    const h = this.heroes[p];
    this.msg(st === 'defend' ? '🛡️ The army falls back to hold the line.'
      : st === 'guard' ? `🚩 The army forms up around ${h ? h.def.name : 'the heroes'}.`
      : '⚔️ The army pushes the lanes — take the nodes, then the hives!', 'info');
    this.emit({ type: st === 'defend' ? 'hold' : 'rally', x: h ? h.x : 0, z: h ? h.z : 0 });
  }

  // ---------- hero ----------

  // camp: the persistent campaign hero — { level, xp, items } (WC3-style).
  _spawnHero(key, x, z, camp = null) {
    const d = HEROES[key];
    const items = camp && camp.items ? [...camp.items] : [];
    const itemModsOnly = itemMods(items);
    const upgrades = normalizeHeroUpgrades((camp && camp.upgrades) || {});
    const level = Math.min(HERO_MAX_LEVEL, (camp && camp.level) || 1);
    const h = {
      id: nextId++, key, def: d, hero: true, x, z,
      hp: d.hp, maxHp: d.hp,
      mx: 0, mz: 0, sprint: false,
      cooldown: 0, target: null, facing: 0, retargetT: 0,
      level, xp: (camp && camp.xp) || 0, abilCd: 0,
      items, itemMods: itemModsOnly, mods: { ...itemModsOnly }, upgrades,
      reviveT: 0, hasteT: 0, hasteMult: 1, shieldHp: 0,
      fortifyT: 0, fortifyArmor: 0, fortifyThorns: 0, _summonId: null, _procT: {},
    };
    this._refreshHeroDerived(h, false);
    this.units.push(h);
    this.heroes.push(h);
    if (!this.hero) this.hero = h;
    return h;
  }

  _heroPassiveMods(h) {
    const mods = itemMods([]);
    const defs = h.def.passives || [];
    for (let i = 0; i < defs.length; i++) {
      const rank = h.upgrades[`passive${i + 1}`] || 0;
      if (!rank) continue;
      for (const [key, value] of Object.entries(defs[i].mods || {})) {
        mods[key] = (mods[key] || 0) + value * rank;
      }
    }
    return mods;
  }

  _refreshHeroDerived(h, keepHp = true) {
    const previousMax = h.maxHp || h.def.hp;
    const previousHp = h.hp || previousMax;
    const passiveMods = this._heroPassiveMods(h);
    const mods = { ...h.itemMods };
    for (const [key, value] of Object.entries(passiveMods)) mods[key] = (mods[key] || 0) + value;
    const forge = this._heroForgeMods();
    mods.dmg = (mods.dmg || 0) + forge.dmg;
    mods.hp = (mods.hp || 0) + forge.hp;
    mods.cdr = (mods.cdr || 0) + forge.cdr;
    h.mods = mods;
    h.maxHp = h.def.hp + h.def.levelHp * (h.level - 1) + h.mods.hp;
    h.skillPoints = heroUnspentUpgrades(h.level, h.upgrades);
    h.auraRank = h.upgrades.aura || 0;
    h.ultRank = h.upgrades.ult || 0;
    h.auraRadius = this.heroAuraRadius(h);
    if (!keepHp) h.hp = h.maxHp;
    else h.hp = Math.min(h.maxHp, previousHp + Math.max(0, h.maxHp - previousMax));
  }

  _heroForgeMods() {
    let best = null;
    for (const plot of this.plots || []) {
      if (plot.kind !== 'hero_forge' || plot.tier <= 0 || plot.ruined) continue;
      if (!this.buildings.some((b) => b.plotId === plot.id && b.alive)) continue;
      const def = this.tierDef(plot, plot.tier);
      if (!best || (def.heroDmg || 0) > (best.heroDmg || 0)) best = def;
    }
    return { dmg: best?.heroDmg || 0, hp: best?.heroHp || 0, cdr: best?.heroCdr || 0 };
  }

  heroRange(h) {
    return h.def.range + ((h.mods && h.mods.range) || 0);
  }

  heroUltDamageMult(h) {
    return 1 + ((h.upgrades && h.upgrades.ult) || 0) * 0.25;
  }

  heroAuraRadius(h) {
    const aura = h.def.aura;
    if (!aura) return 0;
    return aura.radius * (1 + ((h.mods && h.mods.auraR) || 0) + ((h.upgrades && h.upgrades.aura) || 0) * 0.16);
  }

  heroAuraEffect(h) {
    const aura = h.def.aura;
    const rank = (h.upgrades && h.upgrades.aura) || 0;
    if (!aura) return null;
    return {
      radius: this.heroAuraRadius(h),
      slow: aura.slow ? Math.max(0.35, aura.slow - rank * 0.07) : 0,
      regen: aura.regen ? aura.regen * (1 + rank * 0.22) : 0,
      drain: aura.drain ? aura.drain * (1 + rank * 0.25) : 0,
      leech: aura.leech ? aura.leech * (1 + rank * 0.12) : 0,
      dmgMult: aura.dmgMult ? aura.dmgMult + rank * 0.08 : 0,
      // Newer aura fields — same object, more simultaneous effects, following
      // the existing pattern instead of a second aura slot.
      crit: aura.crit ? aura.crit + rank * 0.03 : 0,
      armor: aura.armor ? Math.min(0.6, aura.armor + rank * 0.03) : 0,
      haste: aura.haste ? aura.haste + rank * 0.05 : 0,
    };
  }

  heroStats(h) {
    const aura = this.heroAuraEffect(h);
    const cdMult = 1 - ((h.mods && h.mods.cdr) || 0);
    return {
      damage: this.heroDmg(h),
      range: this.heroRange(h),
      rate: h.def.rof * (1 + ((h.mods && h.mods.rof) || 0)),
      speed: h.def.speed * (1 + 0.025 * (h.level - 1)) * (1 + ((h.mods && h.mods.speed) || 0)),
      regen: h.def.regen + 0.25 * (h.level - 1) + ((h.mods && h.mods.regen) || 0),
      cooldown: h.def.ability.cd * Math.max(0.15, cdMult),
      auraRadius: aura ? aura.radius : 0,
      auraAllies: h.auraAllies || 0,
      auraEnemies: h.auraEnemies || 0,
      skillPoints: h.skillPoints || 0,
    };
  }

  heroUpgradeChoices(h) {
    const passives = h.def.passives || [];
    return [
      {
        key: 'aura', icon: h.def.aura?.icon || '◯', name: h.def.aura?.name || 'Aura',
        desc: 'Bigger aura radius and stronger aura effect.',
      },
      {
        key: 'passive1', icon: passives[0]?.icon || '◆', name: passives[0]?.name || 'Passive I',
        desc: passives[0]?.desc || 'Improves core combat stats.',
      },
      {
        key: 'passive2', icon: passives[1]?.icon || '◆', name: passives[1]?.name || 'Passive II',
        desc: passives[1]?.desc || 'Improves survivability or utility.',
      },
      {
        // Not every ult is a pure nuke (Turtle fortifies, Tiger clones, Aaron
        // summons) — keep this label honest for all of them.
        key: 'ult', icon: h.def.ability.icon, name: `${h.def.ability.name} Rank`,
        desc: 'Unlocks a stronger tier of your special, and +25% damage per rank where it deals any.',
      },
    ].map((choice) => ({ ...choice, rank: h.upgrades[choice.key] || 0, max: HERO_UPGRADE_MAX }));
  }

  upgradeHero(p = 0, key) {
    const h = this.heroes[p];
    if (!h || h.dead || !HERO_UPGRADE_KEYS.includes(key)) { this.emit({ type: 'deny' }); return; }
    this._refreshHeroDerived(h);
    if (h.skillPoints <= 0 || (h.upgrades[key] || 0) >= HERO_UPGRADE_MAX) { this.emit({ type: 'deny' }); return; }
    h.upgrades[key]++;
    this._refreshHeroDerived(h);
    const choice = this.heroUpgradeChoices(h).find((c) => c.key === key);
    this.emit({ type: key === 'aura' ? 'auraupgrade' : 'levelup', x: h.x, z: h.z });
    this.msg(`⭐ ${h.def.name} upgraded ${choice ? `${choice.icon} ${choice.name}` : key} to rank ${h.upgrades[key]}.`, 'info');
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
      case 'heroUpgrade': this.upgradeHero(c.p || 0, c.key); break;
      case 'stance': this.setStance(c.s, c.p || 0); break;
      case 'choose': this.chooseBranch(c.id, c.b, c.p || 0); break;
      case 'towerpri': this.cycleTowerPriority(c.p || 0); break;
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
      this._refreshHeroDerived(h);
      h.hp = h.maxHp; // full heal on level up
      this.emit({ type: 'levelup', x: h.x, z: h.z });
      this.msg(`⭐ ${h.def.name} reached level ${h.level}! Choose an upgrade in the hero panel.`, 'info');
    }
    if (h.level >= HERO_MAX_LEVEL) h.xp = 0;
  }

  castAbility(p = 0) {
    const h = this.heroes[p];
    if (!h || h.dead) return;
    const ab = h.def.ability;
    if (h.abilCd > 0) { this.emit({ type: 'deny' }); return; }
    const r = abilityRank(h.level, h.upgrades) - 1;
    const ultMult = this.heroUltDamageMult(h);
    h.abilCd = ab.cd * Math.max(0.15, 1 - h.mods.cdr);

    switch (ab.cast) {
      case 'aoeDmg': {
        const r2 = ab.radius * ab.radius;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          if (dist2(h.x, h.z, zb.x, zb.z) <= r2) {
            if (ab.stun) zb.stunT = Math.max(zb.stunT || 0, ab.stun[r]);
            this.damageZombie(zb, ab.dmg[r] * ultMult, h.x, h.z);
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
          this.damageZombie(zb, ab.dmg[r] * ultMult, bx, bz);
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
        h.weaveDmg = ab.dmg[r] * ultMult;
        h.weaveKey = (h.weaveKey || 0) + 1;
        this.emit({ type: 'stealth', x: h.x, z: h.z });
        break;
      case 'fortify': {
        // Turtle: an armor/thorns spike plus an instant taunt — anything close
        // forgets there is anyone else on the field for the duration.
        h.fortifyT = ab.dur[r];
        h.fortifyArmor = ab.armor[r];
        h.fortifyThorns = ab.thorns[r];
        const r2 = (ab.radius || 7) * (ab.radius || 7);
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          if (dist2(h.x, h.z, zb.x, zb.z) <= r2) zb.targetU = h;
        }
        this.emit({ type: 'fortify', x: h.x, z: h.z, r: ab.radius || 7 });
        break;
      }
      case 'brew': {
        // John: an initial splash, then a lingering puddle that slows and
        // periodically staggers anything still standing in it (see _updateBrews).
        const r2 = ab.radius * ab.radius;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          if (dist2(h.x, h.z, zb.x, zb.z) <= r2) this.damageZombie(zb, ab.dmg[r] * ultMult, h.x, h.z);
        }
        this.brews.push({ x: h.x, z: h.z, r: ab.radius, t: ab.dur[r], slow: ab.slow[r], tickT: 0 });
        break;
      }
      case 'clone': {
        // Tiger: temporary copies of himself at reduced stats — real squad
        // units (so they use the same damage/snapshot path), tagged `temp`
        // with a lifespan, and exempt from XP/coin rewards on death like any
        // other non-hero unit.
        const count = ab.count[r];
        const dur = ab.dur[r];
        const mult = ab.statMult[r];
        const baseDmg = this.heroDmg(h);
        for (let i = 0; i < count; i++) {
          const a = (i / Math.max(1, count)) * Math.PI * 2;
          const x = h.x + Math.cos(a) * 1.4, z = h.z + Math.sin(a) * 1.4;
          const u = this._spawnUnit('tiger_clone', x, z, null);
          const hp = Math.round(h.maxHp * mult);
          u.def = { ...UNITS.tiger_clone, hp, dmg: Math.round(baseDmg * mult * ultMult), range: h.def.range, rof: h.def.rof, speed: h.def.speed, color: h.def.color };
          u.hp = hp; u.maxHp = hp;
          u.holdX = x; u.holdZ = z;
          u.temp = true; u.expireT = dur; u.ownerHeroId = h.id;
        }
        this.emit({ type: 'clone', x: h.x, z: h.z, count });
        break;
      }
      case 'summon': {
        // Aaron: a single spirit sentinel that fights until its time runs out
        // — recasting replaces it instead of stacking summons.
        if (h._summonId != null) {
          const old = this.units.find((u) => u.id === h._summonId && !u.dead);
          if (old) { old.dead = true; this.emit({ type: 'expire', x: old.x, z: old.z }); }
        }
        const dirX = Math.sin(h.facing), dirZ = Math.cos(h.facing);
        const sx = h.x + dirX * 1.6, sz = h.z + dirZ * 1.6;
        const u = this._spawnUnit('aaron_spirit', sx, sz, null);
        const hp = ab.hp[r];
        u.def = { ...UNITS.aaron_spirit, hp, dmg: Math.round(ab.dmg[r] * ultMult) };
        u.hp = hp; u.maxHp = hp;
        u.holdX = sx; u.holdZ = sz;
        u.temp = true; u.expireT = ab.dur[r]; u.ownerHeroId = h.id;
        h._summonId = u.id;
        this.emit({ type: 'summon', x: sx, z: sz });
        break;
      }
    }
    this.wakeZombies(h.x, h.z, 8);
    this.emit({ type: 'cast', x: h.x, z: h.z, radius: ab.radius || 3, icon: ab.icon, key: ab.key });
  }

  _updateHero(dt) {
    for (const h of this.heroes) this._updateHeroOne(h, dt);
  }

  // Generic auto-cast proc infrastructure: any hero passive can carry a
  // `proc: { key, kind, every: [r1,r2,r3], amount: [r1,r2,r3] }` alongside its
  // stat `mods`, and it fires on its own timer once that passive is ranked up.
  // Aaron's Aegis Ward (a periodic shield on the nearest wounded ally) is the
  // first user; this stays hero-agnostic so a future passive can reuse it.
  _updateHeroProcs(h, dt) {
    const passives = h.def.passives || [];
    if (!passives.length) return;
    for (let i = 0; i < passives.length; i++) {
      const proc = passives[i].proc;
      if (!proc) continue;
      const rank = h.upgrades[`passive${i + 1}`] || 0;
      if (rank <= 0) continue;
      const r = rank - 1;
      h._procT = h._procT || {};
      const t = (h._procT[proc.key] ?? 0) - dt;
      if (t > 0) { h._procT[proc.key] = t; continue; }
      h._procT[proc.key] = proc.every[r];
      if (proc.kind === 'shield') this._procShield(h, proc.amount[r]);
    }
  }

  // Shields the most wounded living ally (hero or squad unit) within aura
  // range. Uses the shieldHp pool that _damageUnit soaks before HP.
  _procShield(h, amount) {
    const radius = this.heroAuraRadius(h);
    const r2 = radius * radius;
    let best = null, bestFrac = 0.97;
    for (const u of this.units) {
      if (u.dead || u === h) continue;
      if (dist2(h.x, h.z, u.x, u.z) > r2) continue;
      const frac = u.hp / u.maxHp;
      if (frac < bestFrac) { bestFrac = frac; best = u; }
    }
    if (!best) return;
    best.shieldHp = Math.max(best.shieldHp || 0, amount);
    this.emit({ type: 'shieldproc', x: best.x, z: best.z });
  }

  // John's Last Call: a lingering puddle that slows and periodically staggers
  // any zombie standing in it. Not part of the save snapshot — it is a short
  // combat effect, and losing it on a mid-brew reload is a fair trade against
  // extra save-format surface for a few seconds of battlefield state.
  _updateBrews(dt) {
    if (!this.brews.length) return;
    const stagger = 1.4;
    for (const brew of this.brews) {
      brew.t -= dt;
      brew.tickT = (brew.tickT ?? 0) - dt;
      const pulse = brew.tickT <= 0;
      if (pulse) brew.tickT = stagger;
      const r2 = brew.r * brew.r;
      for (const zb of this.zombies) {
        if (zb.dead) continue;
        if (dist2(brew.x, brew.z, zb.x, zb.z) > r2) continue;
        zb.slowT = Math.max(zb.slowT || 0, 0.5);
        zb.slowMul = Math.min(zb.slowMul ?? 1, brew.slow);
        if (pulse) zb.stunT = Math.max(zb.stunT || 0, 0.35);
      }
      if (pulse) this.emit({ type: 'brewzone', x: brew.x, z: brew.z, r: brew.r });
    }
    if (this.brews.some((b) => b.t <= 0)) this.brews = this.brews.filter((b) => b.t > 0);
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
    // hasteT/hasteMult decay centrally in _updateUnits (it walks every unit,
    // heroes included, once per tick — decrementing it here too would burn it
    // twice as fast).

    // Turtle's Last Stand: armor/thorns spike expires on its own clock.
    if (h.fortifyT > 0) {
      h.fortifyT -= dt;
      if (h.fortifyT <= 0) { h.fortifyT = 0; h.fortifyArmor = 0; h.fortifyThorns = 0; }
    }

    // Aaron's Aegis Ward (and any future proc-style passive) ticks here.
    this._updateHeroProcs(h, dt);

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
    if (!d) return null;
    const zb = {
      id: nextId++, type, def: d, x, z,
      hp: d.hp, maxHp: d.hp,
      state: aggro ? AGGRO : IDLE,
      dirX: 0, dirZ: 0, timer: this.rng() * 4,
      atkT: 0, targetU: null, phase: this.rng() * Math.PI * 2,
      wave, hitFlash: 0, route: null, routeI: 0, frenzy: 0,
    };
    this.zombies.push(zb);
    return zb;
  }

  _spawnBoss(nestId) {
    if (this.boss) return;
    const B = this.nightBossDef();
    this.bossDef = B;
    const nest = nestId != null ? this.nests[nestId] : null;
    let [x, z] = nest && nest.alive ? [nest.x, nest.z] : this._edgeSpawnPoint();
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
      wave: true, hitFlash: 0, boss: true, cfg: B, route: null, routeI: 0, frenzy: 0,
      armor: B.armor || 0, spawnT: B.spawn ? B.spawn.every : 0, roarT: B.roar ? B.roar.every : 0,
    };
    this.zombies.push(zb);
    this.boss = zb;
    this.msg(`${B.icon} ${B.name} has entered the field: "${B.desc}"`, 'bad');
    this.emit({ type: 'bossspawn', x, z });
    this.emit({ type: 'ping', x, z });
  }

  // Which boss stalks this run (survival cycles the roster as Threat climbs).
  nightBossDef() {
    if (this.mode === 'campaign') return this.level.boss;
    const idx = Math.max(0, (((this.threatLevel / 5) | 0) - 1) % LEVELS.length);
    const base = LEVELS[idx].boss;
    return { ...base, hp: Math.round(base.hp * (0.8 + this.threatLevel * 0.06)) };
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

  // A random spawn point at the map rim — the final counterattack's road in,
  // and the escape hatch for marooned horde zombies.
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
    // Raiders peel off to hit the ground you hold; the rest march on the Keep.
    const playerNodes = this.nodes.filter((n) => !n.offMap && n.owner === 'player');
    while (spawned < size && guard++ < size * 30) {
      let x, z;
      if (nestIds.length) {
        const n = this.nests[nestIds[(this.rng() * nestIds.length) | 0]];
        const a = this.rng() * Math.PI * 2, r = 1.5 + this.rng() * 6;
        x = n.x + Math.cos(a) * r; z = n.z + Math.sin(a) * r;
      } else {
        [x, z] = this._edgeSpawnPoint();
      }
      if (!this.map.isWalkable(x | 0, z | 0)) continue;
      // Only spawn where the city is actually reachable, so the siege always
      // arrives and the map can always be cleared.
      if (this.flow.distAt(x | 0, z | 0) === Infinity && guard < size * 25) continue;
      const zb = this._spawnZombie(pickType(), x, z, true, true);
      if (!zb) continue;
      spawned++;
      if (playerNodes.length && this.rng() < SIEGE.raiderShare) {
        const node = playerNodes[(this.rng() * playerNodes.length) | 0];
        if (this._routeTo(zb, node.gi)) zb.raider = true;
      }
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
        this.msg(`🏆 ${(zb.cfg || this.level.boss).name} IS SLAIN!`, 'info');
        this.emit({ type: 'bossdown', x: zb.x, z: zb.z });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          this._spawnCoin(zb.x + Math.cos(a) * 1.4, zb.z + Math.sin(a) * 1.4, Math.ceil(DROPS.bossCoins / 5), zb.x, zb.z);
        }
        // Campaign victory: the hives are ash and their champion is down.
        if (this.mode === 'campaign' && this.finalStand) { this._gameOver(true); return; }
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
      this.emit({ type: 'zdeath', x: zb.x, z: zb.z, big: zb.type === 'brute' || zb.type === 'sieger', dx: ldx, dz: ldz, force });
      // Shared XP for kills near any hero.
      for (const h of this.heroes) {
        if (!h.dead && dist2(h.x, h.z, zb.x, zb.z) < XP_RADIUS * XP_RADIUS) {
          this.addXp(h, zb.def.score * 8);
        }
      }
      // Every enemy pays. Large enemies and bosses keep their larger rewards,
      // but no kill can produce an empty corpse.
      if (!zb.boss) {
        const value = zb.type === 'brute' || zb.type === 'sieger' ? DROPS.bruteCoins : DROPS.enemyCoins;
        this._spawnCoin(zb.x, zb.z, value, zb.x, zb.z);
      }
    }
  }

  _damageBuilding(b, dmg, source = null) {
    if (!b.alive) return;
    b.hp -= dmg;
    b.hitT = this.time;
    this.emit({ type: 'bhit', x: b.cx, z: b.cz, fromId: source?.id, fx: source?.x, fz: source?.z });
    if (this.time - (this._uaT || -99) > 20) {
      this._uaT = this.time;
      this.msg('⚔️ The city is under attack!', 'warn');
      this.emit({ type: 'ping', x: b.cx, z: b.cz });
      this.emit({ type: 'underattack' });
    }
    if (b.hp <= 0) this._destroyBuilding(b, true);
  }

  // Single choke point for damage landing on a hero OR a squad unit. Evade,
  // armor, shield-absorb and thorns-reflect all live here so every attacker
  // (zombie melee/ranged, blight DoT) gets the same defensive resolution.
  // `attacker` is the zombie that dealt the hit, when one is available — pass
  // null for damage sources thorns should not reflect against (e.g. blight).
  _damageUnit(u, dmg, attacker = null) {
    const mods = u.mods || null;
    const evade = (u.def.evadeChance || 0) + ((mods && mods.evadeChance) || 0);
    if (dmg > 0 && evade > 0 && this.rng() < evade) {
      this.emit({ type: 'evade', x: u.x, z: u.z });
      return;
    }
    const armor = (u.def.armor || 0) + ((mods && mods.armor) || 0) + (u.fortifyArmor || 0) + (u.auraArmor || 0);
    if (armor > 0) dmg *= Math.max(0.25, 1 - armor);
    if (u.shieldHp > 0 && dmg > 0) {
      const absorb = Math.min(u.shieldHp, dmg);
      u.shieldHp -= absorb;
      dmg -= absorb;
    }
    const thorns = (u.def.thorns || 0) + ((mods && mods.thorns) || 0) + (u.fortifyThorns || 0);
    if (thorns > 0 && dmg > 0 && attacker && !attacker.dead) {
      this.damageZombie(attacker, dmg * thorns, u.x, u.z);
    }
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
    this._updateSiege(dt);
    if (this.over) return;
    this._updatePlots(dt);
    this._updateCamps(dt);
    this._updateSupport(dt);
    this._updateCoins();
    this._updateFlow(dt);
    this._updateZombies(dt);
    this._updateAuras(dt);
    this._updateBrews(dt);
    this._updateUnits(dt);
    this._updateTowers(dt);
    this._updateHero(dt);
    this._cleanup();
  }

  // Hero auras — the passive third of the kit (auto-attack, aura, special).
  _updateAuras(dt) {
    for (const u of this.units) {
      if (!u.hero) u.auraDmg = 1;
      u.auraCrit = 0;
      u.auraArmor = 0;
      u.auraSources = [];
    }
    for (const zb of this.zombies) zb.auraSources = [];
    for (const h of this.heroes) {
      if (h.dead) continue;
      const aura = h.def.aura;
      if (!aura) continue;
      const effect = this.heroAuraEffect(h);
      const radius = effect.radius;
      const r2 = radius * radius;
      h.auraAllies = 0;
      h.auraEnemies = 0;
      if (effect.dmgMult || effect.regen || effect.crit || effect.armor || effect.haste) {
        for (const u of this.units) {
          if (u.dead || u === h) continue;
          if (dist2(h.x, h.z, u.x, u.z) > r2) continue;
          h.auraAllies++;
          u.auraSources.push(aura.key);
          if (effect.dmgMult && !u.hero) u.auraDmg = Math.max(u.auraDmg, effect.dmgMult);
          if (effect.regen) u.hp = Math.min(u.maxHp, u.hp + effect.regen * dt);
          if (effect.crit) u.auraCrit = Math.max(u.auraCrit || 0, effect.crit);
          if (effect.armor) u.auraArmor = Math.max(u.auraArmor || 0, effect.armor);
          if (effect.haste) { u.hasteT = Math.max(u.hasteT || 0, 0.4); u.hasteMult = Math.max(u.hasteMult || 1, 1 + effect.haste); }
        }
      }
      if (effect.slow || effect.drain) {
        h._auraT = (h._auraT || 0) - dt;
        const tick = 0.3;
        const applyTick = h._auraT <= 0;
        if (applyTick) h._auraT = tick;
        let drained = 0;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          if (dist2(h.x, h.z, zb.x, zb.z) > r2) continue;
          h.auraEnemies++;
          zb.auraSources.push(aura.key);
          if (!applyTick) continue;
          if (effect.slow) {
            zb.slowT = Math.max(zb.slowT || 0, 0.5);
            zb.slowMul = effect.slow;
          }
          if (effect.drain) {
            const bite = Math.min(zb.hp, effect.drain * tick);
            this.damageZombie(zb, effect.drain * tick);
            drained += bite;
          }
        }
        if (applyTick && drained > 0 && effect.leech) h.hp = Math.min(h.maxHp, h.hp + drained * effect.leech);
      } else {
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          if (dist2(h.x, h.z, zb.x, zb.z) > r2) continue;
          h.auraEnemies++;
          zb.auraSources.push(aura.key);
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

    // Callers: everything near one hits harder and moves faster until it dies.
    for (const zb of this.zombies) zb.frenzy = 0;
    for (const caller of this.zombies) {
      const call = caller.def.call;
      if (!call || caller.dead) continue;
      const r2 = call.radius * call.radius;
      for (const zb of this.zombies) {
        if (zb.dead || zb === caller) continue;
        if (dist2(caller.x, caller.z, zb.x, zb.z) <= r2) zb.frenzy = Math.max(zb.frenzy, 1);
      }
    }

    for (const zb of this.zombies) {
      if (zb.dead) continue;
      if (zb.hitFlash > 0) zb.hitFlash -= dt;
      zb.timer -= dt;
      zb.atkT -= dt;

      if (zb.boss) this._updateBoss(zb, dt);

      if (zb.stunT > 0) { zb.stunT -= dt; continue; }
      let speedMul = 1 + (zb.frenzy ? (zb.def.call ? 0 : 0.3) : 0);
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
        // Wake only when the city practically touches them — creeps out in the
        // wild are optional XP, not an ambush.
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
        // Marooned on ground the city can't be reached from? Relocate the
        // horde zombie so every siege can always be finished.
        if (zb.wave && !zb.route && this.flow.distAt(zb.x | 0, zb.z | 0) === Infinity) {
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
      const dmgMul = 1 + (zb.frenzy && !zb.def.call ? (ZOMBIES.caller.call.dmg) : 0);
      const range = zb.def.ranged || 0;

      // Siegers ignore your army entirely and go eat a building.
      if (zb.def.siege) { this._updateSieger(zb, dt, dmgMul); continue; }

      // 1) Chase a nearby living unit if close. Veiled heroes are invisible.
      if (zb.targetU && (zb.targetU.dead || zb.targetU.stealth || dist2(zb.x, zb.z, zb.targetU.x, zb.targetU.z) > 130)) zb.targetU = null;
      zb.retarget = (zb.retarget || 0) - dt;
      if (!zb.targetU && zb.retarget <= 0) {
        zb.retarget = 0.4 + this.rng() * 0.3;
        let best = null, bd = Math.max(100, (range + 2) * (range + 2)); // within 10 tiles, or weapon reach
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
        const reach = range || 0.75;
        if (d < reach) {
          const cd = range ? (1 / (zb.def.rof || 0.5)) : 0.8;
          if (zb.atkT <= 0) {
            zb.atkT = cd;
            // Thorns only reflects real melee contact (a bite), not a spitter's
            // ranged acid from outside the fight.
            this._damageUnit(u, zb.def.dmg * dmgMul, range ? null : zb);
            this.emit({ type: range ? 'spit' : 'bite', fromId: zb.id, fx: zb.x, fz: zb.z, tx: u.x, tz: u.z, x: u.x, z: u.z, targetScale: u.hero ? 1.18 : 1 });
          }
        } else {
          this._moveZombie(zb, dx / d, dz / d, zb.def.chase * zb.speedMul, dt, true);
        }
        continue;
      }

      // 2) Raiders walk their lane to the ground you took.
      if (zb.route && this._followRoute(zb, zb.def.chase * zb.speedMul, dt, true)) continue;

      // 3) Spitters shell whatever structure is in reach before closing.
      if (range && this._spitAtBuilding(zb, range, dmgMul)) continue;

      // 4) Follow the flow field toward the city.
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

  // Spitter: hits structures from outside their reach, so turtling is not a
  // strategy — somebody has to come out.
  _spitAtBuilding(zb, range, dmgMul) {
    if (zb.atkT > 0) {
      // Already shelling something this cycle; hold position.
      return !!zb._spitTarget;
    }
    let best = null, bd = range * range;
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const d = dist2(zb.x, zb.z, b.cx, b.cz);
      if (d < bd) { bd = d; best = b; }
    }
    zb._spitTarget = best;
    if (!best) return false;
    zb.atkT = 1 / (zb.def.rof || 0.5);
    zb.dirX = best.cx - zb.x; zb.dirZ = best.cz - zb.z;
    this._damageBuilding(best, zb.def.dmg * dmgMul, zb);
    this.emit({ type: 'spit', fromId: zb.id, fx: zb.x, fz: zb.z, tx: best.cx, tz: best.cz, x: best.cx, z: best.cz, targetKind: 'building' });
    return true;
  }

  // Sieger: walks past your army, ignores it completely, and eats structures.
  _updateSieger(zb, dt, dmgMul) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const d = dist2(zb.x, zb.z, b.cx, b.cz);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) {
      const dir = this.flow.dirAt(zb.x | 0, zb.z | 0);
      if (dir) this._moveZombie(zb, dir[0], dir[1], zb.def.chase * zb.speedMul, dt, true);
      return;
    }
    const dx = best.cx - zb.x, dz = best.cz - zb.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < best.size / 2 + 1.1) {
      if (zb.atkT <= 0) {
        zb.atkT = 1.1;
        this._damageBuilding(best, zb.def.dmg * dmgMul, zb);
        this.emit({ type: 'bite', fromId: zb.id, fx: zb.x, fz: zb.z, tx: best.cx, tz: best.cz, x: best.cx, z: best.cz, targetKind: 'building' });
      }
      return;
    }
    this._moveZombie(zb, dx / d, dz / d, zb.def.chase * zb.speedMul, dt, true);
  }

  _moveZombie(zb, dx, dz, speed, dt, canAttack) {
    const nx = zb.x + dx * speed * dt;
    const nz = zb.z + dz * speed * dt;
    const tx = nx | 0, tz = nz | 0;
    const occId = this.occ[tz * this.map.size + tx];
    // Burrowers tunnel: barriers simply are not there for them.
    if (occId > 0 && zb.def.burrow) {
      if (this.map.isWalkable(tx, tz)) { zb.x = nx; zb.z = nz; zb.dirX = dx; zb.dirZ = dz; }
      return;
    }
    if (occId > 0 && canAttack) {
      // Chew on whatever is in the way (gates included).
      if (zb.atkT <= 0) {
        zb.atkT = 0.85;
        const b = this.buildings.find((o) => o.id === occId);
        if (b) {
          this._damageBuilding(b, zb.def.dmg, zb);
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
      // Temporary allies (Tiger's clones, Aaron's spirit sentinel) expire on
      // their own clock instead of dying to damage. No XP/coins either way —
      // _damageUnit never revives or rewards a non-hero unit's death.
      if (!u.dead && u.expireT != null) {
        u.expireT -= dt;
        if (u.expireT <= 0) {
          u.dead = true;
          this.emit({ type: 'expire', x: u.x, z: u.z });
        }
      }
      if (u.hasteT > 0) u.hasteT -= dt;
      if (u.dead || u.hero) { if (u.hero) { u.cooldown -= dt; u.retargetT -= dt; } } else {
        u.cooldown -= dt;
        u.retargetT -= dt;
      }
      if (u.dead) continue;

      if (!u.hero) {
        if (this.stance === 'guard') {
          // GUARD: escort the nearest living hero, loosely fanned out by id.
          u.route = null;
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
          // ATTACK: creep-wave. Fight what's in front of you; otherwise walk
          // the lanes to the next thing that isn't ours yet.
          this._pushLane(u, dt);
        } else {
          // DEFEND: drift back to the hold point if shoved away.
          u.route = null;
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
        // Pushing troops HUNT (see far beyond weapon range); everyone else
        // only engages what wanders into range.
        const hunting = !u.hero && this.stance === 'attack';
        const range = u.hero ? this.heroRange(u) : u.def.range;
        // A pushing squad only stops for what is actually on top of it.
        const seek = hunting ? Math.max(range + 2, 10) : range;
        let best = null, bd = seek * seek;
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          const d = dist2(u.x, u.z, zb.x, zb.z);
          if (d < bd) { bd = d; best = zb; }
        }
        u.target = best;
        // Siege priority. A squad that has marched all the way to a hive must
        // shoot the HIVE, not the endless garrison around it — otherwise the
        // garrison is an infinite shield and the nest never takes a scratch.
        // Anything actually in your face still comes first.
        u.targetNest = null;
        let bn = null, bnd = (range + 2.5) ** 2;
        for (const n of this.nests) {
          if (!n.alive) continue;
          const d = dist2(u.x, u.z, n.x, n.z);
          if (d < bnd) { bnd = d; bn = n; }
        }
        if (bn && (!best || bd > SIEGE_GUARD_R * SIEGE_GUARD_R)) {
          u.targetNest = bn;
          u.target = null;
        }
      }
      // hasteT/hasteMult now apply to any unit (Aaron's Warding Field buffs
      // squad troops too), not just heroes self-buffing.
      const rofMult = (u.hasteT > 0 ? (u.hasteMult || 1) : 1) * (u.hero ? 1 + u.mods.rof : 1);
      const attackRange = u.hero ? this.heroRange(u) : u.def.range;
      // Crit: a hero's own chance (base + passives) plus whatever an aura is
      // granting right now (John's Reckless Bravado reaches squad troops too).
      // Rolled here — the actual attack execution, not heroStats()/heroDmg()
      // display math — so the shared RNG stream stays identical across peers
      // regardless of how often each client's HUD happens to re-render.
      const hitDmg = () => {
        let dmg = u.hero ? this.heroDmg(u) : u.def.dmg * (u.auraDmg || 1) * (1 + this.relicMods.troopDmg);
        const critChance = (u.hero ? (u.def.critChance || 0) + (u.mods.critChance || 0) : 0) + (u.auraCrit || 0);
        if (critChance > 0 && this.rng() < critChance) dmg *= (u.hero && u.def.critMult) || 1.75;
        return dmg;
      };
      if (u.target && !u.target.dead && u.cooldown <= 0) {
        const zb = u.target;
        if (dist2(u.x, u.z, zb.x, zb.z) <= attackRange * attackRange) {
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
          this.emit({ type: 'shot', kind, fromId: u.id, heroKey: u.hero ? u.key : null, fx: u.x, fz: u.z, tx: zb.x, tz: zb.z, fy: u.hero ? 0.9 : 0.7, targetScale: zb.def.scale });
          if (u.def.noise > 0) this.wakeZombies(u.x, u.z, u.def.noise);
        }
      } else if (u.targetNest && u.targetNest.alive && u.cooldown <= 0) {
        const n = u.targetNest;
        if (dist2(u.x, u.z, n.x, n.z) <= (attackRange + 2.5) ** 2) {
          u.cooldown = 1 / (u.def.rof * rofMult);
          u.facing = Math.atan2(n.x - u.x, n.z - u.z);
          this._damageNest(n, hitDmg());
          const kind = u.hero ? (u.def.melee ? 'melee' : u.def.shotgun ? 'shotgun' : 'hero') : u.key;
          this.emit({ type: 'shot', kind, fromId: u.id, heroKey: u.hero ? u.key : null, fx: u.x, fz: u.z, tx: n.x, tz: n.z, fy: u.hero ? 0.9 : 0.7, targetKind: 'nest' });
          if (u.def.noise > 0) this.wakeZombies(u.x, u.z, u.def.noise);
        }
      }
    }
  }

  // One squad's push: engage what's in front, else walk the lane to the next
  // piece of ground that isn't ours. No micro — the player only chose a stance.
  _pushLane(u, dt) {
    // Something in weapon reach? Stand and fight.
    if (u.target && !u.target.dead) {
      const d = Math.hypot(u.target.x - u.x, u.target.z - u.z);
      if (d > u.def.range * 0.85) {
        this._moveActor(u, (u.target.x - u.x) / d, (u.target.z - u.z) / d, u.def.speed, dt);
        u.facing = Math.atan2(u.target.x - u.x, u.target.z - u.z);
        u.moving = true;
      } else u.moving = false;
      return;
    }
    if (u.targetNest && u.targetNest.alive) {
      const n = u.targetNest;
      const dx = n.x - u.x, dz = n.z - u.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > u.def.range + 1.2) {
        this._moveActor(u, dx / d, dz / d, u.def.speed, dt);
        u.facing = Math.atan2(dx, dz);
        u.moving = true;
      } else u.moving = false;
      return;
    }

    // Re-pick a destination when we have none, or when ours went friendly.
    const holder = this._isHolder(u);
    const stale = u.targetGi < 0
      || (!holder && u.targetGi < this.nodes.length && this.nodes[u.targetGi].owner === 'player' && !u.route)
      || (u.targetGi >= this.nodes.length && u.targetGi < this.nodes.length + this.nests.length
          && !this.nests[u.targetGi - this.nodes.length].alive);
    u.repathT = (u.repathT || 0) - dt;
    if (stale || (!u.route && u.repathT <= 0)) {
      u.repathT = 1.5;
      const gi = this._pickPushTarget(u);
      if (gi >= 0 && gi !== u.targetGi) {
        u.targetGi = gi;
        u.targetNodeId = gi < this.nodes.length ? gi : null;
        this._routeTo(u, gi);
      } else if (gi >= 0 && !u.route) {
        this._routeTo(u, gi);
      }
    }

    if (u.route && this._followRoute(u, u.def.speed, dt)) { u.moving = true; return; }

    // Arrived: hold the ground so the capture ticks over.
    if (u.targetGi >= 0) {
      const [tx, tz] = this._giPoint(u.targetGi);
      const dx = tx - u.x, dz = tz - u.z;
      const d = Math.hypot(dx, dz);
      if (d > 3.5) {
        this._moveActor(u, dx / d, dz / d, u.def.speed, dt);
        u.facing = Math.atan2(dx, dz);
        u.moving = true;
        return;
      }
    }
    u.moving = false;
  }

  _damageNest(n, dmg) {
    if (!n.alive) return;
    n.hp -= dmg;
    this.emit({ type: 'bhit', x: n.x, z: n.z });
    // A hive under the knife spits defenders. Razing one is a siege you have
    // to commit to, not a speed bump you walk over.
    if ((n.defendT || 0) <= this.time) {
      n.defendT = this.time + 9;
      const w = hiveSquad(this.threat, this.diff.mult * this.level.mult);
      this._spawnHorde(Math.max(4, Math.round(w.size * 0.8)), [n.id], w.types);
      this.emit({ type: 'hivemuster', x: n.x, z: n.z });
    }
    if (n.hp <= 0) {
      n.alive = false;
      n.hp = 0;
      this.stats.nests++;
      this.threat = Math.min(THREAT.max, this.threat + THREAT.perNestRazed);
      // Razing a hive pays: a fountain of gold from the corpse-hoard.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this._spawnCoin(n.x + Math.cos(a) * 1.8, n.z + Math.sin(a) * 1.8, Math.ceil(DROPS.nestCoins / 6), n.x, n.z);
      }
      const left = this.liveNests();
      this.emit({ type: 'nestdown', x: n.x, z: n.z });
      this.msg(`🔥 A hive nest is razed! ${left ? `${left} still mustering.` : 'The land holds its breath…'}`, 'info');
    }
  }

  // Tower targeting doctrine — the free tactical decision.
  _towerPick(b) {
    const r2 = b.def.range * b.def.range;
    const mode = TOWER_PRIORITY[b.priority || 0].key;
    let best = null, bd = r2, bestScore = -Infinity;
    for (const zb of this.zombies) {
      if (zb.dead) continue;
      const d = dist2(b.cx, b.cz, zb.x, zb.z);
      if (d > r2) continue;
      if (mode === 'nearest') {
        if (d < bd) { bd = d; best = zb; }
        continue;
      }
      let score;
      if (mode === 'strongest') score = zb.hp;
      else if (mode === 'siege') score = (zb.def.siege || zb.boss ? 1e6 : 0) - d;
      else score = (zb.def.ranged || zb.def.call ? 1e6 : 0) - d;
      // Ties (and "nothing matches") fall back to nearest.
      score -= d * 1e-3;
      if (score > bestScore) { bestScore = score; best = zb; }
    }
    return best;
  }

  _updateTowers(dt) {
    for (const b of this.buildings) {
      if (!b.alive || !b.def.dmg || !b.def.range || !b.def.rof) continue;
      b.cooldown -= dt;
      if (b.stunT > 0) { b.stunT -= dt; continue; }
      if (b.cooldown > 0) continue;
      const best = this._towerPick(b);
      if (best) {
        b.cooldown = 1 / b.def.rof;
        const tdmg = b.def.dmg * (1 + this.relicMods.towerDmg);
        const plot = this.plots.find((p) => p.id === b.plotId);
        const shotY = b.kind === 'outpost'
          ? 1.75 + (((plot && plot.tier) || 1) - 1) * 0.28
          : 2.2 + ((plot && plot.tier) || 1) * 0.45 + 0.48;
        const shotKind = b.kind === 'outpost'
          ? (b.def.splash ? 'outpostSiege' : 'outpost')
          : (b.def.branch === 'ballista' ? 'ballista' : 'tower');
        if (b.def.splash) {
          const s2 = b.def.splash * b.def.splash;
          for (const zb of this.zombies) {
            if (!zb.dead && dist2(best.x, best.z, zb.x, zb.z) <= s2) this.damageZombie(zb, tdmg, b.cx, b.cz);
          }
          this.emit({ type: 'shot', kind: b.kind === 'outpost' ? shotKind : 'flame', buildingId: b.id, fx: b.cx, fz: b.cz, tx: best.x, tz: best.z, fy: shotY, targetScale: best.def.scale });
        } else {
          this.damageZombie(best, tdmg, b.cx, b.cz);
          this.emit({ type: 'shot', kind: shotKind, buildingId: b.id, fx: b.cx, fz: b.cz, tx: best.x, tz: best.z, fy: shotY, targetScale: best.def.scale });
        }
        b.lastTx = best.x; b.lastTz = best.z;
        this.wakeZombies(b.cx, b.cz, b.kind === 'outpost' ? 7 : 9);
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
