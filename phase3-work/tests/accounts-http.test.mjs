import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as reservePort } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/server/store.js';
import { Accounts } from '../dist/server/accounts.js';
import WebSocket from 'ws';

async function freePort(){const s=reservePort();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function start(port,db,nodeEnv='development',extraEnv={}){const child=spawn(process.execPath,['dist/server/index.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:nodeEnv,SQLITE_PATH:db,ROOM_CAPACITY:'80',GRADING_PROVIDER:'mock',...extraEnv},stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);const base=`http://127.0.0.1:${port}`;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(stderr);try{if((await fetch(base+'/healthz')).ok)return {child,base};}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('server did not become ready '+stderr);}
const cookieFrom=r=>(r.headers.getSetCookie()||[]).map(x=>x.split(';')[0]).filter(x=>!x.includes('=;')).join('; ');
const req=(base,path,{method='GET',cookie='',csrf='',body}={})=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...(body?{'content-type':'application/json','origin':base}:{})},...(body?{body:JSON.stringify(body)}:{})});
function socket(url,cookie,origin,proxySecret){return new Promise((resolve,reject)=>{const ws=new WebSocket(url,{headers:{cookie,origin,...(proxySecret?{'x-game-proxy-auth':proxySecret}:{})},handshakeTimeout:5000});ws.once('open',()=>ws.send(JSON.stringify({type:'hello',v:1})));ws.once('message',b=>resolve({ws,message:JSON.parse(b.toString())}));ws.once('error',reject);});}

test('account HTTP, pending submission, authenticated WebSocket and persistence across restart', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'itk-account-http-')),db=join(dir,'game.sqlite'),port=await freePort();let server;
 try{
  let seed=new Store(db),auth=new Accounts(seed.db),invite=auth.issueInvite();seed.close();
  server=await start(port,db);let {base}=server;
  let session=await req(base,'/api/session');let cookie=cookieFrom(session),guest=await session.json();assert.equal(session.status,200);assert.ok(cookie.includes('pw_session='));
  let registered=await req(base,'/api/account/register',{method:'POST',cookie,csrf:guest.csrfToken,body:{invitation:invite,loginId:'Test.Engineer',password:'Correct horse battery staple 42',migrateGuest:false}});assert.equal(registered.status,201,await registered.clone().text());let authData=await registered.json();cookie=cookieFrom(registered);assert.ok(cookie.includes('pw_account='));assert.equal(authData.profile.name,'');
  let profile=await req(base,'/api/profile',{method:'POST',cookie,csrf:authData.csrfToken,body:{name:'Test Engineer',disc:'powertrain',avatar:{color:'#226688',style:'helmet'}}});assert.equal(profile.status,200,await profile.clone().text());
  const submissionId=crypto.randomUUID();let submitted=await req(base,'/api/submissions',{method:'POST',cookie,csrf:authData.csrfToken,body:{submissionId,missionId:'onboard',answer:'An honest pending engineering answer'}});assert.equal(submitted.status,202,await submitted.clone().text());assert.equal((await submitted.json()).state,'pending');
  const history=await (await req(base,'/api/submissions',{cookie})).json();assert.equal(history.submissions.length,1);
  const board=await (await req(base,'/api/leaderboard',{cookie})).json();assert.equal(board.leaders[0].xp,0);
  const connected=await socket(`ws://127.0.0.1:${port}/ws`,cookie,base);assert.equal(connected.message.you,authData.account.id);assert.equal(connected.message.players.length,0);assert.equal(connected.message.self.avatar.style,'helmet');
  connected.ws.send(JSON.stringify({type:'move',seq:1,x:0.25,z:8.5,yaw:Math.PI}));await new Promise(r=>setTimeout(r,40));connected.ws.close();
  const exported=await (await req(base,'/api/account/export',{cookie})).json();assert.equal(exported.submissions[0].answer,'An honest pending engineering answer');
  server.child.kill('SIGTERM');await new Promise(r=>server.child.once('exit',r));
  server=await start(port,db);base=server.base;
  const restored=await req(base,'/api/session',{cookie});assert.equal(restored.status,200);const restoredBody=await restored.json();assert.equal(restoredBody.account.loginId,'test.engineer');assert.equal(restoredBody.progress.xp,0);assert.equal(restoredBody.submissions[0].state,'pending');
  const reconnected=await socket(`ws://127.0.0.1:${port}/ws`,cookie,base);assert.equal(reconnected.message.you,authData.account.id);assert.equal(reconnected.message.self.x,0.25);reconnected.ws.close();
  const wrong=await req(base,'/api/account/login',{method:'POST',cookie,csrf:restoredBody.csrfToken,body:{loginId:'test.engineer',password:'wrong password'}});assert.equal(wrong.status,401);
  const deleted=await req(base,'/api/account',{method:'DELETE',cookie,csrf:restoredBody.csrfToken,body:{password:'Wrong password 123'}});assert.equal(deleted.status,403);
  const logout=await req(base,'/api/account/logout',{method:'POST',cookie,csrf:restoredBody.csrfToken,body:{}});assert.equal(logout.status,204);
  const guestSession=await req(base,'/api/session'),guestCookie=cookieFrom(guestSession),guestBody=await guestSession.json();
  const login=await req(base,'/api/account/login',{method:'POST',cookie:guestCookie,csrf:guestBody.csrfToken,body:{loginId:'test.engineer',password:'Correct horse battery staple 42'}});assert.equal(login.status,200);const loginBody=await login.json(),loginCookie=cookieFrom(login);assert.equal(loginBody.account.id,authData.account.id);
  const activeSocket=await socket(`ws://127.0.0.1:${port}/ws`,loginCookie,base),socketClosed=new Promise(resolve=>activeSocket.ws.once('close',resolve));
  const accountDelete=await req(base,'/api/account',{method:'DELETE',cookie:loginCookie,csrf:loginBody.csrfToken,body:{password:'Correct horse battery staple 42'}});assert.equal(accountDelete.status,204);
  await socketClosed;
  const expired=await req(base,'/api/session',{cookie:loginCookie}),expiredBody=await expired.json();assert.equal(expiredBody.sessionExpired,true);assert.equal(expiredBody.account,undefined);
  assert.equal((await req(base,'/api/account/export',{cookie:loginCookie})).status,401);
 }finally{if(server){server.child.kill('SIGTERM');await new Promise(r=>server.child.once('exit',r));}await rm(dir,{recursive:true,force:true});}
});

test('production guest session cookie is HttpOnly, Secure, Strict and path-scoped',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'itk-prod-cookie-')),db=join(dir,'game.sqlite'),port=await freePort();let server;
 try{
  server=await start(port,db,'production');
  const response=await req(server.base,'/api/session');assert.equal(response.status,200);
  const cookie=response.headers.getSetCookie().find(value=>value.startsWith('pw_session='));assert.ok(cookie);
  assert.match(cookie,/; Path=\//);assert.match(cookie,/; HttpOnly/);assert.match(cookie,/; SameSite=Strict/);assert.match(cookie,/; Secure/);
 }finally{if(server){server.child.kill('SIGTERM');await new Promise(r=>server.child.once('exit',r));}await rm(dir,{recursive:true,force:true});}
});

test('configured backend rejects direct API and WebSocket requests without the Worker secret',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'itk-proxy-required-')),db=join(dir,'game.sqlite'),port=await freePort();let server;
 const origin='https://game-staging.itkvn.workers.dev',proxySecret='staging-proxy-secret-value-with-at-least-32-bytes';
 try{
  server=await start(port,db,'production',{PUBLIC_GAME_ORIGIN:origin,TRUSTED_PROXY_SECRET:proxySecret});
  const direct=await fetch(`${server.base}/api/session`,{headers:{origin}});assert.equal(direct.status,403);
  const proxied=await fetch(`${server.base}/api/session`,{headers:{origin,'x-game-proxy-auth':proxySecret}});assert.equal(proxied.status,200);
  const cookie=cookieFrom(proxied);assert.ok(cookie.includes('pw_session='));
  const wsUrl=server.base.replace(/^http:/,'ws:')+'/ws';
  const denied=await new Promise(resolve=>{
   const ws=new WebSocket(wsUrl,{headers:{origin},handshakeTimeout:5000});let finished=false;
   const finish=status=>{if(finished)return;finished=true;ws.terminate();resolve(status);};
   ws.once('unexpected-response',(_request,response)=>finish(response.statusCode));
   ws.once('open',()=>finish(101));ws.once('error',()=>finish(0));
  });
  assert.equal(denied,403);
  const accepted=await socket(wsUrl,cookie,origin,proxySecret);assert.equal(accepted.message.type,'welcome');accepted.ws.close();
 }finally{if(server){server.child.kill('SIGTERM');await new Promise(r=>server.child.once('exit',r));}await rm(dir,{recursive:true,force:true});}
});
