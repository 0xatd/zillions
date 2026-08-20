import { signBattleAssignment, validateBattleResult, verifyBattleAssignment } from '../src/living-world-battle.js';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const send = (res, status, body) => { res.writeHead(status, HEADERS); res.end(JSON.stringify(body)); };
const readBody = async (req) => { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error('body_too_large'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString() || '{}'); };

async function supabaseUser(authorization, config, fetchImpl) {
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetchImpl(`${config.url}/auth/v1/user`, { headers: { authorization, apikey: config.anonKey } });
  return response.ok ? response.json() : null;
}
async function rpc(config, name, body, fetchImpl) {
  const response = await fetchImpl(`${config.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.message || `${name}_failed`), { status: response.status === 409 ? 409 : 400 });
  return result;
}

export function createLivingWorldBattleHandler(deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  return async function handler(req, res) {
    try {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
      const config = deps.config || { url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY, signingSecret: process.env.LIVING_WORLD_BATTLE_SIGNING_SECRET, authoritySecret: process.env.LIVING_WORLD_BATTLE_AUTHORITY_SECRET };
      if (!config.url || !config.anonKey || !config.serviceKey || !config.signingSecret || !config.authoritySecret) return send(res, 503, { ok: false, error: 'battle_authority_not_configured' });
      const body = await readBody(req);
      if (body.action === 'launch') {
        const authorization = String(req.headers.authorization || '');
        const user = deps.authenticate ? await deps.authenticate(authorization) : await supabaseUser(authorization, config, fetchImpl);
        if (!user?.id) return send(res, 401, { ok: false, error: 'sign_in_required' });
        const assignment = deps.issue ? await deps.issue(user.id, body) : await rpc(config, 'living_world_issue_battle', { p_actor: user.id, p_engagement: body.engagementId, p_encounter_revision: body.encounterRevision, p_request_id: body.requestId }, fetchImpl);
        return send(res, 200, { ok: true, assignment, token: signBattleAssignment(assignment, config.signingSecret) });
      }
      if (body.action === 'result') {
        const supplied = String(req.headers['x-zillions-battle-authority'] || '');
        const a = Buffer.from(supplied); const b = Buffer.from(config.authoritySecret);
        const { timingSafeEqual } = await import('node:crypto');
        if (a.length !== b.length || !timingSafeEqual(a, b)) return send(res, 401, { ok: false, error: 'battle_authority_required' });
        const claim = verifyBattleAssignment(body.assignmentToken, config.signingSecret);
        const result = validateBattleResult(body.result);
        const committed = deps.commit ? await deps.commit(claim, result) : await rpc(config, 'living_world_commit_battle', { p_assignment: claim.assignmentId, p_nonce: claim.nonce, p_encounter_revision: claim.encounterRevision, p_result: result }, fetchImpl);
        return send(res, 200, committed);
      }
      return send(res, 400, { ok: false, error: 'unsupported_battle_action' });
    } catch (error) { return send(res, error.status || 400, { ok: false, error: error.message || 'battle_authority_error' }); }
  };
}
export default createLivingWorldBattleHandler();
