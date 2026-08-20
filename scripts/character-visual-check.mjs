import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CREATOR_PARTS } from '../src/mmo-characters.js';
import { COSMETIC_RENDERERS } from '../src/cosmetics.js';

const art = await readFile(new URL('../src/unit-art.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const characters = await readFile(new URL('../src/mmo-characters.js', import.meta.url), 'utf8');

for (const [race, slots] of Object.entries(CREATOR_PARTS)) for (const [slot, families] of Object.entries(slots)) {
  const signatures = families.map((family) => JSON.stringify(COSMETIC_RENDERERS[race][slot][family]));
  assert.equal(new Set(signatures).size, families.length, `${race}.${slot} recipes must be visually distinct`);
}
assert.ok(art.includes('COSMETIC_RENDERERS[race][slot]'), 'live model must resolve every identity option through the cosmetic catalogue');
for (const slot of ['head', 'chest', 'hands', 'legs', 'boots']) assert.ok(art.includes(`gear.${slot}`), `live model missing ${slot} gear layer`);
assert.ok(ui.includes('creator-preview-canvas') && ui.includes('paperdoll-preview-canvas'), 'creator and paper doll need 3D canvases');
assert.ok(main.includes('buildUnitModel') && main.includes('_renderCharacterPreview'), 'previews must share the live unit renderer');
assert.ok(art.includes("roleFamily(style.classKey)"), 'class role family must reach the shared visual state');
assert.ok(art.includes('gearInfo') && art.includes('rarityAccent'), 'visible gear must preserve restrained rarity treatment');
assert.ok(art.includes("race === 'robot'") && art.includes('segmented limbs') && art.includes('rig.head.children[0].visible = false'),
  'Human and Robot origins need different dominant head and limb silhouettes');
assert.ok(ui.includes("classKey: this._creatorClass") && ui.includes('classKey: character.classKey'),
  'creator and paper doll must pass the same class role identity as live models');
assert.ok(main.includes('classKey: character.classKey') && characters.includes("classKey: MMO_CLASSES[character?.classKey]"),
  'overworld and combat must preserve the selected class role identity');
console.log('character-visual-check: creator, paper doll and live models share distinct cosmetic and gear states');
