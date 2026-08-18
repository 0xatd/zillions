// The Lattice. Generation must be stable, allocation must be legal, and a
// character must survive the tree changing shape underneath them.
import {
  buildLattice, SECTORS, SECTOR_KEYS, DOCTRINES, DOCTRINE_IDS, ORIGINS,
  LATTICE_RINGS, POINT_CAP, LATTICE_VERSION,
  canAllocate, canDeallocate, frontier, pathTo, pruneAlloc, reachableFrom,
  treeBonuses, latticePoints, originIdFor, latticeNode, rewireCost,
} from '../src/skilltree.js';
import { MOD_KEYS } from '../src/items.js';
import { applyCharge, emptyMeta } from '../src/meta.js';
import { Game } from '../src/game.js';
import { TILE } from '../src/config.js';
import { MMO_CLASSES, makeMmoCharacter, normalizeMmoCharacters, characterCamp,
  allocateLatticeNode, deallocateLatticeNode, rewireLattice } from '../src/mmo-characters.js';

let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

const tree = buildLattice();

// ---------- shape ----------
ok(tree.nodes.length > 400, `only ${tree.nodes.length} nodes — the tree is too small to exclude anything`);
ok(POINT_CAP < tree.nodes.length * 0.35,
  `${POINT_CAP} points against ${tree.nodes.length} nodes — a build must exclude far more than it takes`);
ok(tree.version === LATTICE_VERSION, 'tree version mismatch');

const kinds = {};
for (const node of tree.nodes) {
  kinds[node.kind] = (kinds[node.kind] || 0) + 1;
  ok(node.id, 'a node has no id');
  ok(Number.isFinite(node.x) && Number.isFinite(node.y), `${node.id}: no position`);
  ok(node.kind === 'origin' || SECTORS[node.sector], `${node.id}: unknown sector ${node.sector}`);
  ok(node.edges.length > 0, `${node.id}: stranded with no edges`);
  for (const key of Object.keys(node.mods || {})) {
    ok(MOD_KEYS.includes(key), `${node.id}: unknown mod key "${key}"`);
  }
  // Edges must be symmetric, or a path can be walked one way only.
  for (const id of node.edges) {
    const other = tree.byId.get(id);
    ok(other, `${node.id}: edge to a node that does not exist (${id})`);
    ok(other && other.edges.includes(node.id), `${node.id} <-> ${id}: one-way edge`);
  }
}
ok(kinds.origin === Object.keys(ORIGINS).length, 'wrong number of origins');
ok(kinds.doctrine === DOCTRINE_IDS.length, 'wrong number of doctrines');
ok(kinds.relay > 40, `only ${kinds.relay} relays — not enough payoffs`);
ok(kinds.trace > 200, `only ${kinds.trace} traces`);

// Every class has a door in, and every sector is somebody's neighbourhood.
for (const key of Object.keys(MMO_CLASSES)) {
  ok(ORIGINS[key], `class ${key} has no origin`);
  ok(originIdFor(key) && tree.byId.get(originIdFor(key)), `class ${key}: origin node missing`);
}
for (const sector of SECTOR_KEYS) {
  ok(tree.nodes.some((n) => n.sector === sector && n.kind === 'relay'), `sector ${sector} has no relay`);
}

// ---------- determinism ----------
// Same seed, same graph. If this fails, two players are looking at two trees.
const signature = (t) => t.nodes.map((n) => `${n.id}|${n.kind}|${n.sector}|${Math.round(n.x)}|${Math.round(n.y)}|${JSON.stringify(n.mods)}|${[...n.edges].sort().join(',')}`).join('\n');
const first = signature(tree);
ok(first === signature(buildLattice()), 'buildLattice returned a different tree on a second call');

// ---------- everything is reachable ----------
for (const classKey of Object.keys(ORIGINS)) {
  const seen = new Set([originIdFor(classKey)]);
  const queue = [originIdFor(classKey)];
  while (queue.length) {
    const node = tree.byId.get(queue.shift());
    for (const id of node.edges) {
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(id);
    }
  }
  ok(seen.size === tree.nodes.length,
    `${classKey}: can reach ${seen.size} of ${tree.nodes.length} nodes — the rest can never be bought`);
}

// ---------- allocation legality ----------
{
  const classKey = 'recon';
  let alloc = [];
  // Nothing detached from the origin may be bought.
  const far = tree.nodes.find((n) => n.ring === LATTICE_RINGS && n.kind === 'trace');
  ok(!canAllocate(alloc, far.id, classKey), 'bought a node with nothing connecting to it');
  ok(!canAllocate(alloc, originIdFor(classKey), classKey), 'bought the origin itself');
  ok(!canAllocate(alloc, 'no_such_node', classKey), 'bought a node that does not exist');

  // Walk out to the frontier, one legal step at a time.
  for (let i = 0; i < POINT_CAP; i++) {
    const next = [...frontier(alloc, classKey)][0];
    ok(next, `ran out of frontier after ${i} points`);
    ok(canAllocate(alloc, next, classKey), `frontier offered an illegal node at step ${i}`);
    alloc = [...alloc, next];
  }
  ok(alloc.length === POINT_CAP, 'could not spend a full budget');
  ok(new Set(alloc).size === alloc.length, 'allocated the same node twice');
  ok(!canAllocate(alloc, alloc[0], classKey), 'bought an already-owned node');

  // Removing an interior node would strand what is behind it.
  const interior = alloc.find((id) => !canDeallocate(alloc, id, classKey));
  ok(interior, 'no node in a 122-point build was load-bearing — connectivity is not being enforced');
  const leaf = alloc.find((id) => canDeallocate(alloc, id, classKey));
  ok(leaf, 'no node could be removed at all');
  const after = alloc.filter((id) => id !== leaf);
  ok(reachableFrom(after, classKey).size === after.length, 'removing a leaf stranded something');

  // A path is a real route, and every step of it is legal in order.
  const target = tree.nodes.find((n) => n.kind === 'doctrine');
  const path = pathTo([], target.id, classKey);
  ok(path && path.length, 'no path to a doctrine from a bare origin');
  let walking = [];
  for (const id of path) {
    ok(canAllocate(walking, id, classKey), `path step ${id} was not legal in order`);
    walking = [...walking, id];
  }
  ok(walking.includes(target.id), 'walking the path did not arrive');
  ok(pathTo(walking, target.id, classKey).length === 0, 'path to an owned node was not empty');
}

// ---------- pruning is total ----------
{
  const classKey = 'psion';
  ok(pruneAlloc(null, classKey).length === 0, 'prune of null was not empty');
  ok(pruneAlloc(['nope', 'also_nope'], classKey).length === 0, 'prune kept unknown nodes');
  ok(pruneAlloc([originIdFor(classKey)], classKey).length === 0, 'prune kept the origin as a spend');
  // A floating island — legal ids, no route home — must be dropped entirely.
  const island = tree.nodes.filter((n) => n.ring === LATTICE_RINGS - 1).slice(0, 6).map((n) => n.id);
  ok(pruneAlloc(island, classKey).length === 0, 'prune kept a disconnected island');
  // An over-budget build trims to the budget and stays connected.
  let big = [];
  for (let i = 0; i < POINT_CAP; i++) big = [...big, [...frontier(big, classKey)][0]];
  const trimmed = pruneAlloc(big, classKey, 30);
  ok(trimmed.length <= 30, `prune left ${trimmed.length} nodes against a 30-point budget`);
  ok(reachableFrom(trimmed, classKey).size === trimmed.length, 'prune left a disconnected build');
  // Pruning a legal build changes nothing.
  ok(pruneAlloc(big, classKey, POINT_CAP).length === big.length, 'prune damaged a legal build');
}

// ---------- points ----------
ok(latticePoints(1, 0) === 0, 'a level 1 character starts with points');
ok(latticePoints(2, 0) === 1, 'levelling did not grant a point');
ok(latticePoints(100, 0) === 99, 'level 100 does not grant 99 points');
ok(latticePoints(100, 30) === POINT_CAP, 'quest points do not reach the cap');
ok(latticePoints(100, 999) === POINT_CAP, 'the point cap is not enforced');
ok(latticePoints(-5, -5) === 0, 'negative input produced points');
ok(rewireCost(10) > 0 && rewireCost(0) === 0, 'rewire cost is wrong');

// ---------- doctrines ----------
for (const [id, doctrine] of Object.entries(DOCTRINES)) {
  ok(doctrine.name && doctrine.desc && doctrine.cost, `${id}: a doctrine must state its cost`);
  ok(SECTORS[doctrine.sector], `${id}: unknown sector`);
  for (const key of Object.keys(doctrine.mods || {})) {
    ok(MOD_KEYS.includes(key), `${id}: unknown mod key ${key}`);
  }
  const node = tree.nodes.find((n) => n.doctrine === id);
  ok(node, `${id}: no node in the tree`);
  ok(node.ring > LATTICE_RINGS, `${id}: not on the outer edge — a doctrine must be a walk`);
}
// Every doctrine either is pure numbers or names a rule the simulation owns.
// Nothing may promise an effect that is not wired.
const RULE_DOCTRINES = new Set(['scorched_supply', 'hollow_pact']);
for (const [id, doctrine] of Object.entries(DOCTRINES)) {
  if (doctrine.rule) ok(RULE_DOCTRINES.has(id), `${id}: marked as a rule but no rule is implemented`);
  else ok(!RULE_DOCTRINES.has(id), `${id}: implements a rule but is not marked`);
}

// ---------- the payload ----------
{
  const classKey = 'vanguard';
  let alloc = [];
  for (let i = 0; i < 60; i++) alloc = [...alloc, [...frontier(alloc, classKey)][0]];
  const bonuses = treeBonuses(alloc, classKey);
  ok(bonuses.spent === 60, `payload reports ${bonuses.spent} spent, expected 60`);
  ok(MOD_KEYS.every((k) => Number.isFinite(bonuses.mods[k])), 'payload mod bag has a hole');
  ok(Object.values(bonuses.mods).some((v) => v !== 0), 'a 60-point build produced no bonuses');
  ok(Array.isArray(bonuses.doctrines), 'payload doctrines is not a list');
  ok(treeBonuses([], classKey).spent === 0, 'an empty build spent points');
  ok(Object.values(treeBonuses([], classKey).mods).every((v) => v === 0), 'an empty build granted bonuses');
  // The payload never trusts its input.
  ok(treeBonuses(['garbage'], classKey).spent === 0, 'payload honoured an unknown node');
  ok(treeBonuses(null, null).spent === 0, 'payload threw on null');
}

// ---------- the character surface ----------
{
  const character = makeMmoCharacter('Prune Test', 'recon');
  character.level = 50;
  const profile = { mmoCharacters: [character], mmoCharacterId: character.id };
  normalizeMmoCharacters(profile);
  ok(character.talentPoints === latticePoints(50, 0), 'a fresh character has the wrong point count');

  let spent = 0;
  while (allocateLatticeNode(character, [...frontier(character.lattice, 'recon')][0])) spent++;
  ok(spent === latticePoints(50, 0), `spent ${spent}, budget was ${latticePoints(50, 0)}`);
  ok(character.talentPoints === 0, 'points left over after spending the whole budget');
  ok(!allocateLatticeNode(character, [...frontier(character.lattice, 'recon')][0]), 'spent past the budget');

  // The camp resolves the tree to numbers, which is all the simulation sees.
  const camp = characterCamp(character);
  ok(camp.treeMods && Number.isFinite(camp.treeMods.dmg), 'camp carries no resolved tree mods');
  ok(Array.isArray(camp.doctrines), 'camp carries no doctrine list');

  // Losing levels must not brick the character.
  character.level = 10;
  normalizeMmoCharacters(profile);
  ok(character.lattice.length <= latticePoints(10, 0), 'a de-levelled character kept an over-budget build');
  ok(reachableFrom(character.lattice, 'recon').size === character.lattice.length,
    'a de-levelled character kept a disconnected build');

  // Rewire hands everything back.
  character.level = 50;
  normalizeMmoCharacters(profile);
  const returned = rewireLattice(character);
  ok(returned > 0 && character.lattice.length === 0, 'rewire did not clear the build');
  ok(character.talentPoints === latticePoints(50, 0), 'rewire did not return every point');

  // Hostile state normalises rather than throwing.
  character.lattice = ['garbage', 42, null, originIdFor('recon')];
  let threw = false;
  try { normalizeMmoCharacters(profile); } catch { threw = true; }
  ok(!threw, 'normalize threw on a hostile allocation');
  ok(character.lattice.length === 0, 'normalize kept garbage');
  ok(deallocateLatticeNode(character, 'nope') === false, 'deallocated a node that was not owned');
}


// ---------- it reaches the hero ----------
// The whole point: a build must show up as numbers on the unit in the world,
// and a doctrine flag must reach the rule that reads it.
{
  const size = 48;
  const map = {
    size, seed: 5150, sites: [], nestSpots: [], nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: () => true, isBuildable: () => true, isWalkable: () => true,
  };
  const bare = new Game(map, 'normal', ['alexander'], null, 1, 'campaign');
  const bareDmg = bare.heroDmg(bare.heroes[0]);

  const game = new Game(map, 'normal', ['alexander'], null, 1, 'campaign');
  const hero = game.heroes[0];
  hero.treeMods = { dmg: 0.5, hp: 200 };
  hero.doctrines = ['scorched_supply'];
  game._refreshHeroDerived(hero, false);
  game._refreshDoctrines();
  ok(game.heroDmg(hero) > bareDmg, 'tree damage did not reach the hero');
  ok(hero.maxHp > bare.heroes[0].maxHp, 'tree health did not reach the hero');
  ok(game.hasDoctrine('scorched_supply'), 'doctrine flag did not reach the game');
  ok(game._doctrineScorched === true, 'doctrine rule flag was not resolved');

  // Scorched Supply halves a resistance but must not halve a vulnerability.
  const resistant = { hp: 1e9, armor: 0, def: { resist: { thermal: 0.6 } }, resist: null };
  const vulnerable = { hp: 1e9, armor: 0, def: { resist: { thermal: -0.5 } }, resist: null };
  const withRule = game._resolveTypedDamage(resistant, 100, { thermal: 1 });
  const withoutRule = bare._resolveTypedDamage(resistant, 100, { thermal: 1 });
  ok(withRule > withoutRule, 'Scorched Supply did not soften a resistance');
  ok(Math.abs(game._resolveTypedDamage(vulnerable, 100, { thermal: 1 })
    - bare._resolveTypedDamage(vulnerable, 100, { thermal: 1 })) < 1e-9,
    'Scorched Supply changed a vulnerability, which it does not claim to do');

  // Hollow Pact drops the void armour share to nothing.
  const plated = { hp: 1e9, armor: 0.5, def: { resist: null }, resist: null };
  const pact = new Game(map, 'normal', ['alexander'], null, 1, 'campaign');
  pact.heroes[0].doctrines = ['hollow_pact'];
  pact._refreshDoctrines();
  ok(pact._resolveTypedDamage(plated, 100, { void: 1 }) === 100, 'Hollow Pact did not ignore armour');
  ok(bare._resolveTypedDamage(plated, 100, { void: 1 }) < 100, 'void ignored armour without the doctrine');

  // A hero with no tree is untouched, which is what lets this ship dark.
  ok(Math.abs(bareDmg - bare.heroDmg(bare.heroes[0])) < 1e-9, 'a treeless hero moved');
}


// ---------- regression: doctrine numbers are on the right scale ----------
// `hp` is flat and `armor` is an absolute fraction. A doctrine written as if
// they were percentages either costs nothing or costs everything.
for (const [id, doctrine] of Object.entries(DOCTRINES)) {
  for (const [key, value] of Object.entries(doctrine.mods || {})) {
    if (key === 'hp') {
      ok(Math.abs(value) >= 1 || value === 0,
        `${id}: hp is flat, so ${value} is a rounding error rather than a cost`);
    }
    if (key === 'armor' || key === 'evadeChance' || key === 'critChance') {
      ok(Math.abs(value) <= 0.5, `${id}: ${key} ${value} is an absolute fraction and far too large`);
    }
  }
}
// The two doctrines that were mis-scaled, pinned by name.
ok(DOCTRINES.glass_lattice.mods.hp <= -50, 'Glass Lattice must cost real health');
ok(Math.abs(DOCTRINES.forced_march.mods.armor) <= 0.15, 'Forced March must not wipe all damage reduction');

// ---------- regression: rewiring is paid for ----------
// The confirm dialog quoted a Salvage Alloy price that was never charged.
{
  const meta = emptyMeta();
  meta.currency = 500;
  const poor = applyCharge(meta, 900);
  ok(!poor.ok && poor.meta.currency === 500, 'an unaffordable charge went through');
  const paid = applyCharge(meta, 200);
  ok(paid.ok && paid.meta.currency === 300, `a charge did not deduct (${paid.meta.currency})`);
  ok(paid.meta.lifetime.spent === 200, 'a charge did not record lifetime spend');
  ok(applyCharge(meta, 0).ok, 'a zero charge was refused');
  ok(applyCharge(meta, -50).meta.currency === 500, 'a negative charge added currency');
  ok(rewireCost(20) > 0, 'rewiring is free');
}

if (failures) {
  console.error(`\nskilltree-check: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`skilltree-check: ok (${tree.nodes.length} nodes, ${kinds.relay} relays, ${DOCTRINE_IDS.length} doctrines, ${Object.keys(ORIGINS).length} origins, ${POINT_CAP} points)`);
