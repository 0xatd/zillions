// Product-shell regressions found during the PR #75-#82 integration audit.
// These checks pin the entry and control contracts that players actually see.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const main = read('src/main.js');
const ui = read('src/ui.js');
const game = read('src/game.js');
const keybinds = read('src/keybinds.js');
const online = read('src/online.js');
const css = read('style.css');

// ENTER WORLD is the login/start action, not a chain of roster confirmations.
assert.match(ui, /id="a-google">ENTER WORLD</, 'the signed-out front door must say ENTER WORLD');
assert.match(ui, /id="a-enter">RESUME WORLD</, 'a signed-in title return must say RESUME WORLD');
assert.match(ui, /id="m-enter-world">RESUME WORLD</, 'the optional roster must resume, not re-enter');
assert.match(main, /status\.signedIn && !status\.needsUsername && !this\._authenticatedEntryHandled[\s\S]*character\.lastWorld[\s\S]*showCharacterCreator\(\)/,
  'authenticated entry must resume a character or open creation');
assert.match(main, /_createMmoCharacter[\s\S]*const worldId = character\.lastWorld \|\| 'earth'[\s\S]*this\._enterOverworld\(worldId\)/,
  'character creation must enter Earth instead of bouncing to the roster');

// Space, Q, and B have one meaning each. The old contextual-Space path caused
// one press to dodge on keydown and fund a building on the held-input frame.
const inputUpdate = main.slice(main.indexOf('_updateHeroInput()'), main.indexOf('\n  myHero()', main.indexOf('_updateHeroInput()')));
assert.ok(!/isHeld\([^\n]*'dodge'\)/.test(inputUpdate), 'held dodge must never pay for construction');
assert.match(inputUpdate, /isHeld\(bindsNow, this\.keys, 'build'\)/, 'held Build must own construction payment');
assert.match(main, /case 'dodge':[\s\S]*issue\(\{ t: 'dodge'/, 'Space must dispatch dodge');
assert.match(main, /case 'ability1':[\s\S]*tryCast\(\)/, 'Q must dispatch the primary ability');
assert.match(main, /case 'build':[\s\S]*_tryFound\(\)/, 'Build must found the city');
assert.match(keybinds, /Toggle construction markers/, 'Alt must describe marker visibility, not contextual controls');

for (const stale of ['SPACE/Q', 'Hold SPACE/B', 'Space fires the hero special', 'Space/B builds', 'ALT fight', 'Press <kbd>3</kbd>']) {
  assert.ok(!ui.includes(stale), `UI still advertises the removed control contract: ${stale}`);
}
assert.ok(!game.includes('press SPACE to found'), 'simulation messages still advertise Space as Build');
for (const id of ['dodge', 'ability1', 'build', 'build_mode', 'stance_push', 'tower_priority']) {
  assert.ok(ui.includes(`data-bind-label="${id}"`) || ui.includes(`_keyLabel('${id}')`),
    `${id} is not rendered from the live binding table`);
}

// Pending QA fixes audited alongside the shell stabilization.
assert.match(main, /const target = g\.buildTargetFor\(mh\);[\s\S]*pipPlotId = target\.plot\.id/,
  'the visible construction target must be the target Build will fund');
assert.match(main, /u === g\.heroes\[this\.myPlayer\] && this\.mpRole === 'guest'/,
  'local movement lead must apply only to this guest player');
assert.doesNotMatch(main, /if \(u\.hero && this\.mpRole === 'guest'/,
  'local movement lead must not shift every hero on a guest client');
assert.match(online, /this\._presenceBeat = setInterval[\s\S]*}, 15 \* 1000\);/, 'presence writes must stay on the slower heartbeat');
assert.match(online, /this\._gamesPoll = setInterval[\s\S]*refreshGames\(\)[\s\S]*}, 5 \* 1000\);/, 'the read-only lobby fallback must self-heal within five seconds');
assert.match(main, /this\.ow\.world\?\.id !== character\.lastWorld[\s\S]*_travelToWorld/, 'character switching must move to that character’s world');
assert.match(ui, /creator-cancel[\s\S]*mmoCharacters[\s\S]*_backOverlay/, 'mandatory character creation must not cancel into an empty roster');
assert.match(css, /\.endpanel \.startbtn \{[\s\S]*position: sticky; bottom: 0/,
  'retry/continue must remain reachable on short screens');

console.log('stabilization check passed: one front door; Space/Q/B controls are unambiguous');
