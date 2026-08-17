import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { unitPose } from './src/art-state.js';

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
const state = document.querySelector('#state');
const status = document.querySelector('#status');
for (const [label, value] of ASSETS) select.add(new Option(label, value));
const requestedAsset = new URLSearchParams(location.search).get('asset');
if (requestedAsset && ASSETS.some(([, value]) => value === requestedAsset)) select.value = requestedAsset;
const requestedState = new URLSearchParams(location.search).get('state');
if (requestedState && [...state.options].some((option) => option.value === requestedState)) state.value = requestedState;

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
let parts = {};

async function load() {
  status.textContent = 'Loading asset...';
  if (current) scene.remove(current);
  const gltf = await loader.loadAsync(`assets/art-slice/${select.value}.glb`);
  current = gltf.scene;
  originalMaterials = [];
  parts = {};
  current.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    originalMaterials.push([o, o.material]);
    if (o.name) {
      o.userData.reviewRotation = o.rotation.clone();
      o.userData.reviewPosition = o.position.clone();
      parts[o.name] = o;
    }
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
  if (current) {
    current.rotation.y = time * 0.00022;
    const seconds = time / 1000;
    const isUnit = !!(parts.leg_l || parts.leg_r);
    let reviewState = state.value;
    if (reviewState === 'auto') {
      const sequence = isUnit ? ['idle', 'run', 'attack', 'cast', 'hit'] : ['operational', 'constructing', 'damaged', 'critical'];
      reviewState = sequence[Math.floor(seconds / 2.2) % sequence.length];
    }
    if (isUnit) {
      if (!['idle', 'run', 'attack', 'cast', 'hit', 'down'].includes(reviewState)) reviewState = 'idle';
      const pulse = (Math.sin(seconds * 4) + 1) / 2;
      const pose = unitPose(reviewState, seconds * (reviewState === 'run' ? 10 : 1.8), { pulse, melee: false });
      const body = parts.body;
      if (body?.userData.reviewPosition) {
        body.position.copy(body.userData.reviewPosition);
        body.position.y += pose.y;
        body.position.z += pose.z;
        body.rotation.copy(body.userData.reviewRotation);
        body.rotation.x += pose.pitch;
        body.rotation.z += pose.roll;
      }
      for (const [name, sign] of [['leg_l', 1], ['leg_r', -1]]) {
        if (!parts[name]) continue;
        parts[name].rotation.copy(parts[name].userData.reviewRotation);
        parts[name].rotation.x += pose.stride * sign;
      }
      for (const [name, sign] of [['arm_l', -1], ['arm_r', 1]]) {
        if (!parts[name]) continue;
        parts[name].rotation.copy(parts[name].userData.reviewRotation);
        parts[name].rotation.x += pose.stride * sign * 0.55 - (reviewState === 'cast' ? pulse : 0);
      }
    } else {
      const construction = reviewState === 'constructing';
      const damage = reviewState === 'critical' ? 0.75 : reviewState === 'damaged' ? 0.45 : 0;
      const reveal = construction ? 0.08 + ((Math.sin(seconds * 2) + 1) / 2) * 0.92 : 1;
      current.scale.set(1, reveal, 1);
      for (const [mesh, material] of originalMaterials) {
        if (mesh.material === black || !material.color) continue;
        if (!material.userData.reviewColor) material.userData.reviewColor = material.color.clone();
        if (material.userData.reviewEmissiveIntensity === undefined) material.userData.reviewEmissiveIntensity = material.emissiveIntensity || 0;
        const base = material.userData.reviewColor;
        material.color.setRGB(base.r * (1 - damage), base.g * (1 - damage * 1.15), base.b * (1 - damage * 1.2));
        material.transparent = construction;
        material.opacity = construction ? 0.65 : 1;
        if (material.emissiveIntensity !== undefined) {
          if (!material.userData.reviewEmissive && material.emissive) material.userData.reviewEmissive = material.emissive.clone();
          if (material.emissive && material.userData.reviewEmissive) {
            material.emissive.copy(material.userData.reviewEmissive);
            if (reviewState === 'critical') material.emissive.lerp(new THREE.Color(0xff321f), 0.72);
          }
          material.emissiveIntensity = reviewState === 'critical'
            ? Math.max(0.5, material.userData.reviewEmissiveIntensity) * (0.2 + Math.max(0, Math.sin(seconds * 17)))
            : material.userData.reviewEmissiveIntensity;
        }
      }
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

select.addEventListener('change', () => load().catch((error) => { status.textContent = error.message; }));
silhouette.addEventListener('change', applyView);
close.addEventListener('change', applyView);
state.addEventListener('change', applyView);
load().catch((error) => { status.textContent = error.message; });
requestAnimationFrame(frame);
