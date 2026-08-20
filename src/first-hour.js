import { itemInfo } from './config.js';
import { characterAttributes, legalEquipment } from './mmo-characters.js';
import { slotsForPool, ATTRIBUTES } from './items.js';

export function firstHourStep(character) {
  if (!character) return 'create';
  if (character.firstHourGuideDismissed || Number(character.stats?.victories || 0) > 0) return 'complete';
  const equipped = Object.keys(legalEquipment(character)).length > 0;
  if (!(character.items || []).length && !equipped) return 'market';
  if (!equipped) return 'equip';
  const instances = [...(character.itemInstances || []), ...Object.values(character.equipmentItemInstances || {})];
  const forged = instances.some((item) => (item?.sockets || []).length > 0)
    || (character.craftingComponents || []).length > 0
    || Object.values(character.craftingMaterials || {}).some((count) => Number(count) > 0);
  return forged ? 'mission' : 'forge';
}

export function firstHourGuidance(character) {
  const step = firstHourStep(character);
  const content = {
    create: ['Create your survivor', 'Origin changes a small racial passive. Class determines your battlefield role and primary attribute.', 'CREATE CHARACTER'],
    market: ['Claim your first field upgrade', 'Open the Market. Compare an item against your current loadout before spending Salvage Alloy.', 'OPEN MARKET'],
    equip: ['Equip what you bought', 'Open Equipment, inspect the green and red attribute changes, then equip your chosen item.', 'OPEN EQUIPMENT'],
    forge: ['Tune one item at the Forge', 'Add or calibrate a socket, or install a component. The workbench shows its exact stat effect.', 'OPEN FORGE'],
    mission: ['Deploy to Greenfall Marches', 'Enter Earth, walk to the Greenfall gate, and choose Casual for your first deployment.', 'ENTER WORLD'],
    complete: ['First deployment complete', 'Your character, equipment, crafting, and campaign progress persist.', 'CONTINUE'],
  }[step];
  return { step, title: content[0], body: content[1], action: content[2] };
}

export function equipmentPreview(character, itemKey) {
  const item = itemInfo(itemKey);
  if (!item?.slot) return { target: null, deltas: [] };
  const candidates = slotsForPool(item.slot);
  const target = candidates.find((slot) => !(character.equipment || {})[slot]) || candidates[0];
  const before = characterAttributes(character);
  const after = characterAttributes({ ...character, equipment: { ...(character.equipment || {}), [target]: itemKey } });
  return { target, deltas: Object.values(ATTRIBUTES).map((attr) => ({
    key: attr.key, name: attr.name, icon: attr.icon,
    value: Math.round((after[attr.key] || 0) - (before[attr.key] || 0)),
  })).filter((entry) => entry.value !== 0) };
}

export function compactDeltas(deltas = []) {
  return deltas.length ? deltas.map((entry) => `${entry.value > 0 ? '+' : ''}${entry.value} ${entry.name}`).join(' · ') : 'No primary attribute change';
}

export function missionRewardSummary(level) {
  const rewards = (level?.quests || []).map((quest) => `${quest.name}: ${itemInfo(quest.reward)?.name || quest.reward}`);
  return rewards.length ? rewards.join(' · ') : 'No optional rewards listed';
}
