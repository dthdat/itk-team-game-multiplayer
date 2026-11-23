import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { writeFile,readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.PLAY_URL||'https://game-staging.itkvn.workers.dev/';
const label=process.env.PLAY_LABEL||'before';
const mobile=process.env.PLAY_MOBILE==='1',offline=process.env.PLAY_OFFLINE==='1',candidate=process.env.PLAY_CANDIDATE==='1';
const jitter=process.env.PLAY_JITTER==='1';
const correctionProbe=process.env.PLAY_CORRECTION==='1';
const loopbackTest=['localhost','127.0.0.1'].includes(new URL(base).hostname);
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox',...(loopbackTest?['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests']:[])]});
const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1280,height:800}});const page=await context.newPage();const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});
page.on('requestfailed',request=>errors.push(`request: ${request.url()} ${request.failure()?.errorText||''}`));
if(jitter)await context.addInitScript(()=>{const send=WebSocket.prototype.send;WebSocket.prototype.send=function(raw){let m;try{m=JSON.parse(raw);}catch{}if(m?.type!=='move')return send.call(this,raw);if(!this.__batch){this.__batch=[];const timer=setInterval(()=>{const queued=this.__batch.splice(0);if(this.readyState===1)for(const value of queued)send.call(this,value);},400);this.addEventListener('close',()=>clearInterval(timer));}this.__batch.push(raw);};});
await context.addInitScript(()=>{window.__network={corrections:0,closes:[],errors:[],moves:0};const Native=WebSocket;window.WebSocket=new Proxy(Native,{construct(Target,args){const ws=Reflect.construct(Target,args),send=ws.send.bind(ws);ws.send=raw=>{try{if(JSON.parse(raw).type==='move')window.__network.moves++;}catch{}return send(raw);};ws.addEventListener('close',e=>window.__network.closes.push(e.code));ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='correction')window.__network.corrections++;if(m.type==='error')window.__network.errors.push(m.message);});return ws;}});});
if(candidate)await page.route('**/phase3-ui.js',async r=>r.fulfill({contentType:'text/javascript',body:await readFile('cloudflare-game/public/phase3-ui.js','utf8')}));
if(candidate)await page.route('**/game-config.js',async r=>r.fulfill({contentType:'text/javascript',body:await readFile('cloudflare-game/public/game-config.js','utf8')}));
if(offline)await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic offline test"}'}));
await page.route(base,async route=>{let html=candidate?await readFile('cloudflare-game/public/index.html','utf8'):await(await route.fetch()).text();html=html.replace('initService();\n})();','window.__play={P,keys,state,blocked,colliders,MISSIONS,openMission};\ninitService();\n})();');const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/\bsrc\s*=/i.test(m[1])).map(m=>m[2]);const hashes=scripts.map(s=>"'sha256-"+createHash('sha256').update(s).digest('base64')+"'").join(' ');html=html.replace(/script-src 'self' [^;]*;/,"script-src 'self' "+hashes+';');await route.fulfill({contentType:'text/html',body:html});});
const steps=[];
async function snapshot(action){steps.push(await page.evaluate(action=>({action,x:window.__play.P.x,z:window.__play.P.z,yaw:window.__play.P.yaw,blocked:window.__play.blocked(window.__play.P.x,window.__play.P.z),playing:window.__play.state.playing,modal:window.__play.state.modal,status:document.querySelector('#net-status').textContent,network:structuredClone(window.__network)}),action));}
try{
  await page.goto(base);await page.waitForFunction(offline?()=>window.__play:()=>window.__play&&window.ITK_SESSION_DATA);
  await page.locator('#name-in').fill('Walking Probe');await page.locator('#discs button').first().click();await page.waitForFunction(()=>!document.querySelector('#clockin').disabled);await page.locator('#clockin').click();if(!offline)await page.waitForFunction(()=>document.querySelector('#net-status').textContent==='Online');
  if(process.env.EXPECT_PLAYABLE==='1')assert.equal(await page.evaluate(()=>document.activeElement.id),'view','game receives keyboard focus immediately on entry');
  else await page.locator('#view').click({position:{x:mobile?260:800,y:500}});
  await snapshot('start');
  if(correctionProbe){
    await page.waitForTimeout(300);const before=await page.evaluate(()=>structuredClone(window.__network));
    await page.evaluate(()=>{window.__play.P.x=30;});
    await page.waitForFunction(before=>window.__network.corrections>before.corrections,before,{timeout:3000});await page.waitForTimeout(500);
    const after=await page.evaluate(()=>({network:structuredClone(window.__network),x:window.__play.P.x,z:window.__play.P.z,ready:window.__play.state.socket?.readyState}));
    assert.equal(after.network.corrections-before.corrections,1,'one invalid move receives exactly one correction');
    assert.equal(after.network.moves-before.moves,1,'the unchanged corrected position is not retransmitted');
    assert.equal(after.network.closes.length,0,'a correction does not close the socket');
    assert.equal(after.ready,WebSocket.OPEN,'the socket remains open');
    assert.deepEqual([after.x,after.z],[0,8.5],'the client accepts the server position');
    await snapshot('invalid move corrected once');
  }
  if(await page.locator('#hint').isVisible()){if(mobile)await page.locator('#hint').tap();else await page.keyboard.press('e');await page.locator('#mission').waitFor({state:'visible'});await page.locator('#m-close').click();}
  if(mobile){await page.locator('#joy').waitFor({state:'visible'});const r=await page.locator('#joy').boundingBox(),cdp=await context.newCDPSession(page),x=r.x+r.width/2,y=r.y+r.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-45,id:1}]});await page.waitForTimeout(2000);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await snapshot('touch joystick');}
  else{
  for(const [key,ms]of [['w',1800],['s',1800],['d',1500],['a',1500],['w',2500],['s',2500]]){await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);await snapshot(key+' '+ms);}
  await page.keyboard.down('Shift');await page.keyboard.down('w');await page.waitForTimeout(2000);await page.keyboard.up('w');await page.keyboard.up('Shift');await snapshot('run');
  }
  await page.screenshot({path:'reports/play-'+label+'.png'});
  if(candidate||process.env.EXPECT_PLAYABLE==='1')assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).count(),0);
  const missionCount=await page.evaluate(()=>window.__play.MISSIONS.length);assert.equal(missionCount,8);
  for(let i=0;i<missionCount;i++){await page.evaluate(i=>window.__play.openMission(window.__play.MISSIONS[i]),i);await page.locator('#mission').waitFor({state:'visible'});assert((await page.locator('#m-title').innerText()).length>0);await page.locator('#m-close').click();}
  await page.reload();await page.waitForFunction(()=>window.__play);assert.equal(await page.locator('#name-in').inputValue(),'Walking Probe','name is restored from localStorage');
  const report={at:new Date().toISOString(),base,mobile,offline,candidate,jitter,missionCount,nameRestored:true,steps,errors};await writeFile('reports/play-'+label+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  if(process.env.EXPECT_PLAYABLE==='1'){assert.equal(errors.length,0);assert.equal(steps.at(-1).network.closes.length,0);assert.equal(steps.at(-1).network.corrections,correctionProbe?1:0);assert(steps.some(s=>Math.hypot(s.x-steps[0].x,s.z-steps[0].z)>(mobile?.5:2)));}
}catch(error){
  const diagnostics=await page.evaluate(()=>({status:document.querySelector('#net-status')?.textContent,playing:window.__play?.state.playing,sessionReady:window.__play?.state.sessionReady,socketReady:window.__play?.state.socket?.readyState,accountDataLoaded:!!window.ITK_SESSION_DATA})).catch(()=>({}));
  console.error(JSON.stringify({diagnostics,errors},null,2));throw error;
}finally{
  let cleanupStatus=null;
  try{cleanupStatus=await page.evaluate(async()=>{if(!window.ITK_SESSION_DATA)return null;const response=await fetch('/api/session',{method:'DELETE',headers:{'x-csrf-token':window.ITK_SESSION_DATA.csrfToken}});return response.status;});}catch{}
  const sessionCookieRemains=(await context.cookies()).some(cookie=>cookie.name==='pw_session');
  if(cleanupStatus!==null){const cleanup={cleanupStatus,sessionCookieRemains,verified:cleanupStatus===204&&!sessionCookieRemains};await writeFile(`reports/play-${label}-cleanup.json`,JSON.stringify(cleanup,null,2)+'\n');console.log('synthetic-guest-cleanup',JSON.stringify(cleanup));if(!cleanup.verified)process.exitCode=1;}
  await context.close();await browser.close();
}
