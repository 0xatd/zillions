// Deterministic hub vendor. Stock is a function of rotation + character level,
// so every client renders the same offers. Transactions update the existing
// persistent Salvage Alloy ledger and the selected character stash.
import { BASES_BY_SLOT, SLOTS, hashString, rollItemKey, resolveItem } from './items.js';
import { itemInfo } from './config.js';
import { loadMeta, saveMeta, charge } from './meta.js';
import { STASH_SLOTS } from './mmo-characters.js';

export const VENDOR_SIZE = 12;
export const VENDOR_BUY_MULT = 2.4;
export const VENDOR_SELL_MULT = 0.22;

export function itemValue(itemOrKey) {
  const item = typeof itemOrKey === 'string' ? itemInfo(itemOrKey) : itemOrKey;
  if (!item) return 0;
  const rarity = Math.max(1, Math.min(3, Number(item.rarity) || 1));
  const affixValue = (item.affixes || []).length * 8;
  return Math.max(1, Math.round(5 + (item.ilvl || 1) * 1.25 + rarity * rarity * 7 + affixValue));
}

export const vendorBuyPrice = (itemOrKey) => Math.max(1, Math.round(itemValue(itemOrKey) * VENDOR_BUY_MULT));
export const vendorSellPrice = (itemOrKey) => Math.max(1, Math.round(itemValue(itemOrKey) * VENDOR_SELL_MULT));

export function vendorStock(rotation = 'launch', characterLevel = 1, size = VENDOR_SIZE) {
  const level = Math.max(1, Math.min(100, Math.floor(Number(characterLevel) || 1)));
  const pools = SLOTS.filter((slot) => BASES_BY_SLOT[slot]?.some((key) => (resolveItem(`${key}:1:${level}:1`)?.base?.ilvl || 999) <= level));
  const out = [];
  for (let i = 0; i < Math.max(1, Math.min(30, size)); i++) {
    const seed = `${rotation}:${level}:${i}`;
    const pool = pools[hashString(`${seed}:pool`) % pools.length];
    const bases = BASES_BY_SLOT[pool].filter((key) => {
      const probe = resolveItem(`${key}:1:${level}:1`);
      return probe && probe.base.ilvl <= level;
    });
    const base = bases[hashString(`${seed}:base`) % bases.length];
    const rarityRoll = hashString(`${seed}:rarity`) % 100;
    const rarity = rarityRoll < 8 ? 3 : rarityRoll < 42 ? 2 : 1;
    const key = rollItemKey(base, seed, level, rarity);
    if (key) out.push({ key, item: resolveItem(key), price: vendorBuyPrice(key) });
  }
  return out;
}

export function buyVendorItem(character, offer) {
  if (!character || !offer?.key || !itemInfo(offer.key)) return { ok: false, reason: 'invalid' };
  if ((character.items || []).length >= STASH_SLOTS) return { ok: false, reason: 'full' };
  const paid = charge(Math.max(1, Number(offer.price) || vendorBuyPrice(offer.key)));
  if (!paid.ok) return { ok: false, reason: 'poor', short: paid.short };
  character.items = [...(character.items || []), offer.key];
  return { ok: true, currency: paid.currency, key: offer.key };
}

export function sellVendorItem(character, index) {
  if (!character || !Array.isArray(character.items)) return { ok: false, reason: 'invalid' };
  const position = Math.floor(Number(index));
  const key = character.items[position];
  if (!key || !itemInfo(key)) return { ok: false, reason: 'invalid' };
  const value = vendorSellPrice(key);
  character.items.splice(position, 1);
  const meta = loadMeta();
  meta.currency += value;
  meta.lifetime.earned += value;
  saveMeta(meta);
  return { ok: true, currency: meta.currency, value, key };
}
