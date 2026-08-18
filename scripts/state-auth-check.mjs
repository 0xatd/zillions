import assert from 'node:assert/strict';
import fs from 'node:fs';
import handler from '../api/state.js';

const api = fs.readFileSync(new URL('../api/state.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/backend.js', import.meta.url), 'utf8');
assert.match(api, /authenticatedUser\(req\)/, 'state API must authenticate every request');
assert.match(api, /player_mismatch/, 'state API must enforce player ownership');
assert.match(api, /access: 'private'/, 'state blobs must not be public');
assert.match(client, /authorization: `Bearer \$\{token\}`/, 'state client must forward the account token');
assert.match(client, /accountSession\?\.user\?\.id/, 'state client must use the authenticated account id');

const response = () => ({
  status: 0, body: null, headers: {},
  writeHead(status, headers) { this.status = status; this.headers = headers; },
  end(body) { this.body = JSON.parse(body); },
  setHeader() {},
});
process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
process.env.SUPABASE_URL = 'https://accounts.invalid';
process.env.SUPABASE_ANON_KEY = 'test-anon';
const unauthorized = response();
await handler({ method: 'GET', url: '/api/state?playerId=p1', headers: { host: 'test' } }, unauthorized);
assert.equal(unauthorized.status, 401, 'anonymous state reads must fail');

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: 'owner-1' }) });
const mismatch = response();
await handler({
  method: 'GET', url: '/api/state?playerId=other-player',
  headers: { host: 'test', authorization: 'Bearer test-user-token' },
}, mismatch);
globalThis.fetch = originalFetch;
assert.equal(mismatch.status, 403, 'authenticated users must not read another player’s state');
console.log('state auth check passed');
