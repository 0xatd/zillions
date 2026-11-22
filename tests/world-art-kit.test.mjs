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

test('expedition lane guides stay on straight paved cells and leave junctions clear',()=>{
  const tiles=[[1,2],[2,2],[3,2],[4,2],[5,2],[3,1],[3,3]];
  const roads={tiles,routes:[{primary:true,points:tiles.map(([x,z])=>[x+.5,z+.5])}]};
  const map={terrainKind:'fen',groundY:(x,z)=>x*.1+z*.2};
  const group=buildColonyStreets(map,roads);
  const guides=group.getObjectByName('colony-lane-guides');
  assert.ok(guides,'straight road must have visible guide markings');
  const p=guides.geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),z=p.getZ(i);
    assert.ok(tiles.some(([tx,tz])=>x>tx&&x<tx+1&&z>tz&&z<tz+1),'guide left its road tile');
    assert.ok(!(x>3&&x<4&&z>2&&z<3),'guide occupies a junction');
    assert.ok(Math.abs(p.getY(i)-map.groundY(x,z)-.08)<1e-6,'guide floats above graded road');
  }
  group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});
