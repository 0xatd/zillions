import { autosimBattleAssignment, signBattleAssignment, validateBattleResult, verifyBattleAssignment } from '../src/living-world-battle.js';
import { enforceLivingWorldRateLimit } from './living-world-rate-limit.js';
import { verifyLivingWorldBattleReplay } from '../src/living-world-battle-replay.js';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const send = (res, status, body) => { res.writeHead(status, HEADERS); res.end(JSON.stringify(body)); };
const readBody = async (req) => { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 1048576) throw new Error('body_too_large'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString() || '{}'); };

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
      if (!config.url || !config.anonKey || !config.serviceKey || !config.signingSecret) return send(res, 503, { ok: false, error: 'battle_authority_not_configured' });
      const body = await readBody(req);
      if (body.action === 'launch') {
        const authorization = String(req.headers.authorization || '');
        const user = deps.authenticate ? await deps.authenticate(authorization) : await supabaseUser(authorization, config, fetchImpl);
        if (!user?.id) return send(res, 401, { ok: false, error: 'sign_in_required' });
        await enforceLivingWorldRateLimit({ config, actor: user.id, scope: 'battle:launch', limit: 10, fetchImpl, override: deps.rateLimit });
        const assignment = deps.issue ? await deps.issue(user.id, body) : await rpc(config, 'living_world_issue_battle', { p_actor: user.id, p_engagement: body.engagementId, p_encounter_revision: body.encounterRevision, p_request_id: body.requestId }, fetchImpl);
        if(assignment?.state!=='issued')throw Object.assign(new Error('battle_assignment_unavailable'),{status:409});
        return send(res, 200, { ok: true, assignment, token: signBattleAssignment(assignment, config.signingSecret) });
      }
      if (body.action === 'autosim') {
        const authorization = String(req.headers.authorization || '');
        const user = deps.authenticate ? await deps.authenticate(authorization) : await supabaseUser(authorization, config, fetchImpl);
        if (!user?.id) return send(res, 401, { ok: false, error: 'sign_in_required' });
        await enforceLivingWorldRateLimit({ config, actor: user.id, scope: 'battle:autosim', limit: 4, fetchImpl, override: deps.rateLimit });
        const assignment = deps.issue ? await deps.issue(user.id, body) : await rpc(config, 'living_world_issue_battle', { p_actor: user.id, p_engagement: body.engagementId, p_encounter_revision: body.encounterRevision, p_request_id: body.requestId }, fetchImpl);
        if(assignment?.state!=='issued')throw Object.assign(new Error('battle_assignment_unavailable'),{status:409});
        const result = (deps.autosim || autosimBattleAssignment)(assignment);
        const claim = verifyBattleAssignment(signBattleAssignment(assignment, config.signingSecret), config.signingSecret);
        const committed = deps.commit ? await deps.commit(claim, result) : await rpc(config, 'living_world_commit_battle', { p_assignment: claim.assignmentId, p_nonce: claim.nonce, p_encounter_revision: claim.encounterRevision, p_result: result }, fetchImpl);
        return send(res, 200, { ...committed, result });
      }
      if (body.action === 'result') {
        const authorization = String(req.headers.authorization || '');
        const user = deps.authenticate ? await deps.authenticate(authorization) : await supabaseUser(authorization, config, fetchImpl);
        if (!user?.id) return send(res, 401, { ok: false, error: 'sign_in_required' });
        await enforceLivingWorldRateLimit({ config, actor: user.id, scope: 'battle:replay', limit: 4, windowSeconds: 300, fetchImpl, override: deps.rateLimit });
        const claim = verifyBattleAssignment(body.assignmentToken, config.signingSecret);
        if (claim.requestedBy !== user.id) return send(res, 403, { ok: false, error: 'battle_assignment_owner_required' });
        const assignment = deps.assignment ? await deps.assignment(user.id, claim) : await rpc(config, 'living_world_get_battle_assignment', { p_actor: user.id, p_assignment: claim.assignmentId, p_nonce: claim.nonce }, fetchImpl);
        const result = (deps.verifyReplay || verifyLivingWorldBattleReplay)(assignment, body.replay);
        const committed = deps.commit ? await deps.commit(claim, result) : await rpc(config, 'living_world_commit_battle', { p_assignment: claim.assignmentId, p_nonce: claim.nonce, p_encounter_revision: claim.encounterRevision, p_result: result }, fetchImpl);
        return send(res, 200, { ...committed, result });
      }
      if (body.action === 'authority_result') {
        if(!config.authoritySecret)return send(res,503,{ok:false,error:'trusted_battle_authority_not_configured'});
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
