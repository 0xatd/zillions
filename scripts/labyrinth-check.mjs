// Labyrinth mode check: builds every trial on its real terrain and plays the
// mode's whole contract in Node — no-building setup, hero-seeded horde
// pathing, chamber razing → checkpoint + blessing offers, the lockstep-safe
// blessing verb, shared lives and final defeat, the champion finale, and
// snapshot/restore determinism with labyrinth state in flight.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TerrainField } from '../src/terrain.js';
import { Game } from '../src/game.js';
import {
  LEVELS, LABYRINTH_LEVELS, LABYRINTH_LIVES, BLESSING_KEYS, SIM_DT, ITEMS, isLabyrinthLevel, levelById,
} from '../src/config.js';

// Canonical hash: key order varies between a fresh and a restored sim (e.g.
// `stats` is rebuilt with defaults first), so sort keys before hashing.
const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
};
const hash = (snap) => createHash('sha256').update(canonical(snap)).digest('hex').slice(0, 12);

assert.ok(BLESSING_KEYS.length >= 9, `expected a real blessing pool, got ${BLESSING_KEYS.length}`);
assert.ok(BLESSING_KEYS.every((k) => ITEMS[k] && ITEMS[k].kind === 'blessing'), 'blessing keys must be blessing-kind items');
assert.ok(isLabyrinthLevel(9001) && !isLabyrinthLevel(6), 'labyrinth id band broken');
assert.equal(levelById(9001).id, 9001, 'levelById must resolve labyrinth trials');
assert.ok(levelById(6).galaxy, 'galaxy ids past the war must still resolve to galaxy planets');

for (const lv of LABYRINTH_LEVELS) {
  const map = new TerrainField(lv.seed, lv.theme, { size: lv.size, nests: lv.nests });
  let g = new Game(map, 'normal', 'scott', null, lv.id, 'labyrinth');

  // -- setup contract: live from tick zero, nothing to build, lives banked --
  assert.equal(g.phase, 'live', `${lv.name}: labyrinth must open live`);
  assert.equal(g.plots.length, 0, `${lv.name}: labyrinth must have no plots`);
  assert.equal(g.buildings.length, 0, `${lv.name}: labyrinth must have no buildings`);
  assert.equal(g.lives, LABYRINTH_LIVES, `${lv.name}: lives not banked`);
  assert.ok(g.checkpoint, `${lv.name}: no start checkpoint`);
  assert.ok(g.heroes.length === 1 && !g.heroes[0].dead, `${lv.name}: hero not spawned`);
  assert.ok(map.isWalkable(g.heroes[0].x | 0, g.heroes[0].z | 0), `${lv.name}: hero spawned on unwalkable ground`);
  const live = g.nests.filter((n) => n.alive);
  assert.ok(live.length >= Math.max(3, lv.nests - 1),
    `${lv.name}: expected ~${lv.nests} reachable chambers, got ${live.length}`);

  // -- the horde hunts heroes: flow field must be seeded on them --
  for (let i = 0; i < 90; i++) g.update(SIM_DT); // 3s: first flow computes
  const h = g.heroes[0];
  const heroDist = g.flow.distAt(h.x | 0, h.z | 0);
  assert.ok(heroDist < 3, `${lv.name}: flow field not seeded on the hero (dist ${heroDist})`);
  const nest = live[0];
  assert.ok(g.flow.distAt(nest.x | 0, nest.z | 0) < Infinity,
    `${lv.name}: chamber ${nest.id} cannot reach the hero through the corridor`);

  // -- snapshot/restore determinism with labyrinth state in flight --
  // Sequential, not interleaved: the sim's id counter is module-global (reset
  // by restore via the snapshot), so two live instances can't share a process.
  const mid = g.snapshot();
  for (let i = 0; i < 300; i++) g.update(SIM_DT);
  const uninterrupted = hash(g.snapshot());
  const g2 = new Game(map, 'normal', 'scott', mid, lv.id, 'labyrinth');
  for (let i = 0; i < 300; i++) g2.update(SIM_DT);
  assert.equal(hash(g2.snapshot()), uninterrupted,
    `${lv.name}: restored run diverged from the uninterrupted one`);
  g = g2; // continue the trial on the restored run — same state, valid id counter

  // -- razing a chamber: checkpoint advances, a blessing choice opens --
  const first = g.nests.find((n) => n.alive);
  g._damageNest(first, first.hp + 1);
  assert.ok(!first.alive, `${lv.name}: nest did not raze`);
  assert.equal(g.checkpoint.x, first.x, `${lv.name}: checkpoint did not advance to the razed chamber`);
  const offer = g.blessingOffers[0];
  assert.ok(offer && offer.length === 3, `${lv.name}: expected 3 blessings offered, got ${offer && offer.length}`);
  assert.ok(offer.every((k) => ITEMS[k].kind === 'blessing'), `${lv.name}: offer contains non-blessings`);

  // Offers must survive a save/restore exactly (they are RNG-drawn).
  const withOffer = g.snapshot();
  const g3 = new Game(map, 'normal', 'scott', withOffer, lv.id, 'labyrinth');
  assert.deepEqual(g3.blessingOffers[0], offer, `${lv.name}: blessing offer did not survive restore`);

  // -- the blessing verb: lockstep-shaped, stat-visible, restore-proof --
  const before = g.heroes[0].mods.dmg;
  g.exec({ t: 'blessing', p: 0, i: 99 }); // stale/invalid index is ignored
  assert.ok(g.blessingOffers[0], `${lv.name}: invalid pick consumed the offer`);
  const pickIdx = offer.findIndex((k) => (ITEMS[k].dmg || 0) > 0);
  const pick = pickIdx >= 0 ? pickIdx : 0;
  g.exec({ t: 'blessing', p: 0, i: pick });
  assert.equal(g.heroes[0].blessings.length, 1, `${lv.name}: blessing not applied`);
  assert.equal(g.blessingOffers[0], null, `${lv.name}: offer not consumed`);
  if (pickIdx >= 0) assert.ok(g.heroes[0].mods.dmg > before, `${lv.name}: blessing mods not applied`);
  const blessedSnap = g.snapshot();
  const g4 = new Game(map, 'normal', 'scott', blessedSnap, lv.id, 'labyrinth');
  assert.deepEqual(g4.heroes[0].blessings, g.heroes[0].blessings, `${lv.name}: blessings lost on restore`);
  assert.equal(g4.heroes[0].maxHp, g.heroes[0].maxHp, `${lv.name}: blessed stats drifted on restore`);

  // -- the finale: raze everything, champion rises, killing it clears the trial --
  for (const n of g.nests) if (n.alive) g._damageNest(n, n.hp + 1);
  for (let i = 0; i < 30; i++) g.update(SIM_DT);
  assert.ok(g.finalStand, `${lv.name}: finale did not trigger`);
  assert.ok(g.boss, `${lv.name}: champion did not rise`);
  g.damageZombie(g.boss, g.boss.maxHp * 20); // enough to punch through boss armor
  assert.ok(g.over && g.won, `${lv.name}: killing the champion must clear the trial`);
}

// -- shared lives and final defeat, on the first trial --
{
  const lv = LABYRINTH_LEVELS[0];
  const map = new TerrainField(lv.seed, lv.theme, { size: lv.size, nests: lv.nests });
  const g = new Game(map, 'normal', 'scott', null, lv.id, 'labyrinth');
  const h = g.heroes[0];
  for (let spent = 0; spent < LABYRINTH_LIVES; spent++) {
    g._damageUnit(h, h.hp + h.shieldHp + 1);
    assert.ok(h.dead && !h.fallen, `death ${spent + 1} should spend a life, not end the run`);
    assert.equal(g.lives, LABYRINTH_LIVES - spent - 1, 'life not spent');
    assert.ok(!g.over, 'run ended with lives in the bank');
    for (let i = 0; i < Math.ceil(10 / SIM_DT); i++) g.update(SIM_DT);
    assert.ok(!h.dead, `hero did not revive after death ${spent + 1}`);
    const near = Math.hypot(h.x - g.checkpoint.x, h.z - g.checkpoint.z);
    assert.ok(near < 12, `revive landed ${near.toFixed(1)} tiles from the checkpoint`);
  }
  g._damageUnit(h, h.hp + h.shieldHp + 1);
  assert.ok(h.dead && h.fallen, 'out of lives, the fall must be final');
  assert.ok(g.over && !g.won, 'last hero down with no lives must end the run');
}

// -- co-op: up to 3 players share the run — lives scale, everyone is a flow
// seed, every player gets their own blessing choice --
{
  const lv = LABYRINTH_LEVELS[0];
  const map = new TerrainField(lv.seed, lv.theme, { size: lv.size, nests: lv.nests });
  const g = new Game(map, 'normal', ['scott', 'alexander', 'danny'], null, lv.id, 'labyrinth');
  assert.equal(g.heroes.length, 3, 'co-op labyrinth must spawn every hero');
  assert.equal(g.lives, LABYRINTH_LIVES + 2, 'shared lives must scale with party size');
  for (const h of g.heroes) {
    assert.ok(map.isWalkable(h.x | 0, h.z | 0), 'a co-op hero spawned on unwalkable ground');
  }
  for (let i = 0; i < 90; i++) g.update(SIM_DT);
  for (const h of g.heroes) {
    assert.ok(g.flow.distAt(h.x | 0, h.z | 0) < 3, 'the horde must hunt every living hero, not just player 0');
  }
  const first = g.nests.find((n) => n.alive);
  g._damageNest(first, first.hp * 10);
  const offers = g.blessingOffers.slice(0, 3);
  assert.ok(offers.every((o) => o && o.length === 3), 'every player must get their own 3-blessing offer');
  g.exec({ t: 'blessing', p: 1, i: 0 }); // player order does not matter
  g.exec({ t: 'blessing', p: 0, i: 1 });
  g.exec({ t: 'blessing', p: 2, i: 2 });
  assert.ok(g.heroes.every((h) => (h.blessings || []).length === 1), 'each hero must carry their own pick');
  const snap = g.snapshot();
  const g2 = new Game(map, 'normal', ['scott', 'alexander', 'danny'], snap, lv.id, 'labyrinth');
  assert.deepEqual(g2.heroes.map((h) => h.blessings), g.heroes.map((h) => h.blessings),
    'per-player blessings must survive restore');
  assert.equal(g2.lives, g.lives, 'shared lives must survive restore');
}

// -- shared _updateFlow seam: the labyrinth's hero-seeded flow must not
// change founding-phase behavior in the other modes. An empty compute fills
// the field with Infinity ("nothing to hunt"); skipping it would leave the
// buffer's initial zeros and wake every idle creep on the map at once. --
{
  const lv = LEVELS[0];
  const map = new TerrainField(lv.seed, lv.theme, { size: lv.size, nests: lv.nests });
  const g = new Game(map, 'normal', 'scott', null, lv.id, 'campaign');
  assert.equal(g.phase, 'found');
  for (let i = 0; i < Math.ceil(10 / SIM_DT); i++) g.update(SIM_DT);
  const aggro = g.zombies.filter((zb) => zb.state === 2).length;
  assert.ok(aggro <= 30,
    `found-phase creeps must stay idle with nothing built — ${aggro}/${g.zombies.length} are aggro (the empty flow field is reading as "objective everywhere")`);
}

// -- restore determinism while EVERY hero is down (revives pending): the
// snapshotted flow seeds are empty at that moment, and restore must rebuild
// the same all-Infinity field the live game had, not skip the compute. --
{
  const lv = LABYRINTH_LEVELS[0];
  const map = new TerrainField(lv.seed, lv.theme, { size: lv.size, nests: lv.nests });
  const g = new Game(map, 'normal', 'scott', null, lv.id, 'labyrinth');
  for (let i = 0; i < 90; i++) g.update(SIM_DT);
  const h = g.heroes[0];
  g._damageUnit(h, h.hp + h.shieldHp + 1);
  assert.ok(h.dead && !h.fallen, 'the hero should be down with a revive pending');
  for (let i = 0; i < 60; i++) g.update(SIM_DT); // past a flow recompute with zero living seeds
  const mid = g.snapshot();
  assert.equal((mid.flowSeeds || []).length, 0, 'expected an all-dead snapshot with empty flow seeds');
  for (let i = 0; i < 300; i++) g.update(SIM_DT);
  const uninterrupted = hash(g.snapshot());
  const g2 = new Game(map, 'normal', 'scott', mid, lv.id, 'labyrinth');
  for (let i = 0; i < 300; i++) g2.update(SIM_DT);
  assert.equal(hash(g2.snapshot()), uninterrupted,
    'a run restored from an all-heroes-down snapshot diverged from the uninterrupted one');
}

console.log(`labyrinth check passed: ${LABYRINTH_LEVELS.length} trials — setup, hunting flow, blessings, restore determinism (including all-heroes-down), finale, lives, 3-player co-op, and the found-phase flow seam all hold`);
