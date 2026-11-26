import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TILE } from '../src/config.js';
import { stateHash } from '../src/lockstep-hash.js';
import { guestCommand } from '../src/multiplayer-command.js';
import {
  pointerOrder, quantizeOrder, castSlot, cameraAxisHeld, impactCue, scaledShake,
  armHitStop, tickHitStop, settleBuildToggle,
} from '../src/combat-input.js';
import {
  defaultBinds, actionFor, isHeld, allConflicts, normalizeBinds, setWasdCamera,
  loadBinds, loadFeel, saveBinds, setKeybindBackend, KEYBIND_VERSION, bindKey,
} from '../src/keybinds.js';

const map = () => {
  const size = 48;
  return {
    size, seed: 4242, sites: [], nestSpots: [], nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  };
};

test('default scheme puts four abilities on QWER and keeps the camera off those keys', () => {
  const binds = defaultBinds();
  assert.equal(allConflicts(binds).length, 0);
  assert.equal(binds.ability1, 'q');
  assert.equal(binds.ability2, 'w');
  assert.equal(binds.ability3, 'e');
  assert.equal(binds.ability4, 'r');
  assert.equal(binds.camera_center, ' ');
  assert.equal(binds.attack_move, 'a');
  assert.equal(actionFor(binds, 'w', 'battle'), 'ability2');
  assert.equal(actionFor(binds, ' ', 'battle'), 'camera_center');
  assert.deepEqual(
    ['ability1', 'ability2', 'ability3', 'ability4'].map((action) => castSlot(action, false)),
    [0, 1, 2, 3],
  );
  assert.equal(castSlot('ability1', true), 4);
  assert.equal(castSlot('ability2', true), 5);
  assert.equal(castSlot('ability4', true), 3);
});

test('rebinding a key does not change the command the action sends', () => {
  const binds = normalizeBinds({ ...defaultBinds(), ability4: 'y', ability2: 'f' });
  assert.equal(allConflicts(binds).length, 0);
  assert.equal(actionFor(binds, 'y', 'battle'), 'ability4');
  assert.equal(castSlot(actionFor(binds, 'y', 'battle'), false), 3);
  assert.equal(castSlot(actionFor(binds, 'f', 'battle'), false), 1);
  assert.equal(castSlot('ability1', false), castSlot(actionFor(binds, 'q', 'battle'), false));
});

test('right-click orders move or attack-move and a plain left click does not', () => {
  assert.deepEqual(pointerOrder({ button: 2, enemy: false }), { t: 'horder', k: 'move' });
  assert.deepEqual(pointerOrder({ button: 2, enemy: true }), { t: 'horder', k: 'attack' });
  assert.deepEqual(pointerOrder({ button: 0, armed: true, enemy: false }), { t: 'horder', k: 'attack' });
  assert.equal(pointerOrder({ button: 0, enemy: true }), null);
  assert.equal(pointerOrder({ button: 1 }), null);
  const q = quantizeOrder(10.006, 12.004);
  assert.equal(q.x, 10);
  assert.equal(q.z, 12);
});

test('a latched build waits for the sim to acknowledge payment before it clears', () => {
  const pending = settleBuildToggle({ buttonPay: true, lastPay: true, payHold: false, acked: false });
  assert.equal(pending.buttonPay, true, 'a queued co-op pay is not completion');
  assert.equal(pending.acked, false);
  const live = settleBuildToggle({ ...pending, payHold: true });
  assert.equal(live.buttonPay, true);
  assert.equal(live.acked, true);
  const done = settleBuildToggle({ ...live, payHold: false });
  assert.deepEqual(done, { buttonPay: false, lastPay: false, acked: false });
  const keys = settleBuildToggle({ buttonPay: false, lastPay: true, payHold: false, acked: false });
  assert.equal(keys.lastPay, true, 'a keyboard hold keeps its own release rule');
});

test('WASD camera pan is optional and still leaves one owner per key', () => {
  const on = setWasdCamera(defaultBinds(), {}, true);
  assert.equal(on.feel.wasdCamera, true);
  assert.equal(allConflicts(on.binds).length, 0);
  assert.notEqual(on.binds.ability2, 'w');
  assert.notEqual(on.binds.attack_move, 'a');
  assert.equal(cameraAxisHeld(on.binds, new Set(['w']), 'up', {
    wasdCamera: true, actionFor, isHeld, cameraAction: 'camera_up',
  }), true);
  assert.equal(cameraAxisHeld(on.binds, new Set(['a']), 'left', {
    wasdCamera: true, actionFor, isHeld, cameraAction: 'camera_left',
  }), true);
  assert.equal(castSlot('ability2', false), 1);
  const off = setWasdCamera(on.binds, on.feel, false);
  assert.equal(off.feel.wasdCamera, false);
  assert.equal(off.binds.ability2, 'w');
  assert.equal(off.binds.ability4, 'r');
  assert.equal(off.binds.attack_move, 'a');
  assert.equal(cameraAxisHeld(off.binds, new Set(['w']), 'up', {
    wasdCamera: false, actionFor, isHeld, cameraAction: 'camera_up',
  }), false);
});

test('an old key scheme does not come back and steal W from ability II', () => {
  const store = { value: { v: 1, binds: { ability2: 'e', move_up: 'w', dodge: ' ' } } };
  setKeybindBackend({ load: () => store.value, save: (payload) => { store.value = payload; } });
  try {
    const binds = loadBinds({ force: true });
    const feel = loadFeel();
    assert.equal(binds.ability2, 'w');
    assert.equal(binds.ability4, 'r');
    assert.equal(feel.edgePan, true);
    assert.equal(feel.reduceShake, false);
    assert.equal(store.value.v, 1);
    saveBinds(binds);
    assert.equal(store.value.v, KEYBIND_VERSION);
    assert.equal(store.value.binds.ability2, 'w');
  } finally {
    setKeybindBackend(null);
  }
  assert.equal(KEYBIND_VERSION, 2);
});

test('guest orders are quantized and a forged seat cannot ride along', () => {
  assert.deepEqual(
    guestCommand({ t: 'horder', x: 12.006, z: 8.004, k: 'move' }, 1, 2),
    { t: 'horder', p: 1, x: 12, z: 8, k: 'move' },
  );
  assert.deepEqual(
    guestCommand({ t: 'horder', x: 4, z: 5, k: 'attack', id: 9 }, 1, 2),
    { t: 'horder', p: 1, x: 4, z: 5, k: 'attack', id: 9 },
  );
  assert.equal(guestCommand({ t: 'horder', x: 4, z: 5, k: 'attack', p: 0 }, 1, 2), null);
  assert.equal(guestCommand({ t: 'horder', x: -1, z: 2, k: 'move' }, 1, 2), null);
  assert.equal(guestCommand({ t: 'horder', x: 1, z: 2, k: 'fly' }, 1, 2), null);
});

test('a click order moves the hero, restores, and changes the lockstep hash', () => {
  const game = new Game(map(), 'normal', 'alexander', null, 1);
  const hero = game.heroes[0];
  hero.x = 20; hero.z = 20; hero.mx = 0; hero.mz = 0;
  const before = stateHash(game);
  game.exec({ t: 'horder', p: 0, x: 28.2, z: 20.2, k: 'move' });
  assert.notEqual(stateHash(game), before);
  for (let i = 0; i < 20; i++) game.update(1 / 30);
  assert.ok(hero.x > 20.4, 'the hero should walk toward the order');
  const restored = new Game(map(), 'normal', 'alexander', game.snapshot(), 1);
  assert.equal(stateHash(restored), stateHash(game));
  restored.exec({ t: 'hdir', p: 0, x: 0, z: 1, s: false });
  assert.equal(restored.heroes[0].orderX, null);
  assert.equal(restored.heroes[0].mz, 1);
});

test('numpad events resolve to the direct-move bindings with or without NumLock', () => {
  const binds = defaultBinds();
  assert.equal(bindKey({ code: 'Numpad8', key: '8' }), 'numpad8');
  assert.equal(bindKey({ code: 'Numpad8', key: 'ArrowUp' }), 'numpad8');
  assert.equal(bindKey({ code: 'Numpad4', key: 'ArrowLeft' }), 'numpad4');
  assert.equal(bindKey({ code: 'Numpad2', key: 'ArrowDown' }), 'numpad2');
  assert.equal(bindKey({ code: 'Numpad6', key: 'ArrowRight' }), 'numpad6');
  assert.equal(bindKey({ code: 'Digit8', key: '8' }), '8');
  assert.equal(actionFor(binds, bindKey({ code: 'Numpad8', key: 'ArrowUp' }), 'battle'), 'move_up');
  assert.equal(actionFor(binds, bindKey({ code: 'Numpad8', key: 'ArrowUp' }), 'battle') === 'camera_up', false);
  assert.equal(actionFor(binds, 'arrowup', 'battle'), 'camera_up');
});

test('a stream of deaths cannot hold the picture frozen', () => {
  let state = { hold: 0, gap: 0 };
  let frozen = 0;
  const dt = 1 / 60;
  for (let frame = 0; frame < 600; frame++) {
    const stepped = tickHitStop(state, dt);
    state = { hold: stepped.hold, gap: stepped.gap };
    if (frame % 2 === 0) state = armHitStop(state, 0.045);
    if (stepped.present || state.hold > stepped.hold) frozen += 1;
  }
  assert.ok(frozen < 250, `hit-stop held ${frozen} of 600 frames`);
  const once = armHitStop({ hold: 0, gap: 0 }, 0.07);
  assert.ok(once.hold > 0 && once.hold <= 0.08);
  assert.equal(armHitStop(once, 0.07).hold, once.hold);
});

test('a click order walks around a barrier instead of grinding into it', () => {
  const size = 48;
  const blocked = (x, z) => (x | 0) === 24 && (z | 0) >= 18 && (z | 0) <= 22;
  const game = new Game({
    size, seed: 7, sites: [], nestSpots: [], nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: (x, z) => !blocked(x, z),
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size && !blocked(x, z),
  }, 'normal', 'alexander', null, 1);
  const hero = game.heroes[0];
  hero.x = 20.5; hero.z = 20.5; hero.mx = 0; hero.mz = 0;
  game.exec({ t: 'horder', p: 0, x: 28.5, z: 20.5, k: 'move' });
  for (let i = 0; i < 240; i++) game.update(1 / 30);
  assert.ok(hero.x > 26, `hero stuck at ${hero.x.toFixed(2)}, ${hero.z.toFixed(2)}`);
  const peer = new Game({
    size, seed: 7, sites: [], nestSpots: [], nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: (x, z) => !blocked(x, z),
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size && !blocked(x, z),
  }, 'normal', 'alexander', game.snapshot(), 1);
  assert.equal(stateHash(peer), stateHash(game));
});

test('impact cues stay presentation-only and the shake toggle scales them', () => {
  const kill = impactCue({ type: 'zdeath', big: true });
  assert.ok(kill.hitStop > 0 && kill.sample === 'heavy');
  const shot = impactCue({ type: 'shot', damage: 40, heroKey: 'alexander' });
  assert.equal(shot.number, true);
  assert.equal(shot.hitStop, 0);
  const ult = impactCue({ type: 'cast', key: 'unmake' });
  assert.equal(ult.sample, 'ultimate');
  assert.equal(impactCue({ type: 'shot' }), null);
  assert.equal(scaledShake(0.2, {}), 0.2);
  assert.ok(scaledShake(0.2, { reduceShake: true }) < 0.2);
  assert.equal(scaledShake(0.2, { reduceMotion: true }), 0);
});
