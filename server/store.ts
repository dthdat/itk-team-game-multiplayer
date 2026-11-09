import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { catalog, type Mission } from './catalog.js';
import type { Done, Progress } from './protocol.js';

export interface Guest { id: string; token: string; csrf: string; name: string; disc: string; expires: number }
export interface Feedback { criterionId: string; passed: boolean; feedback: string }
export interface Review { score: number; items: Feedback[]; summary: string; words: number; short: boolean; verified: boolean; provider: string; model: string; tokens: number }
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS guests(id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, csrf TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', disc TEXT NOT NULL DEFAULT '', expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS results(guest TEXT REFERENCES guests(id) ON DELETE CASCADE, mission TEXT NOT NULL, score INTEGER NOT NULL, xp INTEGER NOT NULL, PRIMARY KEY(guest,mission));
      CREATE TABLE IF NOT EXISTS attempts(guest TEXT REFERENCES guests(id) ON DELETE CASCADE, submission TEXT NOT NULL, mission TEXT NOT NULL, answer_hash TEXT NOT NULL, review TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(guest,submission));
      CREATE INDEX IF NOT EXISTS attempt_cache ON attempts(guest,mission,answer_hash);
      CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY, tokens INTEGER NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS quotas(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  }
  createGuest() {
    const token = randomBytes(32).toString('base64url');
    const guest: Guest = { id: randomUUID(), token: hash(token), csrf: randomBytes(24).toString('base64url'), name: '', disc: '', expires: Date.now() + 30 * 86400000 };
    this.db.prepare('INSERT INTO guests VALUES(?,?,?,?,?,?)').run(guest.id, guest.token, guest.csrf, guest.name, guest.disc, guest.expires);
    return { guest, token };
  }
  guest(token?: string) {
    return token ? this.db.prepare('SELECT * FROM guests WHERE token=? AND expires>?').get(hash(token), Date.now()) as unknown as Guest | undefined : undefined;
  }
  profile(guest: Guest, name: string, disc: string) {
    if (guest.disc && guest.disc !== disc) throw new Error('Discipline is fixed for this guest; reset progress to change it');
    this.db.prepare('UPDATE guests SET name=?,disc=? WHERE id=?').run(name, disc, guest.id);
    return { ...guest, name, disc };
  }
  progress(id: string): Progress {
    const rows = this.db.prepare('SELECT mission,score,xp FROM results WHERE guest=?').all(id) as unknown as { mission: string; score: number; xp: number }[];
    const done: Done = Object.fromEntries(rows.map(row => [row.mission, { score: row.score, xp: row.xp }]));
    const xp = rows.reduce((total, row) => total + row.xp, 0);
    const rank = catalog.ranks.filter(item => item.min <= xp).at(-1)!.name;
    return { done, xp, passed: rows.filter(row => row.score >= catalog.pass).length, rank };
  }
  cached(id: string, submission: string, mission: string, answerHash: string) {
    const byId = this.db.prepare('SELECT mission,answer_hash,review FROM attempts WHERE guest=? AND submission=?').get(id, submission) as { mission: string; answer_hash: string; review: string } | undefined;
    if (byId && (byId.mission !== mission || byId.answer_hash !== answerHash)) throw Object.assign(new Error('Submission ID already used with different content'), { status: 409 });
    if (byId) return JSON.parse(byId.review) as Review;
    const row = this.db.prepare('SELECT review FROM attempts WHERE guest=? AND mission=? AND answer_hash=? ORDER BY created DESC').all(id, mission, answerHash) as { review: string }[];
    const reusable = row.find(attempt => {
      const review = JSON.parse(attempt.review) as Review;
      return review.verified || review.short;
    });
    return reusable ? JSON.parse(reusable.review) as Review : undefined;
  }
  commit(guest: Guest, mission: Mission, submission: string, answerHash: string, review: Review) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cached = this.cached(guest.id, submission, mission.id, answerHash);
      if (!cached) {
        this.db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?)').run(guest.id, submission, mission.id, answerHash, JSON.stringify(review), Date.now());
        if (review.verified) {
          const xp = review.score >= catalog.pass ? Math.round(mission.xp * review.score / 100 * (mission.dept === guest.disc ? 1.2 : 1)) : 0;
          this.db.prepare('INSERT INTO results VALUES(?,?,?,?) ON CONFLICT(guest,mission) DO UPDATE SET score=MAX(score,excluded.score),xp=MAX(xp,excluded.xp)').run(guest.id, mission.id, review.score, xp);
        }
      } else {
        this.db.prepare('INSERT OR IGNORE INTO attempts VALUES(?,?,?,?,?,?)').run(guest.id, submission, mission.id, answerHash, JSON.stringify(cached), Date.now());
      }
      this.db.exec('COMMIT');
      return this.progress(guest.id);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  quota(key: string, max: number, durationMs: number) {
    const now = Date.now();
    this.db.prepare('DELETE FROM quotas WHERE key=? AND expires<=?').run(key, now);
    this.db.prepare('INSERT INTO quotas VALUES(?,0,?) ON CONFLICT(key) DO NOTHING').run(key, now + durationMs);
    const result = this.db.prepare('UPDATE quotas SET count=count+1 WHERE key=? AND count<?').run(key, max);
    return result.changes > 0;
  }
  reserve(tokens: number, usd: number, dailyTokens: number, dailyUsd: number) {
    const day = new Date().toISOString().slice(0, 10);
    this.db.prepare('INSERT OR IGNORE INTO usage(day) VALUES(?)').run(day);
    const result = this.db.prepare('UPDATE usage SET tokens=tokens+?,usd=usd+? WHERE day=? AND tokens+?<=? AND usd+?<=?').run(tokens, usd, day, tokens, dailyTokens, usd, dailyUsd);
    return result.changes > 0;
  }
  usage() { return this.db.prepare('SELECT * FROM usage ORDER BY day DESC LIMIT 1').get() || { tokens: 0, usd: 0 }; }
  reset(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM attempts WHERE guest=?').run(id);
      this.db.prepare('DELETE FROM results WHERE guest=?').run(id);
      this.db.prepare("UPDATE guests SET disc='' WHERE id=?").run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  deleteGuest(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM guests WHERE id=?').run(id);
      const removeQuota=this.db.prepare('DELETE FROM quotas WHERE key=?');
      for (const prefix of ['profile','reset','review']) removeQuota.run(`${prefix}:${id}`);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  prune() {
    this.db.prepare('DELETE FROM guests WHERE expires<=?').run(Date.now());
    this.db.prepare('DELETE FROM quotas WHERE expires<=?').run(Date.now());
    this.db.prepare('DELETE FROM attempts WHERE created<?').run(Date.now() - 30 * 86400000);
  }
  close() { this.db.close(); }
}