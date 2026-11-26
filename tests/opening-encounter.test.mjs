import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { levelById, SIM_DT } from '../src/config.js';
import { stateHash } from '../src/lockstep-hash.js';

const make = (snapshot = null, heroes = 'scott', difficulty = 'normal', levelId = 1) => {
  const l = levelById(levelId);
  return new Game(new TerrainField(l.seed, l.theme, { size: l.size, nests: l.nests }), difficulty, heroes, snapshot, l.id, 'campaign');
};
const ticks = (g, count) => { for (let i = 0; i < count; i++) { g.update(SIM_DT); g.events.length = 0; } };

test('first paid build launches a bounded mixed encounter after ten seconds on real terrain', () => {
  const g = make(); g.exec({ t: 'found', s: 0, p: 0 });
  ticks(g, 600);
  assert.equal(g.firstSiege.stage, 'opening', 'the choice remains untimed');
  g._construct(g.plots.find(p => p.kind === 'tower'));
  ticks(g, 330);
  assert.equal(g.firstSiege.stage, 'defend');
  const ids = new Set(g.firstSiege.waveIds), wave = g.zombies.filter(z => ids.has(z.id));
  assert.ok(wave.filter(z => z.type === 'walker').length >= 6);
  assert.equal(wave.filter(z => z.type === 'brute').length, 1);
  assert.equal(wave.filter(z => z.type === 'spitter').length, 2);
  assert.ok(wave.every(z => g.map.isWalkable(z.x | 0, z.z | 0)));
  assert.ok(g.firstSiegeRelief());
  const snapshot = g.snapshot();
  ticks(g, 300); const expected = stateHash(g);
  const restored = make(snapshot); ticks(restored, 300);
  assert.equal(stateHash(restored), expected, 'reload carries the same mixed wave forward');
});

test('co-op adds pressure without dropping the readable heavy and ranged roles', () => {
  const g = make(null, ['scott', 'alexander']);g.exec({t:'found',s:0,p:0});
  g._construct(g.plots.find(p => p.kind === 'camp_militia'));ticks(g,330);
  const ids = new Set(g.firstSiege.waveIds), wave=g.zombies.filter(z=>ids.has(z.id));
  assert.ok(wave.length > 15);assert.ok(wave.some(z=>z.type==='brute'));assert.ok(wave.some(z=>z.type==='spitter'));
});

test('later campaign missions do not gain the opening encounter', () => {
  assert.equal(make(null, 'scott', 'normal', 2).firstSiege, null);
});
