import { del, list, put } from '@vercel/blob';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const ACTIVE_MS = 60_000;
const MESSAGE_LIMIT = 50;
const VALID_MODES = new Set(['survival', 'smoke']);
const VALID_HEROES = new Set(['alexander', 'scott', 'danny']);
const VALID_RULES = new Set(['survival-plots']);

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

function cleanText(value, fallback = '') {
  const clean = String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, 220);
}

function cleanName(value) {
  return cleanText(value, 'Commander').slice(0, 24) || 'Commander';
}

function cleanMode(value) {
  const mode = cleanId(value, 'survival');
  return VALID_MODES.has(mode) ? mode : null;
}

function cleanHero(value) {
  const hero = cleanId(value, 'alexander');
  return VALID_HEROES.has(hero) ? hero : 'alexander';
}

function cleanRules(value) {
  const rules = cleanId(value, 'survival-plots');
  return VALID_RULES.has(rules) ? rules : 'survival-plots';
}

function playerPath(mode, playerId) {
  return `lobbies/${mode}/players/${cleanId(playerId)}.json`;
}

function chatPath(mode, playerId) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `lobbies/${mode}/chat/${stamp}-${cleanId(playerId).slice(0, 24)}-${rand}.json`;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readJsonBlob(blob) {
  const response = await fetch(blob.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`blob_read_${response.status}`);
  return response.json();
}

async function readLobby(mode) {
  const now = Date.now();
  const playersPrefix = `lobbies/${mode}/players/`;
  const playersResult = await list({ prefix: playersPrefix, limit: 1000 });
  const stalePaths = [];
  const players = [];

  for (const blob of playersResult.blobs || []) {
    try {
      const player = await readJsonBlob(blob);
      const expiresAt = Date.parse(player.expiresAt || player.updatedAt || 0);
      if (!expiresAt || expiresAt < now) {
        stalePaths.push(blob.pathname);
      } else {
        players.push({
          playerId: cleanId(player.playerId),
          name: cleanName(player.name),
          hero: cleanHero(player.hero),
          rules: cleanRules(player.rules),
          status: cleanText(player.status, 'in-lobby').slice(0, 80),
          updatedAt: player.updatedAt,
        });
      }
    } catch {
      stalePaths.push(blob.pathname);
    }
  }

  if (stalePaths.length) {
    await Promise.allSettled(stalePaths.map((pathname) => del(pathname)));
  }

  players.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  const chatPrefix = `lobbies/${mode}/chat/`;
  const chatResult = await list({ prefix: chatPrefix, limit: 1000 });
  const chatBlobs = (chatResult.blobs || [])
    .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
    .slice(0, MESSAGE_LIMIT);
  const messages = [];
  for (const blob of chatBlobs) {
    try {
      const message = await readJsonBlob(blob);
      messages.push({
        id: cleanId(message.id, blob.pathname),
        playerId: cleanId(message.playerId),
        name: cleanName(message.name),
        hero: cleanHero(message.hero),
        text: cleanText(message.text),
        createdAt: message.createdAt,
      });
    } catch {
      // Bad chat records should not block the lobby.
    }
  }
  messages.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  return {
    schema: 'zillions.lobby.v1',
    mode,
    activeCount: players.length,
    players,
    messages,
    refreshedAt: new Date(now).toISOString(),
  };
}

async function upsertPresence({ mode, playerId, name, hero, rules, status = 'in-lobby' }) {
  const now = Date.now();
  const presence = {
    schema: 'zillions.lobby_presence.v1',
    mode,
    playerId: cleanId(playerId),
    name: cleanName(name),
    hero: cleanHero(hero),
    rules: cleanRules(rules),
    status: cleanText(status, 'in-lobby').slice(0, 80),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ACTIVE_MS).toISOString(),
  };
  await put(playerPath(mode, playerId), JSON.stringify(presence, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  return presence;
}

async function writeChat({ mode, playerId, name, hero, text }) {
  const createdAt = new Date().toISOString();
  const message = {
    schema: 'zillions.lobby_chat.v1',
    id: `${Date.now().toString(36)}-${cleanId(playerId).slice(0, 16)}`,
    mode,
    playerId: cleanId(playerId),
    name: cleanName(name),
    hero: cleanHero(hero),
    text: cleanText(text),
    createdAt,
  };
  await put(chatPath(mode, playerId), JSON.stringify(message, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/json; charset=utf-8',
  });
  return message;
}

export default async function handler(req, res) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return send(res, 503, { ok: false, error: 'blob_backend_not_configured' });
    }

    if (req.method === 'GET') {
      const url = new URL(req.url, `https://${req.headers.host || 'zillions.local'}`);
      const mode = cleanMode(url.searchParams.get('mode'));
      if (!mode) return send(res, 400, { ok: false, error: 'invalid_mode' });
      return send(res, 200, { ok: true, backend: 'vercel-blob', lobby: await readLobby(mode) });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const action = cleanId(body.action, 'join');
      const mode = cleanMode(body.mode);
      const playerId = cleanId(body.playerId, '');
      if (!mode) return send(res, 400, { ok: false, error: 'invalid_mode' });
      if (!playerId) return send(res, 400, { ok: false, error: 'missing_player_id' });

      if (action === 'join' || action === 'heartbeat') {
        const presence = await upsertPresence({
          mode,
          playerId,
          name: body.name,
          hero: body.hero,
          rules: body.rules,
          status: body.status || 'in-lobby',
        });
        return send(res, 200, {
          ok: true,
          backend: 'vercel-blob',
          presence,
          lobby: await readLobby(mode),
        });
      }

      if (action === 'chat') {
        const text = cleanText(body.text);
        if (!text) return send(res, 400, { ok: false, error: 'empty_chat' });
        await upsertPresence({ mode, playerId, name: body.name, hero: body.hero, rules: body.rules, status: 'in-lobby' });
        const message = await writeChat({ mode, playerId, name: body.name, hero: body.hero, text });
        return send(res, 200, {
          ok: true,
          backend: 'vercel-blob',
          message,
          lobby: await readLobby(mode),
        });
      }

      if (action === 'leave') {
        await del(playerPath(mode, playerId));
        return send(res, 200, { ok: true, backend: 'vercel-blob', lobby: await readLobby(mode) });
      }

      return send(res, 400, { ok: false, error: 'invalid_action' });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, `https://${req.headers.host || 'zillions.local'}`);
      const mode = cleanMode(url.searchParams.get('mode'));
      const playerId = cleanId(url.searchParams.get('playerId'), '');
      if (!mode || !playerId) return send(res, 400, { ok: false, error: 'bad_delete_request' });
      await del(playerPath(mode, playerId));
      return send(res, 200, { ok: true, backend: 'vercel-blob', lobby: await readLobby(mode) });
    }

    res.setHeader('allow', 'GET, POST, DELETE');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (error) {
    return send(res, 500, { ok: false, error: error?.message || 'lobby_backend_error' });
  }
}
