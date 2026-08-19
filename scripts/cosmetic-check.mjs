import assert from 'node:assert/strict';
import { APPEARANCES, CREATOR_PARTS, MMO_RACES } from '../src/mmo-characters.js';
import { COSMETIC_CATALOGUE, COSMETIC_RENDERERS, cosmeticEligibility, cosmeticsForRace, validateCosmeticCatalogue } from '../src/cosmetics.js';

assert.deepEqual(validateCosmeticCatalogue(), { ok: true, errors: [] });
assert.ok(COSMETIC_CATALOGUE.every((entry) => entry.entitlement === 'free'), 'launch cosmetics must default to free');
assert.equal(new Set(COSMETIC_CATALOGUE.map((entry) => entry.id)).size, COSMETIC_CATALOGUE.length);
for (const race of Object.keys(MMO_RACES)) {
  const catalogue = cosmeticsForRace(race);
  for (const [slot, families] of Object.entries(CREATOR_PARTS[race])) for (const family of families) {
    const id = `${race}.${slot}.${family}`;
    assert.ok(catalogue.some((entry) => entry.id === id), `missing catalogue option ${id}`);
    assert.ok(COSMETIC_RENDERERS[race][slot][family], `missing live renderer recipe ${id}`);
    assert.ok(cosmeticEligibility(id, race).ok, `${id} should be free and eligible`);
  }
  for (const color of Object.keys(APPEARANCES)) assert.ok(catalogue.some((entry) => entry.id === `shared.color.${color}`));
}
assert.equal(cosmeticEligibility('robot.face.optic', 'human').reason, 'race');
assert.equal(cosmeticEligibility('missing', 'human').reason, 'unknown_cosmetic');
console.log('cosmetic-check: every free Human/Robot option has a concrete renderer recipe');
