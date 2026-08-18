// Item generation invariants. The gear layer is only safe because generation
// is pure, total, and stable — this file is what proves it stays that way.
import {
  ITEM_BASES, AFFIXES, MOD_KEYS, DAMAGE_TYPES, RARITIES, BASES_BY_SLOT,
  rollItemKey, parseItemKey, resolveItem, isRolledKey, rolledMods,
  rollLootKey, rollLootKeyForSlot, worldItemLevel, slotsForPool, slotPool, EQUIP_SLOTS, equippedKeys, hasOwn,
  meetsRequirement, itemLines, applyLocal, hashString,
} from '../src/items.js';
import { ITEMS, itemMods, itemInfo } from '../src/config.js';

let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

// ---------- bases ----------
for (const [key, base] of Object.entries(ITEM_BASES)) {
  ok(base.name, `${key}: no name`);
  ok(base.icon, `${key}: no icon`);
  ok(['weapon', 'offhand', 'armor', 'implant'].includes(base.slot), `${key}: bad slot ${base.slot}`);
  ok(Number.isFinite(base.ilvl) && base.ilvl >= 1, `${key}: bad base ilvl`);
  if (base.slot === 'weapon') {
    ok(base.w, `${key}: weapon base with no weapon block`);
    ok(base.w.dmg > 0 && base.w.rof > 0 && base.w.range > 0, `${key}: weapon needs dmg, rof and range`);
    const total = DAMAGE_TYPES.reduce((s, t) => s + (base.w.types[t] || 0), 0);
    ok(Math.abs(total - 1) < 1e-9, `${key}: damage type split sums to ${total}, must be 1`);
    ok(base.class, `${key}: weapon with no class`);
  } else {
    ok(!base.w, `${key}: non-weapon carries a weapon block`);
  }
  for (const k of Object.keys(base.implicit || {})) {
    ok(MOD_KEYS.includes(k), `${key}: implicit uses unknown mod key ${k}`);
  }
  for (const k of Object.keys(base.req || {})) {
    ok(['frame', 'reflex', 'signal'].includes(k), `${key}: requires unknown attribute ${k}`);
  }
}
for (const slot of ['weapon', 'offhand', 'armor', 'implant']) {
  ok(BASES_BY_SLOT[slot].length > 0, `no bases for slot ${slot}`);
}

// ---------- affixes ----------
const WEAPON_LOCAL_KEYS = new Set(['dmg', 'rof', 'range', 'splash', 'critChance', 'critMult', ...DAMAGE_TYPES]);
for (const affix of AFFIXES) {
  ok(affix.id && affix.word, `affix ${affix.id}: needs id and word`);
  ok(['prefix', 'suffix'].includes(affix.kind), `${affix.id}: bad kind`);
  ok(affix.group, `${affix.id}: no group — cannot dedupe`);
  ok(Array.isArray(affix.t) && affix.t.length, `${affix.id}: no tiers`);
  let last = 0;
  for (const [min, mods] of affix.t) {
    ok(min > last || last === 0, `${affix.id}: tiers must be authored low to high`);
    last = min;
    for (const k of Object.keys(mods)) {
      if (affix.local) ok(WEAPON_LOCAL_KEYS.has(k), `${affix.id}: local roll uses non-weapon key ${k}`);
      else ok(MOD_KEYS.includes(k), `${affix.id}: unknown mod key ${k}`);
    }
  }
  if (affix.local) ok(affix.slots.every((s) => s === 'weapon'), `${affix.id}: local affix on a non-weapon slot`);
}

// ---------- keys resolve, and resolve the same way twice ----------
const sample = [];
for (const baseKey of Object.keys(ITEM_BASES)) {
  for (const ilvl of [1, 25, 60, 100]) {
    for (const rarity of [1, 2, 3]) {
      const key = rollItemKey(baseKey, `${baseKey}-${ilvl}-${rarity}`, ilvl, rarity);
      ok(key, `${baseKey}: rollItemKey returned null`);
      sample.push(key);
    }
  }
}
for (const key of sample) {
  const a = resolveItem(key);
  ok(a, `${key}: did not resolve`);
  if (!a) continue;
  ok(a.name, `${key}: no name`);
  ok(a.mods && MOD_KEYS.every((k) => Number.isFinite(a.mods[k])), `${key}: mod bag has a hole`);
  const budget = RARITIES[a.rarity];
  const prefixes = a.affixes.filter((x) => x.kind === 'prefix').length;
  const suffixes = a.affixes.filter((x) => x.kind === 'suffix').length;
  ok(prefixes <= budget.prefixes, `${key}: ${prefixes} prefixes over a budget of ${budget.prefixes}`);
  ok(suffixes <= budget.suffixes, `${key}: ${suffixes} suffixes over a budget of ${budget.suffixes}`);
  const groups = a.affixes.map((x) => AFFIXES.find((f) => f.id === x.id).group);
  ok(new Set(groups).size === groups.length, `${key}: rolled the same affix group twice`);
  for (const affix of a.affixes) {
    const def = AFFIXES.find((f) => f.id === affix.id);
    ok(def.slots.includes(a.slot), `${key}: rolled ${affix.id}, illegal on slot ${a.slot}`);
    const minTier = def.t[0][0];
    ok(a.ilvl >= minTier, `${key}: rolled ${affix.id} below its item level gate`);
  }
  if (a.slot === 'weapon') {
    ok(a.weapon, `${key}: weapon item without a resolved weapon`);
    const total = DAMAGE_TYPES.reduce((s, t) => s + (a.weapon.types[t] || 0), 0);
    ok(Math.abs(total - 1) < 1e-9, `${key}: resolved type split sums to ${total}`);
  } else {
    ok(!a.weapon, `${key}: non-weapon resolved a weapon block`);
  }
  ok(itemLines(a).length >= 0, `${key}: itemLines threw`);
}

// Purity: a fresh resolve of the same key is identical, and resolution never
// depends on call order. Two peers must never disagree about an item.
for (const key of sample) {
  const first = JSON.stringify(resolveItem(key).mods);
  const shuffled = [...sample].reverse();
  for (const other of shuffled.slice(0, 5)) resolveItem(other);
  const second = JSON.stringify(resolveItem(key).mods);
  ok(first === second, `${key}: resolved differently on a second call`);
}

// Stability: these exact keys must produce these exact names forever. If a
// change here is deliberate, the rolled items already on characters changed
// too — bump a tree/item version and migrate rather than editing this list.
const GOLDEN = [
  ['scatter_mk2:abc:40:3', 'Tuned Breaching Scattergun of Signal'],
  ['marksman_mk1:1z:12:2', 'Heavy Marksman Rifle of Signal'],
  ['flak_plate:99:60:3', 'Hardened Flak Plate of Signal'],
  ['psifocus_mk2:7q:80:3', 'Long Abyssal Focus of the Spread'],
  ['neural_shunt:5:1:1', 'Neural Shunt'],
];
for (const [key, expected] of GOLDEN) {
  const item = resolveItem(key);
  ok(item, `golden ${key}: did not resolve`);
  if (item && item.name !== expected) fail(`golden ${key}: name drifted, got "${item.name}", expected "${expected}"`);
}

// ---------- totality: bad input never throws ----------
for (const bad of [null, undefined, '', 'oath_blade', 'nope:1:1:1', 'scatter_mk1', 'scatter_mk1:::', ':::', 'scatter_mk1:zz:999:9', 42, {}]) {
  let threw = false;
  try {
    resolveItem(bad);
    parseItemKey(bad);
    isRolledKey(bad);
  } catch { threw = true; }
  ok(!threw, `resolveItem threw on ${JSON.stringify(bad)}`);
}
ok(resolveItem('oath_blade') === null, 'authored key must not resolve as rolled');
ok(resolveItem('scatter_mk1:zz:999:9') !== null, 'out-of-range ilvl/rarity must clamp, not fail');

// ---------- the old world still works ----------
// Every authored item resolves through itemInfo, and itemMods sums authored
// and rolled keys together without either path disturbing the other.
for (const key of Object.keys(ITEMS)) {
  const info = itemInfo(key);
  ok(info && info.name === ITEMS[key].name, `${key}: authored item lost its identity`);
  ok(!isRolledKey(key), `${key}: authored key parsed as rolled`);
}
const authoredOnly = itemMods(['oath_blade', 'flak_vest']);
ok(Math.abs(authoredOnly.dmg - 0.22) < 1e-9, 'authored damage sum changed');
ok(Math.abs(authoredOnly.hp - 70) < 1e-9, 'authored hp sum changed');
ok(itemMods([]).dmg === 0, 'empty item list must produce a zero bag');
ok(itemMods(['does_not_exist']).dmg === 0, 'unknown key must be ignored, not throw');

const mixed = itemMods(['oath_blade', rollItemKey('flak_plate', 'mix', 40, 2)]);
ok(mixed.dmg >= 0.22, 'mixed list dropped the authored item');
ok(mixed.hp > 0, 'mixed list dropped the rolled item');

// Local weapon rolls must not leak into the global bag. This is the
// double-dip guard: a weapon's own damage roll scales that weapon only, and
// the global bag must equal implicit + non-local affixes exactly.
for (let i = 0; i < 300; i++) {
  const key = rollItemKey('scatter_mk1', `local${i}`, 70, 3);
  const item = resolveItem(key);
  const expected = { ...(item.base.implicit || {}) };
  for (const affix of item.affixes) {
    if (affix.local) continue;
    for (const [k, v] of Object.entries(affix.mods)) expected[k] = (expected[k] || 0) + v;
  }
  for (const k of MOD_KEYS) {
    const got = item.mods[k] || 0;
    const want = expected[k] || 0;
    if (Math.abs(got - want) > 1e-9) {
      fail(`${key}: global mod ${k} is ${got}, expected ${want} — a local roll leaked`);
      break;
    }
  }
  // And the local rolls must actually have reached the weapon.
  const localDmg = item.affixes.filter((a) => a.local).reduce((s, a) => s + (a.mods.dmg || 0), 0);
  if (localDmg) {
    const want = item.base.w.dmg * (1 + localDmg);
    ok(Math.abs(item.weapon.dmg - want) < 1e-6, `${key}: local damage did not reach the weapon`);
  }
}
ok(applyLocal({ dmg: 100, rof: 1, range: 5, types: { kinetic: 1 } }, { dmg: 0.5 }).dmg === 150, 'local damage did not apply');
ok(applyLocal({ dmg: 100, rof: 1, range: 5, types: { kinetic: 1 } }, {}).dmg === 100, 'applyLocal changed a clean weapon');

// ---------- requirements ----------
const heavy = resolveItem(rollItemKey('scatter_mk3', 'req', 60, 1));
ok(!meetsRequirement(heavy, { frame: 10 }), 'requirement passed below the gate');
ok(meetsRequirement(heavy, { frame: 44 }), 'requirement failed at the gate');
ok(meetsRequirement(resolveItem(rollItemKey('neural_shunt', 'req2', 10, 1)), {}), 'unrequired item demanded an attribute');

// ---------- hashing is stable ----------
ok(hashString('zillions') === hashString('zillions'), 'hashString is not stable');
ok(hashString('a') !== hashString('b'), 'hashString collides on trivial input');
ok(rolledMods([]).dmg === 0, 'rolledMods empty bag');


// ---------- loot rolling ----------
// A world must never offer a base it is not deep enough to have made, and the
// same context must always produce the same drop.
for (const ilvl of [1, 5, 20, 50, 100]) {
  for (let r = 0; r < 40; r++) {
    const roll = r / 40;
    const key = rollLootKey(`w${ilvl}`, ilvl, 2, roll);
    ok(key, `rollLootKey returned null at ilvl ${ilvl}`);
    const item = resolveItem(key);
    ok(item, `rollLootKey produced an unresolvable key at ilvl ${ilvl}`);
    ok(item.base.ilvl <= ilvl, `ilvl ${ilvl} dropped ${item.baseKey}, which needs ${item.base.ilvl}`);
    ok(rollLootKey(`w${ilvl}`, ilvl, 2, roll) === key, 'rollLootKey is not deterministic');
  }
}
for (const slot of ['weapon', 'offhand', 'armor', 'implant']) {
  const key = rollLootKeyForSlot(slot, 'slotroll', 100, 3, 0.5);
  ok(key && resolveItem(key).slot === slot, `rollLootKeyForSlot returned the wrong slot for ${slot}`);
}
ok(rollLootKeyForSlot('weapon', 's', 1, 1, 0.5), 'no weapon is reachable at item level 1');
ok(rollLootKey('edge', 1, 2, 0) && rollLootKey('edge', 1, 2, 0.9999), 'roll edges must both resolve');

// Item level must rise with the world and never leave 1..100.
let previous = 0;
for (const levelId of [1, 2, 3, 4, 5, 20, 60]) {
  const ilvl = worldItemLevel(levelId, { mult: 1 + levelId * 0.1 }, { mult: 1 });
  ok(ilvl >= 1 && ilvl <= 100, `worldItemLevel(${levelId}) = ${ilvl}, out of range`);
  ok(ilvl >= previous, `worldItemLevel fell from ${previous} to ${ilvl} at level ${levelId}`);
  previous = ilvl;
}
ok(worldItemLevel(9999, null, null) <= 100, 'worldItemLevel did not clamp a huge level id');
ok(worldItemLevel(null, null, null) >= 1, 'worldItemLevel did not floor a missing level id');


// ---------- regression: an authored item's mod bag is stats only ----------
// itemInfo() handed the whole definition over as a mod bag, so tooltips read
// "+Oath Blade name" and "+🗡️ icon" alongside the real lines.
for (const key of Object.keys(ITEMS)) {
  const info = itemInfo(key);
  for (const modKey of Object.keys(info.mods)) {
    ok(MOD_KEYS.includes(modKey), `${key}: mod bag carries non-stat key "${modKey}"`);
    ok(typeof info.mods[modKey] === 'number', `${key}: mod "${modKey}" is not a number`);
  }
  for (const line of itemLines(info)) {
    ok(!/name|icon|kind|desc/i.test(line), `${key}: tooltip line leaks a definition field — "${line}"`);
  }
}

// ---------- regression: every slot pool can be filled ----------
// A weapon always landed in slot one, so the second set was unreachable and
// the whole weapon-swap feature was dead in the shipped UI.
ok(slotsForPool('weapon').includes('weapon2'), 'a weapon cannot reach the second set');
ok(slotsForPool('offhand').includes('offhand2'), 'an off-hand cannot reach the second set');
ok(slotsForPool('implant').length === 2, 'an implant cannot reach both sockets');
ok(slotsForPool('armor').length === 1, 'armour has more than one slot');
for (const pool of ['weapon', 'offhand', 'armor', 'implant']) {
  for (const slot of slotsForPool(pool)) {
    ok(EQUIP_SLOTS.includes(slot), `${pool} maps to "${slot}", which is not an equipment slot`);
    ok(slotPool(slot) === pool, `${slot} does not map back to ${pool}`);
  }
}

// ---------- regression: only the drawn set contributes global mods ----------
{
  const a = rollItemKey('marksman_mk2', 'eq-a', 50, 3);
  const b = rollItemKey('scatter_mk2', 'eq-b', 50, 3);
  const equipment = { weapon: a, weapon2: b, armor: rollItemKey('flak_plate', 'eq-c', 50, 2) };
  const drawnFirst = equippedKeys(equipment, 0);
  const drawnSecond = equippedKeys(equipment, 1);
  ok(drawnFirst.includes(a) && !drawnFirst.includes(b), 'set I included the sheathed weapon');
  ok(drawnSecond.includes(b) && !drawnSecond.includes(a), 'set II included the sheathed weapon');
  ok(drawnFirst.length === drawnSecond.length, 'the two sets contribute a different number of items');
  ok(equippedKeys(null, 0).length === 0, 'equippedKeys threw on no equipment');
}


// ---------- regression: a name must not stutter ----------
// "Long Marksman Rifle" rolling the "Long" prefix read as "Long Long Marksman
// Rifle". Every generated name is checked for a repeated word.
for (const key of sample) {
  const name = resolveItem(key).name;
  const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && w !== 'the');
  ok(new Set(words).size === words.length, `${key}: name stutters — "${name}"`);
}


// ---------- regression: prototype keys are not items ----------
// Item keys arrive from a profile blob and a peer's snapshot. A bare table
// lookup finds Object.prototype members, so "constructor" resolved as a real
// item named "Object" and "toString" as one named "toString".
for (const key of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
  ok(itemInfo(key) === null, `"${key}" resolves as an item`);
  ok(parseItemKey(`${key}:1:1:1`) === null, `"${key}" parses as a rolled base`);
  ok(rollItemKey(key, 's', 10, 2) === null, `"${key}" can be rolled as a base`);
  ok(itemMods([key]).dmg === 0, `"${key}" contributed mods`);
  ok(!isRolledKey(`${key}:1:1:1`), `"${key}" counts as a rolled key`);
}
ok(hasOwn(ITEM_BASES, 'scatter_mk1'), 'hasOwn rejects a real base');
ok(!hasOwn(ITEM_BASES, 'constructor'), 'hasOwn accepts a prototype key');
ok(!hasOwn(ITEM_BASES, null) && !hasOwn(ITEM_BASES, 42), 'hasOwn accepts a non-string key');

// Rarity must clamp to a real grade rather than trusting the key.
for (const bad of ['scatter_mk1:a:10:9', 'scatter_mk1:a:10:0', 'scatter_mk1:a:10:-3']) {
  const item = resolveItem(bad);
  ok(item && RARITIES[item.rarity], `${bad}: resolved to rarity ${item && item.rarity}`);
}

if (failures) {
  console.error(`\nitem-check: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`item-check: ok (${Object.keys(ITEM_BASES).length} bases, ${AFFIXES.length} affixes, ${sample.length} rolled samples)`);
