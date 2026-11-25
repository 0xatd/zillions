import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pickMarine, hashSeed, makeMarineRng, MARINE_PARTS, CHAPTERS, ROLES } from '../src/marine-recipe.js';

test('same seed and options give the same marine', () => {
  for (const seed of [0, 1, 42, 123456789, 0xffffffff]) {
    for (const role of Object.keys(ROLES)) {
      const a = pickMarine(seed, { chapter: 'crimson', role });
      const b = pickMarine(seed, { chapter: 'crimson', role });
      assert.deepEqual(a, b);
    }
  }
  assert.deepEqual(pickMarine('unit-7', { chapter: 'verdant' }), pickMarine('unit-7', { chapter: 'verdant' }));
});

test('seed sequence is pinned (multiplayer compatibility)', () => {
  const rng = makeMarineRng(1);
  const seq = [rng.next(), rng.next(), rng.next()].map((v) => v.toFixed(8));
  assert.deepEqual(seq, ['0.62707394', '0.00273572', '0.52744704']);
  assert.equal(hashSeed(999, 1001, 'soldier'), hashSeed(999, 1001, 'soldier'));
  assert.notEqual(hashSeed(999, 1001, 'soldier'), hashSeed(999, 1002, 'soldier'));
});

test('recipes only use kit parts and produce variety', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const r = pickMarine(hashSeed('v', i), { chapter: Object.keys(CHAPTERS)[i % 7], role: Object.keys(ROLES)[i % 6] });
    for (const cat of ['body', 'weapon', 'backpack', 'pauldron', 'emblem', 'head', 'hair', 'beard', 'face']) {
      assert.ok(MARINE_PARTS[cat].includes(r[cat]), `${cat}=${r[cat]}`);
    }
    if (r.helmet) assert.ok(MARINE_PARTS.helmet.includes(r.helmet));
    assert.ok(r.height >= 0.96 && r.height <= 1.04);
    assert.ok(r.width >= 0.95 && r.width <= 1.05);
    seen.add(JSON.stringify([r.helmet, r.head, r.hair, r.beard, r.face, r.colors.skin, r.colors.hair]));
  }
  assert.ok(seen.size > 250, `only ${seen.size} distinct marines in 400`);
});

test('kit manifest (when built) covers every recipe part', () => {
  const file = path.join(import.meta.dirname, '..', 'assets', 'art-marines', 'kit', 'marine_kit.json');
  if (!fs.existsSync(file)) return;
  const kit = JSON.parse(fs.readFileSync(file, 'utf8'));
  const optional = { hair: 'bald', beard: 'none', face: 'plain' };
  for (const [cat, list] of Object.entries(MARINE_PARTS)) {
    for (const v of list) {
      if (optional[cat] === v) continue;
      assert.ok(kit.parts[cat]?.includes(v), `kit missing ${cat}/${v}`);
    }
  }
  for (const [name, tris] of Object.entries(kit.triangles)) {
    if (name.startsWith('kit_body_')) assert.ok(tris < 4000, `${name} ${tris}`);
  }
});

test('marine flags default on and opt out with 0', async () => {
  const { marineFlag } = await import('../src/marine-recipe.js');
  assert.equal(marineFlag('marines'), true);
  assert.equal(marineFlag('marines', false), false);
});

test('low-poly LOD kit (when built) mirrors the full kit within budget', () => {
  const dir = path.join(import.meta.dirname, '..', 'assets', 'art-marines', 'kit');
  const loFile = path.join(dir, 'marine_kit_lo.json');
  if (!fs.existsSync(loFile)) return;
  const hi = JSON.parse(fs.readFileSync(path.join(dir, 'marine_kit.json'), 'utf8'));
  const lo = JSON.parse(fs.readFileSync(loFile, 'utf8'));
  assert.deepEqual(Object.keys(lo.triangles).sort(), Object.keys(hi.triangles).sort());
  const t = lo.triangles;
  const typical = t.kit_body_standard + 2 * t.kit_pauldron_dome + t.kit_helmet_visor + t.kit_backpack_reactor + t.kit_weapon_rifle;
  assert.ok(typical <= 1500, `typical LOD marine ${typical} tris`);
  for (const [k, v] of Object.entries(t)) assert.ok(v <= hi.triangles[k], `${k} lo ${v} > hi ${hi.triangles[k]}`);
});
