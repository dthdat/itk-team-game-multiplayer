import * as crypto from 'node:crypto';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { RUBRIC_VERSION } from './grading-provider.js';
import { catalog } from './catalog.js';

type ArgonParams={message:Buffer;nonce:Buffer;parallelism:number;memory:number;passes:number;tagLength:number};
const argon2=(crypto as unknown as {argon2:(algorithm:string,params:ArgonParams,callback:(error:Error|null,key:Buffer)=>void)=>void}).argon2;
const derive=(message:Buffer,nonce:Buffer)=>new Promise<Buffer>((resolve,reject)=>argon2('argon2id',{message,nonce,parallelism:1,memory:19456,passes:2,tagLength:32},(error,key)=>error?reject(error):resolve(key)));
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const loginSchema = z.string().trim().min(3).max(64).regex(/^[\p{L}\p{N}._@+-]+$/u);
const passwordSchema = z.string().min(12).max(128);
const displaySchema = z.string().trim().min(1).max(20).regex(/^[\p{L}\p{M}\p{N} ._'’-]+$/u);
const disciplines = new Set(catalog.disciplines.map(d => d.id));

export interface Migration { version: number; up(db: DatabaseSync): void }
export const accountMigrations: Migration[] = [
  { version: 1, up: db => db.exec(`CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
      login_id TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '', discipline TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER);
    CREATE TABLE IF NOT EXISTS account_sessions(
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
    CREATE INDEX IF NOT EXISTS sessions_owner_expiry ON account_sessions(user_id, expires_at);
    CREATE TABLE IF NOT EXISTS invitations(
      token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      revoked_at INTEGER, used_at INTEGER, used_by TEXT REFERENCES users(id) ON DELETE SET NULL);`) },
  { version: 2, up: db => db.exec(`CREATE TABLE IF NOT EXISTS mission_submissions(
      id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      mission_id TEXT NOT NULL, answer TEXT NOT NULL, answer_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','reviewing','graded','failed','retryable')),
      score INTEGER, xp INTEGER NOT NULL DEFAULT 0, result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(owner,id));
    CREATE INDEX IF NOT EXISTS submissions_owner_date ON mission_submissions(owner,created_at DESC);
    CREATE INDEX IF NOT EXISTS submissions_owner_mission ON mission_submissions(owner,mission_id,state);`) },
  { version: 3, up: db => db.exec(`CREATE TABLE IF NOT EXISTS player_positions(
      user_id TEXT PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
      x REAL NOT NULL,z REAL NOT NULL,yaw REAL NOT NULL,updated_at INTEGER NOT NULL);`) },
  { version: 4, up: db => {
    const columns=db.prepare('PRAGMA table_info(users)').all() as {name:string}[];
    if(!columns.some(column=>column.name==='must_change_password'))db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1))');
  } },
  { version: 5, up: db => db.exec(`ALTER TABLE mission_submissions ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
    ALTER TABLE mission_submissions ADD COLUMN grading_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mission_submissions ADD COLUMN grading_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mission_submissions ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mission_submissions ADD COLUMN lease_token TEXT;
    ALTER TABLE mission_submissions ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mission_submissions ADD COLUMN error_code TEXT;
    CREATE INDEX submissions_queue ON mission_submissions(grading_enabled,state,next_attempt_at,lease_until);
    CREATE TABLE grading_budget(window TEXT PRIMARY KEY,tokens INTEGER NOT NULL DEFAULT 0,calls INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE grading_reservations(lease_token TEXT PRIMARY KEY,day TEXT NOT NULL,minute TEXT NOT NULL,tokens INTEGER NOT NULL);`) }
];

export function runMigrations(db: DatabaseSync, migrations: Migration[] = accountMigrations) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const seen = new Set<number>();
  for (const migration of [...migrations].sort((a,b)=>a.version-b.version)) {
    if (!Number.isInteger(migration.version) || migration.version < 1 || seen.has(migration.version)) throw new Error('Migration versions must be unique positive integers');
    seen.add(migration.version);
    if (db.prepare('SELECT 1 AS found FROM schema_migrations WHERE version=?').get(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(migration.version,Date.now());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}

export async function passwordHash(password: string) {
  const salt = randomBytes(16);
  const key = await derive(Buffer.from(password), salt);
  return `$argon2id$v=19$m=19456,t=2,p=1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[1] !== 'argon2id' || parts[2] !== 'v=19' || parts[3] !== 'm=19456,t=2,p=1') return false;
  try {
    const salt = Buffer.from(parts[4]!, 'base64url'), expected = Buffer.from(parts[5]!, 'base64url');
    if (salt.length !== 16 || expected.length !== 32) return false;
    const actual = await derive(Buffer.from(password), salt);
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}

export class Accounts {
  constructor(private db: DatabaseSync) {
    this.db.exec('PRAGMA foreign_keys=ON');
    runMigrations(this.db);
  }
  issueInvite(hours = 168) {
    if (!Number.isFinite(hours) || hours < 1 || hours > 8760) throw new Error('Invite expiry must be 1 hour to 1 year');
    const token = `itk_${randomBytes(24).toString('base64url')}`;
    this.db.prepare('INSERT INTO invitations(token_hash,created_at,expires_at) VALUES(?,?,?)').run(hash(token), Date.now(), Date.now() + hours * 3600000);
    return token;
  }
  revokeInvite(token: string) { return this.db.prepare('UPDATE invitations SET revoked_at=? WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL').run(Date.now(), hash(token)).changes > 0; }
  private consumeInvite(token: string, userId: string) {
    const result = this.db.prepare('UPDATE invitations SET used_at=?,used_by=? WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?').run(Date.now(), userId, hash(token), Date.now());
    if (!result.changes) throw Object.assign(new Error('Invitation is invalid or expired'), { status: 403 });
  }
  async register(input: unknown, guestId?: string) {
    const body = z.object({ invitation: z.string().min(8).max(128), loginId: loginSchema, password: passwordSchema }).strict().parse(input);
    const loginId = body.loginId.normalize('NFKC').toLowerCase();
    const now = Date.now(), id = guestId || randomUUID(), encoded = await passwordHash(body.password);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const taken=this.db.prepare('SELECT 1 AS found FROM users WHERE login_id=?').get(loginId);
      const invite=this.db.prepare('SELECT 1 AS found FROM invitations WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?').get(hash(body.invitation),now);
      if(taken||!invite)throw Object.assign(new Error('Invitation or registration details are unavailable'),{status:409});
      if (!guestId) this.db.prepare('INSERT INTO guests(id,token,csrf,name,disc,expires) VALUES(?,?,?,?,?,?)').run(id, hash(randomBytes(32).toString('base64url')), randomBytes(24).toString('base64url'), '', '', now + 30 * 86400000);
      this.db.prepare('UPDATE guests SET expires=? WHERE id=?').run(253402300799000,id);
      this.db.prepare('INSERT INTO users(id,login_id,password_hash,created_at,updated_at,last_login_at) VALUES(?,?,?,?,?,?)').run(id, loginId, encoded, now, now, now);
      this.consumeInvite(body.invitation, id);
      const session = this.createSession(id, now);
      this.db.exec('COMMIT');
      return { id, loginId, createdAt: now, session };
    } catch (error) { this.db.exec('ROLLBACK');if(error instanceof Error&&/UNIQUE constraint failed: users\.login_id/.test(error.message))throw Object.assign(new Error('Invitation or registration details are unavailable'),{status:409});throw error; }
  }
  private createSession(id: string, now = Date.now()) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url');
    this.db.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,NULL)').run(hash(token), id, csrf, now, now + 30 * 86400000);
    return { token, csrf, expiresAt: now + 30 * 86400000 };
  }
  async login(input: unknown) {
    const body = z.object({ loginId: loginSchema, password: z.string().min(1).max(128) }).strict().parse(input);
    const loginId = body.loginId.normalize('NFKC').toLowerCase();
    const row = this.db.prepare('SELECT id,password_hash,status FROM users WHERE login_id=?').get(loginId) as { id: string; password_hash: string; status: string } | undefined;
    // Verify a fixed dummy hash for unknown logins to reduce timing-based enumeration.
    const dummy = '$argon2id$v=19$m=19456,t=2,p=1$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const valid = await verifyPassword(body.password, row?.password_hash || dummy);
    if (!row || row.status !== 'active' || !valid) throw Object.assign(new Error('Invalid login or password'), { status: 401 });
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('UPDATE users SET last_login_at=?,updated_at=? WHERE id=?').run(now, now, row.id); const session = this.createSession(row.id, now); this.db.exec('COMMIT'); return { id: row.id, session }; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  session(token?: string) {
    if (!token) return undefined;
    const row = this.db.prepare(`SELECT s.user_id,s.csrf,s.expires_at,u.login_id,u.display_name,u.discipline,u.avatar,u.created_at,u.last_login_at,u.must_change_password,g.name,g.disc
      FROM account_sessions s JOIN users u ON u.id=s.user_id JOIN guests g ON g.id=u.id
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active'`).get(hash(token), Date.now()) as any;
    if (!row) return undefined;
    return { id: row.user_id, csrf: row.csrf, expires: row.expires_at, loginId: row.login_id, name: row.display_name || row.name, disc: row.discipline || row.disc, avatar: JSON.parse(row.avatar), createdAt: row.created_at, lastLoginAt: row.last_login_at, mustChangePassword:!!row.must_change_password };
  }
  guestId(token?: string) { return this.session(token)?.id; }
  revoke(token?: string) { if (!token) return; this.db.prepare('UPDATE account_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').run(Date.now(), hash(token)); }
  setProfile(id: string, name: string, disc: string, avatar: unknown) {
    const displayName = displaySchema.parse(name), discipline = z.string().refine(v => disciplines.has(v)).parse(disc);
    const current=this.db.prepare('SELECT discipline,avatar FROM users WHERE id=?').get(id) as {discipline:string;avatar:string}|undefined;
    if(current?.discipline && current.discipline!==discipline) throw Object.assign(new Error('Engineering discipline cannot be changed after it is selected'),{status:409});
    const appearance = avatar===undefined?JSON.parse(current?.avatar||'{}'):z.object({ color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), style: z.enum(['standard','vest','helmet']).optional() }).strict().parse(avatar || {});
    this.db.prepare('UPDATE users SET display_name=?,discipline=?,avatar=?,updated_at=? WHERE id=?').run(displayName, discipline, JSON.stringify(appearance), Date.now(), id);
    this.db.prepare('UPDATE guests SET name=?,disc=? WHERE id=?').run(displayName, discipline, id);
    return { name: displayName, disc: discipline, avatar: appearance };
  }
  account(id: string) { return this.db.prepare('SELECT login_id AS loginId,display_name AS name,discipline AS disc,avatar,created_at AS createdAt,last_login_at AS lastLoginAt FROM users WHERE id=? AND status=\'active\'').get(id) as any; }
  async adminRecover(login: string) {
    const loginId=loginSchema.parse(login).normalize('NFKC').toLowerCase();
    const recoveryKey=`recovery:${hash(loginId)}`,now=Date.now();
    this.db.prepare('DELETE FROM quotas WHERE key=? AND expires<=?').run(recoveryKey,now);
    this.db.prepare('INSERT INTO quotas(key,count,expires) VALUES(?,0,?) ON CONFLICT(key) DO NOTHING').run(recoveryKey,now+3600000);
    if(!this.db.prepare('UPDATE quotas SET count=count+1 WHERE key=? AND count<3').run(recoveryKey).changes)
      throw Object.assign(new Error('Recovery temporarily unavailable'),{status:429});
    const row=this.db.prepare('SELECT id FROM users WHERE login_id=? AND status=\'active\'').get(loginId) as {id:string}|undefined;
    if(!row)throw new Error('Active account not found');
    const temporaryPassword=randomBytes(24).toString('base64url');
    this.db.prepare('UPDATE users SET password_hash=?,updated_at=?,must_change_password=1 WHERE id=?').run(await passwordHash(temporaryPassword),Date.now(),row.id);
    this.db.prepare('UPDATE account_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(Date.now(),row.id);
    return temporaryPassword;
  }
  async verifyCurrentPassword(id: string, password: string) { const row=this.db.prepare('SELECT password_hash FROM users WHERE id=?').get(id) as {password_hash:string}|undefined; return !!row && verifyPassword(password,row.password_hash); }
  changePassword(id: string, input: unknown) {
    const b=z.object({currentPassword:z.string().min(1).max(128),newPassword:passwordSchema}).strict().parse(input);
    return this.verifyAndChange(id,b.currentPassword,b.newPassword);
  }
  private async verifyAndChange(id: string, current: string, next: string) {
    const row=this.db.prepare('SELECT password_hash FROM users WHERE id=?').get(id) as {password_hash:string}|undefined;
    if(!row||!await verifyPassword(current,row.password_hash))throw Object.assign(new Error('Current password is incorrect'),{status:403});
    this.db.prepare('UPDATE users SET password_hash=?,updated_at=?,must_change_password=0 WHERE id=?').run(await passwordHash(next),Date.now(),id);
    this.db.prepare('UPDATE account_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(Date.now(),id);
  }
  async export(id: string) {
    const user=this.account(id); if(!user) return undefined;
    const progress=this.db.prepare('SELECT mission,score,xp FROM results WHERE guest=?').all(id);
    const submissions=this.db.prepare('SELECT id,mission_id AS missionId,answer,state,score,xp,created_at AS createdAt,updated_at AS updatedAt FROM mission_submissions WHERE owner=? ORDER BY created_at').all(id);
    const attempts=this.db.prepare('SELECT submission,mission,answer_hash,review,created AS createdAt FROM attempts WHERE guest=? ORDER BY created').all(id);
    return { account:{...user,avatar:JSON.parse(user.avatar)},progress,submissions,attempts };
  }
  deleteAccount(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const user=this.db.prepare('SELECT login_id FROM users WHERE id=?').get(id) as {login_id:string}|undefined;
      this.db.prepare('DELETE FROM users WHERE id=?').run(id);
      this.db.prepare('DELETE FROM guests WHERE id=?').run(id);
      for(const prefix of ['profile','reset','review','password','delete'])this.db.prepare('DELETE FROM quotas WHERE key=?').run(`${prefix}:${id}`);
      if(user)this.db.prepare('DELETE FROM quotas WHERE key=?').run(`login-id:${hash(user.login_id)}`);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK');throw error; }
  }
  leaderboard(limit = 50) {
    return this.db.prepare(`SELECT g.id,g.name,g.disc,COALESCE(SUM(r.xp),0) AS xp,
      COUNT(CASE WHEN r.score>=? THEN 1 END) AS passed,
      RANK() OVER (ORDER BY COALESCE(SUM(r.xp),0) DESC) AS position
      FROM guests g LEFT JOIN users u ON u.id=g.id LEFT JOIN results r ON r.guest=g.id
      WHERE g.name<>'' AND g.disc<>'' AND g.expires>? AND (u.id IS NULL OR u.status='active')
      GROUP BY g.id ORDER BY xp DESC,g.name COLLATE NOCASE,g.id LIMIT ?`).all(catalog.pass,Date.now(), Math.min(100, Math.max(1, limit)));
  }
  submit(id: string, input: unknown, gradingEnabled=false) {
    const b=z.object({submissionId:z.string().uuid(),missionId:z.string().min(1).max(40),answer:z.string().trim().min(1).max(15000),locale:z.enum(['en','vi']).default('en'),aiConsent:z.boolean().default(false)}).strict().parse(input);
    gradingEnabled=gradingEnabled&&b.aiConsent;
    const m=catalog.missions.find(x=>x.id===b.missionId); if(!m)throw Object.assign(new Error('Mission not found'),{status:404});
    const profile=this.db.prepare("SELECT COALESCE(NULLIF(u.discipline,''),g.disc) AS discipline FROM guests g LEFT JOIN users u ON u.id=g.id WHERE g.id=?").get(id) as {discipline:string}|undefined;
    if(!profile?.discipline)throw Object.assign(new Error('Choose a discipline first'),{status:409});
    // All eight missions remain eligible for this training demo; validated rubric scores control completion and XP.
    if([...Object.values(catalog.templates[m.id]||{}),...Object.values(catalog.templateHistory[m.id]||{})].some(template=>template.trim()===b.answer.trim()))throw Object.assign(new Error('Fill in the template with your own ideas before submitting'),{status:422});
    const hashAnswer=hash(b.answer.trim()), now=Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing=this.db.prepare('SELECT mission_id,answer_hash,state,created_at,grading_enabled FROM mission_submissions WHERE owner=? AND id=?').get(id,b.submissionId) as any;
      if(existing){if(existing.mission_id!==b.missionId||existing.answer_hash!==hashAnswer)throw Object.assign(new Error('Submission ID already used with different content'),{status:409});this.db.exec('COMMIT');return {submissionId:b.submissionId,state:existing.state,createdAt:existing.created_at,gradingEnabled:!!existing.grading_enabled,duplicate:true};}
      const same=this.db.prepare("SELECT id,state,created_at FROM mission_submissions WHERE owner=? AND mission_id=? AND answer_hash=? AND grading_enabled=? AND state IN ('pending','reviewing','graded','retryable') AND (state<>'graded' OR json_extract(result,'$.rubricVersion')=? OR json_extract(result,'$.provider')='local') ORDER BY created_at LIMIT 1").get(id,b.missionId,hashAnswer,gradingEnabled?1:0,RUBRIC_VERSION) as any;
      if(same){this.db.exec('COMMIT');return {submissionId:same.id,state:same.state,createdAt:same.created_at,gradingEnabled:gradingEnabled,duplicate:true};}
      if(gradingEnabled && (this.db.prepare("SELECT COUNT(*) AS n FROM mission_submissions WHERE grading_enabled=1 AND state IN ('pending','reviewing','retryable') AND grading_attempts<3").get() as {n:number}).n>=200)throw Object.assign(new Error('Review queue is full; please try later'),{status:429});
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM mission_submissions WHERE owner=? AND created_at>?').get(id,now-86400000) as {n:number};
      if(count.n>=20)throw Object.assign(new Error('Daily submission limit reached'),{status:429});
      const quotaKey=`submission-day:${id}:${Math.floor(now/86400000)}`;
      this.db.prepare('INSERT OR IGNORE INTO quotas(key,count,expires) VALUES(?,0,?)').run(quotaKey,(Math.floor(now/86400000)+1)*86400000);
      if(!this.db.prepare('UPDATE quotas SET count=count+1 WHERE key=? AND count<20').run(quotaKey).changes)throw Object.assign(new Error('Daily submission limit reached'),{status:429});

      this.db.prepare("INSERT INTO mission_submissions(id,owner,mission_id,answer,answer_hash,state,created_at,updated_at,locale,grading_enabled) VALUES(?,?,?,?,?,'pending',?,?,?,?)").run(b.submissionId,id,b.missionId,b.answer,hashAnswer,now,now,b.locale,gradingEnabled?1:0);
      this.db.exec('COMMIT');return {submissionId:b.submissionId,state:'pending',createdAt:now,gradingEnabled,duplicate:false};
    } catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  submission(id:string,submissionId:string){return this.db.prepare('SELECT id AS submissionId,mission_id AS missionId,answer,locale,state,score,xp,result,grading_enabled AS gradingEnabled,error_code AS errorCode,grading_attempts AS attempts,created_at AS createdAt,updated_at AS updatedAt FROM mission_submissions WHERE owner=? AND id=?').get(id,submissionId);}
  submissions(id:string){return this.db.prepare('SELECT id AS submissionId,mission_id AS missionId,answer,locale,state,score,xp,result,grading_enabled AS gradingEnabled,error_code AS errorCode,created_at AS createdAt,updated_at AS updatedAt FROM mission_submissions WHERE owner=? ORDER BY created_at DESC LIMIT 200').all(id);}
}
