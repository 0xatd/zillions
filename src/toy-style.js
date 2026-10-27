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
