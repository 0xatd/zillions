// Two weapon sets. The swap is a lockstep command, so it has to be refused
// identically on every peer and survive a snapshot mid-cooldown.
import { Game } from '../src/game.js';
import { TILE, WEAPON_SWAP_CD, weaponFor, hasSecondSet } from '../src/config.js';
import { rollItemKey, resolveItem, EQUIP_SLOTS, WEAPON_SETS, slotPool } from '../src/items.js';
import {
  makeMmoCharacter, normalizeMmoCharacters, characterCamp,
  allocateLatticeNode, setLatticeNodeSet,
} from '../src/mmo-characters.js';
import { frontier, buildLattice, treeBonusesForSet, normalizeSetSpec } from '../src/skilltree.js';

let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

function fakeMap() {
  const size = 48;
  return {
    size, seed: 2468, sites: [], nestSpots: [], nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: () => true, isBuildable: () => true, isWalkable: () => true,
  };
}
const makeGame = (camp = null, snap = null) => {
  const game = new Game(fakeMap(), 'normal', ['scott'], snap, 1, 'campaign');
  if (camp && !snap) {
    game.heroes.length = 0; game.units.length = 0; game.hero = null;
    game._spawnHero('scott', 10, 10, camp);
  }
  return game;
};

const scatter = rollItemKey('scatter_mk2', 'set-a', 40, 1);
const rifle = rollItemKey('marksman_mk2', 'set-b', 40, 1);

// ---------- slots ----------
ok(EQUIP_SLOTS.includes('weapon2') && EQUIP_SLOTS.includes('offhand2'), 'the second set has no slots');
ok(slotPool('weapon2') === 'weapon', 'weapon2 does not draw from the weapon pool');
ok(slotPool('offhand2') === 'offhand', 'offhand2 does not draw from the off-hand pool');
ok(WEAPON_SETS.length === 2, 'there must be exactly two sets');
ok(!hasSecondSet({ weapon: scatter }), 'one weapon reported a second set');
ok(hasSecondSet({ weapon: scatter, weapon2: rifle }), 'a second weapon was not seen');

// ---------- the two sets resolve to different weapons ----------
{
  const equipment = { weapon: scatter, weapon2: rifle };
  ok(weaponFor('scott', equipment, 0).range === resolveItem(scatter).weapon.range, 'set I resolved wrong');
  ok(weaponFor('scott', equipment, 1).range === resolveItem(rifle).weapon.range, 'set II resolved wrong');
  ok(weaponFor('scott', equipment, 1).range > weaponFor('scott', equipment, 0).range, 'the sets are not different');
  // An empty second set still resolves to something wieldable.
  ok(weaponFor('scott', { weapon: scatter }, 1).signature, 'an empty set II did not fall back to the signature');
}

// ---------- swapping in the field ----------
{
  const game = makeGame({ level: 20, equipment: { weapon: scatter, weapon2: rifle } });
  const hero = game.heroes[0];
  const setOneRange = game.heroRange(hero);
  ok(hero.activeSet === 0, 'a hero did not start on set I');

  game.swapWeaponSet(0);
  ok(hero.activeSet === 1, 'the swap did not change the drawn set');
  const setTwoRange = game.heroRange(hero);
  ok(setTwoRange !== setOneRange, 'swapping did not change the hero');
  ok(hero.swapCd > 0, 'the swap set no cooldown');

  // Refused while on cooldown — and refused the same way on every peer.
  game.swapWeaponSet(0);
  ok(hero.activeSet === 1, 'a swap on cooldown went through');

  // The cooldown runs down and the swap comes back.
  for (let i = 0; i < Math.ceil(WEAPON_SWAP_CD * 31); i++) game.update(1 / 30);
  ok(hero.swapCd === 0, `the swap cooldown did not clear (${hero.swapCd})`);
  game.swapWeaponSet(0);
  ok(hero.activeSet === 0, 'the swap did not come back off cooldown');
  ok(Math.abs(game.heroRange(hero) - setOneRange) < 1e-9, 'swapping back did not restore set I');

  // A hero with one set cannot swap at all.
  const solo = makeGame({ level: 20, equipment: { weapon: scatter } });
  solo.swapWeaponSet(0);
  ok(solo.heroes[0].activeSet === 0, 'a hero with no second set swapped anyway');
}

// ---------- the command path ----------
// The swap must travel as a command, or peers swap on different ticks.
{
  const game = makeGame({ level: 20, equipment: { weapon: scatter, weapon2: rifle } });
  game.exec({ t: 'swapset', p: 0 });
  ok(game.heroes[0].activeSet === 1, 'the swapset command did nothing');
}

// ---------- snapshot ----------
{
  const camp = { level: 20, equipment: { weapon: scatter, weapon2: rifle } };
  const game = makeGame(camp);
  game.swapWeaponSet(0);
  game.update(1 / 30);
  const drawn = game.heroRange(game.heroes[0]);
  const cooldown = game.heroes[0].swapCd;

  const snap = game.snapshot();
  ok(snap.heroes[0].set === 1, 'the snapshot lost the drawn set');
  const restored = new Game(fakeMap(), 'normal', ['scott'], snap, 1, 'campaign');
  const rh = restored.heroes[0];
  ok(rh.activeSet === 1, 'restore lost the drawn set');
  ok(Math.abs(restored.heroRange(rh) - drawn) < 1e-9, 'a restored hero drew the wrong weapon');
  ok(Math.abs(rh.swapCd - cooldown) < 1e-6, 'restore lost the swap cooldown');
}

// ---------- set-pinned Lattice nodes ----------
{
  const character = makeMmoCharacter('Pin', 'vanguard');
  character.level = 40;
  const profile = { mmoCharacters: [character], mmoCharacterId: character.id };
  normalizeMmoCharacters(profile);
  for (let i = 0; i < 12; i++) allocateLatticeNode(character, [...frontier(character.lattice, 'vanguard')][0]);

  const shared = treeBonusesForSet(character.lattice, 'vanguard', {}, 0).mods;
  const pinnedNode = character.lattice.find((id) => {
    const node = buildLattice().byId.get(id);
    return node && Object.values(node.mods || {}).some((v) => v);
  });
  ok(pinnedNode, 'no allocated node carried any bonus to pin');
  ok(setLatticeNodeSet(character, pinnedNode, 1), 'pinning failed');
  ok(character.latticeSets[pinnedNode] === 1, 'the pin was not recorded');

  const setOne = treeBonusesForSet(character.lattice, 'vanguard', character.latticeSets, 0).mods;
  const setTwo = treeBonusesForSet(character.lattice, 'vanguard', character.latticeSets, 1).mods;
  const differs = Object.keys(setOne).some((k) => Math.abs(setOne[k] - setTwo[k]) > 1e-9);
  ok(differs, 'pinning a node to set II did not change what set I grants');
  const stillShared = Object.keys(setTwo).every((k) => Math.abs(setTwo[k] - shared[k]) < 1e-9);
  ok(stillShared, 'the pinned set lost something it should still have');

  // Releasing the pin puts it back in both.
  setLatticeNodeSet(character, pinnedNode, null);
  const released = treeBonusesForSet(character.lattice, 'vanguard', character.latticeSets, 0).mods;
  ok(Object.keys(released).every((k) => Math.abs(released[k] - shared[k]) < 1e-9), 'releasing a pin did not restore it');

  // A pin on a node that is not owned is dropped.
  ok(Object.keys(normalizeSetSpec({ nope: 1 }, character.lattice)).length === 0, 'a pin survived on an unowned node');
  ok(Object.keys(normalizeSetSpec({ [pinnedNode]: 7 }, character.lattice)).length === 0, 'a pin to a nonexistent set survived');

  // And the camp carries one resolved bag per set, so the run never walks the tree.
  setLatticeNodeSet(character, pinnedNode, 1);
  const camp = characterCamp(character);
  ok(Array.isArray(camp.treeSets) && camp.treeSets.length === 2, 'the camp does not carry a bag per set');
  ok(JSON.stringify(camp.treeSets[0]) !== JSON.stringify(camp.treeSets[1]), 'both camp bags are identical despite a pin');
}

// ---------- a pinned node actually reaches the hero on swap ----------
{
  const camp = {
    level: 20,
    equipment: { weapon: scatter, weapon2: rifle },
    treeSets: [{ dmg: 0 }, { dmg: 0.5 }],
    activeSet: 0,
  };
  const game = makeGame(camp);
  const hero = game.heroes[0];
  const before = hero.mods.dmg;
  game.swapWeaponSet(0);
  ok(hero.mods.dmg > before, 'swapping to a set with a pinned damage node did not change the hero');
  game.heroes[0].swapCd = 0;
  game.swapWeaponSet(0);
  ok(Math.abs(hero.mods.dmg - before) < 1e-9, 'swapping back did not remove the pinned bonus');
}

if (failures) {
  console.error(`\nweapon-set-check: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`weapon-set-check: ok (two sets, ${WEAPON_SWAP_CD}s swap, pins hold through camp and restore)`);
