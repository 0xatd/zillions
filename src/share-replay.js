// Shareable match replays.
//
// A replay is the seed, the leaders, and the commands the simulation executed,
// plus the lockstep hash at the end. Playing it back runs the same Game the
// match ran. SIM_VERSION is the gate: a replay from another simulation is
// refused before any step runs, so an old log cannot desync a new build.
// Bump SIM_VERSION when a simulation change can alter a result.
import { SIM_DT, HEROES, CULTURE_ARMIES, DIFFICULTY, levelById, isLabyrinthLevel } from './config.js';
import { TerrainField } from './terrain.js';
import { Game } from './game.js';
import { stateHash } from './lockstep-hash.js';
import { dailyChallenge, validDay } from './daily.js';

export const SIM_VERSION = 19;
export const SHARE_REPLAY_VERSION = 1;

export const SHARE_LIMITS = Object.freeze({
  maxBytes: 1_200_000,
  maxLog: 20000,
  maxFrames: Math.ceil((4 * 60 * 60) / SIM_DT),
  maxLeaders: 4,
  maxCampBytes: 120_000,
  maxPerHour: 12,
  snapEvery: 150,
  snapCap: 80,
});

export const REPLAY_ID = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{8}$/;

const MODES = new Set(['campaign', 'survival', 'labyrinth', 'daily']);
const isObj = (value) => value && typeof value === 'object' && !Array.isArray(value);

const fail = (error, detail = null) => ({ ok: false, error, ...(detail ? { detail } : {}) });

export function replayIdFromLocation(pathname = '', search = '', injected = '') {
  if (REPLAY_ID.test(injected)) return injected;
  const path = String(pathname || '');
  const match = path.match(/\/r\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{8})\/?$/);
  if (match) return match[1];
  try {
    const query = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('r') || '';
    return REPLAY_ID.test(query) ? query : null;
  } catch {
    return null;
  }
}

export function shareReplayPath(id) {
  return REPLAY_ID.test(id) ? `/r/${id}` : null;
}

function validCommand(cmd) {
  if (!isObj(cmd) || typeof cmd.t !== 'string' || cmd.t.length < 1 || cmd.t.length > 24) return false;
  const keys = Object.keys(cmd);
  if (keys.length > 8) return false;
  for (const key of keys) {
    if (key.length > 16) return false;
    const value = cmd[key];
    if (value == null) continue;
    if (typeof value === 'string') {
      if (value.length > 64) return false;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > 1e6) return false;
    } else if (typeof value !== 'boolean') return false;
  }
  return true;
}

export function leaderKey(entry) {
  return typeof entry === 'string' ? entry : entry?.k || '';
}

export function leaderKeys(leaders) {
  return (Array.isArray(leaders) ? leaders : []).map(leaderKey).filter(Boolean);
}

// The hero setups the match was constructed with. A missing camp is stored as
// the hero key alone. Camps are kept because gear and the Lattice change the hash.
export function normalizeLeaders(raw) {
  const list = raw == null ? [] : (Array.isArray(raw) ? raw : [raw]);
  if (!list.length || list.length > SHARE_LIMITS.maxLeaders) return null;
  const out = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      if (!HEROES[entry]) return null;
      out.push(entry);
      continue;
    }
    if (!isObj(entry) || typeof entry.k !== 'string' || !HEROES[entry.k]) return null;
    if (entry.camp == null) {
      out.push(entry.k);
      continue;
    }
    let camp;
    try { camp = JSON.parse(JSON.stringify(entry.camp)); } catch { return null; }
    if (!isObj(camp)) return null;
    if (shareReplayBytes({ camp }) > SHARE_LIMITS.maxCampBytes) return null;
    out.push({ k: entry.k, camp });
  }
  return out;
}

export function canonicalReplay(replay) {
  const body = {
    v: SHARE_REPLAY_VERSION,
    sim: SIM_VERSION,
    seed: replay.seed >>> 0,
    mode: replay.mode,
    levelId: replay.levelId,
    difficulty: replay.difficulty,
    culture: replay.culture,
    leaders: replay.leaders,
    frames: replay.frames,
    hash: replay.hash | 0,
    won: !!replay.won,
    log: replay.log,
  };
  if (replay.mode === 'daily') body.day = replay.day;
  return body;
}

export function shareReplayBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function validateShareReplay(raw) {
  if (!isObj(raw)) return fail('missing_replay');
  if (raw.v !== SHARE_REPLAY_VERSION) return fail('unsupported_replay_version');
  if (raw.sim !== SIM_VERSION) return fail('sim_version_mismatch', { sim: raw.sim ?? null, expected: SIM_VERSION });
  if (!MODES.has(raw.mode)) return fail('invalid_replay', 'mode');
  if (typeof raw.difficulty !== 'string' || !Object.hasOwn(DIFFICULTY, raw.difficulty)) return fail('invalid_replay', 'difficulty');
  if (typeof raw.culture !== 'string' || !Object.hasOwn(CULTURE_ARMIES, raw.culture)) return fail('invalid_replay', 'culture');
  const levelId = Number(raw.levelId);
  const level = Number.isInteger(levelId) ? levelById(levelId) : null;
  if (!level) return fail('invalid_replay', 'level');
  if ((raw.mode === 'labyrinth') !== isLabyrinthLevel(levelId)) return fail('invalid_replay', 'level');
  const frames = Number(raw.frames);
  if (!Number.isInteger(frames) || frames < 1 || frames > SHARE_LIMITS.maxFrames) return fail('invalid_replay', 'frames');
  const seed = Number(raw.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return fail('invalid_replay', 'seed');
  if (!Number.isInteger(raw.hash)) return fail('invalid_replay', 'hash');
  const leaders = normalizeLeaders(raw.leaders);
  if (!leaders) return fail('invalid_replay', 'leaders');
  let day = null;
  if (raw.mode === 'daily') {
    if (!validDay(raw.day)) return fail('invalid_replay', 'day');
    const challenge = dailyChallenge(raw.day);
    if ((seed >>> 0) !== (challenge.seed >>> 0)) return fail('invalid_replay', 'seed');
    if (levelId !== challenge.levelId) return fail('invalid_replay', 'level');
    if (raw.culture !== challenge.culture) return fail('invalid_replay', 'culture');
    if (raw.difficulty !== 'normal') return fail('invalid_replay', 'difficulty');
    if (leaders.length !== 1 || leaderKey(leaders[0]) !== challenge.hero) return fail('invalid_replay', 'leaders');
    day = raw.day;
  }
  const log = raw.log;
  if (!Array.isArray(log) || log.length > SHARE_LIMITS.maxLog) return fail('invalid_replay', 'log');
  let last = 0;
  const cleanLog = [];
  for (const entry of log) {
    if (!Array.isArray(entry) || entry.length !== 2) return fail('invalid_replay', 'log_entry');
    const [step, cmd] = entry;
    if (!Number.isInteger(step) || step < last || step > frames) return fail('invalid_replay', 'log_order');
    if (!validCommand(cmd)) return fail('invalid_replay', 'log_command');
    last = step;
    cleanLog.push([step, cmd]);
  }
  const replay = canonicalReplay({
    seed, mode: raw.mode, levelId, difficulty: raw.difficulty, culture: raw.culture,
    leaders, frames, hash: raw.hash | 0, won: !!raw.won, day, log: cleanLog,
  });
  if (shareReplayBytes(replay) > SHARE_LIMITS.maxBytes) return fail('replay_too_large');
  return { ok: true, replay };
}

export function buildShareReplay(game, { leaders, difficulty } = {}) {
  if (!game || !Array.isArray(game.inputLog)) return null;
  const normalized = normalizeLeaders(leaders != null ? leaders : game.heroSetups);
  if (!normalized) return null;
  const checked = validateShareReplay({
    v: SHARE_REPLAY_VERSION,
    sim: SIM_VERSION,
    seed: game.rngSeed >>> 0,
    mode: game.mode,
    levelId: game.levelId,
    difficulty: difficulty || game.diffKey,
    culture: game.culture,
    leaders: normalized,
    frames: game.steps,
    hash: stateHash(game),
    won: !!game.won,
    day: game.mode === 'daily' ? game.daily?.day : undefined,
    log: game.inputLog.map((entry) => [entry[0], entry[1]]),
  });
  return checked.ok ? checked.replay : null;
}

// A verified daily log becomes the same shareable document. The day's
// challenge, not the client, supplies the seed, map, and leader.
export function shareReplayFromDaily(dailyReplay, { won = false } = {}) {
  if (!isObj(dailyReplay) || !validDay(dailyReplay.day)) return null;
  let challenge;
  try { challenge = dailyChallenge(dailyReplay.day); } catch { return null; }
  const checked = validateShareReplay({
    v: SHARE_REPLAY_VERSION,
    sim: SIM_VERSION,
    seed: challenge.seed >>> 0,
    mode: 'daily',
    levelId: challenge.levelId,
    difficulty: 'normal',
    culture: challenge.culture,
    leaders: [challenge.hero],
    frames: dailyReplay.frames,
    hash: dailyReplay.hash,
    won: !!won,
    day: dailyReplay.day,
    log: dailyReplay.log,
  });
  return checked.ok ? checked.replay : null;
}

export function replayPreview(replay) {
  const names = leaderKeys(replay?.leaders).map((key) => HEROES[key]?.name || key);
  const who = names.length ? names.join(', ') : 'a siege';
  const title = `Zillions replay — ${who}`.slice(0, 80);
  const outcome = replay?.won ? 'The city held.' : 'The city fell.';
  const mode = replay?.mode === 'daily' ? 'Daily Siege' : (replay?.mode || 'siege');
  const description = `${mode} · seed ${replay?.seed >>> 0} · ${outcome} Watch the run.`.slice(0, 180);
  return { title, description };
}

export function replayProblem(result) {
  if (result?.status === 'version' || result?.error === 'sim_version_mismatch') {
    const found = result.detail?.sim;
    const recorded = found == null ? 'another simulation' : `simulation ${found}`;
    return `This replay was recorded on ${recorded}. This game runs simulation ${SIM_VERSION}, so it is not played.`;
  }
  if (result?.error === 'unsupported_replay_version') return 'This replay uses a format this build does not read.';
  if (result?.error === 'not_found') return 'This replay link does not match a stored run.';
  return 'This replay could not be played.';
}

function defaultMap(seed, theme, opts) {
  return new TerrainField(seed, theme, opts);
}

export function createReplayGame(replay, snap = null, map = null, mapFactory = defaultMap) {
  const level = levelById(replay.levelId);
  const daily = replay.mode === 'daily' ? dailyChallenge(replay.day) : null;
  const mapSeed = snap?.seed ?? (daily ? daily.mapSeed : level.seed);
  const field = map || mapFactory(mapSeed, level.theme, { size: level.size, nests: level.nests });
  const leaders = replay.leaders.map((entry) => (typeof entry === 'string' ? entry : { k: entry.k, camp: entry.camp || null }));
  const game = new Game(field, replay.difficulty, leaders, snap, replay.levelId, replay.mode, {
    rngSeed: replay.seed,
    culture: replay.culture,
    ...(daily ? { daily } : {}),
  });
  return { game, map: field };
}

export function openReplay(raw, options = {}) {
  const checked = validateShareReplay(raw);
  if (!checked.ok) {
    return {
      status: checked.error === 'sim_version_mismatch' ? 'version' : 'invalid',
      error: checked.error,
      detail: checked.detail || null,
    };
  }
  try {
    const created = createReplayGame(checked.replay, null, null, options.mapFactory || defaultMap);
    return {
      status: 'ready',
      replay: checked.replay,
      game: created.game,
      map: created.map,
      mapFactory: options.mapFactory || defaultMap,
      step: 0,
      cursor: 0,
      snaps: [{ step: 0, snap: null }],
    };
  } catch (error) {
    return { status: 'invalid', error: 'replay_setup_failed', detail: String(error?.message || error).slice(0, 120) };
  }
}

function rememberSnap(session, snapEvery, snapCap) {
  if (session.step <= 0 || session.step % snapEvery !== 0) return;
  if (session.snaps.some((entry) => entry.step === session.step)) return;
  session.snaps.push({ step: session.step, snap: session.game.snapshot() });
  if (session.snaps.length <= snapCap) return;
  const drop = session.snaps.findIndex((entry, index) => index > 0 && index < session.snaps.length - 1 && index % 2 === 1);
  if (drop > 0) session.snaps.splice(drop, 1);
}

function restoreTo(session, goal) {
  let best = session.snaps[0];
  for (const entry of session.snaps) {
    if (entry.step <= goal && entry.step >= best.step) best = entry;
  }
  const created = createReplayGame(session.replay, best.snap, session.map, session.mapFactory);
  session.game = created.game;
  session.map = created.map;
  session.step = session.game.steps;
  session.cursor = 0;
  const log = session.replay.log;
  while (session.cursor < log.length && log[session.cursor][0] < session.step) session.cursor++;
}

// Advance to `target`, restoring the nearest snapshot when the target is behind
// the playhead. `maxSteps` lets a viewer spread a long seek across frames.
export function playReplayTo(session, target, { maxSteps = Infinity, snapEvery = SHARE_LIMITS.snapEvery, snapCap = SHARE_LIMITS.snapCap } = {}) {
  if (!session || session.status !== 'ready') return { done: true, step: session?.step || 0 };
  const goal = Math.max(0, Math.min(session.replay.frames, target | 0));
  if (goal < session.step) restoreTo(session, goal);
  let steps = 0;
  while (session.step < goal && !session.game.over && steps < maxSteps) {
    const step = session.step;
    const log = session.replay.log;
    while (session.cursor < log.length && log[session.cursor][0] < step) session.cursor++;
    while (session.cursor < log.length && log[session.cursor][0] === step) {
      session.game.exec(log[session.cursor][1]);
      session.cursor++;
    }
    session.game.update(SIM_DT);
    session.step = session.game.steps;
    steps++;
    rememberSnap(session, snapEvery, snapCap);
  }
  return { done: session.step >= goal || !!session.game.over, step: session.step };
}

// Re-run a recording from the start and compare the final lockstep hash.
export function replayShare(raw, options = {}) {
  const session = openReplay(raw, options);
  if (session.status !== 'ready') return session;
  playReplayTo(session, session.replay.frames, { maxSteps: Infinity, snapEvery: options.snapEvery, snapCap: options.snapCap });
  const hash = stateHash(session.game);
  if ((hash | 0) !== (session.replay.hash | 0)) {
    return { status: 'mismatch', hash, steps: session.step, session };
  }
  return { status: 'verified', hash, steps: session.step, won: !!session.game.won, session };
}

export function decideReplayPublish({ bytes, recentUser = 0, recentIp = 0, existingId = null }) {
  if (existingId) return { ok: true, duplicate: true, id: existingId };
  if (bytes > SHARE_LIMITS.maxBytes) return { ok: false, error: 'replay_too_large', status: 413 };
  if (recentUser >= SHARE_LIMITS.maxPerHour || recentIp >= SHARE_LIMITS.maxPerHour) {
    return { ok: false, error: 'rate_limited', status: 429 };
  }
  return { ok: true, duplicate: false };
}

export function boardReplayId(links, userId, hash) {
  const value = links?.get?.(userId);
  if (hash !== undefined && (!value || value.hash !== hash)) return null;
  const id = typeof value === 'string' ? value : value?.id;
  return REPLAY_ID.test(id || '') ? id : null;
}
