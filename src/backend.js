const PLAYER_KEY = 'zillions_player_id';
const API = '/api/state';

function backendEnabled() {
  const { hostname, protocol, search } = location;
  if (protocol === 'file:') return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return search.includes('backend=1');
  if (hostname.endsWith('github.io')) return false;
  return true;
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getPlayerId() {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = makeId();
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    return 'local-player';
  }
}

export async function getRemoteState() {
  if (!backendEnabled()) return null;
  const response = await fetch(`${API}?playerId=${encodeURIComponent(getPlayerId())}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json();
}

export async function putState(kind, id, data) {
  if (!backendEnabled()) return null;
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ playerId: getPlayerId(), kind, id, data }),
  });
  if (!response.ok) return null;
  return response.json();
}

export async function deleteState(kind, id) {
  if (!backendEnabled()) return null;
  const qs = new URLSearchParams({ playerId: getPlayerId(), kind, id });
  const response = await fetch(`${API}?${qs}`, { method: 'DELETE', headers: { accept: 'application/json' } });
  if (!response.ok) return null;
  return response.json();
}
