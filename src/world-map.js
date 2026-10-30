// Level select for the five Earth fronts. Each battlefield is a small
// diorama built from that level's own landform and palette. Presentation
// only: it never starts a match, writes a save, or touches the simulation.
import * as THREE from 'three';
import { LEVELS } from './config.js';
export { battlefieldPressure, frontState } from './front-state.js';
import { battlefieldPressure, frontState } from './front-state.js';

const mat = (color) => new THREE.MeshLambertMaterial({ color });
const add = (group, geometry, color, x, y, z, sx = 1, sy = 1, sz = 1) => {
  const mesh = new THREE.Mesh(geometry, mat(color));
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
};
const pine = (group, color, x, z, h = 0.7) => {
  add(group, new THREE.ConeGeometry(0.16, h, 6), color, x, 0.22 + h * 0.45, z);
  add(group, new THREE.CylinderGeometry(0.035, 0.045, 0.22, 5), 0x5a4632, x, 0.18, z);
};
const keep = (group, wall, roof, x, z) => {
  add(group, new THREE.BoxGeometry(0.7, 0.42, 0.7), wall, x, 0.38, z);
  add(group, new THREE.ConeGeometry(0.52, 0.38, 4), roof, x, 0.72, z);
  add(group, new THREE.BoxGeometry(0.16, 0.28, 0.04), 0x6a5338, x, 0.32, z + 0.36);
};

function buildIsland(level) {
  const group = new THREE.Group();
  const pal = level.theme?.palette || {};
  const grass = pal.grass ?? 0x4a9a72;
  const water = pal.water ?? 0x3aa0c8;
  const rock = pal.mountain ?? 0xc8c2b2;
  const canopy = pal.canopy ?? 0x67b85a;
  const shadow = pal.shadow ?? 0x243044;
  const underside = add(group, new THREE.SphereGeometry(1.55, 28, 18), shadow, 0, -0.72, 0, 1.22, 0.78, 1.22);
  const cap = add(group, new THREE.CylinderGeometry(1.62, 1.48, 0.42, 28), grass, 0, 0.08, 0);
  const id = level.id;

  if (id === 1) {
    add(group, new THREE.BoxGeometry(2.5, 0.06, 0.38), water, 0.1, 0.3, 0.15);
    add(group, new THREE.BoxGeometry(0.7, 0.06, 0.9), water, -0.7, 0.3, -0.35);
    for (const [x, z] of [[-1.05, -0.7], [-0.75, 0.85], [0.95, -0.85], [1.1, 0.55], [-0.2, -1.05], [0.45, 0.95]]) pine(group, canopy, x, z, 0.62 + (x > 0 ? 0.15 : 0));
    keep(group, 0xd8c7a2, 0xb32020, -0.15, -0.15);
  } else if (id === 2) {
    cap.material = mat(0x5d7a48);
    for (const [x, z, s] of [[-0.7, 0.4, 0.55], [0.55, -0.35, 0.4], [0.15, 0.85, 0.32]]) {
      add(group, new THREE.CircleGeometry(s, 16), water, x, 0.31, z).rotation.x = -Math.PI / 2;
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const wall = add(group, new THREE.BoxGeometry(0.7, 0.28, 0.12), 0x6e8f3a, Math.cos(a) * 0.55, 0.4, Math.sin(a) * 0.55);
      wall.lookAt(0, 0.4, 0);
    }
    add(group, new THREE.CylinderGeometry(0.18, 0.2, 0.36, 6), 0xc9a44a, 0, 0.46, 0);
    pine(group, 0x3d5a32, -1.15, 0.2, 0.45);
    pine(group, 0x3d5a32, 1.05, 0.7, 0.4);
  } else if (id === 3) {
    cap.material = mat(0xe9a43e);
    cap.scale.set(1.05, 2.1, 1.05);
    cap.position.y = 0.28;
    add(group, new THREE.BoxGeometry(2.4, 0.16, 0.35), 0xc45a28, 0, 0.55, 0.1);
    add(group, new THREE.DodecahedronGeometry(0.28, 0), rock, 1.05, 0.7, -0.4);
    add(group, new THREE.DodecahedronGeometry(0.18, 0), rock, -1.1, 0.62, 0.35);
    add(group, new THREE.CylinderGeometry(0.16, 0.2, 0.7, 6), 0x8a3a2a, -0.25, 0.9, -0.2);
  } else if (id === 4) {
    cap.material = mat(0xd5e4ee);
    add(group, new THREE.CylinderGeometry(1.15, 1.2, 0.22, 24), 0xeaf4f7, 0, 0.36, 0);
    add(group, new THREE.CylinderGeometry(0.72, 0.78, 0.2, 20), 0xf7fbfd, 0, 0.54, 0);
    for (const [x, z] of [[-0.85, 0.15], [0.7, -0.4], [0.2, 0.8], [-0.3, -0.75]]) {
      add(group, new THREE.BoxGeometry(0.08, 0.42, 0.16), 0x8aa0b8, x, 0.55, z);
    }
  } else {
    cap.material = mat(0x6c5292);
    add(group, new THREE.ConeGeometry(0.62, 1.55, 7), 0xbcaadc, -0.55, 0.95, 0.05);
    add(group, new THREE.ConeGeometry(0.5, 1.25, 7), 0x9d6ee0, 0.58, 0.82, -0.1);
    add(group, new THREE.BoxGeometry(0.9, 0.06, 0.22), 0x2a1848, 0.05, 0.34, -0.02);
    add(group, new THREE.ConeGeometry(0.14, 0.55, 5), 0xe07aae, 1.05, 0.5, 0.7);
  }

  const flag = new THREE.Group();
  add(flag, new THREE.CylinderGeometry(0.03, 0.03, 0.7, 5), 0xf4efe4, 0, 0.35, 0);
  add(flag, new THREE.BoxGeometry(0.36, 0.2, 0.04), 0xf0c14a, 0.18, 0.58, 0);
  flag.position.set(0, 1.05, 0);
  flag.visible = false;
  group.add(flag);

  const lock = new THREE.Group();
  add(lock, new THREE.BoxGeometry(0.36, 0.28, 0.1), 0xd5dbe3, 0, 0, 0);
  add(lock, new THREE.TorusGeometry(0.12, 0.035, 8, 10, Math.PI), 0xeef3f8, 0, 0.2, 0);
  lock.position.set(1.05, 1.35, 0);
  lock.visible = false;
  group.add(lock);

  const label = labelSprite(level.name.replace('The ', ''));
  label.position.set(0, 2.15, 0);
  group.add(label);

  group.userData.levelId = level.id;
  return { group, mesh: cap, flag, lock, label, level };
}

function labelSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 54px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(6,10,18,0.85)';
  ctx.strokeText(text, 256, 64);
  ctx.fillStyle = '#f4efe4';
  ctx.fillText(text, 256, 64);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.userData.baseColor = '#f4efe4';
  return sprite;
}

function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1b2744');
  grad.addColorStop(0.45, '#243456');
  grad.addColorStop(1, '#12182c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class WorldMap {
  constructor(canvas, { onHover, onSelect } = {}) {
    this.canvas = canvas;
    this.onHover = onHover || null;
    this.onSelect = onSelect || null;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0x12182c, 16, 34);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.clock = new THREE.Clock();
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverId = null;
    this.focusIndex = 0;
    this.running = false;
    this._raf = 0;
    this.islands = [];

    this.scene.add(new THREE.HemisphereLight(0xc5d4ea, 0x1a120c, 0.55));
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.65);
    sun.position.set(-8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    this.scene.add(sun);
    const stars = new Float32Array(220 * 3);
    for (let i = 0; i < 220; i++) {
      stars[i * 3] = (Math.random() - 0.5) * 40;
      stars[i * 3 + 1] = 2 + Math.random() * 14;
      stars[i * 3 + 2] = (Math.random() - 0.5) * 24;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xe7eef8, size: 0.045, fog: false })));

    const spots = [
      [-6.4, 1.15],
      [-3.15, -1.55],
      [0.05, 1.7],
      [3.25, -1.45],
      [6.45, 1.05],
    ];
    LEVELS.slice(0, 5).forEach((level, i) => {
      const island = buildIsland(level);
      island.group.position.set(spots[i][0], 0, spots[i][1]);
      island.home = island.group.position.clone();
      this.scene.add(island.group);
      this.islands.push(island);
    });
    for (let i = 0; i < this.islands.length - 1; i++) {
      const a = this.islands[i].home.clone();
      const b = this.islands[i + 1].home.clone();
      a.y = 0.35;
      b.y = 0.35;
      const mid = a.clone().lerp(b, 0.5);
      mid.y = 1.15;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, 0.035, 6, false),
        new THREE.MeshBasicMaterial({ color: 0xf0c14a, transparent: true, opacity: 0.8 }),
      );
      this.scene.add(tube);
    }

    this._move = (event) => this._pick(event, false);
    this._click = (event) => this._pick(event, true);
    canvas.addEventListener('pointermove', this._move);
    canvas.addEventListener('pointerleave', () => this._setHover(null, null));
    canvas.addEventListener('click', this._click);
    this.setProgress({ cleared: 0, clearedIds: {} });
    this.resize();
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 800);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 600);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setProgress({ cleared = 0, clearedIds = {} } = {}) {
    this.cleared = cleared;
    this.clearedIds = clearedIds || {};
    for (const island of this.islands) {
      const state = frontState(island.level.id, cleared, this.clearedIds);
      island.state = state;
      island.group.traverse((node) => {
        if (!node.isMesh || !node.material?.color) return;
        if (node.userData.base == null) node.userData.base = node.material.color.getHex();
        const base = node.userData.base;
        if (state !== 'locked') { node.material.color.setHex(base); return; }
        const r = ((base >> 16) & 255) / 255;
        const g = ((base >> 8) & 255) / 255;
        const b = (base & 255) / 255;
        node.material.color.setRGB(r * 0.62, g * 0.62, b * 0.62);
      });
      island.flag.visible = state === 'completed';
      island.lock.visible = state === 'locked';
    }
    const firstOpen = this.islands.findIndex((island) => island.state !== 'locked');
    this.focusIndex = firstOpen >= 0 ? firstOpen : 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this.update(Math.min(0.05, this.clock.getDelta()));
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  nudge(step) {
    const next = Math.max(0, Math.min(this.islands.length - 1, this.focusIndex + step));
    this.focusIndex = next;
    const island = this.islands[next];
    this._setHover(island?.level.id ?? null, null);
    return island?.level.id ?? null;
  }

  focusedId() {
    return this.islands[this.focusIndex]?.level.id ?? null;
  }

  confirmFocused() {
    const island = this.islands[this.focusIndex];
    if (!island || island.state === 'locked') return null;
    this.onSelect?.(island.level.id);
    return island.level.id;
  }

  update(dt) {
    this._t = (this._t || 0) + dt;
    const focus = this.islands[this.focusIndex];
    const yaw = Math.sin(this._t * 0.18) * 0.22;
    this.camera.position.set(Math.sin(yaw) * 1.2, 8.2, 13.4);
    this.camera.lookAt(0, 0.35, 0);
    for (const island of this.islands) {
      const hot = island.level.id === this.hoverId || island === focus;
      const bob = Math.sin(this._t * 0.9 + island.level.id) * 0.12;
      const y = (hot ? 0.55 : 0) + bob;
      island.group.position.y += (y - island.group.position.y) * Math.min(1, dt * 5);
      const target = hot ? 1.08 : 1;
      const current = island.group.scale.x;
      const next = current + (target - current) * Math.min(1, dt * 6);
      island.group.scale.setScalar(next);
      if (island.flag.visible) island.flag.rotation.y = Math.sin(this._t * 1.4) * 0.2;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener('pointermove', this._move);
    this.canvas.removeEventListener('click', this._click);
    this.renderer.dispose();
  }

  _pick(event, select) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = this.ray.intersectObjects(this.islands.map((island) => island.group), true)[0];
    let node = hit?.object;
    let id = null;
    while (node) {
      if (node.userData?.levelId) { id = node.userData.levelId; break; }
      node = node.parent;
    }
    if (id != null) this.focusIndex = this.islands.findIndex((island) => island.level.id === id);
    this._setHover(id, event);
    if (select && id != null) {
      const island = this.islands.find((entry) => entry.level.id === id);
      if (island && island.state !== 'locked') this.onSelect?.(id);
    }
  }

  _setHover(id, event) {
    this.hoverId = id;
    if (!this.onHover) return;
    if (id == null) { this.onHover(null); return; }
    const island = this.islands.find((entry) => entry.level.id === id);
    this.onHover({
      id,
      name: island.level.name,
      blurb: island.level.blurb,
      pressure: battlefieldPressure(island.level.mult),
      state: island.state,
      x: event?.clientX ?? null,
      y: event?.clientY ?? null,
    });
  }
}
