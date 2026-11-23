import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import WebSocket,{WebSocketServer} from 'ws';
import { Store } from '../dist/server/store.js';
import { Accounts } from '../dist/server/accounts.js';
import { Room } from '../dist/server/room.js';
const store=new Store(':memory:');new Accounts(store.db);const room=new Room(store),server=createServer(),wss=new WebSocketServer({server});wss.on('connection',ws=>room.attach(ws,store.createGuest().guest));server.listen(0,'127.0.0.1');await once(server,'listening');
const ws=new WebSocket('ws://127.0.0.1:'+server.address().port);let corrections=0;
ws.on('message',raw=>{if(JSON.parse(raw).type==='correction')corrections++;});
try{await once(ws,'open');ws.send(JSON.stringify({type:'hello',v:1}));await once(ws,'message');await new Promise(r=>setTimeout(r,410));
  ws.send(JSON.stringify({type:'move',seq:1,x:0,z:7.18,yaw:Math.PI}));ws.send(JSON.stringify({type:'move',seq:2,x:0,z:5.86,yaw:Math.PI}));await new Promise(r=>setTimeout(r,30));const batched=corrections;
  ws.send(JSON.stringify({type:'move',seq:3,x:0,z:3.22,yaw:Math.PI}));await new Promise(r=>setTimeout(r,30));
  console.log(JSON.stringify({legitimate400msBatchCorrections:batched,excessiveBurstCorrections:corrections-batched}));
  if(process.env.EXPECT_FIXED==='1'){assert.equal(batched,0);assert.equal(corrections-batched,1);}
}finally{ws.terminate();room.close();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));store.close();}
