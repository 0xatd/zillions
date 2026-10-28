import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { SIM_DT, TILE, levelById } from '../src/config.js';
import { buildMatchReport } from '../src/match-report.js';
import { MATCH_LIMITS } from '../src/match-rewards.js';
import { REPLAY_VERSION, verifyReplay } from '../src/match-replay.js';

function fakeMap(blocked = new Set()) {
  const size = 48;
  return {
    size,
    seed: 424242,
    sites: [],
    nestSpots: [],
    nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size && !blocked.has(`${x | 0},${z | 0}`),
  };
}

function make(hero, snap = null, blocked) {
  return new Game(
    fakeMap(blocked),
    snap?.diff || 'normal',
    snap?.heroKeys || hero,
    snap,
    snap?.level || 1,
    snap?.mode || 'campaign',
  );
}

function place(game, x = 20.5, z = 20.5) {
  game.zombies = [];
  const hero = game.heroes[0];
  hero.x = x;
  hero.z = z;
  hero.facing = 0; // +Z
  hero.abilCd = 0;
  hero.dead = false;
  return hero;
}

function advance(game, ticks) {
  for (let i = 0; i < ticks; i++) game.update(SIM_DT);
}

test('Scott drags the horde into the maul and the shockwave finishes the rim', () => {
  const game = make('scott');
  const hero = place(game);
  const close = game._spawnZombie('walker', hero.x, hero.z + 2.4, true);
  const rim = game._spawnZombie('walker', hero.x, hero.z + 5.2, true);
  const boss = game._spawnZombie('brute', hero.x + 1.2, hero.z, true);
  boss.boss = true;
  const bossZ = boss.z;
  const far = game._spawnZombie('walker', hero.x + 12, hero.z, true);
  game.inputLog = [];
  game.exec({ t: 'cast', p: 0 });
  assert.deepEqual(game.inputLog.at(-1)[1], { t: 'cast', p: 0 });
  assert.ok(Math.hypot(close.x - hero.x, close.z - hero.z) < 1.2, 'the close walker is dragged in');
  assert.equal(close.dead, true);
  assert.equal(rim.dead, true, 'the shock ring kills trash past the maul');
  assert.equal(boss.z, bossZ, 'a boss is too heavy to drag');
  assert.ok(boss.hp < boss.maxHp, 'a boss inside the swing still takes the hit');
  assert.equal(far.hp, far.maxHp);
  assert.ok(hero.abilCd > 10);
  const kills = game.stats.kills;
  game.exec({ t: 'cast', p: 0 });
  assert.equal(game.stats.kills, kills, 'the cooldown refuses a second swing');
});

test('a wall stops the hammer pull', () => {
  const game = make('scott', null, new Set(['20,17']));
  const hero = place(game, 20.5, 16.5);
  const zb = game._spawnZombie('brute', 20.5, 18.4, true);
  const z0 = zb.z;
  zb.hp = 5000;
  game.exec({ t: 'cast', p: 0 });
  assert.ok(zb.z > 17.9, 'the pull stops at the blocked tile');
  assert.ok(z0 - zb.z < 0.5);
});

test('Alexander throws a grenade that arms in flight, then mends the troops', () => {
  const game = make('alexander');
  const hero = place(game);
  const z0 = hero.z;
  const landingZ = hero.z + 7.2;
  const brute = game._spawnZombie('brute', hero.x, landingZ, true);
  const hp0 = brute.hp;
  const ally = game._spawnUnit('soldier', hero.x, landingZ, null);
  ally.hp = 40;
  ally.def = { ...ally.def, speed: 0 };
  game.exec({ t: 'cast', p: 0 });
  assert.ok(hero.z < z0 - 2, 'he kicks himself backward on the throw');
  assert.equal(game.ordnance.length, 1);
  assert.equal(brute.hp, hp0, 'the charge has not landed yet');
  for (let i = 0; i < 8; i++) game._updateOrdnance(SIM_DT);
  assert.equal(brute.hp, hp0);
  assert.equal(game.ordnance.length, 1);
  for (let i = 0; i < 10; i++) game._updateOrdnance(SIM_DT);
  assert.equal(game.ordnance.length, 0);
  assert.ok(brute.hp < hp0, 'the blast lands when the travel time runs out');
  assert.ok(brute.stunT > 0);
  assert.ok(ally.hp > 40, 'nanites in the casing mend a troop in the blast');
  const snap = game.snapshot();
  const restored = make('alexander', snap);
  advance(game, 20);
  advance(restored, 20);
  assert.equal(restored.stats.kills, game.stats.kills);
  assert.equal(restored.ordnance.length, 0);
  assert.equal(restored.heroes[0].x.toFixed(3), game.heroes[0].x.toFixed(3));
  assert.equal(restored.heroes[0].z.toFixed(3), game.heroes[0].z.toFixed(3));
});

test('a grenade in the air survives snapshot restore', () => {
  const live = make('alexander');
  place(live);
  live.exec({ t: 'cast', p: 0 });
  advance(live, 4);
  assert.equal(live.ordnance.length, 1);
  const restored = make('alexander', JSON.parse(JSON.stringify(live.snapshot())));
  assert.equal(restored.ordnance.length, 1);
  assert.equal(restored.ordnance[0].t.toFixed(4), live.ordnance[0].t.toFixed(4));
  advance(live, 20);
  advance(restored, 20);
  assert.deepEqual(
    restored.zombies.map((z) => [z.hp, +z.x.toFixed(3), +z.z.toFixed(3), z.dead ? 1 : 0]),
    live.zombies.map((z) => [z.hp, +z.x.toFixed(3), +z.z.toFixed(3), z.dead ? 1 : 0]),
  );
});

test('Daniel cuts a thread, then the phase does not cut the same body twice', () => {
  const game = make('danny');
  const hero = place(game);
  const onLine = game._spawnZombie('brute', hero.x, hero.z + 3.2, true);
  const beside = game._spawnZombie('brute', hero.x + 4.5, hero.z + 3.2, true);
  const lineHp = onLine.hp;
  const sideHp = beside.hp;
  game.exec({ t: 'cast', p: 0 });
  assert.ok(hero.z > 25, 'the blink carries him down the thread');
  assert.equal(hero.stealth, true);
  assert.ok(hero.weaveT > 2);
  assert.ok(onLine.hp < lineHp, 'the thread slices what it passes');
  assert.equal(beside.hp, sideHp, 'a body off the thread is spared');
  const after = onLine.hp;
  advance(game, 5);
  // The siphon aura keeps ticking. A second application of the cut is 50.
  assert.ok(after - onLine.hp < 10, 'the phase does not cut a body the thread already cut');
});

test('Daniel stops the blink at a wall and a restore keeps the cut list', () => {
  const blocked = new Set(['20,23']);
  const live = make('danny', null, blocked);
  const hero = place(live, 20.5, 20.5);
  const ahead = live._spawnZombie('brute', 20.5, 22.2, true);
  live.exec({ t: 'cast', p: 0 });
  assert.ok(hero.z < 23, 'the blink stops before the blocked tile');
  assert.ok(ahead.hp < ahead.maxHp);
  const cut = ahead.hp;
  const restored = make('danny', JSON.parse(JSON.stringify(live.snapshot())), blocked);
  advance(live, 12);
  advance(restored, 12);
  const liveHp = live.zombies.find((z) => z.type === 'brute').hp;
  const restoredHp = restored.zombies.find((z) => z.type === 'brute').hp;
  assert.equal(restoredHp, liveHp);
  assert.ok(cut - liveHp < 15, 'restore does not apply the thread a second time');
});

test('one packed hammer cast stays inside the match kill ceiling', () => {
  const game = make('scott');
  const hero = place(game);
  hero.level = 10;
  hero.upgrades.ult = 3;
  game._refreshHeroDerived(hero);
  hero.abilCd = 0;
  for (let x = -5; x <= 5; x++) {
    for (let z = -5; z <= 5; z++) game._spawnZombie('walker', hero.x + x, hero.z + z, true);
  }
  const before = game.threatLevel;
  game.exec({ t: 'cast', p: 0 });
  advance(game, 30);
  const cap = 20 * MATCH_LIMITS.killsPerSecond + MATCH_LIMITS.killSlack;
  assert.ok(game.stats.kills > 10, 'the swing actually clears the pack');
  assert.ok(game.stats.kills <= cap, `hammer killed ${game.stats.kills}, above the 20s ceiling ${cap}`);
  assert.equal(game.threatLevel, before, 'an active does not mint Threat');
});

test('a cast in the input log is what verifyReplay runs', () => {
  const level = levelById(1);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, 'normal', 'scott', null, 1, 'campaign', { rngSeed: 4242 });
  game.inputLog = [];
  game.exec({ t: 'hdir', p: 0, x: 0, z: 1, s: false });
  while (game.steps < 90 && !game.over) {
    if (game.steps === 10 || game.steps === 50) game.exec({ t: 'cast', p: 0 });
    game.update(SIM_DT);
  }
  assert.ok(game.inputLog.some(([, cmd]) => cmd.t === 'cast'));
  const report = buildMatchReport(game);
  const replay = { v: REPLAY_VERSION, frames: game.steps, heroIndex: 0, heroes: 'scott', log: game.inputLog };
  const verdict = verifyReplay({
    match: { levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242 },
    report,
    replay,
  });
  assert.equal(verdict.status, 'verified');
  const forged = { ...report, kills: report.kills + 8 };
  assert.equal(verifyReplay({
    match: { levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242 },
    report: forged,
    replay,
  }).status, 'mismatch');
});

test('desktop and touch use the same cast', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(main, /case 'ability1':[\s\S]{0,120}tryCast\(\)/);
  assert.match(main, /issue\(\{ t: 'cast', p: this\.myPlayer \}\)/);
  assert.match(ui, /id="ability-btn"/);
  assert.match(ui, /#ability-btn'\)[\s\S]{0,220}onCast/);
  assert.match(ui, /_syncAbilityButton/);
  assert.match(css, /\.ability-btn[\s\S]{0,500}conic-gradient/);
});
