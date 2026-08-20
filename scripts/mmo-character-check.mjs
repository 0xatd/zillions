import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MMO_CLASSES, MMO_RACES, CREATOR_PARTS, makeMmoCharacter, normalizeMmoCharacters, selectedMmoCharacter,
  addMmoCharacter, characterCamp, grantMmoExperience, recordMmoInstance,
} from '../src/mmo-characters.js';
import { AuthClient } from '../src/auth.js';

assert.equal(Object.keys(MMO_CLASSES).length, 13, 'the MMO must expose all thirteen renamed class families');
assert.equal(MMO_CLASSES.vanguard.ready, true, 'Vanguard must be the first complete class slice');
assert.deepEqual(Object.keys(MMO_RACES), ['human', 'robot'], 'character creation must offer only Humans and Robots');
assert.ok(CREATOR_PARTS.human.face.length >= 4 && CREATOR_PARTS.robot.face.length >= 4,
  'both races need meaningful face choices');

const profile = { mmoCharacters: [], mmoCharacterId: null, relics: ['relic'] };
normalizeMmoCharacters(profile);
assert.equal(selectedMmoCharacter(profile), null, 'new accounts must create a character instead of inheriting a named hero');

const vanguard = makeMmoCharacter('  Nova   Vale  ', 'vanguard', 'crimson');
assert.equal(vanguard.name, 'Nova Vale');
assert.equal(vanguard.proxyHero, 'scott');
assert.equal(vanguard.raceKey, 'human');
assert.equal(vanguard.entitlements.tier, 'free');
const robot = makeMmoCharacter('Unit Seven', 'engineer', 'cobalt', 'robot', { face: 'tri-eye', body: 'bulwark' });
assert.equal(robot.raceKey, 'robot');
assert.equal(robot.customization.face, 'tri-eye');
assert.ok(addMmoCharacter(profile, vanguard));
assert.equal(selectedMmoCharacter(profile), vanguard);

const camp = characterCamp(vanguard, profile.relics);
assert.deepEqual(camp.relics, ['relic']);
assert.equal(camp.level, 1);
assert.equal(camp.characterStyle.classKey, 'vanguard',
  'combat must receive the same class-role silhouette used by creator, paper doll and overworld');

const levels = grantMmoExperience(vanguard, 1000000);
assert.ok(levels.length > 1, 'large awards must cross multiple levels safely');
assert.ok(vanguard.level <= 100, 'character levels must cap at 100');
assert.equal(vanguard.talentPoints, vanguard.level - 1, 'every earned level must grant one talent point');

const before = vanguard.items.length;
const result = recordMmoInstance(vanguard, { won: true, kills: 200, xp: 50, world: 'frontier-7', items: ['optic', 'optic'] });
assert.equal(vanguard.stats.instances, 1);
assert.equal(vanguard.stats.victories, 1);
assert.equal(vanguard.stats.kills, 200);
assert.equal(vanguard.lastWorld, 'frontier-7');
assert.equal(vanguard.items.length, before + 1, 'instance extraction must deduplicate equipment');
assert.deepEqual(result.items, ['optic']);

const auth = new AuthClient();
auth.session = { user: { user_metadata: {
  last_world: 'frontier-7',
  mmo_character_id: vanguard.id,
  mmo_characters: [vanguard],
} } };
const cloudProfile = auth.profileFromBundle({
  profile: { handle: 'nova', username_set: true },
  stats: { games_played: 2 },
});
assert.equal(cloudProfile.mmoCharacterId, vanguard.id, 'signed-in auth must restore the selected MMO character');
assert.deepEqual(cloudProfile.mmoCharacters, [vanguard], 'signed-in auth must restore the MMO roster');
assert.equal(cloudProfile.lastWorld, 'frontier-7', 'signed-in auth must restore the character world');

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSource, /const titleCharacter = selectedMmoCharacter\(this\.profile\);/,
  'the title stage must be driven by the created MMO roster');
assert.match(mainSource, /titleHero\.visible = !!titleCharacter;/,
  'an empty MMO roster must not show a legacy named hero on the character screen');
assert.match(mainSource, /const showTitleCharacter = !!selectedMmoCharacter\(this\.profile\);/,
  'the title stage must react when cloud auth restores a created character');
assert.doesNotMatch(mainSource, /const heroKey = this\.profile\.lastHero \|\| this\.ui\.selectedHero/,
  'the title stage must not fall back to Custom Games heroes');


// A profile blob is untrusted input. Hostile keys must normalise away rather
// than resolving through Object.prototype or throwing.
{
  const hostile = {
    id: 'mmo_bad', name: 'x'.repeat(500), classKey: 'recon', level: 9e9,
    items: [null, 42, {}, '__proto__', 'constructor', 'scatter_mk1:zz:999:9'],
    equipment: { weapon: '__proto__', armor: 42, nope: 'x', implant1: 'constructor' },
    lattice: ['__proto__', 'constructor', 'o_recon', 99],
    latticeSets: { __proto__: 1, constructor: 0 },
    activeSet: 99, questPoints: -5, upgrades: null, stats: null,
  };
  const profile = { mmoCharacters: [hostile], mmoCharacterId: 'mmo_bad' };
  normalizeMmoCharacters(profile);
  assert.equal(hostile.level, 100, 'level must clamp');
  assert.deepEqual(hostile.lattice, [], 'hostile allocation must normalise away');
  assert.equal(Object.keys(hostile.equipment).length, 0, 'hostile equipment must normalise away');
  assert.equal(hostile.activeSet, 0, 'active set must clamp to a real set');
  assert.equal(hostile.questPoints, 0, 'quest points must floor at zero');
  assert.equal({}.polluted, undefined, 'normalizing must not pollute Object.prototype');
  const camp = characterCamp(hostile);
  assert.ok(Array.isArray(camp.treeSets) && camp.treeSets.length === 2, 'camp must still resolve');
  assert.ok(camp.items.every((k) => typeof k === 'string'), 'camp items must all be real keys');

  // A class key that only exists on Object.prototype is not a class.
  const fake = { id: 'x', name: 'x', classKey: 'constructor', level: 5 };
  const p2 = { mmoCharacters: [fake], mmoCharacterId: 'x' };
  normalizeMmoCharacters(p2);
  assert.equal(p2.mmoCharacters.length, 0, 'a prototype key was accepted as a class');
}

console.log('MMO character check passed: 13 classes, persistent Vanguard, level-100 cap, loot extraction');
