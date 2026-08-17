// Overworld check: the menu planet is a real place, so it gets the same
// rigour as a battlefield — built headless in Node, asserted deterministic,
// connected and honest. Worlds are descriptors now, so the check builds TWO:
// the five-front Earth (byte-stable — the refactor to descriptors must not
// move a single tile) and a hand-authored second world, proving a new planet
// is just new data. Runs from `npm run check`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  OverworldField, Overworld, overworldReachable, overworldLayout,
  gateState, overworldChannel, earthWorldDescriptor,
  frontierWorldDescriptor, galaxyDestinations, galaxyWorldDescriptor,
  OVERWORLD_SEED, OVERWORLD_GHOSTS,
} from '../src/overworld.js';
import { LEVELS, LABYRINTH_LEVELS } from '../src/config.js';

const tileHash = (f) =>
  crypto.createHash('sha256').update(Buffer.from(f.tiles)).digest('hex');

// 1. Deterministic: the same descriptor stitches the same planet byte for
// byte. The reference includes Earth's authored Orbital Lift terrace.
const EARTH_HASH = 'PENDING_CUSTOM_GATE_HASH';
const a = new OverworldField(earthWorldDescriptor(0));
const b = new OverworldField(earthWorldDescriptor(0));
assert.equal(tileHash(a), EARTH_HASH, 'Earth tiles are byte-stable across the descriptor refactor');
assert.deepEqual([...a.tiles], [...b.tiles], 'overworld tiles must be seed-stable');
assert.deepEqual([...a.elev].map((v) => Math.round(v * 1e6)), [...b.elev].map((v) => Math.round(v * 1e6)),
  'overworld relief must be seed-stable');
assert.equal(a.size, 128, 'the overworld is a small planet, not a battlefield');
assert.ok(a.overworldLayout && a.overworldLayout.spawn, 'layout is attached to the field');

// A different seed is a different planet (sanity that we truly consume rng).
const c = new OverworldField({ ...earthWorldDescriptor(), seed: OVERWORLD_SEED + 1 });
assert.notDeepEqual([...a.tiles], [...c.tiles], 'overworld must consume its rng');

// 2. Gates: all five fronts plus the labyrinth mouth, in march order.
const layout = overworldLayout(earthWorldDescriptor(0));
assert.equal(layout.gates.length, LEVELS.length + 2, 'one gate per campaign front plus Custom Games and the Orbital Lift');
assert.deepEqual(layout.gates.filter((g) => !g.portal).map((g) => g.levelId), LEVELS.map((l) => l.id), 'gates map to level ids in order');
assert.ok(layout.gates.some((g) => g.portal && g.action === 'custom'), 'Earth has a physical Custom Games arch');
assert.ok(layout.gates.some((g) => g.portal && !g.action), 'Earth has a physical route to the galaxy map');
assert.ok(layout.cave.cave && layout.cave.trials.length === LABYRINTH_LEVELS.length, 'the cave leads to the trials');

// 3. Reachable: every gate stands on walkable ground connected to the spawn
// (map-check's flood idea, applied to the road planet).
const reach = overworldReachable(a);
const N = a.size;
assert.ok(reach.size > N, 'the walkable overworld must be more than a corridor');
for (const g of [...layout.gates, layout.cave]) {
  assert.ok(a.isWalkable(g.x, g.z), `${g.name} gate tile must be walkable`);
  assert.ok(reach.has(g.z * N + g.x), `${g.name} must be reachable from spawn on foot`);
}

// Each region keeps real walkable ground of its own, not just the road.
for (let r = 0; r < LEVELS.length; r++) {
  let walk = 0;
  for (let i = 0; i < a.tiles.length; i++) if (a.region[i] === r) {
    const t = a.tiles[i];
    if (t === 0 || t === 4 || t === 5 || t === 6 || t === 7) walk++; // grass/sand/gold/stone/path
  }
  assert.ok(walk > 300, `region ${LEVELS[r].name} must have real walkable ground (${walk} tiles)`);
}

// 4. Lock state: the campaign ladder, honestly reported at the gates.
assert.deepEqual(gateState(layout.gates[0]), { locked: false, cleared: false }, 'front 1 is always open');
assert.deepEqual(gateState(overworldLayout(earthWorldDescriptor(0)).gates[1]), { locked: true, cleared: false }, 'front 2 locked on a fresh profile');
assert.deepEqual(gateState(overworldLayout(earthWorldDescriptor(1)).gates[1]), { locked: false, cleared: false }, 'winning front 1 opens front 2');
assert.deepEqual(gateState(overworldLayout(earthWorldDescriptor(1)).gates[0]), { locked: false, cleared: true }, 'cleared fronts read cleared');
assert.deepEqual(gateState(overworldLayout(earthWorldDescriptor(4)).gates[4]), { locked: false, cleared: false }, 'the last front opens last');
assert.deepEqual(gateState(layout.cave), { locked: false, cleared: false }, 'the labyrinth is its own door');

// 5. Walk-in triggers: stepping into a gate ring fires the right level id,
// movement collides with impassable tiles, and ghosts expire.
const ow = new Overworld(a, { world: a.overworldWorld });
let sawLevel1 = false, sawLocked = false;
ow.hero.x = layout.gates[0].x + 0.5; ow.hero.z = layout.gates[0].z + 0.5;
for (const ev of ow.update(0.016)) {
  if (ev.t === 'gate' && ev.gate.levelId === 1 && !ev.state.locked) sawLevel1 = true;
}
const lockedLayout = overworldLayout(earthWorldDescriptor(0));
ow.hero.x = lockedLayout.gates[1].x + 0.5; ow.hero.z = lockedLayout.gates[1].z + 0.5;
for (const ev of ow.update(0.016)) {
  if (ev.t === 'gate' && ev.gate.levelId === 2 && ev.state.locked) sawLocked = true;
}
assert.ok(sawLevel1, 'greenfall gate triggers level 1');
assert.ok(sawLocked, 'rotmire gate reports locked on a fresh profile');

// No trigger outside the ring, and no double-trigger inside the cooldown.
assert.equal(ow.update(0.016).length, 0, 'gate respects its cooldown');

// WASD walk with collision: point the hero at the nearest impassable tile
// and it must stop against it, not pass through.
const ow2 = new Overworld(a, {});
const before = { ...ow2.hero };
ow2.setDir(0, -1);
for (let i = 0; i < 400; i++) ow2.update(1 / 60);
assert.ok(ow2.hero.z < before.z, 'the hero walks');
assert.ok(Number.isFinite(ow2.hero.x) && Number.isFinite(ow2.hero.z), 'the hero stays on the planet');
assert.ok(ow2.map.isWalkable(Math.floor(ow2.hero.x), Math.floor(ow2.hero.z)), 'the hero ends on walkable ground');

// Ghost bookkeeping: upsert then expire.
ow.ghostUpsert('p1', { x: 10, z: 10, hero: 'scott', name: 'Scott' }, 0);
assert.equal(ow.ghosts.size, 1, 'ghost upserted');
ow.time = 30;
ow.ghostSweep(6);
assert.equal(ow.ghosts.size, 0, 'stale ghosts are swept');
assert.equal(OVERWORLD_GHOSTS, true, 'ghost flag is on (presence only, never netcode)');

// ---------------------------------------------------------------------------
// World 2 — a hand-authored descriptor, not derived from LEVELS: the shape
// of every future server's universe. One level region on the diagonal, one
// portal region at an explicit position, different seed and spawn.
// ---------------------------------------------------------------------------
const offworld = {
  id: 'kepler442b',
  name: 'Kepler-442b',
  seed: 9091,
  size: 64,
  spawn: { x: 8, z: 40 },
  regions: [
    {
      id: 'kbf-landing', kind: 'level', levelId: 1, label: 'Landing Site',
      blurb: 'First boots on a new world.', boss: { icon: '🛰️', name: 'The Warden' },
      palette: LEVELS[0].theme.palette, terrain: LEVELS[0].theme.terrain,
      gate: { x: 30, z: 22 }, locked: false, cleared: false,
    },
    {
      id: 'kbf-gate', kind: 'portal', label: 'Star Gate',
      palette: LEVELS[4].theme.palette, terrain: LEVELS[4].theme.terrain,
      gate: { x: 50, z: 44 }, locked: false, cleared: false,
    },
  ],
};

// Deterministic: same descriptor, same planet — the promise future servers
// rely on, before any of them exist.
const k1 = new OverworldField(offworld);
const k2 = new OverworldField(offworld);
assert.equal(tileHash(k1), tileHash(k2), 'a hand-authored world is deterministic');
assert.equal(k1.size, 64, 'descriptor size is honoured');
assert.equal(k1.overworldLayout.worldId, 'kepler442b', 'the world id rides along on the layout');

// The portal region projects as a gate and both gates are reachable from the
// authored spawn on foot.
const kLayout = k1.overworldLayout;
assert.equal(kLayout.gates.length, 2, 'one gate per banded region (level + portal)');
assert.ok(kLayout.gates[1].portal && !kLayout.gates[1].levelId, 'the portal is a gate to elsewhere');
assert.ok(!kLayout.cave, 'no labyrinth was authored, none appears');
const kReach = overworldReachable(k1);
for (const g of kLayout.gates) {
  assert.ok(k1.isWalkable(g.x, g.z), `${g.name} gate tile must be walkable`);
  assert.ok(kReach.has(g.z * k1.size + g.x), `${g.name} must be reachable from spawn on foot`);
}

// Ghost presence is scoped per planet: the channel name is a pure function
// of the world id, so every server agrees on where the ghosts walk.
assert.equal(overworldChannel('earth'), 'zl-overworld:earth', 'earth channel name');
assert.equal(overworldChannel(offworld.id), 'zl-overworld:kepler442b', 'descriptor worldId reaches the ghost channel');

// Galaxy navigation is real state, not a level-picker skin. Earth is always
// reachable, the first frontier route opens after the authored fronts, and a
// destination resolves to a persistent planet with a mission and return lift.
const freshGalaxy = galaxyDestinations(0);
assert.equal(freshGalaxy[0].id, 'earth', 'Earth is the starting destination');
assert.ok(freshGalaxy.slice(1).every((world) => !world.unlocked), 'frontier routes stay locked before Earth is cleared');
const openGalaxy = galaxyDestinations(LEVELS.length);
assert.equal(openGalaxy[1].unlocked, true, 'clearing Earth opens the first frontier route');
assert.equal(openGalaxy[2].unlocked, false, 'frontier travel still follows discovered routes');
const frontier = frontierWorldDescriptor(LEVELS.length + 1, LEVELS.length);
assert.equal(galaxyWorldDescriptor(frontier.id, LEVELS.length).id, frontier.id, 'destination id resolves its world descriptor');
const frontierMap = new OverworldField(frontier);
assert.ok(frontierMap.overworldLayout.gates.some((gate) => gate.portal), 'frontier planet has an Orbital Lift home');
assert.ok(frontierMap.overworldLayout.gates.some((gate) => gate.levelId === LEVELS.length + 1), 'frontier planet owns its current playable instance');

console.log('overworld-check: descriptor worlds stitched — Earth byte-stable, second world reachable ✓');
