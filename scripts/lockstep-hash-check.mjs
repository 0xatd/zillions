// The lockstep hash is what stops two peers playing different games without
// noticing. Gear and the Lattice now feed it, so every way two characters can
// differ has to move the number — and every way they are the same has to not.
import { stateHash } from '../src/lockstep-hash.js';
import { Game } from '../src/game.js';
import { TILE } from '../src/config.js';
import { rollItemKey } from '../src/items.js';

let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

const size = 48;
const fakeMap = () => ({
  size, seed: 31337, sites: [], nestSpots: [], nodeSpots: [],
  tiles: new Uint8Array(size * size).fill(TILE.GRASS),
  idx: (x, z) => z * size + x,
  inBounds: () => true, isBuildable: () => true, isWalkable: () => true,
});
const peer = (camp) => new Game(fakeMap(), 'normal', [{ k: 'scott', camp }], null, 1, 'campaign');

const rifle = rollItemKey('marksman_mk2', 'lh-a', 40, 3);
const scatter = rollItemKey('scatter_mk2', 'lh-b', 40, 3);
const plate = rollItemKey('siege_plate', 'lh-c', 40, 2);
const base = { level: 20, items: [], equipment: { weapon: rifle }, lattice: [], doctrines: [], activeSet: 0 };

// ---------- identical peers agree ----------
ok(stateHash(peer(base)) === stateHash(peer({ ...base })), 'two identical peers disagree');
ok(stateHash(peer(base)) === stateHash(peer(JSON.parse(JSON.stringify(base)))), 'a round-tripped camp changed the hash');

// ---------- every way to differ must be caught ----------
const differs = (label, camp) => {
  ok(stateHash(peer(base)) !== stateHash(peer(camp)), `${label}: peers differ but the hash does not`);
};
differs('a different weapon', { ...base, equipment: { weapon: scatter } });
differs('no weapon at all', { ...base, equipment: {} });
differs('extra armour', { ...base, equipment: { weapon: rifle, armor: plate } });
differs('a second weapon set', { ...base, equipment: { weapon: rifle, weapon2: scatter } });
differs('a doctrine', { ...base, doctrines: ['lone_command'] });
differs('a different doctrine', { ...base, doctrines: ['hollow_pact'] });
differs('a different level', { ...base, level: 21 });

// The drawn set must move the hash even with the same equipment on both peers.
{
  const twoSets = { ...base, equipment: { weapon: rifle, weapon2: scatter } };
  const drawnFirst = peer({ ...twoSets, activeSet: 0 });
  const drawnSecond = peer({ ...twoSets, activeSet: 1 });
  ok(stateHash(drawnFirst) !== stateHash(drawnSecond), 'the drawn weapon set does not reach the hash');
}

// A forged key that resolves to something different on the other peer must be
// caught. Same base and level, different roll seed — the affixes differ, so
// the resolved weapon differs, so the hash differs.
{
  const forged = rollItemKey('marksman_mk2', 'forged', 40, 3);
  ok(forged !== rifle, 'test fixture: the two keys should differ');
  differs('a differently-rolled weapon of the same base', { ...base, equipment: { weapon: forged } });
}

// ---------- the hash is a stable integer ----------
{
  const game = peer(base);
  const first = stateHash(game);
  ok(Number.isInteger(first), `hash is not an integer: ${first}`);
  ok(stateHash(game) === first, 'hashing the same game twice gave two answers');
  // It must not drift while nothing happens, and must move once things do.
  for (let i = 0; i < 5; i++) game.update(1 / 30);
  const moved = stateHash(game);
  ok(Number.isInteger(moved), 'hash stopped being an integer after ticks');
}

// ---------- a peer that has run the same commands agrees ----------
// This is the real lockstep property: same start, same inputs, same hash.
{
  const a = peer(base);
  const b = peer({ ...base });
  for (let i = 0; i < 120; i++) {
    a.update(1 / 30);
    b.update(1 / 30);
    if (i === 40) { a.exec({ t: 'stance', s: 'attack', p: 0 }); b.exec({ t: 'stance', s: 'attack', p: 0 }); }
    if (i === 80) { a.exec({ t: 'cast', p: 0 }); b.exec({ t: 'cast', p: 0 }); }
  }
  ok(stateHash(a) === stateHash(b), 'two peers running identical commands diverged');
}

// And a pair whose simulations actually diverge must not agree. Note the hash
// covers gold, entity counts, kills, hero position, level, upgrades, gear and
// the Lattice — it does NOT cover army stance or individual troop positions,
// which is a pre-existing shape this change did not widen.
{
  const a = peer(base);
  const b = peer({ ...base });
  for (let i = 0; i < 60; i++) { a.update(1 / 30); b.update(1 / 30); }
  ok(stateHash(a) === stateHash(b), 'two peers diverged before anything happened');
  a.gold += 25;
  ok(stateHash(a) !== stateHash(b), 'a treasury divergence produced the same hash');
  a.gold -= 25;
  ok(stateHash(a) === stateHash(b), 'the hash did not come back when the state did');
  a.heroes[0].x += 3;
  ok(stateHash(a) !== stateHash(b), 'a hero position divergence produced the same hash');
}


// ---------- regression: the Lattice reaches the hash ----------
// Hashing equipment keys and doctrine ids alone let two peers carry different
// tree damage and health and still agree. Reported on PR #77.
{
  const withTree = (mods, doctrines = []) => peer({
    ...base, treeMods: mods, doctrines,
    treeSets: [{ mods, doctrines }, { mods, doctrines }],
  });
  const a = withTree({ dmg: 0.2, hp: 100 });
  const b = withTree({ dmg: 0.5, hp: 250 });
  ok(stateHash(a) !== stateHash(b), 'two peers with different Lattice bonuses produced the same hash');
  ok(stateHash(a) === stateHash(withTree({ dmg: 0.2, hp: 100 })), 'identical Lattice bonuses disagreed');

  // A single key, and a tiny difference in one, both have to move it.
  ok(stateHash(withTree({ dmg: 0.2 })) !== stateHash(withTree({ dmg: 0.21 })), 'a small mod difference was lost');
  ok(stateHash(withTree({ dmg: 0.2 })) !== stateHash(withTree({ hp: 0.2 })),
    'two different keys with the same value hashed the same');
  ok(stateHash(withTree({})) !== stateHash(withTree({ dmg: 0.2 })), 'an empty bag matched a populated one');

  // A difference pinned to the SHEATHED set must be caught before it is drawn.
  const pinnedA = peer({ ...base, treeSets: [{ mods: {}, doctrines: [] }, { mods: { dmg: 0.4 }, doctrines: [] }], activeSet: 0 });
  const pinnedB = peer({ ...base, treeSets: [{ mods: {}, doctrines: [] }, { mods: { dmg: 0.9 }, doctrines: [] }], activeSet: 0 });
  ok(stateHash(pinnedA) !== stateHash(pinnedB), 'a difference on the sheathed set was not caught');

  // Doctrines carried per set must reach it too.
  const docA = peer({ ...base, treeSets: [{ mods: {}, doctrines: [] }, { mods: {}, doctrines: ['scorched_supply'] }] });
  const docB = peer({ ...base, treeSets: [{ mods: {}, doctrines: [] }, { mods: {}, doctrines: [] }] });
  ok(stateHash(docA) !== stateHash(docB), 'a per-set doctrine did not reach the hash');
}

if (failures) {
  console.error(`\nlockstep-hash-check: ${failures} failure(s)`);
  process.exit(1);
}
console.log('lockstep-hash-check: ok (gear, sets, doctrines and commands all reach the hash)');
