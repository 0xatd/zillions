const ECONOMY_API = '/api/economy';
const MATCH_RESULT_API = '/api/match-result';
const MATCH_START_API = '/api/match-start';
const ACCOUNT_UPGRADES_API = '/api/account-upgrades';
const DAILY_API = '/api/daily';
const REPLAY_API = '/api/replay';
let accountSession = null;

export function setBackendSession(session) {
  accountSession = session || null;
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

// Signed-in match end. The server validates the report and is the only party
// that grants XP, loot, Alloy and stats; the response is what the client shows.
export async function matchResultRequest(payload = {}) {
  if (!backendEnabled() || !accountSession?.access_token) return null;
  const response = await fetch(MATCH_RESULT_API, {
    method: 'POST',
    headers: accountHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'match_result_failed'), { status: response.status, result });
  return result;
}

// Signed-in match start: a signed, single-use ticket plus the match seed.
// Invite-code co-op hosts ask for a room (manualCoop) and guests present the
// host's join token, so both are credited as co-op.
export async function matchStartRequest(payload = {}) {
  if (!backendEnabled() || !accountSession?.access_token) return null;
  const response = await fetch(MATCH_START_API, {
    method: 'POST',
    headers: accountHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'match_start_failed'), { status: response.status, result });
  return result;
}

// Signed-in account upgrade tree: state, buy, the one-time import of the local
// tree, and the paid Lattice rewire. Costs are the server's, never these.
// Public board. A signed-in caller also receives their own rank.
export async function dailyBoardRequest(day) {
  if (!backendEnabled()) return null;
  const query = day ? `?day=${encodeURIComponent(day)}` : '';
  const response = await fetch(`${DAILY_API}${query}`, {
    headers: accountHeaders({ accept: 'application/json' }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'daily_board_unavailable'), { status: response.status, result });
  return result;
}

// Signed-in score. The server replays the log and stores the score it gets.
export async function dailyScoreRequest(payload = {}) {
  if (!backendEnabled() || !accountSession?.access_token) return null;
  const response = await fetch(DAILY_API, {
    method: 'POST',
    headers: accountHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'daily_submit_failed'), { status: response.status, result });
  return result;
}

function replayTransportEnabled() {
  if (location.protocol === 'file:') return false;
  if (location.hostname.endsWith('github.io')) return false;
  return true;
}

// Public replay document. Guests can read a shared link. A version mismatch
// comes back as a 409 with the recorded simulation version so the viewer can
// explain it instead of playing a desynced run.
export async function replayReadRequest(id) {
  if (!replayTransportEnabled()) return null;
  const response = await fetch(`${REPLAY_API}?id=${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok && response.status !== 409) {
    throw Object.assign(new Error(result?.error || 'replay_unavailable'), { status: response.status, result });
  }
  return result;
}

// Upload the run and return { id, path }. Guests are allowed. The bearer
// token is sent when the player is signed in so the row can be tied to them.
export async function replayPublishRequest(replay) {
  if (!replayTransportEnabled()) return null;
  const response = await fetch(REPLAY_API, {
    method: 'POST',
    headers: accountHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
    body: JSON.stringify({ replay }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'replay_share_failed'), { status: response.status, result });
  return result;
}

export async function accountUpgradeRequest(action, payload = {}) {
  if (!backendEnabled() || !accountSession?.access_token) return null;
  const response = await fetch(ACCOUNT_UPGRADES_API, {
    method: 'POST',
    headers: accountHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'account_upgrade_failed'), { status: response.status, result });
  return result;
}

export async function worldRequest(action, payload = {}) {
  if (!backendEnabled() || !accountSession?.access_token) throw new Error('sign_in_required');
  const response=await fetch('/api/world',{method:'POST',headers:accountHeaders({'content-type':'application/json'}),body:JSON.stringify({action,...payload})});
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result?.ok)throw Object.assign(new Error(result?.error||'world_service_unavailable'),{status:response.status});
  return result;
}
