import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from '../vendor/jsm/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from '../vendor/jsm/postprocessing/SMAAPass.js';

const QUALITY_KEY = 'zillions_graphics_quality';

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

    this.smaa = new SMAAPass(1, 1);
    this.composer.addPass(this.smaa);
    this.applyQuality(this.quality, false);
  }

  applyQuality(quality, persist = true) {
    this.quality = quality === 'low' ? 'low' : 'high';
    const high = this.quality === 'high';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 1.5 : 1));
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
    const ratio = this.renderer.getPixelRatio();
    this.composer.setSize(width, height);
    this.smaa.setSize(width * ratio, height * ratio);
  }

  render() {
    if (this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
