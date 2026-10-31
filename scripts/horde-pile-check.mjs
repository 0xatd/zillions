// Horde mounds: bodies climb a stalled rank, a tall enough mound spills a
// wall, and killing the base drops the climbers. Snapshot/restore has to
// reproduce the same mound. Late musters grow, and the living cap holds.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Game } from '../src/game.js';
import {
  HORDE_PILE, PLOT_KINDS, SIM_DT, THREAT, TILE, hiveSquad, hordeCap, pileCrest,
} from '../src/config.js';

const size = 72;
function makeMap() {
  const tiles = new Uint8Array(size * size).fill(TILE.GRASS);
  return {
    size, seed: 7,
    sites: [{ x: 36, z: 54 }],
    nestSpots: [[8, 8]],
    nodeSpots: [{ x: 36, z: 30, kind: 'clearing', name: 'Gate Road' }],
    tiles,
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  };
}

function addBuilding(game, kind, x, z, opts = {}) {
  const def = PLOT_KINDS[kind].tiers[0];
  const plotId = opts.plotId ?? -1;
  const s = kind === 'hq' ? 3 : 1;
  const b = {
    id: opts.id, plotId, kind, key: kind, def,
    x, z, size: s,
    cx: x + s / 2, cz: z + s / 2,
    hp: 1e9, maxHp: 1e9, alive: true, cooldown: 0,
    gate: !!opts.gate, priority: 0,
  };
  game.buildings.push(b);
  for (let dz = 0; dz < s; dz++) for (let dx = 0; dx < s; dx++) {
    game.occ[(z + dz) * size + (x + dx)] = b.id;
  }
  if (b.gate) game.gateIds.add(b.id);
  return b;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashSnap(snap) {
  return createHash('sha256').update(stable(snap)).digest('hex');
}

// ---------- crest rules stay readable ----------
assert.deepEqual(pileCrest('wall', 1, false, null), { layers: 2, spill: true });
assert.deepEqual(pileCrest('wall', 2, false, null), { layers: 3, spill: true });
assert.deepEqual(pileCrest('wall', 3, false, null), { layers: 4, spill: true });
assert.deepEqual(pileCrest('wall', 1, true, null), { layers: 3, spill: true });
assert.equal(pileCrest('wall', 3, false, 'bastion').layers, 5);
assert.equal(pileCrest('tower', 3, false, null).spill, false);
assert.ok(hordeCap(0) < hordeCap(THREAT.max));
let previous = 0;
for (let threat = 0; threat <= THREAT.max; threat++) {
  const squad = hiveSquad(threat, 1);
  assert.ok(squad.size >= previous, `squad shrank at Threat ${threat}`);
  previous = squad.size;
}
assert.ok(hiveSquad(12, 1).size >= hiveSquad(3, 1).size * 4, 'later musters should be crowds, not squads');
assert.equal(hiveSquad(0, 1).size, 5, 'the opening muster stays a handful');

// ---------- a crowd at a fence ----------
const game = new Game(makeMap(), 'normal', 'scott', null, 2, 'campaign');
game.phase = 'found';
for (const n of game.nests) n.alive = false;
game.zombies = [];
const hero = game.heroes[0];
hero.x = 2.5; hero.z = 2.5; hero.mx = 0; hero.mz = 0;
game.plots.push({ id: 7, tier: 1, branch: null, kind: 'wall' });
let next = 8000;
addBuilding(game, 'hq', 34, 56, { id: next++ });
// Edge to edge, so the flow cannot walk around the fence.
for (let x = 0; x < size; x++) {
  addBuilding(game, 'wall', x, 40, { id: next++, plotId: 7 });
}
game.hq = game.buildings.find((b) => b.kind === 'hq');
game.flowDirty = true;

const spawned = [];
for (let i = 0; i < 90; i++) {
  const x = 28 + (i % 15) * 0.72;
  const z = 16 + ((i / 15) | 0) * 0.72;
  const zb = game._spawnZombie('walker', x, z, true, true);
  spawned.push(zb);
}
assert.equal(spawned.length, 90);

let maxLayer = 0;
let spilled = 0;
for (let tick = 0; tick < 360; tick++) {
  game.update(SIM_DT);
  for (const zb of game.zombies) {
    if (zb.dead) continue;
    if ((zb.layer || 0) > maxLayer) maxLayer = zb.layer;
    if (zb.z > 41.2) spilled++;
  }
}
assert.ok(maxLayer >= 2, `mound never climbed (max layer ${maxLayer})`);
assert.ok(spilled > 0, 'a tall enough mound should spill the fence');

// Killing the base drops every climber still on it.
const bases = game.zombies.filter((z) => !z.dead && (z.layer || 0) === 0);
assert.ok(bases.length > 0, 'the mound should still have a ground rank');
for (const zb of bases) zb.dead = true;
game.update(SIM_DT);
// A body already spilling when the base dies is committed. Everyone still
// standing on a corpse should be on the ground.
const stillUp = game.zombies.filter((z) => !z.dead && (z.layer || 0) > 0 && !(z.vaultT > 0));
assert.equal(stillUp.length, 0, `killing the base left ${stillUp.length} climbers in the air`);

// ---------- a bastion has to be buried before anyone spills ----------
{
  const fort = new Game(makeMap(), 'normal', 'scott', null, 2, 'campaign');
  fort.phase = 'found';
  for (const n of fort.nests) n.alive = false;
  fort.zombies = [];
  fort.heroes[0].x = 2.5; fort.heroes[0].z = 2.5;
  fort.plots.push({ id: 9, tier: 3, branch: 'bastion', kind: 'wall' });
  let id = 9000;
  addBuilding(fort, 'hq', 34, 56, { id: id++ });
  for (let x = 0; x < size; x++) addBuilding(fort, 'wall', x, 40, { id: id++, plotId: 9 });
  fort.hq = fort.buildings.find((b) => b.kind === 'hq');
  fort.flowDirty = true;
  for (let i = 0; i < 70; i++) {
    fort._spawnZombie('walker', 30 + (i % 14) * 0.55, 38.4 - ((i / 14) | 0) * 0.55, true, true);
  }
  let tall = 0;
  let over = 0;
  for (let tick = 0; tick < 220; tick++) {
    fort.update(SIM_DT);
    for (const zb of fort.zombies) {
      if (zb.dead) continue;
      if ((zb.layer || 0) > tall) tall = zb.layer;
      if (zb.z > 41.2) over++;
    }
  }
  assert.ok(tall >= 4, `bastion mound only reached layer ${tall}`);
  assert.ok(over > 0, 'a buried bastion should eventually spill');
}

// ---------- restore reproduces the mound ----------
const again = new Game(makeMap(), 'normal', 'scott', null, 2, 'campaign');
again.phase = 'found';
for (const n of again.nests) n.alive = false;
again.zombies = [];
again.heroes[0].x = 2.5; again.heroes[0].z = 2.5;
again.plots.push({ id: 7, tier: 1, branch: null, kind: 'wall' });
next = 8000;
addBuilding(again, 'hq', 34, 56, { id: next++ });
for (let x = 0; x < size; x++) addBuilding(again, 'wall', x, 40, { id: next++, plotId: 7 });
again.hq = again.buildings.find((b) => b.kind === 'hq');
again.flowDirty = true;
for (let i = 0; i < 90; i++) {
  again._spawnZombie('walker', 28 + (i % 15) * 0.72, 16 + ((i / 15) | 0) * 0.72, true, true);
}
for (let tick = 0; tick < 300; tick++) again.update(SIM_DT);
const saved = JSON.parse(JSON.stringify(again.snapshot()));
const live = new Game(makeMap(), 'normal', 'scott', saved, 2, 'campaign');
const twin = new Game(makeMap(), 'normal', 'scott', JSON.parse(JSON.stringify(saved)), 2, 'campaign');
for (let tick = 0; tick < 45; tick++) {
  live.update(SIM_DT);
  twin.update(SIM_DT);
}
assert.equal(hashSnap(live.snapshot()), hashSnap(twin.snapshot()), 'pile restore diverged');
const savedMeta = saved.zombies.map((row) => row[8] || {});
assert.ok(
  savedMeta.some((meta) => (meta.layer || 0) > 0 || (meta.vault || 0) > 0)
    || saved.zombies.some((row) => row[2] > 41),
  'snapshot dropped the mound',
);

// ---------- the living cap binds a late muster ----------
const capped = new Game(makeMap(), 'normal', 'scott', null, 2, 'campaign');
capped.phase = 'found';
capped.threat = 18;
for (let i = 0; i < hordeCap(18); i++) {
  capped._spawnZombie('walker', 10 + (i % 40) * 0.4, 10 + ((i / 40) | 0) * 0.4, true, true);
}
const before = capped.zombies.length;
const types = hiveSquad(18, 1).types;
const extra = capped._spawnHorde(5000, [], types, capped._hordeRoom(false));
assert.equal(extra, 0, 'a full field should not keep mustering');
assert.equal(capped.zombies.length, before);
const surge = capped._spawnHorde(5000, [], types, capped._hordeRoom(true));
assert.ok(surge > 0, 'a surge may still overshoot a full field');
assert.ok(capped.zombies.length <= Math.floor(hordeCap(18) * HORDE_PILE.surgeCap) + 2);

console.log(`horde pile ok: mound reached layer ${maxLayer}, spilled ${spilled} crossings, late squad ${hiveSquad(18, 1).size}, cap ${hordeCap(18)}`);
