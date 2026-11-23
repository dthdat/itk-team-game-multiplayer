import WebSocket from 'ws';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
const origin='https://game-staging.itkvn.workers.dev';
const duration=Number(process.env.NET_CHECK_MS||70000),clients=[],rtts=[],closes=[];
let controlPings=0,corrections=0;
async function create(index){
  const response=await fetch(origin+'/api/session');
  if(!response.ok)throw new Error('Session HTTP '+response.status);
  const session=await response.json(),cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const client={cookie,csrf:session.csrfToken,ws:null,index,seq:0,position:null};clients.push(client);
  const profile=await fetch(origin+'/api/profile',{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':client.csrf},body:JSON.stringify({name:'Network Probe '+index,disc:'powertrain'})});
  if(!profile.ok)throw new Error('Profile HTTP '+profile.status);
  await new Promise((resolve,reject)=>{
    const ws=client.ws=new WebSocket(origin.replace('https:','wss:')+'/ws',{headers:{cookie,origin},handshakeTimeout:10000});
    const timer=setTimeout(()=>reject(new Error('Welcome timeout')),12000);
    ws.on('open',()=>ws.send(JSON.stringify({type:'hello',v:1})));
    ws.on('error',()=>reject(new Error('WebSocket transport error')));
    ws.on('ping',()=>controlPings++);
    ws.on('close',(code,reason)=>closes.push({index,code,reason:reason.toString().slice(0,100),at:new Date().toISOString()}));
    ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='ping')ws.send(JSON.stringify({type:'pong',at:m.at}));if(m.type==='welcome'){client.position=m.self;clearTimeout(timer);resolve();}if(m.type==='pong')rtts.push(performance.now()-m.at);if(m.type==='correction')corrections++;});
  });
}
let timer;
try{
  await create(1);await create(2);
  const start=performance.now();let tick=0;
  timer=setInterval(()=>{tick++;for(const client of clients){if(client.ws.readyState!==WebSocket.OPEN)continue;client.ws.send(JSON.stringify({type:'ping',at:performance.now()}));if(client.index===2){const p=client.position;client.ws.send(JSON.stringify({type:'move',seq:client.seq++,x:p.x+Math.sin(tick/5)*.3,z:p.z,yaw:p.yaw}));}}},1000);
  await new Promise(resolve=>setTimeout(resolve,duration));clearInterval(timer);
  const sorted=rtts.toSorted((a,b)=>a-b),q=p=>Math.round((sorted[Math.floor((sorted.length-1)*p)]||0)*100)/100;
  const report={at:new Date().toISOString(),target:origin,clients:clients.length,durationMs:Math.round(performance.now()-start),samples:rtts.length,rttMs:{p50:q(.5),p95:q(.95),p99:q(.99)},nativeControlPings:controlPings,corrections,unexpectedCloses:[...closes],openAtEnd:clients.filter(c=>c.ws.readyState===WebSocket.OPEN).length,source:'Oracle VM through public Worker, Access and Tunnel; not the player device'};
  await writeFile('reports/staging-network-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  if(report.openAtEnd!==2||closes.length)process.exitCode=1;
}finally{
  clearInterval(timer);
  for(const client of clients){client.ws?.close(1000,'Synthetic check complete');await fetch(origin+'/api/session',{method:'DELETE',headers:{cookie:client.cookie,origin,'x-csrf-token':client.csrf}}).catch(()=>{});}
}
