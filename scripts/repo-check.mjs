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
  'llms.txt',
  'docs/agent-brief.md',
  'docs/architecture.md',
  'docs/backend.md',
  'docs/product-contract.md',
  'docs/review-guide.md',
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
assert.ok(readme.includes('https://github.com/0xatd/zillions'), 'README must link the GitHub repo');
assert.ok(readme.includes('https://zillions.taborlin.co'), 'README must link production');
assert.ok(readme.includes('can reach level 100'), 'README must document the live hero level cap');
assert.ok(read('docs/architecture.md').includes('consecutive-window buffer'), 'architecture must document consecutive multiplayer buffering');
assert.ok(read('docs/product-contract.md').includes('Watch'), 'product contract must document Watch mode');
assert.ok(!/Heroes earn XP[^\n]*level 1[–-]10/i.test(readme), 'README must not describe level 10 as the hero cap');

for (const rel of ['AGENTS.md', 'README.md', 'docs/agent-brief.md', 'docs/product-contract.md']) {
  const text = read(rel);
  assert.ok(!/planet(?:\/| and )galaxy layers[^\n]*not implemented/i.test(text), `${rel} must not describe the shipped procedural galaxy as unimplemented`);
}

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

const canonicalHeroes = {
  scott: { name: 'Scott English', color: 0xb32020, trim: 0xf4f1e8 },
  alexander: { name: 'Alexander Thomas', color: 0x2f8f46, trim: 0xf3c53d },
  danny: { name: 'Danny Donovan', color: 0x2468c9, trim: 0x111318 },
  turtle: { name: 'Turtle Voss', color: 0x3f6b5e, trim: 0xb8ae86 },
  john: { name: 'John Marlowe', color: 0x3a3a3f, trim: 0xf0ece0 },
  tiger: { name: 'Tiger Reyes', color: 0xd8721f, trim: 0x1c1a18 },
  aaron: { name: 'Aaron Whitlock', color: 0x6a4fae, trim: 0xf0d060 },
};
assert.deepEqual(Object.keys(HEROES), Object.keys(canonicalHeroes), 'canonical hero roster or order changed');
for (const [key, expected] of Object.entries(canonicalHeroes)) {
  assert.equal(HEROES[key]?.name, expected.name, `${key} canonical hero name changed`);
  assert.equal(HEROES[key]?.color, expected.color, `${key} hero model armor color changed`);
  assert.equal(HEROES[key]?.trim, expected.trim, `${key} hero model trim color changed`);
  assert.ok(readme.includes(expected.name), `${expected.name} is missing from the README roster`);
}
assert.ok(read('docs/agent-brief.md').includes('The canonical hero roster is Scott English'),
  'agent brief must identify the canonical roster');
assert.ok(read('docs/hero-audio-pack.md').includes('This pack covers Scott English, Alexander Thomas, and Danny Donovan only.'),
  'hero audio guide must state its actual three-hero coverage');

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

const uiSource = read('src/ui.js');
assert.match(uiSource, /id="m-online"[\s\S]*PLAY ONLINE/, 'the home screen must lead with online play');
assert.match(uiSource, /id="m-solo"[\s\S]*PLAY SOLO/, 'the home screen must group solo modes');
assert.match(uiSource, /id="screen-solo"/, 'solo play must have its own mode screen');
assert.match(uiSource, /id="solo-campaign-resume"/, 'campaign resumes must stay inside Story Campaign');
assert.match(uiSource, /id="solo-survival-resume"/, 'survival resumes must stay inside Survival');
assert.doesNotMatch(uiSource, /id="m-continuerow"/, 'Continue must not return as a generic home-screen action');
assert.doesNotMatch(uiSource, /id="m-play"/, 'Campaign must not return as the primary home-screen action');

const architecture = read('docs/architecture.md');
for (const rel of [
  'src/config.js',
  'src/game.js',
  'src/main.js',
  'src/map.js',
  'src/net.js',
  'src/online.js',
  'src/plots.js',
  'src/supabase.js',
  'src/terrain.js',
  'src/ui.js',
  'supabase/schema.sql',
]) {
  assert.ok(architecture.includes(`\`${rel}\``), `architecture must document ${rel}`);
}

const llms = read('llms.txt');
assert.ok(llms.includes('docs/architecture.md'), 'llms.txt must link the architecture guide');
assert.ok(llms.includes('docs/review-guide.md'), 'llms.txt must link the review guide');
assert.ok(llms.includes('Keep simulation deterministic'), 'llms.txt must state the determinism rule');

const vision = read('docs/design-vision.md');
assert.ok(vision.includes('This document describes possible future systems'), 'design vision must identify itself as future intent');
assert.ok(!vision.includes('The bell makes stalling'), 'design vision must not present removed bell code as current');
assert.ok(!vision.includes('levels 1 and 5 complete'), 'design vision must not keep obsolete simulated completion claims');
