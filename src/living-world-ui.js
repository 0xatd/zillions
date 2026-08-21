const EMPTY_WORLD = {
  world: { id: 'unknown', name: 'World map', region: 'Awaiting world intelligence', time: '—' },
  party: { id: null, members: [] }, factions: [], regions: [], settlements: [], routes: [], parties: [], missions: [],
  topology: { projection: 'earth-equirectangular-v1', size: { width: 100, height: 100 }, landmasses: [], provinces: [] },
  viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100, zoom: 1, truncated: false }, sieges: [], pursuits: [], hotspots: [],
  logistics: { supplies: [], cargo: [], caravans: [], raids: [] },
  company: null, encounters: [], governance: null,
};
const coord = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const point = (value) => [coord(value?.[0]), coord(value?.[1])];
const owner = (value) => ['free', 'hive', 'neutral'].includes(value) ? value : 'neutral';
const routeState = (value) => value === 'contested' ? 'contested' : 'safe';

export function livingWorldViewport(view = {}, dimensions = {}) {
  const zoom = Math.max(1, Math.min(4, Number(view.zoom) || 1));
  const stageWidth = Math.max(1, Number(dimensions.width) || 1000), stageHeight = Math.max(1, Number(dimensions.height) || 600);
  const width = 100 / zoom, height = width * Math.max(.35, Math.min(1, stageHeight / stageWidth));
  const centerX = 50 - ((Number(view.x) || 0) / stageWidth) * width;
  const centerY = 50 - ((Number(view.y) || 0) / stageHeight) * height;
  const minX = Math.max(0, Math.min(100 - width, centerX - width / 2));
  const minY = Math.max(0, Math.min(100 - height, centerY - height / 2));
  return { minX, minY, maxX: minX + width, maxY: minY + height, zoom };
}

export function clusterLivingWorldParties(parties = [], zoom = 1) {
  if (zoom >= 2.2) return parties.map((party) => ({ ...party, count: 1 }));
  const cell = zoom < 1.4 ? 7 : 4, clusters = new Map();
  for (const party of parties) {
    const key = `${Math.floor(party.x / cell)}:${Math.floor(party.y / cell)}:${party.owner}`;
    const current = clusters.get(key);
    if (!current) clusters.set(key, { ...party, strength: Number(party.strength) || 0, count: 1, members: [party.id] });
    else { current.count += 1; current.strength += Number(party.strength) || 0; current.x = (current.x * (current.count - 1) + party.x) / current.count; current.y = (current.y * (current.count - 1) + party.y) / current.count; current.members.push(party.id); }
  }
  return [...clusters.values()];
}

export const livingWorldRouteLine = (route) => `<line x1="${Number(route.from?.[0]) || 0}" y1="${Number(route.from?.[1]) || 0}" x2="${Number(route.to?.[0]) || 0}" y2="${Number(route.to?.[1]) || 0}" class="${route.state === 'contested' ? 'contested' : 'safe'}" marker-end="url(#lw-route-arrow)"/>`;
export function livingWorldReadyStatus(state = {}) {
  const truncated = Object.values(state.viewport?.truncated || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return truncated ? `Dense front: ${truncated} more objects; zoom in for detail.` : `${state.parties?.length || 0} visible parties · ${state.settlements?.length || 0} known settlements`;
}

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
    hotspots: (value.hotspots || fallback.hotspots).map((entry) => ({ ...entry, id: String(entry.id || ''), x: coord(entry.x), y: coord(entry.y) })),
  };
};
