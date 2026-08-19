import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

for (const label of ['LIVE GAMES', 'ARCADE', 'PLAY NOW', 'HOST GAME', 'JOIN GAME']) {
  assert.match(ui, new RegExp(label), `Custom Games is missing ${label}`);
}

assert.match(ui, /_customView === 'arcade'/, 'Live Games and Arcade need separate render paths');
assert.match(ui, /_arcadeMaps\(\)/, 'Arcade needs a real prebuilt map catalog');
assert.match(ui, /this\._customGames = games/, 'Live Games must render the current backend room list');
assert.match(ui, /game\.status === 'open'/, 'Live Games must distinguish joinable and active games');
assert.match(ui, /this\.cb\.onCustomPlay\?\./, 'Arcade Play Now must have an executable action');
assert.match(main, /onCustomPlay: \(map\) => this\.playArcadeMap\(map\)/,
  'the app must wire Arcade Play Now');
assert.match(main, /playArcadeMap\(map\)/, 'the app needs an Arcade play route');
assert.match(css, /grid-template-areas: "head head head" "nav list detail" "nav actions actions"/,
  'Custom Games needs one authoritative browser layout');

console.log('custom games shell check passed');
