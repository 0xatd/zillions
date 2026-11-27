// Original painted RTS materials. Presentation only: world-space texturing
// never changes the tile graph, building footprints, or simulation RNG.
import * as THREE from 'three';
import { TILE } from './config.js';
let sharedAtlas;
function atlas() {
  if (sharedAtlas) return sharedAtlas;
  if (typeof document === 'undefined') {
    sharedAtlas = new THREE.DataTexture(new Uint8Array([180,180,180,255]), 1, 1);
    sharedAtlas.needsUpdate = true;
  } else {
    sharedAtlas = new THREE.TextureLoader().load('/assets/materials/frontier-atlas.webp');
    sharedAtlas.colorSpace = THREE.SRGBColorSpace;
    sharedAtlas.anisotropy = 8;
  }
  return sharedAtlas;
}

export function groundControl(map) {
  const N = map.size, data = new Uint8Array(N * N * 4);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const tile = map.tiles[z * N + x];
    let wear = tile === TILE.PATH || tile === TILE.SAND ? 1 : 0;
    // Working ground around the keep, grassy shoulders around each district.
    for (const site of map.sites) {
      const d = Math.hypot(x + .5 - site.x, z + .5 - site.z);
      wear = Math.max(wear, Math.max(0, 1 - d / 20) * .92);
    }
    const k = (z * N + x) * 4;
    data[k] = Math.round(wear * 255);
    data[k + 1] = tile === TILE.FOREST ? 255 : 0;
    data[k + 2] = tile === TILE.MOUNTAIN ? 255 : 0;
    data[k + 3] = tile === TILE.WATER ? 255 : 0;
  }
  const texture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const functions = /* glsl */`
  uniform sampler2D artAtlas;
  uniform sampler2D artControl;
  uniform float artMapSize;
  uniform float artOrganic;
  varying vec3 artWorld;
  float artHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float artNoise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(artHash(i),artHash(i+vec2(1,0)),f.x),mix(artHash(i+vec2(0,1)),artHash(i+vec2(1,1)),f.x),f.y);
  }
  vec3 artSample(vec2 p, vec2 quadrant) {
    // Inset prevents atlas neighbours bleeding through the mip chain.
    return texture2D(artAtlas,(quadrant + .015 + (1.0-abs(mod(p,2.0)-1.0))*.97)*.5).rgb;
  }
`;

export function environmentMaterial(kind, options = {}) {
  const { control = null, size = 200, organic = 1, unlit = false, ...params } = options;
  const material = unlit ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params);
  if (control) material.addEventListener('dispose', () => control.dispose());
  material.onBeforeCompile = shader => {
    shader.uniforms.artAtlas = { value: atlas() };
    shader.uniforms.artControl = { value: control || atlas() };
    shader.uniforms.artMapSize = { value: size };
    shader.uniforms.artOrganic = { value: organic };
    shader.vertexShader = 'varying vec3 artWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 artPosition=vec4(position,1.0);\n#ifdef USE_INSTANCING\nartPosition=instanceMatrix*artPosition;\n#endif\nartWorld=(modelMatrix*artPosition).xyz;');
    shader.fragmentShader = functions + shader.fragmentShader;
    const terrain = /* glsl */`
      vec2 p=artWorld.xz;
      vec3 control=texture2D(artControl,p/artMapSize).rgb;
      float noise=artNoise(p*.21)*.7+artNoise(p*.61)*.3;
      float macro=artNoise(p*.045+vec2(19,7));
      // Broad painted meadows with irregular worn edges, not a noisy carpet.
      // Distinct connected soil clearings; narrow broken turf edges, not
      // a full-screen blend of two equally noisy textures.
      float boundary=control.r + (artNoise(p*.32)-.5)*.31 + (artNoise(p*3.6)-.5)*.12;
      float dirt=smoothstep(.33,.42,boundary);

      vec3 grass=artSample(p*.25,vec2(0,1));
      vec3 soil=artSample(p*.20,vec2(1,1));
      float luminosity=max(.07,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
      vec3 tint=mix(vec3(1),diffuseColor.rgb/luminosity,.36);
      float grassValue=dot(grass,vec3(.2126,.7152,.0722));
      grass=mix(vec3(.16,.245,.075),grass,.28);
      soil=mix(vec3(.34,.235,.125),soil,.32);
      grass*=mix(vec3(.85,.94,1.0),vec3(1.08,1.04,.85),macro);
      vec3 painted=mix(grass,soil,dirt)*tint;
      // Forest floors and scree have their own material; preserve biome hue.
      vec3 woodland=soil*vec3(.62,.72,.55)*tint;
      painted=mix(painted,woodland,control.g*.72*artOrganic);
      painted=mix(painted,artSample(p*.22,vec2(1,0))*tint,control.b*.72);

      float grain=dot(painted,vec3(.2126,.7152,.0722));
      painted=mix(diffuseColor.rgb*(.7+grain*2.0),painted,artOrganic);
      // Keep snow, ash and blight identities; texture is a material layer.
      diffuseColor.rgb=mix(diffuseColor.rgb,painted*1.25,.90);
      diffuseColor.rgb*=mix(.94,1.06,macro)*mix(.98,1.02,noise);
    `;
    const stone = /* glsl */`
      vec3 face=abs(normalize(cross(dFdx(artWorld),dFdy(artWorld))));
      vec2 stoneUV=face.y>.65?artWorld.xz:vec2(face.x>face.z?artWorld.z:artWorld.x,artWorld.y);
      vec3 painted=artSample(stoneUV*.32,vec2(0,0));
      // Broad ashlar courses, softened joints and mineral variation. The
      // structural trim stays legible instead of inheriting busy paving.
      float row=floor(stoneUV.y*2.4);
      vec2 block=vec2(stoneUV.x*1.8+mod(row,2.)*.5,stoneUV.y*2.4);
      vec2 edge=min(fract(block),1.-fract(block));
      float mortar=1.-smoothstep(.018,.058,min(edge.x,edge.y));
      float blockTone=.94+.12*artHash(floor(block));
      diffuseColor.rgb*=(painted*1.65+.55)*blockTone*(1.-mortar*.23);
    `;
    const soil = /* glsl */`
      vec3 earth=artSample(artWorld.xz*.24,vec2(1,1));
      diffuseColor.rgb*=earth*2.2+.25;
    `;
    const rock = /* glsl */`
      vec3 face=abs(normalize(cross(dFdx(artWorld),dFdy(artWorld))));
      float horizontal=face.x>face.z?artWorld.z:artWorld.x;
      float top=smoothstep(.45,.85,face.y);
      vec2 p=mix(vec2(horizontal*.24,artWorld.y*.32),artWorld.xz*.24,top);
      float warp=artNoise(vec2(horizontal*.7,artWorld.y*.23));
      vec3 painted=artSample(p+vec2(warp*.12,0),vec2(1,0));
      float grain=dot(painted,vec3(.2126,.7152,.0722));
      // Irregular long strata and occasional mineral seams, not brick courses.
      float bedding=sin(artWorld.y*3.6+warp*3.2+horizontal*.5)*.5+.5;
      float seam=smoothstep(.82,.94,artNoise(vec2(horizontal*1.6,artWorld.y*.35)));
      float fracture=pow(1.-abs(sin(horizontal*2.2+warp*1.4+artWorld.y*.16)),9.);
      float ledge=artNoise(vec2(horizontal*.4,artWorld.y*.8));
      diffuseColor.rgb*= (.64+grain*1.8)*mix(mix(.86,1.1,bedding),.9+artNoise(artWorld.xz*.9)*.2,top)*(1.-seam*.26*(1.-top))*(1.-fracture*.24*(1.-top))*mix(.91,1.1,ledge);
    `;
    const building = /* glsl */`
      vec3 n=abs(normalize(cross(dFdx(artWorld),dFdy(artWorld))));
      vec2 p=artWorld.xz;
      if(n.y<.65) p=vec2(n.x>n.z?artWorld.z:artWorld.x,artWorld.y);
      vec3 painted=artSample(p*.48,vec2(0,0));
      float grain=dot(painted,vec3(.2126,.7152,.0722));
      float roof=step(diffuseColor.r*1.2,diffuseColor.b)*step(diffuseColor.g*1.1,diffuseColor.b);
      vec2 shingles=vec2((artWorld.x+artWorld.z)*4.0+floor(artWorld.y*5.0)*.5,artWorld.y*5.0);
      vec2 seams=abs(fract(shingles)-.5);
      float joint=max(smoothstep(.43,.49,seams.x),smoothstep(.39,.49,seams.y));
      float materialDetail=mix(.62+grain*2.1,1.06-joint*.32,roof);
      // Slate-blue roofs sit behind the bright faction cloth and unit crests.
      vec3 slate=diffuseColor.rgb*vec3(1.20,1.02,.76)+vec3(.012,.016,.02);
      diffuseColor.rgb=mix(diffuseColor.rgb,slate,roof*.72)*materialDetail;
    `;
    const armor = /* glsl */`
      vec3 n=abs(normalize(cross(dFdx(artWorld),dFdy(artWorld))));
      vec2 p=n.y>.65?artWorld.xz:vec2(n.x>n.z?artWorld.z:artWorld.x,artWorld.y);
      float grain=artNoise(p*17.0);
      float broad=artNoise(p*.8);
      // Subtle brushed wear and wide plate seams; never shingles or ashlar.
      vec2 seams=abs(fract(p*vec2(.8,.55))-.5);
      float joint=max(smoothstep(.488,.498,seams.x),smoothstep(.488,.498,seams.y));
      float wear=artNoise(vec2(p.x*3.0,p.y*.23));
      diffuseColor.rgb*= (.91+grain*.09+broad*.10)*(1.-joint*.10)*(.96+wear*.05);
    `;
    const deck = /* glsl */`
      // Large service-deck plates, inset seams and restrained fasteners are
      // original procedural material work, not geometry or collision objects.
      vec2 p=artWorld.xz, cell=fract(p), edge=min(cell,1.-cell);
      float seam=1.-smoothstep(.014,.045,min(edge.x,edge.y));
      float lip=smoothstep(.035,.065,min(edge.x,edge.y))*(1.-smoothstep(.065,.10,min(edge.x,edge.y)));
      float panelTone=.96+.08*artHash(floor(p));
      float scuff=artNoise(vec2(p.x*7.,p.y*.6));
      float bolt=1.-smoothstep(.017,.032,length(edge-vec2(.14)));
      diffuseColor.rgb*=panelTone*(.94+scuff*.08)*(1.-seam*.35);
      diffuseColor.rgb+=vec3(.035,.043,.045)*lip;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.10,.15,.17),bolt*.48);
    `;
    const foliage = /* glsl */`
      float leaves=artNoise(artWorld.xz*9.0+artWorld.y*3.0);
      float clumps=artNoise(artWorld.xz*2.8);
      // Painted canopy masses: cool shaded lower clumps and warm leaf tips.
      // Broad value grouping survives the game camera; fine grain stays quiet.
      float plane=abs(normalize(cross(dFdx(artWorld),dFdy(artWorld))).y);
      vec3 shade=mix(vec3(.72,.85,.88),vec3(1.12,1.08,.86),plane);
      diffuseColor.rgb*=shade*(.78+leaves*.14+clumps*.24);
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + (kind === 'ground' ? terrain : kind === 'rock' ? rock : kind === 'soil' ? soil : kind === 'armor' ? armor : kind === 'deck' ? deck : kind === 'building' ? building : kind === 'foliage' ? foliage : stone));
  };
  material.customProgramCacheKey = () => 'frontier-art-v6-' + kind;
  return material;
}

// One animated surface, no extra render target or water geometry subdivision.
// The same control texture gives shallow shores a different value from depth.
export function waterMaterial(map) {
  const control=groundControl(map),time={value:0},lava=map.isLava();
  const material=new THREE.MeshLambertMaterial({color:map.theme?.palette?.water??0x3f8fb0,
    transparent:true,opacity:lava ? .94 : .83,depthWrite:false,
    ...(lava?{emissive:0x7a1f08,emissiveIntensity:.8}:{})});
  material.userData.time=time;
  material.addEventListener('dispose',()=>control.dispose());
  material.onBeforeCompile=shader=>{
    shader.uniforms.artControl={value:control};shader.uniforms.artMapSize={value:map.size};shader.uniforms.waterTime=time;
    shader.vertexShader='varying vec3 artWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nartWorld=(modelMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader=functions+'uniform float waterTime;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 p=artWorld.xz;
      float depth=0.;
      depth+=texture2D(artControl,(p+vec2(1.5,0))/artMapSize).a;
      depth+=texture2D(artControl,(p-vec2(1.5,0))/artMapSize).a;
      depth+=texture2D(artControl,(p+vec2(0,1.5))/artMapSize).a;
      depth+=texture2D(artControl,(p-vec2(0,1.5))/artMapSize).a;
      depth*=.25;
      float flow=artNoise(p*.22+vec2(waterTime*.035,-waterTime*.018));
      float ripple=sin(p.x*2.2+p.y*.7+flow*4.+artNoise(p*.8)*2.+waterTime*.65)*.5+.5;
      diffuseColor.rgb*=mix(1.45,.72,depth)*(.92+flow*.15);
      diffuseColor.rgb+=vec3(${lava?'0.06,0.014,0.003':'0.008,0.018,0.016'})*smoothstep(.91,.99,ripple)*(.4+flow*.6);
    `);
  };
  material.customProgramCacheKey=()=> 'landscape-water-v1-'+lava;
  return material;
}
