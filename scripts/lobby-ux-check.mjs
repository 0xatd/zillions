import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

for (const label of ['LEAVE LOBBY', 'CLOSE LOBBY', 'LEAVE MATCH', 'END MATCH FOR EVERYONE']) {
  assert.match(ui, new RegExp(label), `missing explicit exit label: ${label}`);
}
assert.match(ui, /This removes every player and permanently closes the room/);
assert.match(main, /for \(let count = 5; count >= 1; count--\)/, 'launch must use a five-second countdown');
assert.match(main, /countdownCanceled/, 'connection loss must cancel launch');
assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/, 'desktop must fit all seven heroes without scrolling');
assert.match(css, /overflow: hidden;/, 'desktop room must remain a fixed app surface');
console.log('lobby UX check passed');
