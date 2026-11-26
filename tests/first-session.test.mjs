import assert from 'node:assert/strict';
import test from 'node:test';
import { edgeMarker, firstWaveApproach, pauseVeilHidden, retryAllowed } from '../src/combat-readability.js';
import { localRetryHeroes } from '../src/first-run.js';
import { matchBlocksShell } from '../src/shell-state.js';

test('abilities stay available: shell navigation cannot cover a live match with the title', () => {
  assert.equal(matchBlocksShell('account'), true);
  assert.equal(matchBlocksShell('main'), true);
  assert.equal(matchBlocksShell('quick'), true);
  assert.equal(matchBlocksShell('pause'), false);
  assert.equal(matchBlocksShell('help'), false);
  assert.equal(matchBlocksShell('settings'), false);
});

test('loss retry is the same solo mission for a guest or a signed-in leader', () => {
  assert.equal(retryAllowed({ mode: 'campaign', levelId: 1, unlocked: 1, hero: 'scott' }), true);
  assert.equal(retryAllowed({ netMode: true, mode: 'campaign', levelId: 1, unlocked: 1, hero: 'scott' }), false);
  assert.equal(retryAllowed({ mode: 'survival', levelId: 1, unlocked: 1, hero: 'scott' }), false);
  assert.equal(retryAllowed({ mode: 'campaign', levelId: 3, unlocked: 1, hero: 'scott' }), false);
  assert.ok(localRetryHeroes({ lastHero: 'alexander' }, 'scott').includes('scott'));
  assert.ok(localRetryHeroes({}, '').includes('alexander'));
});

test('the pause veil stays off the end screen and the crew label is not the game pause', () => {
  assert.equal(pauseVeilHidden({ paused: true, matchOver: true }), true);
  assert.equal(pauseVeilHidden({ paused: true, menusOpen: true }), true);
  assert.equal(pauseVeilHidden({ paused: true }), false);
  assert.equal(pauseVeilHidden({ paused: false }), true);
});

test('wave 1 direction is known before the wave spawns and points to a screen edge', () => {
  const opening = firstWaveApproach({
    over: false, phase: 'live',
    firstSiege: { stage: 'opening', nestId: 1 },
    nests: [{ x: 0, z: 0, alive: true }, { x: 80, z: 10, alive: true }],
    hq: { cx: 20, cz: 20 },
  });
  assert.equal(opening.label, 'First wave');
  assert.equal(opening.x, 80);
  assert.equal(firstWaveApproach({ ...{ over: false, phase: 'found', firstSiege: { stage: 'opening', nestId: 0 }, nests: [{ alive: true, x: 1, z: 1 }], hq: { cx: 0, cz: 0 } } }), null);
  const edge = edgeMarker(500, 0, 1000, 800, 40);
  assert.ok(edge.x > 900);
  assert.ok(Math.abs(edge.y - 400) < 1);
  assert.equal(edgeMarker(0, 0, 1000, 800), null);
});
