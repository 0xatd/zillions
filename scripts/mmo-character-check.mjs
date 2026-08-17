import assert from 'node:assert/strict';
import {
  MMO_CLASSES, makeMmoCharacter, normalizeMmoCharacters, selectedMmoCharacter,
  addMmoCharacter, characterCamp, grantMmoExperience, recordMmoInstance,
} from '../src/mmo-characters.js';

assert.equal(Object.keys(MMO_CLASSES).length, 13, 'the MMO must expose all thirteen renamed class families');
assert.equal(MMO_CLASSES.vanguard.ready, true, 'Vanguard must be the first complete class slice');

const profile = { mmoCharacters: [], mmoCharacterId: null, relics: ['relic'] };
normalizeMmoCharacters(profile);
assert.equal(selectedMmoCharacter(profile), null, 'new accounts must create a character instead of inheriting a named hero');

const vanguard = makeMmoCharacter('  Nova   Vale  ', 'vanguard', 'crimson');
assert.equal(vanguard.name, 'Nova Vale');
assert.equal(vanguard.proxyHero, 'scott');
assert.ok(addMmoCharacter(profile, vanguard));
assert.equal(selectedMmoCharacter(profile), vanguard);

const camp = characterCamp(vanguard, profile.relics);
assert.deepEqual(camp.relics, ['relic']);
assert.equal(camp.level, 1);

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

console.log('MMO character check passed: 13 classes, persistent Vanguard, level-100 cap, loot extraction');
