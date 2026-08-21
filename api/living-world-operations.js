import { summarizeWorldOperations } from '../src/living-world-operations.js';
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const send = (res, status, body) => { res.writeHead(status, HEADERS); res.end(JSON.stringify(body)); };
async function rows(config, path, fetchImpl) { const response = await fetchImpl(`${config.url}/rest/v1/${path}`, { headers: { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey } }); if (!response.ok) throw Object.assign(new Error('operations_projection_failed'), { status: 502 }); return response.json(); }
async function count(config, table, column, query, fetchImpl) { const response = await fetchImpl(`${config.url}/rest/v1/${table}?select=${column}&${query}`, { method: 'HEAD', headers: { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, prefer: 'count=exact' } }); if (!response.ok) throw Object.assign(new Error('operations_count_failed'), { status: 502 }); return Number(String(response.headers.get('content-range') || '').split('/')[1]) || 0; }
export function createLivingWorldOperationsHandler(deps = {}) { const fetchImpl = deps.fetch || globalThis.fetch; return async function handler(req, res) { try {
  if (req.method !== 'GET') { res.setHeader('allow', 'GET'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }
  const secret = deps.secret ?? process.env.ADMIN_SECRET; if (!secret) return send(res, 503, { ok: false, error: 'operations_auth_not_configured' });
  if (String(req.headers['x-admin-secret'] || '') !== secret) return send(res, 401, { ok: false, error: 'operations_auth_required' });
  const config = deps.config || { url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
  if (!config.url || !config.serviceKey) return send(res, 503, { ok: false, error: 'living_world_backend_not_configured' });
  const snapshot = deps.snapshot ? await deps.snapshot() : await (async () => {
    const since = encodeURIComponent(new Date(Date.now() - 15 * 60_000).toISOString());
    const [leases, commands, tutorials, runtimeHealth, openEncounters, activeSieges, recentEvents] = await Promise.all([
      rows(config, 'world_region_worker_leases?select=region_id,worker_id,lease_until,heartbeat_at', fetchImpl),
      rows(config, 'world_commands?select=shard_id,request_id,command_type,created_at,completed_at&completed_at=is.null&order=created_at.asc&limit=100', fetchImpl),
      rows(config, 'world_tutorial_progress?select=movement_complete,town_complete,recruitment_complete,trade_complete,battle_complete,completed_at,entered_world_at', fetchImpl),
      rows(config, `world_region_runtime_health?select=region_id,world_tick,worker_id,duration_ms,success,error_code,worker_lag,command_backlog,action_saturated,threshold_breached,recorded_at&recorded_at=gte.${since}&order=recorded_at.desc&limit=500`, fetchImpl),
      count(config, 'world_encounters', 'id', 'state=in.(choosing,negotiating,battle,awaiting_allies,rearguard)', fetchImpl),
      count(config, 'world_sieges', 'id', 'status=in.(preparing,active,breached)', fetchImpl),
      count(config, 'world_events', 'event_id', `created_at=gte.${since}`, fetchImpl),
    ]);
    return { leases, commands, tutorials, runtimeHealth, openEncounters, activeSieges, recentEvents };
  })();
  return send(res, 200, { ok: true, generatedAt: new Date().toISOString(), ...summarizeWorldOperations(snapshot) });
} catch (error) { return send(res, error.status || 500, { ok: false, error: error.message || 'operations_request_failed' }); } }; }
export default createLivingWorldOperationsHandler();
