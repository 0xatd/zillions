import { backendEnabled, economyRequest } from './backend.js';

const requestId = () => globalThis.crypto?.randomUUID?.()
  || `econ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const authoritativeEconomyEnabled = () => backendEnabled();

export async function loadAuthoritativeEconomy(character) {
  return economyRequest('snapshot', { requestId: requestId(), characterId: character.id });
}

export async function migrateLegacyEconomy(character, currency = 0) {
  return economyRequest('migrate_legacy', {
    requestId: requestId(),
    characterId: character.id,
    character: {
      name: character.name,
      classKey: character.classKey,
      raceKey: character.raceKey,
      level: character.level,
      customization: character.customization || {},
    },
    currency,
    stash: [...(character.items || [])],
    equipment: { ...(character.equipment || {}) },
  });
}

export async function buyAuthoritativeItem(character, rotation, offerIndex) {
  return economyRequest('buy_vendor', {
    requestId: requestId(), characterId: character.id, rotation, offerIndex,
    characterRevision: character.authorityRevision ?? null, characterLevel: character.level || 1,
  });
}

export async function sellAuthoritativeItem(character, itemId) {
  return economyRequest('sell_vendor', {
    requestId: requestId(), characterId: character.id, itemId,
    characterRevision: character.authorityRevision ?? null,
  });
}

export async function equipAuthoritativeItem(character, itemId, equipSlot, itemRevision = null) {
  return economyRequest('equip', {
    requestId: requestId(), characterId: character.id, itemId, equipSlot, itemRevision,
    characterRevision: character.authorityRevision ?? null,
  });
}

export async function unequipAuthoritativeItem(character, equipSlot, itemRevision = null) {
  return economyRequest('unequip', {
    requestId: requestId(), characterId: character.id, equipSlot, itemRevision,
    characterRevision: character.authorityRevision ?? null,
  });
}

export function applyEconomySnapshot(character, snapshot) {
  if (!snapshot?.character || !Array.isArray(snapshot.items)) return false;
  const stash = snapshot.items.filter((item) => item.location === 'stash');
  const equipped = snapshot.items.filter((item) => item.location === 'equipped');
  character.items = stash.map((item) => item.legacyKey);
  character.itemInstances = stash.map((item) => ({ id: item.id, key: item.legacyKey, revision: item.revision }));
  character.equipment = Object.fromEntries(equipped.map((item) => [item.equipSlot, item.legacyKey]));
  character.equipmentInstances = Object.fromEntries(equipped.map((item) => [item.equipSlot, item.id]));
  character.equipmentInstanceRevisions = Object.fromEntries(equipped.map((item) => [item.equipSlot, item.revision]));
  character.authorityRevision = snapshot.character.revision;
  character.authoritativeBalance = snapshot.wallet?.balance ?? 0;
  return true;
}
