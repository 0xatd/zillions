// Signed-in match reports that have not been confirmed by the server yet.
// Each keeps its requestId, so a resend can never be granted twice: the server
// returns the original response for a requestId it has already applied.
const KEY = 'zillions_pending_matches';
const MAX_PENDING = 5;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function readPendingMatches(now = Date.now()) {
  const store = storage();
  if (!store) return [];
  try {
    const list = JSON.parse(store.getItem(KEY) || '[]');
    return Array.isArray(list)
      ? list.filter((entry) => entry && entry.requestId && entry.report && now - (entry.queuedAt || 0) < MAX_AGE_MS)
      : [];
  } catch { return []; }
}

function write(list) {
  const store = storage();
  if (!store) return;
  try { store.setItem(KEY, JSON.stringify(list.slice(-MAX_PENDING))); }
  catch {
    // Storage full: keep the reports without their replay logs. A report
    // that needed a replay is then refused, but the others still pay out.
    try { store.setItem(KEY, JSON.stringify(list.slice(-MAX_PENDING).map(({ replay, ...rest }) => rest))); }
    catch { /* storage blocked */ }
  }
}

export function queuePendingMatch(pending, now = Date.now()) {
  const list = readPendingMatches(now).filter((entry) => entry.requestId !== pending.requestId);
  list.push({ ...pending, queuedAt: now });
  write(list);
}

export function dropPendingMatch(requestId) {
  write(readPendingMatches().filter((entry) => entry.requestId !== requestId));
}

// Network failures, server errors, rate limits and a lost compare-and-set race
// are worth resending later; anything else (bad report, duplicate room, wrong
// character) never will be, so it is dropped.
export function retryableMatchError(error) {
  const status = error?.status;
  if (!status || status >= 500 || status === 429) return true;
  return status === 409 && error?.message === 'stale_progress';
}
