import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nextAvailableRoomSeat } from '../src/online.js';

for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  assert.ok(process.env[key], `${key} is required`);
}
const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const users = [];
const request = async (path, token, options = {}) => {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
};
async function account(label) {
  const email = `zillions-mp-${Date.now()}-${label.toLowerCase().replace(/[^a-z]+/g, '-')}-${randomUUID().slice(0, 8)}@taborlin.co`;
  const password = `Z!${randomUUID()}a9`;
  const created = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { authorization: `Bearer ${service}`, apikey: service, 'content-type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: label } }) });
  const user = await created.json();
  assert.equal(created.status, 200, JSON.stringify(user));
  assert.match(user.id, /^[0-9a-f-]{36}$/i, 'admin returned an unsafe user id');
  assert.ok(email.startsWith('zillions-mp-') && email.endsWith('@taborlin.co'), 'QA cleanup identity escaped its dedicated namespace');
  users.push({ id: user.id, email });
  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const session = await login.json();
  assert.equal(login.status, 200, JSON.stringify(session));
  return { id: user.id, token: session.access_token, name: label };
}

try {
  const [host, ...guests] = await Promise.all([
    account('MP Host'), account('MP Guest 2'), account('MP Guest 3'), account('MP Guest 4'),
  ]);
  const roomInsert = await request('rooms', host.token, { method: 'POST', body: JSON.stringify({ host_user_id: host.id, name: 'Multiplayer smoke', visibility: 'private', max_players: 4, metadata: { protocolVersion: 5, level: 1, mode: 'campaign' } }) });
  assert.equal(roomInsert.response.status, 201, JSON.stringify(roomInsert.body));
  const room = roomInsert.body[0];
  const hostSeat = await request('room_players', host.token, { method: 'POST', body: JSON.stringify({ room_id: room.id, user_id: host.id, seat: 1, display_name: host.name, hero: 'scott', ready: true }) });
  assert.equal(hostSeat.response.status, 201, JSON.stringify(hostSeat.body));
  for (const guest of guests) {
    const roster = await request(`room_players?room_id=eq.${room.id}&select=seat`, guest.token);
    assert.equal(roster.response.status, 200, JSON.stringify(roster.body));
    const seat = nextAvailableRoomSeat(roster.body, room.max_players);
    assert.ok(seat >= 2 && seat <= 4, `app allocator returned invalid guest seat ${seat}`);
    const seated = await request('room_players', guest.token, { method: 'POST', body: JSON.stringify({ room_id: room.id, user_id: guest.id, seat, display_name: guest.name, hero: 'scott', ready: false }) });
    assert.equal(seated.response.status, 201, JSON.stringify(seated.body));
  }
  const fullRoster = await request(`room_players?room_id=eq.${room.id}&select=user_id,seat&order=seat.asc`, host.token);
  assert.equal(fullRoster.response.status, 200, JSON.stringify(fullRoster.body));
  assert.deepEqual(fullRoster.body.map(({ seat }) => seat), [1, 2, 3, 4], 'authenticated room did not fill all four seats');
  assert.equal(nextAvailableRoomSeat(fullRoster.body, room.max_players), null, 'app allocator did not reject a full four-player room');

  const fourth = guests[2];
  const seatFive = await request(`room_players?room_id=eq.${room.id}&user_id=eq.${fourth.id}`, fourth.token, { method: 'PATCH', body: JSON.stringify({ seat: 5 }) });
  assert.ok(seatFive.response.status >= 400, `database admitted forbidden seat 5: ${JSON.stringify(seatFive.body)}`);
  const fourthSeat = await request(`room_players?room_id=eq.${room.id}&user_id=eq.${fourth.id}&select=seat`, fourth.token);
  assert.equal(fourthSeat.body?.[0]?.seat, 4, 'failed seat-5 mutation did not preserve the fourth player seat');
  for (const guest of guests) {
    const ready = await request(`room_players?room_id=eq.${room.id}&user_id=eq.${guest.id}`, guest.token, { method: 'PATCH', body: JSON.stringify({ ready: true }) });
    assert.equal(ready.body?.[0]?.ready, true, `${guest.name} could not mark its own seat ready`);
  }
  const attacker = guests[0];
  const roomHijack = await request(`rooms?id=eq.${room.id}`, attacker.token, { method: 'PATCH', body: JSON.stringify({ status: 'in_game' }) });
  assert.deepEqual(roomHijack.body, [], 'guest mutated host-owned room');
  const seatHijack = await request(`room_players?room_id=eq.${room.id}&user_id=eq.${host.id}`, attacker.token, { method: 'PATCH', body: JSON.stringify({ hero: 'danny' }) });
  assert.deepEqual(seatHijack.body, [], 'guest mutated another account seat');
  const start = await request(`rooms?id=eq.${room.id}`, host.token, { method: 'PATCH', body: JSON.stringify({ status: 'in_game' }) });
  assert.equal(start.body?.[0]?.status, 'in_game');
  const finish = await request(`rooms?id=eq.${room.id}`, host.token, { method: 'PATCH', body: JSON.stringify({ status: 'finished' }) });
  assert.equal(finish.body?.[0]?.status, 'finished');
  console.log('live multiplayer smoke passed: four accounts, seats 1-4, full-room rejection, seat-5 denial, Ready, host authority, cross-account isolation, start/end');
} finally {
  await Promise.all(users.map(({ id, email }) => {
    assert.ok(email.startsWith('zillions-mp-') && email.endsWith('@taborlin.co'), `refusing unsafe cleanup target ${email}`);
    return fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${service}`, apikey: service } }).catch(() => {});
  }));
}
