// Presentation-only visibility cue. Terrain can legitimately stand between the
// fixed-yaw camera and the player's hero; never move the actor or flatten it.
import * as THREE from 'three';
import { TILE } from './config.js';
import { biomeKit } from './world-art-kit.js';

export function terrainOccludesHero(map, camera, feet) {
  const dx=camera.x-feet.x,dz=camera.z-feet.z;
  const steps=Math.min(160,Math.max(2,Math.ceil(Math.hypot(dx,dz)*2)));
  const crown=biomeKit(map).cliffs;
  for(let i=1;i<steps;i++){
    const t=i/steps,x=feet.x+dx*t,z=feet.z+dz*t;
    if(x<0||z<0||x>=map.size||z>=map.size)continue;
    const k=Math.floor(z)*map.size+Math.floor(x);
    const extra=map.tiles[k]===TILE.MOUNTAIN&&map.ledgeW?.[k]>=.999
      ? crown.lift+crown.relief*1.58 : 0;
    const sightY=feet.y+.45+(camera.y-feet.y-.45)*t;
    if(map.groundY(x,z)+extra>sightY+.06)return true;
  }
  return false;
}

export function installHeroOcclusionShell(body) {
  const originals=[];
  body.traverse(o=>{if(o.isMesh&&!o.userData.ink)originals.push(o);});
  const material=new THREE.MeshBasicMaterial({color:0xffd779,transparent:true,
    opacity:.65,depthWrite:false,depthTest:true,depthFunc:THREE.GreaterDepth,toneMapped:false});
  return originals.map(source=>{
    // Child placement inherits the exact animated limb/weapon transform.
    const shell=new THREE.Mesh(source.geometry,material);
    shell.name='hero-occlusion-silhouette';shell.visible=false;shell.renderOrder=20;
    shell.userData.keepOpacity=true;shell.userData.sharedGeometry=true;
    shell.userData.noOutline=true;source.add(shell);return shell;
  });
}
