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
assert.match(ui, /id="m-enter-world">RETURN TO WORLD</, 'the optional roster must return to the live world, not re-enter');
assert.match(main, /status\.signedIn && !status\.needsUsername && !this\._authenticatedEntryHandled[\s\S]*character\.lastWorld[\s\S]*showCharacterCreator\(\)/,
  'authenticated entry must resume a character or open creation');
assert.match(main, /_createMmoCharacter[\s\S]*const worldId = character\.lastWorld \|\| 'earth'[\s\S]*this\._enterOverworld\(worldId\)/,
  'character creation must enter Earth instead of bouncing to the roster');
assert.match(ui, /id="m-logout">LOG OUT</, 'the signed-in roster must expose an explicit logout action');
assert.match(ui, /#m-logout'\)\.onclick = \(\) => this\.cb\.onSignOut/, 'logout must call auth instead of repainting the title');
assert.match(main, /async _signOut\(\)[\s\S]*this\.auth\.signOut\(\)/, 'the shell must sign out of the account backend');
assert.match(ui, /id="fight-kit"[\s\S]*d\.aura[\s\S]*d\.passives[\s\S]*d\.ability/, 'Fight mode must render the hero aura, passives, and active ability');
assert.match(ui, /#fight-kit'\)\?\.classList\.toggle\('hidden', !fighting\)/, 'the complete hero kit must appear in Fight mode');

// Build and Fight are explicit action contexts. Space builds in Build mode and
// dodges in Fight mode; Q only casts in Fight mode. Movement stays shared.
const inputUpdate = main.slice(main.indexOf('_updateHeroInput()'), main.indexOf('\n  myHero()', main.indexOf('_updateHeroInput()')));
assert.match(inputUpdate, /isHeld\(bindsNow, this\.keys, 'dodge'\)[\s\S]*controlMode === 'build'/, 'Build mode must let held Space fund construction');
assert.match(inputUpdate, /isHeld\(bindsNow, this\.keys, 'build'\)/, 'B must remain a secondary Build-mode binding');
assert.match(main, /case 'dodge':[\s\S]*controlMode !== 'fight'[\s\S]*case 'ability1'/, 'Space must be blocked from dodging in Build mode');
assert.match(main, /case 'dodge':[\s\S]*issue\(\{ t: 'dodge'/, 'Space must dispatch dodge in Fight mode');
assert.match(main, /case 'ability1':[\s\S]*controlMode === 'fight'[\s\S]*tryCast\(\)/, 'Q must cast only in Fight mode');
assert.match(main, /case 'build':[\s\S]*_tryFound\(\)/, 'Build must found the city');
assert.match(keybinds, /Toggle Build \/ Fight mode/, 'Alt must describe the contextual mode switch');

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

console.log('stabilization check passed: one front door; Build/Fight contexts are explicit');
