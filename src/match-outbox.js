// Signed-in match reports that have not been confirmed by the server yet.
// Each keeps its requestId, so a resend can never be granted twice: the server
// returns the original response for a requestId it has already applied.
//
// Reports are scoped to the account that played them. Two accounts can share
// one browser, so every entry carries the originating user id, and only the
// signed-in account's own reports are ever read, resent or dropped. A report
// with no user id cannot be attributed and is never sent.
const KEY = 'zillions_pending_matches';
const MAX_PENDING = 5;            // per account
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

const owned = (entry) => entry && typeof entry.userId === 'string' && entry.userId && entry.requestId && entry.report;

function readAll(now = Date.now()) {
  const store = storage();
  if (!store) return [];
  try {
    const list = JSON.parse(store.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((entry) => owned(entry) && now - (entry.queuedAt || 0) < MAX_AGE_MS) : [];
  } catch { return []; }
}

// Keep the newest MAX_PENDING per account, preserving order.
function capped(list) {
  const counts = new Map();
  const keep = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const n = (counts.get(list[i].userId) || 0) + 1;
    counts.set(list[i].userId, n);
    if (n <= MAX_PENDING) keep.unshift(list[i]);
  }
  return keep;
}

function write(list) {
  const store = storage();
  if (!store) return;
  const kept = capped(list);
  try { store.setItem(KEY, JSON.stringify(kept)); }
  catch {
    // Storage full: keep the reports without their replay logs. A report
    // that needed a replay is then refused, but the others still pay out.
    try { store.setItem(KEY, JSON.stringify(kept.map(({ replay, ...rest }) => rest))); }
    catch { /* storage blocked */ }
  }
}

// The pending reports of ONE account. No user id, no reports.
export function readPendingMatches(userId, now = Date.now()) {
  if (!userId) return [];
  return readAll(now).filter((entry) => entry.userId === userId);
}

// `pending.userId` is required: the account that played the match.
export function queuePendingMatch(pending, now = Date.now()) {
  if (!pending?.userId || !pending.requestId) return false;
  const list = readAll(now).filter((entry) => !(entry.userId === pending.userId && entry.requestId === pending.requestId));
  list.push({ ...pending, queuedAt: now });
  write(list);
  return true;
}

// Drops a report only if it belongs to `userId`.
export function dropPendingMatch(requestId, userId) {
  if (!userId) return;
  write(readAll().filter((entry) => !(entry.userId === userId && entry.requestId === requestId)));
}

// Network failures, server errors (including a replay that did not finish in
// time: 503 replay_retry_later), rate limits, a lost compare-and-set race, a
// concurrent submit of the same request, and a report for an account that is
// not the one signed in right now are worth resending later. Anything else
// (bad report, duplicate room, wrong character) never will be, so it is
// dropped.
export function retryableMatchError(error) {
  const status = error?.status;
  if (!status || status >= 500 || status === 429) return true;
  return status === 409 && (error?.message === 'stale_progress' || error?.message === 'request_in_progress');
}
