// Grid of runtime-assembled marines (src/marine-assembler.js). Every tile is
// assembleMarine(hashSeed(seed, i)); reload with the same ?seed= and you get
// the same squad.
import * as THREE from 'three';
import { loadMarineKit, assembleMarine, setMarineLod, hashSeed, CHAPTERS } from './src/marine-assembler.js';

const q = new URLSearchParams(location.search);
const base = q.get('seed') || 'zillions-demo';
const count = Math.max(1, Math.min(64, Number(q.get('count') || 16)));
const forcedChapter = q.get('chapter');
const forcedRole = q.get('role');
const view = q.get('view') || 'rts';
const status = document.querySelector('#status');

const canvas = document.querySelector('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a222c);
scene.add(new THREE.HemisphereLight(0xc6ddff, 0x2a2018, 1.6));
const key = new THREE.DirectionalLight(0xffe6c4, 3.0);
key.position.set(-8, 14, 10);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fd8ff, 2.2);
rim.position.set(8, 7, -10);
scene.add(rim);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x39434c, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const cols = Math.ceil(Math.sqrt(count * 2));
const rows = Math.ceil(count / cols);
const sp = 1.7;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
function frame() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  const halfW = (cols * sp) / 2 + 0.8;
  const halfH = halfW * (h / w);
  Object.assign(camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
  camera.updateProjectionMatrix();
}
const el = view === 'front' ? 0.12 : 0.85;
// Kit marines face -Z (glTF forward), so the camera sits on the -Z side.
camera.position.set(Math.sin(0.35) * 30, 30 * Math.sin(el) + 1, Math.cos(0.35) * 30 * Math.cos(el));
camera.lookAt(0, 0.9, 0);
addEventListener('resize', frame);
frame();

const chapters = Object.keys(CHAPTERS);
const roles = ['soldier', 'ranger', 'sniper', 'heavy', 'melee', 'soldier', 'soldier', 'default'];
const ok = await loadMarineKit();
if (!ok) {
  status.textContent = 'Kit missing: run blender -b -P tools/art/build_hero_marines.py -- --kit';
} else {
  for (let i = 0; i < count; i++) {
    const chapter = forcedChapter || chapters[Math.floor(i / 2) % chapters.length];
    const role = forcedRole || roles[i % roles.length];
    const m = assembleMarine(hashSeed(base, i), { chapter, role, merge: q.get('merge') !== '0' });
    if (!m) continue;
    if (q.get('lod') === 'lo') setMarineLod(m.node, true);
    m.node.position.set((i % cols - (cols - 1) / 2) * sp, 0, (Math.floor(i / cols) - (rows - 1) / 2) * sp * 1.25);
    scene.add(m.node);
  }
  status.textContent = `${count} marines from seed "${base}"`;
}
renderer.render(scene, camera);
const info = renderer.info.render;
let nodes = 0; scene.traverse(() => nodes++);
window.__stats = { nodes, calls: info.calls, triangles: info.triangles, perMarineTris: Math.round(info.triangles / Math.max(1, count)) };
status.textContent += ` | ${info.calls} draws, ${info.triangles} tris, ${nodes} nodes`;
document.body.dataset.ready = '1';
renderer.setAnimationLoop(() => renderer.render(scene, camera));
