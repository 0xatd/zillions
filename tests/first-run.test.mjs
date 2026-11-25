import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CULTURE_ARMIES } from '../src/config.js';
import { HEROES } from '../src/config.js';
import {
  QUICK_DEFAULTS, TITLE_CLICKS, abilityBar, coachAdvance, coachApply, coachComplete,
  cultureExplain, fittedLabel, freshCoach, leaderHeroKey, leaderRoster, normalizeQuickSetup,
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

test('the leader grid is twelve names and four leaders can deploy', () => {
  const roster = leaderRoster();
  assert.equal(roster.length, 12);
  assert.deepEqual(roster.filter((leader) => leader.playable).map((leader) => leader.key), ['vanguard', 'alexander', 'aaron', 'tiger']);
  assert.ok(roster.every((leader) => leader.playable || leader.soon));
  assert.equal(leaderHeroKey('vanguard'), 'scott');
  assert.equal(leaderHeroKey('alexander'), 'alexander');
  const bar = abilityBar({ ability: { name: 'Gravity Hammer', icon: '🔨', desc: 'A circle.' }, tagline: 'Short range.', shotgun: true });
  assert.deepEqual(bar.map((slot) => slot.key), ['Q', 'W', 'E', 'R']);
  assert.equal(bar[0].name, 'Gravity Hammer');
  assert.equal(bar[2].state, 'reserved');
  for (const key of ['alexander', 'aaron', 'tiger']) {
    const kit = abilityBar(HEROES[key]);
    assert.deepEqual(kit.map((slot) => slot.key), ['Q', 'W', 'E', 'R']);
    assert.ok(kit.every((slot) => slot.state === 'ready' && slot.detail.length > 40), key);
    assert.match(kit[3].detail, /Ctrl\+Q/);
  }
  assert.equal(abilityBar(HEROES.alexander)[0].name, 'Trueflight');
  assert.equal(abilityBar(HEROES.tiger)[1].name, 'Stillpoint');
  assert.equal(abilityBar(HEROES.aaron)[3].name, 'Choir');
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

test('the bound pause action wins, and the mode key only resumes a pause', () => {
  assert.equal(pauseIntent({ paused: false, action: 'pause' }), 'ignore');
  assert.equal(pauseIntent({ paused: true, action: 'pause' }), 'resume');
  assert.equal(pauseIntent({ menuOpen: true, action: 'pause' }), 'resume-menu');
  assert.equal(pauseIntent({ paused: false, action: 'dodge' }), 'ignore');
  assert.equal(pauseIntent({ paused: true, action: 'dodge' }), 'resume');
  assert.equal(pauseIntent({ paused: true, action: 'menu' }), 'open-menu');
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf("const act = actionFor(binds, k, 'battle')");
  const handler = source.slice(start, source.indexOf('switch (act)', start));
  assert.match(handler, /pauseIntent\(\{[\s\S]*action: act/);
  assert.doesNotMatch(handler, /=== ' '/);
  assert.match(source.slice(start, start + 4000), /case 'pause':[\s\S]{0,120}setSpeed\(0\)/);
});

test('email sign-in clears its busy button when the request finishes', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async _signInWithEmail'), source.indexOf('async _signOut'));
  assert.match(fn, /finally[\s\S]*_clearBusy\(\)/);
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
