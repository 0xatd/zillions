// Offline-only transaction boundary. The shared realm uses PostgreSQL instead.
// A rollback journal keeps the world and the existing guest Alloy ledger in
// agreement across storage failures or a tab closing between the two writes.
import {applyCharge, loadMeta, saveMeta} from './meta.js';
export const LOCAL_WORLD_JOURNAL = 'zillions_world_transaction_v1';
const failure = () => Object.assign(new Error('world_storage_unavailable'), {retryable:true});
const clone = value => structuredClone(value);

function restoreWorld(storage, key, raw) {
  if (raw == null) storage.removeItem(key);
  else storage.setItem(key, raw);
}

// Recovery always rolls an interrupted transaction back. Journal removal is
// the commit point; until then neither a debit nor a soldier is confirmed.
export function recoverLocalWorld({storage=globalThis.localStorage, putMeta=saveMeta}={}) {
  let journal;
  try {
    const raw=storage.getItem(LOCAL_WORLD_JOURNAL);
    if(raw==null)return;
    journal=JSON.parse(raw);
    if(journal?.v!==1 || typeof journal.key!=='string' || !journal.key.startsWith('zillions-world-v1:') || !journal.meta || !(journal.world==null || typeof journal.world==='string'))throw failure();
    // Restore the in-memory ledger too, even if storage is currently blocked.
    const metaSaved=putMeta(clone(journal.meta));
    restoreWorld(storage,journal.key,journal.world);
    if(!metaSaved)throw failure();
    storage.removeItem(LOCAL_WORLD_JOURNAL);
  } catch { throw failure(); }
}

export async function readLocalWorld(key, options={}) {
  const read=()=>{
    recoverLocalWorld(options);
    const storage=options.storage||globalThis.localStorage;
    try {
      const raw=storage.getItem(key);
      if(raw==null)return null;
      const state=JSON.parse(raw);
      if(!state || state.v!==1)throw new Error();
      return state;
    } catch { throw new Error('world_save_invalid'); }
  };
  const locks=Object.hasOwn(options,'locks')?options.locks:globalThis.navigator?.locks;
  return locks?.request ? locks.request('zillions-offline-ledger',read) : read();
}

export async function commitLocalWorld(key,state,{charge=0,beforeState,storage=globalThis.localStorage,getMeta=loadMeta,putMeta=saveMeta,locks=globalThis.navigator?.locks}={}) {
  const commit=()=>{
    recoverLocalWorld({storage,putMeta});
    if(!Number.isInteger(charge)||charge<0)throw new Error('invalid_charge');
    if(beforeState===undefined)throw new Error('invalid_local_transaction');
    const expected=beforeState==null?null:JSON.stringify(beforeState);
    if(storage.getItem(key)!==expected)throw new Error('world_revision_conflict');
    if(charge===0){try{storage.setItem(key,JSON.stringify(state));}catch{throw failure();}return {balance:getMeta({force:true}).currency};}
    const before=clone(getMeta({force:true}));
    const spent=applyCharge(before,charge);
    if(!spent.ok)throw new Error('insufficient_alloy');
    let journal;
    try {
      journal={v:1,key,world:storage.getItem(key),meta:before};
      storage.setItem(LOCAL_WORLD_JOURNAL,JSON.stringify(journal));
    } catch { throw failure(); }
    try {
      storage.setItem(key,JSON.stringify(state));
      if(!putMeta(spent.meta))throw failure();
      storage.removeItem(LOCAL_WORLD_JOURNAL);
      return {balance:spent.meta.currency};
    } catch {
      // A failed rollback keeps the journal. Next read refuses to proceed
      // until recovery succeeds; it never silently invents a fresh world.
      try { recoverLocalWorld({storage,putMeta}); } catch { /* journal retained */ }
      throw failure();
    }
  };
  // The ledger is account-wide, so all local characters use one lock.
  return locks?.request ? locks.request('zillions-offline-ledger',commit) : commit();
}
