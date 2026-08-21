import { WORLD_COMMANDS, ENCOUNTER_CHOICES, validateWorldCommand } from '../src/living-world.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const BODY_LIMIT = 32 * 1024;
const IDENTIFIER = /^[a-zA-Z0-9:_-]{1,96}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_IDENTITY_KEYS = new Set(['actor', 'actorId', 'actor_id', 'userId', 'user_id', 'ownerUserId', 'owner_user_id']);
const COMMAND_KEYS = new Set(['type', 'requestId', 'shardId', 'partyId', 'expectedRevision', 'payload']);
const PAYLOAD_KEYS = Object.freeze({
  issue_movement: ['routeId','mode'], cancel_movement: ['movementOrderId'],
  set_encounter_choice: ['encounterId', 'choice', 'decisionRevision', 'rearguardStackIds', 'diversion'],
  submit_battle_order: ['engagementId', 'round', 'order'], accept_surrender: ['encounterId', 'terms'],
  trade_market: ['locationId', 'commodityKey', 'side', 'quantity'],
});
const send = (res, status, body) => { res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify(body)); };
const text = (value) => typeof value === 'string' ? value : '';
const PROJECTION_LIMITS = Object.freeze({ regions: 160, locations: 600, routes: 1200, parties: 500, sieges: 200, pursuits: 200 });
const DEFAULT_VIEWPORT = Object.freeze({ minX: 0, minY: 0, maxX: 100, maxY: 100, zoom: 0 });

export function parseViewport(searchParams) {
  const supplied = ['minX', 'minY', 'maxX', 'maxY', 'zoom'].some((key) => searchParams.has(key));
  if (!supplied) return { ...DEFAULT_VIEWPORT };
  const values = Object.fromEntries(['minX', 'minY', 'maxX', 'maxY', 'zoom'].map((key) => [key, searchParams.has(key) ? Number(searchParams.get(key)) : DEFAULT_VIEWPORT[key]]));
  if (Object.values(values).some((value) => !Number.isFinite(value)) || values.minX < 0 || values.minY < 0 || values.maxX > 100 || values.maxY > 100 || values.minX >= values.maxX || values.minY >= values.maxY || values.zoom < 0 || values.zoom > 8) {
    throw Object.assign(new Error('invalid_viewport'), { status: 400 });
  }
  return values;
}

const pointInViewport = (point, viewport) => !point || (Number(point.x) >= viewport.minX && Number(point.x) <= viewport.maxX && Number(point.y) >= viewport.minY && Number(point.y) <= viewport.maxY);
const polygonInViewport = (polygon, viewport) => {
  if (!Array.isArray(polygon) || !polygon.length) return false;
  const xs = polygon.map(([x]) => x), ys = polygon.map(([, y]) => y);
  return Math.max(...xs) >= viewport.minX && Math.min(...xs) <= viewport.maxX && Math.max(...ys) >= viewport.minY && Math.min(...ys) <= viewport.maxY;
};
const limited = (rows, key, limits, truncated) => {
  if (rows.length > limits[key]) truncated[key] = rows.length - limits[key];
  return rows.slice(0, limits[key]);
};

export function sanitizeWorldTopology(row, viewport = DEFAULT_VIEWPORT) {
  const manifest = row?.manifest;
  if (!manifest || manifest.planetId == null || !Array.isArray(manifest.landmasses) || !Array.isArray(manifest.regions)) return null;
  const sanitizePolygon = (polygon) => Array.isArray(polygon) ? polygon.filter((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)).slice(0, 2048).map(([x, y]) => [x, y]) : [];
  const landmasses = manifest.landmasses.map((landmass) => ({ key: text(landmass.key), name: text(landmass.name), polygon: sanitizePolygon(landmass.polygon) })).filter((landmass) => landmass.key && polygonInViewport(landmass.polygon, viewport)).slice(0, 32);
  const provinces = manifest.regions.map((region) => ({ id: text(region.id), key: text(region.key), name: text(region.name), landmass: text(region.landmass), biome: text(region.biome), center: region.center && { x: Number(region.center.x), y: Number(region.center.y) }, polygon: sanitizePolygon(region.polygon) }))
    .filter((region) => region.id && region.center && Number.isFinite(region.center.x) && Number.isFinite(region.center.y) && (pointInViewport(region.center, viewport) || polygonInViewport(region.polygon, viewport))).slice(0, PROJECTION_LIMITS.regions);
  return { planetId: text(manifest.planetId), projection: text(manifest.projection), size: { width: Number(manifest.size?.width) || 100, height: Number(manifest.size?.height) || 100 }, contentHash: text(row.content_hash || manifest.contentHash), landmasses, provinces };
}

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
  if (command.type === 'issue_movement' && payload.mode != null && !['travel','fast'].includes(payload.mode)) throw Object.assign(new Error('invalid_travel_mode'), { status: 400 });
  if (command.type === 'trade_market' && (!['buy', 'sell'].includes(payload.side) || !(Number(payload.quantity) > 0))) throw Object.assign(new Error('invalid_trade'), { status: 400 });
  return { ...command, payload };
}

export function filterProjection(snapshot, actorId, viewport = DEFAULT_VIEWPORT) {
  const tick = Number(snapshot.shard?.simulation_tick || 0), allParties = snapshot.parties || [];
  const own = allParties.filter((party) => party.owner_user_id === actorId), ownIds = new Set(own.map((party) => party.id));
  const factions = new Set(own.map((party) => party.owner_faction_id).filter(Boolean));
  const reports = (snapshot.scoutingReports || []).filter((report) => ownIds.has(report.observer_party_id) && Number(report.expires_tick) >= tick);
  const reportedPartyIds = new Set(reports.map((report) => report.subject_party_id).filter(Boolean));
  const reportedLocationIds = new Set(reports.map((report) => report.location_id).filter(Boolean));
  own.forEach((party) => { if (party.location_id) reportedLocationIds.add(party.location_id); });
  const knownLocations = (snapshot.locations || []).filter((location) => factions.has(location.owner_faction_id) || reportedLocationIds.has(location.id));
  const locationsInViewport = knownLocations.filter((location) => pointInViewport(location.position, viewport));
  const truncated = {};
  const locations = limited(locationsInViewport, 'locations', PROJECTION_LIMITS, truncated);
  const locationIds = new Set(locations.map((location) => location.id));
  const marketLocationIds = new Set(own.map((party) => party.location_id).filter(Boolean));
  locations.forEach((location) => { if (factions.has(location.owner_faction_id)) marketLocationIds.add(location.id); });
  reports.forEach((report) => { if (report.location_id && report.intelligence?.marketAccess === true) marketLocationIds.add(report.location_id); });
  const armyByParty = new Map((snapshot.armies || []).map((army) => [army.party_id, army]));
  const visibleParties = allParties.filter((party) => ownIds.has(party.id) || factions.has(party.owner_faction_id) || reportedPartyIds.has(party.id)).map((party) => {
    if (ownIds.has(party.id) || factions.has(party.owner_faction_id)) return { ...party, strength: Number(armyByParty.get(party.id)?.combat_power || 0) };
    const report = reports.find((entry) => entry.subject_party_id === party.id);
    return { id: party.id, name: party.name, kind: party.kind, owner_faction_id: party.owner_faction_id, location_id: party.location_id, route_id: party.route_id, route_progress: party.route_progress, stance: party.stance, intelligence: report?.intelligence || {}, observed_tick: report?.observed_tick, accuracy: report?.accuracy };
  });
  const viewportLocationIds = new Set(locations.map((location) => location.id));
  const routes = limited((snapshot.routes || []).filter((route) => locationIds.has(route.origin_id) && locationIds.has(route.destination_id)), 'routes', PROJECTION_LIMITS, truncated);
  const routeIds = new Set(routes.map((route) => route.id));
  const parties = limited(visibleParties.filter((party) => viewportLocationIds.has(party.location_id) || (party.route_id && routeIds.has(party.route_id))), 'parties', PROJECTION_LIMITS, truncated);
  const regionIds = new Set([
    ...locations.map((location) => location.province_id),
  ].filter(Boolean));
  const regions = limited((snapshot.regions || []).filter((region) => regionIds.has(region.id)), 'regions', PROJECTION_LIMITS, truncated);
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
  const encounters = (snapshot.encounters || []).filter((encounter) => ownIds.has(encounter.attacker_party_id) || ownIds.has(encounter.defender_party_id));
  const encounterIds = new Set(encounters.map((encounter) => encounter.id));
  const visibleRegionIds = new Set(regions.map((region) => region.id));
  const sieges = limited((snapshot.sieges || []).filter((siege) => visibleRegionIds.has(siege.region_id) && locationIds.has(siege.location_id) && visiblePartyIds.has(siege.attacker_party_id)).map((siege) => ({ id: siege.id, region_id: siege.region_id, location_id: siege.location_id, attacker_party_id: siege.attacker_party_id, attacker_faction_id: siege.attacker_faction_id, defender_faction_id: siege.defender_faction_id, status: siege.status, progress: siege.progress, started_tick: siege.started_tick, revision: siege.revision })), 'sieges', PROJECTION_LIMITS, truncated);
  const pursuits = limited((snapshot.pursuits || []).filter((pursuit) => visiblePartyIds.has(pursuit.pursuer_party_id) && visiblePartyIds.has(pursuit.target_party_id)).map((pursuit) => ({ id: pursuit.id, pursuer_party_id: pursuit.pursuer_party_id, target_party_id: pursuit.target_party_id, started_tick: pursuit.started_tick, state: pursuit.state, revision: pursuit.revision })), 'pursuits', PROJECTION_LIMITS, truncated);
  return { ok: true, shard: snapshot.shard || null, planet: snapshot.planet || null,
    viewport: { ...viewport, truncated }, topology: sanitizeWorldTopology(snapshot.manifest, viewport),
    factions: (snapshot.factions || []).filter((faction) => factionIds.has(faction.id)), regions,
    ownParties: own, socialParty, locations, routes,
    markets: (snapshot.markets || []).filter((market) => marketLocationIds.has(market.location_id) && locationIds.has(market.location_id)), parties,
    logistics: {
      supplies: (snapshot.supplies || []).filter((row) => ownIds.has(row.party_id)),
      cargo: (snapshot.cargo || []).filter((row) => ownIds.has(row.party_id)),
      caravans: (snapshot.caravans || []).filter((row) => visiblePartyIds.has(row.party_id)),
      raids: (snapshot.raids || []).filter((row) => ownIds.has(row.attacker_party_id) || ownIds.has(row.target_party_id)),
    }, sieges, pursuits, encounters, engagements: (snapshot.engagements || []).filter((engagement) => encounterIds.has(engagement.encounter_id)) };
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
async function rpcJson(config, name, body, fetchImpl) {
  const response = await fetchImpl(`${config.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('living_world_projection_failed');
  return response.json();
}
const inIds = (rows) => `(${rows.map((row) => typeof row === 'string' ? row : row.id).join(',')})`;
const mergeById = (...groups) => [...new Map(groups.flat().map((row) => [row.id, row])).values()];
const PARTY_SELECT = 'id,region_id,owner_user_id,owner_faction_id,name,kind,location_id,route_id,route_progress,speed,morale,fatigue,stance,strategic_intent,strategic_reason,strategic_target_location_id,strategic_intent_tick,revision';

export async function loadSnapshot(config, shardId, actorId, fetchImpl, viewport = DEFAULT_VIEWPORT) {
  const encoded = encodeURIComponent(shardId);
  const [shards, planets, ownMemberships, ownParties] = await Promise.all([
    restRows(config, 'world_shards', `select=id,name,status,simulation_tick,ruleset_version,revision&id=eq.${encoded}&limit=1`, fetchImpl),
    restRows(config, 'world_planets', `select=id,system_id,shard_id,key,name,status,revision&shard_id=eq.${encoded}&limit=1`, fetchImpl),
    restRows(config, 'social_party_members', `select=party_id,user_id,role&user_id=eq.${encodeURIComponent(actorId)}`, fetchImpl),
    restRows(config, 'world_parties', `select=${PARTY_SELECT}&shard_id=eq.${encoded}&owner_user_id=eq.${encodeURIComponent(actorId)}`, fetchImpl),
  ]);
  const planet = planets[0] || null;
  if (!planet) return { shard: shards[0], planet: null, factions: [], manifest: null, regions: [], parties: ownParties, ownParties, locations: [], routes: [], markets: [], scoutingReports: [], armies: [], sieges: [], pursuits: [], supplies: [], cargo: [], caravans: [], raids: [], encounters: [], engagements: [], socialParty: null };
  const [factions, manifest] = await Promise.all([
    restRows(config, 'world_factions', `select=id,planet_id,name,kind,status,revision&planet_id=eq.${encodeURIComponent(planet.id)}`, fetchImpl),
    rpcJson(config, 'living_world_projection_manifest', { p_planet: planet.id }, fetchImpl),
  ]);
  const topology = sanitizeWorldTopology(manifest, viewport);
  const provinceIds = (topology?.provinces || []).map((row) => row.id);
  const [provinces, viewportParties, locations, reports] = await Promise.all([
    provinceIds.length ? restRows(config, 'world_provinces', `select=id,planet_id,key,name,bounds,owner_faction_id,claimed_by_faction_id,control_strength,garrison_strength,unrest,control_state,siege_state,revision&id=in.${inIds(provinceIds)}`, fetchImpl) : Promise.resolve([]),
    provinceIds.length ? restRows(config, 'world_parties', `select=${PARTY_SELECT}&region_id=in.${inIds(provinceIds)}`, fetchImpl) : Promise.resolve([]),
    provinceIds.length ? restRows(config, 'world_locations', `select=id,province_id,key,name,kind,position,owner_faction_id,claimed_by_faction_id,control_strength,garrison_strength,unrest,control_state,siege_state,services,revision&province_id=in.${inIds(provinceIds)}`, fetchImpl) : Promise.resolve([]),
    ownParties.length ? restRows(config, 'world_scouting_reports', `select=observer_party_id,subject_party_id,location_id,observed_tick,expires_tick,accuracy,intelligence&observer_party_id=in.${inIds(ownParties)}`, fetchImpl) : Promise.resolve([]),
  ]);
  let socialParty = null;
  let memberParties = [];
  if (ownMemberships[0]) {
    const partyId = ownMemberships[0].party_id;
    const [socialParties, members] = await Promise.all([
      restRows(config, 'social_parties', `select=id,leader_user_id,name,status,revision&id=eq.${partyId}&limit=1`, fetchImpl),
      restRows(config, 'social_party_members', `select=party_id,user_id,role&party_id=eq.${partyId}`, fetchImpl),
    ]);
    const memberIds = members.map((member) => member.user_id);
    memberParties = memberIds.length ? await restRows(config, 'world_parties', `select=${PARTY_SELECT}&shard_id=eq.${encoded}&owner_user_id=in.(${memberIds.join(',')})`, fetchImpl) : [];
    socialParty = { ...socialParties[0], members: members.map((member) => ({ ...member, worldParty: memberParties.find((party) => party.owner_user_id === member.user_id) || null })) };
  }
  const parties = mergeById(ownParties, memberParties, viewportParties);
  const partyIds = parties.map((row) => row.id), ownPartyIds = ownParties.map((row) => row.id), locationIds = locations.map((row) => row.id);
  const [routes, markets, armies, sieges, supplies, cargo, caravans, raids, encounters, pursuits] = await Promise.all([
    provinceIds.length ? restRows(config, 'world_routes', `select=id,province_id,origin_id,destination_id,origin_region_id,destination_region_id,distance,terrain,danger,owner_faction_id,claimed_by_faction_id,control_strength,control_state,blockade_state,revision&or=(origin_region_id.in.${inIds(provinceIds)},destination_region_id.in.${inIds(provinceIds)})`, fetchImpl) : Promise.resolve([]),
    locations.length ? restRows(config, 'world_markets', `select=location_id,commodity_key,stock,buy_price,sell_price,revision&location_id=in.(${locations.map((row) => row.id).join(',')})`, fetchImpl) : [],
    partyIds.length ? restRows(config, 'world_armies', `select=party_id,combat_power&party_id=in.${inIds(partyIds)}`, fetchImpl) : Promise.resolve([]),
    provinceIds.length ? restRows(config, 'world_sieges', `select=id,region_id,location_id,attacker_party_id,attacker_faction_id,defender_faction_id,status,progress,started_tick,revision&region_id=in.${inIds(provinceIds)}&status=in.(preparing,active,breached)`, fetchImpl) : Promise.resolve([]),
    ownPartyIds.length ? restRows(config, 'world_supplies', `select=party_id,supply_key,quantity,consumption_per_tick,revision&party_id=in.${inIds(ownPartyIds)}`, fetchImpl) : Promise.resolve([]),
    ownPartyIds.length ? restRows(config, 'world_cargo', `select=party_id,commodity_key,quantity,reserved_quantity,revision&party_id=in.${inIds(ownPartyIds)}`, fetchImpl) : Promise.resolve([]),
    partyIds.length ? restRows(config, 'world_caravan_plans', `select=id,party_id,origin_location_id,destination_location_id,commodity_key,target_quantity,state,revision&party_id=in.${inIds(partyIds)}`, fetchImpl) : Promise.resolve([]),
    ownPartyIds.length ? restRows(config, 'world_raid_orders', `select=id,attacker_party_id,target_party_id,resolve_tick,state,result&or=(attacker_party_id.in.${inIds(ownPartyIds)},target_party_id.in.${inIds(ownPartyIds)})`, fetchImpl) : Promise.resolve([]),
    ownPartyIds.length ? restRows(config, 'world_encounters', `select=id,attacker_party_id,defender_party_id,created_tick,state,attacker_choice,defender_choice,terrain,scouting_snapshot,revision&shard_id=eq.${encoded}&or=(attacker_party_id.in.${inIds(ownPartyIds)},defender_party_id.in.${inIds(ownPartyIds)})&state=in.(choosing,negotiating,battle,rearguard,awaiting_allies)`, fetchImpl) : Promise.resolve([]),
    partyIds.length ? restRows(config, 'world_pursuits', `select=id,pursuer_party_id,target_party_id,started_tick,state,result,revision&shard_id=eq.${encoded}&or=(pursuer_party_id.in.${inIds(partyIds)},target_party_id.in.${inIds(partyIds)})&state=eq.active`, fetchImpl) : Promise.resolve([]),
  ]);
  const engagements = encounters.length ? await restRows(config, 'world_engagements', `select=id,encounter_id,mode,state,current_round,started_tick,revision&encounter_id=in.${inIds(encounters)}&state=in.(active,retreat)`, fetchImpl) : [];
  return { shard: shards[0], planet, factions, manifest, regions: provinces, parties, armies, sieges, pursuits, socialParty, scoutingReports: reports, supplies, cargo, caravans, raids, encounters, engagements, locations, routes, markets };
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
        await enforceLivingWorldRateLimit({ config, actor: user.id, scope: 'world:projection', limit: 240, fetchImpl, override: deps.rateLimit });
        const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`), shardId = text(url.searchParams.get('shardId'));
        if (!IDENTIFIER.test(shardId)) return send(res, 400, { ok: false, error: 'invalid_shard_id' });
        const viewport = parseViewport(url.searchParams);
        const snapshot = deps.loadSnapshot ? await deps.loadSnapshot(shardId, user.id, viewport) : await loadSnapshot(config, shardId, user.id, fetchImpl, viewport);
        return send(res, 200, filterProjection(snapshot, user.id, viewport));
      }
      const command = validateCommandBody(await parseBody(req));
      await enforceLivingWorldRateLimit({ config, actor: user.id, scope: 'world:command', limit: 120, fetchImpl, override: deps.rateLimit });
      const rpcName = command.type === 'trade_market' ? 'living_world_trade_market' : 'living_world_command';
      const rpcBody = command.type === 'trade_market'
        ? { p_actor: user.id, p_request_id: command.requestId, p_party: command.partyId, p_expected_revision: command.expectedRevision, p_payload: command.payload }
        : { p_actor: user.id, p_shard: command.shardId, p_request_id: command.requestId, p_type: command.type, p_party: command.partyId, p_expected_revision: command.expectedRevision, p_payload: command.payload };
      const rpc = deps.command ? await deps.command(user.id, command) : await fetchImpl(`${config.url}/rest/v1/rpc/${rpcName}`, { method: 'POST', headers: { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, 'content-type': 'application/json' }, body: JSON.stringify(rpcBody) });
      const result = deps.command ? rpc : await rpc.json().catch(() => null);
      if (!deps.command && !rpc.ok) return send(res, rpc.status === 409 ? 409 : 400, { ok: false, error: result?.message || 'living_world_command_failed' });
      return send(res, 200, result);
    } catch (error) { return send(res, error?.status || 500, { ok: false, error: error?.message || 'living_world_backend_error' }); }
  };
}
export default createLivingWorldHandler();
import { enforceLivingWorldRateLimit } from './living-world-rate-limit.js';
