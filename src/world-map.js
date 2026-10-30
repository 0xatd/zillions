// Star-system level select. Three low-poly planets carry the five Earth
// fronts plus coming-soon pins. Presentation only: no sim, no saves.
import * as THREE from 'three';
import { LEVELS, levelById } from './config.js';
import { STAR_SYSTEM, battlefieldPressure, frontState } from './front-state.js';

export { battlefieldPressure, frontState };

const CULTURE = 0xe0b45a;
const INFESTED = 0x3a1848;
const SOON = 0x8d97a6;

const LAYOUT = {
  verdant: { x: -3.7, y: 0.15, z: 0, radius: 1.15, spin: 0.18, moon: true },
  mire: { x: 0, y: -0.05, z: -0.2, radius: 0.98, spin: 0.12, moon: false },
  cinder: { x: 3.7, y: 0.05, z: 0.1, radius: 1.1, spin: 0.16, ring: true },
};

const PINS = {
  verdant: [[0.42, -0.7], [-0.55, 1.15], [0.85, 2.2], [-0.25, -2.05]],
  mire: [[0.25, 0.35], [-0.7, -1.15], [0.9, 2.05]],
  cinder: [[0.3, -0.85], [-0.48, 1.25], [0.95, 2.35], [-0.2, -2.15]],
};

const ease = (u) => {
  const t = Math.max(0, Math.min(1, u));
  return t * t * (3 - 2 * t);
};

const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const dirOf = (lat, lon) => new THREE.Vector3(
  Math.cos(lat) * Math.sin(lon),
  Math.sin(lat),
  Math.cos(lat) * Math.cos(lon),
);

function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#12182e');
  grad.addColorStop(0.55, '#1c2c4e');
  grad.addColorStop(1, '#0c1224');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function biomeColor(kind, lat, lon) {
  const n = hash(Math.round((lat + 2) * 40) * 17 + Math.round((lon + 4) * 40));
  if (kind === 'verdant') {
    if (Math.abs(lat) > 0.95) return 0xd7e6ee;
    if (n < 0.18) return 0x2f7ea8;
    return n > 0.72 ? 0x2f6b40 : 0x3f9a62;
  }
  if (kind === 'mire') {
    if (n < 0.28) return 0x2a6a58;
    return n > 0.8 ? 0x6a8f3a : 0x3d5c38;
  }
  if (Math.abs(lat) > 0.7 || n > 0.78) return 0x6a4a86;
  return n < 0.22 ? 0xc45a28 : 0xe08a3a;
}

function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const c = (u, v) => Math.round(u + (v - u) * t);
  return (c(ar, br) << 16) | (c(ag, bg) << 8) | c(ab, bb);
}

function paintGlobe(geometry, kind, sites, culture) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const lat = Math.asin(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z))));
    const lon = Math.atan2(x, z);
    const here = dirOf(lat, lon);
    let nearest = sites[0];
    let best = -2;
    let second = -2;
    for (const site of sites) {
      const dot = here.dot(site.dir);
      if (dot > best) { second = best; best = dot; nearest = site; }
      else if (dot > second) second = dot;
    }
    let hex = biomeColor(kind, lat, lon);
    if (nearest.placeholder) hex = mixHex(hex, SOON, 0.28);
    else if (nearest.state === 'completed') hex = mixHex(hex, culture, 0.78);
    else if (nearest.state === 'locked') hex = mixHex(hex, INFESTED, 0.7);
    if (best - second < 0.06) hex = mixHex(hex, 0x10141c, 0.55);
    color.setHex(hex);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function makePin(site) {
  const group = new THREE.Group();
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.075, 0),
    new THREE.MeshLambertMaterial({ color: 0xf4efe4 }),
  );
  marker.position.y = 0.08;
  group.add(marker);
  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.05, 0.012),
    new THREE.MeshLambertMaterial({ color: CULTURE }),
  );
  flag.position.set(0.05, 0.16, 0);
  flag.visible = false;
  group.add(flag);
  group.userData.marker = marker;
  group.userData.flag = flag;
  group.userData.site = site;
  return group;
}

function buildPlanet(def, layout) {
  const root = new THREE.Group();
  root.position.set(layout.x, layout.y, layout.z);
  const spin = new THREE.Group();
  root.add(spin);
  const globe = new THREE.Mesh(
    new THREE.IcosahedronGeometry(layout.radius, 3),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  globe.castShadow = true;
  globe.receiveShadow = true;
  spin.add(globe);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(layout.radius * 1.08, 24, 16),
    new THREE.MeshBasicMaterial({
      color: def.id === 'cinder' ? 0xff7a3a : def.id === 'mire' ? 0x9ab85a : 0x7dffa8,
      transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false,
    }),
  );
  spin.add(glow);
  if (layout.ring) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(layout.radius * 1.45, 0.035, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xf0c14a, transparent: true, opacity: 0.75 }),
    );
    ring.rotation.x = Math.PI / 2.6;
    spin.add(ring);
  }
  const sites = def.sites.map((site, index) => {
    const [lat, lon] = PINS[def.id][index];
    const level = site.levelId ? levelById(site.levelId) : null;
    return {
      levelId: site.levelId || null,
      name: level ? level.name : site.name,
      blurb: level ? level.blurb : 'Coming soon',
      pressure: level ? battlefieldPressure(level.mult) : '',
      placeholder: !site.levelId,
      lat, lon,
      dir: dirOf(lat, lon),
      state: site.levelId ? 'locked' : 'soon',
    };
  });
  const pins = sites.map((site) => {
    const pin = makePin(site);
    const p = site.dir.clone().multiplyScalar(layout.radius * 1.02);
    pin.position.copy(p);
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), site.dir);
    spin.add(pin);
    return pin;
  });
  let moon = null;
  if (layout.moon) {
    moon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22, 1),
      new THREE.MeshLambertMaterial({ color: 0xd5dde8 }),
    );
    root.add(moon);
  }
  const label = nameSprite(def.name);
  label.position.y = layout.radius + 0.55;
  root.add(label);
  globe.userData.planetId = def.id;
  return { id: def.id, name: def.name, root, spin, globe, pins, sites, moon, radius: layout.radius, spinRate: layout.spin, userSpin: 0 };
}

function nameSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 56px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(6,10,18,0.8)';
  ctx.strokeText(text, 256, 48);
  ctx.fillStyle = '#f7f1e4';
  ctx.fillText(text, 256, 48);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false,
  }));
  sprite.scale.set(1.8, 0.34, 1);
  return sprite;
}

export class WorldMap {
  constructor(canvas, { onHover, onSelect } = {}) {
    this.canvas = canvas;
    this.onHover = onHover || null;
    this.onSelect = onSelect || null;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0x12182e, 18, 36);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    this.clock = new THREE.Clock();
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.zoom = 0;
    this.zoomTarget = 0;
    this.planetIndex = 0;
    this.siteIndex = 0;
    this.culture = CULTURE;
    this._t = 0;
    this._raf = 0;
    this.running = false;
    this.hoverKey = null;

    this.scene.add(new THREE.HemisphereLight(0xc9d7ee, 0x1a120e, 0.55));
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.7);
    sun.position.set(-6, 8, 7);
    this.scene.add(sun);
    const stars = new Float32Array(280 * 3);
    for (let i = 0; i < 280; i++) {
      const a = hash(i) * Math.PI * 2;
      const r = 12 + hash(i + 3) * 16;
      stars[i * 3] = Math.cos(a) * r;
      stars[i * 3 + 1] = (hash(i + 7) - 0.45) * 14;
      stars[i * 3 + 2] = Math.sin(a) * r * 0.65 - 4;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xe7eef8, size: 0.05, fog: false })));

    this.planets = STAR_SYSTEM.map((def) => buildPlanet(def, LAYOUT[def.id]));
    for (const planet of this.planets) this.scene.add(planet.root);
    this.routes = [];
    for (let i = 0; i < this.planets.length - 1; i++) {
      const a = this.planets[i].root.position.clone();
      const b = this.planets[i + 1].root.position.clone();
      a.y += 0.15;
      b.y += 0.15;
      const mid = a.clone().lerp(b, 0.5);
      mid.y += 0.7;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const route = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 28, 0.025, 5, false),
        new THREE.MeshBasicMaterial({ color: 0xf0c14a, transparent: true, opacity: 0.8 }),
      );
      this.routes.push(route);
      this.scene.add(route);
    }

    this._down = (event) => this._pointerDown(event);
    this._move = (event) => this._pointerMove(event);
    this._up = (event) => this._pointerUp(event);
    canvas.addEventListener('pointerdown', this._down);
    canvas.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    canvas.addEventListener('pointerleave', () => { if (!this._drag) this._setHover(null, null); });
    this.setProgress({ cleared: 0, clearedIds: {} });
    this.resize();
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 1280);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 720);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setProgress({ cleared = 0, clearedIds = {}, culture = CULTURE } = {}) {
    this.cleared = cleared;
    this.clearedIds = clearedIds || {};
    this.culture = culture || CULTURE;
    for (const planet of this.planets) {
      for (const site of planet.sites) {
        if (site.placeholder) site.state = 'soon';
        else site.state = frontState(site.levelId, cleared, this.clearedIds);
      }
      paintGlobe(planet.globe.geometry, planet.id, planet.sites, this.culture);
      planet.globe.geometry.attributes.color.needsUpdate = true;
      planet.pins.forEach((pin, index) => {
        const site = planet.sites[index];
        const marker = pin.userData.marker;
        const flag = pin.userData.flag;
        const color = site.state === 'completed' ? this.culture
          : site.state === 'open' ? 0xffe29a
          : site.state === 'soon' ? SOON
          : 0x6a3058;
        marker.material.color.setHex(color);
        flag.visible = site.state === 'completed';
        flag.material.color.setHex(this.culture);
      });
    }
    const next = this._nextSite();
    if (next) {
      this.planetIndex = next.planetIndex;
      this.siteIndex = next.siteIndex;
    }
  }

  isZoomed() {
    return this.zoom > 0.45 || this.zoomTarget > 0.5;
  }

  zoomOut() {
    this.zoomTarget = 0;
    this._setHover(null, null);
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

  // Absolute pose for a fixed-timestep recording. Nothing here depends on
  // the previous frame.
  pose({ t = 0, zoom = 0, planetIndex = 0, spin = 0, hoverIndex = -1 } = {}) {
    this._t = t;
    this.zoom = zoom;
    this.zoomTarget = zoom;
    this.planetIndex = planetIndex;
    const planet = this.planets[planetIndex];
    if (planet) planet.userSpin = spin - t * planet.spinRate;
    this._applyMotion(0);
    if (hoverIndex >= 0 && planet) this._emitSite(planet, planet.sites[hoverIndex], null);
    else this._setHover(null, null);
    this.renderer.render(this.scene, this.camera);
  }

  nudge(step) {
    if (this.isZoomed()) {
      const sites = this.planets[this.planetIndex].sites;
      this.siteIndex = (this.siteIndex + step + sites.length) % sites.length;
      this._emitSite(this.planets[this.planetIndex], sites[this.siteIndex], null);
      return sites[this.siteIndex].levelId;
    }
    this.planetIndex = Math.max(0, Math.min(this.planets.length - 1, this.planetIndex + step));
    this.zoomTarget = 0;
    this._setHover(null, null);
    return this.planets[this.planetIndex].sites.find((site) => site.levelId)?.levelId ?? null;
  }

  focusedId() {
    return this._nextSite()?.site.levelId ?? this.planets[0].sites.find((site) => site.levelId)?.levelId ?? null;
  }

  confirmFocused() {
    if (!this.isZoomed()) {
      this.zoomTarget = 1;
      this.siteIndex = 0;
      return null;
    }
    const site = this.planets[this.planetIndex].sites[this.siteIndex];
    if (!site || site.placeholder || site.state === 'locked' || site.state === 'soon') return null;
    this.onSelect?.(site.levelId);
    return site.levelId;
  }

  update(dt) {
    this._t += dt;
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-5 * dt));
    this._applyMotion(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener('pointerdown', this._down);
    this.canvas.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    this.renderer.dispose();
  }

  _nextSite() {
    for (let planetIndex = 0; planetIndex < this.planets.length; planetIndex++) {
      const planet = this.planets[planetIndex];
      for (let siteIndex = 0; siteIndex < planet.sites.length; siteIndex++) {
        if (planet.sites[siteIndex].state === 'open') return { planetIndex, siteIndex, site: planet.sites[siteIndex] };
      }
    }
    return null;
  }

  _applyMotion(dt) {
    const focus = this.planets[this.planetIndex];
    for (const planet of this.planets) {
      planet.spin.rotation.y = this._t * planet.spinRate + planet.userSpin;
      if (planet.moon) {
        const a = this._t * 0.35 + 0.6;
        planet.moon.position.set(Math.cos(a) * planet.radius * 2.05, 0.2, Math.sin(a) * planet.radius * 2.05);
        planet.moon.visible = this.zoom < 0.62;
      }
      planet.pins.forEach((pin, index) => {
        const site = planet.sites[index];
        const pulse = site.state === 'open' ? 1 + Math.sin(this._t * 3.2 + index) * 0.22 : 1;
        pin.userData.marker.scale.setScalar(pulse);
      });
    }
    const system = new THREE.Vector3(Math.sin(this._t * 0.05) * 0.25, 2.15, 11.6);
    const close = focus.root.position.clone().add(new THREE.Vector3(0.2, focus.radius * 0.35, focus.radius * 2.7));
    const lookFar = new THREE.Vector3(0, 0.1, 0);
    const lookNear = focus.root.position.clone();
    const k = ease(this.zoom);
    for (const route of this.routes) route.visible = k < 0.35;
    this.camera.position.lerpVectors(system, close, k);
    this.camera.lookAt(lookFar.lerp(lookNear, k));
    if (dt && this.hoverKey) {
      const planet = this.planets.find((entry) => entry.sites.some((site) => this._key(entry, site) === this.hoverKey));
      const site = planet?.sites.find((entry) => this._key(planet, entry) === this.hoverKey);
      if (site) this._emitSite(planet, site, this._hoverEvent || null);
    }
  }

  _key(planet, site) {
    return `${planet.id}:${site.levelId || site.name}`;
  }

  _emitSite(planet, site, event) {
    this.hoverKey = this._key(planet, site);
    this._hoverEvent = event;
    this.onHover?.({
      id: site.levelId,
      name: site.name,
      blurb: site.blurb,
      pressure: site.pressure,
      state: site.state,
      planet: planet.name,
      x: event?.clientX ?? null,
      y: event?.clientY ?? null,
    });
  }

  _setHover(site, event) {
    if (!site) {
      this.hoverKey = null;
      this.onHover?.(null);
      return;
    }
    const planet = this.planets.find((entry) => entry.sites.includes(site));
    this._emitSite(planet, site, event);
  }

  _pointerDown(event) {
    this._drag = { x: event.clientX, y: event.clientY, moved: false, spin: this.planets[this.planetIndex].userSpin };
  }

  _pointerMove(event) {
    if (this._drag && this.isZoomed()) {
      const dx = event.clientX - this._drag.x;
      if (Math.abs(dx) > 3 || Math.abs(event.clientY - this._drag.y) > 3) this._drag.moved = true;
      this.planets[this.planetIndex].userSpin = this._drag.spin + dx * 0.008;
      return;
    }
    this._pick(event, false);
  }

  _pointerUp(event) {
    const drag = this._drag;
    this._drag = null;
    if (!drag || drag.moved) return;
    this._pick(event, true);
  }

  _pick(event, select) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObjects(this.planets.flatMap((planet) => [planet.globe, ...planet.pins]), true);
    const hit = hits[0];
    if (!hit) { this._setHover(null, null); return; }
    let node = hit.object;
    let site = null;
    let planetId = null;
    while (node) {
      if (node.userData?.site) site = node.userData.site;
      if (node.userData?.planetId) planetId = node.userData.planetId;
      node = node.parent;
    }
    const planet = this.planets.find((entry) => entry.id === planetId) || this.planets.find((entry) => entry.sites.includes(site));
    if (!planet) return;
    this.planetIndex = this.planets.indexOf(planet);
    if (site) {
      this.siteIndex = planet.sites.indexOf(site);
      this._setHover(site, event);
      if (select && this.isZoomed() && site.levelId && site.state !== 'locked' && site.state !== 'soon') this.onSelect?.(site.levelId);
      else if (select && !this.isZoomed()) this.zoomTarget = 1;
      return;
    }
    this._setHover(null, null);
    if (select) this.zoomTarget = 1;
  }
}
