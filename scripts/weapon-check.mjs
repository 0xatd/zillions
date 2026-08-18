// Weapons left the hero definition. This check exists to prove that move cost
// nothing: an unequipped hero must fight with exactly the numbers they had
// before weapons existed, and an equipped one must actually change.
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import {
  HEROES, SIGNATURE_WEAPONS, signatureWeapon, weaponFor, TILE, heroGrowthUnits,
} from '../src/config.js';
import { rollItemKey, resolveItem, ITEM_BASES } from '../src/items.js';

let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

function fakeMap() {
  const size = 48;
  return {
    size, seed: 4242, sites: [], nestSpots: [], nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  };
}
const makeGame = (heroKeys) => new Game(fakeMap(), 'normal', heroKeys, null, 1, 'campaign');

// ---------- a signature weapon is the hero's own numbers ----------
for (const [key, def] of Object.entries(HEROES)) {
  const w = signatureWeapon(key);
  ok(w, `${key}: no signature weapon`);
  ok(w.dmg === def.dmg, `${key}: signature damage ${w.dmg} != hero ${def.dmg}`);
  ok(w.rof === def.rof, `${key}: signature rof ${w.rof} != hero ${def.rof}`);
  ok(w.range === def.range, `${key}: signature range ${w.range} != hero ${def.range}`);
  ok(w.splash === (def.splash || 0), `${key}: signature splash drifted`);
  ok(w.shotgun === !!def.shotgun, `${key}: signature lost the shotgun flag`);
  ok(w.melee === !!def.melee, `${key}: signature lost the melee flag`);
  ok(w.noise === (def.noise || 0), `${key}: signature noise drifted`);
  ok(w.critChance === (def.critChance || 0), `${key}: signature crit chance drifted`);
  ok(w.critMult === (def.critMult || 1.75), `${key}: signature crit multiplier drifted`);
  ok(Math.abs((w.types.kinetic || 0) - 1) < 1e-9, `${key}: signature must be pure kinetic`);
  ok(SIGNATURE_WEAPONS[key], `${key}: missing from SIGNATURE_WEAPONS`);
}

// ---------- an unequipped hero is unchanged ----------
// This reproduces the formula as it stood before the split. If weapons ever
// start moving a bare hero's damage or range, this fails.
const heroKeys = Object.keys(HEROES);
{
  const game = makeGame(heroKeys);
  for (const h of game.heroes) {
    const def = HEROES[h.key];
    for (const level of [1, 10, 40, 100]) {
      h.level = level;
      game._refreshHeroDerived(h, false);
      const expectedDmg = (def.dmg + def.levelDmg * heroGrowthUnits(level)) * (1 + h.mods.dmg);
      const expectedRange = def.range + (h.mods.range || 0);
      ok(Math.abs(game.heroDmg(h) - expectedDmg) < 1e-9,
        `${h.key} L${level}: bare damage ${game.heroDmg(h)} != pre-weapon ${expectedDmg}`);
      ok(Math.abs(game.heroRange(h) - expectedRange) < 1e-9,
        `${h.key} L${level}: bare range ${game.heroRange(h)} != pre-weapon ${expectedRange}`);
      ok(Math.abs(game.heroStats(h).rate - def.rof * (1 + h.mods.rof)) < 1e-9,
        `${h.key} L${level}: bare attack rate drifted`);
    }
  }
}

// ---------- an equipped hero actually changes ----------
{
  const rifleKey = rollItemKey('marksman_mk3', 'weapon-check', 60, 1);
  const rifle = resolveItem(rifleKey);
  const game = makeGame(['scott']);
  const h = game.heroes[0];
  const bareRange = game.heroRange(h);
  h.equipment = { weapon: rifleKey };
  game._refreshHeroDerived(h, false);
  ok(game.heroRange(h) === rifle.weapon.range, 'equipped weapon did not set hero range');
  ok(game.heroRange(h) > bareRange, 'a rifle did not out-range a scattergun');
  ok(h.weapon.melee === undefined || h.weapon.melee === false, 'a rifle reported melee');
  ok(!h.weapon.shotgun, "an equipped rifle kept the hero's shotgun flag");

  // Unequipping returns the hero to their signature, exactly.
  h.equipment = {};
  game._refreshHeroDerived(h, false);
  ok(game.heroRange(h) === bareRange, 'unequipping did not restore the signature weapon');
  ok(h.weapon.signature, 'unequipped hero is not on their signature weapon');
}

// ---------- equipment survives snapshot and restore ----------
// A restored hero must hold the same weapon, or a rejoining peer diverges.
{
  const axeKey = rollItemKey('chainblade_mk2', 'snap', 40, 2);
  const game = makeGame(['alexander']);
  const h = game.heroes[0];
  h.equipment = { weapon: axeKey };
  game._refreshHeroDerived(h, false);
  const beforeDmg = game.heroDmg(h);
  const beforeRange = game.heroRange(h);

  const snap = game.snapshot();
  ok(snap.heroes[0].equip && snap.heroes[0].equip.weapon === axeKey, 'snapshot dropped equipment');

  const restored = new Game(fakeMap(), 'normal', ['alexander'], snap, 1, 'campaign');
  const rh = restored.heroes[0];
  ok(rh.equipment.weapon === axeKey, 'restore dropped equipment');
  ok(Math.abs(restored.heroDmg(rh) - beforeDmg) < 1e-9, 'restored hero damage diverged');
  ok(Math.abs(restored.heroRange(rh) - beforeRange) < 1e-9, 'restored hero range diverged');
}

// ---------- a bad or illegal key never breaks a hero ----------
for (const bad of [{ weapon: 'not_a_key' }, { weapon: 'flak_plate:1:1:1' }, { weapon: '' }, {}, null]) {
  const game = makeGame(['turtle']);
  const h = game.heroes[0];
  h.equipment = bad;
  let threw = false;
  try { game._refreshHeroDerived(h, false); } catch { threw = true; }
  ok(!threw, `equipment ${JSON.stringify(bad)} threw`);
  ok(h.weapon && h.weapon.dmg > 0, `equipment ${JSON.stringify(bad)} left the hero without a weapon`);
}
// Armour in the weapon slot must not become a weapon.
ok(weaponFor('turtle', { weapon: rollItemKey('flak_plate', 'x', 10, 1) }).signature,
  'a non-weapon in the weapon slot was wielded');

// ---------- weapon bases are wieldable ----------
for (const [baseKey, base] of Object.entries(ITEM_BASES)) {
  if (base.slot !== 'weapon') continue;
  const item = resolveItem(rollItemKey(baseKey, `wield-${baseKey}`, base.ilvl, 1));
  ok(item.weapon.dmg > 0 && item.weapon.rof > 0 && item.weapon.range > 0, `${baseKey}: unusable weapon block`);
  const game = makeGame(['scott']);
  const h = game.heroes[0];
  h.equipment = { weapon: item.key };
  game._refreshHeroDerived(h, false);
  ok(game.heroDmg(h) > 0, `${baseKey}: equipping produced no damage`);
  ok(game.heroStats(h).rate > 0, `${baseKey}: equipping produced no attack rate`);
}

if (failures) {
  console.error(`\nweapon-check: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`weapon-check: ok (${heroKeys.length} signatures byte-identical, equip/unequip/restore hold)`);
