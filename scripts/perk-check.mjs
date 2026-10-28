// Campaign perks: the offer, the legal chain, the simulation, the snapshot,
// and the replay. A perk that does not survive a restore or a replay is a
// desync waiting to happen.
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { SIM_DT, START_GOLD, levelById } from '../src/config.js';
import { TerrainField } from '../src/terrain.js';
import { stateHash } from '../src/lockstep-hash.js';
import { buildMatchReport } from '../src/match-report.js';
import { counterCeilings, validateMatchReport } from '../src/match-rewards.js';
import { verifyReplay } from '../src/match-replay.js';
import { matchReplayPayload } from '../src/match-session.js';
import {
  PERK_CATEGORIES, PERK_LIST, legalPerkList, normalizePerks, perkBoundScale, perkOffer, resolvePerkMods,
} from '../src/perks.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

ok(PERK_LIST.length >= 12, `expected a real perk pool, got ${PERK_LIST.length}`);
eq([...new Set(PERK_LIST.map((perk) => perk.category))].sort(), [...PERK_CATEGORIES].sort(), 'economy, defense, hero and culture perks');
ok(PERK_LIST.every((perk) => perk.name && perk.icon && perk.desc && typeof perk.apply === 'function'), 'every perk has a name, icon, line and effect');

const first = perkOffer([]);
eq(first.length, 3, 'a fresh campaign offers three perks');
eq(new Set(first.map((key) => PERK_LIST.find((perk) => perk.key === key).category)).size, 3, 'the first offer spreads across categories');
eq(perkOffer([]), first, 'the offer is stable');
eq(legalPerkList(null, 0), [], 'no perks is legal');
eq(legalPerkList([first[0]], 0), null, 'a perk before any clear is refused');
eq(legalPerkList([first[0]], 1), [first[0]], 'the offered perk is accepted after one clear');
eq(legalPerkList([first[1], first[0]], 2), null, 'a perk from a later offer cannot be taken first');
const second = perkOffer([first[0]]);
ok(!second.includes(first[0]), 'owned perks leave the pool');
eq(legalPerkList([first[0], second[0]], 2), [first[0], second[0]], 'a second pick has to come from the next offer');
eq(legalPerkList(['not_a_perk'], 4), null, 'unknown perks are refused');
eq(normalizePerks(['tithe', 'tithe', 'nope', 'war_chest']), ['tithe', 'war_chest'], 'normalize drops duplicates and unknown keys');

const chain = [];
for (let step = 0; step < PERK_LIST.length; step++) {
  const offer = perkOffer(chain);
  if (!offer.length) break;
  chain.push(offer[0]);
  eq(legalPerkList(chain, chain.length), chain, `chain of ${chain.length} stays legal`);
}
ok(chain.length >= 12, 'a full run can take the whole pool one offer at a time');
eq(perkOffer(chain), [], 'an empty pool offers nothing');

function boot(perks = [], culture = 'european') {
  const level = levelById(1);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  return new Game(map, 'normal', 'scott', null, 1, 'campaign', { rngSeed: 7, culture, perks });
}

const plain = boot();
const chest = boot(['war_chest']);
eq(chest.gold, plain.gold + 80, 'War Chest adds 80 starting gold');
eq(plain.gold, START_GOLD, 'a campaign without perks keeps the authored purse');
eq(boot(['war_chest'], 'european').mode, 'campaign');
{
  const level = levelById(9001);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const labyrinth = new Game(map, 'normal', 'scott', null, 9001, 'labyrinth', { perks: ['war_chest'] });
  eq(labyrinth.perks, [], 'labyrinth runs ignore campaign perks');
}

plain.foundCity(0, 0);
chest.foundCity(0, 0);
const house = (game) => game.plots.find((plot) => plot.kind === 'house');
const plainCost = plain.nextTier(house(plain)).cost;
const cheap = boot(['mason_rite']);
cheap.foundCity(0, 0);
ok(cheap.nextTier(house(cheap)).cost < plainCost, "Mason's Rite lowers the house price");
ok(cheap.nextTier(house(cheap)).cost >= Math.floor(plainCost * 0.85), 'the discount is the authored 15%');

const tithe = boot(['tithe']);
tithe.foundCity(0, 0);
plain._construct(house(plain), true);
tithe._construct(house(tithe), true);
plain._updateIncome(1);
tithe._updateIncome(1);
ok(Math.abs(tithe.incomeRate / plain.incomeRate - 1.2) < 1e-9, 'Field Tithe raises income by 20%');

const oath = boot(['rampart_oath']);
oath.foundCity(0, 0);
const tower = (game) => game.plots.find((plot) => plot.kind === 'tower');
plain._construct(tower(plain), true);
oath._construct(tower(oath), true);
const hp = (game) => game.buildings.find((building) => building.kind === 'tower').maxHp;
eq(hp(oath), Math.round(hp(plain) * 1.25), 'Rampart Oath raises structure health by 25%');

const eye = boot(['veterans_eye']);
ok(eye.heroDmg(eye.heroes[0]) > plain.heroDmg(plain.heroes[0]) * 1.14, "Veteran's Eye raises hero damage");
const wind = boot(['second_wind']);
eq(wind.heroes[0].mods.regen, (plain.heroes[0].mods.regen || 0) + 1.5, 'Second Wind adds regeneration');

const euro = boot(['star_oath'], 'european').unitDef('soldier');
const euroBase = plain.unitDef('soldier');
ok(euro.hp > euroBase.hp && euro.dmg > euroBase.dmg, 'Star Oath buffs the European line');
const asianBase = boot([], 'asian').unitDef('soldier');
const asianOath = boot(['star_oath'], 'asian').unitDef('soldier');
ok(asianOath.hp > asianBase.hp && asianOath.dmg === asianBase.dmg, 'Star Oath still helps another culture, less so');
const asianRanger = boot([], 'asian').unitDef('ranger');
ok(Math.abs(boot(['jade_volley'], 'asian').unitDef('ranger').rof / asianRanger.rof - 1.2) < 1e-6, 'Jade Volley speeds the Jade Lantern archers');
const mirage = boot([], 'middle_eastern').unitDef('sniper');
eq(boot(['mirage_sight'], 'middle_eastern').unitDef('sniper').range, mirage.range + 1.5, 'Mirage Sight extends the Mirage longgun');

const live = boot(['tithe', 'second_wind']);
live.foundCity(0, 0);
live._construct(house(live), true);
const snap = live.snapshot();
eq(snap.perks, ['tithe', 'second_wind'], 'the snapshot records the perk stack');
const level = levelById(1);
const restored = new Game(
  new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests }),
  'normal', 'scott', snap, 1, 'campaign',
);
eq(restored.perks, live.perks, 'a restored run keeps its perks');
eq(restored.gold, live.gold, 'restored gold is the saved purse, not a second War Chest');
eq(stateHash(restored), stateHash(live), 'a restored perk run hashes like the live one');
live.update(SIM_DT);
restored.update(SIM_DT);
eq(stateHash(restored), stateHash(live), 'perked peers still agree after a tick');

eq(stateHash(plain) === stateHash(boot(['second_wind'])), false, 'regen-only perk still changes the lockstep hash');

const scale = perkBoundScale(['tithe', 'war_chest', 'mason_rite', 'gate_guns']);
ok(scale.coins > 1 && scale.coinSlack === 80 && scale.built > 1 && scale.kills > 1, 'bounds move with the perks that raise counters');
const rich = counterCeilings({ durationSeconds: 900, perks: ['tithe'] });
const bare = counterCeilings({ durationSeconds: 900, perks: [] });
ok(rich.coins > bare.coins, 'Field Tithe widens the coin ceiling');
const over = bare.coins + 1;
eq(validateMatchReport({
  version: 1, mode: 'campaign', levelId: 1, difficulty: 'normal', won: false,
  durationSeconds: 900, threatLevel: 2, kills: 10, coins: over, nests: 0, nodes: 0, built: 1, lost: 0,
  bestHeld: 0, heroDeaths: 0, bossKillT: null, hqTier: 1, standingBuildings: 1, pack: [],
}, { campaignCleared: 1 }).detail, 'coins', 'the same coin total is refused without the perk');
const titheChain = [];
while (!titheChain.includes('tithe') && titheChain.length < PERK_LIST.length) {
  const offer = perkOffer(titheChain);
  titheChain.push(offer.includes('tithe') ? 'tithe' : offer[0]);
}
ok(titheChain.includes('tithe'), 'Field Tithe is reachable through the offer chain');
ok(validateMatchReport({
  version: 1, mode: 'campaign', levelId: 1, difficulty: 'normal', won: false,
  durationSeconds: 900, threatLevel: 2, kills: 10, coins: over, nests: 0, nodes: 0, built: 1, lost: 0,
  bestHeld: 0, heroDeaths: 0, bossKillT: null, hqTier: 1, standingBuildings: 1, pack: [], perks: titheChain,
}, { campaignCleared: titheChain.length }).ok, 'Field Tithe makes that coin total plausible');

eq(validateMatchReport({
  version: 1, mode: 'survival', levelId: 1, difficulty: 'normal', won: false,
  durationSeconds: 900, threatLevel: 2, kills: 10, coins: 10, nests: 0, nodes: 0, built: 1, lost: 0,
  bestHeld: 0, heroDeaths: 0, bossKillT: null, hqTier: 1, standingBuildings: 1, pack: [], perks: ['war_chest'],
}).error, 'invalid_perks', 'survival cannot carry campaign perks');

// A short recorded match with a legal perk replays to the same report.
{
  const perk = perkOffer([])[0];
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, 'normal', 'alexander', null, 1, 'campaign', { rngSeed: 4242, perks: [perk] });
  game.inputLog = [];
  game.exec({ t: 'found', s: 0, p: 0 });
  while (game.steps < 600 && !game.over) game.update(SIM_DT);
  const report = buildMatchReport(game);
  eq(report.perks, [perk], 'the report names the perk the match ran with');
  const replay = matchReplayPayload(game, { heroes: 'alexander' }, 0);
  const verdict = verifyReplay({
    match: { levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242 },
    report, replay,
  });
  eq(verdict.status, 'verified', `perked replay did not verify (${verdict.status} ${(verdict.mismatch || []).join(',')})`);
  const stripped = { ...replay, perks: [] };
  const missed = verifyReplay({
    match: { levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242 },
    report, replay: stripped,
  });
  eq(missed.status, 'mismatch', 'a replay that drops the perk stack does not verify');
  ok(missed.mismatch.includes('perks'), 'the mismatch names the perk stack');
}

eq(resolvePerkMods(['gate_guns']).towerDmg, 1.2, 'Gate Guns is a tower damage multiplier');
eq(resolvePerkMods(['firm_ground']).buildingTaken, 0.85, 'Firm Ground reduces structure damage');

console.log(`perk-check: ${checks} checks passed`);
