// Survey stakes: the only mark on an empty build spot. Ankle-to-knee on the
// hero, culture-tinted, no pad and no ring. Presentation only.
import * as THREE from 'three';
import { toyMat } from './toy-style.js';

function post(g, color, r, h, x, z, segs = 5) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r, h, segs), toyMat({ color }));
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  m.userData.noOutline = true;
  g.add(m);
  return m;
}

function tip(g, geo, mat, y) {
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.userData.noOutline = true;
  m.userData.stakeTip = true;
  g.add(m);
  return m;
}

// A cut stump. Empty plots read as a bit of wood, not a glass marker.
export function makeSurveyStake(culture = 'european', spread = 0) {
  const g = new THREE.Group();
  g.name = 'survey-stake';
  const wood = culture === 'south_american' ? 0x8a6240 : culture === 'middle_eastern' ? 0xa07848 : 0x6b4e32;
  const cut = culture === 'asian' ? 0xc4a574 : 0x8a6848;
  const spots = spread > 0 ? [[-spread, -spread], [spread, -spread], [-spread, spread], [spread, spread]] : [[0, 0]];
  for (const [x, z] of spots) {
    post(g, wood, 0.12, 0.18, x, z, 7);
    const top = tip(g, new THREE.CylinderGeometry(0.1, 0.11, 0.04, 7), toyMat({ color: cut }), 0.2);
    top.position.set(x, 0.2, z);
  }
  return g;
}

// Shared hologram: faint cyan, a slow scanline, no depth write so it can sit
// on the building it previews.
export function hologramMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.34 },
    },
    vertexShader: `
      varying float vY;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vY = world.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      varying float vY;
      void main() {
        float scan = 0.58 + 0.42 * sin(vY * 16.0 - uTime * 2.2);
        float flicker = 0.86 + 0.14 * sin(uTime * 4.6);
        gl_FragColor = vec4(0.78, 0.94, 1.0, uOpacity * scan * flicker);
      }
    `,
  });
}
