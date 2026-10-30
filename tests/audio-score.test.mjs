import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BIOME_AMBIENT, CUES, MUSIC_IDS, AMBIENT_IDS,
  biomeAmbient, selectMusic, nextCombat, distanceGain, pitchScale, clamp01,
  shotCue, proceduralShotKind, abilityCue,
} from '../src/audio-score.js';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { SIM_DT, levelById } from '../src/config.js';
import { stateHash } from '../src/lockstep-hash.js';

test('music follows menu, build, combat, and the stingers', () => {
  assert.equal(selectMusic(null), 'menu');
  assert.equal(selectMusic({ inMatch: false }), 'menu');
  assert.equal(selectMusic({ inMatch: true, phase: 'found' }), 'build');
  assert.equal(selectMusic({ inMatch: true, phase: 'live', combat: false }), 'build');
  assert.equal(selectMusic({ inMatch: true, phase: 'live', combat: true }), 'combat');
  assert.equal(selectMusic({ inMatch: true, over: true, won: true }), 'victory');
  assert.equal(selectMusic({ inMatch: true, over: true, won: false }), 'defeat');
});

test('combat bed engages and releases with hysteresis', () => {
  assert.equal(nextCombat(false, 1), false);
  assert.equal(nextCombat(false, 2), true);
  assert.equal(nextCombat(true, 1), true);
  assert.equal(nextCombat(true, 0), false);
});

test('distance gain falls off and stays inside its floor', () => {
  assert.equal(distanceGain(0), 1);
  assert.equal(distanceGain(6), 1);
  assert.equal(distanceGain(38), 0.05);
  assert.ok(distanceGain(80) === 0.05);
  assert.ok(distanceGain(12) < distanceGain(8));
  assert.ok(distanceGain(20) > distanceGain(30));
});

test('pitch scale stays inside the jitter window', () => {
  assert.equal(pitchScale(0, 0.06), 0.94);
  assert.equal(pitchScale(1, 0.06), 1.06);
  assert.equal(pitchScale(0.5, 0.06), 1);
  assert.equal(pitchScale(() => 0.25, 0), 1);
});

test('biome loops cover the five campaign landforms', () => {
  assert.deepEqual(
    ['moor', 'fen', 'wastes', 'hills', 'vale'].map(biomeAmbient),
    ['meadow', 'swamp', 'volcanic', 'snow', 'valley'],
  );
  assert.equal(BIOME_AMBIENT.labyrinth, 'volcanic');
  assert.equal(biomeAmbient('unknown'), 'meadow');
});

test('every shipped cue has a sample, and every sample is a known cue', async () => {
  const index = JSON.parse(await readFile(new URL('../assets/audio/cc0/index.json', import.meta.url), 'utf8'));
  for (const id of Object.keys(CUES)) {
    assert.ok(index.cues[id]?.length, id + ' missing from the CC0 index');
  }
  for (const id of Object.keys(index.cues)) assert.ok(CUES[id], 'unknown cue ' + id);
  for (const id of MUSIC_IDS) assert.ok(index.music[id]);
  for (const id of AMBIENT_IDS) assert.ok(index.ambient[id]);
  assert.equal(shotCue('flame'), 'shot.flame');
  assert.equal(shotCue('ballista'), 'shot.ballista');
  assert.equal(shotCue('outpostSiege'), 'shot.outpostSiege');
  assert.equal(proceduralShotKind('flame'), 'tower');
  assert.equal(proceduralShotKind('ballista'), 'sniper');
  assert.equal(abilityCue('grenade'), 'ability.blast');
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(4), 1);
});

test('importing audio does not change the simulation hash', async () => {
  await import('../src/audio.js');
  const level = levelById(1);
  const make = () => new Game(
    new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests }),
    'normal', 'alexander', null, 1, 'campaign', { rngSeed: 9 },
  );
  const a = make();
  const b = make();
  for (let i = 0; i < 40; i++) { a.update(SIM_DT); b.update(SIM_DT); }
  assert.equal(stateHash(a), stateHash(b));
  a.exec({ t: 'found', s: 0, p: 0 });
  b.exec({ t: 'found', s: 0, p: 0 });
  for (let i = 0; i < 20; i++) { a.update(SIM_DT); b.update(SIM_DT); }
  assert.equal(stateHash(a), stateHash(b));
});
