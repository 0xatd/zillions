import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';

const ASSETS = [
  ['Scott English', 'hero_scott'], ['Rifle squad', 'human_rifleman'], ['Hive drone', 'hive_drone'],
  ['HQ tier 1', 'human_hq_t1'], ['HQ tier 2', 'human_hq_t2'], ['HQ tier 3', 'human_hq_t3'],
  ['Tower tier 1', 'human_tower_t1'], ['Tower tier 2', 'human_tower_t2'], ['Tower tier 3', 'human_tower_t3'],
  ['Barracks tier 1', 'human_barracks_t1'], ['Barracks tier 2', 'human_barracks_t2'], ['Barracks tier 3', 'human_barracks_t3'],
  ['Coin mine', 'human_mine'], ['Wall module', 'human_wall'], ['Gate module', 'human_gate'],
];

const canvas = document.querySelector('#view');
const select = document.querySelector('#asset');
const silhouette = document.querySelector('#silhouette');
const close = document.querySelector('#close');
const status = document.querySelector('#status');
for (const [label, value] of ASSETS) select.add(new Option(label, value));
const requestedAsset = new URLSearchParams(location.search).get('asset');
if (requestedAsset && ASSETS.some(([, value]) => value === requestedAsset)) select.value = requestedAsset;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d131b);
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
scene.add(new THREE.HemisphereLight(0xc6ddff, 0x19120e, 2.2));
const sun = new THREE.DirectionalLight(0xffe6c4, 3.2);
sun.position.set(-7, 12, 8);
sun.castShadow = true;
scene.add(sun);
const rim = new THREE.DirectionalLight(0x4ee5dc, 2.4);
rim.position.set(8, 6, -8);
scene.add(rim);
const ground = new THREE.Mesh(new THREE.CircleGeometry(18, 64), new THREE.MeshStandardMaterial({ color: 0x252b31, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const loader = new GLTFLoader();
const black = new THREE.MeshBasicMaterial({ color: 0x050505 });
let current = null;
let originalMaterials = [];
let radius = 2;

async function load() {
  status.textContent = 'Loading asset...';
  if (current) scene.remove(current);
  const gltf = await loader.loadAsync(`assets/art-slice/${select.value}.glb`);
  current = gltf.scene;
  originalMaterials = [];
  current.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    originalMaterials.push([o, o.material]);
  });
  const box = new THREE.Box3().setFromObject(current);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  current.position.sub(center);
  current.position.y += size.y / 2;
  radius = Math.max(size.x, size.y, size.z);
  scene.add(current);
  applyView();
  status.textContent = `${select.options[select.selectedIndex].text} · ${originalMaterials.length} mesh parts`;
}

function applyView() {
  for (const [mesh, material] of originalMaterials) mesh.material = silhouette.checked ? black : material;
  const distance = radius * (close.checked ? 1.45 : 2.35);
  // Blender's +Y authored front becomes -Z in glTF's Y-up space.
  camera.position.set(distance * 0.72, distance * 0.58, -distance);
  camera.lookAt(0, radius * 0.38, 0);
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function frame(time) {
  resize();
  if (current) current.rotation.y = time * 0.00022;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

select.addEventListener('change', () => load().catch((error) => { status.textContent = error.message; }));
silhouette.addEventListener('change', applyView);
close.addEventListener('change', applyView);
load().catch((error) => { status.textContent = error.message; });
requestAnimationFrame(frame);
