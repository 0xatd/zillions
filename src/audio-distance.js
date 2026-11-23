// Presentation only: hearing follows the controlled hero, never simulation RNG.
export const HEARING_RADIUS = 24;
export const GLOBAL_AUDIO_EVENTS = new Set(['underattack','bossspawn','bossdown','victory','defeat','horde','deny','ping','msg','herodown','revive','levelup']);
export function hearingGain(listener, source) {
  if(!listener || !Number.isFinite(listener.x) || !Number.isFinite(listener.z) || !source || !Number.isFinite(source.x) || !Number.isFinite(source.z))return 0;
  const d=Math.hypot(listener.x-source.x,listener.z-source.z);
  if(d>=HEARING_RADIUS)return 0;
  return d<=5?1:((HEARING_RADIUS-d)/(HEARING_RADIUS-5))**2;
}
export function eventHearingGain(listener,event) {
  if(GLOBAL_AUDIO_EVENTS.has(event.type))return 1;
  return hearingGain(listener,{x:event.fx??event.x,z:event.fz??event.z});
}
