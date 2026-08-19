import { del, list, put } from '@vercel/blob';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const VALID_KINDS = new Set(['profile', 'settings', 'save', 'game']);
const SINGLETON_KINDS = new Set(['profile', 'settings']);

function send(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function cleanId(value, fallback = 'default') {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96) || fallback;
}

function storagePath(playerId, kind, id) {
  return `players/${cleanId(playerId)}/${kind}/${cleanId(id)}.json`;
}

async function readJsonBlob(blob) {
  const response = await fetch(blob.url, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });
  if (!response.ok) throw new Error(`blob_read_${response.status}`);
  return response.json();
}

async function readPlayerState(playerId) {
  const prefix = `players/${cleanId(playerId)}/`;
  const result = await list({ prefix, limit: 1000 });
  const blobs = result.blobs || [];
  const byPath = new Map(blobs.map((blob) => [blob.pathname, blob]));

  const readData = async (kind, id) => {
    const blob = byPath.get(storagePath(playerId, kind, id));
    if (!blob) return null;
    const envelope = await readJsonBlob(blob);
    return envelope?.data || null;
  };

  const gameBlobs = blobs
    .filter((blob) => blob.pathname.startsWith(`${prefix}game/`) && blob.pathname.endsWith('.json'))
    .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
    .slice(0, 20);

  const games = [];
  for (const blob of gameBlobs) {
    try {
      const envelope = await readJsonBlob(blob);
      if (envelope?.data) games.push(envelope.data);
    } catch {
      // A corrupt game summary should not block profile/save loading.
    }
  }

  return {
    playerId: cleanId(playerId),
    profile: await readData('profile', 'current'),
    settings: await readData('settings', 'current'),
    save: await readData('save', 'latest'),
    games,
  };
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function authenticatedUser(req) {
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('auth_backend_not_configured');
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { authorization, apikey: key },
  });
  if (!response.ok) return null;
  return response.json();
}

export default async function handler(req, res) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return send(res, 503, { ok: false, error: 'blob_backend_not_configured' });
    }
    const user = await authenticatedUser(req);
    if (!user?.id) return send(res, 401, { ok: false, error: 'sign_in_required' });

    if (req.method === 'GET') {
      const url = new URL(req.url, `https://${req.headers.host || 'zillions.local'}`);
      const playerId = url.searchParams.get('playerId');
      if (!playerId) return send(res, 400, { ok: false, error: 'missing_player_id' });
      if (cleanId(playerId) !== cleanId(user.id)) return send(res, 403, { ok: false, error: 'player_mismatch' });
      return send(res, 200, { ok: true, backend: 'vercel-blob', state: await readPlayerState(playerId) });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const playerId = cleanId(body.playerId);
      if (playerId !== cleanId(user.id)) return send(res, 403, { ok: false, error: 'player_mismatch' });
      const kind = cleanId(body.kind);
      if (!VALID_KINDS.has(kind)) return send(res, 400, { ok: false, error: 'invalid_kind' });
      const id = SINGLETON_KINDS.has(kind) ? 'current' : cleanId(body.id, kind === 'save' ? 'latest' : Date.now());
      const data = body.data ?? body.payload ?? {};
      const envelope = {
        schema: 'zillions.state.v1',
        playerId,
        kind,
        id,
        data,
        uploadedAt: new Date().toISOString(),
      };
      const blob = await put(storagePath(playerId, kind, id), JSON.stringify(envelope, null, 2), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json; charset=utf-8',
      });
      return send(res, 200, { ok: true, backend: 'vercel-blob', kind, id, pathname: blob.pathname });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, `https://${req.headers.host || 'zillions.local'}`);
      const playerId = url.searchParams.get('playerId');
      const kind = cleanId(url.searchParams.get('kind'));
      if (!playerId || !VALID_KINDS.has(kind)) return send(res, 400, { ok: false, error: 'bad_delete_request' });
      if (cleanId(playerId) !== cleanId(user.id)) return send(res, 403, { ok: false, error: 'player_mismatch' });
      const id = SINGLETON_KINDS.has(kind) ? 'current' : cleanId(url.searchParams.get('id'), kind === 'save' ? 'latest' : '');
      if (!id) return send(res, 400, { ok: false, error: 'missing_id' });
      await del(storagePath(playerId, kind, id));
      return send(res, 200, { ok: true, backend: 'vercel-blob', deleted: { kind, id } });
    }

    res.setHeader('allow', 'GET, POST, DELETE');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (error) {
    return send(res, 500, { ok: false, error: error?.message || 'state_backend_error' });
  }
}
