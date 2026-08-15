import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const packageJson = JSON.parse(read('package.json'));
assert.ok(packageJson.scripts?.check?.includes('repo-check.mjs'), 'npm run check must include repo-check.mjs');
