import test from 'node:test';
import assert from 'node:assert/strict';
import {stampPrefab,resolveConnections,MAP_PREFABS} from '../src/map-kit.js';

test('a rotated gatehouse retains a three-tile walkable passage between its walls',()=>{
 const placed=stampPrefab(MAP_PREFABS.gatehouse,{x:20,z:20,rotation:1});
 const gates=placed.filter(c=>c.piece==='gate');
 assert.deepEqual(gates.map(c=>[c.x,c.z]),[[20,19],[20,20],[20,21]]);
 const walls=placed.filter(c=>c.piece==='wall');
 assert.ok(walls.every(c=>c.x===20&&(c.z<19||c.z>21)));
 assert.equal(new Set(placed.map(c=>`${c.x},${c.z}`)).size,placed.length);
 assert.throws(()=>stampPrefab(MAP_PREFABS.gatehouse,{x:.5,z:2}),/tile grid/);
});
test('adjoining route brushes resolve a bend and a T junction regardless of placement order',()=>{
 const cells=[{piece:'road',x:4,z:3},{piece:'plaza',x:4,z:4},{piece:'road',x:5,z:4},{piece:'road',x:3,z:4},{piece:'road',x:5,z:5}];
 for(const order of [cells,[...cells].reverse()]){
  const resolved=resolveConnections(order);
  assert.equal(resolved.find(c=>c.x===4&&c.z===4).shape,'junction');
  assert.equal(resolved.find(c=>c.x===5&&c.z===4).shape,'corner');
 }
 assert.throws(()=>resolveConnections([...cells,cells[0]]),/Overlapping/);
 for(const piece of ['missing','constructor','__proto__'])assert.throws(()=>resolveConnections([{piece,x:0,z:0}]),/Unknown/);
});

test('terrain and defense pieces govern actual routes, including rotated gates and elevation',async()=>{
 const {compileMapLayout,findMapRoute,MAP_KIT_VERSION}=await import('../src/map-kit.js');
 const barrier=Array.from({length:12},(_,z)=>({piece:'wall',x:6,z}));
 const layout={version:MAP_KIT_VERSION,size:12,cells:barrier};
 assert.equal(findMapRoute(compileMapLayout(layout),[2,6],[9,6]),null);
 barrier[6]={piece:'gate',x:6,z:6};
 assert.ok(findMapRoute(compileMapLayout(layout),[2,6],[9,6]).some(([x,z])=>x===6&&z===6));
 barrier[6]={piece:'water',x:6,z:6};assert.equal(findMapRoute(compileMapLayout(layout),[2,6],[9,6]),null);
 const raised={version:MAP_KIT_VERSION,size:12,cells:[{piece:'stone',x:5,z:5,elevation:1}]};
 assert.equal(findMapRoute(compileMapLayout(raised),[4,5],[5,5]),null);
 raised.cells.push({piece:'ramp',x:4,z:5});assert.ok(findMapRoute(compileMapLayout(raised),[3,5],[5,5]));
 assert.throws(()=>compileMapLayout({...raised,cells:[{piece:'grass',x:12,z:0}]}),/outside/);
});
