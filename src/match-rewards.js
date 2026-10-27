// Match rewards — the ONE place that decides what a finished siege is worth.
//
// This module is pure (no I/O, no DOM, no clock) so the server endpoint
// (api/match-result.js) and the behaviour tests (scripts/match-result-check.mjs)
// run exactly the same arithmetic. Signed-in players never apply these numbers
// locally: the client sends a match report, the server validates it, computes
// the rewards here, and writes them through apply_match_result().
//
// What the server can and cannot prove today:
//   - Proven: level unlocks (against server campaign progress), every rolled
//     loot key (re-derived from the level's own map seed), item level, quest
//     outcomes (re-evaluated here from the reported counters), boss drops,
//     XP / Alloy formulas and caps, one reward per co-op room per player.
//   - Bounded but still client-reported: kills, coins, nests, buildings,
//     duration. They are clamped to physically plausible rates; a full
//     deterministic replay of the lockstep command log is the follow-up that
//     would turn these into proofs.
import {
  BOSS_DROPS, DIFFICULTY, FIELD_LOOT, ITEMS, LEVELS, PACK_SLOTS, THREAT_PERIOD,
  isLabyrinthLevel, itemInfo, levelById,
} from './config.js';
import { ITEM_BASES, hashString, parseItemKey, resolveItem, worldItemLevel } from './items.js';
import { vendorSellPrice } from './vendor.js';

import { MATCH_REPORT_VERSION } from './match-report.js';

export { MATCH_REPORT_VERSION };
export const MAX_CHARACTER_LEVEL = 100;
export const MATCH_MODES = ['campaign', 'survival', 'labyrinth'];

// Plausibility envelope. Generous on purpose: a legitimate run must never be
// rejected; these only stop impossible claims.
export const MATCH_LIMITS = Object.freeze({
  minDurationSeconds: 20,
  maxDurationSeconds: 4 * 60 * 60,
  killsPerSecond: 25, killSlack: 50,
  coinsPerSecond: 60, coinSlack: 1000,
  builtPerSecond: 2, builtSlack: 40,
  startingBuildings: 200,
  maxNodes: 64,
  maxHeld: 32,
  threatSlack: 2,
  maxLootSerial: 256,
  maxPack: PACK_SLOTS,
  maxXpPerMatch: 20000,
  maxAlloyPerMatch: 2500,
  // Enforced in SQL (apply_match_result) because they need the clock and the
  // previous report; mirrored here so the API and docs share one number.
  maxSimSpeed: 2,
  minReportIntervalSeconds: 15,
  durationClockSlackSeconds: 120,
});

export const ALLOY_EARN_RATE = 0.02;
export const SCORE_WEIGHTS = Object.freeze({
  kill: 1, coin: 0.5, nest: 150, node: 40, built: 5, lost: -10, threat: 25,
  boss: 200, win: 1.5, loss: 0.6,
});

const AUTHORED_FINDS = new Set([...FIELD_LOOT.common, ...FIELD_LOOT.rare]);
const int = (value) => (Number.isFinite(Number(value)) ? Math.floor(Number(value)) : NaN);
const fail = (error, detail = null) => ({ ok: false, error, ...(detail ? { detail } : {}) });

// ---------------------------------------------------------------- experience

export function xpToNextLevel(level) {
  const n = Math.max(1, Math.min(MAX_CHARACTER_LEVEL - 1, Number(level) || 1));
  return 120 + n * 55 + Math.floor(n ** 1.55 * 18);
}

export function matchExperience(report) {
  if (report.mode !== 'campaign') return 0;
  const xp = Math.max(25, Math.floor(report.kills * 0.35))
    + report.nests * 30
    + (report.won ? 180 + report.levelId * 25 : 0);
  return Math.min(MATCH_LIMITS.maxXpPerMatch, xp);
}

export function applyExperience(progress, amount) {
  let level = Math.max(1, Math.min(MAX_CHARACTER_LEVEL, int(progress?.level) || 1));
  let xp = Math.max(0, int(progress?.xp) || 0) + Math.max(0, int(amount) || 0);
  const levels = [];
  while (level < MAX_CHARACTER_LEVEL && xp >= xpToNextLevel(level)) {
    xp -= xpToNextLevel(level);
    level += 1;
    levels.push(level);
  }
  if (level >= MAX_CHARACTER_LEVEL) xp = 0;
  return { level, xp, levels };
}

// ---------------------------------------------------------------- score/alloy

export function matchScore(report) {
  const level = levelById(report.levelId);
  const mult = Number.isFinite(level?.mult) ? level.mult : 1;
  const W = SCORE_WEIGHTS;
  const raw = report.kills * W.kill + report.coins * W.coin + report.nests * W.nest
    + report.nodes * W.node + report.built * W.built + report.lost * W.lost
    + Math.max(0, report.threatLevel - 1) * W.threat
    + (report.bossKillT != null ? W.boss : 0);
  return Math.max(0, Math.round(raw * mult * (report.won ? W.win : W.loss)));
}

export function matchAlloy(report) {
  return Math.min(MATCH_LIMITS.maxAlloyPerMatch, Math.max(0, Math.round(matchScore(report) * ALLOY_EARN_RATE)));
}

// ---------------------------------------------------------------- loot proofs

// A rolled key is `${base}:${hash(seed)}:${ilvl}:${rarity}` where the seed is
// `${level.seed}:${levelId}:${serial}` (see Game._scatterLoot). The server
// owns level.seed, so it can re-derive the hash instead of trusting the key.
export function verifyLootKey(key, { levelId, difficulty = 'normal' } = {}) {
  if (typeof key !== 'string' || key.length > 96) return false;
  if (AUTHORED_FINDS.has(key)) return true;
  const parsed = parseItemKey(key);
  if (!parsed) return false;
  const [, , ilvlRaw, rarityRaw] = key.split(':');
  const level = levelById(levelId);
  if (!level || !Number.isFinite(level.seed)) return false;
  const ilvl = worldItemLevel(levelId, level, DIFFICULTY[difficulty] || DIFFICULTY.normal);
  if (String(ilvl) !== ilvlRaw || parsed.ilvl !== ilvl) return false;
  if (!['1', '2', '3'].includes(rarityRaw)) return false;
  if (!ITEM_BASES[parsed.baseKey] || ITEM_BASES[parsed.baseKey].ilvl > ilvl) return false;
  for (let serial = 0; serial < MATCH_LIMITS.maxLootSerial; serial++) {
    if (hashString(`${level.seed}:${levelId}:${serial}`) === parsed.seed) return true;
  }
  return false;
}

// ---------------------------------------------------------------- validation

export function maxUnlockedCampaignLevel(campaignCleared = 0) {
  return Math.max(1, (int(campaignCleared) || 0) + 1);
}

// Turns an untrusted JSON body into a clean, bounded report or a refusal.
export function validateMatchReport(raw, { campaignCleared = 0 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid_report');
  if (raw.version !== MATCH_REPORT_VERSION) return fail('unsupported_report_version');
  const mode = String(raw.mode || '');
  if (!MATCH_MODES.includes(mode)) return fail('invalid_mode');
  const difficulty = String(raw.difficulty || 'normal');
  if (!Object.prototype.hasOwnProperty.call(DIFFICULTY, difficulty)) return fail('invalid_difficulty');
  const levelId = int(raw.levelId);
  if (!Number.isInteger(levelId) || levelId < 1) return fail('invalid_level');
  if (mode === 'labyrinth') {
    if (!isLabyrinthLevel(levelId)) return fail('invalid_level');
  } else {
    if (isLabyrinthLevel(levelId)) return fail('invalid_level');
    const ceiling = Math.max(mode === 'survival' ? LEVELS.length : 1, maxUnlockedCampaignLevel(campaignCleared));
    if (levelId > ceiling) return fail('level_locked');
  }
  const level = levelById(levelId);
  if (!level) return fail('invalid_level');

  const L = MATCH_LIMITS;
  const durationSeconds = int(raw.durationSeconds);
  if (!(durationSeconds >= L.minDurationSeconds && durationSeconds <= L.maxDurationSeconds)) return fail('implausible_duration');
  const n = (key, max) => {
    const value = int(raw[key] ?? 0);
    return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
  };
  const report = {
    version: MATCH_REPORT_VERSION, mode, difficulty, levelId, durationSeconds,
    // Survival has no victory screen; it only ends when the line breaks.
    won: mode !== 'survival' && raw.won === true,
    threatLevel: n('threatLevel', Math.floor(durationSeconds / THREAT_PERIOD) + 1 + L.threatSlack),
    kills: n('kills', durationSeconds * L.killsPerSecond + L.killSlack),
    coins: n('coins', durationSeconds * L.coinsPerSecond + L.coinSlack),
    nests: n('nests', Math.max(0, level.nests | 0)),
    nodes: n('nodes', L.maxNodes),
    built: n('built', durationSeconds * L.builtPerSecond + L.builtSlack),
    bestHeld: n('bestHeld', L.maxHeld),
    heroDeaths: n('heroDeaths', durationSeconds),
    hqTier: n('hqTier', 3),
    hero: typeof raw.hero === 'string' ? raw.hero.replace(/[^a-z0-9_]/gi, '').slice(0, 32) || null : null,
  };
  for (const key of ['threatLevel', 'kills', 'coins', 'nests', 'nodes', 'built', 'bestHeld', 'heroDeaths', 'hqTier']) {
    if (report[key] === null) return fail('implausible_report', key);
  }
  report.lost = n('lost', report.built + L.startingBuildings);
  report.standingBuildings = n('standingBuildings', report.built + L.startingBuildings);
  if (report.lost === null) return fail('implausible_report', 'lost');
  if (report.standingBuildings === null) return fail('implausible_report', 'standingBuildings');
  if (raw.bossKillT == null) report.bossKillT = null;
  else {
    const t = Number(raw.bossKillT);
    if (!Number.isFinite(t) || t < 0 || t > durationSeconds) return fail('implausible_report', 'bossKillT');
    report.bossKillT = Math.round(t * 10) / 10;
  }

  const pack = Array.isArray(raw.pack) ? raw.pack : [];
  if (pack.length > L.maxPack) return fail('implausible_report', 'pack');
  const unique = [...new Set(pack)];
  for (const key of unique) {
    if (!verifyLootKey(key, { levelId, difficulty })) return fail('unverifiable_loot', String(key).slice(0, 96));
  }
  report.pack = unique;
  return { ok: true, report };
}

// ---------------------------------------------------------------- quests

// Quest checks are authored as functions of a Game. Rebuild the slice of a
// Game they read from the validated counters and run the real checks.
export function questView(report) {
  return {
    won: report.won, mode: report.mode, levelId: report.levelId, threatLevel: report.threatLevel,
    stats: {
      kills: report.kills, coins: report.coins, nests: report.nests, nodes: report.nodes,
      built: report.built, lost: report.lost, bestHeld: report.bestHeld,
      heroDeaths: report.heroDeaths, bossKillT: report.bossKillT,
    },
    plots: [{ kind: 'hq', tier: report.hqTier }],
    buildings: Array.from({ length: report.standingBuildings }, () => ({ alive: true, kind: 'tower' })),
  };
}

export function evaluateQuests(report) {
  if (report.mode !== 'campaign') return [];
  const quests = levelById(report.levelId)?.quests || [];
  const view = questView(report);
  return quests.map((q) => {
    let done = false;
    try { done = report.won && !!q.check(view); } catch { done = false; }
    return { id: q.id, name: q.name, reward: q.reward, done };
  });
}

// ---------------------------------------------------------------- rewards

// `context` is the server's own record: the character's level/xp and the
// account's quest/relic ledger. Nothing in it comes from the client.
export function computeMatchRewards(report, context = {}) {
  const questsDone = context.questsDone && typeof context.questsDone === 'object' ? context.questsDone : {};
  const ownedRelics = new Set(Array.isArray(context.relics) ? context.relics : []);
  const xpGained = matchExperience(report);
  const progress = applyExperience(context.character || {}, xpGained);

  const items = report.pack.map((key) => ({ key, source: 'field' }));
  const relics = [];
  const questsCompleted = [];
  const quests = evaluateQuests(report);
  for (const quest of quests) {
    if (!quest.done || questsDone[quest.id]) continue;
    questsCompleted.push(quest.id);
    const def = ITEMS[quest.reward];
    if (!def) continue;
    if (def.kind === 'relic') {
      if (!ownedRelics.has(quest.reward)) { ownedRelics.add(quest.reward); relics.push(quest.reward); }
    } else items.push({ key: quest.reward, source: 'quest', questId: quest.id });
  }
  if (report.mode === 'campaign' && report.won && BOSS_DROPS[report.levelId]) {
    items.push({ key: BOSS_DROPS[report.levelId], source: 'boss' });
  }
  const seen = new Set();
  const grantedItems = items.filter((item) => {
    if (!itemInfo(item.key) || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });

  const lost = !report.won;
  return {
    xpGained,
    level: progress.level,
    xp: progress.xp,
    levelsGained: progress.levels,
    items: grantedItems,
    relics,
    questsCompleted,
    quests,
    alloy: matchAlloy(report),
    score: matchScore(report),
    stats: {
      gamesPlayed: 1,
      wins: report.won ? 1 : 0,
      losses: lost ? 1 : 0,
      kills: report.kills,
      buildingsBuilt: report.built,
      bestDay: report.threatLevel,
      bestWave: report.mode === 'survival' ? report.threatLevel : 0,
      favoriteHero: report.hero,
    },
    progress: {
      campaignCleared: report.mode === 'campaign' && report.won ? report.levelId : 0,
      bestSurvival: report.mode === 'survival' ? report.threatLevel : 0,
      labyrinthClear: report.mode === 'labyrinth' && report.won ? report.levelId : null,
    },
  };
}

// ---------------------------------------------------------------- persistence

// The row shape item_instances stores. Shared by the vendor and match rewards
// so a looted item and a bought item are indistinguishable once owned.
export function itemPayload(key, provenance = null) {
  const item = itemInfo(key);
  if (!item) return null;
  const rolled = resolveItem(key);
  const payload = {
    legacy_key: key,
    base_id: rolled?.baseKey || key,
    item_level: Math.max(1, Math.min(100, Number(item.ilvl) || 1)),
    // Authored "signature" items are rarity 4 in the client table; the
    // database stores 1..3, so they are recorded at the top tier.
    rarity: Math.max(1, Math.min(3, Number(item.rarity) || 1)),
    affixes: rolled?.affixes || [],
    sockets: [],
    binding: 'account',
    slot_pool: item.slot || rolled?.slot || 'unknown',
    economy_data: { sell_price: vendorSellPrice(key) },
  };
  if (provenance) payload.provenance = provenance;
  return payload;
}
