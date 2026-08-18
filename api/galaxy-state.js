// Shared galaxy ownership API.
//
// Reads are public. Writes are server-to-server only until Zillions has a
// trusted match authority. Battle results are immutable event blobs, so two
// simultaneous victories cannot overwrite each other.

import { createHash, timingSafeEqual } from 'node:crypto';
import { list, put } from '@vercel/blob';
import { GALAXY_SEED, knownGalaxy } from '../src/galaxy.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};
const EVENT_PREFIX = 'galaxy/battles/';
const EVENT_LIMIT = 1000;
const BODY_LIMIT = 16 * 1024;
const GALAXY = knownGalaxy(GALAXY_SEED);
const WORLD_IDS = new Set(GALAXY.worlds.map((world) => world.id));

function send(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function cleanText(value, max = 220) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

async function parseBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > BODY_LIMIT) throw Object.assign(new Error('body_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'));
}

export function authorized(req) {
  const expected = process.env.GALAXY_WRITE_SECRET || '';
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readEvent(blob) {
  const response = await fetch(blob.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`blob_read_${response.status}`);
  return response.json();
}

async function loadEvents() {
  const result = await list({ prefix: EVENT_PREFIX, limit: EVENT_LIMIT });
  const events = [];
  for (const blob of result.blobs || []) {
    try { events.push(await readEvent(blob)); } catch { /* one corrupt event must not hide the galaxy */ }
  }
  return events.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function projectState(events) {
  const worlds = {};
  for (const world of GALAXY.worlds) {
    worlds[world.id] = { owner: world.id === 'earth' ? 'free' : 'hive', changedAt: null };
  }
  for (const event of events) {
    if (!WORLD_IDS.has(event.worldId)) continue;
    if (event.outcome === 'liberated') worlds[event.worldId] = { owner: 'free', changedAt: event.createdAt };
  }
  return worlds;
}

export function eventPath(battleId) {
  const digest = createHash('sha256').update(battleId).digest('hex');
  return `${EVENT_PREFIX}${digest}.json`;
}

export default async function handler(req, res) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return send(res, 503, { ok: false, error: 'blob_backend_not_configured' });
    }

    if (req.method === 'GET') {
      const events = await loadEvents();
      return send(res, 200, {
        ok: true,
        worlds: projectState(events),
        events: events.slice(-50).reverse(),
      });
    }

    if (req.method === 'POST') {
      if (!process.env.GALAXY_WRITE_SECRET) {
        return send(res, 503, { ok: false, error: 'galaxy_writer_not_configured' });
      }
      if (!authorized(req)) return send(res, 401, { ok: false, error: 'unauthorized' });
      const body = await parseBody(req);
      if (cleanText(body.action) !== 'battle') return send(res, 400, { ok: false, error: 'invalid_action' });
      const worldId = cleanText(body.worldId, 96);
      const outcome = cleanText(body.outcome, 24);
      const battleId = cleanText(body.battleId, 160);
      if (!WORLD_IDS.has(worldId)) return send(res, 400, { ok: false, error: 'unknown_world' });
      if (!['liberated', 'failed', 'partial'].includes(outcome)) return send(res, 400, { ok: false, error: 'invalid_outcome' });
      if (!battleId) return send(res, 400, { ok: false, error: 'missing_battle_id' });

      const path = eventPath(battleId);
      const duplicate = (await list({ prefix: path, limit: 1 })).blobs?.length > 0;
      if (duplicate) return send(res, 200, { ok: true, duplicate: true });
      const event = { kind: 'battle_result', worldId, outcome, battleId, createdAt: new Date().toISOString() };
      try {
        await put(path, JSON.stringify(event), {
          access: 'public', addRandomSuffix: false, allowOverwrite: false,
          contentType: 'application/json; charset=utf-8',
        });
      } catch (error) {
        // A concurrent retry can win between list() and put(). Treat an
        // existing immutable event as success; surface all other failures.
        const exists = (await list({ prefix: path, limit: 1 })).blobs?.length > 0;
        if (!exists) throw error;
        return send(res, 200, { ok: true, duplicate: true });
      }
      return send(res, 200, { ok: true, event });
    }

    res.setHeader('allow', 'GET, POST');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (error) {
    return send(res, error?.status || 500, { ok: false, error: error?.message || 'galaxy_state_error' });
  }
}
