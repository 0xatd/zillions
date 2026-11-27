import {startReviewServer} from './playability-static-server.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const server=await startReviewServer(),out='/tmp/zillions-world-review';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const p=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(server.url);await p.waitForFunction(()=>window.__app?.ui);await p.locator('#a-play').click();
 if(await p.locator('#a-offline').isVisible())await p.locator('#a-offline').click();
 for(let i=0;i<5;i++)await p.locator('#creator-next').click();await p.locator('#creator-name').fill('Pathfinder');await p.locator('#creator-submit').click();await p.locator('#nav-home').click();
 await p.waitForFunction(()=>__app.strategicMap?.view?.self&&__app.strategicMap.width>0&&!__app.strategicMap.busy);
 await p.evaluate(async()=>{const m=await import('/src/meta.js');const data=m.loadMeta();data.currency=36;m.saveMeta(data);await __app.strategicMap.send('snapshot');});
 const point=async(x,z)=>p.evaluate(({x,z})=>__app.strategicMap.point({x,z}),{x,z});
 const dest=await point(250,350);await p.mouse.click(dest.x,dest.y);await p.waitForTimeout(3000);console.log('travel',dest,await p.evaluate(()=>({self:__app.strategicMap.self(),status:__app.strategicMap.status.textContent,active:__app.strategicMap.active,selected:__app.strategicMap.selected})));await p.screenshot({path:`${out}/debug-travel.png`});
 assert.ok(await p.evaluate(()=>__app.strategicMap.self().x>180),'mouse click caused real authority travel');
 await p.getByRole('button',{name:'Stop',exact:true}).click();const stopped=await p.evaluate(()=>__app.strategicMap.self().x);await p.waitForTimeout(2200);assert.equal(await p.evaluate(()=>__app.strategicMap.self().x),stopped);
 const colony=await point(160,350);await p.mouse.click(colony.x,colony.y);await p.getByRole('button',{name:'Travel to Greenfall'}).click();
 await p.waitForFunction(()=>!__app.strategicMap.self().target,{},{timeout:15000});
 await p.getByRole('button',{name:'Recruit soldier'}).click();assert.equal(await p.evaluate(()=>__app.strategicMap.self().troops),5);
 await p.getByRole('button',{name:'Speak to the port commander'}).click();await p.waitForTimeout(2300);assert.equal(await p.getByRole('heading',{name:'Welcome, commander.'}).count(),1,'poll does not destroy conversation');
 await p.getByRole('button',{name:'Return to orbit'}).click();await p.screenshot({path:`${out}/01-orbit.png`});
 await p.getByRole('button',{name:'Launch siege'}).click();await p.getByRole('button',{name:'Withdraw',exact:true}).click();assert.equal(await p.evaluate(()=>__app.strategicMap.self().troops),5);
 await p.mouse.click(colony.x,colony.y);await p.getByRole('button',{name:'Launch siege'}).click();await p.getByRole('button',{name:'Prepare battle',exact:true}).click();
 await p.locator('#s-start').click();await p.waitForFunction(()=>__app.game&&__app._match?.world,{},{timeout:60000});
 await p.evaluate(()=>{__app.missionIntro=null;__app.ui.hideMissionIntro();__app.game.foundCity(0,0);});
 assert.equal(await p.evaluate(()=>__app.game.units.filter(u=>u.expeditionOwner===0).length),5);
 await p.screenshot({path:`${out}/02-battle.png`});
 // Force a deterministic outcome solely to verify the result/return boundary;
 // this is not evidence of a completed human playthrough or combat balance.
 await p.evaluate(()=>{const a=__app;a.game._damageUnit(a.game.units.find(u=>u.expeditionOwner===0),100000);a.game._gameOver(true);});
 await p.locator('#b-restart').waitFor({state:'visible',timeout:60000});await p.locator('#b-restart').click();await p.waitForFunction(()=>__app.strategicMap?.active&&__app.strategicMap.self()?.encounter===null);
 assert.equal(await p.evaluate(()=>__app.strategicMap.self().troops),4);
 await p.screenshot({path:`${out}/03-return.png`});
 await p.reload();await p.waitForFunction(()=>window.__app?.ui);await p.locator('#a-play').click();if(await p.locator('#nav-home').isVisible())await p.locator('#nav-home').click();await p.waitForFunction(()=>__app.strategicMap?.view?.self&&__app.strategicMap.width>0&&!__app.strategicMap.busy);
 assert.equal(await p.evaluate(()=>__app.strategicMap.self().troops),4,'survivors persist after reload');
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:`${out}/04-phone.png`});
 assert.deepEqual(errors,[]);console.log('World browser loop passed: actual click travel, stop, arrival, recruit, dialogue, cancel, battle army, forced outcome return and reload.');
}finally{await browser.close();await server.close();}
