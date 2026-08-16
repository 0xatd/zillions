import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEROES, HERO_UPGRADE_KEYS, HERO_UPGRADE_MAX } from '../src/config.js';

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
for (const [key, hero] of Object.entries(HEROES)) {
  assert.equal((hero.passives || []).length, 2, `${key} must keep exactly two passive upgrade paths`);
  assert.ok(hero.aura, `${key} must keep an aura upgrade path`);
  assert.ok(hero.ability, `${key} must keep an ult damage upgrade path`);
}

const oldAutoRankCopy = /special ranks up automatically|levels 4 and 7/i;
for (const rel of ['README.md', 'src/ui.js', 'src/online.js', 'docs/agent-brief.md', 'docs/product-contract.md']) {
  assert.ok(!oldAutoRankCopy.test(read(rel)), `${rel} still describes hidden automatic hero ranks`);
}
