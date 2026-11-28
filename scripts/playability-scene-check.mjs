import {startReviewServer} from './playability-static-server.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const server=await startReviewServer();
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 await page.goto(server.url);await page.waitForFunction(()=>window.__app?.ui);
 const state=await page.evaluate(async()=>{
  const a=__app;document.querySelector('#a-offline').click();await a.startGame('normal','scott');a.missionIntro=null;
  a.game.coins.push({id:90001,x:65,z:65,v:1});a._updateCoins(0);const before=a.coinMesh.count;
  a._quitToMenu();return {before,after:a.coinMesh.count,game:!!a.game,screen:a.ui.nav.current().name};
 });
 assert.ok(state.before>0);assert.equal(state.after,0);assert.equal(state.game,false);assert.equal(state.screen,'characters');
 console.log('Leaving battle clears coin instances and game state, returning to character selection.');
}finally{await browser.close();await server.close();}
