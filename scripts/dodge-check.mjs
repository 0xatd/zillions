// The dodge roll. A new simulation mechanic, so it has to hold every rule the
// simulation already holds: deterministic, snapshot-safe, and identical on
// every peer that ran the same commands.
import { Game } from '../src/game.js';
import { TILE, DODGE_CD, DODGE_TIME, DODGE_IFRAMES, DODGE_SPEED, SIM_DT } from '../src/config.js';
import { stateHash } from '../src/lockstep-hash.js';

let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

const size = 64;
const fakeMap = () => ({
  size, seed: 4711, sites: [], nestSpots: [], nodeSpots: [],
  tiles: new Uint8Array(size * size).fill(TILE.GRASS),
  idx: (x, z) => z * size + x,
  inBounds: () => true, isBuildable: () => true, isWalkable: () => true,
});
const makeGame = () => new Game(fakeMap(), 'normal', ['scott'], null, 1, 'campaign');
const tick = (g, seconds) => { for (let i = 0; i < Math.ceil(seconds / SIM_DT); i++) g.update(SIM_DT); };

// ---------- it moves you ----------
{
  const game = makeGame();
  const hero = game.heroes[0];
  const x0 = hero.x, z0 = hero.z;
  game.exec({ t: 'dodge', p: 0, x: 1, z: 0 });
  ok(hero.dodgeT > 0, 'the roll did not start');
  ok(hero.dodgeCd > 0, 'the roll set no cooldown');
  tick(game, DODGE_TIME + 0.05);
  const rolled = Math.hypot(hero.x - x0, hero.z - z0);
  ok(rolled > 2, `the roll covered only ${rolled.toFixed(2)} tiles`);
  ok(hero.dodgeT === 0, 'the roll did not end');

  // Walking the same time without rolling must cover less ground.
  const walker = makeGame();
  const w = walker.heroes[0];
  const wx = w.x, wz = w.z;
  walker.exec({ t: 'hdir', p: 0, x: 1, z: 0, s: false });
  tick(walker, DODGE_TIME + 0.05);
  ok(rolled > Math.hypot(w.x - wx, w.z - wz) * 1.5, 'a roll was no faster than walking');
}

// ---------- it saves you, but only briefly ----------
{
  const game = makeGame();
  const hero = game.heroes[0];
  game.exec({ t: 'dodge', p: 0, x: 1, z: 0 });
  const full = hero.hp;
  game._damageUnit(hero, 400);
  ok(hero.hp === full, 'a hit landed during the invulnerable window');

  // The window is shorter than the roll, so a late dodge still gets punished.
  ok(DODGE_IFRAMES < DODGE_TIME, 'the invulnerable window must be shorter than the roll');
  tick(game, DODGE_IFRAMES + 0.02);
  const before = hero.hp;
  game._damageUnit(hero, 100);
  ok(hero.hp < before, 'the invulnerable window never ended');
}

// ---------- the cooldown is real ----------
{
  const game = makeGame();
  const hero = game.heroes[0];
  game.exec({ t: 'dodge', p: 0, x: 1, z: 0 });
  tick(game, DODGE_TIME + 0.05);
  game.exec({ t: 'dodge', p: 0, x: 1, z: 0 });
  ok(hero.dodgeT === 0, 'a second roll fired while on cooldown');
  tick(game, DODGE_CD);
  ok(hero.dodgeCd === 0, `the cooldown never cleared (${hero.dodgeCd})`);
  game.exec({ t: 'dodge', p: 0, x: 1, z: 0 });
  ok(hero.dodgeT > 0, 'the roll did not come back off cooldown');
}

// ---------- a roll is committed ----------
// Movement input must not steer it, or two peers applying the command a window
// apart would roll in different directions.
{
  const game = makeGame();
  const hero = game.heroes[0];
  game.exec({ t: 'dodge', p: 0, x: 1, z: 0 });
  game.exec({ t: 'hdir', p: 0, x: -1, z: 0, s: false });
  const x0 = hero.x;
  tick(game, DODGE_TIME * 0.6);
  ok(hero.x > x0, 'movement input steered a roll that was already committed');
}

// Standing still still rolls, so the key always does something.
{
  const game = makeGame();
  const hero = game.heroes[0];
  const x0 = hero.x, z0 = hero.z;
  game.exec({ t: 'dodge', p: 0, x: 0, z: 0 });
  tick(game, DODGE_TIME + 0.05);
  ok(Math.hypot(hero.x - x0, hero.z - z0) > 1, 'a standing dodge went nowhere');
}

// A dead hero cannot roll.
{
  const game = makeGame();
  const hero = game.heroes[0];
  hero.dead = true;
  game.exec({ t: 'dodge', p: 0, x: 1, z: 0 });
  ok(!hero.dodgeT, 'a dead hero rolled');
}

// ---------- it survives a snapshot mid-roll ----------
{
  const game = makeGame();
  const hero = game.heroes[0];
  game.exec({ t: 'dodge', p: 0, x: 0.6, z: 0.8 });
  game.update(SIM_DT);
  const snap = game.snapshot();
  ok(snap.heroes[0].dodgeT > 0, 'the snapshot lost the roll');

  const restored = new Game(fakeMap(), 'normal', ['scott'], snap, 1, 'campaign');
  const rh = restored.heroes[0];
  ok(Math.abs(rh.dodgeT - hero.dodgeT) < 1e-6, 'restore lost the roll timer');
  ok(Math.abs(rh.dodgeCd - hero.dodgeCd) < 1e-6, 'restore lost the cooldown');
  ok(Math.abs(rh.dodgeX - hero.dodgeX) < 1e-6, 'restore lost the roll direction');

  // And it finishes in the same place it would have.
  tick(game, DODGE_TIME);
  tick(restored, DODGE_TIME);
  ok(Math.abs(rh.x - hero.x) < 1e-6 && Math.abs(rh.z - hero.z) < 1e-6,
    'a restored roll landed somewhere else');
}

// ---------- two peers agree ----------
{
  const a = makeGame(), b = makeGame();
  for (let i = 0; i < 90; i++) {
    a.update(SIM_DT); b.update(SIM_DT);
    if (i === 10) { a.exec({ t: 'dodge', p: 0, x: 1, z: 0 }); b.exec({ t: 'dodge', p: 0, x: 1, z: 0 }); }
    if (i === 60) { a.exec({ t: 'dodge', p: 0, x: 0, z: 1 }); b.exec({ t: 'dodge', p: 0, x: 0, z: 1 }); }
  }
  ok(stateHash(a) === stateHash(b), 'two peers rolling identically diverged');

  // A peer that rolled and one that did not must not agree.
  const c = makeGame(), d = makeGame();
  for (let i = 0; i < 30; i++) { c.update(SIM_DT); d.update(SIM_DT); }
  c.exec({ t: 'dodge', p: 0, x: 1, z: 0 });
  for (let i = 0; i < 30; i++) { c.update(SIM_DT); d.update(SIM_DT); }
  ok(stateHash(c) !== stateHash(d), 'a roll left no trace in the hash');
}

// ---------- constants stay sane ----------
ok(DODGE_CD > DODGE_TIME, 'the cooldown must outlast the roll, or it is a movement key');
ok(DODGE_SPEED > 1.5, 'a roll must clearly outrun a walk');
ok(DODGE_IFRAMES > 0.1, 'the invulnerable window must be long enough to matter');

if (failures) {
  console.error(`\ndodge-check: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`dodge-check: ok (${DODGE_TIME}s roll, ${DODGE_IFRAMES}s i-frames, ${DODGE_CD}s cooldown)`);
