import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('runtime marine kit ships real GLB bytes, not successful-HTTP LFS pointers',async()=>{
 let total=0;
 for(const file of ['marine_kit.glb','marine_kit_lo.glb']){
  const bytes=await readFile(new URL(`../assets/art-marines/kit/${file}`,import.meta.url));
  assert.equal(bytes.toString('ascii',0,4),'glTF',`${file}: static deployments must receive a model`);
  assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length);
  total+=bytes.length;
 }
 assert.ok(total<2*1024*1024,'keep the boot-time kit under 2 MiB');
});
