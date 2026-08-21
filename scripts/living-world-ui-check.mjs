import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeLivingWorld } from '../src/living-world-ui.js';

const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const state = normalizeLivingWorld({
  topology: { landmasses: [{ key: 'earth', name: 'Earth', polygon: [[0,0],[100,0],[100,100]] }], provinces: [{ id: 'province-a', biome: 'forest', polygon: [[10,10],[30,10],[20,30]] }] },
  viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100, zoom: 1, truncated: { parties: 12 } },
  settlements: [{ id: 'town-a', owner: 'free', x: 20, y: 60 }, { id: 'town-b', owner: 'free', x: 45, y: 40 }, { id: 'fort', owner: 'hive', x: 75, y: 25 }],
  routes: [{ from: [20, 60], to: [45, 40] }, { from: [45, 40], to: [75, 25], state: 'contested' }],
  parties: [{ id: 'warband', owner: 'hive', x: 62, y: 35 }],
  missions: [{ id: 'mission-1', known: true, unlocked: true, x: 28, y: 69 }],
});
assert.ok(state.settlements.length >= 3 && state.routes.length >= 2, 'fixture shows towns and routes');
assert.ok(state.parties.some((party) => party.owner === 'hive'), 'fixture shows a hostile roaming army');
assert.ok(state.missions.some((mission) => mission.known && mission.unlocked), 'fixture has a deployable known mission');
assert.equal(state.topology.provinces[0].biome, 'forest', 'immutable province geometry reaches the renderer contract');
assert.ok(state.viewport.truncated.parties, 'dense viewport truncation is preserved for honest LOD messaging');
assert.deepEqual(normalizeLivingWorld({ world: { name: 'Authority world' }, parties: [] }).parties, [], 'authority can replace fixture collections');
assert.deepEqual(normalizeLivingWorld().settlements, [], 'production default does not invent settlements');
assert.deepEqual(normalizeLivingWorld().parties, [], 'production default does not invent roaming armies');
assert.equal(normalizeLivingWorld({ settlements: [{ id: 'x', x: 999, y: -4 }] }).settlements[0].x, 100, 'authority coordinates are bounded for safe rendering');
assert.match(ui, /onPartyCreate/, 'party action exposes authority callback');
assert.match(ui, /onLivingWorldFastTravel/, 'fast travel exposes authority callback');
assert.match(ui, /onLivingWorldMission/, 'mission selection exposes authority callback');
assert.match(ui, /id="lw-terrain"/, 'strategic map renders immutable Earth geography');
assert.match(ui, /_clusterLivingWorldParties/, 'strategic map clusters dense parties at low zoom');
assert.match(ui, /data-map-zoom/, 'strategic map exposes bounded zoom controls');
assert.match(ui, /ACTIVE SIEGE/, 'strategic map exposes visible siege hotspots');
assert.doesNotMatch(ui, /id="ow-custom(?:-quick)?"/, 'Custom Games is absent from the overworld shell');
assert.match(ui, /id="m-custom"/, 'Custom Games remains on character select');
assert.match(css, /\.living-world-map/, 'living map has a dedicated visual shell');
assert.match(css, /\.lw-province/, 'province control and biome layers have map styling');
console.log('living-world-ui-check: party, map, travel, missions and authority hooks ✓');
