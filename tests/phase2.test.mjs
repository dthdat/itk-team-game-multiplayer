import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

async function freePort() {
  const probe=createTcpServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;
}

function clientFor(socket) {
  const messages=[],waiters=[];
  socket.on('message',raw=>{
    let message;
    try { message=JSON.parse(raw.toString()); } catch { return; }
    messages.push(message);
    for(let index=waiters.length-1;index>=0;index--){
      const waiter=waiters[index];
      if(waiter.predicate(message)){waiters.splice(index,1);clearTimeout(waiter.timer);waiter.resolve(message);}
    }
  });
  return {
    messages,
    waitFor(predicate,timeoutMs=5000){
      const index=messages.findIndex(predicate);
      if(index>=0)return Promise.resolve(messages.splice(index,1)[0]);
      return new Promise((resolve,reject)=>{
        const waiter={predicate,resolve,timer:setTimeout(()=>{
          const index=waiters.indexOf(waiter);if(index>=0)waiters.splice(index,1);
          reject(new Error('Timed out waiting for WebSocket message'));
        },timeoutMs)};
        waiters.push(waiter);
      });
    }
  };
}

test('phase 2 room lifecycle, server-owned progress, and abuse controls', async t => {
  const port=await freePort(),origin=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['dist/server/index.js'],{
    cwd:process.cwd(),
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',SQLITE_PATH:':memory:',GRADING_PROVIDER:'mock',ROOM_CAPACITY:'80',SESSION_STARTS_PER_IP_HOUR:'100'},
    stdio:['ignore','ignore','pipe']
  });
  const sockets=[];
  let serverOutput='';server.stderr.on('data',chunk=>serverOutput+=chunk);
  t.after(async()=>{
    for(const socket of sockets)socket.terminate();
    if(server.exitCode===null){server.kill('SIGTERM');await Promise.race([once(server,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);}
  });

  let health;
  for(let attempt=0;attempt<60;attempt++){
    try{health=await fetch(`${origin}/healthz`);if(health.ok)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(health?.status,200,serverOutput);

  async function createGuest(name){
    const response=await fetch(`${origin}/api/session`);
    const data=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
    const guest={id:undefined,cookie,csrf:data.csrfToken,headers:{cookie,origin,'content-type':'application/json','x-csrf-token':data.csrfToken}};
    const profile=await fetch(`${origin}/api/profile`,{method:'POST',headers:guest.headers,body:JSON.stringify({name,disc:'powertrain'})});
    assert.equal(profile.status,200);
    return guest;
  }
  async function connect(guest,type='hello'){
    const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{headers:{cookie:guest.cookie,origin}});sockets.push(socket);
    const client=clientFor(socket);
    await once(socket,'open');
    const welcomed=client.waitFor(message=>message.type==='welcome');
    socket.send(JSON.stringify(type==='hello'?{type:'hello',v:1}:{type:'reconnect',v:1}));
    const welcome=await welcomed;guest.id=welcome.you;
    return {guest,socket,client,welcome};
  }
  async function review(guest,submissionId,answer){
    return fetch(`${origin}/api/review`,{method:'POST',headers:guest.headers,body:JSON.stringify({submissionId,missionId:'onboard',answer})});
  }

  const stationaryGuest=await createGuest('Stationary Player');
  const stationary=await connect(stationaryGuest);
  const lateGuest=await createGuest('Late Joiner');
  const late=await connect(lateGuest);
  const visible=late.welcome.players.find(player=>player.id===stationaryGuest.id);
  assert.ok(visible,'late join receives the stationary player in its initial roster');
  assert.deepEqual([visible.x,visible.z],[0,8.5]);
  await stationary.client.waitFor(message=>message.type==='join'&&message.player.id===lateGuest.id);

  late.socket.send(JSON.stringify({type:'move',seq:1,x:0.2,z:8.5,yaw:0}));
  const movement=await stationary.client.waitFor(message=>message.type==='delta'&&message.moves.some(move=>move[0]===lateGuest.id));
  assert.equal(movement.moves.find(move=>move[0]===lateGuest.id)[1],0.2);

  late.socket.send(JSON.stringify({type:'move',seq:2,x:0.2,z:8.5,yaw:0,xp:999999}));
  assert.equal((await late.client.waitFor(message=>message.type==='error')).code,'INVALID_MESSAGE');
  const spoofedReview=await fetch(`${origin}/api/review`,{method:'POST',headers:lateGuest.headers,body:JSON.stringify({submissionId:randomUUID(),missionId:'onboard',answer:'A sufficiently long but fictional engineering response. '.repeat(12),xp:999999,score:100,verified:true})});
  assert.equal(spoofedReview.status,400);

  const answer='Engineering review: compare plausible causes, distinguish measured evidence from assumptions, request missing temperature and wheel-speed data, and choose a safe diagnostic sequence. '.repeat(5);
  const submissionId=randomUUID();
  const first=await review(lateGuest,submissionId,answer);
  const firstBody=await first.json();
  assert.equal(first.status,200);
  assert.equal(firstBody.review.verified,false);
  assert.equal(firstBody.progress.xp,0);
  const duplicate=await review(lateGuest,submissionId,answer);
  assert.equal(duplicate.status,200);
  assert.equal((await duplicate.json()).cached,true);
  const conflicting=await review(lateGuest,submissionId,`${answer} changed`);
  assert.equal(conflicting.status,409);
  const ownProgress=await (await fetch(`${origin}/api/session`,{headers:{cookie:lateGuest.cookie}})).json();
  assert.equal(ownProgress.progress.xp,0);
  await stationary.client.waitFor(message=>message.type==='progress'&&message.player.id===lateGuest.id&&message.player.xp===0);

  const departingGuest=await createGuest('Departing Player');
  const departing=await connect(departingGuest);
  await stationary.client.waitFor(message=>message.type==='join'&&message.player.id===departingGuest.id);
  const closed=once(departing.socket,'close');
  departing.socket.send(JSON.stringify({type:'leave'}));
  await closed;
  await stationary.client.waitFor(message=>message.type==='leave'&&message.id===departingGuest.id);

  const reconnectClose=once(late.socket,'close');late.socket.close(1000,'phase 2 reconnect');await reconnectClose;
  await stationary.client.waitFor(message=>message.type==='leave'&&message.id===lateGuest.id);
  const reconnected=await connect(lateGuest);
  assert.equal(reconnected.welcome.you,lateGuest.id);
  assert.equal(reconnected.welcome.progress.xp,0);
  assert.ok(reconnected.welcome.players.some(player=>player.id===stationaryGuest.id));

  const rateGuest=await createGuest('Rate Limit Check');
  const rateClient=await connect(rateGuest);
  const closePromise=once(rateClient.socket,'close');
  for(let index=0;index<60;index++)rateClient.socket.send(JSON.stringify({type:'ping',at:index}));
  const [closeCode]=await closePromise;
  assert.equal(closeCode,4008,'WebSocket message flood is closed by the server');

  const quotaGuest=await createGuest('Review Quota Check');
  const quotaAnswer='A fictional engineering assessment with explicit evidence, alternative causes, missing data, and a cautious diagnostic plan. '.repeat(5);
  for(let index=0;index<8;index++){
    const response=await review(quotaGuest,randomUUID(),`${quotaAnswer} submission ${index}`);
    assert.equal(response.status,200,`review ${index+1} should fit within quota`);
  }
  const limited=await review(quotaGuest,randomUUID(),`${quotaAnswer} ninth submission`);
  assert.equal(limited.status,429);
});