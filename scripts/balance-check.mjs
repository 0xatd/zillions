import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { generatePlots } from '../src/plots.js';
import { reachableFrom } from '../src/lanes.js';
import {
  HEROES, LEVELS, NEST_HP_BASE, NEST_HP_LEVEL_SHARE, NODE_KINDS, PAY_RADIUS, PLOT_KINDS, SIEGE, UPGRADE_PAY_RATE,
  START_GOLD, SUPPLY, THREAT, TILE, UNITS, hiveInterval, hiveSquad,
} from '../src/config.js';

function fakeMap(level) {
  const size = level.size || 160;
  const tiles = new Uint8Array(size * size).fill(TILE.GRASS);
  const centers = [
    [size / 2 + 21, size / 2 - 13],
    [size / 2 - 19, size / 2 + 14],
    [size / 2 + 8, size / 2 + 24],
    [size / 2 - 27, size / 2 - 4],
  ];
  for (const [cx, cz] of centers) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dz * dz > 6) continue;
        const x = Math.round(cx + dx);
        const z = Math.round(cz + dz);
        tiles[z * size + x] = TILE.GOLDORE;
      }
    }
  }
  // Nests and lane nodes ring the city so the siege systems have real targets.
  const ring = (count, radius, from) => Array.from({ length: count }, (_, i) => {
    const ang = (i / count) * Math.PI * 2 + from;
    return [
      Math.round(size / 2 + Math.cos(ang) * radius),
      Math.round(size / 2 + Math.sin(ang) * radius),
    ];
  });
  return {
    size,
    seed: level.seed,
    sites: [{ x: size / 2, z: size / 2 }],
    tiles,
    nestSpots: ring(level.nests || 3, size * 0.36, 0.3),
    nodeSpots: ring(8, size * 0.24, 0.1).map(([x, z], i) => ({
      x, z, name: `Node ${i + 1}`, kind: ['ore', 'ford', 'barrow', 'clearing', 'quarry'][i % 5],
    })),
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  };
}

function tierCost(kind, tier = 0) {
  return PLOT_KINDS[kind].tiers[tier].cost;
}

const openingCost =
  tierCost('tower') +
  tierCost('camp_ranger') +
  tierCost('farm') +
  tierCost('house');

// Income is a continuous trickle now, so payback is measured in seconds of
// siege rather than in dawns. A level runs many minutes; anything that takes
// longer than three minutes to pay for itself is a trap.
const MAX_PAYBACK_SECONDS = 180;
assert.ok(UPGRADE_PAY_RATE >= 50, 'building upgrades must not require long stationary holds');
const paybacks = [
  ['farm t2', tierCost('farm', 1), PLOT_KINDS.farm.tiers[1].income - PLOT_KINDS.farm.tiers[0].income],
  ['house t2', tierCost('house', 1), PLOT_KINDS.house.tiers[1].income - PLOT_KINDS.house.tiers[0].income],
  ['mill t2', tierCost('mill', 1), PLOT_KINDS.mill.tiers[1].income - PLOT_KINDS.mill.tiers[0].income],
  ['mine t2', tierCost('mine', 1), PLOT_KINDS.mine.tiers[1].income - PLOT_KINDS.mine.tiers[0].income],
];

function assertUpgradeReachFromAllSides(level) {
  const map = fakeMap(level);
  const game = new Game(map, 'normal', 'alexander', null, level.id || 1, 'campaign');
  game.foundCity(0, 0);
  const plot = game.plots.find((p) => p.kind === 'house');
  assert.ok(plot, `${level.name} did not generate a house plot`);
  game._construct(plot, true);

  for (const other of game.plots) {
    if (other === plot) continue;
    other.tier = PLOT_KINDS[other.kind].tiers.length;
  }

  const h = game.heroes[0];
  const offset = Math.min(1.0, PAY_RADIUS * 0.6);
  const probes = [
    ['north/top', plot.cx, plot.z - offset],
    ['south/bottom', plot.cx, plot.z + plot.size + offset],
    ['west/left', plot.x - offset, plot.cz],
    ['east/right', plot.x + plot.size + offset, plot.cz],
    ['northwest corner', plot.x - offset, plot.z - offset],
    ['northeast corner', plot.x + plot.size + offset, plot.z - offset],
  ];

  for (const [side, x, z] of probes) {
    h.x = x;
    h.z = z;
    const target = game.buildTargetFor(h);
    assert.equal(target?.plot?.id, plot.id, `${level.name} upgrade target failed from ${side}`);
  }
}

function assertCampRoadAccess(level) {
  const map = fakeMap(level);
  const plots = generatePlots(map, map.sites[0]);
  const camps = plots.filter((p) => p.kind.startsWith('camp_'));
  // Every entrance is a ward with its own barracks, so the count follows the
  // number of gates the terrain left open. What must always hold is that all
  // three doctrines are buildable and every camp sits on a road.
  for (const kind of ['camp_militia', 'camp_ranger', 'camp_sniper']) {
    assert.ok(camps.some((c) => c.kind === kind), `${level.name} cannot build a ${kind}`);
  }
  assert.ok(camps.length >= 3 && camps.length <= 6,
    `${level.name} generated ${camps.length} city camps`);

  for (const camp of camps) {
    let hasPathEdge = false;
    for (let z = camp.z - 1; z <= camp.z + camp.size; z++) {
      for (let x = camp.x - 1; x <= camp.x + camp.size; x++) {
        const inside = x >= camp.x && x < camp.x + camp.size && z >= camp.z && z < camp.z + camp.size;
        if (!inside && map.tiles[z * map.size + x] === TILE.PATH) hasPathEdge = true;
      }
    }
    assert.ok(hasPathEdge, `${level.name} ${camp.kind} has no visible road edge`);
  }
}

function assertLaneWaypointsAreSteppable(game, label) {
  for (const [key, path] of game.laneGraph.lanes.entries()) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      assert.ok(len <= Math.SQRT2 + 0.06,
        `${label}: lane ${key} has compressed waypoint ${i}->${i + 1} (${len.toFixed(2)} tiles)`);
      assert.ok(game.map.isWalkable(a[0] | 0, a[1] | 0), `${label}: lane ${key} waypoint ${i} is not walkable`);
      assert.ok(game.map.isWalkable(b[0] | 0, b[1] | 0), `${label}: lane ${key} waypoint ${i + 1} is not walkable`);
    }
  }
}

// The siege must actually run: hives muster, camps muster, nodes flip, and
// repairing a damaged structure has to cost gold and restore health.
function assertSiegeLoop(level) {
  const map = fakeMap(level);
  const game = new Game(map, 'normal', 'alexander', null, level.id || 1, 'campaign');
  game.foundCity(0, 0);
  assert.equal(game.phase, 'live', `${level.name} did not enter the live siege after founding`);
  assert.ok(game.laneGraph && game.laneGraph.size > 0, `${level.name} built no lane graph`);
  assert.ok(game.nodes.length > 0, `${level.name} generated no lane nodes`);
  assertLaneWaypointsAreSteppable(game, level.name);
  assert.ok(
    game.plots.some((p) => p.kind === 'outpost'),
    `${level.name} generated no Forward Camp plots on its nodes`,
  );
  assert.ok(game.plotLocked(game.plots.find((p) => p.kind === 'outpost')),
    `${level.name} lets a Forward Camp be funded on ground the player does not hold`);

  // The lane graph MUST be one connected piece from the city's point of view.
  // Nearest-neighbour linking alone fragments into concentric shells, and a
  // hive stranded in its own component can never be razed — which silently
  // makes the map unwinnable, since razing every hive is the win condition.
  const reach = reachableFrom(game.laneGraph, game.cityGi);
  for (const nest of game.nests) {
    assert.ok(reach.has(nest.gi),
      `${level.name}: a hive nest is unreachable from the city — the map cannot be won`);
    assert.ok(game.laneGraph.adj[nest.gi].length > 0, `${level.name}: a hive nest has no approach lane`);
  }
  for (const node of game.nodes) {
    assert.ok(node.offMap === reach.has(node.gi) === false || node.offMap !== reach.has(node.gi),
      `${level.name}: ${node.name} offMap flag disagrees with reachability`);
    if (node.offMap) continue;
    assert.ok(game.laneGraph.adj[node.gi].length > 0, `${level.name}: ${node.name} has no lane`);
  }
  assert.ok(game.activeNodes().length > 0, `${level.name} left no reachable lane nodes`);

  // Ground is terrain; ownership is a separate fact you have to go and learn.
  for (const node of game.activeNodes()) {
    assert.ok(NODE_KINDS[node.kind], `${level.name}: ${node.name} has no terrain kind`);
    assert.ok(node.def === NODE_KINDS[node.kind], `${level.name}: ${node.name} kind and def disagree`);
  }
  const claimed = game.activeNodes().filter((n) => n.owner === 'hive').length;
  assert.ok(claimed > 0, `${level.name}: the hive claimed no ground at all`);
  assert.ok(claimed < game.activeNodes().length,
    `${level.name}: the hive claimed everything — nothing is left neutral`);
  assert.ok(game.activeNodes().every((n) => !n.seen),
    `${level.name}: nodes start surveyed, so there is nothing to scout`);

  // Getting close surveys it — and only it.
  const far = game.activeNodes().find((n) => n.owner === 'hive');
  const hero0 = game.heroes[0];
  hero0.x = far.x; hero0.z = far.z;
  game._updateScouting();
  assert.ok(far.seen, `${level.name}: standing on a node did not survey it`);
  assert.ok(game.activeNodes().some((n) => !n.seen),
    `${level.name}: surveying one node revealed the whole map`);

  // Kind changes what the ground is worth and what you can build on it.
  assert.ok(NODE_KINDS.ore.income > NODE_KINDS.ford.income, 'an ore field must out-earn a ford');
  const oreNode = game.activeNodes().find((n) => n.kind === 'ore');
  const quarryNode = game.activeNodes().find((n) => n.kind === 'quarry');
  if (oreNode && quarryNode) {
    const orePlot = game.plots.find((p) => p.kind === 'outpost' && p.nodeId === oreNode.id);
    const quarryPlot = game.plots.find((p) => p.kind === 'outpost' && p.nodeId === quarryNode.id);
    if (orePlot && quarryPlot) {
      assert.ok(game.tierDef(quarryPlot, 1).hp > game.tierDef(orePlot, 1).hp,
        `${level.name}: a Forward Camp on a quarry is not tougher than one on open ore`);
    }
  }
  const outpost = PLOT_KINDS.outpost;
  assert.ok(outpost.tiers.length >= 3, `${level.name}: Forward Camps must upgrade into lane anchors`);
  assert.ok(outpost.tiers[1].dmg > 0 && outpost.tiers[1].range <= 7,
    `${level.name}: War Outpost must provide short-range lane fire`);
  assert.ok(outpost.tiers[2].dmg > outpost.tiers[1].dmg && outpost.tiers[2].hp > outpost.tiers[1].hp,
    `${level.name}: Lane Bastion must improve both firepower and durability`);
  assert.ok(outpost.tiers[3].repairRate > 0 && outpost.tiers[3].cost >= 150,
    `${level.name}: final Forward Camp is not a major self-maintaining gold sink`);
  const clearingNode = game.activeNodes().find((n) => n.kind === 'clearing');
  if (clearingNode && oreNode) {
    const cPlot = game.plots.find((p) => p.kind === 'outpost' && p.nodeId === clearingNode.id);
    const oPlot = game.plots.find((p) => p.kind === 'outpost' && p.nodeId === oreNode.id);
    if (cPlot && oPlot) {
      assert.ok(game.tierDef(cPlot, 1).count > game.tierDef(oPlot, 1).count,
        `${level.name}: a Forward Camp on a clearing does not muster more`);
    }
  }

  // A camp is a faucet: it musters on build, and again on its timer.
  const camp = game.plots.find((p) => p.kind === 'camp_ranger');
  game._construct(camp, false);
  const afterBuild = game.units.filter((u) => !u.hero).length;
  assert.ok(afterBuild > 0, `${level.name} camp mustered nobody when raised`);
  const def = game.tierDef(camp, camp.tier);
  for (let i = 0; i < def.every * 2 + 2; i++) game._updateCamps(0.5);
  assert.ok(
    game.units.filter((u) => !u.hero).length > afterBuild,
    `${level.name} camp never mustered a second squad`,
  );

  // A branch tier without a selected doctrine is not a valid construction.
  // Reject it before changing the plot or its existing building definition.
  const branchPlot = game.plots.find((p) => p.kind === 'tower');
  while (game.nextTier(branchPlot) && !game.nextTier(branchPlot).branch) game._construct(branchPlot, true);
  const branchBuilding = game.buildings.find((b) => b.plotId === branchPlot.id);
  const branchTierBefore = branchPlot.tier;
  const branchDefBefore = branchBuilding.def;
  game._construct(branchPlot, true);
  assert.equal(branchPlot.tier, branchTierBefore, `${level.name} invalid branch construction changed the tier`);
  assert.equal(branchBuilding.def, branchDefBefore, `${level.name} invalid branch construction poisoned the building`);

  // Hives keep producing on their own, forever.
  const before = game.zombies.length;
  for (let i = 0; i < 40; i++) game._updateHives(1);
  assert.ok(game.zombies.length > before, `${level.name} hives never mustered`);

  // Standing on a clear node takes it.
  const node = game.nodes[0];
  game.zombies = [];
  const hero = game.heroes[0];
  hero.x = node.x; hero.z = node.z;
  for (let i = 0; i < (SIEGE.captureTime + 1) * 4; i++) { game._nodeT = 0; game._updateNodes(0.25); }
  assert.equal(node.owner, 'player', `${level.name} node capture never completed`);
  assert.ok(game.stats.bestHeld >= 1, `${level.name} did not record held nodes`);
  assert.ok(!game.plotLocked(game.plots.find((p) => p.kind === 'outpost' && p.nodeId === node.id)),
    `${level.name} kept the Forward Camp locked on a node the player holds`);

  // Supply must grow with territory, or the player's power goes flat while
  // Threat keeps climbing and the run becomes unwinnable with a full purse.
  const baseCap = game.unitCap();
  for (const n of game.activeNodes().slice(0, 3)) n.owner = 'player';
  assert.ok(game.unitCap() > baseCap, `${level.name}: holding ground does not raise supply`);
  // Supply is a SHARE of the planet, so owning all of it is worth the same
  // army on a small map as on a large one. Counting nodes made big maps easier.
  for (const n of game.activeNodes()) n.owner = 'player';
  assert.equal(game.unitCap(), Math.min(SUPPLY.max, SUPPLY.base + SUPPLY.perPlanet),
    `${level.name}: a fully held planet does not give the standard supply ceiling`);
  for (const n of game.activeNodes()) n.owner = 'neutral';

  // Major progression lives on physical plots instead of a hidden menu.
  const forge = game.plots.find((p) => p.kind === 'hero_forge');
  const workshop = game.plots.find((p) => p.kind === 'workshop');
  assert.ok(forge && workshop, `${level.name} generated no Hero Forge or Auto-Workshop`);
  const baseHeroDamage = game.heroDmg(hero);
  game._construct(forge, true);
  assert.ok(game.heroDmg(hero) > baseHeroDamage, `${level.name} Hero Forge did not upgrade hero damage`);
  game._construct(workshop, true);
  const support = game.buildings.find((o) => o.plotId === workshop.id);
  const repairTarget = game.buildings
    .filter((o) => o !== support)
    .sort((a, b) => ((a.cx - support.cx) ** 2 + (a.cz - support.cz) ** 2)
      - ((b.cx - support.cx) ** 2 + (b.cz - support.cz) ** 2))[0];
  assert.ok(repairTarget, `${level.name} workshop has no structure to support`);
  repairTarget.hp = repairTarget.maxHp * 0.5;
  const beforeAutoRepair = repairTarget.hp;
  game._updateSupport(0.5);
  assert.ok(repairTarget.hp > beforeAutoRepair, `${level.name} workshop did not automatically repair nearby damage`);

  // Damage no longer heals itself — repairing is a real gold sink. Upgrading
  // still restores health, so repair is only offered once a plot is maxed.
  const house = game.plots.find((p) => p.kind === 'house');
  while (game.nextTier(house)) game._construct(house, true);
  const b = game.buildings.find((o) => o.plotId === house.id);
  b.hp = b.maxHp * 0.5;
  const act = game.plotAction(house);
  assert.equal(act.mode, 'repair', `${level.name} damaged structure did not offer a repair`);
  assert.ok(act.cost > 0, `${level.name} repair was free`);
  game.gold = 500;
  const goldBefore = game.gold;
  hero.x = house.cx; hero.z = house.cz;
  hero.payHold = true;
  for (let i = 0; i < 60; i++) game._updatePlots(1 / 30);
  assert.ok(game.gold < goldBefore, `${level.name} repair did not spend gold`);
  assert.ok(b.hp > b.maxHp * 0.5, `${level.name} repair did not restore health`);

  // Incomplete construction is temporary. Walking away or running out of
  // coins returns the whole partial payment instead of trapping it in a plot.
  const refundPlot = game.plots.find((p) => p.tier === 0 && !game.plotLocked(p));
  assert.ok(refundPlot, `${level.name} has no plot for refund validation`);
  hero.x = refundPlot.cx; hero.z = refundPlot.cz;
  game.gold = 2;
  hero.payHold = true;
  game.events.length = 0;
  game._updatePlots(1);
  assert.equal(game.gold, 2, `${level.name} did not return an unaffordable partial payment`);
  assert.equal(refundPlot.paid, 0, `${level.name} left refunded coins trapped in the plot`);
  assert.equal(hero.payHold, false, `${level.name} kept auto-paying after an insufficient-funds refund`);
  assert.ok(game.events.some((e) => e.type === 'refundcoin'), `${level.name} emitted no refund animation event`);

  game.gold = 100;
  hero.x = refundPlot.cx; hero.z = refundPlot.cz;
  hero.payHold = true;
  game._updatePlots(0.1);
  assert.ok(refundPlot.paid > 0, `${level.name} did not stream a partial payment before walk-away`);
  const beforeWalkRefund = game.gold + refundPlot.paid;
  hero.x = 0; hero.z = 0;
  game._updatePlots(0.1);
  assert.equal(refundPlot.paid, 0, `${level.name} kept partial payment after the hero walked away`);
  assert.equal(game.gold, beforeWalkRefund, `${level.name} walk-away refund lost coins`);

  // Every ordinary enemy drops one coin; no random empty kills.
  const coinCount = game.coins.length;
  const enemy = game._spawnZombie('walker', hero.x + 8, hero.z, true, true);
  assert.ok(enemy, `${level.name} could not spawn the coin-drop test enemy`);
  game.damageZombie(enemy, enemy.hp + 1, hero.x, hero.z);
  assert.equal(game.coins.length, coinCount + 1, `${level.name} ordinary enemy did not drop a coin`);
  assert.equal(game.coins.at(-1).v, 1, `${level.name} ordinary enemy coin value changed`);

  // A destroyed structure leaves a ruin that must be bought back.
  const b2 = game.buildings.find((o) => o.plotId === house.id);
  game._destroyBuilding(b2, true);
  assert.ok(house.ruined, `${level.name} destroyed building left no ruin`);
  const rebuild = game.plotAction(house);
  assert.equal(rebuild.mode, 'rebuild', `${level.name} ruin did not offer a rebuild`);
  assert.ok(rebuild.cost < game.tierDef(house, house.tier).cost, `${level.name} rebuild was not discounted`);
}

assert.equal(START_GOLD, LEVELS[0].economy.startGold, 'fallback start gold must match level 1');
for (const [name, cost, incomeGain] of paybacks) {
  const seconds = (cost / incomeGain) * SIEGE.incomePeriod;
  assert.ok(seconds <= MAX_PAYBACK_SECONDS, `${name} payback is too slow (${Math.round(seconds)}s)`);
}

// Threat has to climb fast enough to matter and slow enough to build against.
{
  const perNestSeconds = 1 / (THREAT.perSecond + THREAT.perNest * 3);
  assert.ok(perNestSeconds > 55 && perNestSeconds < 110,
    `a Threat level with 3 hives standing should take 55-110s, got ${Math.round(perNestSeconds)}s`);
  // Razing hives has to visibly slow the clock, or there is no reward for it.
  const cleanSeconds = 1 / THREAT.perSecond;
  assert.ok(cleanSeconds > perNestSeconds * 1.5,
    'razing every hive must meaningfully slow the Threat clock');
  // Conquest should cost some Threat, but never dominate it.
  assert.ok(THREAT.perCapture > 0 && THREAT.perCapture <= 0.15,
    'node capture Threat bump must stay a nudge, not the main clock');
  assert.ok(hiveInterval(0) > hiveInterval(THREAT.max), 'hives must muster faster as Threat climbs');
  assert.ok(hiveInterval(THREAT.max) >= 8, 'hive muster interval must not collapse to a spam loop');
  let previous = 0;
  for (let threat = 0; threat <= THREAT.max; threat++) {
    const squad = hiveSquad(threat, 1);
    assert.ok(squad.size >= previous, `hive squad shrank at Threat ${threat}`);
    previous = squad.size;
    const total = Object.values(squad.types).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-6, `hive squad mix at Threat ${threat} does not sum to 1`);
    for (const [type, share] of Object.entries(squad.types)) {
      assert.ok(share >= 0, `hive squad share for ${type} went negative at Threat ${threat}`);
    }
  }
}

// Every hero — however many there are — must sit in the same rough power band
// and have a well-formed kit. This is a sanity check, not a min-max target:
// it exists so a future roster addition gets caught here instead of in play.
for (const [key, hero] of Object.entries(HEROES)) {
  assert.ok(hero.hp >= 250 && hero.hp <= 700, `${key} hp ${hero.hp} is out of the hero power band`);
  assert.ok(hero.dmg >= 18 && hero.dmg <= 70, `${key} dmg ${hero.dmg} is out of the hero power band`);
  assert.ok(hero.range >= 1.2 && hero.range <= 14, `${key} range ${hero.range} is out of the hero power band`);
  assert.ok(hero.speed > 0 && hero.regen >= 0, `${key} has a non-positive speed or negative regen`);
  assert.ok(hero.ability.cd >= 10 && hero.ability.cd <= 14, `${key} ult cooldown ${hero.ability.cd}s is out of band`);
  // Any rank-scaled array on the ability (dmg, dur, radius-per-rank, etc.)
  // must have exactly 3 entries — one per ult rank.
  for (const [field, val] of Object.entries(hero.ability)) {
    if (Array.isArray(val)) assert.equal(val.length, 3, `${key} ability.${field} must have 3 rank entries`);
  }
  assert.ok(hero.aura && hero.aura.icon && hero.aura.name, `${key} aura is missing an icon/name`);
  assert.equal((hero.passives || []).length, 2, `${key} must have exactly 2 passives`);
  for (const proc of hero.passives.map((p) => p.proc).filter(Boolean)) {
    assert.equal(proc.every.length, 3, `${key} passive proc.every must have 3 rank entries`);
    assert.equal(proc.amount.length, 3, `${key} passive proc.amount must have 3 rank entries`);
  }
}

// Camps are faucets: every camp tier must state a squad size AND a cadence.
for (const [key, kind] of Object.entries(PLOT_KINDS)) {
  if (!kind.unit) continue;
  assert.ok(UNITS[kind.unit], `${key} fields an unknown unit`);
  for (const tier of kind.tiers) {
    assert.ok(tier.count > 0, `${key} tier ${tier.name} musters nobody`);
    assert.ok(tier.every >= 10 && tier.every <= 40, `${key} tier ${tier.name} has an out-of-bounds muster cadence`);
  }
}

// The campaign has to get harder in order. Nest health is the main lever, and
// it must rise faster than the extra ground a bigger map hands the player.
{
  const nestHp = (lv) => NEST_HP_BASE * (1 - NEST_HP_LEVEL_SHARE + NEST_HP_LEVEL_SHARE * lv.mult);
  for (let i = 1; i < LEVELS.length; i++) {
    assert.ok(nestHp(LEVELS[i]) > nestHp(LEVELS[i - 1]) * 1.05,
      `${LEVELS[i].name} hives are not meaningfully tougher than ${LEVELS[i - 1].name}`);
  }
  // Total health to chew through must also climb, counting the nest count.
  let prev = 0;
  for (const lv of LEVELS) {
    const total = nestHp(lv) * lv.nests;
    assert.ok(total > prev, `${lv.name} has less total hive health than the level before it`);
    prev = total;
  }
}

let lastStart = 0;
for (const level of LEVELS) {
  const economy = { startGold: START_GOLD, income: 1, pressure: 1, ...(level.economy || {}) };
  assert.ok(economy.startGold >= openingCost, `${level.name} cannot afford a tower/ranger/economy opening`);
  assert.ok(economy.startGold >= lastStart, `${level.name} start gold regresses`);
  assert.ok(economy.income >= 1 && economy.income <= 1.25, `${level.name} income multiplier is out of bounds`);
  assert.ok(economy.pressure >= 0.85 && economy.pressure <= 1.15, `${level.name} pressure multiplier is out of bounds`);
  lastStart = economy.startGold;

  const map = fakeMap(level);
  const plots = generatePlots(map, map.sites[0]);
  assert.ok(plots.length >= 40, `${level.name} generated too few city plots`);
  assertUpgradeReachFromAllSides(level);
  assertCampRoadAccess(level);
  assertSiegeLoop(level);
}
