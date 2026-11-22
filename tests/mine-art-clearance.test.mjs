import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../scripts/resolve-three.mjs';
const {Box3}=await import('three');
const {GLTFLoader}=await import('../vendor/GLTFLoader.js');

test('mine drive machinery stays above ground and inside its plot through a full rotation',async()=>{
  // The renderer's existing rotor contract is Z-axis rotation. A vertical
  // auger incorrectly bound to that part sweeps outside its two-tile plot.
  for(const tier of [1,2,3]){
    const bytes=await readFile(new URL(`../assets/kit/european/mine_t${tier}.glb`,import.meta.url));
    const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    const rotor=scene.getObjectByName('part_rotor');
    assert.ok(rotor,'mine must retain its animated drive');
    for(let step=0;step<=32;step++){
      rotor.rotation.z=step*Math.PI/16;
      scene.updateMatrixWorld(true);
      const bounds=new Box3().setFromObject(rotor,true);
      assert.ok(bounds.min.y>=0,`T${tier}: machinery cuts below ground`);
      assert.ok(bounds.min.x>=-1 && bounds.max.x<=1 && bounds.min.z>=-1 && bounds.max.z<=1,
        `T${tier}: machinery sweeps outside its two-tile plot at phase ${step}`);
    }
    scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
  }
});
