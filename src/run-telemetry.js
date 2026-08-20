const STORAGE_KEY = 'zillions_run_telemetry_v1';
const MAX_RUNS = 40;

const finite = (value) => Number.isFinite(value) ? value : 0;
const rounded = (value) => Math.round(finite(value) * 100) / 100;
const sortedEntries = (value = {}) => Object.fromEntries(
  Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
);

export function runTelemetry(game) {
  const stats = game?.stats || {};
  const heroes = (game?.heroes || []).map((hero) => ({
    id: hero.key,
    level: finite(hero.level),
    activeSet: finite(hero.activeSet),
    equipment: sortedEntries(hero.equipment),
    upgrades: sortedEntries(hero.upgrades),
  }));
  const army = {};
  for (const unit of game?.units || []) {
    if (unit.hero || unit.dead) continue;
    army[unit.key] = (army[unit.key] || 0) + 1;
  }
  return {
    schema: 'zillions.run.v1',
    outcome: game?.won ? 'victory' : 'defeat',
    failureCause: game?.won ? null : (game?.defeatCause || 'unknown'),
    mode: game?.mode || 'campaign',
    levelId: finite(game?.levelId),
    levelName: game?.level?.name || 'Unknown',
    difficulty: game?.diffKey || 'normal',
    elapsedSeconds: rounded(game?.time),
    damageTaken: sortedEntries(stats.damageTaken),
    resources: {
      earned: rounded(stats.coins),
      spent: rounded(stats.spent),
      repaired: rounded(stats.repaired),
      remaining: rounded(game?.gold),
    },
    structures: {
      built: finite(stats.built),
      lost: finite(stats.lost),
      lostByKind: sortedEntries(stats.lostByKind),
    },
    army: {
      final: sortedEntries(army),
      peak: sortedEntries(stats.armyPeak),
    },
    objectives: {
      nestsRazed: finite(stats.nests),
      nestsTotal: (game?.nests || []).filter((nest) => !nest.offMap).length,
      nodesTaken: finite(stats.nodes),
      bestNodesHeld: finite(stats.bestHeld),
      bossKilled: stats.bossKillT != null,
    },
    heroes,
  };
}

// Telemetry is diagnostic only. Blocked storage, quota errors, or malformed
// old data must never stop a match from ending or a profile from saving.
export function persistRunTelemetry(game, storage = globalThis.localStorage) {
  const record = runTelemetry(game);
  if (!storage) return { saved: false, record };
  try {
    const existing = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    const runs = Array.isArray(existing) ? existing : [];
    storage.setItem(STORAGE_KEY, JSON.stringify([...runs, record].slice(-MAX_RUNS)));
    return { saved: true, record };
  } catch (error) {
    try { console.warn('run telemetry persistence failed', error); } catch { /* console can be unavailable in tests */ }
    return { saved: false, record };
  }
}

export const RUN_TELEMETRY_STORAGE_KEY = STORAGE_KEY;
