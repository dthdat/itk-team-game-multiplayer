import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const base=(process.env.TEST_URL||'http://127.0.0.1:8788/').replace(/\/$/,'')+'/';
const invitePath=process.env.TEST_INVITES_FILE;
if(!invitePath)throw new Error('Set TEST_INVITES_FILE to a private JSON file with at least two disposable invite codes.');
const {invites}=JSON.parse(await readFile(invitePath,'utf8'));
if(!Array.isArray(invites)||invites.length<2)throw new Error('At least two test invite codes are required.');
const output=new URL('./verification/',import.meta.url),reportName=process.env.REPORT_NAME||'phase3-local';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const pages=[],errors=[],consoleErrors=[],failures=[],requests=[],websockets=[],testAccounts=[];
const withScriptHashes=html=>{
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match=>!/\bsrc\s*=/i.test(match[1])).map(match=>match[2]);
  assert.equal(scripts.length,2,'the two original inline game scripts remain pinned');
  const hashes=scripts.map(script=>`'sha256-${createHash('sha256').update(script).digest('base64')}'`).join(' ');
  return html.replace(/script-src 'self' [^;]*;/,`script-src 'self' ${hashes};`);
};
const qaSource=html=>{
  const marker='initService();\n})();';
  assert.equal(html.split(marker).length,2,'game closure QA marker is present exactly once');
  return withScriptHashes(html.replace(marker,'window.__gameQA={scene,gl,P,MISSIONS,openMission,isLocked,state,players,remotes,retryState:()=>({attempt:retryAttempt,delayMs:lastRetryDelay,pending:!!retryTimer}),setRetryAttempt:value=>{retryAttempt=value;},clearReconnectTimer,connectSocket};\ninitService();\n})();'));
};
async function makePage(viewport){
  const context=await browser.newContext({viewport,permissions:['local-network-access']});const page=await context.newPage();pages.push({context,page});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)failures.push({url:r.url(),status:r.status()});});
  page.on('request',r=>requests.push(r.url()));
  page.on('websocket',ws=>{websockets.push(ws.url());ws.on('close',()=>{});ws.on('socketerror',error=>consoleErrors.push(`WebSocket: ${String(error)}`));});
  await page.route('**/*',async route=>{
    if(route.request().url()===base){const response=await route.fetch();await route.fulfill({response,body:qaSource(await response.text())});}
    else await route.continue();
  });
  await page.goto(base);await page.waitForFunction(()=>window.ITK_SESSION_DATA&&window.__gameQA);
  await page.locator('#net-status').waitFor({state:'attached'});
  return page;
}
async function register(page,invite,suffix,name,style){
  const loginId=`phase3-${suffix}-${Date.now()}`;
  const password='Temporary QA password 2026!';
  await page.locator('#phase3-account > button:nth-of-type(2)').click();
  await page.getByRole('button',{name:'Invite registration'}).click();
  await page.locator('#p3-register input[name="invitation"]').fill(invite);
  await page.locator('#p3-register input[name="loginId"]').fill(loginId);
  await page.locator('#p3-register input[name="password"]').fill(password);
  const accountReload=page.waitForNavigation({waitUntil:'domcontentloaded'});await page.locator('#p3-register button[type="submit"]').click();
  await accountReload;await page.waitForFunction(()=>window.ITK_SESSION_DATA?.account);
  testAccounts.push({page,password});
  await page.locator('#phase3-account > button:nth-of-type(2)').click();
  await page.locator('#phase3-account input[name="name"]').fill(name);
  await page.locator('#phase3-account select[name="disc"]').selectOption(suffix==='one'?'powertrain':'battery');
  await page.locator('#phase3-account input[name="color"]').fill(suffix==='one'?'#d9622b':'#17a2a2');
  await page.locator('#phase3-account select[name="style"]').selectOption(style);
  const profileReload=page.waitForNavigation({waitUntil:'domcontentloaded'});await page.locator('#p3-profile button[type="submit"]').click();
  await profileReload;await page.waitForFunction(()=>window.ITK_SESSION_DATA?.profile?.name);
  await page.locator('#name-in').waitFor();
  await page.waitForFunction(()=>!document.querySelector('#clockin').disabled);
  await page.locator('#clockin').click();
  await page.locator('#hud').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#net-status')?.textContent==='Online',{timeout:10000});
  console.log('staging test: invited account, profile, and authenticated WSS connected');
  const network=await page.evaluate(()=>({text:document.querySelector('#net-status')?.textContent,playing:window.__gameQA.state.playing,ready:window.__gameQA.state.sessionReady,disc:window.__gameQA.state.disc,name:window.__gameQA.state.name,backend:location.origin,socket:window.__gameQA.state.socket?.readyState}));
  if(network.text!=='Online')throw new Error(`Authenticated browser WebSocket did not connect: ${JSON.stringify({...network,websockets,consoleErrors,pageErrors:errors})}`);
  return {loginId,password};
}
async function deleteAccount(page,password){
  const status=await page.evaluate(async password=>{
    const response=await fetch('/api/account',{method:'DELETE',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':window.ITK_SESSION_DATA.csrfToken},body:JSON.stringify({password})});
    return response.status;
  },password);
  assert.equal(status,204,'remove synthetic QA account after public staging verification');
}
try{
  const desktop=await makePage({width:1440,height:900});
  const initial=await desktop.evaluate(()=>({revision:THREE.REVISION,missionCount:window.__gameQA.MISSIONS.length,unlocked:window.__gameQA.MISSIONS.every(m=>!window.__gameQA.isLocked(m)),offlineXp:window.__gameQA.state.progress.xp}));
  assert.equal(initial.missionCount,8);assert(initial.unlocked);assert.equal(initial.offlineXp,0);
  const rendered=await desktop.evaluate(()=>{let meshes=0;window.__gameQA.scene.traverse(o=>{if(o.isMesh)meshes++;});return {meshes,calls:window.__gameQA.gl.info.render.calls};});
  assert(rendered.meshes>100);assert(rendered.calls>0);
  const accountOne=await register(desktop,invites[0],'one','QA Engineer One','vest');
  const mobile=await makePage({width:390,height:844});
  const accountTwo=await register(mobile,invites[1],'two','QA Engineer Two','helmet');
  await desktop.waitForFunction(()=>window.__gameQA.players.size===1,{timeout:5000});
  await mobile.waitForFunction(()=>window.__gameQA.players.size===1,{timeout:5000});
  const identities=await Promise.all([desktop.evaluate(()=>[...window.__gameQA.players.values()].map(p=>({name:p.name,disc:p.disc,avatar:p.avatar}))),mobile.evaluate(()=>[...window.__gameQA.players.values()].map(p=>({name:p.name,disc:p.disc,avatar:p.avatar})))]);
  assert.equal(identities[0][0].name,'QA Engineer Two');assert.equal(identities[0][0].avatar.style,'helmet');
  assert.equal(identities[1][0].name,'QA Engineer One');assert.equal(identities[1][0].avatar.style,'vest');
  const start=await desktop.evaluate(()=>({x:window.__gameQA.P.x,z:window.__gameQA.P.z}));
  await desktop.keyboard.down('w');await desktop.waitForTimeout(900);await desktop.keyboard.up('w');
  await mobile.waitForFunction(({id,x,z})=>{const p=window.__gameQA.players.get(id);return p&&(Math.abs(p.x-x)+Math.abs(p.z-z))>0.1;},{id:(await desktop.evaluate(()=>window.ITK_SESSION_DATA.account.id)),...start},{timeout:5000});
  const localPosition=await desktop.evaluate(()=>({x:window.__gameQA.P.x,z:window.__gameQA.P.z}));
  assert(Math.hypot(localPosition.x-start.x,localPosition.z-start.z)>0.1);
  await desktop.evaluate(()=>{const Native=window.WebSocket;let closeNext=true;window.__gameQA.nativeWebSocket=Native;window.WebSocket=new Proxy(Native,{construct(Target,args){const socket=Reflect.construct(Target,args);if(closeNext){closeNext=false;const send=socket.send.bind(socket);socket.send=(...values)=>{if(socket.readyState<2)return send(...values);};socket.addEventListener('open',()=>socket.close());}return socket;}});window.__gameQA.state.socket.close();});
  await desktop.waitForFunction(()=>window.__gameQA.retryState().attempt===1&&window.__gameQA.retryState().pending,{timeout:5000});
  const retryOne=await desktop.evaluate(()=>window.__gameQA.retryState().delayMs);assert(retryOne>=400&&retryOne<=600);
  await desktop.waitForFunction(()=>window.__gameQA.retryState().attempt===2&&window.__gameQA.retryState().pending,{timeout:5000});
  const retryTwo=await desktop.evaluate(()=>window.__gameQA.retryState().delayMs);assert(retryTwo>=800&&retryTwo<=1200);
  await desktop.evaluate(()=>{window.__gameQA.clearReconnectTimer();window.WebSocket=window.__gameQA.nativeWebSocket;});
  await desktop.waitForFunction(()=>!window.__gameQA.state.socket,{timeout:5000});
  await desktop.evaluate(()=>window.__gameQA.connectSocket());await desktop.waitForFunction(()=>window.__gameQA.state.connected,{timeout:8000});
  await desktop.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));window.__gameQA.state.socket.close();});
  await desktop.waitForFunction(()=>!window.__gameQA.retryState().pending&&document.querySelector('#net-status')?.textContent==='Offline',{timeout:5000});
  const offlineNoTimer=await desktop.evaluate(()=>!window.__gameQA.retryState().pending);
  await desktop.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'));});
  await desktop.waitForFunction(()=>window.__gameQA.retryState().pending,{timeout:2000});
  const offlineWake=await desktop.evaluate(()=>window.__gameQA.retryState().delayMs);assert(offlineWake>=1500&&offlineWake<=7000);
  await desktop.waitForFunction(()=>window.__gameQA.state.connected,{timeout:9000});
  await desktop.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});window.__gameQA.state.socket.close();});
  await desktop.waitForFunction(()=>window.__gameQA.retryState().pending,{timeout:5000});
  const backgroundDelay=await desktop.evaluate(()=>window.__gameQA.retryState().delayMs);assert(backgroundDelay>=24000&&backgroundDelay<=300000);
  await desktop.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await desktop.waitForFunction(()=>window.__gameQA.retryState().pending,{timeout:2000});
  const foregroundWake=await desktop.evaluate(()=>window.__gameQA.retryState().delayMs);assert(foregroundWake>=1500&&foregroundWake<=7000);
  await desktop.waitForFunction(()=>window.__gameQA.state.connected,{timeout:9000});
  await desktop.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});window.__gameQA.setRetryAttempt(10);window.__gameQA.state.socket.close();});
  await desktop.waitForFunction(()=>window.__gameQA.retryState().pending,{timeout:5000});
  const backgroundCap=await desktop.evaluate(()=>window.__gameQA.retryState().delayMs);assert(backgroundCap>=240000&&backgroundCap<=300000);
  await desktop.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await desktop.waitForFunction(()=>window.__gameQA.retryState().pending,{timeout:2000});
  const reconnect={firstRetryMs:retryOne,secondRetryMs:retryTwo,offlineNoTimer,offlineWakeMs:offlineWake,backgroundRetryMs:backgroundDelay,foregroundWakeMs:foregroundWake,backgroundCapMs:backgroundCap};
  await desktop.waitForFunction(()=>window.__gameQA.state.connected,{timeout:9000});
  await desktop.evaluate(()=>window.__gameQA.openMission(window.__gameQA.MISSIONS[7]));
  await desktop.locator('#m-text').fill('This pending mission submission tests server persistence without fake AI grading or XP awards.');
  await desktop.locator('#m-submit').click();await desktop.getByText('Pending AI review').waitFor();
  const saved=await desktop.evaluate(async()=>({submissions:(await (await fetch('/api/submissions')).json()).submissions,progress:(await (await fetch('/api/progress')).json()).progress,leaders:(await (await fetch('/api/leaderboard')).json()).leaders}));
  assert.equal(saved.submissions[0].state,'pending');assert.equal(saved.submissions[0].missionId,'release');assert.equal(saved.progress.xp,0);assert.equal(saved.leaders.find(x=>x.name==='QA Engineer One').xp,0);
  await desktop.locator('#phase3-account > button:nth-of-type(2)').click();
  await desktop.getByRole('button',{name:'Mission progress & leaderboard'}).click();
  await desktop.waitForFunction(()=>document.querySelector('#phase3-account pre')?.textContent.split('\n').length===8);
  const dashboard=await desktop.locator('#phase3-account pre').allTextContents();
  assert.equal(dashboard[0].split('\n').length,8);assert.match(dashboard[1],/pending/);assert.match(dashboard[1],/private|pending mission/i);assert.match(dashboard[2],/QA Engineer One · 0 XP/);
  const logoutNavigation=desktop.waitForNavigation({waitUntil:'domcontentloaded'});await desktop.locator('#p3-logout').click();await logoutNavigation;
  await desktop.waitForFunction(()=>window.ITK_SESSION_DATA&&!window.ITK_SESSION_DATA.account);
  await desktop.locator('#phase3-account > button:nth-of-type(2)').click();
  await desktop.locator('#p3-login input[name="loginId"]').fill(accountOne.loginId);
  await desktop.locator('#p3-login input[name="password"]').fill(accountOne.password);
  const loginNavigation=desktop.waitForNavigation({waitUntil:'domcontentloaded'});await desktop.locator('#p3-login button[type="submit"]').click();await loginNavigation;
  await desktop.waitForFunction(()=>window.ITK_SESSION_DATA?.account?.loginId?.startsWith('phase3-one-'));
  const restoredAfterLogin=await desktop.evaluate(()=>({name:window.ITK_SESSION_DATA.profile.name,submission:window.ITK_SESSION_DATA.submissions[0]?.state,xp:window.ITK_SESSION_DATA.progress.xp}));
  assert.equal(restoredAfterLogin.name,'QA Engineer One');assert.equal(restoredAfterLogin.submission,'pending');assert.equal(restoredAfterLogin.xp,0);
  await desktop.evaluate(()=>window.__gameQA.openMission(window.__gameQA.MISSIONS[0]));
  const translation=[];
  await desktop.locator('#m-lang').click();translation.push(await desktop.locator('#m-title').innerText());
  await desktop.locator('#m-lang').click();translation.push(await desktop.locator('#m-title').innerText());
  assert.notEqual(translation[0],translation[1]);
  const count=await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#mission .sheet').scrollWidth<=document.querySelector('#mission .sheet').clientWidth);
  await mobile.evaluate(()=>window.__gameQA.openMission(window.__gameQA.MISSIONS[0]));
  await mobile.setViewportSize({width:390,height:844});
  const mobileLayout=await mobile.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,sheet:document.querySelector('#mission .sheet').scrollWidth,client:document.querySelector('#mission .sheet').clientWidth}));
  assert(count);assert(mobileLayout.document<=mobileLayout.viewport);assert(mobileLayout.sheet<=mobileLayout.client);
  await deleteAccount(desktop,accountOne.password);
  await deleteAccount(mobile,accountTwo.password);
  const report={at:new Date().toISOString(),target:base,world:{...initial,...rendered},accounts:2,accountUI:'invite registration, profile save, logout, sign-in on the same separate browser context; restored profile and pending submission',multiplayer:'two authenticated users: names, disciplines, avatar preferences and movement synchronized through Worker /ws',reconnect,missionSubmission:{state:saved.submissions[0].state,mission:saved.submissions[0].missionId,xp:saved.progress.xp},dashboard:'eight missions, pending submission history and zero-XP leaderboard',leaderboard:'verified-only; no mock XP',languageTitles:translation,mobile:mobileLayout,websocketURLs:websockets,backendRequests:requests.filter(u=>/\/api\/|\/ws(?:$|\?)/.test(u)),externalCustomHostnameRequests:requests.filter(u=>/itkteam\.store/.test(u)),pageErrors:errors,consoleErrors,failedResponses:failures};
  await writeFile(new URL(`${reportName}.json`,output),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,backendRequests:report.backendRequests.map(u=>new URL(u).pathname)},null,2));
  assert.equal(errors.length,0);assert.equal(failures.filter(f=>new URL(f.url).origin===new URL(base).origin).length,0);assert.equal(report.externalCustomHostnameRequests.length,0);assert(websockets.some(url=>url.endsWith('/ws')));
}finally{
  for(const item of testAccounts.reverse())try{await deleteAccount(item.page,item.password);}catch{}
  for(const {context}of pages)await context.close();
  await browser.close();
}
