import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { Room } from '../dist/server/room.js';

function waitForMessage(socket,predicate,timeout=3000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off('message',onMessage);reject(new Error('Timed out waiting for WebSocket message'));},timeout);
    function onMessage(raw){let message;try{message=JSON.parse(raw.toString());}catch{return;}if(!predicate(message))return;clearTimeout(timer);socket.off('message',onMessage);resolve(message);}
    socket.on('message',onMessage);
  });
}

test('blocked saved movement position respawns safely and accepts movement',async t=>{
  const guests=new Map([
    ['stale',{id:'stale',token:'',csrf:'',name:'Stale Position',disc:'chassis',expires:Date.now()+60000}],
    ['observer',{id:'observer',token:'',csrf:'',name:'Observer',disc:'chassis',expires:Date.now()+60000}]
  ]);
  const store={
    progress:()=>({xp:0,passed:0,rank:'Intern',done:{}}),
    position:id=>id==='stale'?{x:-0.442,z:2.3,yaw:-1.389,updatedAt:Date.now()}:undefined,
    savePosition(){},prune(){}
  };
  const room=new Room(store,10,80),server=createServer(),sockets=[];
  const wss=new WebSocketServer({noServer:true,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req)));
  wss.on('connection',(socket,req)=>room.attach(socket,guests.get(new URL(req.url,'http://localhost').searchParams.get('player'))));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;
  t.after(async()=>{
    for(const socket of sockets)socket.terminate();
    room.close();
    await new Promise(resolve=>wss.close(resolve));
    await new Promise(resolve=>server.close(resolve));
  });
  async function join(id){
    const socket=new WebSocket(`ws://127.0.0.1:${port}/?player=${id}`);sockets.push(socket);await once(socket,'open');
    const welcome=waitForMessage(socket,message=>message.type==='welcome');socket.send(JSON.stringify({type:'hello',v:1}));return {socket,welcome:await welcome};
  }
  const stale=await join('stale');
  assert.deepEqual([stale.welcome.self.x,stale.welcome.self.z],[0,8.5],'the screenshot position is replaced by the safe spawn');
  const observer=await join('observer');
  assert.deepEqual([observer.welcome.players[0].x,observer.welcome.players[0].z],[0,8.5],'late joiners see the recovered player at spawn');
  const delta=waitForMessage(observer.socket,message=>message.type==='delta'&&message.moves.some(move=>move[0]==='stale'));
  stale.socket.send(JSON.stringify({type:'move',seq:1,x:0.3,z:8.5,yaw:0,y:0}));
  const movement=await delta;
  assert.equal(movement.moves.find(move=>move[0]==='stale')[1],0.3,'movement is accepted after recovery');
  const correction=waitForMessage(stale.socket,message=>message.type==='correction');
  stale.socket.send(JSON.stringify({type:'move',seq:2,x:30,z:8.5,yaw:0,y:0}));
  assert.deepEqual(await correction.then(message=>[message.x,message.z]),[0.3,8.5],'invalid new movement still receives an authoritative correction');
});

test('browser accepts an authoritative correction without scheduling an unchanged retry',async()=>{
  const { readFile }=await import('node:fs/promises');
  const html=await readFile(new URL('../cloudflare-game/public/index.html',import.meta.url),'utf8');
  const handler=html.match(/else if\(message\.type==='correction'\)\{([^}]*)\}/)?.[1]||'';
  assert.match(handler,/lastX=P\.x;lastZ=P\.z;lastYaw=P\.yaw;lastY=P\.jumpY/);
  assert.doesNotMatch(handler,/lastX=-99|lastZ=-99|lastYaw=-99/);
});
