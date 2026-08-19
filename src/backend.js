const PLAYER_KEY = 'zillions_player_id';
const API = '/api/state';
const LOBBY_API = '/api/lobby';
const GALAXY_API = '/api/galaxy-state';
const ECONOMY_API = '/api/economy';
let accountSession = null;

export function setBackendSession(session) {
  accountSession = session || null;
}

function accountPlayerId() {
  return accountSession?.user?.id || getPlayerId();
}

function accountHeaders(extra = {}) {
  const token = accountSession?.access_token;
  return { ...extra, ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

export function backendEnabled() {
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
  const response = await fetch(`${API}?playerId=${encodeURIComponent(accountPlayerId())}`, {
    headers: accountHeaders({ accept: 'application/json' }),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json();
}

export async function getGalaxyState() {
  if (!backendEnabled()) return null;
  const response = await fetch(GALAXY_API, {
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
    headers: accountHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
    body: JSON.stringify({ playerId: accountPlayerId(), kind, id, data }),
  });
  if (!response.ok) return null;
  return response.json();
}

export async function deleteState(kind, id) {
  if (!backendEnabled()) return null;
  const qs = new URLSearchParams({ playerId: accountPlayerId(), kind, id });
  const response = await fetch(`${API}?${qs}`, { method: 'DELETE', headers: accountHeaders({ accept: 'application/json' }) });
  if (!response.ok) return null;
  return response.json();
}

export async function economyRequest(action, payload = {}) {
  if (!backendEnabled() || !accountSession?.access_token) return null;
  const response = await fetch(ECONOMY_API, {
    method: 'POST',
    headers: accountHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'economy_request_failed'), { status: response.status, result });
  return result;
}

export async function getLobby(mode = 'survival') {
  if (!backendEnabled()) return null;
  const qs = new URLSearchParams({ mode });
  const response = await fetch(`${LOBBY_API}?${qs}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json();
}

async function postLobby(action, payload = {}) {
  if (!backendEnabled()) return null;
  const response = await fetch(LOBBY_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ playerId: getPlayerId(), action, ...payload }),
  });
  if (!response.ok) return null;
  return response.json();
}

export async function joinLobby(profile = {}) {
  return postLobby('join', profile);
}

export async function heartbeatLobby(profile = {}) {
  return postLobby('heartbeat', profile);
}

export async function sendLobbyChat(text, profile = {}) {
  return postLobby('chat', { ...profile, text });
}

export async function leaveLobby(mode = 'survival') {
  return postLobby('leave', { mode });
}
