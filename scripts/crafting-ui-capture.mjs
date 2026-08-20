import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const chrome = ['chromium', 'chromium-browser', 'google-chrome'].find((name) => spawnSync('which', [name], { stdio: 'ignore' }).status === 0);
assert.ok(chrome, 'Chrome is required for Forge screenshots');
const root = new URL('..', import.meta.url).pathname;
const port = 7000 + (process.pid % 10000); const debugPort = 40000 + (process.pid % 10000);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  try { const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); const file = normalize(join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''))); if (!file.startsWith(root)) throw new Error(); const body = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'zillions-forge-'));
const browser = spawn(chrome, ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-angle=swiftshader',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,`http://127.0.0.1:${port}/`], { stdio: 'ignore' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let target; for (let i=0;i<40&&!target;i++) { await delay(150); try { target=(await fetch(`http://127.0.0.1:${debugPort}/json`).then((r)=>r.json())).find((p)=>p.type==='page'&&p.url.includes(`:${port}`)); } catch {} }
  assert.ok(target?.webSocketDebuggerUrl);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0; const pending=new Map(); socket.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.id&&pending.has(msg.id)){pending.get(msg.id)(msg);pending.delete(msg.id);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,(msg)=>msg.error?reject(new Error(msg.error.message)):resolve(msg.result));socket.send(JSON.stringify({id:requestId,method,params}));});
  const evaluate=async(expression)=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value;
  await send('Runtime.enable'); for(let i=0;i<40&&!(await evaluate('!!window.__app'));i++) await delay(150); await delay(900);
  await evaluate(`(() => {
    document.querySelector('#a-offline').click(); document.querySelector('#m-create-character').click();
    document.querySelector('#creator-name').value='Forge Review'; document.querySelector('#character-create-form').requestSubmit();
    const app=window.__app; const c=app.profile.mmoCharacters[0];
    c.authoritativeBalance=500; c.authorityRevision=8; c.craftingMaterials={alloy_shard:10,phase_flux:5,prism_dust:3,ascendant_core:0};
    c.itemInstances=[{id:'22222222-2222-2222-2222-222222222222',key:'scatter_mk3:authority:70:3',revision:4,sockets:[{color:'reflex',type:'optic',component:null}]}];
    c.craftingComponents=[{id:'33333333-3333-3333-3333-333333333333',componentId:'kinetic_optic',rank:1,location:'inventory'}];
    app.ui.showCharacterSheet('crafting'); return true;
  })()`);
  for (const [name,width,height,mobile] of [['forge-desktop',1440,1000,false],['forge-mobile',390,844,true]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile}); await delay(250);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true});
    await writeFile(join(tmpdir(),`zillions-${name}.png`),Buffer.from(shot.data,'base64'));
    const dimensions=await evaluate(`JSON.stringify({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,forge:document.querySelector('#sheet-panel-crafting').getBoundingClientRect().toJSON()})`);
    console.log(`${name}: ${dimensions}`);
  }
} finally {
  try{socket?.close();}catch{} browser.kill('SIGTERM'); server.close();
  await Promise.race([new Promise((resolve)=>browser.once('exit',resolve)),delay(1500)]);
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
