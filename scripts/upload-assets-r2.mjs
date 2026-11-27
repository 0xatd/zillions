// Upload every real GLB under assets/ to the public R2 bucket.
// This only puts objects. It never deletes a key.
//
//   node scripts/upload-assets-r2.mjs --dry-run
//   node scripts/upload-assets-r2.mjs
//
// Requires Wrangler auth (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, or
// `npx wrangler login`). Run `git lfs pull` first so pointer files are real
// models. A pointer is skipped, not uploaded.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isGlbBytes } from '../src/marine-hero-art.js';
import { GLB_ASSET_VERSION, GLB_CACHE_CONTROL, GLB_CONTENT_TYPE, R2_BUCKET } from '../src/asset-base.js';

const ROOT = path.resolve(import.meta.dirname, '..');

export function isUploadableGlb(bytes) {
  if (!isGlbBytes(bytes)) return false;
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  if (view.length < 12) return false;
  const u32 = (offset) => view[offset]
    | (view[offset + 1] << 8)
    | (view[offset + 2] << 16)
    | (view[offset + 3] << 24);
  const version = u32(4);
  const length = u32(8) >>> 0;
  return version === 2 && length === view.length;
}

export function assetObjectKey(root, file) {
  const key = path.relative(root, file).split(path.sep).join('/');
  if (!key.startsWith('assets/') || key.split('/').includes('..') || !key.endsWith('.glb')) return null;
  return key;
}

export function wranglerPutArgs(key, file, { remote = true } = {}) {
  const args = [
    'r2', 'object', 'put', `${R2_BUCKET}/${key}`,
    `--file=${file}`,
    `--content-type=${GLB_CONTENT_TYPE}`,
    `--cache-control=${GLB_CACHE_CONTROL}`,
  ];
  if (remote) args.push('--remote');
  return args;
}

function walkGlbs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkGlbs(full, out);
    else if (entry.isFile() && entry.name.endsWith('.glb')) out.push(full);
  }
  return out;
}

export function classifyAssetGlbs(root = ROOT) {
  const upload = [];
  const skip = [];
  const files = walkGlbs(path.join(root, 'assets'), []);
  for (const file of files) {
    const key = assetObjectKey(root, file);
    if (!key) {
      skip.push({ file, key: null, reason: 'path' });
      continue;
    }
    const bytes = fs.readFileSync(file);
    if (!isUploadableGlb(bytes)) {
      skip.push({ file, key, reason: 'not a GLB (LFS pointer or truncated file)' });
      continue;
    }
    upload.push({ file, key, bytes: bytes.length });
  }
  return { upload, skip };
}

function wranglerCommand() {
  const local = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
  if (fs.existsSync(local)) return { bin: local, prefix: [] };
  return { bin: 'npx', prefix: ['--yes', 'wrangler'] };
}

function helpSupportsRemote(bin, prefix) {
  const result = spawnSync(bin, [...prefix, 'r2', 'object', 'put', '--help'], { encoding: 'utf8' });
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  return text.includes('--remote');
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => /delete|purge/i.test(arg))) {
    console.error('This script only uploads GLB objects. It does not delete anything from the bucket.');
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const help = args.includes('--help') || args.includes('-h');
  if (help) {
    console.log('Usage: node scripts/upload-assets-r2.mjs [--dry-run]');
    console.log(`Puts assets/**/*.glb into R2 bucket ${R2_BUCKET}.`);
    console.log(`Cache-Control: ${GLB_CACHE_CONTROL}`);
    console.log(`Runtime cache key: ?v=${GLB_ASSET_VERSION}`);
    console.log('Does not delete objects. Bump GLB_ASSET_VERSION when replacing bytes.');
    return;
  }
  const { upload, skip } = classifyAssetGlbs(ROOT);
  for (const item of skip) console.warn(`skip ${item.key || item.file}: ${item.reason}`);
  console.log(`${upload.length} GLB file(s) to upload, ${skip.length} skipped.`);
  console.log(`Object keys stay the repo paths. Clients request ?v=${GLB_ASSET_VERSION}.`);
  console.log('Bump GLB_ASSET_VERSION in src/asset-base.js when these bytes should replace a year-long cache.');
  if (dryRun) {
    for (const item of upload) console.log(`dry-run ${item.key} (${item.bytes} bytes)`);
    return;
  }
  if (upload.length === 0) {
    console.error('No real GLB bytes to upload. Run git lfs pull, then try again.');
    process.exit(1);
  }
  const { bin, prefix } = wranglerCommand();
  const probe = spawnSync(bin, [...prefix, '--version'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    console.error('Wrangler is not available. Install it with `npm install -g wrangler` or use npx, then authenticate:');
    console.error('  npx wrangler login');
    console.error('or export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
    process.exit(1);
  }
  const remote = helpSupportsRemote(bin, prefix);
  let failed = 0;
  for (const item of upload) {
    const putArgs = [...prefix, ...wranglerPutArgs(item.key, item.file, { remote })];
    console.log(`put ${item.key}`);
    const result = spawnSync(bin, putArgs, { stdio: 'inherit', cwd: ROOT });
    if (result.status !== 0) {
      failed += 1;
      console.error(`failed ${item.key}`);
    }
  }
  if (failed) {
    console.error(`${failed} upload(s) failed. Existing bucket objects were not deleted.`);
    process.exit(1);
  }
  console.log(`Uploaded ${upload.length} object(s) to ${R2_BUCKET}. No objects were deleted.`);
}

if (invokedDirectly()) main();
