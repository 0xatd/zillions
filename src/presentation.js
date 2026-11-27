// Presentation materials and image-based lighting. Nothing here is read by
// the simulation. Low keeps a Lambert stand-in so the fast path stays fast.
// Medium and High keep the GLB's MeshStandard / MeshPhysical materials,
// including roughness, metalness, clearcoat, normal, ORM and emissive maps.
import * as THREE from 'three';

const LAMBERT = new WeakMap();
const SRGB_MAPS = ['map', 'emissiveMap'];
const DATA_MAPS = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap'];

export function isPbrMaterial(material) {
  return !!(material && (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial));
}

function colorSpace(texture, space) {
  if (texture && texture.isTexture && texture.colorSpace !== space) texture.colorSpace = space;
}

// glTF already tags most maps. This catches anything a loader left linear.
export function configurePbrMaterial(material) {
  if (!isPbrMaterial(material) || material.userData.presentationConfigured) return material;
  for (const key of SRGB_MAPS) colorSpace(material[key], THREE.SRGBColorSpace);
  for (const key of DATA_MAPS) colorSpace(material[key], THREE.LinearSRGBColorSpace);
  if (material.envMapIntensity === 1) material.envMapIntensity = 0.58;
  material.userData.presentationConfigured = true;
  material.userData.pbr = true;
  return material;
}

function syncSurface(from, to) {
  if (!from || !to) return;
  if (from.color && to.color) to.color.copy(from.color);
  if (from.emissive && to.emissive) to.emissive.copy(from.emissive);
  if (to.emissiveIntensity !== undefined && from.emissiveIntensity !== undefined) {
    to.emissiveIntensity = from.emissiveIntensity;
  }
  to.opacity = from.opacity;
  to.transparent = from.transparent;
  to.depthWrite = from.depthWrite;
}

function lambertStandIn(source) {
  let stand = LAMBERT.get(source);
  if (!stand) {
    stand = new THREE.MeshLambertMaterial({
      name: source.name,
      color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
      map: source.map || null,
      emissive: source.emissive ? source.emissive.clone() : new THREE.Color(0x000000),
      emissiveMap: source.emissiveMap || null,
      emissiveIntensity: source.emissiveIntensity || 0,
      vertexColors: !!source.vertexColors,
      flatShading: !!source.flatShading,
      transparent: !!source.transparent,
      opacity: source.opacity,
      alphaTest: source.alphaTest || 0,
      side: source.side,
      depthWrite: source.depthWrite !== false,
      depthTest: source.depthTest !== false,
    });
    stand.userData.pbrSource = source;
    stand.userData.presentationStandIn = true;
    if (source.userData.kitShared) stand.userData.kitShared = true;
    LAMBERT.set(source, stand);
  }
  syncSurface(source, stand);
  return stand;
}

// `pbr` false is the Low preset: swap Standard/Physical for the stand-in.
// The original material stays on userData so Medium/High can put it back.
export function dressMaterial(material, pbr) {
  if (!material || material.isShaderMaterial || material.userData.ink) return material;
  if (!pbr) {
    if (material.userData.presentationStandIn) {
      if (material.userData.pbrSource) syncSurface(material.userData.pbrSource, material);
      return material;
    }
    if (!isPbrMaterial(material)) return material;
    return lambertStandIn(material);
  }
  if (material.userData.pbrSource) {
    syncSurface(material, material.userData.pbrSource);
    configurePbrMaterial(material.userData.pbrSource);
    return material.userData.pbrSource;
  }
  if (isPbrMaterial(material)) configurePbrMaterial(material);
  return material;
}

export function dressObject(root, pbr) {
  if (!root) return;
  root.traverse((node) => {
    if (!node.isMesh || node.userData.ink || !node.material) return;
    if (Array.isArray(node.material)) node.material = node.material.map((m) => dressMaterial(m, pbr));
    else node.material = dressMaterial(node.material, pbr);
  });
}

// A small room, not an HDR file: warm key panel, cool fill, ground bounce.
// PMREM folds it into the specular IBL MeshStandard materials sample.
export function createRoomEnvironment(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.BoxGeometry();
  geo.deleteAttribute('uv');
  const add = (color, position, scale, emissive = null, intensity = 0, side = THREE.FrontSide) => {
    const material = new THREE.MeshStandardMaterial({
      color, roughness: 1, metalness: 0, side,
      emissive: emissive || 0x000000, emissiveIntensity: intensity,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    scene.add(mesh);
    return material;
  };
  const mats = [
    add(0x8e98a6, [0, 0.4, 0], [10, 7, 10], null, 0, THREE.BackSide),
    add(0xffe2b4, [2.4, 2.2, 1.4], [3.2, 2.6, 0.2], 0xffd7a2, 3.2),
    add(0x9ec6ea, [-2.6, 1.4, -1.8], [0.2, 2.4, 3.2], 0x8eb6dc, 1.4),
    add(0x6a6156, [0, -3.2, 0], [8, 0.2, 8]),
  ];
  const pmrem = new THREE.PMREMGenerator(renderer);
  const previous = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  let target;
  try {
    target = pmrem.fromScene(scene, 0.04);
  } finally {
    renderer.toneMapping = previous;
    pmrem.dispose();
  }
  geo.dispose();
  for (const material of mats) material.dispose();
  return target.texture;
}

export function applyColorPipeline(renderer, preset) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const agx = preset?.toneMapping === 'agx';
  renderer.toneMapping = agx ? THREE.AgXToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = agx ? 1.08 : 1;
  if (preset?.shadows) {
    renderer.shadowMap.type = preset.shadowType === 'pcfsoft'
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;
    renderer.shadowMap.needsUpdate = true;
  }
}

// High follows the action with a tighter orthographic shadow so the texels
// land on the fight. Medium keeps the wider net the preset already shipped.
export function shadowSpanFor(preset, camDist) {
  const dist = Number(camDist) || 46;
  if (preset?.tier === 'high') return Math.max(16, Math.min(40, dist * 0.5));
  return Math.max(26, Math.min(74, dist * 0.85));
}
