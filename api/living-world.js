import { WORLD_COMMANDS, ENCOUNTER_CHOICES, validateWorldCommand } from '../src/living-world.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const BODY_LIMIT = 32 * 1024;
const IDENTIFIER = /^[a-zA-Z0-9:_-]{1,96}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_IDENTITY_KEYS = new Set(['actor', 'actorId', 'actor_id', 'userId', 'user_id', 'ownerUserId', 'owner_user_id']);
const COMMAND_KEYS = new Set(['type', 'requestId', 'shardId', 'partyId', 'expectedRevision', 'payload']);
const PAYLOAD_KEYS = Object.freeze({
  issue_movement: ['routeId'], cancel_movement: ['movementOrderId'],
  set_encounter_choice: ['encounterId', 'choice', 'decisionRevision', 'rearguardStackIds', 'diversion'],
  submit_battle_order: ['engagementId', 'round', 'order'], accept_surrender: ['encounterId', 'terms'],
  trade_market: ['locationId', 'commodityKey', 'side', 'quantity'],
});
const send = (res, status, body) => { res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify(body)); };
const text = (value) => typeof value === 'string' ? value : '';

async function parseBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > BODY_LIMIT) throw Object.assign(new Error('body_too_large'), { status: 413 }); chunks.push(Buffer.from(chunk)); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}
function assertNoActor(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { if (FORBIDDEN_IDENTITY_KEYS.has(key)) throw Object.assign(new Error('actor_spoof_rejected'), { status: 400 }); assertNoActor(child); }
}
export function validateCommandBody(body) {
  assertNoActor(body);
  if (Object.keys(body || {}).some((key) => !COMMAND_KEYS.has(key))) throw Object.assign(new Error('unsupported_command_field'), { status: 400 });
  const command = { type: text(body.type), requestId: text(body.requestId), shardId: text(body.shardId), partyId: text(body.partyId), expectedRevision: body.expectedRevision };
  try { validateWorldCommand(command); } catch (error) { throw Object.assign(error, { status: 400 }); }
  if (!UUID.test(command.partyId)) throw Object.assign(new Error('invalid_party_id'), { status: 400 });
  const allowed = PAYLOAD_KEYS[command.type];
  if (!allowed || !WORLD_COMMANDS.includes(command.type)) throw Object.assign(new Error('unsupported_command'), { status: 400 });
  const payload = body.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('invalid_payload'), { status: 400 });
  if (Object.keys(payload).some((key) => !allowed.includes(key))) throw Object.assign(new Error('unsupported_payload_field'), { status: 400 });
  for (const [key, value] of Object.entries(payload)) if (key.endsWith('Id') && !UUID.test(text(value))) throw Object.assign(new Error('invalid_payload'), { status: 400 });
  if (command.type === 'set_encounter_choice' && !ENCOUNTER_CHOICES.includes(payload.choice)) throw Object.assign(new Error('invalid_encounter_choice'), { status: 400 });
  if (command.type === 'trade_market' && (!['buy', 'sell'].includes(payload.side) || !(Number(payload.quantity) > 0))) throw Object.assign(new Error('invalid_trade'), { status: 400 });
  return { ...command, payload };
}

export function filterProjection(snapshot, actorId) {
  const tick = Number(snapshot.shard?.simulation_tick || 0), allParties = snapshot.parties || [];
  const own = allParties.filter((party) => party.owner_user_id === actorId), ownIds = new Set(own.map((party) => party.id));
  const factions = new Set(own.map((party) => party.owner_faction_id).filter(Boolean));
  const reports = (snapshot.scoutingReports || []).filter((report) => ownIds.has(report.observer_party_id) && Number(report.expires_tick) >= tick);
  const reportedPartyIds = new Set(reports.map((report) => report.subject_party_id).filter(Boolean));
  const reportedLocationIds = new Set(reports.map((report) => report.location_id).filter(Boolean));
  own.forEach((party) => { if (party.location_id) reportedLocationIds.add(party.location_id); });
  const locations = (snapshot.locations || []).filter((location) => factions.has(location.owner_faction_id) || reportedLocationIds.has(location.id));
  const locationIds = new Set(locations.map((location) => location.id));
  const marketLocationIds = new Set(own.map((party) => party.location_id).filter(Boolean));
  locations.forEach((location) => { if (factions.has(location.owner_faction_id)) marketLocationIds.add(location.id); });
  reports.forEach((report) => { if (report.location_id && report.intelligence?.marketAccess === true) marketLocationIds.add(report.location_id); });
  const parties = allParties.filter((party) => ownIds.has(party.id) || factions.has(party.owner_faction_id) || reportedPartyIds.has(party.id)).map((party) => {
    if (ownIds.has(party.id) || factions.has(party.owner_faction_id)) return party;
    const report = reports.find((entry) => entry.subject_party_id === party.id);
    return { id: party.id, name: party.name, kind: party.kind, owner_faction_id: party.owner_faction_id, location_id: party.location_id, route_id: party.route_id, route_progress: party.route_progress, stance: party.stance, intelligence: report?.intelligence || {}, observed_tick: report?.observed_tick, accuracy: report?.accuracy };
  });
  const routes = (snapshot.routes || []).filter((route) => locationIds.has(route.origin_id) && locationIds.has(route.destination_id));
  const regionIds = new Set([
    ...locations.map((location) => location.province_id),
    ...own.map((party) => party.region_id),
  ].filter(Boolean));
  const regions = (snapshot.regions || []).filter((region) => regionIds.has(region.id));
  const factionIds = new Set([
    ...regions.flatMap((region) => [region.owner_faction_id, region.claimed_by_faction_id]),
    ...locations.flatMap((location) => [location.owner_faction_id, location.claimed_by_faction_id]),
    ...routes.flatMap((route) => [route.owner_faction_id, route.claimed_by_faction_id]),
    ...parties.map((party) => party.owner_faction_id),
  ].filter(Boolean));
  const social = snapshot.socialParty;
  const actorIsMember = social?.members?.some((member) => member.user_id === actorId);
  const socialParty = actorIsMember ? {
    id: social.id, name: social.name, leader_user_id: social.leader_user_id, revision: social.revision,
    members: social.members.map((member) => ({ user_id: member.user_id, role: member.role,
      worldParty: member.worldParty ? {
        id: member.worldParty.id, region_id: member.worldParty.region_id, owner_user_id: member.worldParty.owner_user_id,
        name: member.worldParty.name, kind: member.worldParty.kind, location_id: member.worldParty.location_id,
        route_id: member.worldParty.route_id, route_progress: member.worldParty.route_progress, stance: member.worldParty.stance,
      } : null })),
  } : null;
  const visiblePartyIds = new Set(parties.map((party) => party.id));
  return { ok: true, shard: snapshot.shard || null, planet: snapshot.planet || null,
    factions: (snapshot.factions || []).filter((faction) => factionIds.has(faction.id)), regions,
    ownParties: own, socialParty, locations, routes,
    markets: (snapshot.markets || []).filter((market) => marketLocationIds.has(market.location_id)), parties,
    logistics: {
      supplies: (snapshot.supplies || []).filter((row) => ownIds.has(row.party_id)),
      cargo: (snapshot.cargo || []).filter((row) => ownIds.has(row.party_id)),
      caravans: (snapshot.caravans || []).filter((row) => visiblePartyIds.has(row.party_id)),
      raids: (snapshot.raids || []).filter((row) => ownIds.has(row.attacker_party_id) || ownIds.has(row.target_party_id)),
    } };
}

async function authenticate(authorization, config, fetchImpl) {
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetchImpl(`${config.url}/auth/v1/user`, { headers: { authorization, apikey: config.anonKey } });
  return response.ok ? response.json() : null;
}
async function restRows(config, table, query, fetchImpl) {
  const response = await fetchImpl(`${config.url}/rest/v1/${table}?${query}`, { headers: { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey } });
  if (!response.ok) throw new Error('living_world_projection_failed');
  return response.json();
}
async function loadSnapshot(config, shardId, actorId, fetchImpl) {
  const encoded = encodeURIComponent(shardId);
  const [shards, planets, provinces, parties, reports, ownMemberships, supplies, cargo, caravans, raids] = await Promise.all([
    restRows(config, 'world_shards', `select=id,name,status,simulation_tick,ruleset_version,revision&id=eq.${encoded}&limit=1`, fetchImpl),
    restRows(config, 'world_planets', `select=id,system_id,shard_id,key,name,status,revision&shard_id=eq.${encoded}&limit=1`, fetchImpl),
    restRows(config, 'world_provinces', `select=id,planet_id,key,name,bounds,owner_faction_id,claimed_by_faction_id,control_strength,garrison_strength,unrest,control_state,siege_state,revision&shard_id=eq.${encoded}`, fetchImpl),
    restRows(config, 'world_parties', `select=id,region_id,owner_user_id,owner_faction_id,name,kind,location_id,route_id,route_progress,speed,morale,fatigue,stance,strategic_intent,strategic_reason,strategic_target_location_id,strategic_intent_tick,revision&shard_id=eq.${encoded}`, fetchImpl),
    restRows(config, 'world_scouting_reports', `select=observer_party_id,subject_party_id,location_id,observed_tick,expires_tick,accuracy,intelligence&shard_id=eq.${encoded}`, fetchImpl),
    restRows(config, 'social_party_members', `select=party_id,user_id,role&user_id=eq.${encodeURIComponent(actorId)}`, fetchImpl),
    restRows(config, 'world_supplies', 'select=party_id,supply_key,quantity,consumption_per_tick,revision', fetchImpl),
    restRows(config, 'world_cargo', 'select=party_id,commodity_key,quantity,reserved_quantity,revision', fetchImpl),
    restRows(config, 'world_caravan_plans', 'select=id,party_id,origin_location_id,destination_location_id,commodity_key,target_quantity,state,revision', fetchImpl),
    restRows(config, 'world_raid_orders', 'select=id,attacker_party_id,target_party_id,resolve_tick,state,result', fetchImpl),
  ]);
  const provinceIds = provinces.map((row) => row.id);
  const planet = planets[0] || null;
  const factions = planet ? await restRows(config, 'world_factions', `select=id,planet_id,name,kind,status,revision&planet_id=eq.${encodeURIComponent(planet.id)}`, fetchImpl) : [];
  let socialParty = null;
  if (ownMemberships[0]) {
    const partyId = ownMemberships[0].party_id;
    const [socialParties, members] = await Promise.all([
      restRows(config, 'social_parties', `select=id,leader_user_id,name,status,revision&id=eq.${partyId}&limit=1`, fetchImpl),
      restRows(config, 'social_party_members', `select=party_id,user_id,role&party_id=eq.${partyId}`, fetchImpl),
    ]);
    const memberIds = members.map((member) => member.user_id);
    const memberParties = parties.filter((party) => memberIds.includes(party.owner_user_id));
    socialParty = { ...socialParties[0], members: members.map((member) => ({ ...member, worldParty: memberParties.find((party) => party.owner_user_id === member.user_id) || null })) };
  }
  if (!provinceIds.length) return { shard: shards[0], planet, factions, regions: [], parties, socialParty, scoutingReports: reports, supplies, cargo, caravans, raids, locations: [], routes: [], markets: [] };
  const inList = `(${provinceIds.join(',')})`;
  const locations = await restRows(config, 'world_locations', `select=id,province_id,key,name,kind,position,owner_faction_id,claimed_by_faction_id,control_strength,garrison_strength,unrest,control_state,siege_state,services,revision&province_id=in.${inList}`, fetchImpl);
  const [routes, markets] = await Promise.all([
    restRows(config, 'world_routes', `select=id,province_id,origin_id,destination_id,origin_region_id,destination_region_id,distance,terrain,danger,owner_faction_id,claimed_by_faction_id,control_strength,control_state,blockade_state,revision&origin_region_id=in.${inList}`, fetchImpl),
    locations.length ? restRows(config, 'world_markets', `select=location_id,commodity_key,stock,buy_price,sell_price,revision&location_id=in.(${locations.map((row) => row.id).join(',')})`, fetchImpl) : [],
  ]);
  return { shard: shards[0], planet, factions, regions: provinces, parties, socialParty, scoutingReports: reports, supplies, cargo, caravans, raids, locations, routes, markets };
}

export function createLivingWorldHandler(deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  return async function handler(req, res) {
    try {
      if (!['GET', 'POST'].includes(req.method)) { res.setHeader('allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }
      const config = deps.config || { url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
      if (!config.url || !config.anonKey || !config.serviceKey) return send(res, 503, { ok: false, error: 'living_world_backend_not_configured' });
      const authorization = String(req.headers.authorization || '');
      const user = deps.authenticate ? await deps.authenticate(authorization) : await authenticate(authorization, config, fetchImpl);
      if (!user?.id) return send(res, 401, { ok: false, error: 'sign_in_required' });
      if (req.method === 'GET') {
        const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`), shardId = text(url.searchParams.get('shardId'));
        if (!IDENTIFIER.test(shardId)) return send(res, 400, { ok: false, error: 'invalid_shard_id' });
        const snapshot = deps.loadSnapshot ? await deps.loadSnapshot(shardId, user.id) : await loadSnapshot(config, shardId, user.id, fetchImpl);
        return send(res, 200, filterProjection(snapshot, user.id));
      }
      const command = validateCommandBody(await parseBody(req));
      const rpc = deps.command ? await deps.command(user.id, command) : await fetchImpl(`${config.url}/rest/v1/rpc/living_world_command`, { method: 'POST', headers: { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, 'content-type': 'application/json' }, body: JSON.stringify({ p_actor: user.id, p_shard: command.shardId, p_request_id: command.requestId, p_type: command.type, p_party: command.partyId, p_expected_revision: command.expectedRevision, p_payload: command.payload }) });
      const result = deps.command ? rpc : await rpc.json().catch(() => null);
      if (!deps.command && !rpc.ok) return send(res, rpc.status === 409 ? 409 : 400, { ok: false, error: result?.message || 'living_world_command_failed' });
      return send(res, 200, result);
    } catch (error) { return send(res, error?.status || 500, { ok: false, error: error?.message || 'living_world_backend_error' }); }
  };
}
export default createLivingWorldHandler();
