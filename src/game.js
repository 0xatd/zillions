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
  DAMAGE_TYPES, RESIST_CAP, VOID_ARMOR_SHARE,
  DODGE_CD, DODGE_TIME, DODGE_IFRAMES, DODGE_SPEED,
  START_GOLD, COIN_CAP, COIN_RADIUS, PAY_RADIUS, PAY_RATE, UPGRADE_PAY_RATE,
  NEST_HP_BASE, NEST_HP_LEVEL_SHARE, DROPS, itemMods, itemInfo, itemLines, weaponFor, hasSecondSet,
  latticeMods, latticeDoctrines,
  equippedKeys,
  WEAPON_SWAP_CD,
  rollLootKey, worldItemLevel,
  ITEMS, FIELD_LOOT, PACK_SLOTS, LOOT_PICKUP_RADIUS, LOOT_REVEAL_RADIUS, LOOT_DROP_COOLDOWN,
  HEROES, HERO_MAX_LEVEL, XP_RADIUS, xpForLevel, abilityRank, heroGrowthUnits, levelById,
  HERO_UPGRADE_KEYS, HERO_UPGRADE_MAX, normalizeHeroUpgrades, heroUnspentUpgrades,
  LABYRINTH_LIVES, BLESSING_KEYS,
} from './config.js';
import { FlowField } from './flowfield.js';
import { generatePlots } from './plots.js';
import { buildLaneGraph, nodeRoute, reachableFrom, routeWaypoints } from './lanes.js';
import { clamp, dist2, makeRNG } from './utils.js';

const IDLE = 0, WANDER = 1, AGGRO = 2;
const OUTPOST_PLOT_BASE = 5000;   // outpost plot ids never collide with city plots
const NEST_BLIGHT_R = 7.5;        // the poisoned ground around a living hive
const NEST_BLIGHT_DPS = 6;        // damage per second to anything standing in it
const SIEGE_GUARD_R = 3.6;        // closer than this and you deal with the guard first
const DIRECT_APPROACH_R = 24;     // inside this, walk straight at the objective
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const POCKET_CAP = 150;           // reachable-tile flood-fill cap: below this, it's a sealed pocket
const COMBAT_CELL = 8;            // broad-phase bucket width for uncapped armies
const FIRST_SIEGE_KINDS = new Set(['house', 'farm', 'tower', 'camp_militia']);
const FIRST_SIEGE_REWARD = 24;

let nextId = 1000;
const getNextId = () => nextId;
const setNextId = (v) => { nextId = v; };
const LABYRINTH_DOOR_ID = 2000000000;
const snapNum = (v) => (Number.isFinite(v) ? v : 0);
const snapRoute = (route) => Array.isArray(route) ? route.map(([x, z]) => [snapNum(x), snapNum(z)]) : null;

export function combatBuckets(actors) {
  const buckets = new Map();
  for (const actor of actors) {
    if (actor.dead) continue;
    const key = `${Math.floor(actor.x / COMBAT_CELL)},${Math.floor(actor.z / COMBAT_CELL)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(actor); else buckets.set(key, [actor]);
  }
  return buckets;
}

export const ARMY_PEAK_SAMPLE_SECONDS = 1;
export function sampleArmyPeak(units, peak, time, nextSampleAt = 0) {
  if (time + 1e-9 < nextSampleAt) return nextSampleAt;
  const composition = {};
  for (const unit of units) {
    if (unit.hero || unit.dead) continue;
    composition[unit.key] = (composition[unit.key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(composition)) {
    peak[key] = Math.max(peak[key] || 0, count);
  }
  return (Math.floor(time / ARMY_PEAK_SAMPLE_SECONDS) + 1) * ARMY_PEAK_SAMPLE_SECONDS;
}

export function nearbyBuckets(buckets, fallback, x, z, radius) {
  if (!buckets) return fallback;
  const found = [];
  const minX = Math.floor((x - radius) / COMBAT_CELL), maxX = Math.floor((x + radius) / COMBAT_CELL);
  const minZ = Math.floor((z - radius) / COMBAT_CELL), maxZ = Math.floor((z + radius) / COMBAT_CELL);
  for (let bz = minZ; bz <= maxZ; bz++) for (let bx = minX; bx <= maxX; bx++) {
    const bucket = buckets.get(`${bx},${bz}`);
    if (bucket) found.push(...bucket);
  }
  return found;
}

export class Game {
  // heroKeys: a hero key string (solo) or an array of keys (co-op, one per player).
  constructor(map, difficulty = 'normal', heroKeys = 'alexander', snap = null, levelId = 1, mode = 'campaign') {
    this.map = map;
    this.diffKey = difficulty;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.levelId = snap ? snap.level : levelId;
    this.mode = snap ? snap.mode || 'campaign' : mode;
    this.level = levelById(this.levelId || 1);
    this.economy = { startGold: START_GOLD, income: 1, pressure: 1, ...(this.level.economy || {}) };
    this.boss = null;
    this.rng = makeRNG(999);

    this.gold = this.economy.startGold;
    this.coins = [];             // physical coins on the ground
    this.loot = [];              // items lying on the frontier, most of them hidden
    this._lootSerial = 0;        // per-game roll counter — see _scatterLoot()
    this._doctrineScorched = false;  // resolved by _refreshDoctrines()
    this._doctrineHollow = false;
    this.site = -1;              // chosen city site index (-1 = not founded yet)
    this.plots = [];             // generated when the city is founded
    this.buildings = [];
    this.units = [];
    this.zombies = [];
    this.occ = new Int32Array(map.size * map.size); // building id per tile
    this.gateIds = new Set();    // building ids friendlies may pass through
    this.flow = new FlowField(map);
    // The mirror field for the living: walls block, gates are the way through.
    // A squad caught inside its own rampart descends this to the nearest gate.
    this.exitField = new FlowField(map);
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
    // Campaign onboarding is a state machine, not a stack of timed tooltips.
    // It narrows the first build choice, names the first attack before it
    // arrives, and pays off the first defense. The state is lockstep-safe.
    this.firstSiege = this.mode === 'campaign' && this.levelId === 1
      ? { stage: 'opening', nestId: null, waveIds: [], reward: FIRST_SIEGE_REWARD }
      : null;
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
      heroDeaths: 0, bossKillT: null, repaired: 0, spent: 0,
      damageTaken: {}, builtByKind: {}, lostByKind: {}, armyPeak: {},
    };
    this._armyPeakSampleAt = 0;

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

    // Labyrinth run state — zeros/nulls in every other mode.
    this.lives = 0;              // shared team lives; a hero's fall spends one
    this.checkpoint = null;      // where the fallen return: start, then each razed chamber
    this.blessingOffers = [];    // per-player [key,key,key] while a choice is open
    this.pursuitTime = 0;
    this.pursuitStage = 0;
    this.pursuitSpawnT = 120;
    this.labyrinthChoices = {};
    this.labyrinthEncounters = [];

    if (snap) this._restore(snap);
    else if (this.mode === 'labyrinth') this._setupLabyrinth();
    else this._setupStart();
  }

  // ---------- save / restore (v5: terrain-anchored cities + field loot) ----------
  // Plot state restores BY ID and plot ids are positional, so any change to the
  // order `generatePlots` lays a city out invalidates older snapshots. Bump the
  // version when that happens — a stale save restores a house's tier onto a
  // gate tower and looks like a corrupted city.

  snapshot() {
    return {
      v: 5, seed: this.map.seed, diff: this.diffKey, heroKeys: this.heroKeys, level: this.levelId, mode: this.mode,
      time: snapNum(this.time), threat: snapNum(this.threat), threatLevel: this.threatLevel,
      phase: this.phase, finalStand: this.finalStand ? 1 : 0,
      gold: snapNum(this.gold),
      site: this.site,
      stance: this.stance,
      firstSiege: this.firstSiege ? {
        stage: this.firstSiege.stage, nestId: this.firstSiege.nestId,
        waveIds: [...this.firstSiege.waveIds], reward: this.firstSiege.reward,
      } : null,
      relics: [...this.relics],
      // Labyrinth run state. Offers are snapshotted so a save restored
      // mid-choice reproduces the exact same three options.
      lives: this.lives,
      checkpoint: this.checkpoint ? { x: snapNum(this.checkpoint.x), z: snapNum(this.checkpoint.z) } : null,
      blessingOffers: this.blessingOffers.map((o) => (o ? [...o] : null)),
      pursuit: [snapNum(this.pursuitTime), this.pursuitStage, snapNum(this.pursuitSpawnT)],
      labyrinthChoices: { ...this.labyrinthChoices },
      labyrinthEncounters: this.labyrinthEncounters.map((e) => ({ ...e })),
      flowSeeds: this.mode === 'labyrinth' ? [...(this._flowSeeds || [])] : null,
      flowT: snapNum(this.flowTimer),
      timers: {
        incomeT: snapNum(this.incomeT), incomeAcc: snapNum(this._incomeAcc), incomeRate: snapNum(this.incomeRate),
        nodeT: snapNum(this._nodeT), campT: snapNum(this._campT), supportT: snapNum(this._supportT), armyPeakSampleAt: snapNum(this._armyPeakSampleAt), bossSpawnT: this.bossSpawnT != null ? snapNum(this.bossSpawnT) : null,
      },
      brews: this.brews.map((b) => ({
        x: snapNum(b.x), z: snapNum(b.z), r: snapNum(b.r),
        t: snapNum(b.t), slow: snapNum(b.slow), tickT: snapNum(b.tickT || 0),
      })),
      nests: this.nests.map((n) => [snapNum(n.hp), n.alive ? 1 : 0, snapNum(n.musterT), snapNum(n.defendT || 0)]),
      nodes: this.nodes.map((n) => [n.owner, snapNum(n.cap), n.capOwner || '', n.seen ? 1 : 0, n.empty ? 1 : 0, n.looted ? 1 : 0]),
      stats: {
        ...this.stats,
        damageTaken: { ...(this.stats.damageTaken || {}) },
        builtByKind: { ...(this.stats.builtByKind || {}) },
        lostByKind: { ...(this.stats.lostByKind || {}) },
        armyPeak: { ...(this.stats.armyPeak || {}) },
      },
      rng: this.rng.getState(), nextId: getNextId(),
      plots: this.plots.map((p) => ({
        id: p.id, tier: p.tier, paid: snapNum(p.paid), branch: p.branch,
        ruined: p.ruined ? 1 : 0, musterT: p.musterT != null ? snapNum(p.musterT) : null,
        musterSeq: p.musterSeq || 0,
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
        gateExit: u.gateExit ? 1 : 0, gateCool: snapNum(u.gateCool || 0),
        exitDx: u.exitDx != null ? snapNum(u.exitDx) : null,
        exitDz: u.exitDz != null ? snapNum(u.exitDz) : null,
        shield: snapNum(u.shieldHp || 0),
        squad: u.squadId || null, squadI: u.squadIndex ?? -1, squadN: u.squadSize || 0,
        // Temporary allies (Tiger's clones, Aaron's spirit) carry a lifespan and
        // a per-instance stat override instead of the shared UNITS[key] def.
        temp: u.temp ? 1 : 0, expire: u.expireT != null ? snapNum(u.expireT) : null,
        ownerHero: u.ownerHeroId != null ? u.ownerHeroId : null,
        def: u.temp ? Object.fromEntries(
          ['hp', 'dmg', 'range', 'rof', 'speed', 'noise', 'color', 'melee', 'shotgun', 'splash']
            .filter((key) => u.def[key] != null)
            .map((key) => [key, typeof u.def[key] === 'number' ? snapNum(u.def[key]) : u.def[key]]),
        ) : null,
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
        pack: [...(h.pack || [])],
        equip: { ...(h.equipment || {}) },
        style: h.characterStyle ? structuredClone(h.characterStyle) : null,
        set: h.activeSet || 0, swapCd: snapNum(h.swapCd || 0),
        dodgeT: snapNum(h.dodgeT || 0), dodgeIT: snapNum(h.dodgeIT || 0),
        dodgeCd: snapNum(h.dodgeCd || 0),
        dodgeX: snapNum(h.dodgeX || 0), dodgeZ: snapNum(h.dodgeZ || 0),
        treeMods: h.treeMods ? { ...h.treeMods } : null,
        treeSets: h.treeSets ? h.treeSets.map((bag) => ({ ...bag })) : null,
        doctrines: [...(h.doctrines || [])],
        blessings: [...(h.blessings || [])],
        fallen: h.fallen ? 1 : 0,
        upgrades: { ...h.upgrades },
      })),
      loot: this.loot.map((l) => [l.key, snapNum(l.x), snapNum(l.z), l.hidden ? 1 : 0, snapNum(l.cool || 0)]),
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
        spawnT: snapNum(z.spawnT || 0), roarT: snapNum(z.roarT || 0), bossPhase: z.bossPhase || 0,
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
    this.firstSiege = snap.firstSiege ? {
      stage: snap.firstSiege.stage || 'opening', nestId: snap.firstSiege.nestId ?? null,
      waveIds: [...(snap.firstSiege.waveIds || [])], reward: snap.firstSiege.reward || FIRST_SIEGE_REWARD,
    } : null;
    if (this.site >= 0) {
      this.plots = generatePlots(this.map, this.map.sites[this.site], { levelId: this.levelId, siteIdx: this.site });
      this._claimed = true; // ownership comes from the save, not a fresh roll
      this._buildLaneSystems(this.map.sites[this.site]);
    }
    this.relics = [...(snap.relics || [])];
    this.relicMods = itemMods(this.relics);
    this.lives = snap.lives ?? 0;
    this.checkpoint = snap.checkpoint ? { x: snap.checkpoint.x, z: snap.checkpoint.z } : null;
    this.blessingOffers = (snap.blessingOffers || []).map((o) => (o ? [...o] : null));
    [this.pursuitTime, this.pursuitStage, this.pursuitSpawnT] = snap.pursuit || [0, 0, 120];
    this.labyrinthChoices = { ...(snap.labyrinthChoices || {}) };
    this.labyrinthEncounters = (snap.labyrinthEncounters || []).map((e) => ({ ...e }));
    if (this.mode === 'labyrinth' && !this.labyrinthEncounters.length) {
      this.labyrinthEncounters = (this.map.labyrinthLayout?.encounters || []).map((e) => ({
        key: e.key, nest: e.nest, status: 'waiting', wave: 0, waveT: 0,
      }));
    }
    if (this.mode === 'labyrinth' && this.checkpoint) {
      // offMap is not snapshotted; it is a pure function of the map and any
      // point inside the corridor, and the checkpoint always is one — so the
      // same pruning re-derives the exact same partition on every restore.
      this._pruneUnreachable(this.checkpoint);
    }
    const timers = snap.timers || {};
    this.incomeT = timers.incomeT ?? this.incomeT;
    this._incomeAcc = timers.incomeAcc ?? 0;
    this.incomeRate = timers.incomeRate ?? 0;
    this._nodeT = timers.nodeT ?? 0;
    this._campT = timers.campT ?? 0;
    this._supportT = timers.supportT ?? 0;
    this._armyPeakSampleAt = timers.armyPeakSampleAt ?? 0;
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
    this.stats = {
      nests: 0, nodes: 0, bestHeld: 0, heroDeaths: 0, bossKillT: null, repaired: 0,
      spent: 0, damageTaken: {}, builtByKind: {}, lostByKind: {}, armyPeak: {}, ...snap.stats,
      damageTaken: { ...(snap.stats?.damageTaken || {}) },
      builtByKind: { ...(snap.stats?.builtByKind || {}) },
      lostByKind: { ...(snap.stats?.lostByKind || {}) },
      armyPeak: { ...(snap.stats?.armyPeak || {}) },
    };
    this.loot = (snap.loot || []).map(([key, x, z, hidden, cool]) => ({
      id: nextId++, key, x, z, hidden: !!hidden, cool: cool || 0,
    }));

    for (const ps of snap.plots) {
      const p = this.plots.find((o) => o.id === ps.id);
      if (p) {
        p.tier = ps.tier; p.paid = ps.paid; p.branch = ps.branch;
        p.ruined = !!ps.ruined;
        if (ps.musterT != null) p.musterT = ps.musterT;
        p.musterSeq = ps.musterSeq || 0;
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
    this.brews = (snap.brews || []).map((b) => ({
      x: b.x, z: b.z, r: b.r, t: b.t, slow: b.slow, tickT: b.tickT || 0,
    }));

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
      u.gateExit = !!us.gateExit;
      u.gateCool = us.gateCool || 0;
      u.exitDx = us.exitDx ?? null;
      u.exitDz = us.exitDz ?? null;
      u.shieldHp = us.shield || 0;
      u.squadId = us.squad || null;
      u.squadIndex = us.squadI ?? -1;
      u.squadSize = us.squadN || 0;
      if (us.temp) {
        u.temp = true;
        u.expireT = us.expire;
        u.ownerHeroId = us.ownerHero;
        const savedDef = us.def || (us.defHp != null ? { hp: us.defHp, dmg: us.defDmg } : null);
        if (savedDef) u.def = { ...u.def, ...savedDef };
        u.maxHp = savedDef && savedDef.hp != null ? savedDef.hp : u.maxHp;
      }
      actorsById.set(u.id, u);
      pendingActorTargets.push([u, us]);
    }
    for (const hs of snap.heroes) {
      const h = this._spawnHero(hs.k, hs.x, hs.z, {
        level: hs.level, xp: hs.xp, items: hs.items || [], pack: hs.pack || [], upgrades: hs.upgrades || {},
        equipment: hs.equip || {},
        treeMods: hs.treeMods || null,
        treeSets: hs.treeSets || null,
        doctrines: hs.doctrines || [],
        activeSet: hs.set || 0,
        characterStyle: hs.style || null,
      });
      if (hs.id) h.id = hs.id;
      if (hs.blessings && hs.blessings.length) {
        h.blessings = [...hs.blessings];
        this._refreshPackMods(h); // blessings count toward mods before hp lands
      }
      h.fallen = !!hs.fallen;
      h.swapCd = hs.swapCd || 0;
      h.dodgeT = hs.dodgeT || 0; h.dodgeIT = hs.dodgeIT || 0;
      h.dodgeCd = hs.dodgeCd || 0;
      h.dodgeX = hs.dodgeX || 0; h.dodgeZ = hs.dodgeZ || 0;
      // Old saves can restore heroes into crag/water or inside fresh
      // footprints — reseat to the nearest safe tile, frontier fallback if
      // the whole area is sealed. Same guarantee the launch path has.
      {
        const seat = this._reseat(h.x, h.z);
        if (seat) { h.x = seat[0]; h.z = seat[1]; }
        else { const [fx, fz] = this._frontierSpawnPoints(1)[0]; h.x = fx; h.z = fz; }
      }
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
      zb.bossPhase = meta.bossPhase || 0;
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
    if (this.mode === 'labyrinth' && Array.isArray(snap.flowSeeds)) {
      // Rebuild the exact hunting field the save was using — recomputing from
      // the heroes' restored positions would give a slightly different field
      // and desync a restored peer from an uninterrupted one. Empty seeds
      // (every hero down, revives pending) still compute: that fills the
      // field with Infinity, matching the live game's state at that moment.
      this._restoreLabyrinthDoors();
      this._flowSeeds = [...snap.flowSeeds];
      this.flow.compute(this.occ, this._flowSeeds, this.gateIds);
      const restoreGateTiles = [];
      for (let i = 0; i < this.occ.length; i++) {
        const id = this.occ[i];
        if (id !== 0 && this.gateIds.has(id)) restoreGateTiles.push(i);
      }
      this.exitField.compute(this.occ, restoreGateTiles, this.gateIds, true);
      this.flowDirty = false;
      this.flowTimer = snap.flowT ?? 0;
    }
    this.msg(this.mode === 'labyrinth'
      ? '📂 The labyrinth remembers you — the trial continues.'
      : '📂 The city stands as you left it — the siege continues.', 'info');
  }

  // ---------- setup ----------

  // The run opens un-founded: heroes ride a wild frontier dotted with marked
  // city sites, lane nodes and hive nests. Claim a site to raise the city.
  _setupStart() {
    this.phase = 'found';
    const spawns = this._frontierSpawnPoints(this.heroSetups.length);
    this.heroSetups.forEach((e, i) => this._spawnHero(e.k, spawns[i][0], spawns[i][1], e.camp));
    this._scatterCreeps();
    this._scatterLoot();
    this.msg('🏳️ The frontier is yours to claim. Ride to a marked site and use Build to found your city.', 'info');
  }

  configureLivingWorldBattle(assignment) {
    const snapshot=assignment?.force_snapshot;
    const parties=Array.isArray(snapshot?.parties)?snapshot.parties:[];
    const armies=Array.isArray(snapshot?.armies)?snapshot.armies:[];
    const stacks=Array.isArray(snapshot?.stacks)?snapshot.stacks:[];
    const playerParty=parties.find((party)=>party.owner_user_id===assignment.requested_by);
    if(!playerParty||!snapshot?.attackerPartyId||!snapshot?.defenderPartyId)throw new Error('invalid_living_world_battle_assignment');
    const opponentPartyId=playerParty.id===snapshot.attackerPartyId?snapshot.defenderPartyId:snapshot.attackerPartyId;
    const armyParty=new Map(armies.map((army)=>[army.id,army.party_id]));
    const playerStacks=stacks.filter((stack)=>armyParty.get(stack.army_id)===playerParty.id);
    const enemyStacks=stacks.filter((stack)=>armyParty.get(stack.army_id)===opponentPartyId);
    if(!playerStacks.length||!enemyStacks.length)throw new Error('empty_living_world_battle_force');
    this.mode='living_world_battle';this.phase='live';this.finalStand=false;this.firstSiege=null;
    this.nests=[];this.nodes=[];this.plots=[];this.buildings=[];this.coins=[];this.loot=[];this.zombies=[];
    this.units=this.heroes.filter((hero)=>!hero.dead);
    const anchor=this.heroes[0]||{x:this.map.size*.25,z:this.map.size*.5};
    const enemyAnchor=this._reseat(Math.min(this.map.size-3,anchor.x+10),anchor.z)||[Math.min(this.map.size-3,anchor.x+10),anchor.z];
    this.livingWorldBattle={assignmentId:assignment.id,playerPartyId:playerParty.id,opponentPartyId,
      attackerPartyId:snapshot.attackerPartyId,defenderPartyId:snapshot.defenderPartyId,initial:{},losses:{}};
    const friendlyKey=(key)=>/snip/i.test(key)?'sniper':/ranger|spear|scout/i.test(key)?'ranger':'soldier';
    const enemyKey=(key)=>/brute|heavy/i.test(key)?'brute':/ranger|raider|scout/i.test(key)?'runner':'walker';
    for(const [side,rows] of [['player',playerStacks],['enemy',enemyStacks]])for(const stack of rows){
      const count=Math.max(0,Number(stack.healthy)||0);this.livingWorldBattle.initial[stack.id]=count;this.livingWorldBattle.losses[stack.id]=0;
      for(let index=0;index<count;index++){
        const angle=(index/Math.max(1,count))*Math.PI*2,radius=2+Math.floor(index/12)*.7;
        const actor=side==='player'?this._spawnUnit(friendlyKey(stack.unit_key),anchor.x+Math.cos(angle)*radius,anchor.z+Math.sin(angle)*radius)
          :this._spawnZombie(enemyKey(stack.unit_key),enemyAnchor[0]+Math.cos(angle)*radius,enemyAnchor[1]+Math.sin(angle)*radius,true,true);
        if(actor){actor.strategicStackId=stack.id;const scale=1+Math.max(0,(Number(stack.tier)||1)-1)*.12;actor.maxHp*=scale;actor.hp=actor.maxHp;actor.def={...actor.def,dmg:actor.def.dmg*scale};}
      }
    }
    this.stance='attack';
    return this.livingWorldBattle;
  }

  // ---------- labyrinth setup ----------

  // The Labyrinth: no founding, no colony, no army — the run opens live, with
  // the heroes standing in the safest sanctuary and every chamber's brood nest
  // between them and the way out. Each razed nest offers a blessing and moves
  // the checkpoint forward; raze them all and the champion walks.
  _setupLabyrinth() {
    this.phase = 'live';
    // Lives are a shared team pool. A bigger party burns through them faster,
    // so each extra hero banks one more.
    this.lives = LABYRINTH_LIVES + (this.heroSetups.length - 1);
    const start = this._labyrinthStart();
    this.checkpoint = { x: start.x, z: start.z };
    this._pruneUnreachable(start);
    const spawns = this._frontierSpawnPoints(this.heroSetups.length, start);
    this.heroSetups.forEach((e, i) => this._spawnHero(e.k, spawns[i][0], spawns[i][1], e.camp));
    this._scatterCreeps();
    this._scatterLoot();
    this.labyrinthChoices = {};
    this.labyrinthEncounters = (this.map.labyrinthLayout?.encounters || []).map((e) => ({
      key: e.key, nest: e.nest, status: 'waiting', wave: 0, waveT: 0,
    }));
    const chambers = this.liveNests();
    this.msg(`🌀 The labyrinth opens. ${chambers} brood chambers stand between you and its champion — raze each one, take its blessing, and keep moving. ${this.lives} lives.`, 'info');
  }

  // The start sanctuary: of the flattened sites the terrain offers, take the
  // one farthest from the nearest brood nest — the ground the hive wants least.
  _labyrinthStart() {
    let best = this.map.sites[0], bd = -1;
    for (const s of this.map.sites) {
      let nearest = Infinity;
      for (const [nx, nz] of this.map.nestSpots || []) {
        nearest = Math.min(nearest, dist2(s.x, s.z, nx, nz));
      }
      if (nearest > bd) { bd = nearest; best = s; }
    }
    return best;
  }

  // Anything the start sanctuary cannot walk to does not exist for this trial:
  // an unreachable brood nest would make the run unwinnable, and an
  // unreachable node is a lie on the minimap.
  _pruneUnreachable(start) {
    const N = this.map.size;
    const seen = new Uint8Array(N * N);
    const sx = Math.round(start.x), sz = Math.round(start.z);
    const queue = [[sx, sz]];
    seen[sz * N + sx] = 1;
    while (queue.length) {
      const [x, z] = queue.pop();
      for (const [dx, dz] of DIR4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const k = nz * N + nx;
        if (seen[k] || !this.map.isWalkable(nx, nz)) continue;
        seen[k] = 1;
        queue.push([nx, nz]);
      }
    }
    const reachable = (x, z) => {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const tx = (x | 0) + dx, tz = (z | 0) + dz;
          if (tx >= 0 && tz >= 0 && tx < N && tz < N && seen[tz * N + tx]) return true;
        }
      }
      return false;
    };
    for (const nest of this.nests) {
      if (reachable(nest.x, nest.z)) continue;
      nest.offMap = true;
      nest.alive = false;
      nest.hp = 0;
    }
    for (const node of this.nodes) node.offMap = !reachable(node.x, node.z);
  }

  // A razed chamber offers each player a choice of three blessings. Offers are
  // drawn from the shared seeded RNG in player order, so lockstep peers draw
  // identically; a new razing overwrites an ignored older offer.
  _offerBlessings() {
    for (let p = 0; p < this.heroes.length; p++) {
      const h = this.heroes[p];
      if (!h) continue;
      const pool = BLESSING_KEYS.filter((k) => !(h.blessings || []).includes(k));
      const offer = [];
      while (offer.length < 3 && pool.length) {
        const i = (this.rng() * pool.length) | 0;
        offer.push(pool.splice(i, 1)[0]);
      }
      this.blessingOffers[p] = offer.length ? offer : null;
    }
    this.emit({ type: 'blessing' });
    this.msg('✨ The chamber falls silent — choose a blessing before you go deeper.', 'info');
  }

  // Lockstep-safe pick: an index over the wire, ignored when stale/invalid.
  chooseBlessing(p, i) {
    const offer = this.blessingOffers[p];
    const h = this.heroes[p];
    if (!offer || !h || i < 0 || i >= offer.length) return;
    const key = offer[i];
    h.blessings = h.blessings || [];
    h.blessings.push(key);
    this.blessingOffers[p] = null;
    this._refreshPackMods(h);
    this.emit({ type: 'blessed', x: h.x, z: h.z });
    this.msg(`✨ ${h.def.name} takes the ${itemInfo(key)?.name || 'blessing'}.`, 'info');
  }

  // Terrain generation owns the centre of the map. It may place deep forest,
  // water, or crag there, so fixed centre coordinates can seal an entire
  // co-op party inside impassable ground. Find the nearest connected patch of
  // walkable tiles and place every hero on that patch deterministically.
  // `anchor` overrides the search centre (the labyrinth anchors on its start
  // sanctuary instead of the map middle).
  _frontierSpawnPoints(count, anchor = null) {
    const N = this.map.size;
    const cx = anchor ? Math.round(anchor.x) : N >> 1;
    const cz = anchor ? Math.round(anchor.z) : N >> 1;
    const candidates = [];
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        if (this.map.isWalkable(x, z)) candidates.push([x, z]);
      }
    }
    candidates.sort((a, b) => {
      const ad = (a[0] - cx) ** 2 + (a[1] - cz) ** 2;
      const bd = (b[0] - cx) ** 2 + (b[1] - cz) ** 2;
      return ad - bd || a[1] - b[1] || a[0] - b[0];
    });

    const required = Math.max(1, count);
    const checked = new Set();
    for (const [sx, sz] of candidates) {
      const startKey = sz * N + sx;
      if (checked.has(startKey)) continue;
      const queue = [[sx, sz]];
      const component = [];
      checked.add(startKey);
      for (let i = 0; i < queue.length && component.length < Math.max(12, required); i++) {
        const [x, z] = queue[i];
        component.push([x + 0.5, z + 0.5]);
        for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          const nx = x + dx, nz = z + dz, key = nz * N + nx;
          if (nx <= 0 || nz <= 0 || nx >= N - 1 || nz >= N - 1
            || checked.has(key) || !this.map.isWalkable(nx, nz)) continue;
          checked.add(key);
          queue.push([nx, nz]);
        }
      }
      if (component.length >= required) return component.slice(0, required);
    }
    throw new Error('Map has no connected walkable frontier spawn');
  }

  foundCity(siteIdx, p = 0) {
    if (this.phase !== 'found' || this.over) return;
    const site = this.map.sites[siteIdx];
    if (!site) return;
    this.site = siteIdx;
    this.plots = generatePlots(this.map, site, { levelId: this.levelId, siteIdx: siteIdx });
    const hqPlot = this.plots.find((pl) => pl.kind === 'hq');
    this._construct(hqPlot, true); // the Keep rises with the founding
    this.hq = this.buildings.find((b) => b.kind === 'hq');
    this._buildLaneSystems(site);
    this.heroes.forEach((h, i) => {
      if (h.dead) return;
      // Founding formation prefers the classic line south of the Keep, but
      // each hero falls back to the first free ring tile if their slot is
      // unwalkable (fen/crag at the site edge) or already footprinted.
      const fx = this.hq.cx - 1 + i * 2, fz = this.hq.cz + 3.5;
      if (this.map.isWalkable(fx | 0, fz | 0) && this.occ[(fz | 0) * this.map.size + (fx | 0)] === 0) {
        h.x = fx; h.z = fz;
      } else { h.x = this.hq.cx; h.z = this.hq.cz; this._ejectActor(h, this.hq); }
    });
    this.phase = 'live';
    if (this.firstSiege) {
      const reachable = this.nests.filter((n) => n.alive && !n.offMap);
      const live = reachable.length ? reachable : this.nests.filter((n) => n.alive);
      const closest = live.sort((a, b) => dist2(a.x, a.z, site.x, site.z) - dist2(b.x, b.z, site.x, site.z))[0];
      this.firstSiege.nestId = closest?.id ?? null;
      for (const nest of live) nest.musterT = nest === closest ? 24 : Math.max(nest.musterT, 38 + nest.id * 3);
    }
    this.flowDirty = true;
    this.emit({ type: 'founded', site: siteIdx, x: site.x, z: site.z });
    const founder = this.heroes[p];
    const plan = hqPlot && hqPlot.plan;
    const where = site.name ? ` at ${site.name}` : '';
    const shape = plan ? ` The plan is a ${plan.label}: ${plan.blurb}` : '';
    this.msg(`🏰 ${founder ? founder.def.name : 'The company'} founds the city${where}!${shape} Choose your opening: Economy, Defense, or Army.`, 'info');
  }

  firstSiegePlotVisible(plot) {
    if (!this.firstSiege || this.firstSiege.stage !== 'opening' || plot.tier > 0) return true;
    return FIRST_SIEGE_KINDS.has(plot.kind);
  }

  firstSiegePlotActionable(plot) {
    if (!this.firstSiege || this.firstSiege.stage !== 'opening') return true;
    return plot.tier === 0 && FIRST_SIEGE_KINDS.has(plot.kind);
  }

  firstSiegeStatus() {
    if (!this.firstSiege) return null;
    if (this.firstSiege.stage === 'opening') return {
      title: 'CHOOSE YOUR OPENING',
      detail: 'Economy: Cottage or Field · Defense: Tower · Army: Militia Camp',
    };
    if (this.firstSiege.stage === 'warning') {
      const nest = this.nests[this.firstSiege.nestId];
      return {
        title: `FIRST SIEGE · ${Math.max(0, Math.ceil(nest?.musterT || 0))}s`,
        detail: 'The marked hive is mustering walkers for your city. Prepare the nearest gate.',
        nest,
      };
    }
    if (this.firstSiege.stage === 'defend') return {
      title: `DEFEND THE CITY · ${this.firstSiege.waveIds.length} remain`,
      detail: 'Break the marked wave. Your army fights automatically.',
    };
    return null;
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
      if (this.plots.some((pl) => pl.nodeId === node.id)) continue;
      this._buildNodeWorks(node);
    }
  }

  // Ground you take is ground you can fortify. The flag is the single anchor:
  // one Forward Camp grows into a fenced, twin-towered frontier fort.
  _buildNodeWorks(node) {
    const x = (node.x | 0) - 1;
    const z = (node.z | 0) - 1;
    this.plots.push({
      id: OUTPOST_PLOT_BASE + node.id, kind: 'outpost', nodeId: node.id,
      x, z, size: 2, cx: node.x, cz: node.z,
      tier: 0, paid: 0, branch: null, ruined: false,
    });
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
      // Sites are creep-free staging ground — except in the labyrinth, where
      // only the start sanctuary is safe and the other flats are just rooms.
      if (this.mode === 'labyrinth') {
        const cp = this.checkpoint;
        if (cp && Math.hypot(x - cp.x, z - cp.z) < 18) continue;
      } else if (this.map.sites.some((s) => Math.hypot(x - s.x, z - s.z) < 26)) continue;
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
  // Anything raised on a lane node — camp, tower or palisade — only exists on
  // ground you actually hold.
  plotLocked(plot) {
    if (plot.nodeId == null) return false;
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
    // A barrier is paid for at its gate — or, on a stretch of wall the ground
    // left with no gate, at the middle of the stretch.
    if (plot.kind === 'wall') {
      const [ax, az] = plot.anchor || plot.gate;
      return [ax + 0.5, az + 0.5];
    }
    // The capture boundary is the outpost's interaction area. Once the node is
    // owned, the player can build, upgrade, repair, or rebuild its fort from
    // anywhere inside the circle instead of hunting for a tiny pay plate.
    if (plot.kind === 'outpost' && h) {
      const node = this.nodes[plot.nodeId];
      if (node && dist2(h.x, h.z, node.x, node.z) <= SIEGE.captureRadius * SIEGE.captureRadius) {
        return [h.x, h.z];
      }
    }
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
      if (!this.firstSiegePlotActionable(plot)) continue;
      const act = this.plotAction(plot);
      if (!act || act.mode === 'branch') continue;
      const [px, pz] = this.payPoint(plot, h);
      const node = plot.kind === 'outpost' ? this.nodes[plot.nodeId] : null;
      const inOutpost = node
        && dist2(h.x, h.z, node.x, node.z) <= SIEGE.captureRadius * SIEGE.captureRadius;
      const d = inOutpost ? 0 : dist2(h.x, h.z, px, pz);
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
      const rate = act.mode === 'build' && plot.tier > 0 ? UPGRADE_PAY_RATE : PAY_RATE;
      const pay = Math.min(rate * dt, this.gold, need);
      if (pay <= 0) continue;
      this.gold -= pay;
      this.stats.spent += pay;
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
    this.stats.spent = Math.max(0, this.stats.spent - amount);
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
      const arch = new Set((plot.arch || (plot.gate ? [plot.gate] : [])).map(([x, z]) => x + ',' + z));
      for (const [x, z] of plot.tiles) {
        if (this.occ[z * this.map.size + x] === 0) {
          this._addBuilding(plot, x, z, def, arch.has(x + ',' + z));
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
    const nextTier = plot.tier + 1;
    const def = this.tierDef(plot, nextTier);
    if (!def) return false;
    plot.tier = nextTier;
    if (!free) {
      // This counts completed construction purchases. A tier upgrade is a
      // purchase of that plot kind; free setup and discounted rebuilds are not.
      this.stats.built++;
      this.stats.builtByKind[plot.kind] = (this.stats.builtByKind[plot.kind] || 0) + 1;
    }

    if (plot.kind === 'wall') {
      // One building per rampart tile; the gate ARCH (every wall tile the
      // plan opened beside the gate tile — a ring traced over stairs and
      // diagonals is thicker than one tile there) lets friendlies through.
      const arch = new Set((plot.arch || (plot.gate ? [plot.gate] : [])).map(([x, z]) => x + ',' + z));
      // One building per rampart tile; the gate tile lets friendlies through.
      if (plot.tier === 1) {
        for (const [x, z] of plot.tiles) {
          this._addBuilding(plot, x, z, def, arch.has(x + ',' + z));
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
      if (this.firstSiege?.stage === 'opening' && plot.tier === 1 && FIRST_SIEGE_KINDS.has(plot.kind)) {
        this.firstSiege.stage = 'warning';
        this.msg('⚠️ Opening chosen. The first hive is marked — watch its countdown and prepare the gate.', 'warn');
      }
    }
    return true;
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
    const N = this.map.size;
    // Eject anyone standing on the fresh foundation — you pay standing ON the
    // plot, so the new walls must not entomb you.
    for (const u of this.units) {
      const ux = u.x | 0, uz = u.z | 0;
      if (ux >= x && ux < x + size && uz >= z && uz < z + size) {
        this._ejectActor(u, x + (size >> 1), z + (size >> 1));
      }
    }
    // This building can also seal someone in from the OUTSIDE: they never set
    // foot on the new foundation, so the loop above never sees them, but the
    // last open gap in whatever room/nook they were standing in just became
    // a wall. Flood-fill their reachable ground (capped, so this stays cheap)
    // — anyone whose whole reachable area is a small sealed pocket, not the
    // open map, gets moved to the nearest tile that is NOT part of that
    // pocket, i.e. just outside whatever just sealed them in.
    const bx = x + (size >> 1), bz = z + (size >> 1);
    for (const u of this.units) {
      const ux = u.x | 0, uz = u.z | 0;
      if (ux >= x && ux < x + size && uz >= z && uz < z + size) continue; // already handled above
      if (Math.max(Math.abs(ux - bx), Math.abs(uz - bz)) > size + 12) continue; // too far to be affected
      if (this.occ[uz * N + ux] > 0) continue; // not on solid ground themselves
      const pocket = this._reachablePocket(ux, uz, POCKET_CAP);
      if (pocket.size >= POCKET_CAP) continue; // plenty of open ground reachable — not sealed
      this._ejectActor(u, ux, uz, pocket);
    }
    this.flowDirty = true;
    return b;
  }

  // Flood-fill the walkable, unoccupied (or gate) ground reachable from
  // (sx, sz), 4-directionally, stopping once `cap` tiles have been visited.
  // If the returned set is smaller than `cap`, that IS the actor's entire
  // reachable area — a sealed pocket, not a sample of the open map.
  _reachablePocket(sx, sz, cap) {
    const N = this.map.size;
    const visited = new Set([sz * N + sx]);
    const queue = [[sx, sz]];
    for (let qi = 0; qi < queue.length && visited.size < cap; qi++) {
      const [x, z] = queue[qi];
      for (const [dx, dz] of DIR4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const idx = nz * N + nx;
        if (visited.has(idx) || !this.map.isWalkable(nx, nz)) continue;
        const occId = this.occ[idx];
        if (occId !== 0 && !this.gateIds.has(occId)) continue;
        visited.add(idx);
        queue.push([nx, nz]);
        if (visited.size >= cap) break;
      }
    }
    return visited;
  }

  // Ring-search out from (cx, cz) for the nearest walkable, unoccupied tile
  // and drop the actor there. Used both for someone caught standing ON a
  // fresh foundation and for someone a fresh foundation just sealed in from
  // the outside — the caller picks the search origin accordingly. `pocket`,
  // when given, is the actor's known sealed-off reachable set: candidates
  // inside it are skipped, since hopping there would just be the same trap.
  _ejectActor(u, cx, cz, pocket = null) {
    const N = this.map.size;
    for (let r = 1; r < 24; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 1 || nz < 1 || nx >= N - 1 || nz >= N - 1) continue;
          const idx = nz * N + nx;
          if (pocket && pocket.has(idx)) continue;
          const occId = this.occ[idx];
          if (this.map.isWalkable(nx, nz) && (occId === 0 || this.gateIds.has(occId))) {
            u.x = nx + 0.5; u.z = nz + 0.5;
            return;
          }
        }
      }
    }
  }

  _safeTile(x, z) {
    const id = this.occ[(z | 0) * this.map.size + (x | 0)];
    return this.map.isWalkable(x | 0, z | 0) && (id === 0 || id === undefined || this.gateIds.has(id));
  }

  // Does the straight line from (x0,z0) to (x1,z1) cross a friendly wall or
  // building? Fixed sample stride, capped length — deterministic, cheap, and
  // only ever a hint: it decides whether a squad should take the gate, never
  // where it steps. Gates do not count as walls (they are the way through).
  _wallBetween(x0, z0, x1, z1) {
    const N = this.map.size;
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.min(80, Math.ceil(d * 2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const idx = ((z0 + (z1 - z0) * t) | 0) * N + ((x0 + (x1 - x0) * t) | 0);
      const id = this.occ[idx];
      if (id !== 0 && !this.gateIds.has(id)) return true;
    }
    return false;
  }

  // Gate discipline with hysteresis: a squad standing IN the arch retriggers
  // the wall test the moment it clears the exit (the line from the gate to
  // the next objective often clips a wall tangent) and vibrates on the
  // threshold. After a completed exit the squad is immune for a couple of
  // seconds — long enough to walk through the door and let normal routing
  // take over from the other side.
  _wantsGate(actor, tx, tz) {
    if ((actor.gateCool || 0) > 0) return false;
    return this._wallBetween(actor.x, actor.z, tx, tz);
  }

  // A squad mid-descent can wedge into a concave building corner: every
  // strictly-lower neighbour is diagonal and its flanking tiles are stone,
  // so dirAt has nothing legal to offer. Shove it onto the nearest tile that
  // is strictly closer to a gate — fixed ring order, deterministic, and at
  // most three tiles (the same charity _ejectActor already extends).
  _exitUnstick(x, z) {
    const here = this.exitField.distAt(x, z);
    for (let r = 1; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= this.map.size || nz >= this.map.size) continue;
          const id = this.occ[nz * this.map.size + nx];
          if (id !== 0 && !this.gateIds.has(id)) continue;
          if (!this.map.isWalkable(nx, nz)) continue;
          if (this.exitField.distAt(nx, nz) < here) return [nx, nz];
        }
      }
    }
    return null;
  }

  // Deterministic nearest-safe-tile scan: expanding square rings, the
  // _ejectActor pattern generalized. Validates positions coming back from
  // old saves and guarantees stance fallbacks never land inside a footprint
  // or on unwalkable terrain. Returns null if nothing safe within maxR.
  _reseat(x, z, maxR = 12) {
    if (this._safeTile(x, z)) return [x, z];
    const N = this.map.size;
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = (x | 0) + dx + 0.5, nz = (z | 0) + dz + 0.5;
          if (nx < 1 || nz < 1 || nx >= N - 1 || nz >= N - 1) continue;
          if (this._safeTile(nx, nz)) return [nx, nz];
        }
      }
    }
    return null;
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
    if (this._supportT > 1e-9) return;
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
    // A living producer is an uncapped faucet. It musters its full squad on
    // every cycle until the building is destroyed or the plot is ruined.
    const squadId = `${plot.id}:${plot.musterSeq || 0}`;
    plot.musterSeq = (plot.musterSeq || 0) + 1;
    for (let i = 0; i < def.count; i++) {
      const a = (i / Math.max(1, def.count)) * Math.PI * 2;
      const u = this._spawnUnit(kindDef.unit, plot.cx + Math.cos(a) * 1.6, plot.cz + 1.4 + Math.sin(a) * 0.8, plot.id);
      u.homeNodeId = plot.nodeId != null ? plot.nodeId : null;
      u.squadId = squadId;
      u.squadIndex = i;
      u.squadSize = def.count;
    }
    if (this.stance === 'defend') this._anchorDefense();
    this.emit({ type: 'muster', x: plot.cx, z: plot.cz, n: def.count, kind: plot.kind });
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
      this.stats.lostByKind[b.kind] = (this.stats.lostByKind[b.kind] || 0) + 1;
      this.emit({ type: 'bdestroyed', x: b.cx, z: b.cz });
      if (b.kind === 'hq') { this.defeatCause = 'keep_destroyed'; this._gameOver(false); return; }
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
    if (this.mode === 'labyrinth') this._updateLabyrinthEncounters(dt);
    if (this.mode === 'labyrinth' && !this.finalStand) this._updatePursuit(dt);

    // Campaign: raze every hive and the survivors call one last counterattack.
    if (!this.finalStand && this.nests.length && !this.liveNests()) {
      this.finalStand = true;
      if (this.mode === 'labyrinth') {
        // No Keep to hold. The champion rises from the deepest razed chamber
        // with its last brood — kill it and the trial is cleared.
        const last = this._deepestChamber();
        this.msg('👑 Every chamber lies silent — and the labyrinth\'s champion rises from the deepest one. Kill it and walk out.', 'bad');
        this._spawnBoss(last ? last.id : null);
        if (last && last.id != null) {
          const w = hiveSquad(this.threat, this.diff.mult * this.level.mult * this.economy.pressure);
          this._spawnHorde(Math.round(18 * this.diff.mult * this.level.mult), [last.id], w.types);
        }
      } else {
        this.msg('🔥 Every hive lies in ashes — but something enormous is already walking. Hold the Keep!', 'bad');
        this._spawnBoss(null);
        this._edgeAssault(Math.round(48 * this.diff.mult * this.level.mult));
      }
    }
  }

  _updateLabyrinthEncounters(dt) {
    const layout = this.map.labyrinthLayout;
    if (!layout) return;
    for (const def of layout.encounters || []) {
      const state = this.labyrinthEncounters.find((e) => e.key === def.key);
      const room = layout.rooms[def.room];
      const nest = this.nests[def.nest];
      if (!state || !room || !nest || state.status === 'sealed' || state.status === 'cleared') continue;
      if (def.choice && this.labyrinthChoices[def.choice] && this.labyrinthChoices[def.choice] !== def.key) {
        state.status = 'sealed';
        nest.offMap = true; nest.alive = false; nest.hp = 0;
        continue;
      }
      const entered = this.heroes.some((h) => !h.dead && dist2(h.x, h.z, room.x, room.z) < 100);
      if (state.status === 'waiting' && entered) {
        if (def.choice && !this.labyrinthChoices[def.choice]) {
          this.labyrinthChoices[def.choice] = def.key;
          for (const other of layout.encounters) {
            if (other.choice !== def.choice || other.key === def.key) continue;
            const otherState = this.labyrinthEncounters.find((e) => e.key === other.key);
            const otherNest = this.nests[other.nest];
            if (otherState) otherState.status = 'sealed';
            if (otherNest) { otherNest.offMap = true; otherNest.alive = false; otherNest.hp = 0; }
            this._setLabyrinthDoors(other, true);
          }
          this.msg(`🚪 ${room.label} chosen. The other route seals behind stone.`, 'info');
        }
        state.status = 'active';
        this._setLabyrinthDoors(def, true);
        state.waveT = 0;
        this.emit({ type: 'roomstart', key: def.key, x: room.x, z: room.z });
        this.msg(`⚔️ ${room.label} — ${this._labyrinthObjective(def.kind)}`, 'bad');
      }
      if (state.status !== 'active') continue;
      if (!nest.alive) {
        state.status = 'cleared';
        this._setLabyrinthDoors(def, false);
        this.emit({ type: 'roomclear', key: def.key, x: room.x, z: room.z });
        this.msg(`✨ ${room.label} is clear. Choose your blessing, then move.`, 'info');
        continue;
      }
      state.waveT -= dt;
      if (state.wave < def.waves && state.waveT <= 0) {
        state.wave++;
        state.waveT = def.kind === 'holdout' ? 9 : 13;
        this._spawnLabyrinthRoomWave(room, def.kind, state.wave);
      }
    }
  }

  _setLabyrinthDoors(def, closed) {
    const rooms = this.map.labyrinthLayout?.rooms;
    const room = rooms?.[def.room];
    if (!room) return;
    for (const fromIndex of def.from || []) {
      const from = rooms[fromIndex];
      if (!from) continue;
      const dx = from.x - room.x, dz = from.z - room.z;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d, px = -uz, pz = ux;
      const cx = room.x + ux * 9, cz = room.z + uz * 9;
      for (let i = -4; i <= 4; i++) {
        const x = Math.round(cx + px * i), z = Math.round(cz + pz * i);
        if (!this.map.inBounds(x, z) || !this.map.isWalkable(x, z)) continue;
        const at = z * this.map.size + x;
        if (closed && this.occ[at] === 0) this.occ[at] = LABYRINTH_DOOR_ID;
        else if (!closed && this.occ[at] === LABYRINTH_DOOR_ID) this.occ[at] = 0;
      }
    }
    this.flowDirty = true;
  }

  _restoreLabyrinthDoors() {
    if (this.mode !== 'labyrinth') return;
    for (const def of this.map.labyrinthLayout?.encounters || []) {
      const state = this.labyrinthEncounters.find((e) => e.key === def.key);
      if (state?.status === 'sealed') {
        const nest = this.nests[def.nest];
        if (nest) nest.offMap = true;
      }
      if (state?.status === 'active' || state?.status === 'sealed') this._setLabyrinthDoors(def, true);
    }
  }

  _labyrinthObjective(kind) {
    return ({
      bridge: 'hold the bridge and break the brood heart.',
      seals: 'survive the rotunda ambush and shatter its heart.',
      ambush: 'crypts are opening on every side.',
      causeway: 'stay on the causeways; the cells are flooding.',
      crypts: 'side crypts open behind the team. Keep the corridor clear.',
      holdout: 'survive four waves while Crown Gate unlocks.',
    })[kind] || 'clear the chamber.';
  }

  _spawnLabyrinthRoomWave(room, kind, wave) {
    const base = kind === 'holdout' ? 5 + wave * 2 : 4 + wave * 2;
    const count = Math.round(base * this.diff.mult * Math.min(1.35, this.level.mult));
    const types = kind === 'bridge' ? ['walker', 'runner']
      : kind === 'causeway' ? ['runner', 'spitter']
        : kind === 'crypts' ? ['walker', 'brute']
          : kind === 'holdout' ? ['walker', 'runner', 'brute']
            : ['walker', 'runner', 'spitter'];
    let spawned = 0, guard = 0;
    while (spawned < count && guard++ < count * 20) {
      const a = this.rng() * Math.PI * 2, r = 5 + this.rng() * 4;
      const x = room.x + Math.cos(a) * r, z = room.z + Math.sin(a) * r;
      if (!this.map.isWalkable(x | 0, z | 0)) continue;
      if (this._spawnZombie(types[(this.rng() * types.length) | 0], x, z, true, true)) spawned++;
    }
    this.emit({ type: 'roomwave', x: room.x, z: room.z, wave });
  }

  // The rear horde always enters through the authored starting sanctuary.
  // It escalates from scouts to a sustained flood, but never spawns ahead of
  // the party or replaces the final-boss objective.
  _updatePursuit(dt) {
    const roomFight = this.labyrinthEncounters.some((e) => e.status === 'active');
    const choosing = this.blessingOffers.some((o) => o && o.length);
    if (roomFight || choosing) return;
    this.pursuitTime += dt;
    const stage = this.pursuitTime < 120 ? 0 : this.pursuitTime < 240 ? 1
      : this.pursuitTime < 360 ? 2 : 3;
    if (stage !== this.pursuitStage) {
      this.pursuitStage = stage;
      this.emit({ type: 'pursuit', stage });
      this.msg(stage === 1 ? '⚠️ Something is following from the Last Lantern.'
        : stage === 2 ? '☠️ The dead are pouring into the passages behind you.'
          : '🚨 THE FLOOD HAS BEGUN. Reach the Sunless Throne.', 'bad');
    }
    this.pursuitSpawnT -= dt;
    if (stage === 0 || this.pursuitSpawnT > 0) return;
    const start = this.map.labyrinthLayout?.start || this._labyrinthStart();
    const living = this.heroes.filter((h) => !h.dead);
    if (living.some((h) => dist2(h.x, h.z, start.x, start.z) < 196)) {
      this.pursuitSpawnT = 4;
      return;
    }
    const sizes = [0, 4, 8, 14];
    const intervals = [120, 20, 11, 5];
    const types = stage === 1 ? ['walker'] : stage === 2
      ? ['walker', 'walker', 'runner'] : ['walker', 'runner', 'brute'];
    let spawned = 0, guard = 0;
    const target = Math.round(sizes[stage] * this.diff.mult);
    while (spawned < target && guard++ < target * 20) {
      const a = this.rng() * Math.PI * 2, r = 1 + this.rng() * 5;
      const x = start.x + Math.cos(a) * r, z = start.z + Math.sin(a) * r;
      if (!this.map.isWalkable(x | 0, z | 0)) continue;
      const type = types[(this.rng() * types.length) | 0];
      if (this._spawnZombie(type, x, z, true, true)) spawned++;
    }
    this.pursuitSpawnT = intervals[stage];
    this.flowDirty = true;
  }

  // The chamber farthest from the current checkpoint — the bottom of the run.
  _deepestChamber() {
    const throne = this.map.labyrinthLayout?.boss;
    if (throne) return { id: null, x: throne.x + 0.5, z: throne.z + 0.5 };
    const from = this.checkpoint || { x: this.map.size / 2, z: this.map.size / 2 };
    let best = null, bd = -1;
    for (const n of this.nests) {
      if (n.offMap) continue;
      const d = dist2(n.x, n.z, from.x, from.z);
      if (d > bd) { bd = d; best = n; }
    }
    return best;
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
    // The first decision is safe. The countdown starts only after the player
    // commits to Economy, Defense, or Army; no unseen wave can invalidate it.
    if (this.firstSiege?.stage === 'opening') return;
    for (const n of this.nests) {
      if (!n.alive) continue;
      n.musterT -= dt;
      if (n.musterT <= 0) {
        n.musterT = hiveInterval(this.threat);
        const first = this.firstSiege?.stage === 'warning' && n.id === this.firstSiege.nestId;
        this._hiveMuster(n, 1, first);
      }
    }
    if (this.firstSiege?.stage === 'defend') {
      this.firstSiege.waveIds = this.firstSiege.waveIds.filter((id) => this.zombies.some((z) => z.id === id && !z.dead));
      if (!this.firstSiege.waveIds.length) {
        this.gold += this.firstSiege.reward;
        this.stats.coins += this.firstSiege.reward;
        this.firstSiege.stage = 'complete';
        this.msg(`🏆 FIRST SIEGE BROKEN · +${this.firstSiege.reward} gold. The full city plan is revealed — build your war.`, 'good');
        this.emit({ type: 'firstsiege', x: this.hq?.cx || 0, z: this.hq?.cz || 0, reward: this.firstSiege.reward });
      }
    }
  }

  _hiveMuster(nest, mult, firstSiege = false) {
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
        const zombie = this._spawnZombie(this._pickHiveType(w.types), x, z, true, true);
        if (zombie) { spawned++; if (firstSiege) this.firstSiege.waveIds.push(zombie.id); }
      }
    }
    const before = new Set(this.zombies.map((z) => z.id));
    spawned += this._spawnHorde(Math.max(0, fromNest), [nest.id], w.types);
    if (firstSiege) {
      for (const zombie of this.zombies) if (!before.has(zombie.id)) this.firstSiege.waveIds.push(zombie.id);
      this.firstSiege.stage = 'defend';
      this.msg(`⚔️ FIRST SIEGE · ${this.firstSiege.waveIds.length} enemies marching on the city. Hold the gate!`, 'bad');
    }
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
      // Losing a node also ruins the whole fort you built on it.
      for (const plot of this.plots.filter((p) => p.nodeId === node.id && p.tier > 0)) {
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
    // Only player squads take the gate discipline — raider zombies route by
    // the same lanes but keep their wall-chewing flow field for exits.
    const friendly = !actor.hero && this.units.includes(actor);
    // Close enough to see it? Go straight there. Lanes exist to cross terrain,
    // and forcing a short hop back out through a lane node is how squads used
    // to circle an objective they were already standing next to.
    const [gx, gz] = this._giPoint(gi);
    if (dist2(actor.x, actor.z, gx, gz) < DIRECT_APPROACH_R * DIRECT_APPROACH_R) {
      actor.route = null;
      // The direct approach has no watchdog at all — if stone stands between
      // the squad and the objective, take the gate before the grinding starts.
      if (friendly && this._wantsGate(actor, gx, gz)) actor.gateExit = true;
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
    // A route whose destination lies across stone is the stuck-loop from the
    // QA logs: the lanes ignore buildings, the repath is identical every
    // time, and rank churn hands the squad a fresh route before the watchdog
    // can even time out. This also catches the subtler trap — a lane node
    // INSIDE the compound keeps the first leg wall-free, so the squad ferries
    // between the node and the rampart forever. Hand it to the gate-exit
    // descent instead.
    if (friendly && (this._wantsGate(actor, tx, tz)
      || this._wantsGate(actor, pts[start][0], pts[start][1]))) {
      actor.route = null;
      actor.gateExit = true;
      return false;
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
    let dx = wx - actor.x, dz = wz - actor.z;
    if (!zombie && !actor.hero) {
      const prev = actor.routeI > 0 ? actor.route[actor.routeI - 1] : [actor.x, actor.z];
      const [ox, oz] = this._formationOffset(actor, wx - prev[0], wz - prev[1]);
      dx = wx + ox - actor.x;
      dz = wz + oz - actor.z;
    }
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
        // A friendly squad that ground to a halt with a wall across its line
        // is inside its own rampart (or a forward fort's). Repathing produces
        // the identical terrain-only lane route, so the loop never ends — walk
        // it out the gate first (QA 2026-08-17: squads stuck in every base).
        if (!zombie && !actor.hero && this._wantsGate(actor, wx, wz)) {
          actor.gateExit = true;
        }
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

  // ---------- field loot ----------

  // What the frontier is hiding. Barrows have something under them, a hive
  // hoards what it took off the people it ate, and a pass is where travellers
  // die with their packs still on. Seeded, so lockstep peers agree.
  _scatterLoot() {
    // Two kinds of thing lie on the frontier now. The authored field finds are
    // still here — they are the recognisable ones — and alongside them the
    // world rolls its own gear at a level set by the world itself.
    //
    // The roll seed comes from the map seed, the level, and a per-game serial.
    // All three are identical on every peer, so every peer scatters the same
    // items. The serial is deliberately NOT the global entity id, which can
    // differ between peers that have played a different number of games.
    const ilvl = worldItemLevel(this.levelId, this.level, this.diff);
    const pick = (rare) => {
      if (this.rng() < (rare ? 0.75 : 0.55)) {
        const rarity = rare ? (this.rng() < 0.35 ? 3 : 2) : (this.rng() < 0.2 ? 2 : 1);
        const key = rollLootKey(
          `${this.map.seed}:${this.levelId}:${this._lootSerial++}`,
          ilvl, rarity, this.rng(),
        );
        if (key) return key;
      }
      const pool = rare ? FIELD_LOOT.rare : FIELD_LOOT.common;
      return pool[Math.floor(this.rng() * pool.length)];
    };
    const place = (x, z, key, hidden = true) => {
      const spot = this._lootSpot(x, z);
      if (!spot) return;
      this.loot.push({ id: nextId++, key, x: spot[0], z: spot[1], hidden, cool: 0 });
    };
    // Under the barrows, and in the deep places the map named.
    for (const node of this.nodes) {
      if (node.offMap) continue;
      if (node.kind === 'barrow') place(node.x, node.z, pick(this.rng() < 0.55));
      else if (node.kind === 'clearing' || node.kind === 'quarry') {
        if (this.rng() < 0.6) place(node.x, node.z, pick(this.rng() < 0.12));
      } else if (this.rng() < 0.35) place(node.x, node.z, pick(false));
    }
    // Every hive sits on a hoard.
    for (const nest of this.nests) {
      if (nest.offMap) continue;
      place(nest.x, nest.z, pick(this.rng() < 0.45));
    }
    // And somebody always dies in the pass.
    for (const c of (this.map.chokeSpots || []).slice(0, 8)) {
      if (this.rng() < 0.6) place(c.x, c.z, pick(this.rng() < 0.2));
    }
    // Plus a few packs out in the open country, for players who ride wide.
    const N = this.map.size;
    for (let i = 0, guard = 0; i < 4 && guard < 200; guard++) {
      const x = 6 + this.rng() * (N - 12), z = 6 + this.rng() * (N - 12);
      if (this.map.sites.some((s) => Math.hypot(x - s.x, z - s.z) < 26)) continue;
      if (!this.map.isWalkable(x | 0, z | 0)) continue;
      place(x, z, pick(this.rng() < 0.15));
      i++;
    }
  }

  // Loot has to lie on ground a hero can actually stand on, and not inside a
  // building footprint.
  _lootSpot(x, z) {
    for (let r = 0; r < 7; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = Math.round(x + dx), nz = Math.round(z + dz);
          if (!this.map.isWalkable(nx, nz)) continue;
          if (this.occ[nz * this.map.size + nx] > 0) continue;
          if (this.loot.some((l) => Math.abs(l.x - nx) < 2 && Math.abs(l.z - nz) < 2)) continue;
          return [nx + 0.5, nz + 0.5];
        }
      }
    }
    return null;
  }

  // Drop an item on the ground where something died — the only loot the player
  // sees coming.
  dropLoot(x, z, key) {
    const spot = this._lootSpot(x, z);
    if (!spot) return;
    const l = { id: nextId++, key, x: spot[0], z: spot[1], hidden: false, cool: LOOT_DROP_COOLDOWN };
    this.loot.push(l);
    this.emit({ type: 'lootdrop', x: l.x, z: l.z, key, id: l.id });
  }

  // Walk over it and it is yours. A full pack is the only thing that stops you,
  // and then the game tells you which key empties a slot.
  _updateLoot(dt) {
    if (!this.loot.length) return;
    let taken = false;
    for (const l of this.loot) {
      if (l.cool > 0) l.cool -= dt;
      for (const h of this.heroes) {
        if (h.dead) continue;
        const d2 = dist2(h.x, h.z, l.x, l.z);
        if (l.hidden) {
          if (d2 > LOOT_REVEAL_RADIUS * LOOT_REVEAL_RADIUS) continue;
          l.hidden = false;
          const it = itemInfo(l.key);
          this.msg(`${it ? it.icon : '📦'} You spot something half-buried — ${it ? it.name : 'a cache'}.`, 'info');
          this.emit({ type: 'lootseen', x: l.x, z: l.z, key: l.key, id: l.id });
          continue;
        }
        if (l.cool > 0) continue;
        if (d2 > LOOT_PICKUP_RADIUS * LOOT_PICKUP_RADIUS) continue;
        if ((h.pack || []).length >= PACK_SLOTS) {
          if (this.time - (h._packFullT || -99) > 6) {
            h._packFullT = this.time;
            this.msg(`🎒 Your pack is full — press G to drop something.`, 'bad');
          }
          continue;
        }
        this.giveItem(h, l.key);
        l.gone = true;
        taken = true;
        break;
      }
    }
    if (taken) this.loot = this.loot.filter((l) => !l.gone);
  }

  // Into the pack, and into the hero's stats immediately — a find you cannot
  // feel until the next level is not a find.
  giveItem(h, key) {
    // Authored or rolled — both arrive here, and both must be takeable.
    const it = itemInfo(key);
    if (!it) return false;
    h.pack = h.pack || [];
    if (h.pack.length >= PACK_SLOTS) return false;
    h.pack.push(key);
    this._refreshPackMods(h);
    const blurb = it.desc || itemLines(it).join(', ') || it.rarityName;
    this.msg(`${it.icon} ${h.def.name} takes the ${it.name} — ${blurb}`, 'good');
    this.emit({ type: 'loot', x: h.x, z: h.z, key });
    return true;
  }

  // Drop the newest thing in the pack. Lockstep-safe: the index comes over the
  // wire, and an out-of-range index is simply ignored.
  dropItem(p = 0, index = -1) {
    const h = this.heroes[p];
    if (!h || h.dead || !h.pack || !h.pack.length) return;
    const i = index >= 0 && index < h.pack.length ? index : h.pack.length - 1;
    const [key] = h.pack.splice(i, 1);
    this._refreshPackMods(h);
    this.dropLoot(h.x, h.z, key);
    const it = itemInfo(key);
    this.msg(`${it ? it.icon : '📦'} Dropped the ${it ? it.name : 'find'}.`, 'info');
  }

  // Throw yourself out of the way. A command like any other, so every peer
  // rolls on the same tick from the same direction.
  //
  // The direction is sent WITH the command rather than read from the hero's
  // current input, because a peer applying this command a window later may
  // have already seen a different direction arrive.
  dodgeRoll(p = 0, dx = null, dz = null) {
    const h = this.heroes[p];
    if (!h || h.dead) return;
    if (h.dodgeCd > 0 || h.dodgeT > 0) { this.emit({ type: 'deny' }); return; }
    // Roll where you are pointed. Standing still rolls the way you face, so
    // the button always does something.
    let x = Number(dx) || 0, z = Number(dz) || 0;
    if (!x && !z) { x = Math.sin(h.facing || 0); z = Math.cos(h.facing || 0); }
    const len = Math.hypot(x, z) || 1;
    h.dodgeX = x / len;
    h.dodgeZ = z / len;
    h.dodgeT = DODGE_TIME;
    h.dodgeIT = DODGE_IFRAMES;
    h.dodgeCd = DODGE_CD;
    h.facing = Math.atan2(h.dodgeX, h.dodgeZ);
    this.emit({ type: 'dodge', x: h.x, z: h.z, dx: h.dodgeX, dz: h.dodgeZ, heroKey: h.key });
  }

  // Draw the other weapon set. A command like any other, so it travels the
  // lockstep path and every peer swaps on the same tick.
  swapWeaponSet(p = 0) {
    const h = this.heroes[p];
    if (!h || h.dead) return;
    if (!hasSecondSet(h.equipment)) { this.emit({ type: 'deny' }); return; }
    if (h.swapCd > 0) { this.emit({ type: 'deny' }); return; }
    h.activeSet = h.activeSet === 1 ? 0 : 1;
    h.swapCd = WEAPON_SWAP_CD;
    // The sheathed set's global mods and its doctrines both go away with it, so
    // the whole bag is rebuilt and the rule flags are re-resolved.
    this._refreshPackMods(h);
    this._refreshDoctrines();
    const w = h.weapon;
    this.msg(`🔁 ${h.def.name} draws ${w && w.name ? w.name : 'the other weapon'}.`, 'info');
    this.emit({ type: 'swapset', x: h.x, z: h.z, set: h.activeSet, heroKey: h.key });
  }

  _refreshPackMods(h) {
    h.itemMods = itemMods([
      ...(h.items || []), ...(h.pack || []), ...(h.blessings || []),
      ...equippedKeys(h.equipment, h.activeSet || 0),
    ]);
    this._refreshHeroDerived(h);
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
      squadId: null, squadIndex: -1, squadSize: 0,
    };
    // Born during a DEFEND order: take a slot on the Keep ring, not a freeze
    // at the barracks door.
    if (this.stance === 'defend') {
      let n = 0;
      for (const o of this.units) if (!o.hero && !o.dead) n++;
      [u.holdX, u.holdZ] = this._defendSlot(u, n + 1, n);
    }
    this.units.push(u);
    return u;
  }

  // Army stance — one order for the whole army, no unit micro. DEFEND holds
  // the line AT THE KEEP (a deterministic ring — the toast has meant this
  // since the beginning), GUARD escorts the heroes, ATTACK walks the lanes.
  // Re-pressing DEFEND re-anchors the ring (guests spawn, walls go up, the
  // line should move) — the other stances stay no-ops on repeat presses.
  _defendSlot(u, n, i) {
    if (!this.hq || !this.hq.alive) return [u.x, u.z];
    const base = n ? (i / n) * Math.PI * 2 : 0;
    for (let k = 0; k < 12; k++) {
      const a = base + (k / 12) * Math.PI * 2;
      const x = this.hq.cx + Math.cos(a) * 5.5, z = this.hq.cz + Math.sin(a) * 5.5;
      const id = this.occ[(z | 0) * this.map.size + (x | 0)];
      if (this.map.isWalkable(x | 0, z | 0) && (id === 0 || id === undefined || this.gateIds.has(id))) return [x, z];
    }
    const seat = this._reseat(this.hq.cx, this.hq.cz);
    return seat || [u.x, u.z];
  }

  _anchorDefense() {
    const troops = this.units.filter((u) => !u.hero && !u.dead)
      .sort((a, b) => {
        const as = String(a.squadId || ''), bs = String(b.squadId || '');
        return (as < bs ? -1 : as > bs ? 1 : 0)
          || (a.squadIndex ?? 0) - (b.squadIndex ?? 0) || a.id - b.id;
      });
    for (let i = 0; i < troops.length; i++) {
      [troops[i].holdX, troops[i].holdZ] = this._defendSlot(troops[i], troops.length, i);
    }
  }

  // Human troops keep a compact marching order. Zombies deliberately never
  // call this helper: their silhouette remains an irregular flood.
  _formationOffset(u, dx = 0, dz = 1, spacing = 0.95) {
    if (u.hero || u.squadIndex == null || u.squadIndex < 0) return [0, 0];
    const n = Math.max(1, u.squadSize || 1);
    const cols = Math.min(3, n);
    const col = u.squadIndex % cols;
    const row = Math.floor(u.squadIndex / cols);
    const side = (col - (cols - 1) / 2) * spacing;
    const back = row * spacing;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len, fz = dz / len;
    return [-fz * side - fx * back, fx * side - fz * back];
  }

  setStance(st, p = 0) {
    if (!['defend', 'guard', 'attack'].includes(st)) return;
    const h = this.heroes[p];
    if (st === this.stance && st !== 'defend') return;
    this.stance = st;
    if (st === 'defend') this._anchorDefense();
    if (st !== 'attack') for (const u of this.units) if (!u.hero) { u.route = null; u.targetGi = -1; u.gateExit = false; }
    const who = h && h.def ? h.def.name.split(' ')[0] : null;
    this.msg(st === 'defend'
      ? `🛡️ ${who ? who + ' anchors the defense' : 'The army falls back'} — hold the line at the Keep.`
      : st === 'guard'
      ? `🚩 ${who ? who + ' forms the army around ' + h.def.name : 'The army forms up around the heroes'}.`
      : `⚔️ ${who ? who + ' pushes' : 'The army pushes'} the lanes — take the nodes, then the hives!`, 'info');
    this.emit({ type: st === 'defend' ? 'hold' : 'rally', x: h ? h.x : 0, z: h ? h.z : 0 });
  }

  // ---------- hero ----------

  // camp: the persistent campaign hero — { level, xp, items } (WC3-style).
  _spawnHero(key, x, z, camp = null) {
    const d = HEROES[key];
    const items = camp && camp.items ? [...camp.items] : [];
    // The pack is what this hero picked up in THIS run. It counts toward their
    // stats the moment it goes in, and it is the only gear that grows during a
    // survival run.
    const pack = camp && camp.pack ? [...camp.pack] : [];
    const equipmentIn = camp && camp.equipment ? { ...camp.equipment } : {};
    const setIn = camp && camp.activeSet === 1 ? 1 : 0;
    // Worn gear counts. Before this, equipment reached the hero only through
    // the weapon, so wearing armour was strictly worse than leaving it in the
    // stash — the stash was being summed and the body was not.
    const itemModsOnly = itemMods([...items, ...pack, ...equippedKeys(equipmentIn, setIn)]);
    // Socket components are already de-duplicated by instance at the authority
    // snapshot boundary. Fold that one bag in once; never re-read sockets here.
    for (const [mod, value] of Object.entries(camp?.socketMods || {})) itemModsOnly[mod] = (itemModsOnly[mod] || 0) + value;
    const upgrades = normalizeHeroUpgrades((camp && camp.upgrades) || {});
    const level = Math.min(HERO_MAX_LEVEL, (camp && camp.level) || 1);
    // What this hero is swinging. An empty equipment map resolves to the
    // hero's signature weapon, which carries that hero's original numbers —
    // so an unequipped hero fights exactly as they did before weapons existed.
    const equipment = equipmentIn;
    const weapon = weaponFor(key, equipment, setIn);
    // The Lattice arrives already resolved: a flat bag of numbers and a list of
    // rule flags, one payload per weapon set. Nothing here queries a tree node,
    // now or during the run.
    const treeMods = (camp && camp.treeMods) || null;
    const treeSets = (camp && camp.treeSets) || null;
    const activeSet = camp && camp.activeSet === 1 ? 1 : 0;
    const doctrines = latticeDoctrines(treeSets, activeSet, camp && camp.doctrines);
    const h = {
      id: nextId++, key, def: d, hero: true, x, z,
      hp: d.hp, maxHp: d.hp,
      mx: 0, mz: 0, sprint: false,
      cooldown: 0, target: null, facing: 0, retargetT: 0,
      level, xp: (camp && camp.xp) || 0, abilCd: 0,
      items, pack, blessings: [], itemMods: itemModsOnly, mods: { ...itemModsOnly }, upgrades,
      equipment, weapon, treeMods, doctrines, treeSets, activeSet, swapCd: 0,
      characterStyle: camp?.characterStyle ? structuredClone(camp.characterStyle) : null,
      dodgeT: 0, dodgeIT: 0, dodgeCd: 0, dodgeX: 0, dodgeZ: 0,
      reviveT: 0, hasteT: 0, hasteMult: 1, shieldHp: 0,
      fortifyT: 0, fortifyArmor: 0, fortifyThorns: 0, _summonId: null, _procT: {},
    };
    this._refreshHeroDerived(h, false);
    this.units.push(h);
    this.heroes.push(h);
    if (!this.hero) this.hero = h;
    this._refreshDoctrines();
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
    // The Lattice folds in here, beside gear and hero passives, on the same
    // additive keys. One bag, one place, one rule.
    // The drawn set decides which tree payload applies. A node pinned to set II
    // is simply not in set I's payload, so nothing here has to know about
    // pinning — including its doctrines, which follow the set with it.
    const treeBag = latticeMods(h.treeSets, h.activeSet || 0, h.treeMods);
    if (treeBag) {
      for (const [key, value] of Object.entries(treeBag)) {
        if (value) mods[key] = (mods[key] || 0) + value;
      }
    }
    h.doctrines = latticeDoctrines(h.treeSets, h.activeSet || 0, h.doctrines);
    const forge = this._heroForgeMods();
    mods.dmg = (mods.dmg || 0) + forge.dmg;
    mods.hp = (mods.hp || 0) + forge.hp;
    mods.cdr = (mods.cdr || 0) + forge.cdr;
    h.mods = mods;
    // Equipment can change between runs and, later, between weapon sets. The
    // resolved weapon is rebuilt here so every derived stat reads one source.
    h.weapon = weaponFor(h.key, h.equipment, h.activeSet || 0) || h.weapon;
    h.maxHp = h.def.hp + h.def.levelHp * heroGrowthUnits(h.level) + h.mods.hp;
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
    const w = h.weapon || h.def;
    return w.range + ((h.mods && h.mods.range) || 0);
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
      rate: (h.weapon || h.def).rof * (1 + ((h.mods && h.mods.rof) || 0)),
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
      case 'drop': this.dropItem(c.p || 0, c.i ?? -1); break;
      case 'swapset': this.swapWeaponSet(c.p || 0); break;
      case 'dodge': this.dodgeRoll(c.p || 0, c.x, c.z); break;
      case 'blessing': this.chooseBlessing(c.p || 0, c.i ?? -1); break;
    }
  }

  heroDmg(h) {
    // Base damage comes from the WEAPON. Growth per level stays on the hero,
    // because levelling the character is not levelling the gun.
    const w = h.weapon || h.def;
    return (w.dmg + h.def.levelDmg * heroGrowthUnits(h.level)) * (1 + h.mods.dmg);
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
          const hw = h.weapon || h.def;
          u.def = { ...UNITS.tiger_clone, hp, dmg: Math.round(baseDmg * mult * ultMult), range: hw.range, rof: hw.rof, speed: h.def.speed, color: h.def.color };
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
    this.emit({ type: 'cast', heroId: h.id, x: h.x, z: h.z, radius: ab.radius || 3, icon: ab.icon, key: ab.key });
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
  // any zombie standing in it. Brew state is snapshotted because reconnecting
  // players and mid-game spectators must continue the same simulation.
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
      if (h.fallen) return; // out of lives — this fall is final
      h.reviveT -= dt;
      if (h.reviveT <= 0) {
        h.dead = false;
        h.hp = h.maxHp;
        // Revive on guaranteed ground: first free ring tile around the Keep
        // or at the latest Labyrinth checkpoint. Never use an unchecked fixed
        // offset that can land inside crag, water, or a fresh wall.
        if (this.mode === 'labyrinth' && this.checkpoint) {
          const at = this._walkableNear(this.checkpoint.x, this.checkpoint.z);
          h.x = at.x; h.z = at.z;
        } else if (this.hq) {
          h.x = this.hq.cx; h.z = this.hq.cz; this._ejectActor(h, this.hq);
        } else {
          const [sx, sz] = this._frontierSpawnPoints(1)[0]; h.x = sx; h.z = sz;
        }
        this.units.push(h);
        this.emit({ type: 'revive', x: h.x, z: h.z });
        this.msg(`${h.def.icon} ${h.def.name} has returned to the fight!`, 'info');
      }
      return;
    }
    if (h.dodgeCd > 0) h.dodgeCd = Math.max(0, h.dodgeCd - dt);
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
    const baseSpeed = h.def.speed * (1 + 0.025 * (h.level - 1)) * (1 + h.mods.speed);
    // A roll owns the hero for its duration: it ignores the movement keys, so
    // the commitment is real and a peer cannot steer it differently mid-roll.
    if (h.dodgeT > 0) {
      h.dodgeT = Math.max(0, h.dodgeT - dt);
      h.dodgeIT = Math.max(0, (h.dodgeIT || 0) - dt);
      h.moving = this._moveActor(h, h.dodgeX || 0, h.dodgeZ || 0, baseSpeed * DODGE_SPEED, dt);
      h.facing = Math.atan2(h.dodgeX || 0, h.dodgeZ || 0);
      return;
    }
    if (h.mx !== 0 || h.mz !== 0) {
      const len = Math.hypot(h.mx, h.mz) || 1;
      // Thronefall gallop rule: sprint only at full health.
      const canSprint = h.sprint && h.hp >= h.maxHp - 0.5;
      const spd = baseSpeed * (canSprint ? 1.5 : 1)
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
    // The labyrinth's champion rises from a razed chamber; everywhere else a
    // dead nest cannot spawn and the boss walks in from the rim.
    const fromNest = nest && (nest.alive || this.mode === 'labyrinth');
    const throne = this.mode === 'labyrinth' ? this.map.labyrinthLayout?.boss : null;
    let [x, z] = throne ? [throne.x + 0.5, throne.z + 0.5]
      : fromNest ? [nest.x, nest.z] : this._edgeSpawnPoint();
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
  // Campaign and labyrinth runs fight their level's authored champion.
  nightBossDef() {
    if (this.mode !== 'survival') return this.level.boss;
    const idx = Math.max(0, (((this.threatLevel / 5) | 0) - 1) % LEVELS.length);
    const base = LEVELS[idx].boss;
    return { ...base, hp: Math.round(base.hp * (0.8 + this.threatLevel * 0.06)) };
  }

  _updateBoss(zb, dt) {
    const B = zb.cfg || this.level.boss;
    if (this.mode === 'labyrinth') {
      const ratio = zb.hp / Math.max(1, zb.maxHp);
      const phase = ratio <= 0.33 ? 3 : ratio <= 0.66 ? 2 : 1;
      if (phase > (zb.bossPhase || 0)) {
        zb.bossPhase = phase;
        if (phase > 1) {
          const room = this.map.labyrinthLayout?.boss || { x: zb.x, z: zb.z };
          this._spawnLabyrinthRoomWave(room, phase === 2 ? 'ambush' : 'holdout', phase + 1);
          this.msg(phase === 2
            ? `👑 ${B.name} breaks the outer seal — the throne wakes.`
            : `💀 ${B.name} enters its final phase. No retreat.`, 'bad');
          this.emit({ type: 'bossphase', x: zb.x, z: zb.z, phase });
        }
      }
    }
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

  // The nearest tile a hero can actually stand on — checkpoints sit in razed
  // chambers where the exact center may be blighted ground or a crag lip.
  _walkableNear(x, z) {
    for (let r = 0; r < 8; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const tx = (x | 0) + dx, tz = (z | 0) + dz;
          if (this.map.isWalkable(tx, tz) && this.occ[tz * this.map.size + tx] === 0) {
            return { x: tx + 0.5, z: tz + 0.5 };
          }
        }
      }
    }
    return { x, z };
  }

  _nearestHeroPoint(zb) {
    let best = null, bd = Infinity;
    for (const h of this.heroes) {
      if (h.dead) continue;
      const d = dist2(zb.x, zb.z, h.x, h.z);
      if (d < bd) { bd = d; best = h; }
    }
    return best ? { x: best.x, z: best.z } : null;
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

  // Does any hero in this game carry a doctrine? Doctrines are global rules
  // rather than per-hero stats, so in co-op one player's pact changes the war
  // for everybody. Resolved from the flags the camp carried in.
  hasDoctrine(id) {
    for (const h of this.heroes) {
      if (h.doctrines && h.doctrines.includes(id)) return true;
    }
    return false;
  }

  // Rule-bearing doctrines are read on every hit, so they are resolved to
  // plain booleans whenever the roster changes rather than searched each time.
  //
  // Called on spawn, on restore, and on every weapon-set swap.
  _refreshDoctrines() {
    this._doctrineScorched = this.hasDoctrine('scorched_supply');
    this._doctrineHollow = this.hasDoctrine('hollow_pact');
  }

  // Armour and per-type resistance, resolved together. Void is the exception
  // the type table promises: it ignores most armour, which is what makes a
  // psi-focus worth carrying into a plated horde.
  _resolveTypedDamage(zb, dmg, types, mods = null) {
    if (!types) {
      // The pre-types path, kept exact.
      return zb.armor ? dmg * (1 - zb.armor) : dmg;
    }
    const resist = zb.resist || (zb.def && zb.def.resist) || null;
    // Doctrine: Scorched Supply. Your fire renders everything, so a resistance
    // only counts for half. A vulnerability is not halved — this doctrine is a
    // promise about what you burn through, not a penalty on what burns easy.
    const resistScale = this._doctrineScorched ? 0.5 : 1;
    // Doctrine: Hollow Pact. Void ignores armour outright rather than mostly.
    const voidArmor = this._doctrineHollow ? 0 : VOID_ARMOR_SHARE;
    let total = 0;
    for (const type of DAMAGE_TYPES) {
      const share = types[type] || 0;
      if (!share) continue;
      let part = dmg * share;
      // Increased damage of one type, from gear and the Lattice. This is what
      // the Thermics and Abyss sectors and the elemental cores actually do —
      // without it two whole sectors were inert.
      const increased = mods ? (mods[type] || 0) : 0;
      if (increased) part *= 1 + increased;
      const armor = type === 'void' ? (zb.armor || 0) * voidArmor : (zb.armor || 0);
      if (armor) part *= 1 - armor;
      let r = resist ? (resist[type] || 0) : 0;
      if (r > 0) r *= resistScale;
      if (r) part *= 1 - Math.max(-1, Math.min(RESIST_CAP, r));
      total += part;
    }
    return total;
  }

  // `types` is a weapon's damage split — { thermal: 0.8, kinetic: 0.2 }. Pass
  // nothing and the hit is pure kinetic against no resistance, which is
  // exactly how every damage source behaved before types existed. That default
  // is why adding this axis moved no balance number.
  damageZombie(zb, dmg, sx, sz, types = null, mods = null) {
    if (zb.hp <= 0) return;
    dmg = this._resolveTypedDamage(zb, dmg, types, mods);
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
      if(this.livingWorldBattle&&zb.strategicStackId)this.livingWorldBattle.losses[zb.strategicStackId]=(this.livingWorldBattle.losses[zb.strategicStackId]||0)+1;
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
        // Campaign/labyrinth victory: the hives are ash and their champion is down.
        if (this.mode !== 'survival' && this.finalStand) { this._gameOver(true); return; }
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
      // Some of them are carrying something. A boss always is — which is what
      // keeps a survival run growing wave after wave.
      if (zb.boss) {
        this.dropLoot(zb.x, zb.z, FIELD_LOOT.rare[Math.floor(this.rng() * FIELD_LOOT.rare.length)]);
      } else if ((zb.type === 'brute' || zb.type === 'sieger') && this.rng() < 0.06) {
        this.dropLoot(zb.x, zb.z, FIELD_LOOT.common[Math.floor(this.rng() * FIELD_LOOT.common.length)]);
      }
    }
  }

  _damageBuilding(b, dmg, source = null) {
    if (!b.alive) return;
    b.hp -= dmg;
    const sourceKey = source?.type || source?.key || 'horde';
    this.stats.damageTaken[sourceKey] = (this.stats.damageTaken[sourceKey] || 0) + dmg;
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
    // Mid-roll, and inside the invulnerable window, nothing lands. The window
    // is shorter than the roll, so a late dodge still eats the hit.
    if (u.hero && u.dodgeT > 0 && (u.dodgeIT || 0) > 0) {
      this.emit({ type: 'evade', x: u.x, z: u.z });
      return;
    }
    const mods = u.mods || null;
    const evade = (u.def.evadeChance || 0) + ((mods && mods.evadeChance) || 0);
    if (dmg > 0 && evade > 0 && this.rng() < evade) {
      this.emit({ type: 'evade', x: u.x, z: u.z });
      return;
    }
    const armor = (u.def.armor || 0) + ((mods && mods.armor) || 0) + (u.fortifyArmor || 0) + (u.auraArmor || 0);
    // Negative armour has to bite. Gating on `armor > 0` silently discarded
    // every doctrine drawback that traded armour away, making them free.
    if (armor) dmg *= Math.max(0.25, Math.min(1.75, 1 - armor));
    if (u.shieldHp > 0 && dmg > 0) {
      const absorb = Math.min(u.shieldHp, dmg);
      u.shieldHp -= absorb;
      dmg -= absorb;
    }
    const thorns = (u.def.thorns || 0) + ((mods && mods.thorns) || 0) + (u.fortifyThorns || 0);
    if (thorns > 0 && dmg > 0 && attacker && !attacker.dead) {
      this.damageZombie(attacker, dmg * thorns, u.x, u.z);
    }
    if (dmg > 0) {
      const sourceKey = attacker?.type || attacker?.key || 'hive_blight';
      this.stats.damageTaken[sourceKey] = (this.stats.damageTaken[sourceKey] || 0) + dmg;
    }
    u.hp -= dmg;
    if (u.hp <= 0) {
      u.dead = true;
      if(this.livingWorldBattle&&u.strategicStackId)this.livingWorldBattle.losses[u.strategicStackId]=(this.livingWorldBattle.losses[u.strategicStackId]||0)+1;
      this.emit({ type: 'udeath', x: u.x, z: u.z });
      if (u.hero) {
        this.stats.heroDeaths++;
        this.emit({ type: 'herodown' });
        if (this.mode === 'living_world_battle') {
          u.fallen=true;
        } else if (this.mode === 'labyrinth') {
          // A fall spends a shared life. Out of lives, the fall is final —
          // and when the last hero is down, the labyrinth keeps them.
          if (this.lives > 0) {
            this.lives--;
            u.reviveT = 9;
            this.msg(`☠️ ${u.def.name} has fallen! Returning at the last checkpoint in ${Math.round(u.reviveT)}s — ${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left.`, 'bad');
          } else {
            u.fallen = true;
            this.msg(`☠️ ${u.def.name} has fallen, and there are no lives left.`, 'bad');
          }
          // The run ends only when nobody is coming back — a dead hero with a
          // revive pending is still in the fight.
          if (this.heroes.every((h) => h.dead && h.fallen)) {
            this.defeatCause = 'party_exhausted';
            this._gameOver(false);
          }
        } else {
          u.reviveT = 12 + 2.5 * u.level;
          this.msg(`☠️ ${u.def.name} has fallen! Reviving at the Keep in ${Math.round(u.reviveT)}s…`, 'bad');
        }
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
    this._armyPeakSampleAt = sampleArmyPeak(
      this.units, this.stats.armyPeak, this.time, this._armyPeakSampleAt,
    );
    this._updateSiege(dt);
    if (this.over) return;
    this._updatePlots(dt);
    this._updateCamps(dt);
    this._updateSupport(dt);
    this._updateCoins();
    this._updateLoot(dt);
    this._updateFlow(dt);
    this._unitBuckets = combatBuckets(this.units);
    this._zombieBuckets = combatBuckets(this.zombies);
    this._updateZombies(dt);
    this._zombieBuckets = combatBuckets(this.zombies);
    this._updateAuras(dt);
    this._updateBrews(dt);
    this._updateUnits(dt);
    this._updateTowers(dt);
    this._updateHero(dt);
    this._cleanup();
    if(this.mode==='living_world_battle'&&!this.over){
      if(!this.zombies.some((actor)=>!actor.dead))this._gameOver(true);
      else if(this.heroes.every((hero)=>hero.dead)&&!this.units.some((actor)=>!actor.hero&&!actor.dead))this._gameOver(false);
    }
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
        for (const u of nearbyBuckets(this._unitBuckets, this.units, h.x, h.z, radius)) {
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
        for (const zb of nearbyBuckets(this._zombieBuckets, this.zombies, h.x, h.z, radius)) {
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
        for (const zb of nearbyBuckets(this._zombieBuckets, this.zombies, h.x, h.z, radius)) {
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
      if (this.mode === 'labyrinth') {
        // No colony to besiege: the horde hunts the heroes themselves. The
        // field re-seeds on a short clock because the target keeps walking —
        // which makes the field's contents SIMULATION STATE: the seeds of the
        // last compute are snapshotted so a restore rebuilds the exact field
        // instead of one from the heroes' current positions.
        for (const h of this.heroes) {
          if (h.dead) continue;
          const i = (h.z | 0) * this.map.size + (h.x | 0);
          if (i >= 0 && i < this.occ.length) sources.push(i);
        }
        this._flowSeeds = [...sources];
      } else {
        for (const b of this.buildings) {
          if (!b.alive || b.kind === 'wall') continue;
          for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) {
            sources.push((b.z + dz) * this.map.size + (b.x + dx));
          }
        }
      }
      // Always compute, even with zero sources: an empty compute fills the
      // field with Infinity, which is what "nothing to hunt" must read as.
      // Skipping it would leave the buffer's initial zeros — every idle creep
      // on the map would read "the objective is right here" and wake.
      this.flow.compute(this.occ, sources, this.gateIds);
      // The friendly gate-exit field rides the same clock: same Dijkstra,
      // but stone is impassable — only the gates let a squad through. Seeded
      // from every open gate tile (the arch), so descending it from anywhere
      // walks a stuck squad out the nearest gate instead of grinding the wall.
      const gateTiles = [];
      for (let i = 0; i < this.occ.length; i++) {
        const id = this.occ[i];
        if (id !== 0 && this.gateIds.has(id)) gateTiles.push(i);
      }
      this.exitField.compute(this.occ, gateTiles, this.gateIds, true);
      this.flowDirty = false;
      this.flowTimer = this.mode === 'labyrinth' ? 0.8 : 2.5;
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
      for (const zb of nearbyBuckets(this._zombieBuckets, this.zombies, caller.x, caller.z, call.radius)) {
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

      // Siegers ignore your army entirely and go eat a building. With nothing
      // built (the labyrinth, or a not-yet-founded run) they fight like the
      // rest of the horde instead of trailing the heroes inertly.
      if (zb.def.siege && this.buildings.length) { this._updateSieger(zb, dt, dmgMul); continue; }

      // 1) Chase a nearby living unit if close. Veiled heroes are invisible.
      if (zb.targetU && (zb.targetU.dead || zb.targetU.stealth || dist2(zb.x, zb.z, zb.targetU.x, zb.targetU.z) > 130)) zb.targetU = null;
      zb.retarget = (zb.retarget || 0) - dt;
      if (!zb.targetU && zb.retarget <= 0) {
        zb.retarget = 0.4 + this.rng() * 0.3;
        let best = null, bd = Math.max(100, (range + 2) * (range + 2)); // within 10 tiles, or weapon reach
        for (const u of nearbyBuckets(this._unitBuckets, this.units, zb.x, zb.z, Math.sqrt(bd))) {
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

      // 4) Follow the flow field toward the city (or, in the labyrinth, the
      // heroes — the field is seeded on them there).
      const dir = this.flow.dirAt(zb.x | 0, zb.z | 0);
      if (dir) {
        this._moveZombie(zb, dir[0], dir[1], zb.def.chase * zb.speedMul, dt, true);
        continue;
      }
      // Off the flow field (local dead spot) — shamble straight at the
      // objective until the field picks us up again. Horde zombies never give
      // up. The anchor is only resolved here, on the rare dead-spot path.
      const anchor = this.hq && this.hq.alive ? { x: this.hq.cx, z: this.hq.cz } : this._nearestHeroPoint(zb);
      if (anchor) {
        const dx = anchor.x - zb.x, dz = anchor.z - zb.z;
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
            const facingX = Math.sin(h.facing || 0), facingZ = Math.cos(h.facing || 0);
            const [ox, oz] = this._formationOffset(u, facingX, facingZ, 1.05);
            const tx = h.x - facingX * 2.1 + ox, tz = h.z - facingZ * 2.1 + oz;
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
      if (u.hero && u.swapCd > 0) u.swapCd = Math.max(0, u.swapCd - dt);
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
        for (const zb of nearbyBuckets(this._zombieBuckets, this.zombies, u.x, u.z, seek)) {
          if (zb.dead) continue;
          const d = dist2(u.x, u.z, zb.x, zb.z);
          if (d < bd) { bd = d; best = zb; }
        }
        // Hunting troops do not acquire contacts through stone: a squad
        // sealed behind its own rampart would stand at the wall firing at a
        // zombie it can never reach on foot, looking stuck in base forever
        // (QA 2026-08-17). Wall-less sight stays for defenders — firing over
        // the rampart from a hold point is legal defense, not a trap.
        if (hunting && best && this._wallBetween(u.x, u.z, best.x, best.z)) best = null;
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
      // A hero swings their equipped weapon; a squad trooper swings their unit
      // definition. Both answer the same questions, so one accessor serves.
      const w = u.weapon || u.def;
      const attackRange = u.hero ? this.heroRange(u) : u.def.range;
      // Crit: a hero's own chance (base + passives) plus whatever an aura is
      // granting right now (John's Reckless Bravado reaches squad troops too).
      // Rolled here — the actual attack execution, not heroStats()/heroDmg()
      // display math — so the shared RNG stream stays identical across peers
      // regardless of how often each client's HUD happens to re-render.
      const hitDmg = () => {
        let dmg = u.hero ? this.heroDmg(u) : u.def.dmg * (u.auraDmg || 1) * (1 + this.relicMods.troopDmg);
        const critChance = (u.hero ? (w.critChance || 0) + (u.mods.critChance || 0) : 0) + (u.auraCrit || 0);
        if (critChance > 0 && this.rng() < critChance) {
          // Critical damage comes from the weapon AND from everything the hero
          // is carrying or has allocated. Reading only the weapon made every
          // relay and doctrine that grants critical damage do nothing.
          const critMult = u.hero
            ? (w.critMult || 1.75) + ((u.mods && u.mods.critMult) || 0)
            : 1.75;
          dmg *= critMult;
        }
        return dmg;
      };
      if (u.target && !u.target.dead && u.cooldown <= 0) {
        const zb = u.target;
        if (dist2(u.x, u.z, zb.x, zb.z) <= attackRange * attackRange) {
          u.cooldown = 1 / (w.rof * rofMult);
          u.facing = Math.atan2(zb.x - u.x, zb.z - u.z);
          const dmg = hitDmg();
          this.damageZombie(zb, dmg, u.x, u.z, w.types || null, u.hero ? u.mods : null);
          // Shotgun spread: the blast mauls everything packed around the target.
          if (w.splash) {
            const s2 = w.splash * w.splash;
            for (const zb2 of nearbyBuckets(this._zombieBuckets, this.zombies, zb.x, zb.z, w.splash)) {
              if (zb2 === zb || zb2.dead) continue;
              if (dist2(zb.x, zb.z, zb2.x, zb2.z) <= s2) this.damageZombie(zb2, dmg * 0.55, u.x, u.z, w.types || null, u.hero ? u.mods : null);
            }
          }
          const kind = u.hero ? (w.melee ? 'melee' : w.shotgun ? 'shotgun' : 'hero') : u.key;
          this.emit({ type: 'shot', kind, fromId: u.id, heroKey: u.hero ? u.key : null, fx: u.x, fz: u.z, tx: zb.x, tz: zb.z, fy: u.hero ? 0.9 : 0.7, targetScale: zb.def.scale });
          if (w.noise > 0) this.wakeZombies(u.x, u.z, w.noise);
        }
      } else if (u.targetNest && u.targetNest.alive && u.cooldown <= 0) {
        const n = u.targetNest;
        if (dist2(u.x, u.z, n.x, n.z) <= (attackRange + 2.5) ** 2) {
          u.cooldown = 1 / (w.rof * rofMult);
          u.facing = Math.atan2(n.x - u.x, n.z - u.z);
          this._damageNest(n, hitDmg());
          const kind = u.hero ? (w.melee ? 'melee' : w.shotgun ? 'shotgun' : 'hero') : u.key;
          this.emit({ type: 'shot', kind, fromId: u.id, heroKey: u.hero ? u.key : null, fx: u.x, fz: u.z, tx: n.x, tz: n.z, fy: u.hero ? 0.9 : 0.7, targetKind: 'nest' });
          if (w.noise > 0) this.wakeZombies(u.x, u.z, w.noise);
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
        // Chasing a contact that stands on the far side of stone is the
        // quiet version of the sealed-base bug: the squad grinds the wall
        // forever because the retarget cycle re-acquires the same zombie
        // through the rampart. Drop it and let the push (and the gate exit)
        // take over; standing fire over walls stays legal below.
        if (this._wallBetween(u.x, u.z, u.target.x, u.target.z)) {
          u.target = null;
          u.retargetT = Math.max(u.retargetT || 0, 1); // walk a beat before re-acquiring
        } else {
          this._moveActor(u, (u.target.x - u.x) / d, (u.target.z - u.z) / d, u.def.speed, dt);
          u.facing = Math.atan2(u.target.x - u.x, u.target.z - u.z);
          u.moving = true;
        }
      } else u.moving = false;
      if (u.target) return;
    }
    if (u.targetNest && u.targetNest.alive) {
      const n = u.targetNest;
      const dx = n.x - u.x, dz = n.z - u.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > u.def.range + 1.2) {
        if (this._wallBetween(u.x, u.z, n.x, n.z)) {
          // The hive is behind our own wall — route to it, don't grind at it.
          u.targetNest = null;
        } else {
          this._moveActor(u, dx / d, dz / d, u.def.speed, dt);
          u.facing = Math.atan2(dx, dz);
          u.moving = true;
        }
      } else u.moving = false;
      if (u.targetNest) return;
    }

    // Gate-exit: a squad caught inside its own walls walks the exit field
    // down to the nearest gate. dirAt goes null exactly on the gate tile
    // (it is the field's minimum) — that is "out", and normal routing
    // resumes from the threshold instead of from behind the rampart.
    if (u.gateCool > 0) u.gateCool -= dt;
    if (u.gateExit) {
      const ex = u.x | 0, ez = u.z | 0;
      const d = this.exitField.distAt(ex, ez);
      const dir = this.exitField.dirAt(ex, ez);
      if (d === 0) {
        // On the gate itself — the field's minimum. Out. Return now: the
        // repath below this block would otherwise assign a lane route whose
        // nearest node is back inside, and the beeline would never run.
        u.gateExit = false;
        u.gateCool = 2;             // beeline straight through the door below
        u.route = null;
        u.repathT = 0;
        return;
      } else if (dir) {
        // Remember the march: the last descent step points through the arch,
        // and the cooldown beeline below reuses it. Repathing during the
        // cooldown instead hands the squad a wall-crossing lane route whose
        // nearest node is INSIDE the compound — it would walk straight back
        // in and oscillate on the threshold forever.
        u.exitDx = dir[0]; u.exitDz = dir[1];
        this._moveActor(u, dir[0], dir[1], u.def.speed, dt);
        u.facing = Math.atan2(dir[0], dir[1]);
        u.moving = true;
        return;
      } else {
        // Wedged in a corner with distance still to walk: shove past it.
        // dirAt null here is NOT arrival — treating it as such is the
        // oscillation that kept squads bouncing off their own junctions.
        const spot = this._exitUnstick(ex, ez);
        if (spot) { u.x = spot[0] + 0.5; u.z = spot[1] + 0.5; u.moving = true; return; }
        u.gateExit = false;         // truly wedged — let lane routing try a way around
        u.gateCool = 1;
        u.route = null;
        u.repathT = 0;
      }
    } else if (u.gateCool > 0 && u.exitDx != null) {
      // Fresh off the gate: keep walking the way the arch pointed — do NOT
      // repath while the nearest lane node may still be inside the walls.
      const moved = this._moveActor(u, u.exitDx, u.exitDz, u.def.speed, dt);
      u.facing = Math.atan2(u.exitDx, u.exitDz);
      u.moving = true;
      if (!moved || u.gateCool <= 0) u.exitDx = u.exitDz = null;
      else return;
    } else if (u.targetGi >= 0 && !u.route) {
      // The direct approach has no route and therefore no watchdog — a squad
      // marching straight at an objective across a wall would grind it forever
      // without ever tripping the stuck timer. Check before it starts.
      const [tx, tz] = this._giPoint(u.targetGi);
      if (this._wantsGate(u, tx, tz)) u.gateExit = true;
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
      const rawX = tx - u.x, rawZ = tz - u.z;
      const [ox, oz] = this._formationOffset(u, rawX, rawZ);
      const dx = tx + ox - u.x, dz = tz + oz - u.z;
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
    if (this.mode === 'labyrinth') {
      const def = this.map.labyrinthLayout?.encounters?.find((e) => e.nest === n.id);
      const state = def && this.labyrinthEncounters.find((e) => e.key === def.key);
      if (def?.kind === 'holdout' && state && state.wave < def.waves) {
        this.emit({ type: 'shieldhit', x: n.x, z: n.z });
        return;
      }
    }
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
      // The hoard the hive was sitting on is out in the open now.
      for (const l of this.loot) {
        if (l.hidden && dist2(l.x, l.z, n.x, n.z) < 100) {
          l.hidden = false;
          this.emit({ type: 'lootseen', x: l.x, z: l.z, key: l.key, id: l.id });
        }
      }
      const left = this.liveNests();
      this.emit({ type: 'nestdown', x: n.x, z: n.z });
      this.msg(`🔥 A hive nest is razed! ${left ? `${left} still mustering.` : 'The land holds its breath…'}`, 'info');
      if (this.mode === 'labyrinth') {
        // A cleared chamber is the run's progress made physical: the fallen
        // now return here, and the chamber pays its blessing.
        this.checkpoint = { x: n.x, z: n.z };
        this._offerBlessings();
      }
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

// ---------------------------------------------------------------------------
// Run scoring (read-only)
// ---------------------------------------------------------------------------
// The simulation has always kept the numbers a run is judged by — kills, coins,
// hives razed, nodes taken, the Threat it reached. This is the one place that
// folds them into a single score, so the end screen, the profile and the
// meta-progression layer (`src/meta.js`) all read the SAME number instead of
// each inventing one. It reads the game and writes nothing: calling it mid-run
// is legal and cannot perturb the sim or a lockstep hash.
export const RUN_SCORE_WEIGHTS = {
  kill: 1, coin: 0.5, nest: 150, node: 40, built: 5, lost: -10, threat: 25,
  boss: 200, win: 1.5, loss: 0.6,
};

export function runScore(game) {
  const stats = (game && game.stats) || {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const W = RUN_SCORE_WEIGHTS;
  const level = game && game.level ? game.level : null;
  const mult = level && Number.isFinite(level.mult) ? level.mult : 1;
  const won = !!(game && game.won);
  const bossKilled = stats.bossKillT != null;
  const raw = num(stats.kills) * W.kill
    + num(stats.coins) * W.coin
    + num(stats.nests) * W.nest
    + num(stats.nodes) * W.node
    + num(stats.built) * W.built
    + num(stats.lost) * W.lost
    + Math.max(0, num(game && game.threatLevel) - 1) * W.threat
    + (bossKilled ? W.boss : 0);
  // A loss still scores — half a war is still a war — but never below zero,
  // whatever the building losses did to the raw total.
  const score = Math.max(0, Math.round(raw * mult * (won ? W.win : W.loss)));
  return {
    score, won, bossKilled,
    mode: (game && game.mode) || 'campaign',
    levelId: (game && game.levelId) || 0,
    worldKind: (level && level.worldKind) || (level && level.labyrinth ? 'labyrinth' : 'earth'),
    mult, threatLevel: num(game && game.threatLevel),
    time: num(game && game.time),
    kills: num(stats.kills), coins: num(stats.coins), nests: num(stats.nests),
    nodes: num(stats.nodes), built: num(stats.built), lost: num(stats.lost),
    bestHeld: num(stats.bestHeld), heroDeaths: num(stats.heroDeaths),
  };
}
