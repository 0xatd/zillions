import { backendEnabled, economyRequest } from './backend.js';

const requestId = () => globalThis.crypto?.randomUUID?.()
  || `econ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const authoritativeEconomyEnabled = () => backendEnabled();

export async function runEconomyMutation({ authoritative, remote, offline }) {
  if (!authoritative) return offline();
  const result = await remote();
  if (!result) throw new Error('authority_unavailable');
  return result;
}

export async function loadAuthoritativeEconomy(character) {
  return economyRequest('snapshot', { requestId: requestId(), characterId: character.id });
}

export async function registerAuthoritativeCharacter(character) {
  return economyRequest('register_character', {
    requestId: requestId(),
    characterId: character.id,
    character: {
      name: character.name,
      classKey: character.classKey,
      raceKey: character.raceKey,
      customization: character.customization || {},
    },
  });
}

export function archiveLegacyOfflineEconomy(character) {
  if (character.legacyOfflineEconomy) return character.legacyOfflineEconomy;
  character.legacyOfflineEconomy = {
    status: 'pending_audited_migration',
    items: [...(character.items || [])],
    equipment: { ...(character.equipment || {}) },
  };
  return character.legacyOfflineEconomy;
}

export function quarantineForAuthoritativeLoad(character) {
  archiveLegacyOfflineEconomy(character);
  character.items = [];
  character.equipment = {};
  character.itemInstances = [];
  character.equipmentInstances = {};
  character.equipmentInstanceRevisions = {};
  delete character.authoritativeBalance;
  delete character.authorityRevision;
  return character;
}

export async function buyAuthoritativeItem(character, vendorId, offerIndex) {
  return economyRequest('buy_vendor', {
    requestId: requestId(), characterId: character.id, vendorId, offerIndex,
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
