import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

async function freePort() {
  const probe=createTcpServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;
}

test('same-origin session, CSRF, grading API, static assets, and WebSocket handshake', async t => {
  const port=await freePort(),origin=`http://127.0.0.1:${port}`;
  const processServer=spawn(process.execPath,['--env-file-if-exists=.env','dist/server/index.js'],{
    cwd:process.cwd(),
    env:{...process.env,PORT:String(port),SQLITE_PATH:':memory:',GRADING_PROVIDER:'mock',NODE_ENV:'test'},
    stdio:['ignore','ignore','pipe']
  });
  let serverOutput='';processServer.stderr.on('data',chunk=>serverOutput+=chunk);
  const sockets=[];
  t.after(async()=>{
    for(const socket of sockets)socket.terminate();
    if(processServer.exitCode===null){processServer.kill('SIGTERM');await Promise.race([once(processServer,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);}
  });
  let health;
  for(let attempt=0;attempt<60;attempt++){
    try{health=await fetch(`${origin}/healthz`);if(health.ok)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(health?.status,200,serverOutput);
  assert.equal((await fetch(`${origin}/_load/metrics`)).status,404);
  assert.equal((await fetch(origin)).status,200);
  assert.match(await (await fetch(`${origin}/vendor/three.min.js`)).text(),/three\.js/i);
  assert.equal((await fetch(`${origin}/api/profile`,{method:'POST'})).status,401);

  const sessionResponse=await fetch(`${origin}/api/session`);
  const session=await sessionResponse.json();
  const cookie=sessionResponse.headers.get('set-cookie').split(';')[0];
  const headers={cookie,origin,'content-type':'application/json','x-csrf-token':session.csrfToken};
  const profile=await fetch(`${origin}/api/profile`,{method:'POST',headers:{...headers,origin:'https://attacker.invalid'},body:JSON.stringify({name:'Engineer One',disc:'powertrain'})});
  assert.equal(profile.status,403);
  const saved=await fetch(`${origin}/api/profile`,{method:'POST',headers,body:JSON.stringify({name:'Engineer One',disc:'powertrain'})});
  assert.equal(saved.status,200);

  const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{headers:{cookie,origin}});sockets.push(socket);
  await once(socket,'open');
  socket.send(JSON.stringify({type:'hello',v:1}));
  const [welcomeRaw]=await once(socket,'message');
  const welcome=JSON.parse(welcomeRaw.toString());
  assert.equal(welcome.type,'welcome');
  assert.equal(welcome.progress.xp,0);
  socket.send(JSON.stringify({type:'move',seq:1,x:30,z:0,yaw:0}));
  const [correctionRaw]=await once(socket,'message');
  assert.equal(JSON.parse(correctionRaw.toString()).type,'correction');

  const reviewed=await fetch(`${origin}/api/review`,{method:'POST',headers,body:JSON.stringify({submissionId:crypto.randomUUID(),missionId:'onboard',answer:'A practical mock answer with enough words to reach the configured review minimum, but no scoring is actually performed here.'})});
  assert.equal(reviewed.status,200);
  const result=await reviewed.json();
  assert.equal(result.review.verified,false);
  assert.equal(result.progress.xp,0);
  const locked=await fetch(`${origin}/api/review`,{method:'POST',headers,body:JSON.stringify({submissionId:crypto.randomUUID(),missionId:'release',answer:'A long answer that cannot bypass mission gates on the server regardless of what a modified browser claims.'})});
  assert.equal(locked.status,403);
  assert.equal((await fetch(`${origin}/api/reset`,{method:'POST',headers,body:'{}'})).status,200);
  const deleted=await fetch(`${origin}/api/session`,{method:'DELETE',headers,body:'{}'});
  assert.equal(deleted.status,204);
  assert.equal((await fetch(`${origin}/api/profile`,{method:'POST',headers,body:'{}'})).status,401);
});

test('live provider mode refuses to boot without private key and explicit price caps', async () => {
  const child=spawn(process.execPath,['dist/server/index.js'],{
    cwd:process.cwd(),
    env:{...process.env,PORT:'3001',SQLITE_PATH:':memory:',NODE_ENV:'test',GRADING_PROVIDER:'groq',GROQ_API_KEY:'',GROQ_INPUT_USD_PER_MILLION:'',GROQ_OUTPUT_USD_PER_MILLION:'',DAILY_MAX_USD:''},
    stdio:['ignore','ignore','pipe']
  });
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const [code]=await once(child,'exit');
  assert.notEqual(code,0);
  assert.match(stderr,/requires GROQ_API_KEY/);
});