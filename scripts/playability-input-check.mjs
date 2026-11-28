import {startReviewServer} from './playability-static-server.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
const server=await startReviewServer();
const out=process.env.QA_OUTPUT || '/tmp/zillions-hud-review';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.GAME_URL || server.url);await page.waitForFunction(()=>window.__app?.ui);
 await page.evaluate(async()=>{
  const a=__app;document.querySelector('#a-offline').click();
  await a.startGame('normal','scott');a.missionIntro=null;a.ui.hideMissionIntro();a._coach=null;a.ui.hideCoach();
  a.game.foundCity(0,0);a.controlMode='fight';a.paused=false;
  a.__commands=[];const issue=a.issue.bind(a);a.issue=c=>{a.__commands.push(c);issue(c);};
  document.activeElement?.blur();
 });
 for(const key of ['F1','F2','F3','F5','F6','F7','F8'])await page.keyboard.press(key);
 const commands=await page.evaluate(()=>__app.__commands);
 assert.deepEqual(commands.filter(c=>c.t==='stance').map(c=>c.s),['defend','guard','attack']);
 assert.deepEqual(commands.filter(c=>c.t==='builderOrder').map(c=>c.s),['develop','maintain','fortify','expand']);
 assert.equal(commands.some(c=>c.t==='horder'),false,'worker shortcuts do not move the hero');
 await page.keyboard.press('F4');assert.equal(await page.evaluate(()=>__app._rallyArmed),true);
 await page.mouse.click(700,360,{button:'right'});assert.equal(await page.evaluate(()=>__app._rallyArmed),false,'right click cancels rally');
 assert.equal(await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'F5',code:'F5',repeat:true,cancelable:true,bubbles:true});window.dispatchEvent(e);return e.defaultPrevented;}),true,'held F5 cannot reload');
 await page.keyboard.press('F4');await page.mouse.click(700,360);
 assert.ok((await page.evaluate(()=>__app.__commands)).some(c=>c.t==='rally'),'left click sends rally through real pointer handling');
 for(const [name,width,height] of [['laptop',1366,768],['phone',390,844],['landscape',844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(300);
  await page.screenshot({path:`${out}/hud-${name}.png`});
  const bounds=await page.evaluate(()=>Object.fromEntries(['command-deck','actionbar','minimap-wrap','command-orders','a-pack'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}];})));
  for(const [id,r] of Object.entries(bounds)){assert.ok(r.x>=-1 && r.right<=width+1 && r.bottom<=height+1,`${name} ${id} inside viewport: ${JSON.stringify(r)}`);}
  assert.ok(Math.abs(bounds['command-deck'].x+bounds['command-deck'].width/2-width/2)<1,'deck centered');
  console.log(name,JSON.stringify(bounds));
 }
 await page.evaluate(()=>{const a=__app;a.game._gameOver(false);a.ui.showEnd(false,a.game.stats,2,1,'campaign',0,{pending:true},a.game);});
 for(const [name,width,height] of [['laptop',1366,768],['phone',390,844]]){await page.setViewportSize({width,height});await page.screenshot({path:`${out}/results-${name}.png`});}

 assert.deepEqual(errors,[]);console.log('Real keyboard and mouse: F1–F8, repeat suppression, rally targeting passed.');
}finally{await browser.close();await server.close();}
