// Level select for the five Earth fronts. Each battlefield is a small
// diorama built from that level's own landform and palette. Presentation
// only: it never starts a match, writes a save, or touches the simulation.
import * as THREE from 'three';
import { LEVELS, TILE } from './config.js';
import { TerrainField } from './terrain.js';
export { battlefieldPressure, frontState } from './front-state.js';
import { battlefieldPressure, frontState } from './front-state.js';

const SAMPLE = 30;

function tileHex(palette, tile) {
  const pal = palette || {};
  if (tile === TILE.FOREST) return pal.canopy ?? pal.forest ?? 0x3d7a48;
  if (tile === TILE.WATER) return pal.water ?? 0x3aa0c8;
  if (tile === TILE.MOUNTAIN) return pal.mountain ?? 0xd5d0c4;
  if (tile === TILE.SAND) return pal.sand ?? 0xc6b48a;
  if (tile === TILE.PATH || tile === TILE.GOLDORE || tile === TILE.STONEORE) return pal.path ?? 0xb09060;
  return pal.grass ?? 0x4a9a72;
}

function pushColor(colors, hex, shade) {
  colors.push((((hex >> 16) & 255) / 255) * shade, (((hex >> 8) & 255) / 255) * shade, ((hex & 255) / 255) * shade);
}

function buildIsland(level) {
  const map = new TerrainField(level.seed, level.theme, { size: SAMPLE, nests: 2 });
  const N = map.size;
  const cx = (N - 1) / 2;
  const cz = (N - 1) / 2;
  const radius = N * 0.46;
  const scale = 7.4 / N;
  const positions = [];
  const colors = [];
  const indices = [];
  const index = new Map();
  const add = (x, z) => {
    const key = x + z * (N + 1);
    if (index.has(key)) return index.get(key);
    const dx = x - cx;
    const dz = z - cz;
    const dist = Math.hypot(dx, dz) / radius;
    const fall = dist > 0.78 ? Math.min(1, (dist - 0.78) / 0.28) : 0;
    const h = map.heightAt(Math.min(N - 1, x), Math.min(N - 1, z));
    const y = h * (1 - fall * 0.65) - fall * 1.35;
    const i = positions.length / 3;
    positions.push(dx * scale, y, dz * scale);
    const hex = tileHex(level.theme?.palette, map.tileAt(Math.min(N - 1, Math.max(0, x)), Math.min(N - 1, Math.max(0, z))));
    pushColor(colors, hex, 1 - fall * 0.45);
    index.set(key, i);
    return i;
  };
  for (let z = 0; z < N - 1; z++) {
    for (let x = 0; x < N - 1; x++) {
      if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > radius) continue;
      const a = add(x, z);
      const b = add(x + 1, z);
      const c = add(x, z + 1);
      const d = add(x + 1, z + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'island';

  const dress = new THREE.Group();
  const treeMat = new THREE.MeshLambertMaterial({ color: level.theme?.palette?.canopy ?? 0x67b85a });
  const rockMat = new THREE.MeshLambertMaterial({ color: level.theme?.palette?.mountain ?? 0xd5d0c4 });
  const treeGeo = new THREE.ConeGeometry(0.16, 0.55, 5);
  const rockGeo = new THREE.DodecahedronGeometry(0.18, 0);
  let trees = 0;
  let rocks = 0;
  for (let z = 2; z < N - 2 && (trees < 18 || rocks < 6); z += 3) {
    for (let x = 2; x < N - 2 && (trees < 18 || rocks < 6); x += 3) {
      if (Math.hypot(x - cx, z - cz) > radius * 0.72) continue;
      const tile = map.tileAt(x, z);
      const px = (x - cx) * scale;
      const pz = (z - cz) * scale;
      const py = map.heightAt(x, z);
      if (tile === TILE.FOREST && trees < 18) {
        const tree = new THREE.Mesh(treeGeo, treeMat);
        tree.position.set(px, py + 0.28, pz);
        tree.scale.y = 0.8 + ((x * 3 + z) % 5) * 0.12;
        dress.add(tree);
        trees++;
      } else if (tile === TILE.MOUNTAIN && rocks < 6) {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.set(px, py + 0.12, pz);
        rock.scale.setScalar(0.7 + ((x + z) % 4) * 0.2);
        dress.add(rock);
        rocks++;
      }
    }
  }

  const flag = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5), new THREE.MeshLambertMaterial({ color: 0xf4efe4 }));
  pole.position.y = 0.45;
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.04), new THREE.MeshLambertMaterial({ color: 0xf0c14a }));
  cloth.position.set(0.22, 0.78, 0);
  flag.add(pole, cloth);
  flag.position.set(0, 1.15, 0);
  flag.visible = false;

  const lock = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.12), new THREE.MeshLambertMaterial({ color: 0xc5ccd6 }));
  const shackle = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.08), new THREE.MeshLambertMaterial({ color: 0xd5dbe3 }));
  shackle.position.y = 0.22;
  lock.add(body, shackle);
  lock.position.set(0, 1.2, 0);
  lock.visible = false;

  const group = new THREE.Group();
  group.add(mesh, dress, flag, lock);
  mesh.userData.levelId = level.id;
  return { group, mesh, flag, lock, level };
}

export class WorldMap {
  constructor(canvas, { onHover, onSelect } = {}) {
    this.canvas = canvas;
    this.onHover = onHover || null;
    this.onSelect = onSelect || null;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b14);
    this.scene.fog = new THREE.Fog(0x070b14, 28, 62);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
    this.clock = new THREE.Clock();
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverId = null;
    this.focusIndex = 0;
    this.running = false;
    this._raf = 0;
    this.islands = [];

    this.scene.add(new THREE.HemisphereLight(0xd5e4f5, 0x1b140e, 0.72));
    const sun = new THREE.DirectionalLight(0xfff0d2, 1.45);
    sun.position.set(-14, 22, 10);
    this.scene.add(sun);
    const stars = new Float32Array(180 * 3);
    for (let i = 0; i < 180; i++) {
      stars[i * 3] = (Math.random() - 0.5) * 70;
      stars[i * 3 + 1] = 6 + Math.random() * 22;
      stars[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xd7e6f8, size: 0.08, fog: false })));

    const route = [];
    LEVELS.slice(0, 5).forEach((level, i) => {
      const island = buildIsland(level);
      const angle = -0.58 + i * 0.29;
      island.group.position.set(Math.sin(angle) * 11.2, 0, Math.cos(angle) * 2.4 - 1);
      island.home = island.group.position.clone();
      this.scene.add(island.group);
      this.islands.push(island);
      route.push(island.home.x, 0.15, island.home.z);
    });
    const routeGeo = new THREE.BufferGeometry();
    routeGeo.setAttribute('position', new THREE.Float32BufferAttribute(route, 3));
    this.scene.add(new THREE.Line(routeGeo, new THREE.LineBasicMaterial({ color: 0xf0c14a, transparent: true, opacity: 0.45 })));

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
      island.mesh.material.color.setHex(state === 'locked' ? 0x8e97a3 : 0xffffff);
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
    const look = focus ? focus.home : new THREE.Vector3();
    const yaw = Math.sin(this._t * 0.18) * 0.22;
    this.camera.position.set(look.x * 0.25 + Math.sin(yaw) * 4, 16.5, 29);
    this.camera.lookAt(look.x * 0.35, 0.2, look.z * 0.2);
    for (const island of this.islands) {
      const hot = island.level.id === this.hoverId || island === focus;
      const y = hot ? 0.85 : 0.12 + Math.sin(this._t * 0.8 + island.level.id) * 0.06;
      island.group.position.y += (y - island.group.position.y) * Math.min(1, dt * 6);
      island.group.rotation.y = Math.sin(this._t * 0.25 + island.level.id) * 0.08;
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
    const hit = this.ray.intersectObjects(this.islands.map((island) => island.mesh), false)[0];
    const id = hit?.object?.userData?.levelId ?? null;
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
