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
      wear = Math.max(wear, Math.max(0, 1 - d / 19) * .75);
    }
    const k = (z * N + x) * 4;
    data[k] = Math.round(wear * 255);
    data[k + 1] = tile === TILE.FOREST ? 255 : 0;
    data[k + 2] = tile === TILE.MOUNTAIN ? 255 : 0;
    data[k + 3] = 255;
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
      float dirt=smoothstep(.28,.72,control.r*.8 + noise*.48);
      vec3 grass=artSample(p*.25,vec2(0,1));
      vec3 soil=artSample(p*.20,vec2(1,1));
      float luminosity=max(.07,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
      vec3 tint=mix(vec3(1),diffuseColor.rgb/luminosity,.36);
      vec3 painted=mix(grass,soil,dirt)*tint;
      float grain=dot(painted,vec3(.2126,.7152,.0722));
      painted=mix(diffuseColor.rgb*(.7+grain*2.0),painted,artOrganic);
      // Keep snow, ash and blight identities; texture is a material layer.
      diffuseColor.rgb=mix(diffuseColor.rgb,painted*1.25,.78);
      diffuseColor.rgb*=mix(.86,1.08,noise);
    `;
    const stone = /* glsl */`
      vec3 painted=artSample(artWorld.xz*.32,vec2(0,0));
      diffuseColor.rgb*=painted*2.8+.25;
    `;
    const rock = /* glsl */`
      vec2 p=vec2((artWorld.x+artWorld.z)*.29,artWorld.y*.32);
      vec3 painted=artSample(p,vec2(1,0));
      float grain=dot(painted,vec3(.2126,.7152,.0722));
      diffuseColor.rgb=mix(diffuseColor.rgb,painted*1.35,.6)*(.85+grain*.55);
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
      diffuseColor.rgb*=materialDetail;
    `;
    const foliage = /* glsl */`
      float leaves=artNoise(artWorld.xz*9.0+artWorld.y*3.0);
      float clumps=artNoise(artWorld.xz*2.8);
      diffuseColor.rgb*=.72+leaves*.3+clumps*.28;
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + (kind === 'ground' ? terrain : kind === 'rock' ? rock : kind === 'building' ? building : kind === 'foliage' ? foliage : stone));
  };
  material.customProgramCacheKey = () => 'frontier-art-v1-' + kind;
  return material;
}
