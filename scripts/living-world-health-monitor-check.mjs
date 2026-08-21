import assert from 'node:assert/strict';
import { createLivingWorldHealthMonitorHandler } from '../api/living-world-health-monitor.js';
const response = () => ({ status: 0, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } });
const request = (secret = 'cron') => ({ method: 'GET', headers: { authorization: `Bearer ${secret}` } });
const run = async (handler, req = request()) => { const res = response(); await handler(req, res); return res; };
let res = await run(createLivingWorldHealthMonitorHandler({ cronSecret: 'cron', adminSecret: 'admin', origin: 'https://app.test', fetch: async () => ({ ok: true, async json() { return { status: 'healthy', generatedAt: 'now' }; } }) }));
assert.equal(res.status, 200);
res = await run(createLivingWorldHealthMonitorHandler({ cronSecret: 'cron', adminSecret: 'admin', origin: 'https://app.test', fetch: async () => ({ ok: true, async json() { return { status: 'degraded', runtimeFailures: [{ regionId: 'r' }] }; } }) }));
assert.equal(res.status, 503); assert.equal(res.body.error, 'living_world_alert_delivery_not_configured');
let alertBody;
res = await run(createLivingWorldHealthMonitorHandler({ cronSecret: 'cron', adminSecret: 'admin', origin: 'https://app.test', webhook: 'https://alerts.test', fetch: async (url, options = {}) => {
  if (url === 'https://alerts.test') { alertBody = JSON.parse(options.body); return { ok: true }; }
  return { ok: true, async json() { return { status: 'degraded', runtimeFailures: [{ regionId: 'r' }], runtimeCoverage: { expectedRegions: 72, missingRegions: 1 } }; } };
} }));
assert.equal(res.status, 207); assert.equal(alertBody.event, 'living_world_runtime_degraded');
assert.equal(alertBody.runtimeCoverage.missingRegions, 1);
res = await run(createLivingWorldHealthMonitorHandler({ cronSecret: 'cron', adminSecret: 'admin', origin: 'https://app.test', fetch: async () => ({ ok: true, async json() { return { status: 'healthy' }; } }) }), request('wrong'));
assert.equal(res.status, 401);
console.log('living world health monitor checks passed');
