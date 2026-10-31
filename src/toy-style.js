// Toy style: the shared look of the Thronefall-style art pass.
//
// One rule drives everything here: a picked hex colour should land on screen
// as that colour. So every surface is a matte, flat-shaded Lambert material
// (no metal, no roughness, no texture), tone mapping is off, and depth comes
// from crisp shadows tinted with each map's own shadow colour plus a thin
// outline pass (see ToyOutlinePass in tactical-visuals.js).
//
// Presentation only. Nothing here reads or writes simulation state.
import * as THREE from 'three';

// Shared shadow hue. Every toy material mixes its unlit pixels toward this
// colour so a map has one shadow, not a grey ambient.
export const toyShadow = { value: new THREE.Color(0x1d3557) };
export function setToyShadow(hex) {
  toyShadow.value.setHex(hex);
}

const TOY_CHUNK = 'toy-shadow-fog-2';

function toyBeforeCompile(shader) {
  shader.uniforms.uToyShadow = toyShadow;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vToyWorld;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvToyWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uToyShadow;\nvarying vec3 vToyWorld;')
    .replace(
      'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
      `vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	float toyAlb = max(0.04, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
	float toyLuma = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
	float toyShade = 1.0 - smoothstep(toyAlb * 0.22, toyAlb * 0.55, toyLuma);
	float grey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
	vec3 desat = mix(vec3(grey), diffuseColor.rgb, 0.82);
	outgoingLight = mix(outgoingLight, desat * 0.62, toyShade);`,
    )
    .replace('#include <fog_fragment>', `#ifdef USE_FOG
	float distFactor = smoothstep(fogNear, fogFar, vFogDepth);
	float heightFactor = smoothstep(0.35, -0.9, vToyWorld.y) * 0.4;
	float fogFactor = clamp(max(distFactor, heightFactor), 0.0, 1.0);
	gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`);
}

// Drop-in replacement for the old MeshStandardMaterial call sites. PBR-only
// keys are swallowed so callers can stay terse.
export function toyMat(params = {}) {
  const { roughness, metalness, envMapIntensity, map, flatShading, ...rest } = params;
  const mat = new THREE.MeshLambertMaterial({ flatShading: flatShading !== false, ...rest });
  mat.onBeforeCompile = toyBeforeCompile;
  mat.customProgramCacheKey = () => TOY_CHUNK;
  return mat;
}

// Fallbacks for palettes that predate the shadow / skyTop keys.
export function paletteShadow(pal) {
  if (pal && pal.shadow !== undefined) return pal.shadow;
  return 0x1d3557;
}
export function paletteSkyTop(pal) {
  if (pal && pal.skyTop !== undefined) return pal.skyTop;
  const c = new THREE.Color(pal && pal.sky !== undefined ? pal.sky : 0xa8cfc4);
  return c.multiplyScalar(0.62).getHex();
}

// A two-stop vertical sky gradient drawn into a tiny canvas. Used as the scene
// background (screen-aligned), so the horizon colour can match the fog.
export class SkyGradient {
  constructor() {
    this.key = '';
    this.texture = null;
    if (typeof document === 'undefined') return;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2;
    this.canvas.height = 256;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  set(top, horizon) {
    if (!this.texture) return null;
    const a = '#' + top.getHexString(), b = '#' + horizon.getHexString();
    const key = a + b;
    if (key !== this.key) {
      this.key = key;
      const ctx = this.canvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, a);
      grad.addColorStop(1, b);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 2, 256);
      this.texture.needsUpdate = true;
    }
    return this.texture;
  }
}
