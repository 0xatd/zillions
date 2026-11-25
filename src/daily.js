// Daily Siege. One UTC day, one seed, one challenge for every player.
//
// The seed is a stable hash of the calendar day. It picks the landform, and
// it is also the terrain seed and the match seed, so the map, the scripted
// waves and the modifiers are pure functions of that day. Nothing here reads
// the clock except dailyKey(); tests and the server pass a date in.
//
// A score is accepted only after the server replays the input log with this
// module and the final lockstep hash matches. The client's claimed numbers
// are not stored.
import { SIM_DT, HEROES, LEVELS, levelById, CULTURE_ARMIES, cultureKey } from './config.js';
import { hashString } from './items.js';
import { makeRNG } from './utils.js';
import { TerrainField } from './terrain.js';
import { Game } from './game.js';
import { stateHash } from './lockstep-hash.js';

export const DAILY_REPLAY_VERSION = 1;
export const DAILY_TIME_CAP = 600;
export const DAILY_WAVE_COUNT = 8;
export const DAILY_MAX_STEPS = Math.ceil(DAILY_TIME_CAP / SIM_DT) + 60;
export const DAILY_MAX_LOG = 20000;
export const PENDING_DAILY_KEY = 'zillions_pending_daily';

// Score bands, high to low. A wave is worth more than a full Keep. One
// thousandth of the Keep is worth more than any time tiebreak (0–99).
const WAVE_BAND = 1_000_000;
const HP_BAND = 100;

export const DAILY_HEROES = Object.freeze(['scott', 'alexander', 'danny', 'turtle', 'john', 'tiger', 'aaron']);

export const DAILY_MODIFIERS = Object.freeze([
  { id: 'brittle_keep', name: 'Brittle Keep', detail: 'The Keep has less health.' },
  { id: 'fat_purse', name: 'Fat Purse', detail: 'The colony starts with more gold.' },
  { id: 'thin_purse', name: 'Thin Purse', detail: 'The colony starts with less gold.' },
  { id: 'thick_hide', name: 'Thick Hide', detail: 'The dead have more health.' },
  { id: 'long_stride', name: 'Long Stride', detail: 'The dead move faster.' },
  { id: 'eager_nests', name: 'Eager Nests', detail: 'Hives muster sooner.' },
  { id: 'slow_camps', name: 'Slow Camps', detail: 'Camps muster more slowly.' },
  { id: 'iron_walls', name: 'Iron Walls', detail: 'Buildings other than the Keep have more health.' },
]);

const MODIFIER_IDS = new Set(DAILY_MODIFIERS.map((mod) => mod.id));
const PURSE = { fat_purse: 'thin_purse', thin_purse: 'fat_purse' };
const WAVE_KINDS = Object.freeze(['walker', 'runner', 'walker', 'spitter', 'burrower']);
const EARTH_LEVELS = LEVELS.filter((level) => level.id >= 1 && level.id <= 5);
const CULTURES = Object.keys(CULTURE_ARMIES);

const isObj = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function dailyKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_day');
  return date.toISOString().slice(0, 10);
}

export function validDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === date;
}

// Today, or yesterday, so a run that ends just after midnight can still be sent.
export function acceptableDay(day, now = new Date()) {
  if (!validDay(day)) return false;
  const today = dailyKey(now);
  const yesterday = dailyKey(new Date(Date.parse(`${today}T00:00:00Z`) - 86400000));
  return day === today || day === yesterday;
}

export function dailySeed(day) {
  if (!validDay(day)) throw new Error('invalid_day');
  return hashString(`zillions.daily.v${DAILY_REPLAY_VERSION}.${day}`);
}

function pickModifiers(rng) {
  const pool = DAILY_MODIFIERS.map((mod) => mod.id);
  const picked = [];
  while (picked.length < 2 && pool.length) {
    const index = Math.floor(rng() * pool.length);
    const id = pool.splice(index, 1)[0];
    if (picked.includes(PURSE[id])) continue;
    picked.push(id);
  }
  return picked.sort();
}

function buildWaves(rng) {
  const waves = [];
  let at = 48;
  for (let i = 0; i < DAILY_WAVE_COUNT; i++) {
    const count = 5 + i * 2 + Math.floor(rng() * 3);
    let kind = WAVE_KINDS[Math.floor(rng() * WAVE_KINDS.length)];
    if (i >= 4 && rng() < 0.45) kind = 'brute';
    else if (i >= 6 && rng() < 0.3) kind = 'sieger';
    waves.push({ at, count, kind });
    at += 36 + Math.floor(rng() * 16);
  }
  return waves;
}

// The whole challenge. Call it twice for the same day and the objects match.
export function dailyChallenge(day = dailyKey()) {
  const seed = dailySeed(day);
  const rng = makeRNG(seed);
  const level = EARTH_LEVELS[Math.floor(rng() * EARTH_LEVELS.length)];
  const culture = CULTURES[Math.floor(rng() * CULTURES.length)];
  const hero = DAILY_HEROES[Math.floor(rng() * DAILY_HEROES.length)];
  if (!HEROES[hero] || !level) throw new Error('daily_roster');
  return {
    v: DAILY_REPLAY_VERSION,
    day,
    seed,
    mapSeed: seed,
    levelId: level.id,
    difficulty: 'normal',
    culture: cultureKey(culture),
    hero,
    modifiers: pickModifiers(rng),
    waves: buildWaves(rng),
    timeCap: DAILY_TIME_CAP,
  };
}

export function publicChallenge(challenge) {
  return {
    day: challenge.day,
    seed: challenge.seed >>> 0,
    levelId: challenge.levelId,
    hero: challenge.hero,
    culture: challenge.culture,
    modifiers: [...challenge.modifiers],
    waves: challenge.waves.length,
    timeCap: challenge.timeCap,
  };
}

export function modifierInfo(id) {
  return DAILY_MODIFIERS.find((mod) => mod.id === id) || null;
}

// Higher is better. Waves, then Keep health on a win, then time.
// A win's health band starts at 1 so any clear beats a loss on the same wave.
// Time is 0–99: faster on a win, longer on a loss. It cannot cross a health step.
export function dailyScore(standing) {
  const waves = Math.max(0, standing?.waves | 0);
  const maxHp = Math.max(1, standing?.cityMaxHp | 0);
  const hp = Math.max(0, Math.min(maxHp, standing?.cityHp | 0));
  const won = !!standing?.won;
  const seconds = Math.max(0, Math.min(DAILY_TIME_CAP, standing?.seconds | 0));
  const permille = won ? Math.max(1, Math.round((hp / maxHp) * 1000)) : 0;
  const timePart = won
    ? Math.max(0, Math.min(99, Math.round((1 - seconds / DAILY_TIME_CAP) * 99)))
    : Math.max(0, Math.min(99, Math.round((seconds / DAILY_TIME_CAP) * 99)));
  return waves * WAVE_BAND + permille * HP_BAND + timePart;
}

export function formatDailyStanding(standing) {
  const maxHp = Math.max(1, standing?.cityMaxHp | 0);
  const pct = Math.round((Math.max(0, standing?.cityHp | 0) / maxHp) * 100);
  const seconds = Math.max(0, standing?.seconds | 0);
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return `${standing?.waves | 0} waves survived · city ${pct}% · ${minutes}:${rest}`;
}

export function publicHandle(handle) {
  const clean = String(handle || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
  return clean.length >= 3 ? clean : 'commander';
}

function fail(error, detail = null) {
  return { ok: false, error, ...(detail ? { detail } : {}) };
}

function validCommand(cmd) {
  if (!isObj(cmd) || typeof cmd.t !== 'string' || cmd.t.length < 1 || cmd.t.length > 24) return false;
  const keys = Object.keys(cmd);
  if (keys.length > 8) return false;
  for (const key of keys) {
    if (key.length > 16) return false;
    const value = cmd[key];
    if (typeof value === 'string') {
      if (value.length > 32) return false;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) return false;
    } else if (typeof value !== 'boolean') return false;
  }
  return true;
}

function isInt32(value) {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}

// Shape-check an untrusted log. The seed and hero are checked against the
// day's challenge by verifyDailySubmission, not here.
export function validateDailyReplay(raw) {
  if (!isObj(raw)) return fail('missing_replay');
  if (raw.v !== DAILY_REPLAY_VERSION) return fail('unsupported_replay_version');
  if (!validDay(raw.day)) return fail('invalid_replay', 'day');
  const frames = Number(raw.frames);
  if (!Number.isInteger(frames) || frames < 1 || frames > DAILY_MAX_STEPS) return fail('invalid_replay', 'frames');
  if (!isInt32(raw.hash)) return fail('invalid_replay', 'hash');
  const seed = Number(raw.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return fail('invalid_replay', 'seed');
  if (typeof raw.hero !== 'string' || !HEROES[raw.hero]) return fail('invalid_replay', 'hero');
  if (cultureKey(raw.culture) !== raw.culture) return fail('invalid_replay', 'culture');
  const levelId = Number(raw.levelId);
  if (!Number.isInteger(levelId) || !levelById(levelId)) return fail('invalid_replay', 'level');
  if (!Array.isArray(raw.modifiers) && raw.modifiers != null) return fail('invalid_replay', 'modifiers');
  const log = raw.log;
  if (!Array.isArray(log) || log.length > DAILY_MAX_LOG) return fail('invalid_replay', 'log');
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
  return {
    ok: true,
    replay: {
      v: DAILY_REPLAY_VERSION,
      day: raw.day,
      seed: seed >>> 0,
      frames,
      hero: raw.hero,
      culture: raw.culture,
      levelId,
      hash: raw.hash | 0,
      log: cleanLog,
    },
  };
}

export function buildDailyReplay(game, challenge) {
  return {
    v: DAILY_REPLAY_VERSION,
    day: challenge.day,
    seed: challenge.seed >>> 0,
    frames: game.steps,
    hero: challenge.hero,
    culture: challenge.culture,
    levelId: challenge.levelId,
    hash: stateHash(game),
    log: game.inputLog ? game.inputLog.map((entry) => [entry[0], entry[1]]) : [],
  };
}

// Re-run a log against a challenge and score the resulting sim.
// `challenge` is the server's (or the test's) spec, never the client's waves.
export function replayDaily({ challenge, replay, now = () => performance.now(), deadline = Infinity }) {
  const level = levelById(challenge.levelId);
  if (!level) return { status: 'invalid', error: 'invalid_level' };
  let game;
  try {
    const map = new TerrainField(challenge.mapSeed, level.theme, { size: level.size, nests: level.nests });
    game = new Game(map, 'normal', challenge.hero, null, challenge.levelId, 'daily', {
      rngSeed: challenge.seed,
      culture: challenge.culture,
      daily: challenge,
    });
  } catch (error) {
    return { status: 'invalid', error: 'replay_setup_failed', detail: String(error?.message || error).slice(0, 120) };
  }
  const log = replay.log;
  let cursor = 0;
  try {
    for (let step = 0; step < replay.frames && !game.over; step++) {
      while (cursor < log.length && log[cursor][0] === step) {
        game.exec(log[cursor][1]);
        cursor++;
      }
      game.update(SIM_DT);
      if (step % 240 === 0 && now() > deadline) return { status: 'timeout', steps: game.steps };
    }
  } catch (error) {
    return { status: 'invalid', error: 'replay_crashed', detail: String(error?.message || error).slice(0, 120), steps: game.steps };
  }
  if (!game.over || !game.dailyResult) return { status: 'incomplete', steps: game.steps };
  const hash = stateHash(game);
  if ((replay.hash | 0) !== hash) return { status: 'mismatch', mismatch: ['hash'], hash };
  const standing = { ...game.dailyResult };
  return { status: 'verified', score: dailyScore(standing), standing, hash, challenge };
}

// The acceptance check. The day alone decides the challenge.
export function verifyDailySubmission({ replay, now, deadline }) {
  const parsed = validateDailyReplay(replay);
  if (!parsed.ok) return { status: 'invalid', error: parsed.error, detail: parsed.detail || null };
  const challenge = dailyChallenge(parsed.replay.day);
  const mismatch = [];
  if ((parsed.replay.seed >>> 0) !== (challenge.seed >>> 0)) mismatch.push('seed');
  if (parsed.replay.hero !== challenge.hero) mismatch.push('hero');
  if (parsed.replay.culture !== challenge.culture) mismatch.push('culture');
  if (parsed.replay.levelId !== challenge.levelId) mismatch.push('level');
  if (mismatch.length) return { status: 'mismatch', mismatch };
  // Reject a client that smuggles its own modifier list. The field is optional
  // and ignored; a present list that is not the day's list is a mismatch.
  if (Array.isArray(replay.modifiers)) {
    const claimed = [...replay.modifiers].map(String).sort().join(',');
    const actual = [...challenge.modifiers].sort().join(',');
    if (claimed !== actual || replay.modifiers.some((id) => !MODIFIER_IDS.has(id))) {
      return { status: 'mismatch', mismatch: ['modifiers'] };
    }
  }
  return replayDaily({ challenge, replay: parsed.replay, now, deadline });
}
