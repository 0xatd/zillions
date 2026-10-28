// Deterministic match replay (verification capability, not run per match).
//
// /api/match-result does NOT replay matches on the reward path; rewards are
// granted on the cheap checks (signed ticket, plausibility bounds, loot table).
// The input log of a leaderboard candidate is stored with its report so a
// future leaderboard can replay its top or flagged entries before showing
// them (docs/leaderboards.md). Everything below is that verifier.
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
//     diverge. That is why a mismatch is not an accusation: a leaderboard
//     verifier should hide the entry and queue it for human review.
import { SIM_DT, HEROES, levelById, isLabyrinthLevel, normalizeHeroUpgrades, CULTURE_ARMIES, DEFAULT_CULTURE } from './config.js';
import { PERKS } from './perks.js';
import { Game } from './game.js';
import { TerrainField } from './terrain.js';
import { buildMatchReport } from './match-report.js';
import { MATCH_LIMITS, counterCeilings, matchScore } from './match-rewards.js';
import { characterCamp } from './mmo-characters.js';
import { latticePoints } from './skilltree.js';

export const REPLAY_VERSION = 1;
export const REPLAY_LIMITS = Object.freeze({
  maxSteps: Math.ceil(MATCH_LIMITS.maxDurationSeconds / SIM_DT),
  maxLogEntries: 120000,
  maxPlayers: 4,
  deadlineCheckEvery: 240,
});

// Fields of a report the replay must reproduce exactly.
export const REPLAY_FIELDS = Object.freeze([
  'won', 'durationSeconds', 'threatLevel', 'kills', 'coins', 'nests', 'nodes', 'built', 'lost',
  'bestHeld', 'heroDeaths', 'bossKillT', 'hqTier', 'standingBuildings', 'pack', 'perks',
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
  const perks = parseReplayPerks(raw.perks);
  if (!perks) return fail('invalid_replay', 'perks');
  return {
    ok: true,
    replay: {
      v: REPLAY_VERSION, frames, heroIndex, heroes, log,
      character: isObj(raw.character) ? raw.character : null,
      culture: typeof raw.culture === 'string' && Object.hasOwn(CULTURE_ARMIES, raw.culture) ? raw.culture : DEFAULT_CULTURE,
      perks,
    },
  };
}

// The perk stack the match started with. Omitted means none, so older logs
// still validate. An unknown key is refused rather than silently dropped:
// a replay that skips a perk would not be the match that was stored.
function parseReplayPerks(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > Object.keys(PERKS).length) return null;
  const out = [];
  for (const key of raw) {
    if (typeof key !== 'string' || !Object.hasOwn(PERKS, key) || out.includes(key)) return null;
    out.push(key);
  }
  return out;
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
    game = new Game(map, difficulty, replay.heroes, null, levelId, mode, {
      rngSeed: seed, culture: replay.culture, perks: replay.perks,
    });
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

// Verify a stored report against its stored input log (for a leaderboard's
// top or flagged entries). `match` is { levelId, mode, difficulty, seed }.
// Returns { status: 'verified' | 'mismatch' | 'timeout' | 'invalid', ... }.
export function verifyReplay({ match, report, replay, now, deadline }) {
  const checked = validateReplayPayload(replay);
  if (!checked.ok) return { status: 'invalid', error: checked.error, detail: checked.detail || null };
  const result = replayMatch({ ...match, replay: checked.replay, now, deadline });
  if (result.status !== 'complete') return result;
  const mismatch = diffReports(report, result.report);
  return mismatch.length ? { status: 'mismatch', mismatch, replayed: result.report } : { status: 'verified' };
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
    } else if (key === 'perks') {
      const sa = [...(a || [])].join(',');
      const sb = [...(b || [])].join(',');
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
// Which reports keep their input log for later leaderboard verification, and
// which are flagged for review. Nothing here blocks or changes a payout.
//   1. personal_best / first_clear / survival_best — the only runs that can
//      move a player up a leaderboard, so their log is kept.
//   2. suspicious_*  — any counter above half of its plausibility ceiling, a
//      claimed duration faster than the server clock allows at 1.5x, or a
//      boss kill in the first 10% of a match. These are kept AND flagged.
export const SUSPICION_SHARE = 0.5;

export function reviewReasons(report, context = {}) {
  const reasons = [];
  const d = Math.max(1, report.durationSeconds);
  const best = context.bestScore ?? null;
  const score = matchScore(report);
  if (best == null || score > best) reasons.push('personal_best');
  if (report.mode === 'campaign' && report.won && report.levelId > (context.campaignCleared || 0)) reasons.push('first_clear');
  if (report.mode === 'survival' && report.threatLevel > (context.bestSurvival || 0)) reasons.push('survival_best');
  if (report.mode === 'labyrinth' && report.won && !context.labyrinthClears?.[report.levelId]) reasons.push('first_clear');

  const share = SUSPICION_SHARE;
  const caps = counterCeilings(report);
  if (report.kills > caps.kills * share) reasons.push('suspicious_kills');
  if (report.coins > caps.coins * share) reasons.push('suspicious_coins');
  if (report.built > caps.built * share) reasons.push('suspicious_built');
  if (context.serverElapsedSeconds != null && report.durationSeconds > context.serverElapsedSeconds * 1.5 + 30) reasons.push('suspicious_speed');
  if (report.bossKillT != null && report.bossKillT < d * 0.1) reasons.push('suspicious_boss');
  return [...new Set(reasons)];
}

export const isFlagged = (reasons) => reasons.some((reason) => reason.startsWith('suspicious_'));
