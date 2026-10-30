// Menu shell: title, world map, deploy, and pause stay on the siege path.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frontState, battlefieldPressure, planetForLevel, STAR_SYSTEM } from '../src/front-state.js';

const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

for (const id of ['title-continue', 'title-play', 'title-upgrades', 'title-settings', 'title-credits', 'screen-fronts', 'screen-upgrades', 'screen-character-create']) {
  assert.ok(ui.includes(`id="${id}"`), `menu shell is missing #${id}`);
}
assert.match(ui, /id="p-resume"[^>]*>Resume/);
assert.match(ui, /id="p-settings"[^>]*>Settings/);
assert.match(ui, /id="p-restart"[^>]*>Restart/);
assert.match(ui, /id="p-quit"[^>]*>Quit to map/);
assert.doesNotMatch(ui, /window\.confirm\(/, 'menus must use the in-game confirm dialog');
assert.doesNotMatch(ui, /id="m-play"|id="m-continuerow"/, 'the retired home-screen campaign row must stay retired');
assert.match(ui, /id="screen-main" class="mainmenu character-select"/, 'the roster stays in the shell');
assert.match(css, /font-family: 'Lilita One'/);
assert.match(css, /font-family: Nunito/);
assert.match(css, /\.herocard \{[\s\S]*background: #141a24/, 'hero cards keep an explicit dark face');

assert.equal(frontState(1, 0, {}), 'open');
assert.equal(frontState(2, 0, {}), 'locked');
assert.equal(frontState(1, 1, {}), 'completed');
assert.equal(frontState(2, 1, {}), 'open');
assert.equal(frontState(3, 1, { 3: 1 }), 'locked');
assert.equal(frontState(2, 0, { 2: 1 }), 'locked');
assert.equal(battlefieldPressure(0.8), 'Gentle');
assert.equal(battlefieldPressure(2), 'Final');
assert.equal(planetForLevel(1)?.id, 'verdant');
assert.equal(planetForLevel(4)?.id, 'verdant');
assert.equal(planetForLevel(2)?.id, 'mire');
assert.equal(planetForLevel(3)?.id, 'cinder');
assert.equal(planetForLevel(5)?.id, 'cinder');
assert.equal(STAR_SYSTEM.reduce((n, planet) => n + planet.sites.filter((site) => !site.levelId).length, 0) >= 6, true, 'each world keeps coming-soon sites');

console.log('menu shell check passed');
