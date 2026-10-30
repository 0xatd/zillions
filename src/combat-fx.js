// Pooled combat presentation: Kenney CC0 sprites, floating numbers, light shake.
// Spawn and update write into buffers allocated once. Nothing here touches
// the simulation.
import * as THREE from 'three';
import { shotFeel, writeDigits, numberScale } from './combat-feel.js';

const POOL = 40;
const NUMBERS = 24;

const FILES = {
  spark: 'assets/vfx/kenney/spark_04.png',
  flame: 'assets/vfx/kenney/flame_03.png',
  shock: 'assets/vfx/kenney/light_02.png',
  void: 'assets/vfx/kenney/magic_04.png',
  smoke: 'assets/vfx/kenney/smoke_05.png',
  dust: 'assets/vfx/kenney/dirt_02.png',
  muzzle: 'assets/vfx/kenney/muzzle_03.png',
  star: 'assets/vfx/kenney/star_05.png',
  trace: 'assets/vfx/kenney/trace_03.png',
  slash: 'assets/vfx/kenney/slash_02.png',
};

const POOLS = Object.keys(FILES);

const VERT = `
  attribute float size;
  varying vec3 vC;
  void main() {
    vC = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (170.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = `
  uniform sampler2D tex;
  varying vec3 vC;
  void main() {
    vec4 t = texture2D(tex, gl_PointCoord);
    if (t.a < 0.04) discard;
    gl_FragColor = vec4(vC * t.rgb, t.a);
  }
`;
function whiteTex() {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  return tex;
}

function loadSprite(url, mat) {
  if (typeof document === 'undefined') return;
  new THREE.TextureLoader().load(url, (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.magFilter = THREE.LinearFilter;
    loaded.minFilter = THREE.LinearMipmapLinearFilter;
    loaded.needsUpdate = true;
    mat.uniforms.tex.value = loaded;
  });
}

export class CombatFx {
  constructor(scene) {
    this.scene = scene;
    this.numbersOn = true;
    this.pools = {};
    this._tmp = [0, 0, 0];
    this._color = new THREE.Color();
    this._dummy = new THREE.Object3D();
    for (const name of POOLS) this.pools[name] = this._makePool(name);
    this.numViews = [];
    this.nums = [];
    const canDraw = typeof document !== 'undefined';
    for (let i = 0; i < NUMBERS; i++) {
      let view = null;
      if (canDraw) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 64;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.visible = false;
        sprite.renderOrder = 42;
        sprite.center.set(0.5, 0);
        this.scene.add(sprite);
        view = { canvas, ctx: canvas.getContext('2d'), tex, mat, sprite };
      }
      this.numViews.push(view);
      this.nums.push({
        life: 0, max: 0.5, x: 0, y: 0, z: 0, vy: 0,
        count: 0, crit: false, view,
        digits: new Uint8Array(3),
      });
    }
  }

  _makePool(name) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(POOL * 3);
    const col = new Float32Array(POOL * 3);
    const size = new Float32Array(POOL);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: whiteTex() } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    loadSprite(FILES[name], mat);
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 35;
    this.scene.add(points);
    return {
      name, pos, col, size, points,
      life: new Float32Array(POOL),
      max: new Float32Array(POOL),
      vx: new Float32Array(POOL),
      vy: new Float32Array(POOL),
      vz: new Float32Array(POOL),
      base: new Float32Array(POOL),
      cursor: 0,
    };
  }

  _slot(pool) {
    const p = this.pools[pool] || this.pools.spark;
    for (let n = 0; n < POOL; n++) {
      const i = (p.cursor + n) % POOL;
      if (p.life[i] <= 0) { p.cursor = (i + 1) % POOL; return { p, i }; }
    }
    const i = p.cursor;
    p.cursor = (i + 1) % POOL;
    return { p, i };
  }

  _spawn(pool, x, y, z, vx, vy, vz, life, size, color) {
    const { p, i } = this._slot(pool);
    const o = i * 3;
    p.life[i] = life;
    p.max[i] = life;
    p.vx[i] = vx;
    p.vy[i] = vy;
    p.vz[i] = vz;
    p.base[i] = size;
    p.pos[o] = x;
    p.pos[o + 1] = y;
    p.pos[o + 2] = z;
    this._color.setHex(color);
    p.col[o] = this._color.r;
    p.col[o + 1] = this._color.g;
    p.col[o + 2] = this._color.b;
    p.size[i] = size;
  }

  impact(x, y, z, kind, dtype, crit = false) {
    const style = shotFeel(kind, dtype);
    const n = kind === 'flame' || kind === 'grenade' || crit ? 9 : 6;
    const life = kind === 'flame' ? 0.42 : 0.32;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = 1.1 + (i % 3) * 0.35;
      this._spawn(style.pool, x, y, z, Math.cos(a) * sp, 1.4 + (i % 2) * 0.6, Math.sin(a) * sp, life, crit ? 0.72 : 0.5, style.color);
    }
    if (crit) this._spawn('star', x, y + 0.2, z, 0, 1.2, 0, 0.28, 0.9, 0xffe08a);
  }

  muzzle(x, y, z) {
    this._spawn('muzzle', x, y, z, 0, 0.2, 0, 0.12, 0.85, 0xfff2c4);
    this._spawn('spark', x, y, z, 0.4, 0.5, 0.2, 0.16, 0.4, 0xfff6d8);
    this._spawn('spark', x, y, z, -0.3, 0.4, -0.2, 0.14, 0.32, 0xffe2a0);
  }

  streak(x0, y0, z0, x1, y1, z1, kind, dtype) {
    const style = shotFeel(kind, dtype);
    const n = 5;
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      this._spawn('trace',
        x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t,
        0, 0.15, 0, 0.16 + i * 0.012, 0.34, style.color);
    }
  }

  death(x, y, z, big = false) {
    const n = big ? 16 : 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const puff = i % 3 !== 2;
      this._spawn(puff ? 'smoke' : 'magic', x, y + 0.35, z,
        Math.cos(a) * (puff ? 0.85 : 1.6),
        puff ? 1.8 : 1.1,
        Math.sin(a) * (puff ? 0.85 : 1.6),
        puff ? 0.62 : 0.4,
        puff ? (big ? 1.45 : 1.05) : 0.55,
        i % 2 ? 0xe4d4ff : 0xb44dff);
    }
  }

  waveColumn(x, y, z) {
    for (let i = 0; i < 6; i++) {
      this._spawn(i % 2 ? 'star' : 'spark', x, y + i * 0.15, z, (i - 3) * 0.15, 2.2, (i % 3) * 0.1, 0.45, 0.55, 0xffd75e);
    }
  }

  settle(x, y, z) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this._spawn('dust', x + Math.cos(a) * 0.4, y, z + Math.sin(a) * 0.4, Math.cos(a) * 0.4, 0.6, Math.sin(a) * 0.4, 0.5, 0.5, 0xfff2c8);
    }
  }

  number(x, y, z, value, crit = false) {
    if (!this.numbersOn) return;
    let slot = null;
    for (let i = 0; i < this.nums.length; i++) {
      if (this.nums[i].life <= 0) { slot = this.nums[i]; break; }
    }
    if (!slot) slot = this.nums[0];
    slot.life = crit ? 0.72 : 0.48;
    slot.max = slot.life;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vy = crit ? 1.9 : 1.45;
    slot.count = writeDigits(value, this._tmp);
    slot.digits[0] = this._tmp[0];
    slot.digits[1] = this._tmp[1];
    slot.digits[2] = this._tmp[2];
    slot.crit = !!crit;
    const view = slot.view;
    if (!view) return;
    const ctx = view.ctx;
    ctx.clearRect(0, 0, 128, 64);
    ctx.font = crit ? '700 52px sans-serif' : '700 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(8, 10, 14, 0.92)';
    ctx.fillStyle = crit ? '#ffe08a' : '#fff8ee';
    let text = '';
    for (let i = 0; i < slot.count; i++) text += slot.digits[i];
    if (crit) text += '!';
    ctx.strokeText(text, 64, 34);
    ctx.fillText(text, 64, 34);
    view.tex.needsUpdate = true;
    view.sprite.visible = true;
    view.sprite.position.set(slot.x, slot.y, slot.z);
    const s = numberScale(crit);
    view.sprite.scale.set(1.55 * s, 0.78 * s, 1);
    view.mat.opacity = 1;
  }

  update(dt) {
    const step = dt > 0 ? dt : 0;
    for (const name of POOLS) {
      const p = this.pools[name];
      let dirty = false;
      for (let i = 0; i < POOL; i++) {
        if (p.life[i] <= 0) {
          if (p.size[i] !== 0) { p.size[i] = 0; dirty = true; }
          continue;
        }
        p.life[i] -= step;
        if (p.life[i] <= 0) { p.life[i] = 0; p.size[i] = 0; dirty = true; continue; }
        const o = i * 3;
        p.pos[o] += p.vx[i] * step;
        p.pos[o + 1] += p.vy[i] * step;
        p.pos[o + 2] += p.vz[i] * step;
        p.vy[i] -= 1.6 * step;
        const k = p.life[i] / p.max[i];
        p.size[i] = p.base[i] * (0.45 + 0.55 * k) * (name === 'smoke' || name === 'dust' ? (1.35 - 0.35 * k) : 1);
        dirty = true;
      }
      if (dirty) {
        p.points.geometry.attributes.position.needsUpdate = true;
        p.points.geometry.attributes.color.needsUpdate = true;
        p.points.geometry.attributes.size.needsUpdate = true;
      }
    }
    if (!this.numbersOn) {
      for (let n = 0; n < this.nums.length; n++) {
        const slot = this.nums[n];
        if (slot.life > 0 && slot.view) slot.view.sprite.visible = false;
        slot.life = 0;
      }
      return;
    }
    for (let n = 0; n < this.nums.length; n++) {
      const slot = this.nums[n];
      if (slot.life <= 0) continue;
      slot.life -= step;
      const view = slot.view;
      if (slot.life <= 0) {
        slot.life = 0;
        if (view) view.sprite.visible = false;
        continue;
      }
      slot.y += slot.vy * step;
      if (view) {
        view.sprite.position.y = slot.y;
        view.mat.opacity = Math.min(1, slot.life / (slot.max * 0.3));
      }
    }
  }
}
