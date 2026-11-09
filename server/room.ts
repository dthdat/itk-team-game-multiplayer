import WebSocket from 'ws';
import { clientSchema, Bucket, clearPath, VERSION, type PublicPlayer, type ServerMessage } from './protocol.js';
import { type Guest, Store } from './store.js';

interface Peer { ws: WebSocket; guest: Guest; player: PublicPlayer; rate: Bucket; speed: Bucket; alive: boolean; joined: boolean; seq: number; strikes: number; expires: number; pingAt: number }
export class Room {
  private peers = new Map<string, Peer>();
  private dirty = new Set<string>();
  private sequence = 0;
  private tick: NodeJS.Timeout;
  private heartbeat: NodeJS.Timeout;
  private lastFull = Date.now();
  readonly counters = { incoming: 0, outgoing: 0, bytesIn: 0, bytesOut: 0, rejected: 0, rttMs: [] as number[] };
  constructor(private store: Store, readonly hz = 5, readonly capacity = 80) {
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
    const progress = this.store.progress(guest.id);
    const player = { id: guest.id, name: guest.name, disc: guest.disc, x: previous?.player.x ?? 0, z: previous?.player.z ?? 8.5, yaw: previous?.player.yaw ?? Math.PI, xp: progress.xp, passed: progress.passed, rank: progress.rank, updatedAt: Date.now() };
    const peer: Peer = { ws, guest, player, rate: new Bucket(40, 25), speed: new Bucket(1.5, 6.6), alive: true, joined: false, seq: -1, strikes: 0, expires: guest.expires, pingAt: Date.now() };
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
          this.send(peer, { type: 'welcome', v: VERSION, you: guest.id, players: this.players(), progress: this.store.progress(guest.id), ...this.meta() });
          this.broadcast({ type: 'join', player, ...this.meta() }, peer); return;
        }
        if (!peer.joined) throw new Error('Hello required');
        if (message.type === 'leave') { ws.close(1000, 'Clocked out'); return; }
        if (message.type === 'ping') { this.send(peer, { type: 'pong', at: message.at, serverAt: Date.now() }); return; }
        if (message.type === 'move') {
          if (message.seq <= peer.seq) return;
          peer.seq = message.seq;
          const distance = Math.hypot(message.x - player.x, message.z - player.z);
          if (!clearPath(player, message) || !peer.speed.take(distance)) {
            this.counters.rejected++;
            this.send(peer, { type: 'correction', x: player.x, z: player.z, yaw: player.yaw, ...this.meta() });
            if (++peer.strikes >= 20) ws.close(4008, 'Invalid movement');
            return;
          }
          peer.strikes = Math.max(0, peer.strikes - 1);
          Object.assign(player, { x: Math.round(message.x * 1000) / 1000, z: Math.round(message.z * 1000) / 1000, yaw: Math.atan2(Math.sin(message.yaw), Math.cos(message.yaw)), updatedAt: Date.now() });
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
      this.peers.delete(guest.id); this.dirty.delete(guest.id);
      if (peer.joined) this.broadcast({ type: 'leave', id: guest.id, ...this.meta() });
    });
  }
  private players() { return [...this.peers.values()].filter(peer => peer.joined).map(peer => peer.player); }
  private flush() {
    if (Date.now() - this.lastFull >= 10000) {
      this.broadcast({ type: 'snapshot', players: this.players(), ...this.meta() }); this.lastFull = Date.now(); this.dirty.clear(); return;
    }
    if (!this.dirty.size) return;
    const moves: [string, number, number, number, number][] = [];
    for (const id of this.dirty) {
      const peer = this.peers.get(id);
      if (peer?.joined) { const player = peer.player; moves.push([id, player.x, player.z, player.yaw, player.updatedAt]); }
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
  remove(id: string) { this.peers.get(id)?.ws.close(4004, 'Guest reset; clock in again'); }
  close() { clearInterval(this.tick); clearInterval(this.heartbeat); for (const peer of this.peers.values()) peer.ws.terminate(); }
}