import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEROES, HERO_UPGRADE_KEYS, HERO_UPGRADE_MAX, PLOT_KINDS } from '../src/config.js';
import { FrameGuard, recoverableRestore } from '../src/runtime-guard.js';

const root = fileURLToPath(new URL('../', import.meta.url));

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function filesUnder(rel) {
  const base = join(root, rel);
  const out = [];
  for (const name of readdirSync(base)) {
    const full = join(base, name);
    const child = `${rel}/${name}`;
    if (statSync(full).isDirectory()) out.push(...filesUnder(child));
    else out.push(child);
  }
  return out;
}

for (const rel of [
  'AGENTS.md',
  'README.md',
  'docs/agent-brief.md',
  'docs/backend.md',
  'docs/product-contract.md',
  'supabase/schema.sql',
]) {
  assert.ok(read(rel).trim().length > 0, `${rel} must exist and be non-empty`);
}

const activeFiles = [
  'AGENTS.md',
  'README.md',
  ...filesUnder('api'),
  ...filesUnder('docs'),
  ...filesUnder('scripts'),
  ...filesUnder('src'),
  'supabase/schema.sql',
  'package.json',
];

const stalePrototypeRule = ['cla', 'ude-thronefall-campaign'].join('');
for (const rel of activeFiles) {
  const text = read(rel);
  assert.ok(!text.includes(stalePrototypeRule), `${rel} still uses the stale prototype rule id`);
}

for (const rel of [...filesUnder('api'), ...filesUnder('src'), 'supabase/schema.sql']) {
  const text = read(rel);
  assert.ok(!text.includes('qgvpfkncgpqtxxozatax'), `${rel} points at the Soshi Supabase project`);
}

const index = read('index.html');
assert.ok(!index.includes('assets.html'), 'index.html must not expose the review-only asset browser');
assert.ok(index.includes('three/addons/'), 'index.html must map vendored Three.js addons');

const tacticalVisuals = read('src/tactical-visuals.js');
assert.ok(tacticalVisuals.includes('class TacticalVisuals'), 'tactical visual pipeline must exist');
assert.ok(tacticalVisuals.includes("QUALITY_KEY = 'zillions_graphics_quality'"), 'graphics quality must persist locally');
assert.ok(tacticalVisuals.includes('new OutputPass()'), 'postprocessing must preserve tone mapping and output color space');
assert.ok(read('src/main.js').includes('this.tacticalVisuals.render()'), 'main renderer must use the tactical visual pipeline');

const readme = read('README.md');
assert.ok(readme.includes('GitHub repository: https://github.com/0xatd/zillions'), 'README must link the GitHub repo');
assert.ok(readme.includes('GitHub repo metadata should point to the production game'), 'README must document GitHub repo metadata expectations');

const packageJson = JSON.parse(read('package.json'));
assert.ok(packageJson.scripts?.check?.includes('repo-check.mjs'), 'npm run check must include repo-check.mjs');
assert.ok(packageJson.scripts?.check?.includes('sim-determinism-check.mjs'), 'npm run check must include the deterministic sim harness');
assert.ok(read('src/main.js').includes('s.snap.v === 5'), 'continue-save gate must accept current v5 snapshots');
assert.ok(read('scripts/sim-determinism-check.mjs').includes('workerArgs.push(ticksArg)'), 'determinism harness must forward --ticks to workers');

const contract = read('docs/product-contract.md');
assert.ok(contract.includes('Use continuous siege on a lane graph'), 'product contract must own the continuous-siege direction');
assert.ok(contract.includes('No day, no night, no bell'), 'product contract must keep day/night/bell removed from the shipped loop');
assert.ok(read('src/ui.js').includes('assets/heroes/portraits/'), 'runtime hero UI must use small portrait assets');

const schema = read('supabase/schema.sql');
assert.ok(schema.includes('public.lobby_chat'), 'schema must define Supabase-backed global lobby chat');
assert.ok(schema.includes('public.friendships'), 'schema must define real friend requests/friendships');
assert.ok(schema.includes("channel text not null default 'room'"), 'room_chat must separate room and in-game chat channels');
assert.ok(schema.includes('room_chat_read_member'), 'room chat must be member-scoped, not readable by every authenticated user');
const online = read('src/online.js');
assert.ok(!online.includes('sendLobbyChat'), 'signed-in lobby chat must not use the unauthenticated Blob lobby route');
assert.ok(online.includes("from('lobby_chat')"), 'online lobby must read/write Supabase lobby_chat');
assert.ok(online.includes("from('friendships')"), 'online lobby must read/write Supabase friendships');
const ui = read('src/ui.js');
assert.ok(ui.includes('id="gamechat"'), 'UI must expose in-game team chat');
assert.ok(ui.includes('id="l-friends"'), 'UI must expose friends list');
assert.ok(ui.includes('roomRoster'), 'setup room UI must render a real player roster');
assert.ok(ui.includes('START ROOM'), 'setup room UI must make the host launch action explicit');
assert.ok(online.includes('refreshCurrentGame'), 'online rooms must refresh current room/player state');
assert.ok(online.includes('updateRoomPlayer'), 'online rooms must persist hero/ready room player updates');

const heroPalettes = {
  alexander: { color: 0x2f8f46, trim: 0xf3c53d },
  danny: { color: 0x2468c9, trim: 0x111318 },
  scott: { color: 0xb32020, trim: 0xf4f1e8 },
};
for (const [key, expected] of Object.entries(heroPalettes)) {
  assert.equal(HEROES[key]?.color, expected.color, `${key} hero model armor color changed`);
  assert.equal(HEROES[key]?.trim, expected.trim, `${key} hero model trim color changed`);
}

assert.deepEqual(HERO_UPGRADE_KEYS, ['aura', 'passive1', 'passive2', 'ult'], 'hero upgrade branch order changed');
assert.equal(HERO_UPGRADE_MAX, 3, 'hero upgrade branches should stay capped at rank 3');
// The ladder runs long but the build stays tight: nine points against twelve
// ranks, and stat growth tapers after the campaign band.
{
  const cfg = await import('../src/config.js');
  assert.equal(cfg.HERO_MAX_LEVEL, 100, 'hero ladder should run to level 100');
  assert.equal(cfg.heroUpgradePoints(100), 9, 'upgrade points must stay capped — levels past the cap are stats, not ranks');
  const early = cfg.heroGrowthUnits(10) - cfg.heroGrowthUnits(9);
  const late = cfg.heroGrowthUnits(100) - cfg.heroGrowthUnits(99);
  assert.ok(late < early, 'late-level stat growth must taper below campaign-band growth');
}
for (const [key, hero] of Object.entries(HEROES)) {
  assert.equal((hero.passives || []).length, 2, `${key} must keep exactly two passive upgrade paths`);
  assert.ok(hero.aura, `${key} must keep an aura upgrade path`);
  assert.ok(hero.ability, `${key} must keep an ult damage upgrade path`);
}

const outpost = PLOT_KINDS.outpost;
assert.equal(outpost.onNode, true, 'Forward Camps must stay tied to captured lane nodes');
assert.ok(outpost.tiers.length >= 3, 'Forward Camps must upgrade into a lane-anchor tier');
assert.ok(outpost.tiers.at(-1).repairRate > 0, 'final Forward Camp must automate local repairs');
assert.ok(PLOT_KINDS.workshop?.tiers?.length >= 3, 'city must have a deep Auto-Workshop progression');
assert.ok(PLOT_KINDS.hero_forge?.tiers?.length >= 3, 'city must have a physical Hero Forge progression');
assert.ok(outpost.tiers[1].dmg > 0 && outpost.tiers[1].range <= 7, 'War Outpost must be short-range lane support');
assert.ok(outpost.tiers[2].dmg > outpost.tiers[1].dmg && outpost.tiers[2].splash > 0, 'Lane Bastion must add siege/splash support');

const oldAutoRankCopy = /special ranks up automatically|levels 4 and 7/i;
for (const rel of ['README.md', 'src/ui.js', 'src/online.js', 'docs/agent-brief.md', 'docs/product-contract.md']) {
  assert.ok(!oldAutoRankCopy.test(read(rel)), `${rel} still describes hidden automatic hero ranks`);
}

let frames = 0;
let reported = null;
const guard = new FrameGuard((error) => { reported = error; });
const frameFailure = new Error('render failure');
assert.equal(guard.run(() => { frames++; throw frameFailure; }), false);
assert.equal(reported, frameFailure, 'the frame error must be reported');
assert.equal(guard.run(() => { frames++; }), false);
assert.equal(frames, 1, 'later animation callbacks must not repeat the crashing frame');

let discarded = null;
const corruptSave = new Error('corrupt save');
assert.equal(await recoverableRestore(
  async () => { throw corruptSave; },
  async (error) => { discarded = error; },
), false, 'a failed restore must report failure');
assert.equal(discarded, corruptSave, 'a failed restore must run recovery with the original error');
assert.equal(await recoverableRestore(async () => {}, async () => assert.fail('valid restore recovered')), true);

const mainSource = read('src/main.js');
assert.match(mainSource, /setAnimationLoop\(\(\) => this\.frameGuard\.run/, 'Three.js must run through the frame guard');
assert.match(mainSource, /await recoverableRestore\(/, 'Continue must await recoverable save restoration');
assert.match(mainSource, /localStorage\.removeItem\('zillions_save'\)/, 'corrupt local saves must be removed');
assert.match(mainSource, /this\.ui\.setContinue\(null\)/, 'corrupt saves must be removed from the menu');
