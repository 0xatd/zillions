import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/resolve-three.mjs';
const {terrainOccludesHero,installHeroOcclusionShell}=await import('../src/hero-visibility.js');
const T=await import('three');
test('foreground cliff triggers a hero cue; open ground and cliffs behind the hero do not',()=>{
 const tiles=new Uint8Array(40*40),m={size:40,tiles,groundY:()=>0};
 const camera={x:10,y:12,z:30},hero={x:10,y:0,z:10};
 assert.equal(terrainOccludesHero(m,camera,hero),false);
 m.groundY=(x,z)=>z>11&&z<13?4:0;
 assert.equal(terrainOccludesHero(m,camera,hero),true);
 m.groundY=(x,z)=>z<9?4:0;
 assert.equal(terrainOccludesHero(m,camera,hero),false);
 assert.deepEqual(hero,{x:10,y:0,z:10},'visibility cannot move the simulation actor');
});
test('occlusion silhouette follows animated geometry and draws only obscured fragments',()=>{
 const body=new T.Group(),limb=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());body.add(limb);
 const [shell]=installHeroOcclusionShell(body);limb.position.x=3;body.updateMatrixWorld(true);
 assert.equal(shell.getWorldPosition(new T.Vector3()).x,3);
 assert.equal(shell.material.depthFunc,T.GreaterDepth);assert.equal(shell.material.depthWrite,false);
 assert.equal(shell.geometry,limb.geometry);assert.equal(shell.visible,false);
 limb.geometry.dispose();limb.material.dispose();shell.material.dispose();
});
