import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { HEROES, SIM_DT, TILE } from '../src/config.js';
import { spellAttack, spellAttackSpeed, spellMoveSpeed, spellState } from '../src/hero-spells.js';
import { stateHash } from '../src/lockstep-hash.js';
import { abilityCooldown } from '../src/hero-abilities.js';

const MAP_SIZE = 64;

function map() {
  return {
    size: MAP_SIZE,
    seed: 20101,
    sites: [{ x: MAP_SIZE / 2, z: MAP_SIZE / 2, name: 'Old Crossroads' }],
    nestSpots: [[48, 32], [16, 48], [32, 16]],
    nodeSpots: [{ x: 40, z: 32, name: 'Ford', kind: 'clearing' }],
    tiles: new Uint8Array(MAP_SIZE * MAP_SIZE).fill(TILE.GRASS),
    idx: (x, z) => z * MAP_SIZE + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < MAP_SIZE && z < MAP_SIZE,
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < MAP_SIZE && z < MAP_SIZE,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < MAP_SIZE && z < MAP_SIZE,
  };
}

function fresh(key) {
  const g = new Game(map(), 'normal', key, null, 1);
  g.zombies = [];
  g.nests = [];
  const h = g.heroes[0];
  h.x = h.z = 32;
  h.facing = 0;
  h.cooldown = 1e9;
  spellState(h);
  return g;
}

function heroTicks(g, n) {
  const h = g.heroes[0];
  for (let i = 0; i < n; i++) g._updateHeroOne(h, SIM_DT);
}

function enemy(g, x, z, hp = 5000) {
  const e = g._spawnZombie('walker', x, z, true, false);
  e.hp = e.maxHp = hp;
  return e;
}

function restore(g, key) {
  const restored = new Game(map(), 'normal', key, g.snapshot(), 1);
  restored.heroes[0].def = HEROES[key];
  return restored;
}

function agree(g, key, steps = 8) {
  const restored = restore(g, key);
  assert.equal(stateHash(restored), stateHash(g), `${key} diverged on restore`);
  for (let i = 0; i < steps; i++) {
    g._updateHeroOne(g.heroes[0], SIM_DT);
    restored._updateHeroOne(restored.heroes[0], SIM_DT);
  }
  assert.equal(stateHash(restored), stateHash(g), `${key} diverged after the same spell ticks`);
  assert.deepEqual(g.zombies.map((z) => z.hp), restored.zombies.map((z) => z.hp), `${key} damage diverged`);
  const hero = g.heroes[0];
  const mana = hero.spells.mana;
  hero.spells.mana = mana - 1;
  assert.notEqual(stateHash(g), stateHash(restored), `${key} mana must be in the lockstep hash`);
  hero.spells.mana = mana;
}

test('Alexander Trueflight hits only the chosen enemy and Glass Sight is a timed buff', () => {
  const g = fresh('alexander');
  const h = g.heroes[0];
  const left = enemy(g, 34, 32);
  const right = enemy(g, 36, 34);
  const far = spellAttack(g, h, { x: 44, z: 32 }, 100);
  const near = spellAttack(g, h, { x: 33, z: 32 }, 100);
  assert.ok(far > near, 'rifle damage grows with distance');
  g.exec({ t: 'cast', slot: 0, id: right.id });
  heroTicks(g, 8);
  assert.equal(left.hp, 5000);
  assert.ok(right.hp < 5000);
  assert.ok(h.spells.mana < 380);
  const range = g.heroRange(h);
  g.exec({ t: 'cast', slot: 2 });
  assert.equal(g.heroRange(h), range + 2);
  assert.equal(spellMoveSpeed(h), 0.35);
  assert.ok(spellAttackSpeed(h) > 1.3);
  agree(g, 'alexander', 4);
  heroTicks(g, 140);
  assert.equal(g.heroRange(g.heroes[0]), range);
  assert.equal(spellMoveSpeed(g.heroes[0]), 1);
});

test('Alexander Kickback pushes and hops, and Meridian cancels when he moves', () => {
  const g = fresh('alexander');
  const h = g.heroes[0];
  const foe = enemy(g, 32, 38, 400);
  g.exec({ t: 'cast', slot: 1 });
  assert.ok(foe.hp < 400);
  assert.ok(foe.stunT > 0);
  assert.ok(foe.z > 38, 'the charge throws the target away from Alexander');
  assert.ok(h.z < 32, 'Alexander hops back to keep his range');
  assert.ok(abilityCooldown(h, 1) > 0);

  const aimed = fresh('alexander');
  const hero = aimed.heroes[0];
  const target = enemy(aimed, 32, 40, 800);
  aimed.exec({ t: 'cast', slot: 3, id: target.id });
  heroTicks(aimed, 10);
  assert.equal(target.hp, 800, 'the shot has not landed yet');
  hero.mx = 1;
  heroTicks(aimed, 40);
  assert.equal(target.hp, 800, 'moving cancels Meridian');

  const held = fresh('alexander');
  const mark = enemy(held, 32, 40, 800);
  held.exec({ t: 'cast', slot: 3, id: mark.id });
  heroTicks(held, 50);
  assert.ok(mark.hp < 800);
  agree(held, 'alexander', 2);
});

test('Tiger rift, Stillpoint, Dread Well and Unmake stay deterministic', () => {
  const g = fresh('tiger');
  const h = g.heroes[0];
  const line = enemy(g, 32, 38);
  const side = enemy(g, 40, 32);
  g.exec({ t: 'cast', slot: 0, x: 32, z: 44 });
  heroTicks(g, 20);
  assert.ok(line.hp < 5000);
  assert.equal(side.hp, 5000);
  const once = line.hp;
  heroTicks(g, 20);
  assert.equal(line.hp, once, 'a rift hits each enemy once');

  const stay = enemy(g, 36, 32);
  const leave = enemy(g, 37, 32);
  g.exec({ t: 'cast', slot: 1, x: 36, z: 32 });
  heroTicks(g, 8);
  assert.equal(stay.hp, 5000, 'Stillpoint waits');
  leave.x = 50;
  heroTicks(g, 12);
  assert.ok(stay.hp < 5000);
  assert.ok(stay.stunT > 0);
  assert.equal(leave.hp, 5000);

  const caught = enemy(g, 32, 28, 200);
  g.exec({ t: 'cast', slot: 2, x: 32, z: 28 });
  heroTicks(g, 4);
  assert.equal(caught.hp, 200);
  heroTicks(g, 20);
  assert.ok(caught.hp < 200);
  assert.equal(caught.slowMul, 0.58);

  const clump = enemy(g, 30, 34, 300);
  const beside = enemy(g, 31, 35, 300);
  const outside = enemy(g, 20, 20, 300);
  g.exec({ t: 'cast', slot: 3, x: 30, z: 34 });
  heroTicks(g, 10);
  assert.equal(clump.hp, 300);
  heroTicks(g, 20);
  assert.ok(clump.hp < 300 && beside.hp < 300);
  assert.equal(outside.hp, 300);
  const after = clump.hp;
  heroTicks(g, 10);
  assert.equal(clump.hp, after, 'Unmake resolves once');
  agree(g, 'tiger', 3);
});

test('Aaron mends, wards, summons one sentinel, and Choir replaces it with two', () => {
  const g = fresh('aaron');
  const h = g.heroes[0];
  h.hp = 100;
  const near = g._spawnUnit('soldier', 33, 33);
  near.hp = 40;
  near.maxHp = 140;
  const far = g._spawnUnit('soldier', 50, 50);
  far.hp = 40;
  far.maxHp = 140;
  g.exec({ t: 'cast', slot: 1 });
  heroTicks(g, 1);
  assert.ok(h.hp > 100);
  assert.ok(near.hp > 40);
  assert.equal(far.hp, 40);

  g.exec({ t: 'cast', slot: 0 });
  const spirits = () => g.units.filter((u) => !u.dead && u.key === 'aaron_spirit');
  assert.equal(spirits().length, 1);
  const first = spirits()[0].id;
  h.abilityCds[0] = 0;
  h.abilCd = 0;
  g.exec({ t: 'cast', slot: 0 });
  assert.equal(spirits().length, 1);
  assert.notEqual(spirits()[0].id, first);

  const foe = enemy(g, 36, 32, 80);
  const before = foe.hp;
  for (const spirit of g.units) if (spirit.key === 'aaron_spirit') spirit.cooldown = 1e9;
  g.exec({ t: 'cast', slot: 2, x: 36, z: 32 });
  heroTicks(g, 4);
  assert.equal(foe.hp, before);
  heroTicks(g, 30);
  assert.ok(foe.hp < before);
  assert.equal(foe.slowMul, 0.62);
  assert.ok(h.hp > 100, 'the ward mends allies inside it');

  h.abilityCds[3] = 0;
  g.exec({ t: 'cast', slot: 3 });
  assert.equal(spirits().length, 2);
  assert.ok(spirits().every((u) => u.temp && u.ownerHeroId === h.id && u.expireT > 0));
  agree(g, 'aaron', 4);
});

test('each new leader clears the first siege on normal and repeats with the same hash', () => {
  for (const key of ['alexander', 'tiger', 'aaron']) {
    const run = () => {
      const g = new Game(map(), 'normal', key, null, 1, 'campaign');
      g.foundCity(0, 0);
      if (g.firstSiege.nestId == null) {
        g.nests[0].alive = true;
        g.nests[0].offMap = false;
        g.firstSiege.nestId = 0;
      }
      const opening = g.plots.find((plot) => plot.kind === 'camp_militia');
      assert.ok(opening, `${key} founded a city with a militia camp`);
      g.gold = 400;
      g._construct(opening);
      g.nests[g.firstSiege.nestId].musterT = 0;
      g._updateHives(0.1);
      assert.equal(g.firstSiege.stage, 'defend', `${key} must face the first wave`);
      assert.ok(g.firstSiege.waveIds.length > 0);
      const h = g.heroes[0];
      let ticks = 0;
      while (g.firstSiege.stage !== 'complete' && ticks++ < 30 * 45 && !h.dead) {
        const wave = g.zombies.filter((z) => g.firstSiege.waveIds.includes(z.id) && !z.dead && z.hp > 0);
        const foe = wave.sort((a, b) => ((a.x - h.x) ** 2 + (a.z - h.z) ** 2) - ((b.x - h.x) ** 2 + (b.z - h.z) ** 2))[0];
        const channeling = h.spells?.effects?.some((effect) => effect.channel && effect.delay > 0);
        if (!foe || channeling) {
          h.mx = 0;
          h.mz = 0;
        } else {
          const dx = foe.x - h.x;
          const dz = foe.z - h.z;
          const dist = Math.hypot(dx, dz) || 1;
          const range = g.heroRange(h);
          if (dist > range * 0.82) { h.mx = dx / dist; h.mz = dz / dist; }
          else if (dist < 3.2) { h.mx = -dx / dist; h.mz = -dz / dist; }
          else { h.mx = 0; h.mz = 0; }
          h.facing = Math.atan2(dx, dz);
          for (let slot = 0; slot < 4; slot++) {
            const ability = h.def.abilities[slot];
            if (!ability || abilityCooldown(h, slot) > 0) continue;
            if (ability.target === 'point' && dist > (ability.range || 0)) continue;
            if (ability.target === 'enemy' && dist > (ability.range || 0)) continue;
            const input = ability.target === 'enemy' ? { id: foe.id } : ability.target === 'point' ? { x: foe.x, z: foe.z } : {};
            g.exec({ t: 'cast', p: 0, slot, ...input });
          }
        }
        g.update(SIM_DT);
        if (g.events.length > 24) g.events.length = 0;
      }
      return { g, ticks };
    };
    const { g, ticks } = run();
    const h = g.heroes[0];
    assert.ok(!h.dead, `${key} died in the first siege at ${Math.round(h.hp)} hp after ${ticks} ticks`);
    assert.equal(g.firstSiege.stage, 'complete', `${key} did not break the first siege (${ticks} ticks, hp ${Math.round(h.hp)})`);
    assert.ok(g.stats.kills > 0, `${key} never landed a kill`);
    const again = run().g;
    assert.equal(stateHash(again), stateHash(g), `${key} first siege was not deterministic`);
  }
});
