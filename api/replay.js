// GET  /api/replay?id= — the public replay document.
// POST /api/replay     — store one. Guests may post. Signed-in players are
// recorded too, so a Daily Siege row can point at the same document.
//
// The route does not re-simulate. Daily scores are already replayed by
// /api/daily. A shared replay is checked again in the browser, and a
// simulation mismatch is refused there instead of being played.
//
// No new environment variables. The route uses the existing Supabase URL
// and service role key. Apply supabase/migrations/20261125000200_share_replays.sql
// by hand before this route can store anything.
import { createHash, randomBytes } from 'node:crypto';
import {
  REPLAY_ID, SHARE_LIMITS, decideReplayPublish, shareReplayBytes, validateShareReplay,
} from '../src/share-replay.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const BODY_LIMIT = SHARE_LIMITS.maxBytes + 64 * 1024;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const send = (res, status, body) => { res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify(body)); };
const httpError = (error, status, extra = {}) => Object.assign(new Error(error), { status, ...extra });

export function newReplayId() {
  const bytes = randomBytes(8);
  let id = '';
  for (let i = 0; i < 8; i++) id += ALPHABET[bytes[i] % ALPHABET.length];
  return id;
}

export function replayDigest(replay) {
  return createHash('sha256').update(JSON.stringify(replay)).digest('hex');
}

export function clientIpHash(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || req?.headers?.['x-real-ip'] || '');
  const ip = forwarded.split(',')[0].trim() || 'unknown';
  return createHash('sha256').update(`zillions.replay.ip.v1.${ip}`).digest('hex');
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > BODY_LIMIT) throw httpError('replay_too_large', 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw httpError('invalid_json', 400); }
}

function requestUrl(req) {
  try { return new URL(req.url, 'http://localhost'); }
  catch { return new URL('http://localhost/api/replay'); }
}

async function authenticatedUser(authorization, url, anonKey) {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: anonKey } });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id && UUID.test(user.id) ? user : null;
}

const RPC_ERRORS = {
  rate_limited: 429,
  replay_too_large: 413,
  invalid_replay: 400,
  replay_id_taken: 409,
};

export function supabaseReplayStore({ url, serviceKey, fetchImpl = fetch }) {
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, accept: 'application/json' };
  return {
    async publish(args) {
      let lastError = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetchImpl(`${url}/rest/v1/rpc/publish_replay`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            p_id: args.id || newReplayId(),
            p_actor: args.userId || null,
            p_ip_hash: args.ipHash,
            p_digest: args.digest,
            p_bytes: args.bytes,
            p_board: !!args.board,
            p_body: args.replay,
          }),
        });
        const result = await response.json().catch(() => null);
        if (response.ok) return result;
        const code = String(result?.message || result?.error || 'replay_store_failed');
        if (code === 'replay_id_taken') { lastError = httpError(code, 409); continue; }
        const known = RPC_ERRORS[code];
        throw httpError(known ? code : 'replay_not_configured', known || 503);
      }
      throw lastError || httpError('replay_not_configured', 503);
    },
    async read(id) {
      const response = await fetchImpl(
        `${url}/rest/v1/replays?id=eq.${id}&select=body&limit=1`,
        { headers },
      );
      if (response.status === 404) throw httpError('replay_not_configured', 503);
      if (!response.ok) throw httpError('replay_not_configured', 503);
      const rows = await response.json();
      return rows?.[0]?.body || null;
    },
    async preview(id) {
      const response = await fetchImpl(
        `${url}/rest/v1/replays?id=eq.${id}&select=id,sim_version,mode,seed,hero,won,frames,day&limit=1`,
        { headers },
      );
      if (!response.ok) return null;
      const rows = await response.json();
      return rows?.[0] || null;
    },
  };
}

export async function publishReplayRecord({ url, serviceKey, fetchImpl, userId = null, ipHash = null, replay, board = false }) {
  const store = supabaseReplayStore({ url, serviceKey, fetchImpl });
  return store.publish({
    userId,
    ipHash: ipHash || createHash('sha256').update('zillions.replay.ip.v1.server').digest('hex'),
    digest: replayDigest(replay),
    bytes: shareReplayBytes(replay),
    board,
    replay,
  });
}

export async function processReplayPublish({ userId = null, ipHash, body, store }) {
  if (!ipHash || typeof ipHash !== 'string') throw httpError('invalid_replay', 400);
  const parsed = validateShareReplay(body?.replay ?? body);
  if (!parsed.ok) {
    const status = parsed.error === 'sim_version_mismatch' ? 409
      : parsed.error === 'replay_too_large' ? 413 : 400;
    throw httpError(parsed.error || 'invalid_replay', status, { detail: parsed.detail || null });
  }
  const replay = parsed.replay;
  const bytes = shareReplayBytes(replay);
  const decision = decideReplayPublish({
    bytes,
    recentUser: 0,
    recentIp: 0,
    existingId: null,
  });
  if (!decision.ok && decision.error === 'replay_too_large') throw httpError(decision.error, decision.status);
  // Board rows are published only after /api/daily verifies the score.
  // A client cannot mark a document as the board replay from this route.
  const saved = await store.publish({
    userId: userId && UUID.test(userId) ? userId : null,
    ipHash,
    digest: replayDigest(replay),
    bytes,
    board: false,
    replay,
  });
  if (!saved?.id || !REPLAY_ID.test(saved.id)) throw httpError('replay_store_failed', 503);
  return { ok: true, id: saved.id, duplicate: !!saved.duplicate, path: `/r/${saved.id}` };
}

export async function processReplayRead({ id, store }) {
  if (!REPLAY_ID.test(id || '')) throw httpError('not_found', 404);
  const replay = await store.read(id);
  if (!replay) throw httpError('not_found', 404);
  const parsed = validateShareReplay(replay);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      detail: parsed.detail || null,
      replay: {
        v: replay.v ?? null,
        sim: replay.sim ?? null,
        mode: typeof replay.mode === 'string' ? replay.mode : null,
        seed: Number.isInteger(replay.seed) ? replay.seed : null,
      },
    };
  }
  return { ok: true, replay: parsed.replay };
}

export default async function handler(req, res) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return send(res, 503, { ok: false, error: 'replay_not_configured' });
    const store = supabaseReplayStore({ url, serviceKey });
    if (req.method === 'GET') {
      const id = requestUrl(req).searchParams.get('id');
      const result = await processReplayRead({ id, store });
      return send(res, result.ok ? 200 : 409, result);
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'GET, POST');
      return send(res, 405, { ok: false, error: 'method_not_allowed' });
    }
    const user = anonKey ? await authenticatedUser(String(req.headers.authorization || ''), url, anonKey) : null;
    const body = await parseBody(req);
    const result = await processReplayPublish({
      userId: user?.id || null,
      ipHash: clientIpHash(req),
      body,
      store,
    });
    return send(res, 200, result);
  } catch (error) {
    const status = error?.status || 500;
    const payload = { ok: false, error: status === 500 ? 'replay_error' : error.message };
    if (error?.detail) payload.detail = error.detail;
    return send(res, status, payload);
  }
}
