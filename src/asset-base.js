// Where runtime GLB files are loaded from. Presentation only: a missed or
// non-GLB response falls back to the same relative path on this origin.
// Callers then keep the procedural mesh or the existing hero model.
//
// The public R2 bucket is the default. assets.taborlin.co is the planned
// custom domain and is not attached yet. Switch the constant, or set one
// override, when that domain is ready. There is no JS bundler, so a Vercel
// env var is not visible in the browser unless something copies it into the
// meta tag or window.ZILLIONS_ASSET_BASE before the modules run.

import { isGlbBytes } from './marine-hero-art.js';

export const R2_BUCKET = 'zillions-assets';
export const DEFAULT_ASSET_BASE_URL = 'https://pub-cf11595eb9c04887b6187ec78f8dcbd5.r2.dev';
export const GLB_CONTENT_TYPE = 'model/gltf-binary';
export const GLB_CACHE_CONTROL = 'public, max-age=31536000';
// Bump this in the same deploy that replaces bytes already stored under a
// stable R2 key. Remote URLs include ?v=, so a one-year browser cache of the
// previous URL is left unused. Object keys stay the repo paths.
export const GLB_ASSET_VERSION = '1';

// A hero GLB is about 10 MB. Allow the public host to finish before the
// same-origin file is tried. A connection failure skips the host for the
// rest of the page load. A timeout applies to that one file only.
const REMOTE_TIMEOUT_MS = 20000;

let remoteDown = false;
let remoteDownWarned = false;

export function resetAssetBaseState() {
  remoteDown = false;
  remoteDownWarned = false;
}

// http(s) origin plus any path prefix, with no trailing slash. Empty or
// unsafe values return '' so the caller can try the next override.
export function parseAssetBase(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}${url.search}`;
}

// Precedence: ?assetBase= (empty forces this origin), window.ZILLIONS_ASSET_BASE,
// <meta name="zillions-asset-base">, ZILLIONS_ASSET_BASE, then the R2 default.
// An invalid override is ignored and the next source is used.
export function resolveAssetBase({
  search = '',
  globalBase = '',
  metaBase = '',
  envBase = '',
} = {}) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (params.has('assetBase')) {
    const raw = params.get('assetBase');
    if (raw == null || raw.trim() === '') return '';
    const parsed = parseAssetBase(raw);
    if (parsed) return parsed;
  }
  for (const candidate of [globalBase, metaBase, envBase]) {
    if (candidate == null || String(candidate).trim() === '') continue;
    const parsed = parseAssetBase(candidate);
    if (parsed) return parsed;
  }
  return DEFAULT_ASSET_BASE_URL;
}

function browserSearch() {
  try {
    if (typeof location !== 'undefined' && location && typeof location.search === 'string') return location.search;
  } catch {
    // Non-browser hosts have no location.
  }
  return '';
}

function browserGlobalBase() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.ZILLIONS_ASSET_BASE != null) {
      return globalThis.ZILLIONS_ASSET_BASE;
    }
  } catch {
    // Ignore a locked global.
  }
  return '';
}

function browserMetaBase() {
  try {
    if (typeof document !== 'undefined' && document.querySelector) {
      return document.querySelector('meta[name="zillions-asset-base"]')?.getAttribute('content') || '';
    }
  } catch {
    // document can throw while the page is closing.
  }
  return '';
}

function nodeEnvBase() {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.ZILLIONS_ASSET_BASE) {
      return process.env.ZILLIONS_ASSET_BASE;
    }
  } catch {
    // The browser has no process.
  }
  return '';
}

export function currentAssetBase() {
  return resolveAssetBase({
    search: browserSearch(),
    globalBase: browserGlobalBase(),
    metaBase: browserMetaBase(),
    envBase: nodeEnvBase(),
  });
}

// The version is part of the remote cache key only. Local fallback paths stay
// bare so the same-origin file still exists at the repo path.
export function withAssetVersion(url, version = GLB_ASSET_VERSION) {
  const token = String(version ?? '').trim();
  if (!token) return url;
  const hash = url.indexOf('#');
  const bare = hash >= 0 ? url.slice(0, hash) : url;
  const fragment = hash >= 0 ? url.slice(hash) : '';
  if (/[?&]v=/.test(bare)) return url;
  const join = bare.includes('?') ? '&' : '?';
  return `${bare}${join}v=${encodeURIComponent(token)}${fragment}`;
}

// Repo-relative paths stay repo-relative (`assets/art-marines/hero_sniper.glb`).
// An absolute URL is returned unchanged. A base produces [versioned remote, local].
export function glbCandidateUrls(relativeUrl, base = DEFAULT_ASSET_BASE_URL) {
  const raw = String(relativeUrl ?? '').trim();
  if (!raw) return [];
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return [raw];
  const rel = raw.replace(/^\/+/, '');
  const normalized = base ? parseAssetBase(base) : '';
  if (!normalized) return [rel];
  const remote = withAssetVersion(joinAssetPath(normalized, rel));
  return remote === rel ? [rel] : [remote, rel];
}

// Keep a path prefix and an existing query. `new URL(rel, base)` would drop
// a prefix that does not end in a slash.
function joinAssetPath(base, rel) {
  const root = new URL(base);
  const search = root.search;
  if (!root.pathname.endsWith('/')) root.pathname = `${root.pathname}/`;
  // A path-relative URL drops the base query. Keep it, then add ?v= beside it.
  const joined = new URL(rel, root);
  return `${joined.origin}${joined.pathname}${search}`;
}

export function glbResourcePath(url) {
  const clean = String(url).split(/[?#]/, 1)[0];
  const slash = clean.lastIndexOf('/');
  return slash >= 0 ? clean.slice(0, slash + 1) : '';
}

function isNetworkFailure(error) {
  return error?.name === 'TypeError' || error instanceof TypeError;
}

// Remote first. A bad status, a network error, or a body that is not a GLB
// (including a Git LFS pointer served as HTTP 200) tries the same-origin path.
// The thrown error is the last failure so callers can keep their fallback mesh.
export async function fetchGlbBytes(relativeUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? REMOTE_TIMEOUT_MS;
  const base = options.base !== undefined ? options.base : currentAssetBase();
  const skipRemote = remoteDown && options.base === undefined;
  const candidates = glbCandidateUrls(relativeUrl, skipRemote ? '' : base);
  let lastError = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const url = candidates[i];
    const remote = candidates.length > 1 && i === 0;
    try {
      const init = { credentials: 'omit' };
      if (remote && timeoutMs > 0) init.signal = AbortSignal.timeout(timeoutMs);
      const response = await fetchImpl(url, init);
      if (!response || !response.ok) {
        const status = response ? response.status : 'no response';
        throw new Error(`${url} HTTP ${status}`);
      }
      const bytes = await response.arrayBuffer();
      if (!isGlbBytes(bytes)) throw new Error(`${url} is not a GLB`);
      return { url, bytes };
    } catch (error) {
      lastError = error;
      if (remote && isNetworkFailure(error)) {
        remoteDown = true;
        if (!remoteDownWarned) {
          remoteDownWarned = true;
          console.warn('[assets] GLB host is unreachable; loading models from this origin');
        }
      }
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(`GLB unavailable: ${relativeUrl}`);
}

// Parse a GLB without handing pointer text to the loader. `loader` is a
// GLTFLoader (or a test double) with parseAsync(data, path).
export async function loadGlb(loader, relativeUrl, options) {
  const loaded = await fetchGlbBytes(relativeUrl, options);
  if (!loader || typeof loader.parseAsync !== 'function') throw new Error('GLB loader has no parseAsync');
  const gltf = await loader.parseAsync(loaded.bytes, glbResourcePath(loaded.url));
  if (!gltf?.scene) throw new Error(`${relativeUrl} has no scene`);
  return gltf;
}
