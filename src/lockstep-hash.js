// The lockstep state hash.
//
// Every peer computes this over its own simulation each window and compares.
// A mismatch means the two games have diverged, and catching it early is the
// difference between a clear error and a match that quietly stops agreeing.
//
// It lives in its own module, apart from the renderer, so a check can drive it
// headless — this is the highest-consequence function in the multiplayer path
// and it must be testable without a browser.
import { EQUIP_SLOTS, hashString } from './items.js';

export function stateHash(g) {
  let h = 7;
  h = (h * 31 + Math.round(g.gold)) | 0;
  h = (h * 31 + g.coins.length) | 0;
  h = (h * 31 + g.zombies.length) | 0;
  h = (h * 31 + g.units.length) | 0;
  h = (h * 31 + g.buildings.length) | 0;
  h = (h * 31 + g.stats.kills) | 0;
  for (const hr of g.heroes) {
    h = (h * 31 + Math.round(hr.x * 8) + Math.round(hr.z * 8) * 7 + hr.level * 131) | 0;
    for (const v of Object.values(hr.upgrades || {})) h = (h * 31 + v * 17) | 0;
    // Gear and the Lattice reach the hash too. Two peers holding different
    // weapons or different builds must fail the check before window 0
    // rather than drift apart at minute six, and a forged item key cannot
    // survive a peer regenerating the same key and getting something else.
    for (const slot of EQUIP_SLOTS) {
      const key = (hr.equipment || {})[slot];
      if (key) h = (h * 31 + hashString(key)) | 0;
    }
    for (const id of hr.doctrines || []) h = (h * 31 + hashString(id)) | 0;
    h = (h * 31 + (hr.activeSet || 0) * 977) | 0;
    const w = hr.weapon;
    if (w) {
      h = (h * 31 + Math.round(w.dmg * 16) + Math.round(w.rof * 64) * 3 + Math.round(w.range * 16) * 7) | 0;
      for (const [type, share] of Object.entries(w.types || {})) {
        h = (h * 31 + hashString(type) + Math.round(share * 1000)) | 0;
      }
    }
  }
  return h;
}
