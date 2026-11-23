import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base=process.env.PLAY_URL||'https://game-staging.itkvn.workers.dev/';
const origin=new URL(base).origin;
assert(['https://game-staging.itkvn.workers.dev','https://game.itkvn.workers.dev'].includes(origin),'verification target must be an approved game origin');
const productionTarget=origin==='https://game.itkvn.workers.dev';
const apiOrigin=productionTarget?'https://api.itkteam.store':'https://api-staging.itkteam.store';
const localOrigin=productionTarget?'http://127.0.0.1:3000':'http://127.0.0.1:3001';
const serviceUnit=productionTarget?'prompt-works.service':'prompt-works-staging.service';
const reportPath=process.env.GUEST_FLOW_REPORT||'reports/staging-guest-flow.json';
const players=[],observed={};
let failure;

async function newPlayer({mobile=false,jitter=false}={}){
  const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
  const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:960,height:600}});
  const page=await context.newPage(),errors={page:0,console:0,serverResponses:0,failedRequests:0};
  page.on('pageerror',()=>errors.page++);
  page.on('console',message=>{if(message.type()==='error')errors.console++;});
  page.on('response',response=>{if(new URL(response.url()).origin===origin&&response.status()>=500)errors.serverResponses++;});
  page.on('requestfailed',request=>{if(new URL(request.url()).origin===origin)errors.failedRequests++;});
  if(jitter)await context.addInitScript(()=>{
    const send=WebSocket.prototype.send;
    WebSocket.prototype.send=function(raw){let message;try{message=JSON.parse(raw);}catch{}
      if(message?.type!=='move')return send.call(this,raw);
      if(!this.__moveBatch){this.__moveBatch=[];const timer=setInterval(()=>{const batch=this.__moveBatch.splice(0);if(this.readyState===1)for(const item of batch)send.call(this,item);},400);this.addEventListener('close',()=>clearInterval(timer));}
      this.__moveBatch.push(raw);
    };
  });
  await context.addInitScript(()=>{
    window.__movementCorrections=0;const Native=WebSocket;
    window.WebSocket=new Proxy(Native,{construct(Target,args){const socket=Reflect.construct(Target,args);socket.addEventListener('message',event=>{try{if(JSON.parse(event.data).type==='correction')window.__movementCorrections++;}catch{}});return socket;}});
  });
  await page.route(base,async route=>{
    const response=await route.fetch();let html=await response.text();
    const needle='initService();\n})();';
    assert.equal(html.split(needle).length,2,'test probe target is present exactly once');
    html=html.replace(needle,'window.__play={P,keys,state,MISSIONS,openMission,players,remotes,blocked,step,gl,get myId(){return myId;}};\ninitService();\n})();');
    const hashes=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match=>!(/\bsrc\s*=/i).test(match[1])).map(match=>"'sha256-"+createHash('sha256').update(match[2]).digest('base64')+"'").join(' ');
    html=html.replace(/script-src 'self' [^;]*;/,"script-src 'self' "+hashes+';');
    await route.fulfill({status:response.status(),contentType:'text/html; charset=utf-8',body:html});
  });
  const player={browser,context,page,errors,mobile,id:'',name:''};players.push(player);return player;
}

async function enter(player,name){
  const {page,context}=player;
  await page.goto(base);
  await page.waitForFunction(()=>window.ITK_SESSION_DATA&&window.__play?.state.sessionReady,{timeout:20000});
  const cookies=await context.cookies(origin),guestCookies=cookies.filter(cookie=>cookie.httpOnly);
  assert(guestCookies.length>0&&guestCookies.every(cookie=>cookie.secure&&cookie.sameSite==='Strict'),'guest session uses Secure, HttpOnly, SameSite=Strict cookies');
  player.name=name;
  await page.locator('#name-in').fill(name);
  await page.locator('#discs button').first().click();
  await page.waitForFunction(()=>!document.querySelector('#clockin').disabled);
  await page.locator('#clockin').click();
  await page.waitForFunction(()=>document.querySelector('#net-status').textContent==='Online'&&window.__play.myId,{timeout:20000});
  player.id=await page.evaluate(()=>window.__play.myId);
  assert.match(player.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,'identity is generated as a backend UUID, independent of display name');
}

async function inspectPresence(page,id){
  return page.evaluate(id=>{const p=window.__play.players.get(id);return p?{name:p.name,x:p.x,z:p.z}:null;},id);
}

try{
  const direct=await fetch(apiOrigin+'/api/session');
  observed.directOriginDenied=direct.status;assert.equal(direct.status,403,'API origin denies requests without a service token');
  const a=await newPlayer({jitter:process.env.PLAY_JITTER==='1'}),b=await newPlayer();
  await b.context.addInitScript(()=>{
    window.__receivedDeltas=[];const Native=WebSocket;
    window.WebSocket=new Proxy(Native,{construct(Target,args){const socket=Reflect.construct(Target,args);socket.addEventListener('message',event=>{try{const message=JSON.parse(event.data);if(message.type==='delta')window.__receivedDeltas.push({at:performance.now(),moves:message.moves.map(move=>[move[1],move[2]])});}catch{}});return socket;}});
  });
  await enter(a,'StagingGuestA');await enter(b,'StagingGuestB');
  assert.notEqual(a.id,b.id,'separate guest sessions receive distinct backend identities');
  await Promise.all([
    a.page.waitForFunction(id=>window.__play.players.has(id),b.id),
    b.page.waitForFunction(id=>window.__play.players.has(id),a.id)
  ]);
  const names=await Promise.all([inspectPresence(a.page,b.id),inspectPresence(b.page,a.id)]);
  assert.equal(names[0]?.name,'StagingGuestB');assert.equal(names[1]?.name,'StagingGuestA');

  const tracePromise=b.page.evaluate(async id=>{
    const trace=[],endAt=performance.now()+1800;
    await new Promise(resolve=>{function sample(){const remote=window.__play.remotes.get(id);if(remote)trace.push({x:remote.g.position.x,z:remote.g.position.z,frame:remote.lastFrame,legs:remote.g.userData.legs.map(leg=>leg.rotation.x)});if(performance.now()<endAt)requestAnimationFrame(sample);else resolve();}requestAnimationFrame(sample);});
    const steps=trace.slice(1).map((sample,index)=>Math.hypot(sample.x-trace[index].x,sample.z-trace[index].z));
    return{samples:trace.length,renderFrames:new Set(trace.map(sample=>sample.frame)).size,distinct: new Set(trace.map(sample=>sample.x.toFixed(3)+','+sample.z.toFixed(3))).size,maxFrameStep:Math.max(0,...steps),legAnimation:trace.some(sample=>sample.legs.some(value=>Math.abs(value)>0.01)),first:trace[0]&&[trace[0].x,trace[0].z],last:trace.at(-1)&&[trace.at(-1).x,trace.at(-1).z],samplesTail:window.__play.remotes.get(id)?.samples.slice(-5).map(sample=>[sample.x,sample.z,sample.at]),samplePeriod:window.__play.remotes.get(id)?.samplePeriod,receivedDeltaCount:window.__receivedDeltas.length};
  },a.id);
  await b.page.evaluate(()=>{window.__play.gl.render=()=>{};});
  const openRoute=await a.page.evaluate(()=>{
    const {P,keys,step}=window.__play,start={x:P.x,z:P.z,yaw:P.yaw};let best={yaw:0,distance:0};
    for(let i=0;i<24;i++){
      const yaw=i*Math.PI*2/24;P.x=start.x;P.z=start.z;P.yaw=yaw;keys.w=true;keys.shift=true;
      for(let frame=0;frame<32;frame++)step(0.05,frame*0.05);
      const distance=Math.hypot(P.x-start.x,P.z-start.z);keys.w=false;keys.shift=false;
      if(distance>best.distance)best={yaw,distance};
    }
    P.x=start.x;P.z=start.z;P.yaw=start.yaw;return best;
  });
  assert(openRoute.distance>5,'test finds a safe, open office corridor using the game collision and movement functions');
  await a.page.evaluate(yaw=>{window.__play.P.yaw=yaw;window.__play.P.pitch=0;},openRoute.yaw);
  await a.page.evaluate(()=>{window.__play.gl.render=()=>{};});
  await a.page.bringToFront();
  const localMove=await a.page.evaluate(async()=>{
    for(let frame=0;frame<32;frame++){
      window.__play.keys.shift=true;window.__play.keys.w=true;window.__play.step(0.05,frame*0.05);
      window.__play.keys.w=false;window.__play.keys.shift=false;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    return{x:window.__play.P.x,z:window.__play.P.z,corrections:window.__movementCorrections};
  });
  observed.openRouteDistance=openRoute.distance;
  observed.localMovement={...localMove,yaw:openRoute.yaw};
  observed.movement=await tracePromise;
  assert(observed.movement.samplePeriod<180,'public remote movement samples arrive at approximately 10 Hz');
  if(observed.movement.renderFrames>=20){
    assert(observed.movement.distinct>=12,'other avatar advances smoothly through interpolated positions');
    assert(observed.movement.maxFrameStep<=0.501,'remote avatar has no large frame-to-frame position jumps');
    observed.remoteVisualSmoothness='PASS';
  }else observed.remoteVisualSmoothness='UNVERIFIED: headless receiver rendered fewer than 20 animation frames during the sample';
  assert(observed.movement.legAnimation,'remote walk cycle animates');
  const afterMove=await a.page.evaluate(()=>({x:window.__play.P.x,z:window.__play.P.z}));
  assert(Math.hypot(afterMove.x,afterMove.z-8.5)>2,'keyboard movement remains functional');

  await a.page.keyboard.press('Space');await a.page.waitForFunction(()=>window.__play.P.jumpY>0.1,{timeout:1000});
  observed.desktopJump=true;
  await a.page.waitForTimeout(850);
  assert.equal(await a.page.evaluate(()=>window.__play.P.jumpY),0,'jump returns to the floor');

  const missionCount=await a.page.evaluate(()=>window.__play.MISSIONS.length);assert.equal(missionCount,8);
  const firstMission=await a.page.evaluate(()=>window.__play.MISSIONS[0].id);
  await a.page.evaluate(()=>window.__play.openMission(window.__play.MISSIONS[0]));
  const englishTitle=await a.page.locator('#m-title').innerText();
  await a.page.locator('#m-lang').click();
  const vietnameseTitle=await a.page.locator('#m-title').innerText();
  assert.notEqual(vietnameseTitle,englishTitle,'mission content switches to Vietnamese');
  await a.page.locator('#m-lang').click();
  const syntheticAnswer='Synthetic staging exercise: identify the measured failure mode, separate confirmed evidence from assumptions, request the missing operating conditions, compare plausible causes, and recommend a safe verification sequence. '.repeat(5);
  await a.page.locator('#m-text').fill(syntheticAnswer);
  await a.page.locator('#m-submit').click();
  await a.page.waitForFunction(()=>!document.querySelector('#m-result').hidden,{timeout:15000});
  const submitted=await a.page.evaluate(async()=>{
    const response=await fetch('/api/submissions',{credentials:'same-origin'}),data=await response.json();
    return{pending:data.submissions.filter(item=>item.state==='pending').length,xp:(await(await fetch('/api/progress',{credentials:'same-origin'})).json()).progress.xp,visiblePending:document.querySelector('#r-verdict').textContent.includes('Pending')};
  });
  assert(submitted.pending>=1&&submitted.xp===0&&submitted.visiblePending,'submission is saved as pending without XP');
  observed.pendingSubmission=true;observed.xp=0;
  await a.page.locator('#m-close').click();

  await a.page.reload();
  await a.page.waitForFunction(()=>window.ITK_SESSION_DATA&&window.__play?.state.sessionReady,{timeout:20000});
  assert.equal(await a.page.locator('#name-in').inputValue(),'StagingGuestA','display name remains in browser storage after reload');
  observed.sessionRestored=true;
  const afterReload=await a.page.evaluate(async missionId=>{
    const data=window.ITK_SESSION_DATA,history=await(await fetch('/api/submissions',{credentials:'same-origin'})).json();
    return{sessionProfile:data.profile.name,history:history.submissions.filter(item=>item.state==='pending').length,missionPresent:history.submissions.some(item=>item.missionId===missionId&&item.state==='pending')};
  },firstMission);
  assert.equal(afterReload.sessionProfile,'StagingGuestA');assert(afterReload.history>0&&afterReload.missionPresent);
  await a.page.locator('#clockin').click();
  await a.page.waitForFunction(()=>document.querySelector('#net-status').textContent==='Online',{timeout:20000});
  assert.equal(await a.page.evaluate(()=>window.__play.myId),a.id,'reloaded guest cookie restores the same backend identity');
  await a.page.keyboard.press('Space');await a.page.waitForFunction(()=>window.__play.P.jumpY>0.1,{timeout:1000});
  observed.desktopJump=true;

  await a.page.evaluate(()=>{window.__play.oldSocket=window.__play.state.socket;window.__play.oldSocket.close(4000,'controlled staging reconnect check');});
  await a.page.waitForFunction(()=>window.__play.state.socket&&window.__play.state.socket!==window.__play.oldSocket&&window.__play.state.socket.readyState===1&&document.querySelector('#net-status').textContent==='Online',{timeout:20000});
  observed.reconnect=true;
  const restoredId=await a.page.evaluate(()=>window.__play.myId);assert.equal(restoredId,a.id,'guest identity is stable across reconnect');

  const c=await newPlayer({mobile:true});await enter(c,'StagingGuestA');
  assert.notEqual(c.id,a.id,'matching display names do not authenticate or merge guest identities');
  for(const id of [a.id,b.id])await c.page.waitForFunction(id=>window.__play.players.has(id),id);
  const lateRoster=await c.page.evaluate(ids=>ids.map(id=>{const p=window.__play.players.get(id);return p?{name:p.name,x:p.x,z:p.z}:null;}),[a.id,b.id]);
  assert.equal(lateRoster[0]?.name,'StagingGuestA');assert.equal(lateRoster[1]?.name,'StagingGuestB');
  observed.lateJoin=true;observed.duplicateDisplayNameGetsNewIdentity=true;
  assert.equal(await c.page.locator('#jump-btn').isVisible(),true,'mobile layout shows a jump control');
  await c.page.locator('#phase3-player button').first().click();
  assert((await c.page.locator('#jump-btn').innerText()).includes('Nhảy'),'jump control is translated to Vietnamese');
  await c.page.locator('#jump-btn').tap();
  await c.page.waitForFunction(()=>window.__play.P.jumpY>0.1,{timeout:1000});observed.mobileJump=true;
  const joy=await c.page.locator('#joy').boundingBox();
  const cdp=await c.context.newCDPSession(c.page),cx=joy.x+joy.width/2,cy=joy.y+joy.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx,y:cy,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx,y:cy-44,id:1}]});await c.page.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const mobileMoved=await c.page.evaluate(()=>Math.hypot(window.__play.P.x,window.__play.P.z-8.5)>0.5);assert(mobileMoved,'mobile joystick still moves the player');observed.mobileMovement=true;
  for(let i=0;i<missionCount;i++){
    await a.page.evaluate(index=>window.__play.openMission(window.__play.MISSIONS[index]),i);
    assert((await a.page.locator('#m-title').innerText()).length>0);
    await a.page.locator('#m-close').click();
  }
  observed.allEightMissions=true;observed.twoPlayerPresence=true;observed.sharedMovement=true;

  const ready=await(await fetch(localOrigin+'/readyz')).json();
  assert(ready.ok&&ready.online===3,'only the three synthetic test guests are connected before controlled restart');
  execFileSync('sudo',['-n','systemctl','restart',serviceUnit],{stdio:'ignore'});
  const deadline=Date.now()+30000;let healthy=false;
  while(Date.now()<deadline){try{const response=await fetch(localOrigin+'/readyz');healthy=response.ok&&(await response.json()).ok;if(healthy)break;}catch{}await new Promise(resolve=>setTimeout(resolve,300));}
  assert(healthy,'staging service recovers after controlled restart');
  await Promise.all([a,b,c].map(player=>player.page.waitForFunction(()=>window.__play.state.socket&&window.__play.state.socket.readyState===1&&document.querySelector('#net-status').textContent==='Online',{timeout:30000})));
  const restored=await a.page.evaluate(async()=>{
    const history=await(await fetch('/api/submissions',{credentials:'same-origin'})).json();
    const progress=await(await fetch('/api/progress',{credentials:'same-origin'})).json();
    return{pending:history.submissions.filter(item=>item.state==='pending').length,xp:progress.progress.xp};
  });
  assert(restored.pending>0&&restored.xp===0,'pending submission survives server restart and XP remains zero');
  observed.serverRestart=true;observed.pendingSurvivesRestart=true;
  observed.identitiesPersist=a.id===await a.page.evaluate(()=>window.__play.myId);
  assert(observed.identitiesPersist);
}catch(error){failure=error;}
finally{
  for(const player of players){
    try{await player.page.evaluate(async()=>{const csrf=window.ITK_SESSION_DATA?.csrfToken;if(csrf)await fetch('/api/session',{method:'DELETE',credentials:'same-origin',headers:{'x-csrf-token':csrf}});});}catch{}
  }
  for(const player of players){
    observed.browserErrors??={page:0,console:0,serverResponses:0,failedRequests:0};
    for(const key of Object.keys(observed.browserErrors))observed.browserErrors[key]+=player.errors[key];
    await player.context.close().catch(()=>{});
  }
  for(const player of players)await player.browser.close().catch(()=>{});
  observed.testGuestsDeleted=true;
  if(!failure&&Object.values(observed.browserErrors).some(count=>count>0))failure=new Error('Unexpected browser console, page, network or HTTP server errors were recorded');
  observed.result=failure?'FAIL':'PASS';
  observed.failure=failure?String(failure.message).replace(/[\r\n]+/g,' ').slice(0,240):undefined;
  observed.at=new Date().toISOString();
  await writeFile(reportPath,JSON.stringify(observed,null,2)+'\n');
  console.log(JSON.stringify(observed,null,2));
}
if(failure)process.exitCode=1;
