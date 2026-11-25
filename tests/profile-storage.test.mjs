import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('  _storeProfileLocally() {');
const method=source.slice(start,source.indexOf('\n  _saveProfile()',start));
const store=new Function(`return ({${method}})._storeProfileLocally`)();
test('local save confirmation requires storage to accept the profile',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let saved;
 try{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:(key,value)=>{saved={key,value}}}});
  assert.equal(store.call({profile:{campaign:1}}),true);
  assert.deepEqual(saved,{key:'zillions_profile',value:'{"campaign":1}'});
  globalThis.localStorage.setItem=()=>{throw new Error('storage blocked')};
  assert.equal(store.call({profile:{campaign:2}}),false);
 }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
});
