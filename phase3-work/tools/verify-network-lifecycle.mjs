import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import { Store } from '../dist/server/store.js';
import { Accounts } from '../dist/server/accounts.js';
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['dist/server/index.js'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',SQLITE_PATH:':memory:',GRADING_PROVIDER:'mock',NODE_ENV:'test',TRUSTED_PROXY_SECRET:'',PUBLIC_GAME_ORIGIN:''},stdio:['ignore','ignore','pipe']});
let errors='';server.stderr.on('data',data=>errors+=data);const sockets=[];
async function guest(name){const r=await fetch(origin+'/api/session');assert(r.ok);const s=await r.json(),cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');const headers={cookie,origin,'content-type':'application/json','x-csrf-token':s.csrfToken};const p=await fetch(origin+'/api/profile',{method:'POST',headers,body:JSON.stringify({name,disc:'powertrain'})});assert(p.ok);return {headers};}
async function connect(g){const ws=new WebSocket(origin.replace('http:','ws:')+'/ws',{headers:g.headers});sockets.push(ws);const welcome=new Promise((resolve,reject)=>{ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome')resolve(m);});ws.on('error',reject);});await once(ws,'open');ws.send(JSON.stringify({type:'hello',v:1}));await welcome;return ws;}
try{
  let healthy=false;for(let i=0;i<50;i++){try{healthy=(await fetch(origin+'/readyz')).ok;if(healthy)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert(healthy,errors);
  const victim=await guest('Deleted Probe'),observer=await guest('Witness Probe');
  const old=await connect(victim),witness=await connect(observer),closed=once(old,'close');const replacement=await connect(victim);
  assert.equal((await closed)[0],4001,'replacement signals duplicate-tab closure');
  const removed=once(replacement,'close');const deletion=await fetch(origin+'/api/session',{method:'DELETE',headers:victim.headers});assert.equal(deletion.status,204);assert.equal((await removed)[0],4004);
  await new Promise(r=>setTimeout(r,500));assert.equal(server.exitCode,null,errors);assert.equal(witness.readyState,WebSocket.OPEN,'unrelated player survives guest deletion');assert.equal((await (await fetch(origin+'/readyz')).json()).online,1);
  const store=new Store(':memory:');new Accounts(store.db);const deleted=store.createGuest().guest;store.deleteGuest(deleted.id);assert.doesNotThrow(()=>store.savePosition(deleted.id,0,8.5,0));assert.equal(store.position(deleted.id),undefined);store.close();
  console.log('PASS: duplicate-session close code, deleting connected guest, unrelated socket survival, backend remains ready, and late position write cannot resurrect deleted player.');
}finally{for(const ws of sockets)ws.terminate();server.kill('SIGTERM');await Promise.race([once(server,'exit'),new Promise(r=>setTimeout(r,3000))]);}
