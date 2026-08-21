const API = '/api/living-world';
const PARTY_API = '/api/living-world-party';
let session = null;
export function setLivingWorldSession(nextSession) { session = nextSession || null; }
const headers = (extra = {}) => ({ ...extra, ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}) });
export async function getLivingWorldProjection(shardId) {
  if (!session?.access_token) return null;
  const response = await fetch(`${API}?${new URLSearchParams({ shardId })}`, { headers: headers({ accept: 'application/json' }), cache: 'no-store' });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'living_world_projection_failed'), { status: response.status, result });
  return result;
}
export async function sendLivingWorldCommand(command) {
  if (!session?.access_token) return null;
  const response = await fetch(API, { method: 'POST', headers: headers({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(command) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'living_world_command_failed'), { status: response.status, result });
  return result;
}
export async function getLivingWorldParty() {
  if (!session?.access_token) return null;
  const response = await fetch(PARTY_API, { headers: headers({ accept: 'application/json' }), cache: 'no-store' });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'party_projection_failed'), { status: response.status, result });
  return result.party;
}
export async function sendLivingWorldPartyCommand(command) {
  if (!session?.access_token) return null;
  const response = await fetch(PARTY_API, { method: 'POST', headers: headers({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(command) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'party_command_failed'), { status: response.status, result });
  return result;
}

const point = (position = {}) => [Number(position.x) || 0, Number(position.y ?? position.z) || 0];
const factionOwner = (party, ownIds, ownFactions) => ownIds.has(party.id) ? 'free'
  : ownFactions.has(party.owner_faction_id) ? 'free'
  : party.owner_faction_id ? 'hive' : 'neutral';

// Convert the filtered server projection into the UI contract. This function
// never invents world state. Missing authority data remains missing.
export function livingWorldProjectionToUi(projection = {}, self = {}, socialParty = null) {
  const locations = projection.locations || [];
  const byLocation = new Map(locations.map((location) => [location.id, location]));
  const own = projection.ownParties || [];
  const ownIds = new Set(own.map((party) => party.id));
  const ownFactions = new Set(own.map((party) => party.owner_faction_id).filter(Boolean));
  const routeById = new Map((projection.routes || []).map((route) => [route.id, route]));
  const partyPosition = (party) => {
    if (party.location_id && byLocation.has(party.location_id)) return point(byLocation.get(party.location_id).position);
    const route = routeById.get(party.route_id);
    if (!route) return [0, 0];
    const from = point(byLocation.get(route.origin_id)?.position);
    const to = point(byLocation.get(route.destination_id)?.position);
    const progress = Math.max(0, Math.min(1, Number(party.route_progress) || 0));
    return [from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress];
  };
  const primary = own[0] || null;
  const factionById = new Map((projection.factions || []).map((faction) => [faction.id, faction]));
  const regionById = new Map((projection.regions || []).map((region) => [region.id, region]));
  const relation = (factionId) => ownFactions.has(factionId) ? 'free' : factionId ? 'hive' : 'neutral';
  const memberRows = projection.socialParty?.members || [];
  const memberForParty = (worldParty) => {
    const location = byLocation.get(worldParty?.location_id);
    const region = regionById.get(worldParty?.region_id);
    return {
      id: worldParty?.owner_user_id || 'unknown', name: worldParty?.name || 'Party member',
      className: worldParty?.kind === 'player' ? 'Commander' : (worldParty?.kind || 'Member'), health: 100,
      status: worldParty?.stance || 'Unavailable', location: location?.name || region?.name || (worldParty?.route_id ? 'Travelling' : 'Unknown'),
      regionId: worldParty?.region_id || null, locationId: worldParty?.location_id || null,
      self: worldParty?.owner_user_id === primary?.owner_user_id,
    };
  };
  const socialMembers = memberRows.map((member) => memberForParty(member.worldParty || { owner_user_id: member.user_id, name: member.role }));
  const suppliedMembers = socialParty?.members?.length ? socialParty.members.map((member) => ({
    ...member,
    className: member.className || member.role || 'Member',
    self: member.id === self.userId,
  })) : [];
  const primaryMembers = suppliedMembers.length ? suppliedMembers : socialMembers.length ? socialMembers : primary ? [{
    id: self.id || 'self', name: self.name || primary.name || 'Commander',
    className: self.className || 'Commander', health: Number(self.health ?? 100),
    status: primary.stance || 'Ready', location: byLocation.get(primary.location_id)?.name || (primary.route_id ? 'Travelling' : 'Unknown'),
    regionId: primary.region_id || null, locationId: primary.location_id || null, self: true,
  }] : [];
  return {
    world: {
      id: projection.shard?.id || 'unknown',
      name: projection.planet?.name || projection.shard?.name || 'World map',
      region: regionById.get(primary?.region_id)?.name || (locations.length ? 'Known territory' : 'Awaiting world intelligence'),
      time: projection.shard ? `Tick ${Number(projection.shard.simulation_tick) || 0}` : '—',
      revision: Number(projection.shard?.revision) || 0,
    },
    party: {
      id: primary?.id || null,
      revision: Number(primary?.revision) || 0,
      locationId: primary?.location_id || null,
      regionId: primary?.region_id || null,
      routeId: primary?.route_id || null,
      members: primaryMembers,
      name: socialParty?.name || projection.socialParty?.name || null,
      socialPartyId: socialParty?.id || projection.socialParty?.id || null,
      socialRevision: Number(socialParty?.revision ?? projection.socialParty?.revision) || 0,
      leaderUserId: socialParty?.leaderUserId || projection.socialParty?.leader_user_id || null,
      invites: socialParty?.invites || [],
      pendingInvites: socialParty?.pendingInvites || [],
    },
    factions: (projection.factions || []).map((faction) => ({ id: faction.id, name: faction.name, kind: faction.kind, relation: relation(faction.id) })),
    regions: (projection.regions || []).map((region) => ({
      id: region.id, name: region.name, ownerFactionId: region.owner_faction_id || null,
      ownerName: factionById.get(region.owner_faction_id)?.name || 'Unclaimed', owner: relation(region.owner_faction_id),
      controlState: region.control_state || 'unclaimed', controlStrength: Number(region.control_strength) || 0,
      garrison: Number(region.garrison_strength) || 0, unrest: Number(region.unrest) || 0,
      current: region.id === primary?.region_id,
    })),
    settlements: locations.map((location) => {
      const [x, y] = point(location.position);
      const directRoute = (projection.routes || []).find((route) => route.origin_id === primary?.location_id && route.destination_id === location.id);
      const validRoute = directRoute && directRoute.control_state !== 'blocked' && !directRoute.blockade_state?.active;
      const safeRoute = validRoute && Number(directRoute.danger) < 0.5;
      const fastTravel = Boolean(directRoute && safeRoute && location.services?.fastTravel === true && location.services?.fastTravelUnlocked !== false);
      return { id: location.id, regionId: location.province_id, name: location.name, kind: location.kind,
        ownerFactionId: location.owner_faction_id || null, ownerName: factionById.get(location.owner_faction_id)?.name || 'Unclaimed',
        owner: relation(location.owner_faction_id), controlState: location.control_state || 'unclaimed',
        x, y, known: true, routeId: directRoute?.id || null, reachable: Boolean(validRoute),
        crossRegion: Boolean(directRoute && directRoute.origin_region_id !== directRoute.destination_region_id), fastTravel };
    }),
    routes: (projection.routes || []).map((route) => ({ id: route.id, originId: route.origin_id, destinationId: route.destination_id,
      originRegionId: route.origin_region_id, destinationRegionId: route.destination_region_id,
      from: point(byLocation.get(route.origin_id)?.position), to: point(byLocation.get(route.destination_id)?.position),
      state: route.control_state === 'blocked' || route.control_state === 'contested' || Number(route.danger) >= 0.5 ? 'contested' : 'safe',
      crossRegion: route.origin_region_id !== route.destination_region_id })),
    parties: (projection.parties || []).filter((party) => !ownIds.has(party.id)).map((party) => {
      const [x, y] = partyPosition(party);
      return { id: party.id, name: party.name || 'Unknown force', owner: factionOwner(party, ownIds, ownFactions), strength: Number(party.intelligence?.estimate || 0), x, y, intent: party.stance || 'Unknown' };
    }),
    missions: [],
    markets: projection.markets || [],
    logistics: projection.logistics || { supplies: [], cargo: [], caravans: [], raids: [] },
    raw: projection,
  };
}
