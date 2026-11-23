import { once } from 'node:events';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

const clientsWanted = Number(process.env.LOAD_CLIENTS || 20);
const durationMs = Number(process.env.LOAD_DURATION_MS || 10000);
const reconnectIntervalMs = Number(process.env.LOAD_RECONNECT_INTERVAL_MS || 300000);
const reportPath = process.env.LOAD_REPORT_PATH || 'reports/phase2-load.json';
if (!Number.isInteger(clientsWanted) || clientsWanted < 1 || clientsWanted > 200) throw new Error('LOAD_CLIENTS must be an integer from 1 to 200');
if (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 1800000) throw new Error('LOAD_DURATION_MS must be from 1000 to 1800000');
if (!Number.isInteger(reconnectIntervalMs) || reconnectIntervalMs < 10000 || reconnectIntervalMs > 1800000) throw new Error('LOAD_RECONNECT_INTERVAL_MS must be from 10000 to 1800000');

async function freePort() {
  const probe=createTcpServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;
}
const port=await freePort(),origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['--env-file-if-exists=.env','dist/server/index.js'],{
  cwd:process.cwd(),
  env:{...process.env,PORT:String(port),HOST:'127.0.0.1',SQLITE_PATH:':memory:',GRADING_PROVIDER:'mock',LOAD_TEST_METRICS:'1',SESSION_STARTS_PER_IP_HOUR:String(clientsWanted+10),ROOM_CAPACITY:String(Math.max(80,clientsWanted))},
  stdio:['ignore','ignore','pipe']
});
let serverLog='';child.stderr.on('data',chunk=>serverLog+=chunk);
const clients=[],latencies=[],closeCodes=[],intentionalCloses=new WeakSet();
let step=0,moveTimer,reconnectTimer,sampleTimer,reconnectInFlight,disconnects=0,unexpectedDisconnects=0,reconnects=0,plannedDisconnects=0;
let receivedMessages=0,receivedBytes=0;
async function api(path,options={}){return fetch(`${origin}${path}`,options);}
function cpuTimes(){
  return cpus().reduce((sum,cpu)=>({busy:sum.busy+cpu.times.user+cpu.times.nice+cpu.times.sys+cpu.times.irq,total:sum.total+cpu.times.user+cpu.times.nice+cpu.times.sys+cpu.times.irq+cpu.times.idle}),{busy:0,total:0});
}
async function metrics(){
  const response=await api('/_load/metrics');
  if(!response.ok)throw new Error(`Load metrics endpoint returned HTTP ${response.status}`);
  return response.json();
}
async function openSocket(client,reconnecting=false){
  const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{headers:{cookie:client.cookie,origin}});
  client.socket=socket;
  let resolveWelcome;
  const welcomePromise=new Promise(resolve=>resolveWelcome=resolve);
  socket.on('message',raw=>{
    receivedMessages++;receivedBytes+=Buffer.byteLength(raw);
    try{
      const message=JSON.parse(raw.toString());
      if(message.type==='pong'&&Number.isFinite(message.at))latencies.push(performance.now()-message.at);
      if(message.type==='welcome')resolveWelcome(message);
    }catch{}
  });
  socket.on('close',code=>{
    disconnects++;closeCodes.push(code);
    if(!intentionalCloses.has(socket))unexpectedDisconnects++;
  });
  await once(socket,'open');
  socket.send(JSON.stringify(reconnecting?{type:'reconnect',v:1}:{type:'hello',v:1}));
  const welcome=await welcomePromise;
  if(welcome.type!=='welcome')throw new Error(`Client ${client.index} did not receive welcome`);
  if(reconnecting){client.sequence=0;reconnects++;}
  return socket;
}
async function connect(index){
  const response=await api('/api/session');
  if(!response.ok)throw new Error(`Session ${index}: HTTP ${response.status}`);
  const session=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  const headers={cookie,origin,'content-type':'application/json','x-csrf-token':session.csrfToken};
  const profile=await api('/api/profile',{method:'POST',headers,body:JSON.stringify({name:`Load ${index+1}`,disc:'powertrain'})});
  if(!profile.ok)throw new Error(`Profile ${index}: HTTP ${profile.status}`);
  const client={index,cookie,sequence:0,socket:null};
  await openSocket(client);
  return client;
}
async function disconnect(client){
  const socket=client.socket;
  if(!socket||socket.readyState===WebSocket.CLOSED)return;
  intentionalCloses.add(socket);
  await new Promise(resolve=>{
    const timer=setTimeout(()=>socket.terminate(),3000);
    socket.once('close',()=>{clearTimeout(timer);resolve();});
    socket.close(4001,'Planned load-test reconnect');
  });
}
async function reconnect(client){
  plannedDisconnects++;
  await disconnect(client);
  await openSocket(client,true);
}
async function waitForHealth(){
  for(let attempt=0;attempt<80;attempt++){
    try{const response=await api('/healthz');if(response.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Server did not start: ${serverLog}`);
}
function percentile(values,percent){
  if(!values.length)return null;
  const ordered=[...values].sort((a,b)=>a-b);
  return ordered[Math.max(0,Math.ceil(percent*ordered.length)-1)];
}
try{
  await waitForHealth();
  for(let index=0;index<clientsWanted;index++)clients.push(await connect(index));
  const firstMetrics=await metrics(),firstHostCpu=cpuTimes();
  const started=Date.now();
  let previousAt=started,previousCpu=firstMetrics.cpu,previousHostCpu=firstHostCpu;
  const serverCpuSamples=[],hostCpuSamples=[];
  let peakServerRssBytes=firstMetrics.rssBytes,peakHostUsedMemoryBytes=totalmem()-freemem();
  const samples=[];
  sampleTimer=setInterval(async()=>{
    try{
      const now=Date.now(),current=await metrics(),currentHostCpu=cpuTimes(),elapsedMs=now-previousAt;
      const serverCpuUs=(current.cpu.user-previousCpu.user)+(current.cpu.system-previousCpu.system);
      const serverPercent=serverCpuUs/(elapsedMs*1000)*100;
      const hostTotalDelta=currentHostCpu.total-previousHostCpu.total;
      const hostPercent=hostTotalDelta>0?(currentHostCpu.busy-previousHostCpu.busy)/hostTotalDelta*100:0;
      serverCpuSamples.push(serverPercent);hostCpuSamples.push(hostPercent);
      peakServerRssBytes=Math.max(peakServerRssBytes,current.rssBytes);
      peakHostUsedMemoryBytes=Math.max(peakHostUsedMemoryBytes,totalmem()-freemem());
      samples.push({at:new Date(now).toISOString(),online:current.online,serverRssBytes:current.rssBytes,serverCpuPercentOfOneCore:serverPercent,hostCpuPercentAcrossLogicalCores:hostPercent});
      previousAt=now;previousCpu=current.cpu;previousHostCpu=currentHostCpu;
    }catch(error){serverLog+=`\nmetrics sampling error: ${error instanceof Error?error.message:String(error)}`;}
  },1000);
  moveTimer=setInterval(()=>{
    step++;
    for(const [index,client] of clients.entries()){
      if(client.socket.readyState!==WebSocket.OPEN)continue;
      const x=0.15*Math.sin(step*0.12+index*0.01);
      client.socket.send(JSON.stringify({type:'move',seq:client.sequence++,x,z:8.5,yaw:Math.PI}));
      if(step%13===0)client.socket.send(JSON.stringify({type:'ping',at:performance.now()}));
    }
  },200);
  reconnectTimer=setInterval(()=>{
    if(reconnectInFlight)return;
    reconnectInFlight=reconnect(clients[0]).catch(error=>{serverLog+=`\nreconnect error: ${error instanceof Error?error.message:String(error)}`;}).finally(()=>{reconnectInFlight=undefined;});
  },reconnectIntervalMs);
  await new Promise(resolve=>setTimeout(resolve,durationMs));
  clearInterval(moveTimer);moveTimer=undefined;
  clearInterval(reconnectTimer);reconnectTimer=undefined;
  if(reconnectInFlight)await reconnectInFlight;
  clearInterval(sampleTimer);sampleTimer=undefined;
  const finalMetrics=await metrics(),health=await (await api('/healthz')).json();
  const elapsedSeconds=(Date.now()-started)/1000;
  const incomingBytes=finalMetrics.counters.bytesIn-firstMetrics.counters.bytesIn;
  const outgoingBytes=finalMetrics.counters.bytesOut-firstMetrics.counters.bytesOut;
  const incomingMessages=finalMetrics.counters.incoming-firstMetrics.counters.incoming;
  const outgoingMessages=finalMetrics.counters.outgoing-firstMetrics.counters.outgoing;
  const report={
    at:new Date().toISOString(),environment:'single-machine local mock; loopback WebSockets',clients:clientsWanted,
    durationSeconds:elapsedSeconds,clientMovementHz:5,serverSnapshotHz:5,connectedAtEnd:health.online,
    resources:{
      serverCpuAveragePercentOfOneCore:serverCpuSamples.length?serverCpuSamples.reduce((sum,value)=>sum+value,0)/serverCpuSamples.length:null,
      serverCpuPeakPercentOfOneCore:serverCpuSamples.length?Math.max(...serverCpuSamples):null,
      hostCpuAveragePercentAcrossLogicalCores:hostCpuSamples.length?hostCpuSamples.reduce((sum,value)=>sum+value,0)/hostCpuSamples.length:null,
      hostCpuPeakPercentAcrossLogicalCores:hostCpuSamples.length?Math.max(...hostCpuSamples):null,
      serverPeakRssBytes:peakServerRssBytes,serverEndRssBytes:finalMetrics.rssBytes,
      hostPeakUsedMemoryBytes:peakHostUsedMemoryBytes,samplingIntervalMs:1000,samples
    },
    applicationPayloadBandwidth:{
      inboundBytes:incomingBytes,outboundBytes:outgoingBytes,
      inboundBytesPerSecond:incomingBytes/elapsedSeconds,outboundBytesPerSecond:outgoingBytes/elapsedSeconds,
      inboundMbps:incomingBytes*8/elapsedSeconds/1_000_000,outboundMbps:outgoingBytes*8/elapsedSeconds/1_000_000,
      scope:'WebSocket application payload counters; excludes TCP/IP framing, HTTP upgrade, and TLS overhead.'
    },
    latencyMs:{p50:percentile(latencies,.50),p95:percentile(latencies,.95),p99:percentile(latencies,.99),samples:latencies.length,measurement:'client ping-to-pong round-trip over loopback WebSocket'},
    messages:{inbound:incomingMessages,outbound:outgoingMessages,inboundPerSecond:incomingMessages/elapsedSeconds,outboundPerSecond:outgoingMessages/elapsedSeconds,totalPerSecond:(incomingMessages+outgoingMessages)/elapsedSeconds},
    connections:{disconnects,unexpectedDisconnects,plannedDisconnects,successfulReconnects:reconnects,closeCodes},
    receivedMessages,receivedBytes,serverOnlineAtEnd:health.online,failedClients:clients.filter(client=>client.socket.readyState!==WebSocket.OPEN).length,
    disclaimer:'Single-machine mock-mode loopback measurement. Host CPU/RAM includes the load generator; bandwidth is WebSocket payload, not wire traffic. This is not Oracle A1 or production capacity evidence.'
  };
  await mkdir('reports',{recursive:true});
  await writeFile(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.connectedAtEnd!==clientsWanted||report.failedClients||unexpectedDisconnects||reconnects!==plannedDisconnects)process.exitCode=1;
}finally{
  clearInterval(moveTimer);clearInterval(reconnectTimer);clearInterval(sampleTimer);
  for(const client of clients){
    try{await disconnect(client);}catch{}
  }
  if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);}
}