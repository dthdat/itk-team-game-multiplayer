import WebSocket from 'ws';
import { clientSchema, Bucket, blocked, clearPath, VERSION, type PublicPlayer, type ServerMessage } from './protocol.js';
import { type Guest, Store } from './store.js';

interface Peer { ws: WebSocket; guest: Guest; player: PublicPlayer; rate: Bucket; speed: Bucket; alive: boolean; joined: boolean; seq: number; strikes: number; expires: number; pingAt: number; persistPosition:boolean }
export interface PlayerPosition { x:number; z:number; yaw:number }
export const DEFAULT_PLAYER_POSITION:Readonly<PlayerPosition>=Object.freeze({x:0,z:8.5,yaw:Math.PI});
export function safePlayerPosition(position?:Partial<PlayerPosition>|null):PlayerPosition {
  const x=position?.x,z=position?.z,yaw=position?.yaw;
  if(typeof x!=='number'||typeof z!=='number'||typeof yaw!=='number'||!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(yaw)||blocked(x,z))return {...DEFAULT_PLAYER_POSITION};
  return {x,z,yaw:Math.atan2(Math.sin(yaw),Math.cos(yaw))};
}

export class Room {
  private peers = new Map<string, Peer>();
  private dirty = new Set<string>();
  private sequence = 0;
  private tick: NodeJS.Timeout;
  private heartbeat: NodeJS.Timeout;
  private lastFull = Date.now();
  private lastPositionPersist=Date.now();
  readonly counters = { incoming: 0, outgoing: 0, bytesIn: 0, bytesOut: 0, rejected: 0, rttMs: [] as number[] };
  constructor(private store: Store, readonly hz = 10, readonly capacity = 80) {
    this.tick = setInterval(() => this.flush(), 1000 / hz);
    this.heartbeat = setInterval(() => {
      for (const peer of this.peers.values()) {
        if (!peer.alive || peer.expires <= Date.now() || (!peer.joined && Date.now() - peer.pingAt > 10000)) { peer.ws.terminate(); continue; }
        peer.alive = false; peer.pingAt = Date.now(); peer.ws.ping();
      }
      this.store.prune();
    }, 15000);
  }
  get size() { return [...this.peers.values()].filter(peer => peer.joined).length; }
  private meta() { return { seq: ++this.sequence, at: Date.now() }; }
  private send(peer: Peer, message: ServerMessage | string) {
    if (peer.ws.readyState !== WebSocket.OPEN) return;
    if (peer.ws.bufferedAmount > 65536) { peer.ws.close(4008, 'Slow connection'); return; }
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    peer.ws.send(payload); this.counters.outgoing++; this.counters.bytesOut += Buffer.byteLength(payload);
  }
  private broadcast(message: ServerMessage, except?: Peer) {
    const payload = JSON.stringify(message);
    for (const peer of this.peers.values()) if (peer.joined && peer !== except) this.send(peer, payload);
  }
  attach(ws: WebSocket, guest: Guest) {
    const previous = this.peers.get(guest.id);
    if (!previous && this.peers.size >= this.capacity) { ws.close(4003, 'Office is full'); return; }
    const progress = this.store.progress(guest.id),saved=this.store.position(guest.id);
    const position=safePlayerPosition(previous?.player??saved);
    const player = { id: guest.id, name: guest.name, disc: guest.disc, avatar:guest.avatar, x: position.x, z: position.z, y: Math.max(0,Math.min(1.5,previous?.player.y??0)), yaw: position.yaw, xp: progress.xp, passed: progress.passed, rank: progress.rank, updatedAt: Date.now() };
    const peer: Peer = { ws, guest, player, rate: new Bucket(40, 25), speed: new Bucket(3.3, 6.6), alive: true, joined: false, seq: -1, strikes: 0, expires: guest.expires, pingAt: Date.now(), persistPosition:true };
    this.peers.set(guest.id, peer);
    if (previous) { previous.ws.close(4001, 'Opened in another tab'); this.broadcast({ type: 'leave', id: guest.id, ...this.meta() }); }
    const helloTimeout = setTimeout(() => { if (!peer.joined) ws.close(4002, 'Hello required'); }, 8000);
    ws.on('pong', () => { peer.alive = true; this.counters.rttMs.push(Date.now() - peer.pingAt); if (this.counters.rttMs.length > 1000) this.counters.rttMs.shift(); });
    ws.on('message', (raw, binary) => {
      this.counters.incoming++;
      this.counters.bytesIn += Array.isArray(raw) ? raw.reduce((total, chunk) => total + chunk.byteLength, 0) : raw.byteLength;
      if (!peer.rate.take()) { ws.close(4008, 'Message rate exceeded'); return; }
      if (peer.expires <= Date.now()) { ws.close(4004, 'Session expired'); return; }
      try {
        if (binary) throw new Error('JSON required');
        const message = clientSchema.parse(JSON.parse(raw.toString()));
        if (message.type === 'hello' || message.type === 'reconnect') {
          if (peer.joined) throw new Error('Already joined');
          clearTimeout(helloTimeout); peer.joined = true;
          this.send(peer, { type: 'welcome', v: VERSION, you: guest.id, self:peer.player, players: this.players(peer), progress: this.store.progress(guest.id), ...this.meta() });
          this.broadcast({ type: 'join', player, ...this.meta() }, peer); return;
        }
        if (!peer.joined) throw new Error('Hello required');
        if (message.type === 'leave') { ws.close(1000, 'Clocked out'); return; }
        if (message.type === 'ping') { this.send(peer, { type: 'pong', at: message.at, serverAt: Date.now() }); return; }
        if (message.type === 'move') {
          if (message.seq <= peer.seq) return;
          peer.seq = message.seq;
          if(blocked(player.x,player.z)){
            const position=safePlayerPosition();
            Object.assign(player,position,{y:0,updatedAt:Date.now()});
            this.dirty.add(guest.id);
            this.send(peer,{type:'correction',x:player.x,z:player.z,yaw:player.yaw,...this.meta()});
            return;
          }
          const distance = Math.hypot(message.x - player.x, message.z - player.z);
          const validPath=clearPath(player,message);
          if (!validPath || !peer.speed.take(distance)) {
            this.counters.rejected++;
            this.send(peer, { type: 'correction', x: player.x, z: player.z, yaw: player.yaw, ...this.meta() });
            // Jitter can bunch valid updates together. Correct excess speed,
            // but reserve geometry strikes for invalid paths/positions.
            if (!validPath && ++peer.strikes >= 20) ws.close(4008, 'Invalid movement');
            return;
          }
          peer.strikes = Math.max(0, peer.strikes - 1);
          Object.assign(player, { x: Math.round(message.x * 1000) / 1000, z: Math.round(message.z * 1000) / 1000, y: Math.max(0,Math.min(1.5,message.y??player.y??0)), yaw: Math.atan2(Math.sin(message.yaw), Math.cos(message.yaw)), updatedAt: Date.now() });
          this.dirty.add(guest.id);
        }
      } catch {
        this.counters.rejected++;
        this.send(peer, { type: 'error', code: 'INVALID_MESSAGE', message: 'Invalid game message' });
        if (++peer.strikes >= 5) ws.close(4002, 'Invalid messages');
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(helloTimeout);
      if (this.peers.get(guest.id) !== peer) return;
      if(peer.joined&&peer.persistPosition)this.store.savePosition(guest.id,peer.player.x,peer.player.z,peer.player.yaw,Date.now());
      this.peers.delete(guest.id); this.dirty.delete(guest.id);
      if (peer.joined) this.broadcast({ type: 'leave', id: guest.id, ...this.meta() });
    });
  }
  private players(except?:Peer) { return [...this.peers.values()].filter(peer => peer.joined&&peer!==except).map(peer => peer.player); }
  private flush() {
    const now=Date.now();
    if(now-this.lastPositionPersist>=10000){for(const peer of this.peers.values())if(peer.joined)this.store.savePosition(peer.guest.id,peer.player.x,peer.player.z,peer.player.yaw,now);this.lastPositionPersist=now;}
    if (now - this.lastFull >= 10000) {
      this.broadcast({ type: 'snapshot', players: this.players(), ...this.meta() }); this.lastFull = now; this.dirty.clear(); return;
    }
    if (!this.dirty.size) return;
    const moves: [string, number, number, number, number, number][] = [];
    for (const id of this.dirty) {
      const peer = this.peers.get(id);
      if (peer?.joined) { const player = peer.player; moves.push([id, player.x, player.z, player.yaw, player.updatedAt, player.y||0]); }
    }
    this.dirty.clear();
    if (moves.length) this.broadcast({ type: 'delta', moves, ...this.meta() });
  }
  progress(id: string) {
    const peer = this.peers.get(id);
    if (!peer?.joined) return;
    const progress = this.store.progress(id);
    Object.assign(peer.player, { xp: progress.xp, rank: progress.rank, passed: progress.passed });
    this.send(peer, { type: 'progress', player: peer.player, progress, ...this.meta() });
    this.broadcast({ type: 'progress', player: peer.player, ...this.meta() }, peer);
  }
  updateProfile(guest:Guest){const peer=this.peers.get(guest.id);if(!peer)return;peer.guest=guest;Object.assign(peer.player,{name:guest.name,disc:guest.disc,avatar:guest.avatar});this.broadcast({type:'join',player:peer.player,...this.meta()},peer);}
  remove(id: string, persistPosition=true) {
    const peer=this.peers.get(id);if(!peer)return;peer.persistPosition=persistPosition;
    if(!persistPosition){this.peers.delete(id);this.dirty.delete(id);if(peer.joined)this.broadcast({type:'leave',id,...this.meta()});}
    peer.ws.close(4004, 'Session ended; sign in again');
  }
  close() { clearInterval(this.tick); clearInterval(this.heartbeat); const now=Date.now();for (const peer of this.peers.values()){if(peer.joined)this.store.savePosition(peer.guest.id,peer.player.x,peer.player.z,peer.player.yaw,now);peer.ws.terminate();} }
}
