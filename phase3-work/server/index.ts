import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { catalog, missions } from './catalog.js';
import { GradeQueue, Grader, ProviderError, passThreshold } from './grader.js';
import { profileSchema, type Progress } from './protocol.js';
import { Room } from './room.js';
import { Store, type Guest, type Review } from './store.js';
import { Accounts } from './accounts.js';
import { GradingJobs } from './grading-jobs.js';

const port = numberEnv('PORT', 3000, 1, 65535);
const host = process.env.HOST || '127.0.0.1';
const production = process.env.NODE_ENV === 'production';
if(process.env.GRADING_PROVIDER && !['mock','groq'].includes(process.env.GRADING_PROVIDER))throw new Error('Unsupported grading provider');
const provider:'mock'|'groq'=process.env.GRADING_PROVIDER==='groq'?'groq':'mock';
if(provider==='groq'&&(process.env.GROQ_FREE_PLAN_CONFIRMED!=='true'||!process.env.GROQ_API_KEY))throw new Error('Groq requires a protected API key and explicit Free-plan confirmation');
const maxTokens = numberEnv('GRADING_MAX_OUTPUT_TOKENS', 1200, 128, 4096);
const inputUsdPerMillion = numberEnv('GROQ_INPUT_USD_PER_MILLION', 0, 0, 1000);
const outputUsdPerMillion = numberEnv('GROQ_OUTPUT_USD_PER_MILLION', 0, 0, 1000);
const dailyMaxTokens = numberEnv('DAILY_MAX_TOKENS', 250000, 1, 1000000000);
const dailyMaxUsd = numberEnv('DAILY_MAX_USD', 2, 0.01, 1000000);
const store = new Store(process.env.SQLITE_PATH || './data/game.sqlite');
if (Number(process.versions.node.split('.')[0]) < 24 || (Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) < 7)) throw new Error('Node.js 24.7 or newer is required for built-in Argon2id');
const accounts = new Accounts(store.db);
if ((process.env.TRUSTED_PROXY_SECRET && process.env.TRUSTED_PROXY_SECRET.length < 32) || (!!process.env.TRUSTED_PROXY_SECRET !== !!process.env.PUBLIC_GAME_ORIGIN)) throw new Error('Set PUBLIC_GAME_ORIGIN and a 32+ character TRUSTED_PROXY_SECRET together');
const grader = new Grader({
  attempts:1,
  provider,
  apiKey: process.env.GROQ_API_KEY || '',
  model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  maxOutputTokens: maxTokens,
  inputUsdPerMillion,
  outputUsdPerMillion
});
const queue = new GradeQueue(numberEnv('GRADING_CONCURRENCY', 3, 1, 16), numberEnv('GRADING_QUEUE', 20, 0, 200));
const room = new Room(store, 10, numberEnv('ROOM_CAPACITY', 80, 1, 500));
const jobs=new GradingJobs(store,grader,{
  enabled:provider==='groq',minIntervalMs:numberEnv('GRADING_MIN_INTERVAL_MS',15000,1000,300000),
  dailyTokens:numberEnv('GRADING_DAILY_TOKEN_CAP',100000,1000,200000),minuteTokens:numberEnv('GRADING_MINUTE_TOKEN_CAP',8000,1000,30000),
  dailyCalls:numberEnv('GRADING_DAILY_CALL_CAP',300,1,1000),maxOutputTokens:maxTokens
},id=>room.progress(id));
const gradingStatus=()=>({provider:provider==='groq'?'groq':'disabled',pass:passThreshold()});

const maxBody = 20000;
const cookieName = 'pw_session';
const accountCookieName = 'pw_account';
const cookieAttributes = (name: string, token: string, maxAge: number) => `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
const clearCookie = (name: string) => `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production ? '; Secure' : ''}`;
const inFlight = new Map<string, { hash: string; promise: Promise<{ review: Review; progress: Progress }> }>();

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return number;
}

function send(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

function cookie(req: IncomingMessage, name: string) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

function currentAccount(req: IncomingMessage) { return accounts.session(cookie(req, accountCookieName)); }
function currentGuest(req: IncomingMessage) { const account=currentAccount(req); return account ? store.guestById(account.id) : store.guest(cookie(req, cookieName)); }

function sameSecret(actual: string | undefined, expected: string) {
  if (!actual) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function csrf(req: IncomingMessage, guest: Guest) {
  return sameSecret(req.headers['x-csrf-token']?.toString(), currentAccount(req)?.csrf || guest.csrf);
}
function trustedProxy(req: IncomingMessage) {
  const expected=process.env.TRUSTED_PROXY_SECRET;
  const supplied=req.headers['x-game-proxy-auth']?.toString();
  return !!expected && sameSecret(supplied, expected);
}

function requestIp(req: IncomingMessage) {
  if(trustedProxy(req)) return String(req.headers['x-game-client-ip']||'unknown').slice(0,128);
  return req.socket.remoteAddress || 'unknown';
}

function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const host = String(req.headers.host ?? '').trim();
    const publicOrigin=process.env.PUBLIC_GAME_ORIGIN;
    if (trustedProxy(req)) return !!publicOrigin && parsed.origin === publicOrigin;
    return parsed.host.toLowerCase() === host.toLowerCase()
      && (parsed.protocol === 'https:' || (!production && parsed.protocol === 'http:'));
  } catch { return false; }
}

async function readJson(req: IncomingMessage) {
  const size = Number(req.headers['content-length'] || 0);
  if (size > maxBody) throw Object.assign(new Error('Request too large'), { status: 413 });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += Buffer.byteLength(chunk);
    if (total > maxBody) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function requirePost(req: IncomingMessage, res: ServerResponse, guest: Guest) {
  if (!sameOrigin(req) || !csrf(req, guest)) { send(res, 403, { error: 'Request verification failed' }); return false; }
  return true;
}

function jsonError(error: unknown, res: ServerResponse) {
  const explicitStatus=typeof error==='object'&&error&&'status' in error?Number(error.status):undefined;
  const status=explicitStatus||(error instanceof z.ZodError?400:error instanceof ProviderError?error.status:500);
  const message = error instanceof z.ZodError ? 'Invalid request data'
    : error instanceof ProviderError ? error.message
      : explicitStatus&&error instanceof Error?error.message:'Request failed';
  send(res, status, { error: message });
}

function safeProgress(progress: Progress) { return progress; }

const server = createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const remoteAddress = req.socket.remoteAddress || '';
    const localRequest = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress.endsWith('::ffff:127.0.0.1');
    if (url.pathname === '/_load/metrics' && req.method === 'GET' && process.env.LOAD_TEST_METRICS === '1' && localRequest) {
      return send(res, 200, {
        cpu: process.cpuUsage(),
        rssBytes: process.memoryUsage.rss(),
        online: room.size,
        counters: {
          incoming: room.counters.incoming,
          outgoing: room.counters.outgoing,
          bytesIn: room.counters.bytesIn,
          bytesOut: room.counters.bytesOut,
          rejected: room.counters.rejected
        }
      });
    }
    if ((url.pathname === '/healthz'||url.pathname==='/readyz') && req.method === 'GET') { store.db.prepare('SELECT 1').get(); return send(res, 200, { ok: true, grading:provider==='groq'?'groq':'disabled', online: room.size }); }

    if (url.pathname.startsWith('/api/')) {
      if (process.env.PUBLIC_GAME_ORIGIN && !trustedProxy(req)) return send(res,403,{error:'Game service access denied'});
      if (url.pathname === '/api/session' && req.method === 'GET') {
        const account=currentAccount(req);
        if(account){const guest=store.guestById(account.id)!;return send(res,200,{csrfToken:account.csrf,account:{id:account.id,loginId:account.loginId,createdAt:account.createdAt,lastLoginAt:account.lastLoginAt,avatar:account.avatar,mustChangePassword:account.mustChangePassword},profile:{name:account.name,disc:account.disc,avatar:account.avatar},progress:store.progress(guest.id),submissions:accounts.submissions(guest.id),grading:gradingStatus()});}
      }
      if (url.pathname === '/api/account/register' && req.method === 'POST') {
        const guest=store.guest(cookie(req,cookieName)); if(!guest)return send(res,401,{error:'Start a guest session before registering'});
        if(!requirePost(req,res,guest))return;
        const address=createHash('sha256').update(requestIp(req)).digest('hex');if(!store.quota(`register:${address}`,10,3600000))return send(res,429,{error:'Registration limit reached'});
        const b=await readJson(req) as {invitation:string;loginId:string;password:string;migrateGuest?:boolean};
        const result=await accounts.register({invitation:b.invitation,loginId:b.loginId,password:b.password},b.migrateGuest===true?guest.id:undefined);
        const userGuest=store.guestById(result.id)!;res.setHeader('set-cookie',[cookieAttributes(accountCookieName,result.session.token,2592000),clearCookie(cookieName)]);
        return send(res,201,{csrfToken:result.session.csrf,account:{id:result.id,loginId:result.loginId,createdAt:result.createdAt,lastLoginAt:result.createdAt,avatar:{},mustChangePassword:false},profile:{name:userGuest.name,disc:userGuest.disc},progress:store.progress(result.id),submissions:accounts.submissions(result.id)});
      }
      if (url.pathname === '/api/account/login' && req.method === 'POST') {
        const guest=currentGuest(req);if(!guest)return send(res,401,{error:'Session expired'});if(!requirePost(req,res,guest))return;
        const loginInput=await readJson(req) as {loginId?:unknown,password?:unknown};
        const address=createHash('sha256').update(requestIp(req)).digest('hex'),loginKey=createHash('sha256').update(typeof loginInput.loginId==='string'?loginInput.loginId.normalize('NFKC').toLowerCase():'invalid').digest('hex');
        if(!store.quota(`login-ip:${address}`,250,3600000)||!store.quota(`login-id:${loginKey}`,10,3600000))return send(res,429,{error:'Login temporarily unavailable'});
        const result=await accounts.login(loginInput);const session=accounts.session(result.session.token)!;const userGuest=store.guestById(result.id)!;
        res.setHeader('set-cookie',[cookieAttributes(accountCookieName,result.session.token,2592000),clearCookie(cookieName)]);
        return send(res,200,{csrfToken:session.csrf,account:{id:result.id,loginId:session.loginId,createdAt:session.createdAt,lastLoginAt:session.lastLoginAt,avatar:session.avatar,mustChangePassword:session.mustChangePassword},profile:{name:userGuest.name,disc:userGuest.disc,avatar:session.avatar},progress:store.progress(result.id),submissions:accounts.submissions(result.id)});
      }
      if (url.pathname === '/api/account/logout' && req.method === 'POST') {
        const guest=currentGuest(req);if(!guest)return send(res,204,{});if(!requirePost(req,res,guest))return;
        accounts.revoke(cookie(req,accountCookieName));res.setHeader('set-cookie',[clearCookie(accountCookieName),clearCookie(cookieName)]);res.writeHead(204,{'cache-control':'no-store'});return res.end();
      }
      if (url.pathname === '/api/session' && req.method === 'GET') {
        const expiredAccount=!!cookie(req,accountCookieName)&&!currentAccount(req);
        if(expiredAccount)res.setHeader('set-cookie',clearCookie(accountCookieName));
        let guest = currentGuest(req);
        if (!guest) {
          const clientAddress = requestIp(req);
          const addressKey = createHash('sha256').update(clientAddress).digest('hex');
          if (!store.quota(`guest:${addressKey}`, numberEnv('SESSION_STARTS_PER_IP_HOUR', 250, 1, 10000), 60 * 60_000)) return send(res, 429, { error: 'Too many sessions started from this connection. Try again later.' });
          const created = store.createGuest();
          guest = created.guest;
          const guestCookie=cookieAttributes(cookieName,created.token,2592000),prior=res.getHeader('set-cookie');
          res.setHeader('set-cookie',prior?[...(Array.isArray(prior)?prior.map(String):[String(prior)]),guestCookie]:guestCookie);
        }
        return send(res, 200, {
          sessionExpired:expiredAccount,
          csrfToken: guest.csrf,
          profile: { name: guest.name, disc: guest.disc },
          progress: safeProgress(store.progress(guest.id)),
          submissions: accounts.submissions(guest.id),
          grading: gradingStatus()
        });
      }

      const guest = currentGuest(req);
      if (!guest) return send(res, 401, { error: 'Session expired. Reload the page to start a new session.' });
      const account=currentAccount(req);
      if(account?.mustChangePassword&&!['/api/account/password','/api/account/logout','/api/account/export','/api/account'].includes(url.pathname))return send(res,428,{error:'Change your temporary recovery password before using game services'});
      if(url.pathname==='/api/account/export'&&req.method==='GET'){if(!account)return send(res,403,{error:'Account required'});return send(res,200,await accounts.export(account.id));}
      if(url.pathname==='/api/account/password'&&req.method==='POST'){if(!account)return send(res,403,{error:'Account required'});if(!requirePost(req,res,guest))return;if(!store.quota(`password:${account.id}`,5,3600000))return send(res,429,{error:'Password change temporarily unavailable'});await accounts.changePassword(account.id,await readJson(req));accounts.revoke(cookie(req,accountCookieName));res.setHeader('set-cookie',clearCookie(accountCookieName));return send(res,200,{ok:true,reauthenticate:true});}
      if(url.pathname==='/api/account'&&req.method==='DELETE'){if(!account)return send(res,403,{error:'Account required'});if(!requirePost(req,res,guest))return;if(!store.quota(`delete:${account.id}`,5,3600000))return send(res,429,{error:'Account deletion temporarily unavailable'});const b=await readJson(req) as {password?:string};if(!await accounts.verifyCurrentPassword(account.id,b.password||''))return send(res,403,{error:'Password confirmation failed'});if([...inFlight.keys()].some(key=>key.startsWith(`${account.id}:`)))return send(res,409,{error:'Wait for your active review to finish, then delete your account'});room.remove(account.id,false);accounts.deleteAccount(account.id);res.setHeader('set-cookie',[clearCookie(accountCookieName),clearCookie(cookieName)]);res.writeHead(204,{'cache-control':'no-store'});return res.end();}
      if(url.pathname==='/api/progress'&&req.method==='GET')return send(res,200,{progress:store.progress(guest.id)});
      if(url.pathname==='/api/submissions'&&req.method==='GET')return send(res,200,{submissions:accounts.submissions(guest.id)});
      if(url.pathname==='/api/submissions'&&req.method==='POST'){if(!requirePost(req,res,guest))return;if(!store.quota('submit-ip:'+createHash('sha256').update(requestIp(req)).digest('hex'),numberEnv('SUBMISSIONS_PER_IP_HOUR',1000,20,10000),3600000))return send(res,429,{error:'Submission limit reached for this connection'});const s=accounts.submit(guest.id,await readJson(req),provider==='groq');return send(res,202,s);}
      if(url.pathname.startsWith('/api/submissions/')&&req.method==='GET'){
        const id=url.pathname.slice('/api/submissions/'.length);if(!z.string().uuid().safeParse(id).success)return send(res,404,{error:'Submission not found'});
        const submission=accounts.submission(guest.id,id);if(!submission)return send(res,404,{error:'Submission not found'});
        return send(res,200,{submission,progress:store.progress(guest.id)});
      }
      if(url.pathname==='/api/leaderboard'&&req.method==='GET')return send(res,200,{leaders:accounts.leaderboard()});
      if (url.pathname === '/api/session' && req.method === 'DELETE') {
        if (account) return send(res,403,{error:'Account data deletion requires password confirmation'});
        if (!requirePost(req, res, guest)) return;
        if ([...inFlight.keys()].some(key => key.startsWith(`${guest.id}:`))) return send(res, 409, { error: 'Wait for your active review to finish, then delete guest data.' });
        room.remove(guest.id,false);store.deleteGuest(guest.id);
        res.setHeader('set-cookie', clearCookie(cookieName));
        res.writeHead(204, { 'cache-control': 'no-store' });return res.end();
      }
      if (url.pathname === '/api/profile' && req.method === 'POST') {
        if (!requirePost(req, res, guest)) return;
        if (!store.quota(`profile:${guest.id}`, 20, 60_000)) return send(res, 429, { error: 'Please wait before updating your profile again.' });
        const profile = profileSchema.parse(await readJson(req));
        const updated = account ? accounts.setProfile(guest.id,profile.name,profile.disc,profile.avatar) : store.profile(guest, profile.name, profile.disc);
        room.updateProfile(store.guestById(guest.id)!);
        return send(res, 200, { profile: { name: updated.name, disc: updated.disc, ...(account?{avatar:JSON.parse(accounts.account(guest.id).avatar)}:{}) }, progress: store.progress(guest.id) });
      }
      if (url.pathname === '/api/reset' && req.method === 'POST') {
        if (!requirePost(req, res, guest)) return;
        if (!store.quota(`reset:${guest.id}`, 3, 60_000)) return send(res, 429, { error: 'Please wait before resetting again.' });
        store.reset(guest.id); room.remove(guest.id);
        return send(res, 200, { profile: { name: guest.name, disc: '' }, progress: store.progress(guest.id) });
      }
      if (url.pathname === '/api/review' && req.method === 'POST') {
        if (!requirePost(req, res, guest)) return;
        const body = z.object({ submissionId: z.string().uuid(), missionId: z.string().min(1).max(40), answer: z.string().max(15000) }).strict().parse(await readJson(req));
        if (!guest.name || !guest.disc) return send(res, 409, { error: 'Choose a name and discipline first.' });
        if(provider==='groq')return send(res,202,accounts.submit(guest.id,body,true));
        const mission = missions.get(body.missionId);
        if (!mission) return send(res, 404, { error: 'Mission not found' });
        if (mission.needs && store.progress(guest.id).passed < mission.needs) return send(res, 403, { error: 'Complete the required missions first.' });
        const answerHash = createHash('sha256').update(body.answer.trim()).digest('hex');
        const cached = store.cached(guest.id, body.submissionId, mission.id, answerHash);
        if (cached) return send(res, 200, { review: cached, progress: store.progress(guest.id), cached: true });
        const key = `${guest.id}:${body.submissionId}`;
        const pending = inFlight.get(key);
        if (pending) {
          if (pending.hash !== answerHash) return send(res, 409, { error: 'Submission ID already used with different content' });
          const result = await pending.promise;
          return send(res, 200, { ...result, cached: true });
        }
        if (!store.quota(`review:${guest.id}`, 8, 60 * 60_000)) return send(res, 429, { error: 'Review limit reached. Try again later.' });
        const promise = queue.run(async () => {
          return grader.review(mission, body.answer);
        }).then(review => {
          const progress = store.commit(guest, mission, body.submissionId, answerHash, review);
          room.progress(guest.id);
          return { review, progress };
        });
        const entry = { hash: answerHash, promise };
        inFlight.set(key, entry);
        try { return send(res, 200, await promise); }
        finally { if (inFlight.get(key) === entry) inFlight.delete(key); }
      }
      return send(res, 404, { error: 'API route not found' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0')) return send(res, 400, { error: 'Invalid path' });
    let file = pathname === '/vendor/three.min.js'
      ? resolve('node_modules/three/build/three.min.js')
      : resolve(`.${pathname}`);
    const root = resolve('.');
    if (file !== resolve('node_modules/three/build/three.min.js') && !file.startsWith(root + sep)) return send(res, 404, { error: 'Not found' });
    if (!['/index.html', '/catalog.json', '/vendor/three.min.js'].includes(pathname)) return send(res, 404, { error: 'Not found' });
    const content = await readFile(file);
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'content-length': content.length, 'cache-control': pathname === '/index.html' ? 'no-store' : 'public, max-age=3600' });
    return res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    jsonError(error, res);
  }
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const guest = currentGuest(req);
  const account=currentAccount(req);
  if (url.pathname !== '/ws' || (process.env.PUBLIC_GAME_ORIGIN && !trustedProxy(req)) || !guest || account?.mustChangePassword || !sameOrigin(req)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  sockets.handleUpgrade(req, socket, head, ws => room.attach(ws, guest));
});

server.listen(port, host, () => {jobs.start();console.log(`Prompt Works listening on ${host}:${port}; grading=${provider}; room=${room.size}`);});
let shuttingDown=false;
async function shutdown() {
  if(shuttingDown)return;shuttingDown=true;
  const deadline=setTimeout(()=>process.exit(1),40000);deadline.unref();
  await jobs.stop();
  room.close();
  sockets.close();
  server.close(() => { store.close(); process.exit(0); });

}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
