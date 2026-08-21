const EMPTY_WORLD = {
  world: { id: 'unknown', name: 'World map', region: 'Awaiting world intelligence', time: '—' },
  party: { id: null, members: [] }, factions: [], regions: [], settlements: [], routes: [], parties: [], missions: [],
  topology: { projection: 'earth-equirectangular-v1', size: { width: 100, height: 100 }, landmasses: [], provinces: [] },
  viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100, zoom: 1, truncated: false }, sieges: [], pursuits: [],
  logistics: { supplies: [], cargo: [], caravans: [], raids: [] },
  company: null, encounters: [], governance: null,
};
const coord = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const point = (value) => [coord(value?.[0]), coord(value?.[1])];
const owner = (value) => ['free', 'hive', 'neutral'].includes(value) ? value : 'neutral';
const routeState = (value) => value === 'contested' ? 'contested' : 'safe';

export const normalizeLivingWorld = (value = {}) => {
  const fallback = EMPTY_WORLD;
  return {
    world: { ...fallback.world, ...(value.world || {}) },
    party: { ...fallback.party, ...(value.party || {}), members: value.party?.members || fallback.party.members },
    factions: (value.factions || fallback.factions).map((entry) => ({ ...entry, id: String(entry.id || '') })),
    topology: { ...fallback.topology, ...(value.topology || {}), landmasses: value.topology?.landmasses || [], provinces: value.topology?.provinces || [] },
    viewport: { ...fallback.viewport, ...(value.viewport || {}) },
    regions: (value.regions || fallback.regions).map((entry) => ({ ...entry, id: String(entry.id || ''), owner: owner(entry.owner), controlStrength: Math.max(0, Math.min(1, Number(entry.controlStrength) || 0)) })),
    settlements: (value.settlements || fallback.settlements).map((entry) => ({ ...entry, id: String(entry.id || ''), owner: owner(entry.owner), x: coord(entry.x), y: coord(entry.y) })),
    routes: (value.routes || fallback.routes).map((entry) => ({ ...entry, state: routeState(entry.state), from: point(entry.from), to: point(entry.to) })),
    parties: (value.parties || fallback.parties).map((entry) => ({ ...entry, id: String(entry.id || ''), owner: owner(entry.owner), x: coord(entry.x), y: coord(entry.y) })),
    missions: (value.missions || fallback.missions).map((entry) => ({ ...entry, id: String(entry.id || ''), x: coord(entry.x), y: coord(entry.y) })),
    logistics: { ...fallback.logistics, ...(value.logistics || {}) },
    company: value.company || fallback.company,
    encounters: (value.encounters || fallback.encounters).map((entry) => ({ ...entry, id: String(entry.id || '') })),
    governance: value.governance || fallback.governance,
    sieges: (value.sieges || fallback.sieges).map((entry) => ({ ...entry, x: coord(entry.x), y: coord(entry.y) })),
    pursuits: value.pursuits || fallback.pursuits,
  };
};
