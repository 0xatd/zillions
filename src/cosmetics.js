// Free-by-default appearance catalogue. Renderer recipes are data, so the
// creator, paper doll and live 3D model can consume the same concrete family.
import { APPEARANCES, CREATOR_PARTS, MMO_RACES } from './mmo-characters.js';

const recipe = (primitive, variant, scale = [1, 1, 1], material = 'primary') =>
  Object.freeze({ primitive, variant, scale, material });

export const COSMETIC_RENDERERS = Object.freeze({
  human: Object.freeze({
    face: Object.freeze({ sentinel: recipe('face', 'sentinel'), ranger: recipe('face', 'ranger'), veteran: recipe('face', 'veteran'), nomad: recipe('face', 'nomad') }),
    body: Object.freeze({ light: recipe('torso', 'field-light', [.9, 1, .88]), standard: recipe('torso', 'field-standard'), heavy: recipe('torso', 'field-heavy', [1.22, 1, 1.12]) }),
    head: Object.freeze({ cropped: recipe('hair', 'cropped', [1, .65, 1], 'hair'), swept: recipe('hair', 'swept', [1.08, .85, 1], 'hair'), shaved: recipe('scalp', 'shaved', [1, .25, 1], 'skin'), hooded: recipe('hood', 'hooded', [1.08, 1.1, 1.05], 'cloth') }),
    legs: Object.freeze({ field: recipe('legs', 'field'), armored: recipe('legs', 'armored', [1.12, 1, 1.08]), scout: recipe('legs', 'scout', [.94, 1.05, .92]) }),
  }),
  robot: Object.freeze({
    face: Object.freeze({ optic: recipe('sensor', 'optic', [1, 1, 1], 'emissive'), visor: recipe('sensor', 'visor', [1.25, .75, 1], 'emissive'), 'tri-eye': recipe('sensor', 'tri-eye', [1, 1, 1], 'emissive'), faceless: recipe('faceplate', 'faceless', [1.04, 1, 1], 'shell') }),
    body: Object.freeze({ strider: recipe('chassis', 'strider', [.9, 1.05, .88]), warden: recipe('chassis', 'warden'), bulwark: recipe('chassis', 'bulwark', [1.25, 1, 1.14]) }),
    head: Object.freeze({ dish: recipe('antenna', 'dish', [1, 1, 1], 'metal'), crest: recipe('antenna', 'crest', [1, 1, 1], 'trim'), antenna: recipe('antenna', 'whip', [1, 1, 1], 'metal'), smooth: recipe('cowl', 'smooth', [1.04, .85, 1.02], 'shell') }),
    legs: Object.freeze({ biped: recipe('legs', 'biped'), 'reverse-joint': recipe('legs', 'reverse-joint', [.95, 1.08, .95]), heavy: recipe('legs', 'heavy-piston', [1.18, 1, 1.12]) }),
  }),
});

export const COSMETIC_CATALOGUE = Object.freeze([
  ...Object.keys(MMO_RACES).flatMap((race) => Object.entries(CREATOR_PARTS[race]).flatMap(([slot, values]) =>
    values.map((family) => Object.freeze({
      id: `${race}.${slot}.${family}`, race, slot, family, name: family.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      entitlement: 'free', renderer: COSMETIC_RENDERERS[race][slot][family],
    })))),
  ...Object.entries(APPEARANCES).map(([family, value]) => Object.freeze({
    id: `shared.color.${family}`, race: 'shared', slot: 'color', family, name: value.name,
    entitlement: 'free', renderer: Object.freeze({ primitive: 'material', variant: 'primary', color: value.color }),
  })),
]);

export function cosmeticsForRace(race = 'human') {
  const safeRace = MMO_RACES[race] ? race : 'human';
  return COSMETIC_CATALOGUE.filter((entry) => entry.race === safeRace || entry.race === 'shared');
}

export function cosmeticEligibility(cosmeticId, race = 'human', owned = []) {
  const cosmetic = COSMETIC_CATALOGUE.find((entry) => entry.id === cosmeticId);
  if (!cosmetic) return { ok: false, reason: 'unknown_cosmetic' };
  if (cosmetic.race !== 'shared' && cosmetic.race !== race) return { ok: false, reason: 'race' };
  if (cosmetic.entitlement === 'free' || owned.includes(cosmetic.id)) return { ok: true, cosmetic };
  return { ok: false, reason: 'entitlement' };
}

export function validateCosmeticCatalogue() {
  const errors = [];
  const ids = new Set();
  for (const cosmetic of COSMETIC_CATALOGUE) {
    if (ids.has(cosmetic.id)) errors.push(`duplicate:${cosmetic.id}`);
    ids.add(cosmetic.id);
    if (!cosmetic.renderer?.primitive || !cosmetic.renderer?.variant) errors.push(`renderer:${cosmetic.id}`);
  }
  for (const race of Object.keys(MMO_RACES)) for (const [slot, values] of Object.entries(CREATOR_PARTS[race])) {
    for (const family of values) if (!COSMETIC_RENDERERS[race]?.[slot]?.[family]) errors.push(`mapping:${race}.${slot}.${family}`);
  }
  return { ok: errors.length === 0, errors };
}
