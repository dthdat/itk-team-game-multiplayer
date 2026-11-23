#!/usr/bin/env node
import WebSocket from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const GAME_ORIGIN = 'https://game-staging.itkvn.workers.dev';
const API = GAME_ORIGIN;
const WS_URL = 'wss://game-staging.itkvn.workers.dev/ws';
const HELP = process.argv.includes('--help') || process.argv.includes('-h');

if (HELP) {
  console.log('Windows/external staging load runner. Target is fixed to game-staging.itkvn.workers.dev.');
  console.log('Requires Node.js 24.7+ and the pinned ws package. Run only after checking Cloudflare Workers Analytics.');
  console.log('Stages: 5 clients for 30s, 20 for 45s, then 70 for PUBLIC_LOAD_DURATION_SECONDS (default 300, maximum 1800).');
  process.exit(0);
}

if (process.env.ITK_LOAD_ACK !== 'STAGING_ONLY' || process.env.CF_QUOTA_CHECKED !== 'YES') {
  console.error('Stopped before network access. Use the Windows wrapper with -ConfirmCloudflareQuota YES after checking account Workers usage.');
  process.exit(2);
}

const finalSeconds = Number(process.env.PUBLIC_LOAD_DURATION_SECONDS || 300);
if (!Number.isInteger(finalSeconds) || finalSeconds < 30 || finalSeconds > 1800) {
  console.error('PUBLIC_LOAD_DURATION_SECONDS must be an integer from 30 to 1800.');
  process.exit(2);
}

const outputPath = resolve(process.env.PUBLIC_LOAD_REPORT || 'reports/public-load-staging.json');
const maxParallelSetups = 10;
const intentionalSockets = new WeakSet();
const latencies = [];
const clients = [];
let stopping = false;
let movementTimer;
let plannedReconnectTask;
let moveTick = 0;
const counters = {
  dynamicHttpRequests: 0,
  httpStatuses: {},
  http429: 0,
  http5xx: 0,
  otherHttpFailures: 0,
  guestSessionsCreated: 0,
  guestCleanupSuccess: 0,
  guestCleanupFailures: 0,
  secureCookieFailures: 0,
  webSocketHandshakes: 0,
  webSocketOpened: 0,
  webSocketHandshakeFailures: 0,
  webSocketUnexpectedDisconnects: 0,
  closeCodes: {},
  plannedReconnects: 0,
  successfulReconnects: 0,
  failedReconnects: 0,
  automaticReconnectAttempts: 0,
  automaticReconnectSuccesses: 0,
  automaticReconnectFailures: 0,
  movementMessagesSent: 0,
  serverMessagesReceived: 0,
  serverMessageBytes: 0,
  movementDeltasReceived: 0,
  pingSamples: 0,
  setupFailures: 0
};

function statusCount(status) {
  const key = String(status);
  counters.httpStatuses[key] = (counters.httpStatuses[key] || 0) + 1;
  if (status === 429) counters.http429++;
  if (status >= 500) counters.http5xx++;
  if (status >= 400 && status !== 429) counters.otherHttpFailures++;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)].toFixed(2));
}

function latencySummary(values) {
  return {
    p50Ms: percentile(values, 0.50),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    samples: values.length
  };
}

function connectedCount() {
  return clients.filter(client => client.connected && client.socket?.readyState === WebSocket.OPEN).length;
}

function effectiveTargetCount(expected) {
  return expected - clients.filter(client => client.plannedReconnecting).length;
}

function delay(milliseconds, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
  });
}

async function request(path, options = {}, client) {
  counters.dynamicHttpRequests++;
  if (client) client.dynamicHttpRequests++;
  const method = options.method || (options.body ? 'POST' : 'GET');
  const headers = {
    accept: 'application/json',
    origin: GAME_ORIGIN,
    ...(client?.cookie ? { cookie: client.cookie } : {}),
    ...(options.body ? {
      'content-type': 'application/json'
    } : {}),
    ...(client && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { 'x-csrf-token': client.csrf } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(API + path, {
    method,
    headers,
    body: options.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000)
  });
  statusCount(response.status);
  return response;
}

function findSessionCookie(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const value = values.map(line => line.split(';', 1)[0]).find(line => line.startsWith('pw_session='));
  if (!value) return { cookie: '', secure: false };
  const original = values.find(line => line.startsWith('pw_session='));
  const lower = String(original || '').toLowerCase();
  return {
    cookie: value,
    secure: lower.includes('; secure') && lower.includes('; httponly') && lower.includes('samesite=strict')
  };
}

function sendJson(client, message) {
  if (!client.connected || client.socket?.readyState !== WebSocket.OPEN) return false;
  const payload = JSON.stringify(message);
  try {
    client.socket.send(payload);
    if (message.type === 'move') counters.movementMessagesSent++;
    return true;
  } catch {
    return false;
  }
}

function attachSocket(client, reconnecting) {
  counters.webSocketHandshakes++;
  return new Promise((resolveWelcome, rejectWelcome) => {
    const socket = new WebSocket(WS_URL, {
      headers: {
        Origin: GAME_ORIGIN,
        Cookie: client.cookie
      },
      handshakeTimeout: 15000,
      perMessageDeflate: false
    });
    client.socket = socket;
    let welcomed = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        counters.webSocketHandshakeFailures++;
        socket.terminate();
        rejectWelcome(new Error('WebSocket welcome timed out'));
      }
    }, 20000);

    const rejectOnce = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectWelcome(error);
    };

    socket.once('open', () => {
      counters.webSocketOpened++;
      socket.send(JSON.stringify({ type: reconnecting ? 'reconnect' : 'hello', v: 1 }));
    });

    socket.on('message', raw => {
      counters.serverMessagesReceived++;
      counters.serverMessageBytes += Buffer.byteLength(raw);
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === 'welcome' && !welcomed) {
        welcomed = true;
        client.connected = true;
        if (reconnecting) counters.successfulReconnects++;
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          resolveWelcome(message);
        }
        return;
      }
      if (message.type === 'pong' && Number.isFinite(message.at)) {
        const elapsed = performance.now() - message.at;
        if (elapsed >= 0 && elapsed < 60000) {
          latencies.push(elapsed);
          counters.pingSamples++;
        }
        return;
      }
      if (message.type === 'delta') counters.movementDeltasReceived++;
    });

    socket.once('unexpected-response', (_request, response) => {
      statusCount(response.statusCode || 0);
      counters.webSocketHandshakeFailures++;
      rejectOnce(new Error('WebSocket upgrade was rejected with HTTP ' + response.statusCode));
    });

    socket.on('error', () => {
      if (!welcomed) {
        counters.webSocketHandshakeFailures++;
        rejectOnce(new Error('WebSocket connection failed'));
      }
    });

    socket.on('close', code => {
      counters.closeCodes[String(code)] = (counters.closeCodes[String(code)] || 0) + 1;
      if (client.socket === socket) client.connected = false;
      if (!welcomed) {
        rejectOnce(new Error('WebSocket closed before welcome'));
        return;
      }
      if (!intentionalSockets.has(socket) && !stopping) {
        counters.webSocketUnexpectedDisconnects++;
        recoverClient(client);
      }
    });
  });
}

async function recoverClient(client) {
  if (client.recoveryTask || stopping) return client.recoveryTask;
  client.recoveryTask = (async () => {
    for (let attempt = 0; attempt < 3 && !stopping; attempt++) {
      counters.automaticReconnectAttempts++;
      const delay = Math.min(4000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 300);
      await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await attachSocket(client, true);
        counters.automaticReconnectSuccesses++;
        return;
      } catch {
        counters.automaticReconnectFailures++;
      }
    }
  })().finally(() => { client.recoveryTask = null; });
  return client.recoveryTask;
}

async function createGuest(index) {
  const sessionResponse = await request('/api/session');
  if (!sessionResponse.ok) throw new Error('Guest session request returned HTTP ' + sessionResponse.status);
  counters.guestSessionsCreated++;
  const session = await sessionResponse.json();
  const sessionCookie = findSessionCookie(sessionResponse);
  const client = {
    index,
    cookie: sessionCookie.cookie,
    csrf: session.csrfToken,
    sequence: 0,
    connected: false,
    socket: null,
    recoveryTask: null,
    nextPingAt: 0,
    dynamicHttpRequests: 1
  };
  if (!client.cookie || !client.csrf) {
    counters.setupFailures++;
    counters.guestCleanupFailures++;
    throw new Error('Guest session response was incomplete');
  }
  clients.push(client);
  if (!sessionCookie.secure) counters.secureCookieFailures++;

  const profileResponse = await request('/api/profile', {
    method: 'POST',
    body: JSON.stringify({
      name: 'ITKLoad-' + String(index + 1).padStart(3, '0'),
      disc: 'powertrain'
    })
  }, client);
  if (!profileResponse.ok) throw new Error('Synthetic profile request returned HTTP ' + profileResponse.status);
  await profileResponse.arrayBuffer();
  await attachSocket(client, false);
  return client;
}

async function createBatch(start, end) {
  for (let offset = start; offset < end; offset += maxParallelSetups) {
    if (stopping) break;
    const upper = Math.min(end, offset + maxParallelSetups);
    const results = await Promise.allSettled(
      Array.from({ length: upper - offset }, (_, i) => createGuest(offset + i))
    );
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) {
      counters.setupFailures += failures.length;
      console.error('Stopped setup after ' + failures.length + ' client setup failure(s); details omitted.');
      return false;
    }
    if (upper < end) await new Promise(resolve => setTimeout(resolve, 500));
  }
  return !stopping;
}

function startMovement() {
  movementTimer = setInterval(() => {
    moveTick++;
    const now = Date.now();
    for (const client of clients) {
      if (!client.connected || client.socket?.readyState !== WebSocket.OPEN) continue;
      const seconds = moveTick / 10;
      const x = 0.22 * Math.sin(seconds * 0.8 + client.index * 0.07);
      sendJson(client, {
        type: 'move',
        seq: client.sequence++,
        x,
        z: 8.5,
        yaw: Math.PI
      });
      if (now >= client.nextPingAt) {
        if (sendJson(client, { type: 'ping', at: performance.now() })) client.nextPingAt = now + 5000;
      }
    }
  }, 100);
}

async function plannedReconnect(client) {
  if (!client.socket || client.socket.readyState === WebSocket.CLOSED) {
    counters.failedReconnects++;
    return false;
  }
  const socket = client.socket;
  counters.plannedReconnects++;
  client.plannedReconnecting = true;
  intentionalSockets.add(socket);
  try {
    await new Promise(resolve => {
      if (socket.readyState === WebSocket.CLOSED) return resolve();
      const timeout = setTimeout(() => {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
        resolve();
      }, 3000);
      socket.once('close', () => { clearTimeout(timeout); resolve(); });
      socket.close(1000, 'Planned staging load reconnect');
    });
    await attachSocket(client, true);
    return true;
  } catch {
    counters.failedReconnects++;
    return false;
  } finally {
    client.plannedReconnecting = false;
  }
}

async function runFiveReconnects(durationMs, signal) {
  const interval = Math.max(1000, Math.floor(durationMs / 10));
  for (let i = 0; i < 5 && !stopping && !signal.aborted; i++) {
    await delay(interval, signal);
    if (stopping || signal.aborted || clients[i] == null) return;
    await plannedReconnect(clients[i]);
  }
}

function healthy(expected, activity) {
  return !stopping &&
    connectedCount() === effectiveTargetCount(expected) &&
    counters.http429 === 0 &&
    counters.http5xx === 0 &&
    counters.webSocketHandshakeFailures === 0 &&
    counters.secureCookieFailures === 0 &&
    counters.webSocketUnexpectedDisconnects === 0 &&
    counters.failedReconnects === 0 &&
    activity.movementMessagesSent > 0 &&
    activity.movementDeltasReceived > 0 &&
    activity.pingSamples > 0;
}

async function runStage(name, expected, durationSeconds) {
  const start = Date.now();
  const latencyStart = latencies.length;
  const countersStart = {
    movementMessagesSent: counters.movementMessagesSent,
    movementDeltasReceived: counters.movementDeltasReceived,
    pingSamples: counters.pingSamples
  };
  console.log('Stage ' + name + ': checking ' + expected + ' connected clients for ' + durationSeconds + ' seconds.');
  const deadline = start + durationSeconds * 1000;
  while (!stopping && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (connectedCount() !== effectiveTargetCount(expected) || counters.http429 || counters.http5xx ||
        counters.webSocketHandshakeFailures || counters.webSocketUnexpectedDisconnects || counters.failedReconnects) {
      break;
    }
    if (Date.now() - start >= 10000 &&
        (counters.movementDeltasReceived === countersStart.movementDeltasReceived ||
         counters.pingSamples === countersStart.pingSamples)) break;
  }
  const activity = {
    movementMessagesSent: counters.movementMessagesSent - countersStart.movementMessagesSent,
    movementDeltasReceived: counters.movementDeltasReceived - countersStart.movementDeltasReceived,
    pingSamples: counters.pingSamples - countersStart.pingSamples
  };
  const result = {
    stage: name,
    targetClients: expected,
    elapsedSeconds: Number(((Date.now() - start) / 1000).toFixed(2)),
    connectedAtEnd: connectedCount(),
    healthy: healthy(expected, activity),
    latencyMs: latencySummary(latencies.slice(latencyStart)),
    ...activity,
    http429: counters.http429,
    http5xx: counters.http5xx,
    unexpectedDisconnects: counters.webSocketUnexpectedDisconnects,
    failedReconnects: counters.failedReconnects
  };
  console.log('Stage ' + name + ': ' + (result.healthy ? 'PASS' : 'STOP') + ', connected ' + result.connectedAtEnd + '/' + expected + '.');
  return result;
}

async function cleanupGuests() {
  stopping = true;
  if (movementTimer) clearInterval(movementTimer);
  for (const client of clients) {
    const socket = client.socket;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      intentionalSockets.add(socket);
      await new Promise(resolve => {
        const timeout = setTimeout(() => {
          if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
          resolve();
        }, 3000);
        socket.once('close', () => { clearTimeout(timeout); resolve(); });
        socket.close(1000, 'Staging load test cleanup');
      });
    }
  }
  await Promise.all(clients.map(async client => {
    try {
      const response = await request('/api/session', { method: 'DELETE' }, client);
      await response.arrayBuffer();
      if (response.status === 204) counters.guestCleanupSuccess++;
      else counters.guestCleanupFailures++;
    } catch {
      counters.guestCleanupFailures++;
    }
  }));
}

async function main() {
  const home = await fetch(GAME_ORIGIN + '/', { signal: AbortSignal.timeout(15000) });
  if (home.status !== 200) throw new Error('Staging frontend preflight returned HTTP ' + home.status);
  await home.arrayBuffer();

  console.log('Creating synthetic guest sessions on the fixed staging hostname only.');
  const firstOk = await createBatch(0, 5);
  if (!firstOk) return;
  startMovement();

  const stages = [];
  stages.push(await runStage('5 clients', 5, 30));
  report.stages = stages;
  if (!stages.at(-1).healthy) return;

  if (!await createBatch(5, 20)) return;
  stages.push(await runStage('20 clients', 20, 45));
  report.stages = stages;
  if (!stages.at(-1).healthy) return;

  if (!await createBatch(20, 70)) return;
  const reconnectSchedule = new AbortController();
  plannedReconnectTask = runFiveReconnects(finalSeconds * 1000, reconnectSchedule.signal);
  stages.push(await runStage('70 clients', 70, finalSeconds));
  report.stages = stages;
  if (!stages.at(-1).healthy) reconnectSchedule.abort();
  if (plannedReconnectTask) await plannedReconnectTask;

  report.completedAllStages = stages.length === 3 && stages.every(stage => stage.healthy) &&
    counters.plannedReconnects === 5 && counters.successfulReconnects >= 5;
  report.stages = stages;
}

const report = {
  at: new Date().toISOString(),
  target: GAME_ORIGIN,
  environment: 'external Windows/Node client to public staging Worker, Tunnel, and Oracle backend',
  final70ClientDurationSeconds: finalSeconds,
  configuredMaximumDurationSeconds: 1800,
  usage: 'Synthetic guests and movement only. No mission answers are sent. No credentials, cookies, player IDs, or message bodies are written to the report.',
  stages: [],
  counters,
  latencyMs: null,
  estimatedWorkerRequests: null,
  cleanupVerified: false
};

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

let thrown = null;
try {
  await main();
} catch {
  thrown = 'Runner stopped after a network or setup error; response bodies and credentials were intentionally omitted.';
} finally {
  await cleanupGuests();
  report.at = new Date().toISOString();
  report.counters = counters;
  report.latencyMs = latencySummary(latencies);
  report.estimatedWorkerRequests = counters.dynamicHttpRequests + counters.webSocketHandshakes;
  report.cleanupVerified = clients.length === counters.guestCleanupSuccess &&
    counters.guestSessionsCreated === clients.length && counters.guestCleanupFailures === 0;
  report.completedAllStages = report.completedAllStages === true && !thrown && !stopping;
  report.status = report.completedAllStages ? 'PASS' : (stopping ? 'INTERRUPTED' : 'INCOMPLETE');
  if (thrown) report.runnerError = thrown;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    status: report.status,
    stages: report.stages,
    latencyMs: report.latencyMs,
    counters: report.counters,
    estimatedWorkerRequests: report.estimatedWorkerRequests,
    cleanupVerified: report.cleanupVerified,
    reportPath: outputPath,
    runnerError: report.runnerError || null
  }, null, 2));
  if (!report.completedAllStages || !report.cleanupVerified) process.exitCode = 1;
}
