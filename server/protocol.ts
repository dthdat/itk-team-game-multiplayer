import { z } from 'zod';
import { catalog } from './catalog.js';

export const VERSION = 1;
export const profileSchema = z.object({
  name: z.string().trim().min(1).refine(value => [...value].length <= 20 && /^[\p{L}\p{M}\p{N} ._'’-]+$/u.test(value), 'Use up to 20 letters, numbers or name punctuation'),
  disc: z.enum(catalog.disciplines.map(item => item.id) as [string, ...string[]])
}).strict();
export const clientSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), v: z.literal(VERSION) }).strict(),
  z.object({ type: z.literal('reconnect'), v: z.literal(VERSION) }).strict(),
  z.object({ type: z.literal('move'), seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), x: z.number().finite(), z: z.number().finite(), yaw: z.number().finite().min(-1000000).max(1000000) }).strict(),
  z.object({ type: z.literal('ping'), at: z.number().finite() }).strict(),
  z.object({ type: z.literal('leave') }).strict()
]);
export type ClientMessage = z.infer<typeof clientSchema>;
export interface Done { [missionId: string]: { score: number; xp: number } }
export interface Progress { xp: number; passed: number; rank: string; done: Done }
export interface PublicPlayer { id: string; name: string; disc: string; x: number; z: number; yaw: number; xp: number; passed: number; rank: string; updatedAt: number }
export type ServerMessage =
  | { type: 'welcome'; v: number; seq: number; at: number; you: string; players: PublicPlayer[]; progress: Progress }
  | { type: 'snapshot'; seq: number; at: number; players: PublicPlayer[] }
  | { type: 'delta'; seq: number; at: number; moves: [string, number, number, number, number][] }
  | { type: 'join'; seq: number; at: number; player: PublicPlayer }
  | { type: 'leave'; seq: number; at: number; id: string }
  | { type: 'progress'; seq: number; at: number; player: PublicPlayer; progress?: Progress }
  | { type: 'correction'; seq: number; at: number; x: number; z: number; yaw: number }
  | { type: 'pong'; at: number; serverAt: number }
  | { type: 'error'; code: string; message: string };

export class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(private capacity: number, private perSecond: number) { this.tokens = capacity; }
  take(amount = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.perSecond / 1000);
    this.last = now;
    if (this.tokens + 1e-8 < amount) return false;
    this.tokens -= amount;
    return true;
  }
}

export function blocked(x: number, z: number) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < -23.4 || x > 23.4 || z < -17.4 || z > 17.4) return true;
  return catalog.colliders.some(rect => {
    const dx = x - Math.max(rect.x0, Math.min(x, rect.x1));
    const dz = z - Math.max(rect.z0, Math.min(z, rect.z1));
    return dx * dx + dz * dz < .4 * .4;
  });
}
export function clearPath(from: { x: number; z: number }, to: { x: number; z: number }) {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .1);
  if (steps > 30) return false;
  for (let index = 0; index <= steps; index++) {
    const fraction = steps ? index / steps : 1;
    if (blocked(from.x + (to.x - from.x) * fraction, from.z + (to.z - from.z) * fraction)) return false;
  }
  return true;
}