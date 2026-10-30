// Star-system level select. Three low-poly planets carry the five Earth
// fronts plus coming-soon pins. Presentation only: no sim, no saves.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { levelById } from './config.js';
import { STAR_SYSTEM, battlefieldPressure, frontState } from './front-state.js';

export { battlefieldPressure, frontState };

const CULTURE = 0xe0b45a;
const INFESTED = 0x3a1848;
const SOON = 0x8d97a6;

const LAYOUT = {
  verdant: { x: -5.15, y: 0.45, z: 1.15, radius: 1.72, spin: 0.18, moon: true, glow: 0x7dffc0 },
  mire: { x: 0.1, y: -0.55, z: -1.35, radius: 1.42, spin: 0.12, moon: false, glow: 0xc6e07a },
  cinder: { x: 5.35, y: 0.2, z: 0.25, radius: 1.62, spin: 0.16, ring: true, glow: 0xff8a4a },
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
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#101628');
  grad.addColorStop(0.5, '#1a2748');
  grad.addColorStop(1, '#0c101c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function nebulaTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const blobs = [[70, 90, 80, 'rgba(90,50,140,0.45)'], [160, 140, 90, 'rgba(40,90,120,0.35)'], [120, 60, 50, 'rgba(180,80,50,0.18)']];
  for (const [x, y, r, color] of blobs) {
    const g = ctx.createRadialGradient(x, y, 4, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ringTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < 128; y++) {
    const band = Math.floor(y / 8);
    const alpha = [0.15, 0.72, 0.28, 0.9, 0.08, 0.55, 0.2, 0.8][band % 8];
    ctx.fillStyle = `rgba(232, 176, 112, ${alpha})`;
    ctx.fillRect(0, y, 8, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const fade = (t) => t * t * (3 - 2 * t);

function lattice(ix, iy, iz) {
  const n = Math.sin(ix * 127.1 + iy * 311.7 + iz * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise3(x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const xf = fade(x - x0), yf = fade(y - y0), zf = fade(z - z0);
  const lerp = (a, b, t) => a + (b - a) * t;
  const n = (ix, iy, iz) => lattice(ix, iy, iz);
  const x00 = lerp(n(x0, y0, z0), n(x0 + 1, y0, z0), xf);
  const x10 = lerp(n(x0, y0 + 1, z0), n(x0 + 1, y0 + 1, z0), xf);
  const x01 = lerp(n(x0, y0, z0 + 1), n(x0 + 1, y0, z0 + 1), xf);
  const x11 = lerp(n(x0, y0 + 1, z0 + 1), n(x0 + 1, y0 + 1, z0 + 1), xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}

function fbm(x, y, z) {
  let n = 0, a = 0.55, f = 1.7, sum = 0;
  for (let i = 0; i < 5; i++) {
    n += a * noise3(x * f, y * f, z * f);
    sum += a;
    a *= 0.5;
    f *= 2.02;
  }
  return n / sum;
}

function sampleSurface(kind, dir) {
  const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  const n = fbm(dir.x * 1.35, dir.y * 1.35, dir.z * 1.35);
  const ridge = fbm(dir.x * 3.2 + 8, dir.y * 3.2, dir.z * 3.2 + 4);
  if (kind === 'verdant') {
    const field = n * 0.8 + ridge * 0.2;
    const coast = field - 0.47;
    const mountains = Math.max(0, ridge - 0.64) * 0.12;
    const ice = Math.abs(lat) > 1.15 ? 0.035 : 0;
    const height = (coast > 0 ? 0.02 + coast * 0.09 : coast * 0.04) + mountains + ice;
    let biome = 0x1e6ea8;
    if (coast > 0.015) biome = ridge > 0.66 ? 0x2c7542 : 0x3caf62;
    if (coast > 0.14 && ridge > 0.72) biome = 0x8c9874;
    if (ice || height > 0.095) biome = 0xf3f7f2;
    return { height, biome };
  }
  if (kind === 'mire') {
    const basin = 0.4 - n;
    const height = basin * 0.075 + (ridge - 0.5) * 0.028;
    const biome = height < -0.008 ? 0x1a5e50 : height > 0.018 ? 0x6e8f3a : 0x3a5632;
    return { height, biome };
  }
  const dent = (ridge - 0.55) * 3.4;
  const crater = Math.exp(-(dent * dent)) * -0.065;
  const river = Math.abs(Math.sin(lat * 6.5 + dir.x * 5.2)) < 0.07 ? -0.03 : 0;
  const height = 0.018 + (n - 0.5) * 0.055 + crater + river + Math.max(0, n - 0.72) * 0.07;
  let biome = 0xde7428;
  if (height < -0.018) biome = 0xff5520;
  else if (height > 0.055) biome = 0x684886;
  return { height, biome };
}

function fresnelMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      glow: { value: new THREE.Color(color) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 glow;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.6);
        gl_FragColor = vec4(glow, fresnel * 0.9);
      }
    `,
  });
}

function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const c = (u, v) => Math.round(u + (v - u) * t);
  return (c(ar, br) << 16) | (c(ag, bg) << 8) | c(ab, bb);
}

function territoryColor(biome, dir, sites, culture) {
  let nearest = sites[0];
  let other = sites[0];
  let best = -2;
  let second = -2;
  for (const site of sites) {
    const dot = dir.dot(site.dir);
    if (dot > best) { second = best; other = nearest; best = dot; nearest = site; }
    else if (dot > second) { second = dot; other = site; }
  }
  const fill = (site) => {
    if (site.state === 'completed') return mixHex(biome, culture, 0.9);
    if (site.state === 'locked') return hash(dir.x * 19 + dir.z * 7) > 0.62 ? 0x6c3488 : 0x431860;
    if (site.placeholder || site.state === 'soon') return mixHex(0x24303e, biome, 0.22);
    return biome;
  };
  const a = fill(nearest);
  const b = fill(other);
  const gap = best - second;
  const band = 0.28;
  if (gap >= band) return a;
  const t = gap / band;
  return mixHex(b, a, 0.42 + t * 0.58);
}

function buildGlobe(radius, kind, sites, culture) {
  const source = new THREE.IcosahedronGeometry(1, 5);
  const indexed = source.attributes.position;
  for (let i = 0; i < indexed.count; i++) {
    const dir = new THREE.Vector3(indexed.getX(i), indexed.getY(i), indexed.getZ(i)).normalize();
    const { height } = sampleSurface(kind, dir);
    const lift = radius * (1 + height);
    indexed.setXYZ(i, dir.x * lift, dir.y * lift, dir.z * lift);
  }
  const geometry = source.toNonIndexed();
  source.dispose();
  const pos = geometry.attributes.position;
  const faces = pos.count / 3;
  const biomes = new Uint32Array(faces);
  const dirs = new Float32Array(faces * 3);
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  for (let f = 0; f < faces; f++) {
    const i = f * 3;
    const dir = new THREE.Vector3(
      pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2),
      pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2),
      pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2),
    ).normalize();
    biomes[f] = sampleSurface(kind, dir).biome;
    dirs[f * 3] = dir.x;
    dirs[f * 3 + 1] = dir.y;
    dirs[f * 3 + 2] = dir.z;
    color.setHex(territoryColor(biomes[f], dir, sites, culture));
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = color.r;
      colors[(i + k) * 3 + 1] = color.g;
      colors[(i + k) * 3 + 2] = color.b;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.userData.biomes = biomes;
  geometry.userData.dirs = dirs;
  geometry.computeVertexNormals();
  return geometry;
}

function repaintGlobe(geometry, sites, culture) {
  const colors = geometry.attributes.color;
  const biomes = geometry.userData.biomes;
  const dirs = geometry.userData.dirs;
  const color = new THREE.Color();
  const dir = new THREE.Vector3();
  for (let f = 0; f < biomes.length; f++) {
    dir.set(dirs[f * 3], dirs[f * 3 + 1], dirs[f * 3 + 2]);
    color.setHex(territoryColor(biomes[f], dir, sites, culture));
    for (let k = 0; k < 3; k++) colors.setXYZ(f * 3 + k, color.r, color.g, color.b);
  }
  colors.needsUpdate = true;
}

function makePin(site) {
  const group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xd8c7a2 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xb32020 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 6), stone);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), stone);
  tower.position.y = 0.11;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.09, 4), roofMat);
  roof.position.y = 0.2;
  group.add(base, tower, roof);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe7a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.position.y = 0.26;
  group.add(glow);
  const lock = new THREE.Group();
  lock.add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.04), new THREE.MeshLambertMaterial({ color: 0xd5dbe6 })));
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 8, Math.PI), new THREE.MeshLambertMaterial({ color: 0xf4f7fb }));
  shackle.position.y = 0.05;
  lock.add(shackle);
  lock.position.y = 0.18;
  lock.visible = false;
  group.add(lock);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), new THREE.MeshLambertMaterial({ color: 0xf4efe4 }));
  pole.position.set(0.1, 0.2, 0);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.012), new THREE.MeshLambertMaterial({ color: CULTURE }));
  cloth.position.set(0.15, 0.25, 0);
  pole.visible = false;
  cloth.visible = false;
  group.add(pole, cloth);
  const slot = new THREE.Group();
  group.add(slot);
  group.userData.site = site;
  group.userData.slot = slot;
  group.userData.glow = glow;
  group.userData.lock = lock;
  group.userData.flag = cloth;
  group.userData.pole = pole;
  group.userData.keep = [base, tower, roof];
  return group;
}

function scatterCreep(site, radius) {
  const motes = [];
  for (let i = 0; i < 10; i++) {
    const lat = site.lat + (hash(i + 2) - 0.5) * 0.45;
    const lon = site.lon + (hash(i + 9) - 0.5) * 0.45;
    const mote = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.035 + hash(i) * 0.03, 0),
      new THREE.MeshLambertMaterial({ color: 0x4a1860, emissive: 0x2a0838, emissiveIntensity: 0.6 }),
    );
    mote.position.copy(dirOf(lat, lon).multiplyScalar(radius * 1.03));
    mote.userData.phase = i;
    motes.push(mote);
  }
  return motes;
}

function buildPlanet(def, layout) {
  const root = new THREE.Group();
  root.position.set(layout.x, layout.y, layout.z);
  const spin = new THREE.Group();
  root.add(spin);
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
  const globe = new THREE.Mesh(
    buildGlobe(layout.radius, def.id, sites, CULTURE),
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  globe.userData.planetId = def.id;
  spin.add(globe);
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(layout.radius * 1.08, 32, 24), fresnelMaterial(layout.glow));
  spin.add(atmosphere);
  if (layout.ring) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(layout.radius * 1.32, layout.radius * 1.92, 80),
      new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = Math.PI / 2.35;
    spin.add(ring);
  }
  const pins = sites.map((site) => {
    const pin = makePin(site);
    pin.position.copy(site.dir.clone().multiplyScalar(layout.radius * 1.08));
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), site.dir);
    pin.scale.setScalar(1);
    spin.add(pin);
    const plate = plateSprite(site.name, site.state);
    plate.position.copy(site.dir.clone().multiplyScalar(layout.radius * 1.34));
    spin.add(plate);
    pin.userData.plate = plate;
    return pin;
  });
  const creep = [];
  for (const site of sites) {
    if (site.placeholder) continue;
    for (const mote of scatterCreep(site, layout.radius)) {
      spin.add(mote);
      mote.userData.site = site;
      creep.push(mote);
    }
  }
  let moon = null;
  if (layout.moon) {
    moon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.28, 1),
      new THREE.MeshLambertMaterial({ color: 0xd5dde8, flatShading: true }),
    );
    root.add(moon);
  }
  const label = textSprite(`${def.name}\n0/${sites.length} sites`, 42);
  label.position.y = layout.radius + 0.95;
  root.add(label);
  return {
    id: def.id, name: def.name, root, spin, globe, pins, sites, creep, moon, label,
    radius: layout.radius, spinRate: layout.spin, userSpin: 0,
  };
}

const PLATE = {
  completed: { bg: '#3d3118', fg: '#f6e2a4', tag: 'WON' },
  locked: { bg: '#2c1638', fg: '#f0d4ff', tag: 'HIVE' },
  soon: { bg: '#1b2430', fg: '#d5dee8', tag: 'LOCKED' },
  open: { bg: '#243246', fg: '#fff4c8', tag: 'NEXT' },
};

function plateSprite(name, state) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false,
  }));
  sprite.scale.set(0.2, 0.05, 1);
  sprite.userData.redraw = (value, next) => {
    const look = PLATE[next] || PLATE.soon;
    ctx.clearRect(0, 0, 640, 160);
    ctx.beginPath();
    ctx.roundRect(18, 36, 604, 88, 44);
    ctx.fillStyle = look.bg;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = look.fg;
    ctx.stroke();
    ctx.fillStyle = look.fg;
    ctx.font = '700 42px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${value}   ${look.tag}`, 320, 82);
    texture.needsUpdate = true;
  };
  sprite.userData.redraw(String(name || '').replace(/^The /, ''), state);
  return sprite;
}

function textSprite(text, size) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false, sizeAttenuation: false,
  }));
  sprite.scale.set(size > 36 ? 0.28 : 0.16, size > 36 ? 0.09 : 0.05, 1);
  sprite.userData.redraw = (value) => {
    ctx.clearRect(0, 0, 512, 160);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(6,10,18,0.88)';
    ctx.fillStyle = '#f7f1e4';
    String(value).split('\n').forEach((line, index) => {
      ctx.font = `700 ${index === 0 ? size : Math.round(size * 0.62)}px Nunito, sans-serif`;
      const y = 58 + index * 52;
      ctx.strokeText(line, 256, y);
      ctx.fillText(line, 256, y);
    });
    texture.needsUpdate = true;
  };
  sprite.userData.redraw(text);
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
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
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

    this.scene.add(new THREE.HemisphereLight(0xc5d6f0, 0x3a3428, 0.72));
    const sunPos = new THREE.Vector3(-3.4, 5.4, 7.2);
    const sun = new THREE.DirectionalLight(0xfff1d4, 1.45);
    sun.position.copy(sunPos);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x6f95d4, 0.55);
    fill.position.set(12, -3, 8);
    this.scene.add(fill);
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
    sunMesh.position.copy(sunPos);
    this.scene.add(sunMesh);
    const nebula = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nebulaTexture(), transparent: true, depthWrite: false, opacity: 0.85,
    }));
    nebula.position.set(1.5, 0.4, -7);
    nebula.scale.set(16, 9, 1);
    this.scene.add(nebula);
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
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xfff6d2 });
    for (let i = 0; i < this.planets.length - 1; i++) {
      const a = this.planets[i].root.position.clone();
      const b = this.planets[i + 1].root.position.clone();
      const mid = a.clone().lerp(b, 0.5);
      mid.y += 1.15;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      for (let s = 0.08; s < 0.95; s += 0.07) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 4), dashMat);
        dot.position.copy(curve.getPoint(s));
        this.routes.push(dot);
        this.scene.add(dot);
      }
    }
    this._fallbackRocks = [];
    for (let i = 0; i < 7; i++) {
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.08 + hash(i) * 0.08, 0),
        new THREE.MeshLambertMaterial({ color: 0x8a8074, flatShading: true }),
      );
      const a = hash(i + 4) * Math.PI * 2;
      rock.position.set(Math.cos(a) * (7.2 + hash(i + 1)), (hash(i + 2) - 0.5) * 1.4, Math.sin(a) * 2.2 - 0.4);
      this._fallbackRocks.push(rock);
      this.scene.add(rock);
    }
    const ship = new THREE.Group();
    ship.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.1), new THREE.MeshLambertMaterial({ color: 0xd8dee8 })));
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.28), new THREE.MeshLambertMaterial({ color: 0x9aa6b8 }));
    wing.position.x = -0.05;
    ship.add(wing);
    ship.position.set(1.8, 1.15, 1.6);
    ship.lookAt(0, 0, 0);
    this.scene.add(ship);
    this._fallbackShip = ship;
    this.propsReady = this._loadProps();

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

  async _loadProps() {
    const loader = new GLTFLoader();
    const load = (file) => loader.loadAsync(`assets/menu/${file}`);
    try {
      const [keep, dish, hive, meteor, rock, ship] = await Promise.all([
        load('turret_single.glb'),
        load('satelliteDish.glb'),
        load('rock_crystals.glb'),
        load('meteor.glb'),
        load('rock_largeA.glb'),
        load('craft_speederA.glb'),
      ]);
      const fit = (gltf, height) => {
        const root = gltf.scene;
        root.traverse((obj) => {
          if (!obj.isMesh) return;
          obj.material = obj.material.clone();
          obj.material.metalness = 0.04;
          obj.material.roughness = 0.82;
        });
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        root.scale.multiplyScalar(height / Math.max(size.x, size.y, size.z, 0.001));
        const fitted = new THREE.Box3().setFromObject(root);
        const center = fitted.getCenter(new THREE.Vector3());
        root.position.x -= center.x;
        root.position.z -= center.z;
        root.position.y -= fitted.min.y;
        return root;
      };
      const hiveRoot = fit(hive, 0.34);
      hiveRoot.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.material.color.setHex(0x7a3c96);
        obj.material.emissive = new THREE.Color(0x2a0838);
        obj.material.emissiveIntensity = 0.35;
      });
      const meteorRoot = fit(meteor, 0.26);
      const rockRoot = fit(rock, 0.3);
      this._props = {
        keep: fit(keep, 0.4),
        dish: fit(dish, 0.34),
        hive: hiveRoot,
      };
      for (const planet of this.planets) planet.pins.forEach((pin) => this._stylePin(pin));
      this._fallbackRocks.forEach((rock) => { rock.visible = false; });
      this._fallbackShip.visible = false;
      const sources = [meteorRoot, rockRoot];
      this._fallbackRocks.forEach((rock, index) => {
        const model = sources[index % 2].clone(true);
        model.scale.multiplyScalar(0.75 + hash(index) * 0.7);
        model.position.copy(rock.position);
        model.rotation.y = hash(index + 3) * Math.PI;
        this.scene.add(model);
      });
      const craft = fit(ship, 0.46);
      craft.position.copy(this._fallbackShip.position);
      craft.lookAt(0, 0.2, 0);
      this.scene.add(craft);
    } catch (error) {
      console.warn('menu props stayed procedural', error);
    }
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
      repaintGlobe(planet.globe.geometry, planet.sites, this.culture);
      const won = planet.sites.filter((site) => site.state === 'completed').length;
      planet.label.userData.redraw(`${planet.name}\n${won}/${planet.sites.length} sites`);
      planet.pins.forEach((pin) => this._stylePin(pin));
      for (const mote of planet.creep) mote.visible = mote.userData.site.state === 'locked';
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

  _stylePin(pin) {
    const site = pin.userData.site;
    const soon = site.state === 'soon';
    const won = site.state === 'completed';
    const open = site.state === 'open';
    for (const mesh of pin.userData.keep) mesh.visible = !soon;
    pin.userData.lock.visible = soon;
    pin.userData.flag.visible = won;
    pin.userData.pole.visible = won;
    if (won) pin.userData.flag.material.color.setHex(this.culture);
    pin.userData.keep[2].material.color.setHex(open ? 0xffe29a : won ? this.culture : 0x5a2848);
    pin.userData.glow.material.opacity = open ? 0.55 : 0;
    const slot = pin.userData.slot;
    if (slot && this._props) {
      while (slot.children.length) slot.remove(slot.children[0]);
      const key = soon ? null : won ? 'keep' : open ? 'dish' : 'hive';
      if (key && this._props[key]) slot.add(this._props[key].clone(true));
      for (const mesh of pin.userData.keep) mesh.visible = !key && !soon;
    }
    pin.userData.plate?.userData.redraw(String(site.name || '').replace(/^The /, ''), site.state);
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
        const pulse = site.state === 'open' ? 0.4 + Math.sin(this._t * 3.4 + index) * 0.28 : 0;
        pin.userData.glow.material.opacity = pulse;
        const hot = this.hoverKey === this._key(planet, site);
        const plate = pin.userData.plate;
        if (plate) {
          const outward = site.dir.clone().applyQuaternion(planet.spin.quaternion);
          const view = new THREE.Vector3().subVectors(this.camera.position, planet.root.position).normalize();
          plate.visible = outward.dot(view) > 0.12;
          plate.scale.set(hot ? 0.26 : 0.2, hot ? 0.065 : 0.05, 1);
        }
      });
      for (const mote of planet.creep) {
        if (!mote.visible) continue;
        const bob = 1 + Math.sin(this._t * 1.6 + mote.userData.phase) * 0.2;
        mote.scale.setScalar(bob);
      }
    }
    const system = new THREE.Vector3(Math.sin(this._t * 0.05) * 0.3, 2.5, 15.2);
    const close = focus.root.position.clone().add(new THREE.Vector3(0.15, focus.radius * 0.28, focus.radius * 2.45));
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
