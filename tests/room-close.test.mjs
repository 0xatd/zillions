import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const method = source.slice(source.indexOf('  _handleRoomClosed('), source.indexOf('  async _leaveOnlineRoom('));
function fixture(role, active) {
  const calls = [];
  const handle = new Function('location', `return ({${method}})._handleRoomClosed`)({ reload: () => calls.push('reload') });
  const app = { mpRole: role, netMode: active, onlineMode: true,
    peers: [{ destroy: () => calls.push('peer') }], net: { destroy: () => calls.push('net') },
    lobby: { game: { id: 'room' }, _clearRoomState() { this.game = null; calls.push('clear'); } },
    ui: { showLobby: () => calls.push('lobby'), showBanner: () => calls.push('banner') } };
  return { app, calls, close: () => handle.call(app, 'match_ended') };
}
test('ending an active room resets guest and spectator clients instead of leaving a stale match under the lobby', () => {
  for (const role of ['guest', 'spectator']) {
    const f = fixture(role, true); f.close();
    assert.deepEqual(f.calls, ['peer', 'net', 'clear', 'reload']);
    assert.equal(f.app.lobby.game, null);
    f.close(); assert.equal(f.calls.filter(x => x === 'reload').length, 1);
  }
});
test('closing staging returns to the lobby without reloading; host closure is handled separately', () => {
  const staging = fixture('guest', false); staging.close();
  assert.deepEqual(staging.calls, ['peer', 'net', 'clear', 'lobby', 'banner']);
  const host = fixture('host', true); host.close(); assert.deepEqual(host.calls, []);
});
