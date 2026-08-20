const API = '/api/living-world';
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

const point = (position = {}) => [Number(position.x) || 0, Number(position.y ?? position.z) || 0];
const factionOwner = (party, ownIds, ownFactions) => ownIds.has(party.id) ? 'free'
  : ownFactions.has(party.owner_faction_id) ? 'free'
  : party.owner_faction_id ? 'hive' : 'neutral';

// Convert the filtered server projection into the UI contract. This function
// never invents world state. Missing authority data remains missing.
export function livingWorldProjectionToUi(projection = {}, self = {}) {
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
  return {
    world: {
      id: projection.shard?.id || 'unknown',
      name: projection.shard?.name || 'World map',
      region: locations.length ? 'Known territory' : 'Awaiting world intelligence',
      time: projection.shard ? `Tick ${Number(projection.shard.simulation_tick) || 0}` : '—',
      revision: Number(projection.shard?.revision) || 0,
    },
    party: {
      id: primary?.id || null,
      revision: Number(primary?.revision) || 0,
      locationId: primary?.location_id || null,
      routeId: primary?.route_id || null,
      members: primary ? [{
        id: self.id || 'self', name: self.name || primary.name || 'Commander',
        className: self.className || 'Commander', health: Number(self.health ?? 100),
        status: primary.stance || 'Ready', location: byLocation.get(primary.location_id)?.name || (primary.route_id ? 'Travelling' : 'Unknown'), self: true,
      }] : [],
    },
    settlements: locations.map((location) => {
      const [x, y] = point(location.position);
      return { id: location.id, name: location.name, kind: location.kind, owner: ownFactions.has(location.owner_faction_id) ? 'free' : location.owner_faction_id ? 'hive' : 'neutral', x, y, known: true, fastTravel: location.services?.fastTravel === true };
    }),
    routes: (projection.routes || []).map((route) => ({ id: route.id, originId: route.origin_id, destinationId: route.destination_id, from: point(byLocation.get(route.origin_id)?.position), to: point(byLocation.get(route.destination_id)?.position), state: Number(route.danger) >= 0.5 ? 'contested' : 'safe' })),
    parties: (projection.parties || []).filter((party) => !ownIds.has(party.id)).map((party) => {
      const [x, y] = partyPosition(party);
      return { id: party.id, name: party.name || 'Unknown force', owner: factionOwner(party, ownIds, ownFactions), strength: Number(party.intelligence?.estimate || 0), x, y, intent: party.stance || 'Unknown' };
    }),
    missions: [],
    markets: projection.markets || [],
    raw: projection,
  };
}
