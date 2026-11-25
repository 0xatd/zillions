// Presentation contracts: culture chooses construction; biome chooses ecology.
// Ecology is presentation-only. Culture layout dimensions are versioned
// simulation inputs when consumed by the fortress placement solver.
const freeze = value => { for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item); return Object.freeze(value); };
export const BIOME_KITS = freeze({
  moor: { name:'Temperate frontier', trees:{density:.48,conifers:.24,height:1.0,understory:.24}, cliffs:{lift:.62,relief:.34,tint:0x929481}, roads:{dust:0x8b938b}, rocks:{height:1.0}, reeds:.3 },
  fen: { name:'Wetland', trees:{density:.50,conifers:.04,height:.86,understory:.34}, cliffs:{lift:.35,relief:.16,tint:0x777f66}, roads:{dust:0x747b62}, rocks:{height:.72}, reeds:.52 },
  wastes: { name:'Volcanic', trees:{density:.28,conifers:.08,height:.70,understory:.04}, cliffs:{lift:.78,relief:.42,tint:0x756657}, roads:{dust:0x9b8068}, rocks:{height:1.3}, reeds:0 },
  hills: { name:'Frozen highland', trees:{density:.38,conifers:1,height:1.14,understory:.08}, cliffs:{lift:.42,relief:.22,tint:0xb8c8cf}, roads:{dust:0x9eafb7}, rocks:{height:1.08}, reeds:0 },
  vale: { name:'Rift country', trees:{density:.44,conifers:.50,height:1.10,understory:.17}, cliffs:{lift:.72,relief:.40,tint:0x7b8585}, roads:{dust:0x85897d}, rocks:{height:1.15}, reeds:.18 },
});
export const CULTURE_KITS = freeze({
  european: {name:'Expedition', roads:{edge:0x344750,surface:0x6f8186}, architecture:{hull:0xc3c9c5,frame:0x34454e,signal:0x86d9dc}, layout:{courtWidth:8,avenueWidth:3,laneWidth:2}},
  asian: {name:'Eastern', roads:{edge:0x68615a,surface:0xb8ada0}, architecture:{hull:0xd5c9ab,frame:0x51443c,signal:0xe8ae58}, layout:{courtWidth:6,avenueWidth:3,laneWidth:2}},
  south_american: {name:'Terraced', roads:{edge:0x6f6855,surface:0xb2a887}, architecture:{hull:0xcbb786,frame:0x514c40,signal:0x91c8ac}, layout:{courtWidth:6,avenueWidth:3,laneWidth:2}},
  middle_eastern: {name:'Desert', roads:{edge:0x887458,surface:0xc9b58e}, architecture:{hull:0xd7c49a,frame:0x655341,signal:0x7acbc5}, layout:{courtWidth:6,avenueWidth:3,laneWidth:2}},
});
export function biomeKit(mapOrKind) {
  const key=typeof mapOrKind==='string'?mapOrKind:mapOrKind?.terrainKind||mapOrKind?.theme?.terrain;
  return BIOME_KITS[key]||BIOME_KITS.moor;
}
export function cultureKit(key='european') { return CULTURE_KITS[key]||CULTURE_KITS.european; }
