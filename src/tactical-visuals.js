import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from '../vendor/jsm/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from '../vendor/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

const QUALITY_KEY = 'zillions_graphics_quality';

// One gentle grade pass instead of a chain: slight saturation lift, a whisper
// of shadow lift so dark scenes stay readable on cheap panels, and a soft
// vignette that pulls the eye to the centre of the diorama where the city is.
// Everything here is display-referred and subtle on purpose — the grade must
// be felt (cohesion, mood), never seen (tint).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.07 },
    uLift: { value: 0.012 },
    uVignette: { value: 0.31 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSat;
    uniform float uLift;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, uSat);
      c = c + uLift * (1.0 - luma);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.25, dot(d, d) * 2.0);
      c *= mix(1.0, v, uVignette);
      gl_FragColor = vec4(c, texel.a);
    }`,
};

// Rim (fresnel) lighting injected into MeshLambertMaterial via
// onBeforeCompile — a soft edge glow that separates units and heroes from
// same-coloured ground, which is the single biggest readability win at
// gameplay zoom. Pure display-side: no sim state, no lockstep impact.
export function applyRim(mat, { color = 0xdfe9ff, power = 2.8, strength = 0.22 } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(color) };
    shader.uniforms.uRimPower = { value: power };
    shader.uniforms.uRimStrength = { value: strength };
    shader.vertexShader = 'varying vec3 vRimView;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n vRimView = -mvPosition.xyz;',
    );
    shader.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;\nvarying vec3 vRimView;\n'
      + shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimFace = clamp(dot(normalize(vRimView), normalize(normal)), 0.0, 1.0);
        totalEmissiveRadiance += uRimColor * pow(1.0 - rimFace, uRimPower) * uRimStrength;`,
      );
  };
  mat.customProgramCacheKey = () => `rim-${color}-${power}-${strength}`;
  return mat;
}

function initialQuality() {
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (saved === 'high' || saved === 'low') return saved;
  } catch { /* storage can be blocked */ }
  return navigator.deviceMemory && navigator.deviceMemory <= 4 ? 'low' : 'high';
}

// Renderer-only tactical feedback. This class never reads or changes simulation
// state, which keeps lockstep and save determinism isolated from visual quality.
export class TacticalVisuals {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = initialQuality();
    this.pulses = [];

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.outline = new OutlinePass(new THREE.Vector2(1, 1), scene, camera, []);
    this.outline.visibleEdgeColor.set(0xffdf72);
    this.outline.hiddenEdgeColor.set(0x7a451e);
    this.outline.edgeStrength = 4.2;
    this.outline.edgeThickness = 1.25;
    this.outline.edgeGlow = 0.45;
    this.outline.pulsePeriod = 1.8;
    this.composer.addPass(this.outline);

    // A high threshold keeps bloom on authored emissive signals instead of
    // washing the terrain in a generic glow.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.28, 0.92);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.smaa = new SMAAPass(1, 1);
    this.composer.addPass(this.smaa);
    this.composer.addPass(new OutputPass());
    this.applyQuality(this.quality, false);
  }

  applyQuality(quality, persist = true) {
    this.quality = quality === 'low' ? 'low' : 'high';
    const high = this.quality === 'high';
    const pixelRatio = Math.min(window.devicePixelRatio || 1, high ? 1.5 : 1);
    this.renderer.setPixelRatio(pixelRatio);
    this.composer.setPixelRatio(pixelRatio);
    this.renderer.shadowMap.enabled = high;
    if (persist) {
      try { localStorage.setItem(QUALITY_KEY, this.quality); } catch { /* storage can be blocked */ }
    }
    this.resize(window.innerWidth, window.innerHeight);
    return this.quality;
  }

  toggleQuality() {
    return this.applyQuality(this.quality === 'high' ? 'low' : 'high');
  }

  setSelection(objects, color = 0xffdf72) {
    this.outline.selectedObjects = this.quality === 'high' ? objects.filter(Boolean) : [];
    this.outline.visibleEdgeColor.setHex(color);
  }

  pulse(x, z, { color = 0xff493d, radius = 4, life = 1.4, width = 0.42 } = {}) {
    const geometry = new THREE.RingGeometry(Math.max(0.1, radius - width), radius, 56);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.78, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0.11, z);
    this.scene.add(mesh);
    this.pulses.push({ mesh, life, maxLife: life });
  }

  update(dt) {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i];
      pulse.life -= dt;
      const progress = 1 - Math.max(0, pulse.life) / pulse.maxLife;
      pulse.mesh.scale.setScalar(0.55 + progress * 1.15);
      pulse.mesh.material.opacity = Math.max(0, (1 - progress) * 0.78);
      if (pulse.life <= 0) {
        this.scene.remove(pulse.mesh);
        pulse.mesh.geometry.dispose();
        pulse.mesh.material.dispose();
        this.pulses.splice(i, 1);
      }
    }
  }

  resize(width, height) {
    this.composer.setSize(width, height);
  }

  render() {
    if (this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
