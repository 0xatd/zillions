// Reusable environment kit. All placement uses an independent presentation
// seed; large silhouettes stay on impassable tiles, never on playable lanes.
import * as THREE from 'three';
import { TILE } from './config.js';
import { makeRNG, makeNoise } from './utils.js';
import { environmentMaterial } from './environment-art.js';

// Bake a small sculpted kit into one geometry per material, then instance it.
// No texture downloads, per-prop objects or changes to collision footprints.
function joined(parts) {
  const positions=[], colors=[], normals=[];
  for (const {geo, color=0xffffff} of parts) {
    geo.computeVertexNormals();
    const g=geo.index?geo.toNonIndexed():geo;
    const p=g.attributes.position,c=new THREE.Color(color);
    for(let i=0;i<p.count;i++) {positions.push(p.getX(i),p.getY(i),p.getZ(i));colors.push(c.r,c.g,c.b);normals.push(g.attributes.normal.getX(i),g.attributes.normal.getY(i),g.attributes.normal.getZ(i));}
    if(g!==geo)g.dispose();geo.dispose();
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));return g;
}
function ellipsoid(x,y,z,sx,sy,sz,color,seed=0) {
  const geo=new THREE.SphereGeometry(1,8,6),p=geo.attributes.position;
  for(let i=0;i<p.count;i++){
    const a=p.getX(i),b=p.getY(i),c=p.getZ(i);
    const l=1+.13*Math.sin(a*5+c*4+seed)*Math.cos(b*4-c*3);
    p.setXYZ(i,x+a*sx*l,y+b*sy*l,z+c*sz*l);
  }
  return {geo,color};
}
function branch(a,b,r0,r1,color) {
  const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),dir=to.clone().sub(from);
  const geo=new THREE.CylinderGeometry(r1,r0,dir.length(),6);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize()));
  geo.translate(...from.add(to).multiplyScalar(.5).toArray());return {geo,color};
}
function broadleaf(){
  return joined([
    ellipsoid(0,2.6,0,.72,.67,.68,0xe4e8ca),
    ellipsoid(-.55,2.1,.12,.58,.58,.55,0xbbc6a6,2),
    ellipsoid(.48,2.28,.28,.62,.6,.58,0xd1d9b8,4),
    ellipsoid(.1,2.02,-.5,.58,.5,.54,0xa5b798,7),
    ellipsoid(-.16,2.94,-.13,.48,.4,.48,0xf3eed2,3),
  ]);
}
function pine(){
  const parts=[];
  for(let k=0;k<4;k++){
    const y=.95+k*.62,r=.86-k*.17,h=1.25-k*.12;
    const geo=new THREE.ConeGeometry(r,h,9,2),p=geo.attributes.position;
    for(let i=0;i<p.count;i++){
      const a=p.getX(i),b=p.getY(i),c=p.getZ(i),wave=1+.14*Math.sin(Math.atan2(c,a)*5+k);
      p.setXYZ(i,a*wave,b+y+.06*Math.sin(a*8+c*7),c*wave);
    }
    parts.push({geo,color:[0x93a68b,0xb2c2a0,0xcad5b1,0xe2e4c1][k]});
  }return joined(parts);
}
function instanced(group,name,geo,mat,spots,map,shadow=true){
  if(!spots.length){geo.dispose();mat.dispose();return;}
  const mesh=new THREE.InstancedMesh(geo,mat,spots.length);mesh.name=name;
  const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),scale=new THREE.Vector3(),pos=new THREE.Vector3(),c=new THREE.Color();
  for(let i=0;i<spots.length;i++){
    const s=spots[i];q.setFromEuler(new THREE.Euler(s.rx||0,s.r||0,s.rz||0));
    scale.set(s.sx??s.s??1,s.sy??s.s??1,s.sz??s.s??1);
    pos.set(s.x,(s.y??map.groundY(s.x,s.z))+(s.lift||0),s.z);
    matrix.compose(pos,q,scale);mesh.setMatrixAt(i,matrix);
    if(s.color!==undefined)mesh.setColorAt(i,c.set(s.color));
  }
  mesh.castShadow=shadow;mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);return mesh;
}

export function buildForest(map){
  const group=new THREE.Group();group.name='landscape-forest';
  const rng=makeRNG((map.seed*47+183)>>>0),patch=makeNoise(makeRNG((map.seed*11+7)>>>0));
  const oaks=[],pines=[],trunks=[],shrubs=[];
  const base=new THREE.Color(map.theme?.palette?.canopy??map.colorOf(TILE.FOREST));
  const c=new THREE.Color();
  for(let z=1;z<map.size-1;z++)for(let x=1;x<map.size-1;x++){
    if(map.tiles[map.idx(x,z)]!==TILE.FOREST)continue;
    const grove=patch(x*.09,z*.09,2);
    if(rng()>.48+grove*.3)continue;
    const s=.68+rng()*.42;
    const spot={x:x+.25+rng()*.5,z:z+.25+rng()*.5,sx:s,sy:s*(.9+rng()*.3),sz:s,r:rng()*Math.PI*2};
    c.copy(base).offsetHSL((grove-.5)*.055,-.03,(grove-.5)*.07);
    const conifer=map.terrainKind==='hills'||rng()<.16+grove*.3;
    if(conifer)c.multiplyScalar(.85);
    spot.color=c.getHex();(conifer?pines:oaks).push(spot);
    trunks.push({...spot,color:0xffffff});
    if(rng()<.24)shrubs.push({x:spot.x,z:spot.z,s:.45+rng()*.35,r:spot.r,color:base.clone().multiplyScalar(.7).getHex()});
  }
  const wood=joined([
    branch([0,0,0],[.06,2.15,0],.15,.06,0x71604b),
    branch([0,.9,0],[-.6,1.9,.1],.075,.025,0x8c7957),
    branch([.03,1.15,0],[.6,2,.3],.065,.02,0x8c7957),
    ...[0,2.1,4.2].map(a=>branch([Math.cos(a)*.38,.02,Math.sin(a)*.38],[0,.4,0],.045,.09,0x62533f)),
  ]);
  instanced(group,'forest-trunks',wood,environmentMaterial('building',{vertexColors:true}),trunks,map);
  instanced(group,'forest-broadleaf',broadleaf(),environmentMaterial('foliage',{vertexColors:true}),oaks,map);
  instanced(group,'forest-conifers',pine(),environmentMaterial('foliage',{vertexColors:true}),pines,map);
  instanced(group,'forest-understory',joined([ellipsoid(0,.3,0,.6,.4,.5,0xc6c9aa)]),environmentMaterial('foliage',{vertexColors:true}),shrubs,map,false);
  return group;
}

export function buildLandscapeEdges(map){
  const group=new THREE.Group();group.name='landscape-edges';
  const rng=makeRNG((map.seed*67+913)>>>0),boulders=[],bushes=[],reeds=[],logs=[];
  const color=new THREE.Color(map.colorOf(TILE.MOUNTAIN));
  const green=new THREE.Color(map.theme?.palette?.canopy??map.colorOf(TILE.FOREST));
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  for(let z=2;z<map.size-2;z++)for(let x=2;x<map.size-2;x++){
    const i=map.idx(x,z),tile=map.tiles[i];
    const neighbors=dirs.map(([dx,dz])=>map.tiles[map.idx(x+dx,z+dz)]);
    // Large dressing only occupies terrain the simulation already blocks.
    // Keep a margin to paths and retain all switchback/ledge surfaces exactly.
    if(tile===TILE.MOUNTAIN&&!map.isLedgeRock(i)&&neighbors.some(t=>t!==TILE.MOUNTAIN)&&rng()<.24){
      boulders.push({x:x+.5,z:z+.5,sx:.55+rng()*.3,sy:.6+rng()*.7,sz:.55+rng()*.3,r:rng()*6.28,color:color.clone().multiplyScalar(.85+rng()*.3).getHex()});
    }
    if(tile===TILE.FOREST&&neighbors.some(t=>t===TILE.GRASS)&&rng()<.26){
      bushes.push({x:x+.5,z:z+.5,s:.5+rng()*.4,r:rng()*6.28,color:green.clone().multiplyScalar(.8+rng()*.22).getHex()});
      // Fallen trunks stay completely inside a three-tile forest run.
      if(neighbors.every(t=>t===TILE.FOREST||t===TILE.GRASS)&&map.tiles[map.idx(x-1,z)]===TILE.FOREST&&map.tiles[map.idx(x+1,z)]===TILE.FOREST&&rng()<.12)
        logs.push({x:x+.5,z:z+.5,s:.7+rng()*.25,r:0});
    }
    if(tile===TILE.WATER&&!map.isLava()&&neighbors.some(t=>t===TILE.GRASS||t===TILE.SAND)&&rng()<.3){
      reeds.push({x:x+.25+rng()*.5,z:z+.25+rng()*.5,y:-.24,s:.7+rng()*.6,r:rng()*6.28,color:green.clone().lerp(new THREE.Color(0xa59e61),.45).getHex()});
    }
  }
  instanced(group,'edge-outcrops',joined([
    ellipsoid(-.2,.35,0,.55,.5,.5,0xb7b2a7,3),ellipsoid(.25,.6,.1,.5,.8,.48,0xe0d9c7,5),ellipsoid(.3,.13,-.4,.36,.23,.32,0xa5a18e,1),
  ]),environmentMaterial('rock',{vertexColors:true}),boulders,map);
  instanced(group,'edge-shrubs',joined([ellipsoid(-.25,.3,0,.48,.38,.4,0xaab99a),ellipsoid(.25,.45,.12,.44,.5,.4,0xd6d6ad,2)]),environmentMaterial('foliage',{vertexColors:true}),bushes,map,false);
  const blades=[];
  for(let i=0;i<7;i++){
    const a=i*2.399,x=Math.cos(a)*.18,z=Math.sin(a)*.18,h=.65+(i%3)*.16;
    blades.push(branch([x,0,z],[x*1.7,h,z*1.7],.025,.009,0xc5c3a0));
    if(i%2===0)blades.push(branch([x*1.6,h*.8,z*1.6],[x*1.7,h,z*1.7],.046,.035,0x786044));
  }
  instanced(group,'shore-reeds',joined(blades),environmentMaterial('foliage',{vertexColors:true}),reeds,map,false);
  instanced(group,'fallen-timber',joined([
    branch([-.95,.2,0],[.95,.3,0],.22,.16,0x6e5840),
    branch([-.97,.2,0],[-.99,.2,0],.17,.17,0xc3a471),
    branch([.15,.24,0],[.4,.7,.2],.07,.03,0x816448),
  ]),environmentMaterial('building',{vertexColors:true}),logs,map);
  return group;
}
