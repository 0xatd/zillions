// Toy style: the shared look of the Thronefall-style art pass.
//
// Procedural scenery stays matte Lambert so a picked hex still reads as that
// hex under the Low preset (no tone mapping). Medium and High tone-map with
// AgX and keep authored GLB materials; see src/presentation.js. Depth on
// those tiers comes from a soft shadow, hemisphere fill and, on High, the
// outline plus ambient occlusion in tactical-visuals.js.
//
// Presentation only. Nothing here reads or writes simulation state.
import * as THREE from 'three';

// Drop-in replacement for the old MeshStandardMaterial call sites. PBR-only
// keys are swallowed so callers can stay terse.
export function toyMat(params = {}) {
  const { roughness, metalness, envMapIntensity, map, flatShading, ...rest } = params;
  return new THREE.MeshLambertMaterial({ flatShading: flatShading !== false, ...rest });
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

  // mid is optional. Two stops stay valid for callers that only have a
  // zenith and a horizon; a third stop puts a shoulder of light between them.
  set(top, horizon, mid = null) {
    if (!this.texture) return null;
    const a = '#' + top.getHexString(), b = '#' + horizon.getHexString();
    const c = mid ? '#' + mid.getHexString() : '';
    const key = a + '|' + c + '|' + b;
    if (key !== this.key) {
      this.key = key;
      const ctx = this.canvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, a);
      if (c) grad.addColorStop(0.62, c);
      grad.addColorStop(1, b);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 2, 256);
      this.texture.needsUpdate = true;
    }
    return this.texture;
  }
}
