// Narrow integration probe: valid save + unavailable ticket service. All
// storage and mocked auth live inside this disposable browser context.
import {startReviewServer} from './playability-static-server.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const server=await startReviewServer();
const out=process.env.QA_OUTPUT || '/tmp/zillions-world-recovery-review';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1200,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.url);await page.waitForFunction(()=>window.__app?.ui);await page.waitForTimeout(1000);
 const result=await page.evaluate(async()=>{
  const a=__app;a.renderer.setAnimationLoop(null);a.strategicMap?.hide();
  const {Game}=await import('/src/game.js'),{TerrainField}=await import('/src/terrain.js'),{levelById}=await import('/src/config.js');
  const l=levelById(1),g=new Game(new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),'normal',['scott'],null,1,'campaign',{rngSeed:88,worldArmy:[4]});g.foundCity(0,0);
  a.game=g;a.netMode=false;a.onlineMode=false;a.lobby=null;a.mpRole=null;a.peers=[];a.ui._customBattle=false;
  a._match={world:{encounter:'recovery-fixture',troops:4},ticket:null};a.ui.hideOverlay();a.ui.showPause(false);
  const restartHidden=document.querySelector('#p-restart').classList.contains('hidden');
  // Guard must hold even if an old click/callback reaches the handler.
  let left=0,started=0;const originalLeave=a._leaveSoloMatch,originalStart=a.startGame;
  a._leaveSoloMatch=()=>{left++;};a.startGame=()=>{started++;};
  a._restartOrReturn();
  const guarded=a.game===g&&left===0&&started===0;
  a._leaveSoloMatch=originalLeave;a.startGame=originalStart;
  a.ui.hidePause();a.game=null;a.ui.nav.leaveMatch('characters');a.ui._showScreen('main');
  const save={when:Date.now(),snap:g.snapshot(),world:{encounter:'recovery-fixture',troops:4},roomId:null};
  const serialized=JSON.stringify(save);localStorage.setItem('zillions_save',serialized);
  let cloudClears=0,ticketRequests=0;
  a.auth={isSignedIn:()=>true,clearLatestSave:async()=>{cloudClears++;}};
  a.assetsLoaded=true;a._worldEncounter=null;
  a._requestMatchTicket=async()=>{ticketRequests++;return {ok:false,error:'world_service_unavailable'};};
  await a.continueGame();
  const recoveryMessage=document.querySelector('#toasts').textContent.includes('saved battle is unchanged');
  const recoveryTicketRequests=ticketRequests;
  a._openLobby=async()=>({connected:false});
  a._worldEncounter={id:'stale-world',characterId:'old-character',level:1};a._openCustomGames();
  await new Promise(resolve=>setTimeout(resolve,0));
  const customClears=a._worldEncounter===null;
  a._worldEncounter={id:'stale-world',characterId:'old-character',level:1};a.playArcadeMap({mode:'campaign',level:1});
  const arcadeClears=a._worldEncounter===null;
  // Even a stale already-enqueued host callback must not bind Custom Battles
  // to a strategic encounter. No live lobby or backend is contacted here.
  a._worldEncounter={id:'stale-world',characterId:'old-character',level:1};
  a.lobby={game:{id:'custom-fixture',custom:true},touchGame:async()=>{}};a.onlineMode=true;a.mpRole='host';a.peers=[];a.guestHeroes=[];
  a._requestMatchTicket=async()=>null;let customStarts=0;a.startGame=async()=>{customStarts++;};a._sealShareLobby=()=>{};
  await a._launchHostMatch('normal','scott','campaign');
  return {restartHidden,guarded,ticketRequests:recoveryTicketRequests,cloudClears,saveRetained:localStorage.getItem('zillions_save')===serialized,
   noReplacementBattle:a.game===null,recoveryMessage,customClears,arcadeClears,customStarts};
 });
 assert.equal(result.restartHidden,true,'world battle pause does not offer ordinary restart');
 assert.equal(result.guarded,true,'stale restart callback cannot drop the reserved battle');
 assert.equal(result.ticketRequests,1,'cloud world recovery really attempts ticket recovery');
 assert.equal(result.saveRetained,true,'temporary ticket outage must preserve valid local save');
 assert.equal(result.cloudClears,0,'temporary ticket outage must not clear cloud save');
 assert.equal(result.noReplacementBattle,true,'recovery failure must not start a rewardless replacement');
 assert.equal(result.recoveryMessage,true,'retryable recovery failure is explained');
 assert.equal(result.customClears,true,'opening Custom Battles drops old encounter context');
 assert.equal(result.arcadeClears,true,'arcade setup drops old encounter context');
 assert.equal(result.customStarts,1,'custom host launch ignores stale strategic context');
 assert.deepEqual(errors,[]);
 writeFileSync(`${out}/result.json`,JSON.stringify({ok:true,...result,errors},null,2));
 await page.screenshot({path:`${out}/recovery-save-retained.png`});
 console.log('World pause restart and transient cloud-ticket recovery checks passed',JSON.stringify(result));
}finally{await browser.close();await server.close();}
