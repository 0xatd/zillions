import assert from 'node:assert/strict';
import test from 'node:test';
import { CULTURE_ARMIES } from '../src/config.js';
import {
  QUICK_DEFAULTS, TITLE_CLICKS, abilityBar, coachAdvance, coachApply, coachComplete,
  cultureExplain, fittedLabel, freshCoach, leaderRoster, normalizeQuickSetup,
  pauseIntent, randomizeQuickSetup,
} from '../src/first-run.js';

test('quick setup defaults are legal and randomize stays inside them', () => {
  const draft = normalizeQuickSetup({});
  assert.deepEqual(draft, QUICK_DEFAULTS);
  const sequence = [0.1, 0.9, 0.4, 0.2, 0.8, 0.6];
  let i = 0;
  const rolled = randomizeQuickSetup(() => sequence[i++ % sequence.length]);
  const clean = normalizeQuickSetup(rolled);
  assert.equal(clean.chapterName, rolled.chapterName);
  assert.ok(Object.hasOwn(CULTURE_ARMIES, clean.army));
  assert.equal(normalizeQuickSetup({ chapterName: '  ', founderName: '', army: 'nope', difficulty: 'easy' }).chapterName, 'First Landing');
});

test('each army culture says what it changes', () => {
  for (const key of Object.keys(CULTURE_ARMIES)) {
    const explained = cultureExplain(key);
    assert.ok(explained.summary.length > 20, key);
    assert.ok(explained.changes.length > 20, key);
  }
  assert.match(cultureExplain('european').changes, /baseline/);
  assert.match(cultureExplain('asian').changes, /Evades 8%/);
  assert.match(cultureExplain('south_american').changes, /armour/);
  assert.match(cultureExplain('middle_eastern').changes, /Longest range/);
});

test('the leader grid is twelve names and only Vanguard can deploy', () => {
  const roster = leaderRoster();
  assert.equal(roster.length, 12);
  assert.deepEqual(roster.filter((leader) => leader.playable).map((leader) => leader.key), ['vanguard']);
  assert.ok(roster.every((leader) => leader.playable || leader.soon));
  const bar = abilityBar({ ability: { name: 'Gravity Hammer', icon: '🔨', desc: 'A circle.' }, tagline: 'Short range.', shotgun: true });
  assert.deepEqual(bar.map((slot) => slot.key), ['Q', 'W', 'E', 'R']);
  assert.equal(bar[0].name, 'Gravity Hammer');
  assert.equal(bar[2].state, 'reserved');
});

test('the coach waits for the current lesson', () => {
  let coach = freshCoach();
  coach = coachApply(coach, [{ type: 'founded' }, { type: 'attack' }, { type: 'stance', stance: 'attack' }]);
  assert.equal(coach.index, 0, 'founding early does not skip movement');
  coach = coachAdvance(coach, { type: 'move' });
  assert.equal(coach.index, 2, 'an early founding satisfies the next lesson');
  coach = coachAdvance(coach, { type: 'built' });
  assert.equal(coach.index, 3);
  coach = coachAdvance(coach, { type: 'mode' });
  coach = coachAdvance(coach, { type: 'attack' });
  for (const stance of ['defend', 'guard', 'attack']) coach = coachAdvance(coach, { type: 'stance', stance });
  assert.equal(coachComplete(coach), true);
});

test('space resumes a pause and does not steal the live battle binding', () => {
  assert.equal(pauseIntent({ paused: false, key: 'space' }), 'ignore');
  assert.equal(pauseIntent({ paused: false, key: 'pause' }), 'pause');
  assert.equal(pauseIntent({ paused: true, key: 'space' }), 'resume');
  assert.equal(pauseIntent({ paused: true, key: 'pause' }), 'resume');
  assert.equal(pauseIntent({ menuOpen: true, key: 'space' }), 'resume-menu');
});

test('node labels keep the full place name', () => {
  const fitted = fittedLabel('OLD CROSSROADS');
  assert.equal(fitted.text, 'OLD CROSSROADS');
  assert.ok(fitted.text.length * fitted.size * 0.62 <= fitted.width - 24);
  assert.doesNotMatch(fitted.text, /^LD /);
});

test('a new guest reaches play in two clicks and a returning guest skips setup', () => {
  assert.deepEqual(TITLE_CLICKS.afterNew, ['Play', 'Start']);
  assert.equal(TITLE_CLICKS.afterReturning.length, 1);
  assert.ok(TITLE_CLICKS.before.length >= 7);
});
