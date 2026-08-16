import assert from 'node:assert/strict';
import fs from 'node:fs';

const online = fs.readFileSync(new URL('../src/online.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert.match(online, /export const LOBBY_PROTOCOL_VERSION = \d+;/,
  'rooms need an explicit multiplayer protocol version');
assert.match(online, /protocolVersion: LOBBY_PROTOCOL_VERSION/,
  'new rooms must publish their protocol version');
assert.match(online, /assertRoomCompatibility\(game\);[\s\S]*this\.game = game;/,
  'join/watch must reject incompatible rooms before mutating local room state');
assert.match(online, /\.update\(\{ ready: false \}\)[\s\S]*\.neq\('user_id', this\.me\.id\)/,
  'host setup changes must invalidate every guest Ready vote');
assert.match(main, /roomCompatibility\(row\)[\s\S]*compatibility\.reason/,
  'join and watch flows must explain incompatible rooms');
assert.match(ui, /protocol_compatible === false/,
  'the browser must visibly disable incompatible rooms');
assert.match(ui, /Refresh required/,
  'the disabled room action must explain the required recovery');

console.log('lobby hardening check passed');
