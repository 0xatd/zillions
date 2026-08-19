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
const auth = read('src/auth.js');
const css = read('style.css');

// The signed-out front door uses standard provider labels. Enter World belongs
// to Character Select after authentication.
assert.match(ui, /id="a-google"[\s\S]*Continue with Google/, 'the signed-out front door must name the Google provider');
assert.match(ui, /id="a-email-form"[\s\S]*Continue with email/, 'the signed-out front door must support passwordless email sign-in');
assert.match(main, /showLoginBackdrop\(\)/, 'the login screen must start the animated orbital backdrop');
assert.match(main, /!this\.game && !this\.ow && this\.titleSpace[\s\S]*_updateTitleSpace\(t\)/,
  'the orbital title backdrop must animate while no world or battle is active');
assert.match(auth, /signInWithEmail\(email\)[\s\S]*signInWithOtp\([\s\S]*emailRedirectTo: `\$\{location\.origin\}\/`/,
  'email sign-in must use a same-origin passwordless magic link');
assert.doesNotMatch(ui, /id="a-enter"/, 'the signed-out login screen must never become signed-in account home');
assert.match(ui, /id="m-enter-world">ENTER WORLD</, 'Character Select must own Enter World');
assert.match(ui, /id="ow-custom-quick"[\s\S]*CUSTOM GAMES/, 'the overworld HUD must expose Custom Games without opening a nested menu');
assert.match(main, /showGateConfirm\([\s\S]*onEnter: \(diff\)[\s\S]*_launchGateMission\(ev\.gate, diff\)/,
  'a campaign gate must launch the selected map directly from ENTER MISSION');
assert.match(main, /status\.signedIn && !status\.needsUsername && !this\._authenticatedEntryHandled[\s\S]*_showScreen\('main'\)[\s\S]*showCharacterCreator\(\)/,
  'authenticated entry must open Character Select or character creation');
assert.match(main, /_createMmoCharacter[\s\S]*this\.ui\._showScreen\('main'\)/,
  'character creation must return to Character Select');
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
