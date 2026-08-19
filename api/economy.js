import { itemInfo } from '../src/config.js';
import { resolveItem } from '../src/items.js';
import { VENDORS, vendorRotation, vendorSellPrice, vendorStock } from '../src/vendor.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const BODY_LIMIT = 64 * 1024;
const ACTIONS = new Set(['register_character', 'buy_vendor', 'sell_vendor', 'equip', 'unequip', 'snapshot']);
export const serverRotation = (vendorId = 'quartermaster', now = Date.now()) => vendorRotation(vendorId, now);

const send = (res, status, body) => { res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify(body)); };
const cleanText = (value, max = 128) => String(value || '').replace(/[^a-zA-Z0-9_:\-.]/g, '').slice(0, max);

async function parseBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > BODY_LIMIT) throw Object.assign(new Error('body_too_large'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function authenticatedUser(authorization, url, anonKey) {
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: anonKey } });
  return response.ok ? response.json() : null;
}

function itemPayload(key) {
  const item = itemInfo(key);
  if (!item) return null;
  const rolled = resolveItem(key);
  return {
    legacy_key: key, base_id: rolled?.baseKey || key, item_level: Math.max(1, Number(item.ilvl) || 1),
    rarity: Math.max(1, Number(item.rarity) || 1), affixes: rolled?.affixes || [], sockets: [], binding: 'account',
    slot_pool: item.slot || rolled?.slot || 'unknown', economy_data: { sell_price: vendorSellPrice(key) },
  };
}

function registrationPayload(body) {
  return {
    character: {
      client_character_id: cleanText(body.characterId, 96), name: String(body.character?.name || 'Commander').trim().slice(0, 40),
      class_key: cleanText(body.character?.classKey || 'vanguard', 48), race_key: ['human', 'robot'].includes(body.character?.raceKey) ? body.character.raceKey : 'human',
      level: 1, customization: body.character?.customization || {},
    },
    legacy_state: 'offline_pending_audited_migration',
  };
}

function mutationPayload(action, body, authoritativeLevel = null) {
  const base = {
    client_character_id: cleanText(body.characterId, 96),
    expected_character_revision: Number.isInteger(body.characterRevision) ? body.characterRevision : null,
  };
  if (action === 'register_character') return registrationPayload(body);
  if (action === 'buy_vendor') {
    const vendorId = cleanText(body.vendorId, 32);
    if (!VENDORS[vendorId]) throw Object.assign(new Error('unknown_vendor'), { status: 400 });
    const rotation = serverRotation(vendorId);
    const index = Math.floor(Number(body.offerIndex));
    const offer = vendorStock(vendorId, rotation, Math.max(1, Number(authoritativeLevel) || 1))[index];
    if (!offer) throw Object.assign(new Error('invalid_stock'), { status: 400 });
    return { ...base, vendor_id: vendorId, rotation, offer_index: index, price: offer.price, item: itemPayload(offer.key) };
  }
  if (action === 'sell_vendor') return { ...base, item_id: cleanText(body.itemId, 64), sell_price: null };
  if (action === 'equip') return { ...base, item_id: cleanText(body.itemId, 64), equip_slot: cleanText(body.equipSlot, 24), expected_item_revision: body.itemRevision ?? null };
  if (action === 'unequip') return { ...base, equip_slot: cleanText(body.equipSlot, 24), expected_item_revision: body.itemRevision ?? null };
  return base;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) return send(res, 503, { ok: false, error: 'economy_backend_not_configured' });
    const authorization = String(req.headers.authorization || '');
    const user = await authenticatedUser(authorization, url, anonKey);
    if (!user?.id) return send(res, 401, { ok: false, error: 'sign_in_required' });
    const body = await parseBody(req);
    const action = cleanText(body.action, 32);
    if (!ACTIONS.has(action)) return send(res, 400, { ok: false, error: 'invalid_action' });
    const requestId = cleanText(body.requestId, 64);
    if (!requestId) return send(res, 400, { ok: false, error: 'missing_request_id' });
    let authoritativeLevel = null;
    if (action === 'buy_vendor') {
      const clientId = cleanText(body.characterId, 96);
      const characterResponse = await fetch(`${url}/rest/v1/game_characters?select=level&user_id=eq.${user.id}&client_character_id=eq.${encodeURIComponent(clientId)}&limit=1`, {
        headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      });
      const rows = await characterResponse.json().catch(() => []);
      if (!characterResponse.ok || !rows[0]) return send(res, 400, { ok: false, error: 'character_not_found' });
      authoritativeLevel = rows[0].level;
    }
    const payload = mutationPayload(action, body, authoritativeLevel);
    const rpc = await fetch(`${url}/rest/v1/rpc/economy_mutate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': 'application/json' },
      body: JSON.stringify({ p_actor: user.id, p_request_id: requestId, p_action: action, p_payload: payload }),
    });
    const result = await rpc.json().catch(() => null);
    if (!rpc.ok) return send(res, rpc.status === 409 ? 409 : 400, { ok: false, error: result?.message || 'economy_mutation_failed' });
    return send(res, 200, result);
  } catch (error) {
    return send(res, error?.status || 500, { ok: false, error: error?.message || 'economy_backend_error' });
  }
}
