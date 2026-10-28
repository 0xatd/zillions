// Locks the presentation-only game feel: upgrade pop, hit recoil, wave
// moments, and the victory / defeat beat. These helpers must stay off the
// simulation random source and out of the lockstep hash.
import assert from 'node:assert/strict';
import { buildPop, hitImpulse, isBigEnemy, outcomeCue, waveCue } from '../src/juice.js';

const founded = buildPop(0, false);
assert.ok(founded.live && founded.y < 0.2, 'a new building rises from the ground');
assert.ok(buildPop(0.7, false).y === 1 && !buildPop(0.7, false).live, 'the rise settles');

const mid = buildPop(0.5 * 0.42, true);
assert.ok(mid.live && mid.y > 1.05, 'an upgrade pops above its settled height');
assert.ok(mid.x > 1 && mid.z > 1, 'the pop is a scale change, not only a slide');
const settled = buildPop(0.5, true);
assert.equal(settled.x, 1);
assert.equal(settled.y, 1);
assert.equal(settled.live, false);

const small = hitImpulse(false);
const big = hitImpulse(true);
assert.ok(small.knock > 0.15 && small.knock < 0.3, 'ordinary hits get a small knockback');
assert.equal(small.shake, 0, 'ordinary hits do not shake the screen');
assert.ok(big.knock > small.knock && big.shake > 0.2, 'big enemies hit harder and shake');

assert.equal(isBigEnemy({ type: 'walker', def: { scale: 1 } }), false);
assert.equal(isBigEnemy({ type: 'brute', def: { scale: 1.75 } }), true);
assert.equal(isBigEnemy({ type: 'sieger', def: { scale: 1.6 } }), true);
assert.equal(isBigEnemy({ type: 'boss', boss: true, def: { scale: 3 } }), true);

for (const type of ['surge', 'horde', 'roomwave', 'pursuit', 'boss']) {
  const cue = waveCue(type, { level: 4, wave: 2, stage: 3, final: true, name: 'The Butcher' });
  assert.ok(cue && cue.horn && cue.title && cue.punch !== 0 && cue.shake > 0, `${type} is a horn, a banner, and a camera beat`);
}
assert.match(waveCue('surge', { level: 4 }).title, /THREAT 4/);
assert.equal(waveCue('shot'), null);

const win = outcomeCue(true, { mode: 'campaign' });
const loss = outcomeCue(false, { mode: 'campaign', defeatCause: 'keep_destroyed', threat: 6 });
assert.equal(win.tone, 'win');
assert.equal(loss.tone, 'lose');
assert.ok(win.hold >= 1.4 && loss.hold >= 1.1, 'victory and defeat hold a moment before the card');
assert.ok(win.punch > 0 && loss.punch < 0, 'victory pulls back and defeat punches in');
assert.match(outcomeCue(false, { mode: 'labyrinth', defeatCause: 'party_exhausted' }).title, /NO ONE LEFT/);

console.log('juice check passed');
