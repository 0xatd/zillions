import test from 'node:test';
import assert from 'node:assert/strict';
import { NavRouter, ROUTES, SCREEN_TO_ROUTE } from '../src/nav/router.js';
import { MODES, modeById, modesForTab } from '../src/modes.js';

test('back returns through the stack and closes the modal first', () => {
  const nav = new NavRouter();
  nav.push('characters');
  nav.push('home');
  nav.push('overworld');
  nav.push('setup');
  assert.equal(nav.back().current, 'overworld');
  nav.openModal('confirm');
  assert.equal(nav.back().modal, null);
  assert.equal(nav.current().name, 'overworld');
  assert.equal(nav.back().current, 'home');
});

test('replace clears the stack and a repeat push truncates back to that route', () => {
  const nav = new NavRouter();
  nav.push('home');
  nav.push('squad');
  nav.push('armory');
  nav.push('home');
  assert.deepEqual(nav.snapshot().stack.map((entry) => entry.name), ['title', 'home']);
  nav.replace('characters');
  assert.deepEqual(nav.snapshot().stack.map((entry) => entry.name), ['characters']);
  assert.equal(nav.screen(), 'main');
});

test('legacy screen names land on one route, including the merged lobby', () => {
  const nav = new NavRouter();
  assert.equal(SCREEN_TO_ROUTE.lobby, 'custom');
  nav.push('lobby');
  assert.equal(nav.current().name, 'custom');
  assert.equal(nav.screen(), 'custom');
  nav.push('main');
  assert.equal(nav.current().name, 'characters');
});

test('a match blocks menu routes and still allows pause, settings, help, and results', () => {
  const nav = new NavRouter();
  nav.push('home');
  nav.enterMatch();
  assert.equal(nav.snapshot().inMatch, true);
  assert.throws(() => nav.push('home'), /route_blocked_in_match:home/);
  assert.throws(() => nav.push('overworld'), /route_blocked_in_match:overworld/);
  nav.push('pause');
  nav.push('settings');
  assert.equal(nav.back().current, 'pause');
  nav.push('help');
  nav.push('results');
  assert.equal(nav.current().name, 'results');
  assert.equal(nav.leaveMatch('overworld').current, 'overworld');
  assert.equal(nav.snapshot().inMatch, false);
});

test('toasts queue and cap at four', () => {
  const nav = new NavRouter();
  for (let i = 0; i < 6; i++) nav.toast(`note ${i}`, { severity: i === 5 ? 'bad' : 'info', ttl: 1000 });
  assert.equal(nav.snapshot().toasts.length, 4);
  assert.equal(nav.snapshot().toasts[0].text, 'note 2');
  assert.equal(nav.snapshot().toasts.at(-1).severity, 'bad');
  nav.dismissToast(nav.toasts[0].id);
  assert.equal(nav.toasts.length, 3);
});

test('every route the match table names is a real route', () => {
  for (const [name, route] of Object.entries(ROUTES)) {
    assert.equal(typeof route.match, 'boolean', name);
    if (route.match && name !== 'match' && name !== 'loading') assert.ok(route.screen, name);
  }
});

test('the mode registry covers the play tabs and marks unbuilt modes', () => {
  for (const tab of ['campaign', 'coop', 'versus', 'custom']) {
    assert.ok(modesForTab(tab).length >= 1, tab);
  }
  assert.equal(modeById('campaign').status, 'built');
  assert.equal(modeById('survival').buttonId, 'solo-survival');
  assert.equal(modeById('ranked').status, 'coming-soon');
  assert.equal(modeById('ranked').ranked, true);
  assert.equal(modeById('skirmish').status, 'coming-soon');
  assert.ok(MODES.every((mode) => mode.id && mode.name && mode.players && mode.status && Array.isArray(mode.setup)));
});

test('replace enforces the same match boundary as push', () => {
 const nav = new NavRouter();
 assert.throws(()=>nav.replace('match'), /route_blocked/);
 nav.enterMatch();
 for (const route of ['characters','create','custom','overworld']) assert.throws(()=>nav.replace(route), /route_blocked/);
 assert.equal(nav.current().name,'match');
 assert.equal(nav.leaveMatch('characters').current,'characters');
});
