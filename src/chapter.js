// Chapter identity and recruitment policy are metadata. Conquest comes from the account's
// server-confirmed campaign count, never from chapter metadata.
export const CHAPTER_COLORS = Object.freeze({ iron:'#8493a6', crimson:'#b94b51', cobalt:'#4679b8', bone:'#b7aa8c', void:'#6d568f', forest:'#4f785d' });
export const CHAPTER_EMBLEMS = Object.freeze({ star:'✦', shield:'⬡', wings:'⋈', sun:'☀' });
export const CHAPTER_CULTURES = Object.freeze({ coalition:{name:'Coalition',desc:'Human and nonhuman companions welcome.'}, human:{name:'Human compact',desc:'Recruit human companions only. Existing companions are retained.'} });
export const CHAPTER_LEADERS = Object.freeze([
  { key:'sven', classKey:'vanguard', capture:2, species:'nonhuman', source:'exploration', role:'Half-Meranth knight' },
  { key:'axe', classKey:'berserker', capture:3, species:'nonhuman', source:'encounter', role:'Oglodi war leader' },
  { key:'sniper', classKey:'recon', capture:1, species:'nonhuman', source:'exploration', role:'Keenfolk marksman' },
  { key:'lina', classKey:'arcanist', capture:1, species:'human', source:'academy', discovery:2, role:'Fire mage' },
  { key:'scott', classKey:'vanguard', capture:1, role:'Frontline captain' },
  { key:'alexander', classKey:'recon', capture:1, role:'Recon commander' },
  { key:'aaron', classKey:'engineer', capture:2, role:'Ward commander' },
  { key:'john', classKey:'berserker', capture:3, role:'Assault commander' },
  { key:'turtle', classKey:'warden', capture:3, role:'Bastion commander' },
  { key:'danny', classKey:'operative', capture:4, role:'Strike commander' },
  { key:'tiger', classKey:'psion', capture:5, role:'Expedition commander' },
]);
export const CHAPTER_ROSTER_LIMIT = 8 + CHAPTER_LEADERS.length;
export const CHAPTER_CITIES = Object.freeze([
  { level:1, name:'Greenfall', kind:'Landing city', x:15,y:68, reward:'Recruit Scott English and Alexander Thomas — frontline or reconnaissance command.' },
  { level:2, name:'Rotmire', kind:'Marsh stronghold', x:34,y:40, reward:'Recruit Aaron Whitlock — healing wards and summoned support.' },
  { level:3, name:'Cinder', kind:'Forge city', x:53,y:66, reward:'Recruit John Marlowe and Turtle Voss — assault or bastion command.' },
  { level:4, name:'Barrow', kind:'Fortress city', x:73,y:36, reward:'Recruit Daniel Donovan — mobile strike leadership.' },
  { level:5, name:'Black Vale', kind:'Planetary gateway', x:87,y:62, reward:'Recruit Tiger Reyes and open frontier expeditions beyond Earth.' },
]);
export function conquestCount(profile) {
  const n=Number(profile?.campaign);return Number.isFinite(n)?Math.max(0,Math.floor(n)):0;
}
export function chapterIdentity(raw) {
  return { version:1, founderId:typeof raw?.founderId==='string'?raw.founderId.slice(0,96):null, name:String(raw?.name||'').trim().replace(/[\u0000-\u001f]/g,'').slice(0,32),
    culture:Object.hasOwn(CHAPTER_CULTURES,raw?.culture)?raw.culture:'coalition',
    color:Object.hasOwn(CHAPTER_COLORS,raw?.color)?raw.color:'cobalt',
    emblem:Object.hasOwn(CHAPTER_EMBLEMS,raw?.emblem)?raw.emblem:'star' };
}
export function leaderAvailable(profile,key) {
  const leader=CHAPTER_LEADERS.find(l=>l.key===key);return !!leader && conquestCount(profile)>=leader.capture;
}
export function chapterCities(profile) {
  const count=conquestCount(profile);return CHAPTER_CITIES.map(c=>({...c,status:count>=c.level?'held':count+1===c.level?'frontier':'locked'}));
}
export function leaderRecord(profile,key) {
  return (profile?.mmoCharacters||[]).find(c=>c.chapterLeader===key);
}
export function chapterLeaderStyle(character) { return !!CHAPTER_LEADERS.find(l=>l.key===character?.chapterLeader && l.classKey===character?.classKey); }

export function chapterFounder(profile) {
  const roster=profile?.mmoCharacters||[];
  return roster.find(c=>c.id===profile?.chapter?.founderId && !c.chapterLeader) || roster.find(c=>!c.chapterLeader) || null;
}

export function recruitmentAllowed(profile,key) {
  const leader=CHAPTER_LEADERS.find(l=>l.key===key);
  return !!leader && leaderAvailable(profile,key) && (chapterIdentity(profile?.chapter).culture!=='human' || leader.species!=='nonhuman');
}
