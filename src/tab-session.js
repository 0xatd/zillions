// One browser profile, many tabs. Each tab keeps its own commander id.
// A duplicated tab copies sessionStorage, so a live heartbeat with a
// different token forces a new id. Closing a tab releases only the lobby
// lease that tab owns.

export const TAB_LIVE_MS = 8000;
const TAB_KEY = 'zillions.tab';
const LIVE_KEY = 'zillions.tabs';
const LEASE_KEY = 'zillions.lobby.lease';

function readJson(storage, key) {
  try { return JSON.parse(storage?.getItem(key) || 'null'); }
  catch { return null; }
}

function writeJson(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readLive(local, at) {
  const rows = readJson(local, LIVE_KEY);
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row && row.id && row.token && at - Number(row.at || 0) <= TAB_LIVE_MS);
}

export function createTabSession({
  session = globalThis.sessionStorage,
  local = globalThis.localStorage,
  now = Date.now,
  randomId = () => globalThis.crypto.randomUUID(),
  token = randomId(),
} = {}) {
  const clock = () => Number(now()) || 0;
  let id = '';
  try { id = session?.getItem(TAB_KEY) || ''; } catch { id = ''; }
  const openedAt = clock();
  const taken = readLive(local, openedAt).some((row) => row.id === id && row.token !== token);
  if (!id || taken) {
    id = randomId();
    try { session?.setItem(TAB_KEY, id); } catch { /* private mode */ }
  }

  const publish = (atNow) => {
    const rows = readLive(local, atNow).filter((row) => row.token !== token);
    rows.push({ id, token, at: atNow });
    writeJson(local, LIVE_KEY, rows);
  };
  publish(openedAt);

  // A dying page can still receive one heartbeat after release. That write
  // would make the reloaded tab look like a duplicate and mint a new id,
  // which drops a guest out of a siege they were already seated in.
  let released = false;
  return {
    id,
    token,
    touch(atNow = clock()) { if (!released) publish(atNow); },
    release(atNow = clock()) {
      released = true;
      writeJson(local, LIVE_KEY, readLive(local, atNow).filter((row) => row.token !== token));
      const lease = readJson(local, LEASE_KEY);
      if (lease?.token === token) {
        try { local?.removeItem(LEASE_KEY); } catch { /* ignore */ }
      }
    },
    claimLease(lease = {}, atNow = clock()) {
      const current = readJson(local, LEASE_KEY);
      const ownerLive = current && readLive(local, atNow).some((row) => row.token === current.token && row.id === current.tabId);
      if (current && current.token !== token && ownerLive && atNow - Number(current.at || 0) <= TAB_LIVE_MS) {
        return { ok: false, owner: current };
      }
      const next = { ...lease, tabId: id, token, at: atNow };
      writeJson(local, LEASE_KEY, next);
      publish(atNow);
      return { ok: true, lease: next };
    },
    ownsLease() {
      const current = readJson(local, LEASE_KEY);
      return !!(current && current.token === token && current.tabId === id);
    },
    lease(atNow = clock()) {
      const current = readJson(local, LEASE_KEY);
      if (!current || atNow - Number(current.at || 0) > TAB_LIVE_MS) return null;
      return current;
    },
    refreshLease(atNow = clock()) {
      const current = readJson(local, LEASE_KEY);
      if (!current || current.token !== token) return null;
      const next = { ...current, at: atNow };
      writeJson(local, LEASE_KEY, next);
      publish(atNow);
      return next;
    },
  };
}
