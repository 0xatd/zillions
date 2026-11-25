// GET  /api/daily?day=YYYY-MM-DD — today's challenge and the top 50.
// POST /api/daily — sign in, then submit an input log. The score is whatever
// the headless replay produces. A mismatched final sim hash is refused.
//
// Guests can play the challenge in the browser. This route will not store a
// score without a verified Supabase user. No new environment variables: the
// existing Supabase URL, anon key, and service role key are enough.
import {
  acceptableDay, dailyChallenge, dailyKey, publicChallenge, publicHandle, validDay, validateDailyReplay,
  verifyDailySubmission,
} from '../src/daily.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const BODY_LIMIT = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOARD_LIMIT = 50;
const REPLAY_BUDGET_MS = 45000;
const RPC_ERRORS = { sign_in_required: 401, invalid_daily_score: 400 };

const send = (res, status, body) => { res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify(body)); };
const httpError = (error, status, extra = {}) => Object.assign(new Error(error), { status, ...extra });

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > BODY_LIMIT) throw httpError('body_too_large', 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw httpError('invalid_json', 400); }
}

function entry(row, rank, mine) {
  return {
    rank,
    mine: !!mine,
    name: publicHandle(row.display_name),
    score: row.score,
    waves: row.waves,
    cityHp: row.city_hp,
    cityMaxHp: row.city_max_hp,
    seconds: row.duration_seconds,
    won: !!row.won,
    hero: row.hero,
  };
}

export function supabaseDailyStore({ url, serviceKey, fetchImpl = fetch }) {
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, accept: 'application/json' };
  const rows = async (path) => {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, { headers });
    if (!response.ok) throw httpError('daily_board_unavailable', 503);
    return response.json();
  };
  const count = async (path) => {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
    });
    if (!response.ok) throw httpError('daily_board_unavailable', 503);
    const range = response.headers.get('content-range') || '';
    const total = Number(String(range).split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  };
  return {
    async displayName(userId) {
      const found = await rows(`profiles?select=handle,username_set&id=eq.${userId}&limit=1`);
      return found[0]?.username_set ? found[0].handle || '' : '';
    },
    async board({ day, userId }) {
      const top = await rows(
        `daily_scores?select=user_id,display_name,score,waves,city_hp,city_max_hp,duration_seconds,won,hero&day=eq.${day}&order=score.desc,created_at.asc,user_id.asc&limit=${BOARD_LIMIT}`,
      );
      let me = null;
      if (userId && UUID.test(userId)) {
        const mine = await rows(
          `daily_scores?select=display_name,score,waves,city_hp,city_max_hp,duration_seconds,won,hero,created_at&user_id=eq.${userId}&day=eq.${day}&limit=1`,
        );
        if (mine[0]) {
          const better = await count(`daily_scores?select=user_id&day=eq.${day}&score=gt.${mine[0].score}`);
          const created = encodeURIComponent(mine[0].created_at);
          const earlier = await count(
            `daily_scores?select=user_id&day=eq.${day}&score=eq.${mine[0].score}&created_at=lt.${created}`,
          );
          const tied = await count(`daily_scores?select=user_id&day=eq.${day}&score=eq.${mine[0].score}&created_at=eq.${created}&user_id=lt.${userId}`);
          me = entry(mine[0], better + earlier + tied + 1, true);
        }
      }
      return {
        entries: top.map((row, index) => entry(row, index + 1, userId && row.user_id === userId)),
        me,
      };
    },
    async submit(args) {
      const response = await fetchImpl(`${url}/rest/v1/rpc/submit_daily_score`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          p_actor: args.userId,
          p_day: args.day,
          p_seed: args.seed,
          p_score: args.score,
          p_waves: args.waves,
          p_city_hp: args.cityHp,
          p_city_max_hp: args.cityMaxHp,
          p_duration: args.seconds,
          p_won: args.won,
          p_hero: args.hero,
          p_display_name: args.displayName,
          p_sim_hash: args.simHash,
          p_replay: args.replay,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const code = String(result?.message || result?.error || 'daily_submit_failed');
        throw httpError(RPC_ERRORS[code] ? code : 'daily_submit_failed', RPC_ERRORS[code] || 503);
      }
      return result;
    },
  };
}

export async function processDailyBoard({ day, userId = null, store, now = new Date() }) {
  const key = day || dailyKey(now);
  if (!validDay(key)) throw httpError('invalid_day', 400);
  const challenge = dailyChallenge(key);
  const board = await store.board({ day: key, userId });
  return { ok: true, challenge: publicChallenge(challenge), board: board.entries, me: board.me };
}

export async function processDailySubmit({
  userId, body, store, now = new Date(), deadline = Infinity, clock = () => performance.now(),
}) {
  if (!userId || !UUID.test(userId)) throw httpError('sign_in_required', 401);
  const raw = body?.replay ?? body;
  const parsed = validateDailyReplay(raw);
  if (!parsed.ok) throw httpError(parsed.error || 'invalid_replay', 400, { detail: parsed.detail || null });
  if (!acceptableDay(parsed.replay.day, now)) throw httpError('daily_closed', 409);
  const verdict = verifyDailySubmission({ replay: raw, now: clock, deadline });
  if (verdict.status === 'invalid') throw httpError(verdict.error || 'invalid_replay', 400, { detail: verdict.detail || null });
  if (verdict.status === 'timeout') throw httpError('daily_timeout', 503);
  if (verdict.status !== 'verified') {
    throw httpError('daily_unverified', 422, { status: verdict.status, mismatch: verdict.mismatch || null });
  }
  const saved = await store.submit({
    userId,
    day: verdict.challenge.day,
    seed: verdict.challenge.seed >>> 0,
    score: verdict.score,
    waves: verdict.standing.waves,
    cityHp: verdict.standing.cityHp,
    cityMaxHp: verdict.standing.cityMaxHp,
    seconds: verdict.standing.seconds,
    won: !!verdict.standing.won,
    hero: verdict.challenge.hero,
    displayName: publicHandle(await store.displayName(userId)),
    simHash: verdict.hash | 0,
    replay: parsed.replay,
  });
  return {
    ok: true,
    score: saved.score,
    waves: saved.waves,
    cityHp: saved.cityHp,
    cityMaxHp: saved.cityMaxHp,
    seconds: saved.seconds,
    won: !!saved.won,
    rank: saved.rank,
    improved: !!saved.improved,
  };
}

async function authenticatedUser(authorization, url, anonKey) {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: anonKey } });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id && UUID.test(user.id) ? user : null;
}

function requestUrl(req) {
  try { return new URL(req.url, 'http://localhost'); }
  catch { return new URL('http://localhost/api/daily'); }
}

export default async function handler(req, res) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) return send(res, 503, { ok: false, error: 'daily_not_configured' });
    const store = supabaseDailyStore({ url, serviceKey });
    if (req.method === 'GET') {
      const day = requestUrl(req).searchParams.get('day');
      const user = await authenticatedUser(String(req.headers.authorization || ''), url, anonKey);
      const result = await processDailyBoard({ day, userId: user?.id || null, store });
      return send(res, 200, result);
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'GET, POST');
      return send(res, 405, { ok: false, error: 'method_not_allowed' });
    }
    const user = await authenticatedUser(String(req.headers.authorization || ''), url, anonKey);
    if (!user) return send(res, 401, { ok: false, error: 'sign_in_required' });
    const body = await parseBody(req);
    const started = performance.now();
    const result = await processDailySubmit({
      userId: user.id,
      body,
      store,
      deadline: started + REPLAY_BUDGET_MS,
    });
    return send(res, 200, result);
  } catch (error) {
    const status = error?.status || 500;
    const body = { ok: false, error: status === 500 ? 'daily_error' : error.message };
    if (error?.detail) body.detail = error.detail;
    if (error?.mismatch) body.mismatch = error.mismatch;
    return send(res, status, body);
  }
}
