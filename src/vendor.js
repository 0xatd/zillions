// Specialist vendor catalogue and transaction contracts.
//
// This module is deliberately pure. It can quote stock and build mutation
// requests, but only an injected authority may purchase or sell an item.
// Browser state is never an economic authority.
import { BASES_BY_SLOT, hashString, rollItemKey, resolveItem } from './items.js';
import { itemInfo } from './config.js';

export const VENDOR_BUY_MULT = 2.4;
export const VENDOR_SELL_MULT = 0.22;

export const VENDORS = Object.freeze({
  quartermaster: {
    id: 'quartermaster', name: 'Frontier Quartermaster', icon: '🛡️', minLevel: 1,
    description: 'Weapons and field support for every expedition.',
    slots: ['weapon', 'offhand'], size: 8, restockHours: 24,
  },
  outfitter: {
    id: 'outfitter', name: 'Voidline Outfitter', icon: '🧥', minLevel: 1,
    description: 'Visible armor assembled for hostile-world work.',
    slots: ['head', 'armor', 'hands', 'legs', 'boots'], size: 10, restockHours: 24,
  },
  cyberneticist: {
    id: 'cyberneticist', name: 'Chassis Laboratory', icon: '⚛️', minLevel: 12,
    description: 'Implants for experienced Humans and Robots.',
    slots: ['implant'], size: 6, restockHours: 72,
  },
});

const clampLevel = (value) => Math.max(1, Math.min(100, Math.floor(Number(value) || 1)));
const clampSize = (value, fallback) => Math.max(1, Math.min(30, Math.floor(Number(value) || fallback)));
const safeId = (value) => String(value || '').trim().slice(0, 128);

export function itemValue(itemOrKey) {
  const item = typeof itemOrKey === 'string' ? itemInfo(itemOrKey) : itemOrKey;
  if (!item) return 0;
  const rarity = Math.max(1, Math.min(3, Number(item.rarity) || 1));
  const affixValue = (item.affixes || []).length * 8;
  return Math.max(1, Math.round(5 + (item.ilvl || 1) * 1.25 + rarity * rarity * 7 + affixValue));
}

export const vendorBuyPrice = (itemOrKey) => Math.max(1, Math.round(itemValue(itemOrKey) * VENDOR_BUY_MULT));
export const vendorSellPrice = (itemOrKey) => Math.max(1, Math.round(itemValue(itemOrKey) * VENDOR_SELL_MULT));

export function vendorEligibility(vendorId, character = {}) {
  const vendor = VENDORS[vendorId];
  if (!vendor) return { ok: false, reason: 'unknown_vendor' };
  const level = clampLevel(character.level);
  if (level < vendor.minLevel) return { ok: false, reason: 'level', requiredLevel: vendor.minLevel };
  return { ok: true, vendor, level };
}

export function vendorRotation(vendorId, timestamp = Date.now()) {
  const vendor = VENDORS[vendorId];
  if (!vendor) return null;
  const epoch = Math.floor(Number(timestamp) / (vendor.restockHours * 60 * 60 * 1000));
  return `${vendorId}:${Number.isFinite(epoch) ? epoch : 0}`;
}

export function vendorStock(vendorId = 'quartermaster', rotation = 'launch', characterLevel = 1, requestedSize) {
  // Backward-compatible read-only signature: vendorStock(rotation, level).
  if (!VENDORS[vendorId]) {
    requestedSize = arguments.length >= 3 ? characterLevel : undefined;
    characterLevel = rotation;
    rotation = vendorId;
    vendorId = 'quartermaster';
  }
  const vendor = VENDORS[vendorId];
  const level = clampLevel(characterLevel);
  if (level < vendor.minLevel) return [];
  const size = clampSize(requestedSize, vendor.size);
  const pools = vendor.slots.filter((slot) => BASES_BY_SLOT[slot]?.some((key) => ITEM_LEVEL(key) <= level));
  if (!pools.length) return [];
  const out = [];
  for (let i = 0; i < size; i++) {
    const seed = `${vendorId}:${rotation}:${level}:${i}`;
    const pool = pools[hashString(`${seed}:pool`) % pools.length];
    const bases = BASES_BY_SLOT[pool].filter((key) => ITEM_LEVEL(key) <= level);
    const base = bases[hashString(`${seed}:base`) % bases.length];
    const rarityRoll = hashString(`${seed}:rarity`) % 100;
    const rarity = rarityRoll < 8 ? 3 : rarityRoll < 42 ? 2 : 1;
    const key = rollItemKey(base, seed, level, rarity);
    const item = key && resolveItem(key);
    if (item) out.push(Object.freeze({
      id: `${vendorId}:${rotation}:${i}:${hashString(key).toString(36)}`,
      vendorId, rotation, key, item, price: vendorBuyPrice(item), currency: 'salvage_alloy',
    }));
  }
  return out;
}

function ITEM_LEVEL(key) {
  return resolveItem(`${key}:1:1:1`)?.base?.ilvl || 999;
}

export function purchaseRequest({ requestId, actorId, characterId, vendorId, offer } = {}) {
  if (!safeId(requestId) || !safeId(actorId) || !safeId(characterId)) return { ok: false, reason: 'invalid_identity' };
  if (!VENDORS[vendorId] || !offer?.id || offer.vendorId !== vendorId || !itemInfo(offer.key)) {
    return { ok: false, reason: 'invalid_offer' };
  }
  return { ok: true, request: Object.freeze({
    version: 1, action: 'vendor_purchase', requestId: safeId(requestId), actorId: safeId(actorId),
    characterId: safeId(characterId), vendorId, offerId: offer.id, rotation: offer.rotation,
    itemKey: offer.key, quotedPrice: Math.max(1, Math.floor(offer.price)), currency: 'salvage_alloy',
  }) };
}

export function saleRequest({ requestId, actorId, characterId, vendorId, itemInstanceId, itemKey } = {}) {
  if (!safeId(requestId) || !safeId(actorId) || !safeId(characterId) || !safeId(itemInstanceId)) {
    return { ok: false, reason: 'invalid_identity' };
  }
  if (!VENDORS[vendorId] || !itemInfo(itemKey)) return { ok: false, reason: 'invalid_item' };
  return { ok: true, request: Object.freeze({
    version: 1, action: 'vendor_sale', requestId: safeId(requestId), actorId: safeId(actorId),
    characterId: safeId(characterId), vendorId, itemInstanceId: safeId(itemInstanceId), itemKey,
    quotedPrice: vendorSellPrice(itemKey), currency: 'salvage_alloy',
  }) };
}

export async function submitVendorMutation(authority, contractResult) {
  if (!contractResult?.ok) return contractResult || { ok: false, reason: 'invalid_request' };
  if (!authority || typeof authority.executeVendorMutation !== 'function') {
    return { ok: false, reason: 'authority_unavailable' };
  }
  return authority.executeVendorMutation(contractResult.request);
}

// Compatibility exports now require authority and never edit character/meta.
export const buyVendorItem = (_character, offer, authority, identity = {}) => submitVendorMutation(
  authority, purchaseRequest({ ...identity, vendorId: offer?.vendorId || 'quartermaster', offer }),
);
export const sellVendorItem = (_character, item, authority, identity = {}) => submitVendorMutation(
  authority, saleRequest({ ...identity, vendorId: identity.vendorId || 'quartermaster', ...item }),
);
