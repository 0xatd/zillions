// Server-side match replay.
//
// The simulation (src/game.js) is pure and deterministic: given the same map
// seed, level, difficulty, mode, hero loadouts, match seed and the same
// commands at the same sim steps, it produces the same match. The browser
// records every command the sim executes as [step, command] (Game.inputLog);
// the server re-runs that log headlessly here and rebuilds the match report
// from its OWN Game with buildMatchReport().
//
// What this proves and what it does not:
//   - Proven when the replay completes: every counter in the report (kills,
//     coins, nests, nodes, buildings, threat, boss kill, looted pack, win/loss,
//     sim duration) is what the sim produces for that input log.
//   - The input log itself is still client-authored. A bot that plays
//     perfectly produces a perfectly valid log; replay stops forged OUTCOMES,
//     not automated play.
//   - The reporter's own hero is rebuilt from server data where the server has
//     it (level, XP, stash, equipped items and their sockets, relics). The
//     Lattice allocation, class/race and hero upgrades still come from the
//     client's character record and are bounded, not proven. Co-op teammates'
//     loadouts are replayed as their host received them.
//   - Floating-point Math functions can differ across JS engines. The replay
//     runs on Node (V8); a run played on another engine can legitimately
//     diverge. That is why a mismatch is not an accusation: the server grants
//     what its own replay produced and flags the report for review.
import { SIM_DT, HEROES, levelById, isLabyrinthLevel, normalizeHeroUpgrades } from './config.js';
import { Game } from './game.js';
import { TerrainField } from './terrain.js';
import { buildMatchReport } from './match-report.js';
import { MATCH_LIMITS, matchScore } from './match-rewards.js';
import { characterCamp } from './mmo-characters.js';
import { latticePoints } from './skilltree.js';

export const REPLAY_VERSION = 1;
export const REPLAY_LIMITS = Object.freeze({
  maxSteps: Math.ceil(MATCH_LIMITS.maxDurationSeconds / SIM_DT),
  maxLogEntries: 120000,
  maxPlayers: 4,
  // Wall-clock budget for an inline replay inside the match-result function.
  // Longer replays are stored and verified later (scripts/verify-replays.mjs).
  inlineBudgetMs: 40000,
  deadlineCheckEvery: 240,
});

// Fields of a report the replay must reproduce exactly.
export const REPLAY_FIELDS = Object.freeze([
  'won', 'durationSeconds', 'threatLevel', 'kills', 'coins', 'nests', 'nodes', 'built', 'lost',
  'bestHeld', 'heroDeaths', 'bossKillT', 'hqTier', 'standingBuildings', 'pack',
]);

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const cleanKey = (v, max = 64) => (typeof v === 'string' ? v.replace(/[^a-zA-Z0-9_:\-.]/g, '').slice(0, max) : '');
const fail = (error, detail = null) => ({ ok: false, error, ...(detail ? { detail } : {}) });

// Validate the shape of an untrusted replay payload. Returns a clean copy.
export function validateReplayPayload(raw) {
  if (!isObj(raw)) return fail('missing_replay');
  if (raw.v !== REPLAY_VERSION) return fail('unsupported_replay_version');
  const frames = Number(raw.frames);
  if (!Number.isInteger(frames) || frames < 1 || frames > REPLAY_LIMITS.maxSteps) return fail('invalid_replay', 'frames');
  const heroIndex = Number(raw.heroIndex ?? 0);
  if (!Number.isInteger(heroIndex) || heroIndex < 0 || heroIndex >= REPLAY_LIMITS.maxPlayers) return fail('invalid_replay', 'heroIndex');
  const heroesRaw = Array.isArray(raw.heroes) ? raw.heroes : [raw.heroes];
  if (!heroesRaw.length || heroesRaw.length > REPLAY_LIMITS.maxPlayers || heroIndex >= heroesRaw.length) return fail('invalid_replay', 'heroes');
  const heroes = [];
  for (const entry of heroesRaw) {
    const k = typeof entry === 'string' ? entry : entry?.k;
    if (typeof k !== 'string' || !HEROES[k]) return fail('invalid_replay', 'hero');
    heroes.push(typeof entry === 'string' ? k : { k, camp: isObj(entry.camp) ? entry.camp : null });
  }
  const log = raw.log;
  if (!Array.isArray(log) || log.length > REPLAY_LIMITS.maxLogEntries) return fail('invalid_replay', 'log');
  let last = 0;
  for (const entry of log) {
    if (!Array.isArray(entry) || entry.length !== 2) return fail('invalid_replay', 'log_entry');
    const [step, cmd] = entry;
    if (!Number.isInteger(step) || step < last || step > frames) return fail('invalid_replay', 'log_order');
    if (!isObj(cmd) || typeof cmd.t !== 'string') return fail('invalid_replay', 'log_command');
    last = step;
  }
  return {
    ok: true,
    replay: {
      v: REPLAY_VERSION, frames, heroIndex, heroes, log,
      character: isObj(raw.character) ? raw.character : null,
    },
  };
}

// The reporter's hero as the server knows it. `server` carries what the
// database owns: level, xp, stash keys, equipped items (slot -> key),
// socket mods derived from equipped instances, relics.
// Client-owned build choices (class, race, Lattice, hero upgrades) are taken
// from the claim but bounded.
export function rebuildOwnCamp(claimed, server) {
  const c = isObj(claimed) ? claimed : {};
  const level = Math.max(1, Math.min(100, Number(server?.level) || 1));
  const lattice = Array.isArray(c.lattice) ? c.lattice.filter((id) => typeof id === 'string').slice(0, latticePoints(level, 30)) : [];
  const character = {
    level,
    xp: Math.max(0, Number(server?.xp) || 0),
    classKey: cleanKey(c.classKey, 32),
    raceKey: cleanKey(c.raceKey, 32),
    appearance: cleanKey(c.appearance, 32),
    customization: isObj(c.customization) ? c.customization : {},
    lattice,
    latticeSets: isObj(c.latticeSets) ? c.latticeSets : null,
    activeSet: c.activeSet === 1 ? 1 : 0,
    upgrades: normalizeHeroUpgrades(isObj(c.upgrades) ? c.upgrades : {}),
    items: Array.isArray(server?.items) ? [...server.items] : [],
    equipment: isObj(server?.equipment) ? { ...server.equipment } : {},
    socketMods: isObj(server?.socketMods) ? { ...server.socketMods } : {},
  };
  return characterCamp(character, Array.isArray(server?.relics) ? server.relics : []);
}

// The reporter's hero for the replay. A Lattice character camp (campaign
// mode, the character's own hero) is rebuilt from server data; the older
// per-hero campaign record is bounded by what the server knows: level no
// higher than the character's, only items the character owns, server relics.
export function serverCamp(claimed, server) {
  const c = isObj(claimed) ? claimed : {};
  if (Array.isArray(c.lattice) || isObj(c.treeMods)) return rebuildOwnCamp(c, server);
  const owned = new Set([...(server?.items || []), ...Object.values(server?.equipment || {})]);
  const serverLevel = Math.max(1, Number(server?.level) || 1);
  return {
    level: Math.max(1, Math.min(serverLevel, Number(c.level) || 1)),
    xp: Math.max(0, Number(c.xp) || 0),
    items: (Array.isArray(c.items) ? c.items : []).filter((key) => typeof key === 'string' && owned.has(key)),
    upgrades: normalizeHeroUpgrades(isObj(c.upgrades) ? c.upgrades : {}),
    relics: Array.isArray(server?.relics) ? [...server.relics] : [],
  };
}

// Replace the reporter's hero setup with the server-built one.
export function withServerCamp(replay, server) {
  const heroes = replay.heroes.map((entry, index) => {
    // A hero with no camp is a fresh level-1 hero; nothing to bound.
    if (index !== replay.heroIndex || typeof entry === 'string' || !entry.camp) return entry;
    return { k: entry.k, camp: serverCamp(entry.camp, server) };
  });
  return { ...replay, heroes };
}

// Re-run a match headlessly. `deadline` is an absolute performance.now() ms;
// past it the replay stops with status 'timeout' (never a verdict).
export function replayMatch({ levelId, mode, difficulty, seed, replay, now = () => performance.now(), deadline = Infinity }) {
  const level = levelById(levelId);
  if (!level) return { status: 'invalid', error: 'invalid_level' };
  if ((mode === 'labyrinth') !== isLabyrinthLevel(levelId)) return { status: 'invalid', error: 'invalid_level' };
  let game;
  try {
    const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
    game = new Game(map, difficulty, replay.heroes, null, levelId, mode, { rngSeed: seed });
  } catch (error) {
    return { status: 'invalid', error: 'replay_setup_failed', detail: String(error?.message || error).slice(0, 120) };
  }
  const log = replay.log;
  let i = 0;
  try {
    for (let step = 0; step < replay.frames && !game.over; step++) {
      while (i < log.length && log[i][0] === step) { game.exec(log[i][1]); i++; }
      game.update(SIM_DT);
      if (step % REPLAY_LIMITS.deadlineCheckEvery === 0 && now() > deadline) {
        return { status: 'timeout', steps: game.steps };
      }
    }
  } catch (error) {
    return { status: 'invalid', error: 'replay_crashed', detail: String(error?.message || error).slice(0, 120), steps: game.steps };
  }
  return {
    status: 'complete',
    over: !!game.over,
    steps: game.steps,
    report: buildMatchReport(game, { won: !!game.won, heroIndex: replay.heroIndex }),
  };
}

// Which fields of the claim disagree with the replay.
export function diffReports(claimed, replayed) {
  const out = [];
  for (const key of REPLAY_FIELDS) {
    const a = claimed?.[key];
    const b = replayed?.[key];
    if (key === 'pack') {
      const sa = [...new Set(a || [])].sort().join(',');
      const sb = [...new Set(b || [])].sort().join(',');
      if (sa !== sb) out.push(key);
    } else if (key === 'bossKillT') {
      if ((a == null) !== (b == null) || (a != null && Math.abs(Number(a) - Number(b)) > 0.15)) out.push(key);
    } else if (key === 'won') {
      if (!!a !== !!b) out.push(key);
    } else if (Number(a) !== Number(b)) out.push(key);
  }
  return out;
}

// ---------------------------------------------------------------- policy
//
// When must a report be replayed before it pays out? Replaying everything is
// the goal; these rules make sure the reports that matter most are always
// replayed even when the budget is tight:
//   1. personal_best   — a score above the player's best on that level/mode,
//                        a first campaign clear, a survival best, or a first
//                        labyrinth clear.
//   2. suspicious      — any counter above half of its plausibility ceiling,
//                        a claimed duration faster than the server clock
//                        allows at 1.5x, a boss kill in the first 10% of a
//                        match, or a run that is near the XP / Alloy caps.
//   3. spot_check      — a random sample of everything else (SPOT_CHECK_RATE).
export const SPOT_CHECK_RATE = 0.15;
export const SUSPICION_SHARE = 0.5;

export function replayReasons(report, context = {}, random = Math.random) {
  const reasons = [];
  const L = MATCH_LIMITS;
  const d = Math.max(1, report.durationSeconds);
  const best = context.bestScore ?? null;
  const score = matchScore(report);
  if (best == null || score > best) reasons.push('personal_best');
  if (report.mode === 'campaign' && report.won && report.levelId > (context.campaignCleared || 0)) reasons.push('first_clear');
  if (report.mode === 'survival' && report.threatLevel > (context.bestSurvival || 0)) reasons.push('survival_best');
  if (report.mode === 'labyrinth' && report.won && !context.labyrinthClears?.[report.levelId]) reasons.push('first_clear');

  const share = SUSPICION_SHARE;
  if (report.kills > (d * L.killsPerSecond + L.killSlack) * share) reasons.push('suspicious_kills');
  if (report.coins > (d * L.coinsPerSecond + L.coinSlack) * share) reasons.push('suspicious_coins');
  if (report.built > (d * L.builtPerSecond + L.builtSlack) * share) reasons.push('suspicious_built');
  if (context.serverElapsedSeconds != null && report.durationSeconds > context.serverElapsedSeconds * 1.5 + 30) reasons.push('suspicious_speed');
  if (report.bossKillT != null && report.bossKillT < d * 0.1) reasons.push('suspicious_boss');
  if (report.pack?.length) reasons.push('loot');
  if (!reasons.length && random() < SPOT_CHECK_RATE) reasons.push('spot_check');
  return [...new Set(reasons)];
}

