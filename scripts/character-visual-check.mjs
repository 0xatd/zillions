import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CREATOR_PARTS } from '../src/mmo-characters.js';
import { COSMETIC_RENDERERS } from '../src/cosmetics.js';

const art = await readFile(new URL('../src/unit-art.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

for (const [race, slots] of Object.entries(CREATOR_PARTS)) for (const [slot, families] of Object.entries(slots)) {
  const signatures = families.map((family) => JSON.stringify(COSMETIC_RENDERERS[race][slot][family]));
  assert.equal(new Set(signatures).size, families.length, `${race}.${slot} recipes must be visually distinct`);
}
assert.ok(art.includes('COSMETIC_RENDERERS[race][slot]'), 'live model must resolve every identity option through the cosmetic catalogue');
for (const slot of ['head', 'chest', 'hands', 'legs', 'boots']) assert.ok(art.includes(`gear.${slot}`), `live model missing ${slot} gear layer`);
assert.ok(ui.includes('creator-preview-canvas') && ui.includes('paperdoll-preview-canvas'), 'creator and paper doll need 3D canvases');
assert.ok(main.includes('buildUnitModel') && main.includes('_renderCharacterPreview'), 'previews must share the live unit renderer');
console.log('character-visual-check: creator, paper doll and live models share distinct cosmetic and gear states');
