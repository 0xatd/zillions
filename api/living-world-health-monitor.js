const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const send = (res, status, body) => { res.writeHead(status, HEADERS); res.end(JSON.stringify(body)); };
export function createLivingWorldHealthMonitorHandler(deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  return async function handler(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
      const cronSecret = deps.cronSecret ?? process.env.CRON_SECRET;
      const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-cron-secret'] || '');
      if (!cronSecret || supplied !== cronSecret) return send(res, 401, { ok: false, error: 'monitor_auth_required' });
      const adminSecret = deps.adminSecret ?? process.env.ADMIN_SECRET;
      if (!adminSecret) return send(res, 503, { ok: false, error: 'monitor_operations_auth_not_configured' });
      const origin = deps.origin || process.env.LIVING_WORLD_PUBLIC_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
      if (!origin) return send(res, 503, { ok: false, error: 'monitor_origin_not_configured' });
      const operationsResponse = await fetchImpl(`${origin}/api/living-world-operations`, { headers: { 'x-admin-secret': adminSecret } });
      const operations = await operationsResponse.json().catch(() => null);
      if (!operationsResponse.ok || !operations) throw new Error('monitor_operations_failed');
      if (operations.status === 'healthy') return send(res, 200, { ok: true, status: 'healthy', generatedAt: operations.generatedAt });
      const incident = { event: 'living_world_runtime_degraded', generatedAt: operations.generatedAt, staleLeases: operations.staleLeases || [], stuckCommands: operations.stuckCommands || [], runtimeFailures: operations.runtimeFailures || [] };
      console.error(JSON.stringify(incident));
      const webhook = deps.webhook ?? process.env.LIVING_WORLD_ALERT_WEBHOOK_URL;
      if (!webhook) return send(res, 503, { ok: false, status: 'degraded', error: 'living_world_alert_delivery_not_configured', incident });
      const delivered = await fetchImpl(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(incident) });
      if (!delivered.ok) return send(res, 502, { ok: false, status: 'degraded', error: 'living_world_alert_delivery_failed' });
      return send(res, 207, { ok: false, status: 'degraded', alertDelivered: true, incident });
    } catch (error) { return send(res, 500, { ok: false, error: error.message || 'living_world_monitor_failed' }); }
  };
}
export default createLivingWorldHealthMonitorHandler();
