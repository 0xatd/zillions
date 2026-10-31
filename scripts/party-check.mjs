import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';
import { SIM_DT, TILE } from '../src/config.js';
import { stateHash } from '../src/lockstep-hash.js';
import {
  ALLY_REVIVE_CHANNEL, ALLY_REVIVE_RANGE, allyMarker, coopPressure,
} from '../src/coop.js';
import {
  CHAT_CHANNELS, PROFANITY, maskProfanity, prepareChat,
} from '../src/social-chat.js';
import {
  addMember, canStart, createPartyState, firstFreeHero, handoff, inviteLink,
  kickMember, leaveParty, normalizePartyCode, partyCodeFromSearch, profileCard,
  setHero, setReady, setSetup,
} from '../src/party.js';

assert.equal(coopPressure(1), 1);
assert.equal(coopPressure(2), 1.4);
assert.equal(coopPressure(4), 2.2);
assert.equal(coopPressure(9), 2.2);

assert.equal(allyMarker({ name: 'Scott', dead: false }, { local: true }), null);
assert.equal(allyMarker({ name: 'Scott', dead: false }, { local: false }).text, 'Scott');
assert.equal(allyMarker({ name: 'Scott', dead: false }, { local: false }).sub, '');
assert.equal(allyMarker({ name: 'Alex', dead: true }, { local: false }).sub, 'DOWN');
assert.equal(allyMarker({ name: 'Alex', dead: true, fallen: true }, { local: false }), null);

const leader = '11111111-1111-1111-1111-111111111111';
const friend = '22222222-2222-2222-2222-222222222222';
const third = '33333333-3333-3333-3333-333333333333';
const party = createPartyState({ id: 'p', code: 'ab12cd', leaderId: leader, leaderName: 'ada', hero: 'scott' });
assert.equal(party.code, 'AB12CD');
assert.equal(normalizePartyCode(' ab-12 '), 'AB12');
assert.equal(partyCodeFromSearch('?party=zx90qr'), 'ZX90QR');
assert.equal(partyCodeFromSearch('?party=no'), null);
assert.equal(inviteLink('https://zillions.example', 'ab12cd'), 'https://zillions.example/?party=AB12CD');
assert.equal(addMember(party, { userId: friend, name: 'bea', hero: 'scott' }).ok, true);
assert.equal(party.members[1].hero, 'alexander');
assert.equal(setHero(party, friend, 'scott').reason, 'hero_taken');
assert.equal(setHero(party, friend, 'turtle').ok, true);
assert.equal(party.members[1].ready, false);
setReady(party, friend, true);
assert.equal(party.members[1].ready, true);
setSetup(party, leader, { levelId: 3, mode: 'campaign', difficulty: 'brutal' });
assert.equal(party.levelId, 3);
assert.equal(party.members[1].ready, false, 'a setup change clears ready');
assert.equal(canStart(party, friend).reason, 'not_leader');
assert.equal(canStart(party, leader).reason, 'need_ready');
setReady(party, friend, true);
assert.equal(canStart(party, leader).ok, true);
assert.equal(handoff(party, leader, friend).ok, true);
assert.equal(party.leaderId, friend);
assert.equal(kickMember(party, friend, leader).ok, true);
assert.equal(party.members.length, 1);
const again = addMember(party, { userId: third, name: 'cy' });
assert.equal(again.ok, true);
const left = leaveParty(party, friend);
assert.equal(left.dissolved, false);
assert.equal(party.leaderId, third);
assert.equal(leaveParty(party, third).dissolved, true);

const full = createPartyState({ id: 'f', code: 'FULL01', leaderId: leader, leaderName: 'ada' });
for (const id of ['a', 'b', 'c']) addMember(full, { userId: id, name: id });
assert.equal(full.members.length, 4);
assert.equal(addMember(full, { userId: 'd', name: 'd' }).reason, 'party_full');
const free = firstFreeHero(full.members);
assert.ok(free);
assert.equal(full.members.some((member) => member.hero === free), false);
assert.equal(firstFreeHero([{ hero: 'scott' }], 'scott'), 'alexander');

const labyrinth = createPartyState({ id: 'l', code: 'LAB111', leaderId: leader, leaderName: 'ada', mode: 'labyrinth', levelId: 1 });
assert.equal(setSetup(labyrinth, leader, { mode: 'labyrinth' }).ok, true);
assert.equal(labyrinth.levelId, 9001);
for (const id of ['a', 'b', 'c']) addMember(labyrinth, { userId: id, name: id });
for (const member of labyrinth.members) setReady(labyrinth, member.userId, true);
assert.equal(canStart(labyrinth, leader).reason, 'labyrinth_cap');

assert.equal(CHAT_CHANNELS.global.wired, false);
assert.equal(prepareChat('hello', { channel: 'global' }).error, 'channel_unavailable');
assert.equal(maskProfanity('oh Fuck'), 'oh ****');
assert.equal(prepareChat('  hello   there  ').text, 'hello there');
const recent = [];
let now = 1_000;
for (let i = 0; i < 4; i++) {
  const sent = prepareChat('hi', { now, recent });
  assert.equal(sent.ok, true);
  recent.splice(0, recent.length, ...sent.recent);
  now += 100;
}
assert.equal(prepareChat('hi', { now, recent }).error, 'rate');
assert.equal(prepareChat('hi', { muted: true }).error, 'muted');
for (const word of PROFANITY) assert.match(maskProfanity(word), /^\*+$/);

const card = profileCard({
  id: friend, handle: 'bea', selected_hero: 'alexander', favorite_hero: 'scott',
  level: 12, games_played: 4, wins: 2, campaign_cleared: 3,
});
assert.equal(card.name, 'bea');
assert.equal(card.hero, 'alexander');
assert.equal(card.level, 12);
assert.equal(card.planets, 3);
assert.equal(card.matches, 4);

function fakeMap() {
  const size = 32;
  return {
    size,
    seed: 4242,
    sites: [{ x: 8, z: 8 }],
    nestSpots: [],
    nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  };
}

const game = new Game(fakeMap(), 'normal', ['scott', 'alexander'], null, 1, 'campaign');
const down = game.heroes[0];
const ally = game.heroes[1];
const fallenAt = { x: down.x, z: down.z };
game._damageUnit(down, down.hp + 10);
assert.equal(down.dead, true);
assert.equal(game.units.includes(down), true);
ally.x = down.x + 1;
ally.z = down.z;
const steps = Math.ceil((ALLY_REVIVE_CHANNEL + 0.05) / SIM_DT);
for (let i = 0; i < steps; i++) game.update(SIM_DT);
assert.equal(down.dead, false);
assert.ok(Math.hypot(down.x - fallenAt.x, down.z - fallenAt.z) < ALLY_REVIVE_RANGE);

const far = new Game(fakeMap(), 'normal', ['scott', 'alexander'], null, 1, 'campaign');
far._damageUnit(far.heroes[0], far.heroes[0].hp + 10);
far.heroes[1].x = far.heroes[0].x + ALLY_REVIVE_RANGE + 2;
far.heroes[1].z = far.heroes[0].z;
for (let i = 0; i < steps; i++) far.update(SIM_DT);
assert.equal(far.heroes[0].dead, true, 'a friend out of reach leaves the Keep timer running');

const snapGame = new Game(fakeMap(), 'normal', ['scott', 'turtle'], null, 1, 'campaign');
snapGame._damageUnit(snapGame.heroes[0], snapGame.heroes[0].hp + 10);
snapGame.heroes[1].x = snapGame.heroes[0].x;
snapGame.heroes[1].z = snapGame.heroes[0].z;
snapGame.update(SIM_DT);
const mid = snapGame.snapshot();
const restored = new Game(fakeMap(), 'normal', ['scott', 'turtle'], mid, 1, 'campaign');
assert.equal(stateHash(snapGame), stateHash(restored));
assert.ok(restored.heroes[0].reviveHelp > 0);

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261031040000_parties.sql', import.meta.url), 'utf8');
assert.match(migration, /NOT APPLIED/);
assert.match(schema, /create table if not exists public.parties/);
assert.match(schema, /public_commander/);
for (const word of PROFANITY) assert.match(schema, new RegExp(word));
assert.match(readFileSync(new URL('../src/game.js', import.meta.url), 'utf8'), /coopPressure\(this\.heroKeys\.length\)/);

console.log('party check passed');
