import { manifestHash } from './world-manifest.js';
export function buildWorldMaterialization(manifest){const bundle=structuredClone(manifest.materialization);bundle.manifestHash=manifest.contentHash;bundle.materializationHash=manifestHash(bundle);return bundle;}
export function worldMaterializationHash(bundle){const copy={...bundle};delete copy.materializationHash;return manifestHash(copy);}
