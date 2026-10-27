import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from '../vendor/jsm/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from '../vendor/jsm/postprocessing/Pass.js';
import { SMAAPass } from '../vendor/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

const QUALITY_KEY = 'zillions_graphics_quality';

// Toy grade: picked colours land on screen as picked. No saturation push, no
// lift, only a faint vignette — plus a split-tone that pulls the darkest
// values (shadowed faces, cast shadows) toward the map's own shadow colour,
// so every object on a map shares one shadow shade, the way a painted
// diorama does.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.0 },
    uLift: { value: 0.0 },
    uVignette: { value: 0.12 },
    uShadowCol: { value: new THREE.Color(0x1d3557) },
    uShadowAmt: { value: 0.42 },
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
    uniform vec3 uShadowCol;
    uniform float uShadowAmt;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, uSat);
      c = c + uLift * (1.0 - luma);
      // Shadow split-tone: strongest in the darks, gone by the mids.
      float dark = 1.0 - smoothstep(0.02, 0.32, luma);
      c = mix(c, uShadowCol * (0.55 + luma * 1.6), dark * uShadowAmt);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.25, dot(d, d) * 2.0);
      c *= mix(1.0, v, uVignette);
      gl_FragColor = vec4(c, texel.a);
    }`,
};

// Toy outline: a thin dark line wherever depth jumps (silhouettes) or the
// surface normal turns sharply (box edges), like an inked board-game figure.
// It renders its own normal+depth prepass of the opaque scene, then edge-
// detects in screen space and darkens the colour buffer toward the map's
// shadow colour. Transparent overlays (fog of war, rings, particles) and
// anything tagged userData.noOutline are skipped. High quality only.
const OutlineEdgeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tNormal: { value: null },
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.5 },
    uFar: { value: 600 },
    uInk: { value: new THREE.Color(0x1d3557) },
    uStrength: { value: 0.72 },
    uDepthK: { value: 0.035 },
    uNormalK: { value: 0.55 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform sampler2D tDepth;
    uniform vec2 uTexel;
    uniform float uNear;
    uniform float uFar;
    uniform vec3 uInk;
    uniform float uStrength;
    uniform float uDepthK;
    uniform float uNormalK;
    varying vec2 vUv;
    float viewZ(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return -perspectiveDepthToViewZ(d, uNear, uFar);
    }
    vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float z0 = viewZ(vUv);
      vec3 n0 = nrm(vUv);
      float dz = 0.0;
      float dn = 0.0;
      vec2 offs[4];
      offs[0] = vec2(uTexel.x, 0.0);
      offs[1] = vec2(-uTexel.x, 0.0);
      offs[2] = vec2(0.0, uTexel.y);
      offs[3] = vec2(0.0, -uTexel.y);
      for (int i = 0; i < 4; i++) {
        float z = viewZ(vUv + offs[i]);
        // Only the NEAR side of a silhouette gets inked, so lines stay 1px.
        dz = max(dz, z - z0);
        dn = max(dn, 1.0 - dot(n0, nrm(vUv + offs[i])));
      }
      float edge = max(step(uDepthK * z0, dz), step(uNormalK, dn));
      if (z0 > uFar * 0.98) edge = 0.0;
      vec3 ink = mix(base.rgb * 0.35, uInk * 0.7, 0.5);
      gl_FragColor = vec4(mix(base.rgb, ink, edge * uStrength), base.a);
    }`,
};

class ToyOutlinePass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.normalMat = new THREE.MeshNormalMaterial({ flatShading: true });
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.target.depthTexture.type = THREE.UnsignedIntType;
    this.uniforms = THREE.UniformsUtils.clone(OutlineEdgeShader.uniforms);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: OutlineEdgeShader.vertexShader,
      fragmentShader: OutlineEdgeShader.fragmentShader,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this._hidden = [];
    this._clear = new THREE.Color(0.5, 0.5, 1.0);
    this._saveClear = new THREE.Color();
  }

  setSize(w, h) {
    this.target.setSize(w, h);
    this.uniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  render(renderer, writeBuffer, readBuffer) {
    const hidden = this._hidden;
    hidden.length = 0;
    this.scene.traverseVisible((o) => {
      const m = o.material;
      if (o.isPoints || o.isSprite || o.isLine || o.userData.noOutline
        || (m && (Array.isArray(m) ? m.some((x) => x.transparent) : m.transparent))) {
        hidden.push(o);
      }
    });
    for (const o of hidden) o.visible = false;
    const bg = this.scene.background, fog = this.scene.fog, ov = this.scene.overrideMaterial;
    this.scene.background = null;
    this.scene.fog = null;
    this.scene.overrideMaterial = this.normalMat;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.getClearColor(this._saveClear);
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(this._clear, 1);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(this._saveClear, alpha);
    renderer.shadowMap.autoUpdate = shadowAuto;
    this.scene.overrideMaterial = ov;
    this.scene.background = bg;
    this.scene.fog = fog;
    for (const o of hidden) o.visible = true;

    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tNormal.value = this.target.texture;
    this.uniforms.tDepth.value = this.target.depthTexture;
    this.uniforms.uNear.value = this.camera.near;
    this.uniforms.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.normalMat.dispose();
    this.fsQuad.dispose();
  }
}

// Rim lighting was retired by the toy art pass (colour + outline do the job).
export function applyRim(mat) {
  // The toy art pass reads by colour and outline, not by fresnel glow; the
  // hook stays so callers keep working.
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

    this.ink = new ToyOutlinePass(scene, camera);
    this.composer.addPass(this.ink);

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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.22, 0.95);
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

  // Per-map shadow colour: drives the grade split-tone and the outline ink.
  setShadowColor(hex) {
    this.grade.uniforms.uShadowCol.value.setHex(hex);
    this.ink.uniforms.uInk.value.setHex(hex);
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
