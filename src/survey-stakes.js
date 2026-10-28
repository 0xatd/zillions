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

// One short marker. `spread` > 0 plants a pair of corner stakes (the keep).
export function makeSurveyStake(culture = 'european', spread = 0) {
  const g = new THREE.Group();
  g.name = 'survey-stake';
  const spots = spread > 0 ? [[-spread, -spread], [spread, -spread], [-spread, spread], [spread, spread]] : [[0, 0]];
  for (const [x, z] of spots) {
    if (culture === 'asian') {
      post(g, 0x8a5a32, 0.045, 0.3, x, z);
      tip(g, new THREE.BoxGeometry(0.09, 0.07, 0.09), new THREE.MeshBasicMaterial({ color: 0xffb45e }), 0.34).position.set(x, 0.34, z);
    } else if (culture === 'south_american') {
      post(g, 0xc4b48a, 0.07, 0.26, x, z, 4);
      const cap = tip(g, new THREE.BoxGeometry(0.12, 0.05, 0.12), toyMat({ color: 0xe7d7b0 }), 0.29);
      cap.position.set(x, 0.29, z);
    } else if (culture === 'middle_eastern') {
      post(g, 0xc9a15b, 0.032, 0.32, x, z, 6);
      const pin = tip(g, new THREE.OctahedronGeometry(0.04, 0), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }), 0.36);
      pin.position.set(x, 0.36, z);
    } else {
      post(g, 0x3a4454, 0.038, 0.28, x, z, 6);
      const light = tip(g, new THREE.OctahedronGeometry(0.04, 0), new THREE.MeshBasicMaterial({ color: 0x9af6ff }), 0.32);
      light.position.set(x, 0.32, z);
    }
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
