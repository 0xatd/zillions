// POST /api/account-upgrades — the signed-in account upgrade tree.
//
// Body: { action, requestId?, nodeId?, nodes?, characterId? }
//   state           { owned, imported, balance }            (no requestId)
//   buy             nodeId                       debit the catalog cost
//   import_local    nodes: [...local node ids]   once per account, capped
//   rewire_lattice  characterId                  45 Alloy per Lattice point
//
// Costs, prerequisites and the import cap live in the database
// (account_upgrade_catalog, account_upgrade_mutate()); this route only checks
// shapes and the bearer token. The user id always comes from the token.
import { META_NODES_BY_ID } from '../src/meta.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const BODY_LIMIT = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UPGRADE_ACTIONS = ['state', 'buy', 'import_local', 'rewire_lattice'];
const RPC_ERRORS = {
  unknown_upgrade: 400, already_owned: 409, upgrade_locked: 409, insufficient_funds: 409,
  already_imported: 409, invalid_import: 400, character_not_found: 404, nothing_to_rewire: 409,
  idempotency_conflict: 409, request_in_progress: 409, invalid_request: 400, invalid_action: 400,
};

const send = (res, status, body) => { res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify(body)); };
const cleanText = (value, max = 64) => String(value || '').replace(/[^a-zA-Z0-9_:\-.]/g, '').slice(0, max);
const httpError = (error, status) => Object.assign(new Error(error), { status });

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > BODY_LIMIT) throw httpError('body_too_large', 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw httpError('invalid_json', 400); }
}

export function supabaseUpgradeStore({ url, serviceKey, fetchImpl = fetch }) {
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': 'application/json' };
  const rest = async (path) => {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, { headers });
    if (!response.ok) throw httpError('account_upgrades_unavailable', 503);
    return response.json();
  };
  return {
    async state(userId) {
      const [owned, imports, wallet] = await Promise.all([
        rest(`account_upgrades?select=node_id,source&user_id=eq.${userId}`),
        rest(`account_upgrade_imports?select=imported_at&user_id=eq.${userId}&limit=1`),
        rest(`player_wallets?select=salvage_alloy,revision&user_id=eq.${userId}&limit=1`),
      ]);
      return {
        owned: owned.map((row) => row.node_id).sort(),
        imported: !!imports[0],
        wallet: { balance: Number(wallet[0]?.salvage_alloy || 0), revision: Number(wallet[0]?.revision || 0) },
      };
    },
    async mutate(args) {
      const response = await fetchImpl(`${url}/rest/v1/rpc/account_upgrade_mutate`, { method: 'POST', headers, body: JSON.stringify(args) });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const code = String(result?.message || 'account_upgrade_failed');
        throw httpError(RPC_ERRORS[code] ? code : 'account_upgrade_failed', RPC_ERRORS[code] || 503);
      }
      return result;
    },
  };
}

export async function processAccountUpgrade({ userId, body, store }) {
  const action = String(body?.action || '');
  if (!UPGRADE_ACTIONS.includes(action)) throw httpError('invalid_action', 400);
  if (action === 'state') return { ok: true, ...(await store.state(userId)) };
  const requestId = cleanText(body?.requestId, 64);
  if (requestId.length < 8) throw httpError('missing_request_id', 400);
  let payload;
  if (action === 'buy') {
    const nodeId = cleanText(body?.nodeId, 48);
    if (!META_NODES_BY_ID.has(nodeId)) throw httpError('unknown_upgrade', 400);
    payload = { node_id: nodeId };
  } else if (action === 'import_local') {
    if (!Array.isArray(body?.nodes) || body.nodes.length > 64) throw httpError('invalid_import', 400);
    const nodes = [...new Set(body.nodes.map((id) => cleanText(id, 48)).filter((id) => META_NODES_BY_ID.has(id)))].sort();
    payload = { nodes };
  } else {
    const characterId = cleanText(body?.characterId, 96);
    if (!characterId) throw httpError('missing_character', 400);
    payload = { client_character_id: characterId };
  }
  return store.mutate({ p_actor: userId, p_request_id: requestId, p_action: action, p_payload: payload });
}

async function authenticatedUser(authorization, url, anonKey) {
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: anonKey } });
  return response.ok ? response.json() : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) return send(res, 503, { ok: false, error: 'account_upgrades_not_configured' });
    const user = await authenticatedUser(String(req.headers.authorization || ''), url, anonKey);
    if (!user?.id || !UUID.test(user.id)) return send(res, 401, { ok: false, error: 'sign_in_required' });
    const body = await parseBody(req);
    return send(res, 200, await processAccountUpgrade({ userId: user.id, body, store: supabaseUpgradeStore({ url, serviceKey }) }));
  } catch (error) {
    const status = error?.status || 500;
    return send(res, status, { ok: false, error: status === 500 ? 'account_upgrade_error' : error.message });
  }
}
