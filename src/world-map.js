// Star-system level select. Three textured planets carry the five Earth
// fronts plus coming-soon pins. Presentation only: no sim, no saves.
import * as THREE from 'three';
import { levelById } from './config.js';
import { STAR_SYSTEM, battlefieldPressure, frontState } from './front-state.js';

export { battlefieldPressure, frontState };

const CULTURE = 0xe0b45a;

const LAYOUT = {
  verdant: { x: -5.15, y: 0.45, z: 1.15, radius: 1.72, spin: 0.07, moon: true, glow: 0x8ee7c2 },
  mire: { x: 0.15, y: -0.55, z: -1.35, radius: 1.42, spin: 0.05, moon: false, glow: 0xc6d48a },
  cinder: { x: 5.35, y: 0.2, z: 0.25, radius: 1.62, spin: 0.06, glow: 0xff8a4a },
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
  let n = 0;
  let a = 0.55;
  let f = 1.6;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    n += a * noise3(x * f, y * f, z * f);
    sum += a;
    a *= 0.5;
    f *= 2.05;
  }
  return n / sum;
}

function sphereDir(u, v) {
  const theta = v * Math.PI;
  const phi = u * Math.PI * 2;
  const st = Math.sin(theta);
  return new THREE.Vector3(-Math.cos(phi) * st, Math.cos(theta), Math.sin(phi) * st);
}

function cellHash(ix, iy, iz, salt) {
  return hash(ix * 19.1 + iy * 47.3 + iz * 13.7 + salt);
}

function crackDistance(dir) {
  const scale = 5.4;
  const px = dir.x * scale;
  const py = dir.y * scale;
  const pz = dir.z * scale;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  let best = 1e9;
  let second = 1e9;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const jx = ix + dx;
        const jy = iy + dy;
        const jz = iz + dz;
        const cx = jx + cellHash(jx, jy, jz, 1.3);
        const cy = jy + cellHash(jx, jy, jz, 4.9);
        const cz = jz + cellHash(jx, jy, jz, 8.2);
        const d = (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
        if (d < best) { second = best; best = d; }
        else if (d < second) second = d;
      }
    }
  }
  return Math.sqrt(second) - Math.sqrt(best);
}

function sample(kind, dir) {
  const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  const n = fbm(dir.x * 1.55, dir.y * 1.45, dir.z * 1.55);
  const ridge = fbm(dir.x * 3.3 + 4.2, dir.y * 3.1, dir.z * 3.3 + 1.7);
  const fine = fbm(dir.x * 6.4 + 2, dir.y * 6.2, dir.z * 6.4);
  if (kind === 'verdant') {
    const field = n * 0.72 + ridge * 0.28;
    const coast = field - 0.48;
    const elev = Math.max(0, coast);
    const dry = fbm(dir.x * 1.15 + 11, dir.y * 1.05, dir.z * 1.15 + 6);
    const polar = Math.max(0, Math.min(1, (Math.abs(lat) - 1.28) / 0.18));
    let color;
    let rough = 0.86;
    if (coast < 0) {
      color = lerpColor([24, 118, 184], [8, 46, 112], Math.min(1, -coast * 4));
      rough = 0.12;
    } else if (elev < 0.025) {
      color = lerpColor([196, 170, 112], [64, 138, 68], elev / 0.025);
      rough = 0.72;
    } else if (elev > 0.1 && ridge > 0.68) {
      const peak = Math.min(1, (elev - 0.1) / 0.07);
      color = lerpColor([78, 64, 52], [150, 136, 118], peak * 0.75);
      rough = 0.94;
    } else if (dry > 0.63) {
      color = lerpColor([176, 146, 84], [124, 108, 62], fine);
      rough = 0.9;
    } else if (fine < 0.42) {
      color = lerpColor([16, 72, 36], [28, 92, 44], fine);
      rough = 0.9;
    } else {
      color = lerpColor([34, 128, 58], [72, 158, 78], fine);
    }
    if (polar > 0) {
      color = lerpColor(color, [228, 238, 244], polar);
      rough = 0.4;
    }
    const height = (coast > 0 ? 0.006 + elev * 0.05 : coast * 0.016) + (elev > 0.1 && ridge > 0.68 ? 0.02 : 0);
    return { height, color, rough, emis: 0 };
  }
  if (kind === 'mire') {
    const bog = n - 0.46;
    const color = bog < 0
      ? lerpColor([22, 86, 74], [36, 92, 52], fine)
      : lerpColor([52, 78, 36], [86, 98, 44], ridge);
    const height = bog * 0.03 + (ridge - 0.5) * 0.012;
    return { height, color, rough: bog < 0 ? 0.14 : 0.88, emis: 0 };
  }
  const crack = crackDistance(dir);
  const width = 0.035 + fine * 0.055;
  const lava = crack < width;
  const core = lava ? Math.max(0, 1 - crack / width) : 0;
  let color = lerpColor([28, 20, 22], [52, 32, 30], ridge);
  if (lava) color = lerpColor([140, 32, 12], [255, 150, 48], core);
  const dent = (ridge - 0.58) * 3.2;
  const crater = Math.exp(-(dent * dent));
  const height = 0.01 + (n - 0.5) * 0.028 - crater * 0.03 - core * 0.01;
  return { height, color, rough: lava ? 0.28 : 0.9, emis: core };
}

function lerpColor(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

function canvasTexture(canvas, colorSpace) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function planetTextures(kind) {
  const W = 768;
  const H = 384;
  const color = document.createElement('canvas');
  const rough = document.createElement('canvas');
  const emis = document.createElement('canvas');
  color.width = rough.width = emis.width = W;
  color.height = rough.height = emis.height = H;
  const cctx = color.getContext('2d');
  const rctx = rough.getContext('2d');
  const ectx = emis.getContext('2d');
  const cimg = cctx.createImageData(W, H);
  const rimg = rctx.createImageData(W, H);
  const eimg = ectx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dir = sphereDir(x / W, y / H);
      const here = sample(kind, dir);
      const i = (y * W + x) * 4;
      cimg.data[i] = here.color[0];
      cimg.data[i + 1] = here.color[1];
      cimg.data[i + 2] = here.color[2];
      cimg.data[i + 3] = 255;
      const rv = Math.round(here.rough * 255);
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = rv;
      rimg.data[i + 3] = 255;
      const ev = Math.round(here.emis * 255);
      eimg.data[i] = ev;
      eimg.data[i + 1] = Math.round(ev * 0.35);
      eimg.data[i + 2] = Math.round(ev * 0.08);
      eimg.data[i + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  ectx.putImageData(eimg, 0, 0);
  return {
    map: canvasTexture(color, THREE.SRGBColorSpace),
    roughness: canvasTexture(rough, THREE.LinearSRGBColorSpace),
    emissive: canvasTexture(emis, THREE.SRGBColorSpace),
  };
}

function cloudTexture(kind) {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const bias = kind === 'mire' ? 0.4 : kind === 'cinder' ? 0.58 : 0.5;
  const tint = kind === 'cinder' ? [140, 110, 96] : kind === 'mire' ? [196, 206, 184] : [255, 255, 255];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dir = sphereDir(x / W, y / H);
      const n = fbm(dir.x * 2.1 + 9, dir.y * 1.8, dir.z * 2.1 + 3);
      const soft = ease((n - bias) / 0.22);
      const band = 0.75 + 0.25 * Math.cos(Math.asin(Math.max(-1, Math.min(1, dir.y))) * 1.2);
      const alpha = soft * band * (kind === 'cinder' ? 120 : 150);
      const i = (y * W + x) * 4;
      img.data[i] = tint[0];
      img.data[i + 1] = tint[1];
      img.data[i + 2] = tint[2];
      img.data[i + 3] = Math.round(alpha);
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = canvasTexture(canvas, THREE.SRGBColorSpace);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function territoryTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const texture = canvasTexture(canvas, THREE.SRGBColorSpace);
  texture.userData.paint = (sites, culture) => {
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const gold = [(culture >> 16) & 255, (culture >> 8) & 255, culture & 255];
    const hive = [122, 60, 154];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dir = sphereDir(x / W, y / H);
        let nearest = sites[0];
        let other = sites[0];
        let best = -2;
        let second = -2;
        for (const site of sites) {
          const dot = dir.x * site.dir.x + dir.y * site.dir.y + dir.z * site.dir.z;
          if (dot > best) { second = best; other = nearest; best = dot; nearest = site; }
          else if (dot > second) { second = dot; other = site; }
        }
        const gap = best - second;
        const inside = Math.min(1, gap / 0.09);
        let rgb = null;
        let alpha = 0;
        if (nearest.state === 'completed') {
          rgb = gold;
          alpha = Math.round(48 * inside);
        } else if (nearest.state === 'locked') {
          rgb = hive;
          alpha = Math.round(42 * inside);
        } else if (nearest.state === 'soon') {
          rgb = [16, 22, 32];
          alpha = Math.round(36 * inside);
        }
        const i = (y * W + x) * 4;
        if (rgb) {
          img.data[i] = rgb[0];
          img.data[i + 1] = rgb[1];
          img.data[i + 2] = rgb[2];
          img.data[i + 3] = alpha;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    texture.needsUpdate = true;
  };
  return texture;
}

function fresnelMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { glow: { value: new THREE.Color(color) } },
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
        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 3.8);
        gl_FragColor = vec4(glow, fresnel * 0.48);
      }
    `,
  });
}

function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#070b16');
  sky.addColorStop(0.45, '#121a33');
  sky.addColorStop(1, '#070910');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 512);
  const blobs = [
    [180, 160, 220, 'rgba(88, 42, 140, 0.55)'],
    [640, 210, 260, 'rgba(28, 70, 120, 0.4)'],
    [860, 120, 160, 'rgba(150, 60, 40, 0.22)'],
    [420, 300, 180, 'rgba(40, 90, 110, 0.28)'],
  ];
  for (const [x, y, r, color] of blobs) {
    const g = ctx.createRadialGradient(x, y, 10, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function starField() {
  const count = 480;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = hash(i + 2) * Math.PI * 2;
    const spread = 10 + hash(i + 5) * 42;
    positions[i * 3] = Math.cos(a) * spread;
    positions[i * 3 + 1] = (hash(i + 8) - 0.5) * 36;
    positions[i * 3 + 2] = -26 - hash(i + 12) * 28;
    sizes[i] = 1.4 + hash(i + 3) * 2.8;
    phases[i] = hash(i + 15) * Math.PI * 2;
    const tint = 0.82 + hash(i + 6) * 0.18;
    colors[i * 3] = tint;
    colors[i * 3 + 1] = tint * (0.94 + hash(i + 7) * 0.06);
    colors[i * 3 + 2] = tint;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    vertexShader: `
      attribute float size;
      attribute float phase;
      uniform float time;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = color;
        vTwinkle = 0.7 + 0.3 * sin(time * 1.7 + phase);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * vTwinkle * (42.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.18, d);
        gl_FragColor = vec4(vColor, core * vTwinkle);
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

function ignoreRaycast(mesh) {
  mesh.raycast = () => {};
  return mesh;
}

function seatOn(kind, dir, radius, lift = 0) {
  const { height } = sample(kind, dir);
  return dir.clone().multiplyScalar(radius * (1 + height) + lift);
}

function buildGlobe(kind, radius) {
  const geometry = new THREE.SphereGeometry(radius, 96, 64);
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const { height } = sample(kind, v);
    const lift = radius * (1 + height);
    pos.setXYZ(i, v.x * lift, v.y * lift, v.z * lift);
  }
  geometry.computeVertexNormals();
  const maps = planetTextures(kind);
  const material = new THREE.MeshStandardMaterial({
    map: maps.map,
    roughnessMap: maps.roughness,
    roughness: 1,
    metalness: 0,
    emissive: kind === 'cinder' ? 0xfff1e4 : 0x000000,
    emissiveMap: kind === 'cinder' ? maps.emissive : null,
    emissiveIntensity: kind === 'cinder' ? 1.35 : 0,
  });
  return new THREE.Mesh(geometry, material);
}

function makeBanner() {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xb7ab96, roughness: 0.8 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.018, 8), stone);
  pad.position.y = 0.009;
  const hut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.04), stone);
  hut.position.y = 0.038;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.03, 4), new THREE.MeshStandardMaterial({ color: 0x8d3a2e, roughness: 0.7 }));
  roof.position.y = 0.068;
  roof.rotation.y = Math.PI / 4;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6), new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.45 }));
  pole.position.set(0.03, 0.09, 0);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.028);
  shape.lineTo(0.1, 0);
  shape.lineTo(0, -0.028);
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({
    color: CULTURE, roughness: 0.55, side: THREE.DoubleSide, emissive: CULTURE, emissiveIntensity: 0.12,
  }));
  cloth.position.set(0.036, 0.14, 0);
  group.add(pad, hut, roof, pole, cloth);
  group.userData.cloth = cloth;
  return group;
}

function makeSpire() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a2060, roughness: 0.6, emissive: 0x2a0838, emissiveIntensity: 0.4 });
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), mat);
  spike.position.y = 0.06;
  group.add(spike);
  return group;
}

function makeBeacon() {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.1, 6), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.5 }));
  post.position.y = 0.05;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), new THREE.MeshStandardMaterial({
    color: 0xffe7a0, emissive: 0xffc56a, emissiveIntensity: 0.8, roughness: 0.3,
  }));
  lamp.position.y = 0.11;
  group.add(post, lamp);
  group.userData.lamp = lamp;
  return group;
}

function makeLock() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), new THREE.MeshStandardMaterial({ color: 0xd5dbe6, roughness: 0.4 })));
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 8, Math.PI), new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.35 }));
  shackle.position.y = 0.028;
  group.add(shackle);
  group.position.y = 0.02;
  return group;
}

function makePin(site) {
  const group = new THREE.Group();
  const banner = makeBanner();
  const spire = makeSpire();
  const beacon = makeBeacon();
  const lock = makeLock();
  group.add(banner, spire, beacon, lock);
  group.userData.site = site;
  group.userData.markers = { completed: banner, locked: spire, open: beacon, soon: lock };
  group.userData.cloth = banner.userData.cloth;
  return group;
}

const PLATE = {
  completed: { bg: 'rgba(42, 32, 16, 0.92)', fg: '#f6e2a4', tag: 'Won' },
  locked: { bg: 'rgba(32, 16, 42, 0.92)', fg: '#f0d4ff', tag: 'Hive' },
  soon: { bg: 'rgba(16, 22, 32, 0.9)', fg: '#d5dee8', tag: 'Locked' },
  open: { bg: 'rgba(22, 32, 48, 0.92)', fg: '#fff4c8', tag: 'Next' },
};

function plateSprite(name, state) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false,
  }));
  sprite.scale.set(0.15, 0.038, 1);
  sprite.renderOrder = 20;
  sprite.userData.redraw = (value, next) => {
    const look = PLATE[next] || PLATE.soon;
    ctx.clearRect(0, 0, 512, 128);
    ctx.beginPath();
    ctx.roundRect(12, 28, 488, 72, 36);
    ctx.fillStyle = look.bg;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = look.fg;
    ctx.stroke();
    ctx.fillStyle = look.fg;
    ctx.font = '700 34px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${String(value || '').replace(/^The /, '')}  ·  ${look.tag}`, 256, 66);
    texture.needsUpdate = true;
  };
  sprite.userData.redraw(name, state);
  return sprite;
}

function textSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false, sizeAttenuation: false,
  }));
  sprite.scale.set(0.22, 0.07, 1);
  sprite.userData.redraw = (value) => {
    ctx.clearRect(0, 0, 512, 160);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f7f1e4';
    String(value).split('\n').forEach((line, index) => {
      ctx.font = `700 ${index === 0 ? 48 : 30}px Nunito, sans-serif`;
      ctx.fillText(line, 256, 52 + index * 48);
    });
    texture.needsUpdate = true;
  };
  sprite.userData.redraw(text);
  return sprite;
}

function leaderLine() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
    color: 0xf4efe4, transparent: true, opacity: 0.8, depthTest: false,
  }));
  line.frustumCulled = false;
  line.renderOrder = 15;
  return line;
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
  const globe = buildGlobe(def.id, layout.radius);
  globe.userData.planetId = def.id;
  spin.add(globe);
  const territoryMap = territoryTexture();
  const territory = new THREE.Mesh(
    new THREE.SphereGeometry(layout.radius * 1.012, 96, 64),
    new THREE.MeshBasicMaterial({ map: territoryMap, transparent: true, depthWrite: false }),
  );
  territory.userData.planetId = def.id;
  ignoreRaycast(territory);
  spin.add(territory);
  const clouds = ignoreRaycast(new THREE.Mesh(
    new THREE.SphereGeometry(layout.radius * 1.045, 64, 40),
    new THREE.MeshBasicMaterial({ map: cloudTexture(def.id), transparent: true, depthWrite: false }),
  ));
  root.add(clouds);
  const atmosphere = ignoreRaycast(new THREE.Mesh(
    new THREE.SphereGeometry(layout.radius * 1.09, 48, 32),
    fresnelMaterial(layout.glow),
  ));
  spin.add(atmosphere);
  const pins = sites.map((site) => {
    const pin = makePin(site);
    pin.position.copy(seatOn(def.id, site.dir, layout.radius, 0.004));
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), site.dir);
    pin.scale.setScalar(1.15);
    spin.add(pin);
    const plate = plateSprite(site.name, site.state);
    spin.add(plate);
    const leader = leaderLine();
    pin.userData.plate = plate;
    pin.userData.leader = leader;
    return pin;
  });
  let moon = null;
  if (layout.moon) {
    moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xd5dde8, roughness: 0.9 }),
    );
    root.add(moon);
  }
  const label = textSprite(`${def.name}\n0/${sites.length} sites`);
  label.position.y = layout.radius + 0.85;
  root.add(label);
  return {
    id: def.id, name: def.name, root, spin, globe, territoryMap, pins, sites, clouds, moon, label,
    radius: layout.radius, spinRate: layout.spin, userSpin: 0,
  };
}

export class WorldMap {
  constructor(canvas, { onHover, onSelect } = {}) {
    this.canvas = canvas;
    this.onHover = onHover || null;
    this.onSelect = onSelect || null;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    this.clock = new THREE.Clock();
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.zoom = 0;
    this.zoomTarget = 0;
    this.planetIndex = 0;
    this.siteIndex = 0;
    this.culture = CULTURE;
    this._t = 0;
    this._drift = 0;
    this._raf = 0;
    this.running = false;
    this.hoverKey = null;
    this.propsReady = Promise.resolve();

    const sky = ignoreRaycast(new THREE.Mesh(
      new THREE.SphereGeometry(80, 48, 32),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide }),
    ));
    this.sky = sky;
    this.scene.add(sky);
    this.stars = starField();
    this.scene.add(this.stars);
    this.scene.add(new THREE.HemisphereLight(0xc5d6f0, 0x2a241c, 0.55));
    const sun = new THREE.DirectionalLight(0xfff1d4, 1.65);
    sun.position.set(-8, 6, 10);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x6f95d4, 0.4);
    fill.position.set(10, -2, 4);
    this.scene.add(fill);

    this.planets = STAR_SYSTEM.map((def) => buildPlanet(def, LAYOUT[def.id]));
    for (const planet of this.planets) {
      this.scene.add(planet.root);
      for (const pin of planet.pins) this.scene.add(pin.userData.leader);
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
      planet.territoryMap.userData.paint(planet.sites, this.culture);
      const won = planet.sites.filter((site) => site.state === 'completed').length;
      planet.label.userData.redraw(`${planet.name}\n${won}/${planet.sites.length} sites`);
      planet.pins.forEach((pin) => this._stylePin(pin));
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
  // the previous frame. `drift` slides the wide shot across the system.
  pose({ t = 0, zoom = 0, planetIndex = 0, spin = 0, hoverIndex = -1, drift = 0 } = {}) {
    this._t = t;
    this._drift = drift;
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
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-3.1 * dt));
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
    for (const [state, marker] of Object.entries(pin.userData.markers)) marker.visible = site.state === state;
    if (site.state === 'completed') {
      pin.userData.cloth.material.color.setHex(this.culture);
      pin.userData.cloth.material.emissive.setHex(this.culture);
    }
    pin.userData.plate?.userData.redraw(site.name, site.state);
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
    this.sky.rotation.y = this._t * 0.012;
    this.stars.material.uniforms.time.value = this._t;
    for (const planet of this.planets) {
      planet.spin.rotation.y = this._t * planet.spinRate + planet.userSpin;
      planet.clouds.rotation.y = this._t * 0.045;
      if (planet.moon) {
        const a = this._t * 0.22 + 0.6;
        planet.moon.position.set(Math.cos(a) * planet.radius * 1.85, 0.15, Math.sin(a) * planet.radius * 1.85);
        planet.moon.visible = this.zoom < 0.55;
      }
      planet.pins.forEach((pin, index) => {
        const site = planet.sites[index];
        const beacon = pin.userData.markers.open;
        if (beacon.userData.lamp) {
          beacon.userData.lamp.material.emissiveIntensity = site.state === 'open'
            ? 0.45 + Math.sin(this._t * 3.2 + index) * 0.35
            : 0.2;
        }
      });
    }
    const sway = Math.sin(this._t * 0.07) * 0.55 + this._drift * 3.6;
    const system = new THREE.Vector3(sway, 2.15 + Math.sin(this._t * 0.05) * 0.12, 15.5);
    const close = focus.root.position.clone().add(new THREE.Vector3(
      Math.sin(this._t * 0.12) * 0.12,
      focus.radius * 0.1,
      focus.radius * 2.85,
    ));
    const lookFar = new THREE.Vector3(this._drift * 2.8, 0.05, 0);
    const lookNear = focus.root.position.clone();
    const k = ease(this.zoom);
    this.camera.position.lerpVectors(system, close, k);
    this.camera.lookAt(lookFar.lerp(lookNear, k));
    this._layoutLabels();
    if (dt && this.hoverKey) {
      const planet = this.planets.find((entry) => entry.sites.some((site) => this._key(entry, site) === this.hoverKey));
      const site = planet?.sites.find((entry) => this._key(planet, entry) === this.hoverKey);
      if (site) this._emitSite(planet, site, this._hoverEvent || null);
    }
  }

  _layoutLabels() {
    this.camera.updateMatrixWorld();
    const cot = 1 / Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const aspect = this.camera.aspect || 1;
    const margin = 0.04;
    const focus = this.planets[this.planetIndex];
    const outward = new THREE.Vector3();
    const view = new THREE.Vector3();
    const anchor = new THREE.Vector3();
    const center = new THREE.Vector3();
    const items = [];
    for (const planet of this.planets) {
      planet.root.updateWorldMatrix(true, true);
      const show = this.zoom <= 0.4 || planet === focus;
      view.subVectors(this.camera.position, planet.root.position).normalize();
      center.copy(planet.root.position).project(this.camera);
      const dist = this.camera.position.distanceTo(planet.root.position);
      const limb = planet.radius / (dist * Math.tan((this.camera.fov * Math.PI / 180) / 2));
      for (const pin of planet.pins) {
        const plate = pin.userData.plate;
        const leader = pin.userData.leader;
        const site = pin.userData.site;
        outward.copy(site.dir).applyQuaternion(planet.spin.quaternion);
        const facing = show && outward.dot(view) > 0.18;
        plate.visible = facing;
        leader.visible = facing;
        if (!facing) continue;
        pin.getWorldPosition(anchor);
        const projected = anchor.clone().project(this.camera);
        if (projected.z < -1 || projected.z > 1) { plate.visible = false; leader.visible = false; continue; }
        const halfW = plate.scale.x * cot / (2 * aspect);
        const halfH = plate.scale.y * cot / 2;
        let vx = projected.x - center.x;
        let vy = projected.y - center.y;
        const len = Math.hypot(vx, vy) || 0.001;
        vx /= len;
        vy /= len;
        items.push({
          pin, plate, leader, anchor: anchor.clone(), z: projected.z,
          x: center.x + vx * (limb + halfH + 0.045),
          y: center.y + vy * (limb + halfH + 0.045),
          halfW, halfH,
        });
      }
    }
    for (let pass = 0; pass < 14; pass++) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const overlapX = a.halfW + b.halfW + 0.012 - Math.abs(dx);
          const overlapY = a.halfH + b.halfH + 0.014 - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;
          if (overlapX < overlapY) {
            const push = overlapX * 0.55;
            const sign = dx >= 0 ? 1 : -1;
            a.x -= sign * push;
            b.x += sign * push;
          } else {
            const push = overlapY * 0.55;
            const sign = dy >= 0 ? 1 : -1;
            a.y -= sign * push;
            b.y += sign * push;
          }
        }
      }
    }
    const ndc = new THREE.Vector3();
    for (const item of items) {
      const maxX = Math.max(0, 1 - item.halfW - margin);
      const maxY = Math.max(0, 1 - item.halfH - margin);
      item.x = Math.max(-maxX, Math.min(maxX, item.x));
      item.y = Math.max(-maxY, Math.min(maxY, item.y));
      ndc.set(item.x, item.y, item.z).unproject(this.camera);
      item.plate.position.copy(item.plate.parent.worldToLocal(ndc.clone()));
      const positions = item.leader.geometry.attributes.position;
      positions.setXYZ(0, item.anchor.x, item.anchor.y, item.anchor.z);
      positions.setXYZ(1, ndc.x, ndc.y, ndc.z);
      positions.needsUpdate = true;
      item.leader.geometry.computeBoundingSphere();
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
