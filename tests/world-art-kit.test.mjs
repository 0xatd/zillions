import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/resolve-three.mjs';
const {buildForest}=await import('../src/landscape-art.js');
const {TILE}=await import('../src/config.js');
const {buildColonyStreets}=await import('../src/colony-art.js');
test('culture paving stays consistent across biomes while service-lane dust changes',()=>{
  const roads={tiles:[[1,1],[2,1]],routes:[{primary:true,points:[[1,1]]}]};
  const render=(terrainKind,culture)=>buildColonyStreets({terrainKind,groundY:()=>0},roads,culture);
  const wet=render('fen','european'),cold=render('hills','european'),other=render('fen','asian');
  assert.equal(wet.children.length,3);
  assert.notEqual(wet.children[0].material.color.getHex(),cold.children[0].material.color.getHex());
  assert.equal(wet.children[2].material.color.getHex(),cold.children[2].material.color.getHex());
  assert.notEqual(wet.children[2].material.color.getHex(),other.children[2].material.color.getHex());
  assert.deepEqual(wet.children[2].geometry.attributes.position.array,other.children[2].geometry.attributes.position.array);
  for(const g of [wet,cold,other])g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});
test('same terrain mask produces frozen conifers versus wetland broadleaf without mutating terrain',()=>{
  const tiles=new Uint8Array(16*16).fill(TILE.FOREST),before=tiles.slice();
  const map=kind=>({seed:91,size:16,tiles,terrainKind:kind,idx:(x,z)=>z*16+x,groundY:()=>0,colorOf:()=>0x768970});
  const cold=buildForest(map('hills')),wet=buildForest(map('fen'));
  assert.ok(cold.getObjectByName('forest-conifers')?.count>0);
  assert.equal(cold.getObjectByName('forest-broadleaf'),undefined);
  assert.ok(wet.getObjectByName('forest-broadleaf')?.count>0);
  assert.deepEqual(tiles,before);
  for(const g of [cold,wet])g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});
