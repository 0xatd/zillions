// Shared slot contract. Legacy leaders keep their original Q ability while
// authored multi-ability kits use six slots (Q/E/R and Ctrl+Q/E/R).
export const ABILITY_SLOT_COUNT = 6;
export const validAbilitySlot = slot => Number.isInteger(slot) && slot >= 0 && slot < ABILITY_SLOT_COUNT;
export function heroAbilities(def) {
  return Array.isArray(def?.abilities) ? def.abilities.slice(0, ABILITY_SLOT_COUNT) : [def?.ability];
}
export function heroAbility(def, slot = 0) {
  return validAbilitySlot(slot) ? heroAbilities(def)[slot] || null : null;
}
export function abilityCooldown(hero, slot = 0) {
  const value = slot === 0 ? hero.abilCd : hero.abilityCds?.[slot];
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
export function abilityCooldowns(hero) {
  return Array.from({ length: ABILITY_SLOT_COUNT }, (_, slot) => abilityCooldown(hero, slot));
}
export function setAbilityCooldown(hero, slot, value) {
  if (!validAbilitySlot(slot)) return;
  if (!hero.abilityCds) hero.abilityCds = Array(ABILITY_SLOT_COUNT).fill(0);
  hero.abilityCds[slot] = Math.max(0, value);
  if (slot === 0) hero.abilCd = hero.abilityCds[slot];
}
export function tickAbilityCooldowns(hero, dt) {
  for (let slot = 0; slot < ABILITY_SLOT_COUNT; slot++) setAbilityCooldown(hero, slot, abilityCooldown(hero, slot) - dt);
}
