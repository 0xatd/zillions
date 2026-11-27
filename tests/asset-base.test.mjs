import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isGlbBytes } from '../src/marine-hero-art.js';
import {
  DEFAULT_ASSET_BASE_URL,
  GLB_CACHE_CONTROL,
  GLB_CONTENT_TYPE,
  R2_BUCKET,
  currentAssetBase,
  fetchGlbBytes,
  glbCandidateUrls,
  loadGlb,
  resetAssetBaseState,
  resolveAssetBase,
} from '../src/asset-base.js';
import { assetObjectKey, isUploadableGlb, wranglerPutArgs } from '../scripts/upload-assets-r2.mjs';

const REL = 'assets/art-marines/hero_sniper.glb';
const REMOTE = `${DEFAULT_ASSET_BASE_URL}/${REL}`;
const GLB_HEADER = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);
const POINTER = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n';

function responseFor(body, { ok = true, status = 200 } = {}) {
  const view = typeof body === 'string' ? new TextEncoder().encode(body) : Uint8Array.from(body);
  const copy = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  return { ok, status, arrayBuffer: async () => copy };
}

test('the default asset base is the public R2 URL and keeps repo-relative paths', () => {
  assert.equal(DEFAULT_ASSET_BASE_URL, 'https://pub-cf11595eb9c04887b6187ec78f8dcbd5.r2.dev');
  assert.equal(resolveAssetBase(), DEFAULT_ASSET_BASE_URL);
  assert.deepEqual(glbCandidateUrls(REL), [REMOTE, REL]);
  assert.deepEqual(glbCandidateUrls(REL, 'https://assets.taborlin.co/'), [
    'https://assets.taborlin.co/assets/art-marines/hero_sniper.glb',
    REL,
  ]);
  assert.deepEqual(glbCandidateUrls(REL, ''), [REL]);
});

test('query, window, meta and env overrides resolve in that order', () => {
  assert.equal(resolveAssetBase({
    search: '?assetBase=https://assets.taborlin.co/',
    globalBase: 'https://window.example',
    metaBase: 'https://meta.example',
    envBase: 'https://env.example',
  }), 'https://assets.taborlin.co');
  assert.equal(resolveAssetBase({
    search: '',
    globalBase: 'https://window.example/',
    metaBase: 'https://meta.example',
    envBase: 'https://env.example',
  }), 'https://window.example');
  assert.equal(resolveAssetBase({
    search: '',
    metaBase: 'http://127.0.0.1:8787',
    envBase: 'https://env.example',
  }), 'http://127.0.0.1:8787');
  assert.equal(resolveAssetBase({
    search: '',
    envBase: 'https://cdn.example/zillions/',
  }), 'https://cdn.example/zillions');
  assert.equal(resolveAssetBase({ search: '?assetBase=' }), '');
  assert.equal(resolveAssetBase({ search: '?assetBase=javascript:alert(1)' }), DEFAULT_ASSET_BASE_URL);
  assert.deepEqual(glbCandidateUrls(REL, resolveAssetBase({ search: '?assetBase=' })), [REL]);
});

test('currentAssetBase uses the R2 default when no override is set', () => {
  const previousGlobal = globalThis.ZILLIONS_ASSET_BASE;
  const previousEnv = process.env.ZILLIONS_ASSET_BASE;
  delete globalThis.ZILLIONS_ASSET_BASE;
  delete process.env.ZILLIONS_ASSET_BASE;
  try {
    assert.equal(currentAssetBase(), DEFAULT_ASSET_BASE_URL);
  } finally {
    if (previousGlobal === undefined) delete globalThis.ZILLIONS_ASSET_BASE;
    else globalThis.ZILLIONS_ASSET_BASE = previousGlobal;
    if (previousEnv === undefined) delete process.env.ZILLIONS_ASSET_BASE;
    else process.env.ZILLIONS_ASSET_BASE = previousEnv;
  }
});

test('a remote non-GLB or HTTP failure falls back to the same-origin path', async () => {
  resetAssetBaseState();
  const cases = [
    async (url) => (String(url).startsWith('https://') ? responseFor(POINTER) : responseFor(GLB_HEADER)),
    async (url) => (String(url).startsWith('https://') ? responseFor('', { ok: false, status: 404 }) : responseFor(GLB_HEADER)),
    async (url) => {
      if (String(url).startsWith('https://')) throw new TypeError('network down');
      return responseFor(GLB_HEADER);
    },
  ];
  for (const fetchImpl of cases) {
    resetAssetBaseState();
    const seen = [];
    const parsed = [];
    const loader = {
      async parseAsync(bytes, resourcePath) {
        parsed.push(resourcePath);
        assert.equal(isGlbBytes(bytes), true);
        return { scene: { ok: true } };
      },
    };
    const gltf = await loadGlb(loader, REL, {
      fetchImpl: async (url) => {
        seen.push(url);
        return fetchImpl(url);
      },
      base: DEFAULT_ASSET_BASE_URL,
      timeoutMs: 0,
    });
    assert.equal(gltf.scene.ok, true);
    assert.deepEqual(seen, [REMOTE, REL]);
    assert.deepEqual(parsed, ['assets/art-marines/']);
  }
});

test('a valid remote GLB is used and the local path is not fetched', async () => {
  resetAssetBaseState();
  const seen = [];
  const result = await fetchGlbBytes(REL, {
    fetchImpl: async (url) => {
      seen.push(url);
      return responseFor(GLB_HEADER);
    },
    base: DEFAULT_ASSET_BASE_URL,
    timeoutMs: 0,
  });
  assert.equal(result.url, REMOTE);
  assert.equal(isGlbBytes(result.bytes), true);
  assert.deepEqual(seen, [REMOTE]);
});

test('when remote and local both fail, the error is thrown and nothing is parsed', async () => {
  resetAssetBaseState();
  let parsed = 0;
  const loader = {
    async parseAsync() {
      parsed += 1;
      return { scene: {} };
    },
  };
  await assert.rejects(
    () => loadGlb(loader, REL, {
      fetchImpl: async (url) => {
        if (String(url).startsWith('https://')) return responseFor(POINTER);
        return responseFor('', { ok: false, status: 404 });
      },
      base: DEFAULT_ASSET_BASE_URL,
      timeoutMs: 0,
    }),
    /is not a GLB|HTTP 404/,
  );
  assert.equal(parsed, 0);
});

test('a network failure on the default host skips later remote fetches', async () => {
  resetAssetBaseState();
  const previousGlobal = globalThis.ZILLIONS_ASSET_BASE;
  const previousEnv = process.env.ZILLIONS_ASSET_BASE;
  delete globalThis.ZILLIONS_ASSET_BASE;
  delete process.env.ZILLIONS_ASSET_BASE;
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    if (String(url).startsWith('https://')) throw new TypeError('failed to fetch');
    return responseFor(GLB_HEADER);
  };
  try {
    await fetchGlbBytes('assets/a.glb', { fetchImpl, timeoutMs: 0 });
    await fetchGlbBytes('assets/b.glb', { fetchImpl, timeoutMs: 0 });
    assert.deepEqual(seen, [
      `${DEFAULT_ASSET_BASE_URL}/assets/a.glb`,
      'assets/a.glb',
      'assets/b.glb',
    ]);
  } finally {
    resetAssetBaseState();
    if (previousGlobal === undefined) delete globalThis.ZILLIONS_ASSET_BASE;
    else globalThis.ZILLIONS_ASSET_BASE = previousGlobal;
    if (previousEnv === undefined) delete process.env.ZILLIONS_ASSET_BASE;
    else process.env.ZILLIONS_ASSET_BASE = previousEnv;
  }
});

test('runtime GLB loaders share the asset base, and the uploader only puts objects', async () => {
  const assets = await readFile(new URL('../src/assets.js', import.meta.url), 'utf8');
  const marine = await readFile(new URL('../src/marine-assembler.js', import.meta.url), 'utf8');
  const review = await readFile(new URL('../art-slice-page.js', import.meta.url), 'utf8');
  const script = await readFile(new URL('../scripts/upload-assets-r2.mjs', import.meta.url), 'utf8');
  for (const src of [assets, marine, review]) {
    assert.match(src, /loadGlb\(/);
    assert.doesNotMatch(src, /loader\.loadAsync\(/);
  }
  assert.match(assets, /marineHeroLoadUrls/);
  assert.equal(GLB_CACHE_CONTROL, 'public, max-age=31536000');
  assert.equal(GLB_CONTENT_TYPE, 'model/gltf-binary');
  assert.equal(R2_BUCKET, 'zillions-assets');
  assert.match(script, /GLB_CACHE_CONTROL/);
  assert.doesNotMatch(script, /r2['",\s]+object['",\s]+delete|bucket delete/i);
  const put = wranglerPutArgs('assets/art-marines/hero_sniper.glb', 'assets/art-marines/hero_sniper.glb');
  assert.deepEqual(put, [
    'r2', 'object', 'put', 'zillions-assets/assets/art-marines/hero_sniper.glb',
    '--file=assets/art-marines/hero_sniper.glb',
    '--content-type=model/gltf-binary',
    '--cache-control=public, max-age=31536000',
    '--remote',
  ]);
  assert.equal(assetObjectKey('/repo', '/repo/assets/kit/european/castle_t1.glb'), 'assets/kit/european/castle_t1.glb');
  assert.equal(assetObjectKey('/repo', '/repo/secrets.env'), null);
  assert.equal(isUploadableGlb(GLB_HEADER), true);
  assert.equal(isUploadableGlb(new TextEncoder().encode(POINTER)), false);
  const mismatched = new Uint8Array(GLB_HEADER);
  mismatched[8] = 99;
  assert.equal(isUploadableGlb(mismatched), false);
});
