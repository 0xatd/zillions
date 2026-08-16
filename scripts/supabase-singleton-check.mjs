import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const auth = readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8');
const online = readFileSync(new URL('../src/online.js', import.meta.url), 'utf8');
const shared = readFileSync(new URL('../src/supabase.js', import.meta.url), 'utf8');

assert.equal((auth.match(/createClient\s*\(/g) || []).length, 0, 'auth must not create a second Supabase client');
assert.equal((online.match(/createClient\s*\(/g) || []).length, 0, 'online lobby must not create a second Supabase client');
assert.match(shared, /let clientPromise = null/);
assert.match(shared, /SUPABASE_WRITE_TIMEOUT_MS = 8000/);
assert.match(shared, /global: \{ fetch: fetchWithWriteTimeout \}/);
console.log('supabase singleton check passed');
