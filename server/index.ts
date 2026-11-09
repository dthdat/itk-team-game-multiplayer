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

const port = numberEnv('PORT', 3000, 1, 65535);
const host = process.env.HOST || '127.0.0.1';
const production = process.env.NODE_ENV === 'production';
const provider = process.env.GRADING_PROVIDER === 'groq' ? 'groq' : 'mock';
const maxTokens = numberEnv('GRADING_MAX_OUTPUT_TOKENS', 1200, 128, 4096);
const inputUsdPerMillion = numberEnv('GROQ_INPUT_USD_PER_MILLION', 0, 0, 1000);
const outputUsdPerMillion = numberEnv('GROQ_OUTPUT_USD_PER_MILLION', 0, 0, 1000);
const dailyMaxTokens = numberEnv('DAILY_MAX_TOKENS', 250000, 1, 1000000000);
const dailyMaxUsd = numberEnv('DAILY_MAX_USD', 2, 0.01, 1000000);
const store = new Store(process.env.SQLITE_PATH || './data/game.sqlite');
const grader = new Grader({
  provider,
  apiKey: process.env.GROQ_API_KEY || '',
  model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  maxOutputTokens: maxTokens,
  inputUsdPerMillion,
  outputUsdPerMillion
});
if (provider === 'groq' && !process.env.GROQ_API_KEY) throw new Error('GRADING_PROVIDER=groq requires GROQ_API_KEY');
if (provider === 'groq' && (!process.env.GROQ_INPUT_USD_PER_MILLION || !process.env.GROQ_OUTPUT_USD_PER_MILLION || inputUsdPerMillion <= 0 || outputUsdPerMillion <= 0 || !process.env.DAILY_MAX_USD)) {
  throw new Error('Groq mode requires verified positive input/output prices and an explicit DAILY_MAX_USD');
}
const queue = new GradeQueue(numberEnv('GRADING_CONCURRENCY', 3, 1, 16), numberEnv('GRADING_QUEUE', 20, 0, 200));
const room = new Room(store, 5, numberEnv('ROOM_CAPACITY', production ? 40 : 80, 1, 500));
const maxBody = 20000;
const cookieName = 'pw_session';
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

function currentGuest(req: IncomingMessage) { return store.guest(cookie(req, cookieName)); }

function sameSecret(actual: string | undefined, expected: string) {
  if (!actual) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function csrf(req: IncomingMessage, guest: Guest) {
  return sameSecret(req.headers['x-csrf-token']?.toString(), guest.csrf);
}

function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const host = String(req.headers.host ?? '').trim();
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
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 400;
  const message = error instanceof z.ZodError ? 'Invalid request data'
    : error instanceof ProviderError ? error.message
      : error instanceof Error ? error.message : 'Request failed';
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
    if (url.pathname === '/healthz' && req.method === 'GET') return send(res, 200, { ok: true, provider, online: room.size });

    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/session' && req.method === 'GET') {
        let guest = currentGuest(req);
        if (!guest) {
          const clientAddress = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0]?.trim() || 'unknown';
          const addressKey = createHash('sha256').update(clientAddress).digest('hex');
          if (!store.quota(`guest:${addressKey}`, numberEnv('SESSION_STARTS_PER_IP_HOUR', 20, 1, 10000), 60 * 60_000)) return send(res, 429, { error: 'Too many sessions started from this connection. Try again later.' });
          const created = store.createGuest();
          guest = created.guest;
          const attributes = [`${cookieName}=${created.token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=2592000'];
          if (production) attributes.push('Secure');
          res.setHeader('set-cookie', attributes.join('; '));
        }
        return send(res, 200, {
          csrfToken: guest.csrf,
          profile: { name: guest.name, disc: guest.disc },
          progress: safeProgress(store.progress(guest.id)),
          grading: { provider, pass: passThreshold() }
        });
      }

      const guest = currentGuest(req);
      if (!guest) return send(res, 401, { error: 'Session expired. Reload the page to start a new session.' });
      if (url.pathname === '/api/session' && req.method === 'DELETE') {
        if (!requirePost(req, res, guest)) return;
        if ([...inFlight.keys()].some(key => key.startsWith(`${guest.id}:`))) return send(res, 409, { error: 'Wait for your active review to finish, then delete guest data.' });
        room.remove(guest.id);store.deleteGuest(guest.id);
        res.setHeader('set-cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production ? '; Secure' : ''}`);
        res.writeHead(204, { 'cache-control': 'no-store' });return res.end();
      }
      if (url.pathname === '/api/profile' && req.method === 'POST') {
        if (!requirePost(req, res, guest)) return;
        if (!store.quota(`profile:${guest.id}`, 20, 60_000)) return send(res, 429, { error: 'Please wait before updating your profile again.' });
        const profile = profileSchema.parse(await readJson(req));
        const updated = store.profile(guest, profile.name, profile.disc);
        return send(res, 200, { profile: { name: updated.name, disc: updated.disc }, progress: store.progress(guest.id) });
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
          const wordCount = body.answer.trim() ? body.answer.trim().split(/\s+/u).length : 0;
          if (provider === 'groq' && wordCount >= mission.minWords) {
            const reserve = grader.reserveEstimate(body.answer);
            if (!store.reserve(reserve.tokens, reserve.usd, dailyMaxTokens, dailyMaxUsd)) throw Object.assign(new ProviderError('Daily grading budget reached', 429), { status: 429 });
          }
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
  if (url.pathname !== '/ws' || !guest || !sameOrigin(req)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  sockets.handleUpgrade(req, socket, head, ws => room.attach(ws, guest));
});

server.listen(port, host, () => console.log(`Prompt Works listening on ${host}:${port}; grading=${provider}; room=${room.size}`));
function shutdown() {
  room.close();
  sockets.close();
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);