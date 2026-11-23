import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare-game/src/worker.js';

test('Cloudflare Worker preserves game cookies but never forwards the Access authorization cookie',async()=>{
  let response=await worker.fetch(new Request('https://game.itkvn.workers.dev/api/session'),{});
  assert.equal(response.status,503);
  response=await worker.fetch(new Request('https://game.itkvn.workers.dev/ws'),{});
  assert.equal(response.status,426);
  let assetRequest;
  response=await worker.fetch(new Request('https://game.itkvn.workers.dev/phase3-ui.js'),{ASSETS:{fetch:async req=>{assetRequest=req;return new Response('asset',{status:200});}}});
  assert.equal(await response.text(),'asset');assert.equal(new URL(assetRequest.url).pathname,'/phase3-ui.js');

  const originalFetch=globalThis.fetch,secret='local-only-proxy-secret-0123456789';let upstreamRequest;
  globalThis.fetch=async req=>{
    upstreamRequest=req;
    const headers=new Headers({'content-type':'application/json'});headers.append('set-cookie','pw_account=opaque-one; Path=/; HttpOnly; Secure; SameSite=Strict');headers.append('set-cookie','pw_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');headers.append('set-cookie','CF_Authorization=synthetic-access-cookie; Path=/; Secure; SameSite=None');
    return new Response('{"ok":true}',{status:200,headers});
  };
  try{
    const request=new Request('https://game.itkvn.workers.dev/api/session?refresh=1',{headers:{cookie:'pw_account=opaque-one','origin':'https://game.itkvn.workers.dev','authorization':'Bearer browser-user-token','x-game-proxy-auth':'forged','x-game-client-ip':'spoofed','x-forwarded-for':'spoofed','cf-access-client-id':'forged','cf-access-client-secret':'forged'}});
    request.headers.set('CF-Connecting-IP','203.0.113.8');
    response=await worker.fetch(request,{ORIGIN_BASE:'https://api.example.invalid',GAME_PROXY_SECRET:secret,CF_ACCESS_CLIENT_ID:'service-id',CF_ACCESS_CLIENT_SECRET:'service-secret'});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(response.headers.getSetCookie(),[
      'pw_account=opaque-one; Path=/; HttpOnly; Secure; SameSite=Strict',
      'pw_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict'
    ]);
    assert.equal(new URL(upstreamRequest.url).pathname,'/api/session');assert.equal(new URL(upstreamRequest.url).search,'?refresh=1');
    assert.equal(upstreamRequest.headers.get('cookie'),'pw_account=opaque-one');
    assert.equal(upstreamRequest.headers.get('origin'),'https://game.itkvn.workers.dev');
    assert.equal(upstreamRequest.headers.get('authorization'),'Bearer browser-user-token');
    assert.equal(upstreamRequest.headers.get('x-game-proxy-auth'),secret);
    assert.equal(upstreamRequest.headers.get('x-game-client-ip'),'203.0.113.8');
    assert.equal(upstreamRequest.headers.get('cf-access-client-id'),'service-id');
    assert.equal(upstreamRequest.headers.get('cf-access-client-secret'),'service-secret');
    assert.equal(upstreamRequest.headers.get('x-forwarded-for'),null);
  }finally{globalThis.fetch=originalFetch;}
});

test('Cloudflare Worker forwards an authenticated WebSocket upgrade request',async()=>{
  const originalFetch=globalThis.fetch,secret='local-only-proxy-secret-0123456789';let upstreamRequest;
  globalThis.fetch=async req=>{
    upstreamRequest=req;
    return new Response('origin rejected test socket',{status:502});
  };
  try{
    const request=new Request('https://game-staging.itkvn.workers.dev/ws?room=engineering',{
      headers:{connection:'Upgrade',upgrade:'websocket',cookie:'pw_account=opaque-session','origin':'https://game-staging.itkvn.workers.dev','x-game-proxy-auth':'forged','cf-access-client-id':'forged','cf-access-client-secret':'forged'}
    });
    const response=await worker.fetch(request,{
      ENVIRONMENT:'staging',ORIGIN_BASE:'https://api-staging.example.invalid',
      GAME_PROXY_SECRET:secret,CF_ACCESS_CLIENT_ID:'staging-service-id',CF_ACCESS_CLIENT_SECRET:'staging-service-secret'
    });
    assert.equal(response.status,502);
    assert.equal(new URL(upstreamRequest.url).pathname,'/ws');
    assert.equal(new URL(upstreamRequest.url).search,'?room=engineering');
    assert.equal(upstreamRequest.headers.get('upgrade'),'websocket');
    assert.equal(upstreamRequest.headers.get('cookie'),'pw_account=opaque-session');
    assert.equal(upstreamRequest.headers.get('origin'),'https://game-staging.itkvn.workers.dev');
    assert.equal(upstreamRequest.headers.get('x-game-proxy-auth'),secret);
    assert.equal(upstreamRequest.headers.get('cf-access-client-id'),'staging-service-id');
    assert.equal(upstreamRequest.headers.get('cf-access-client-secret'),'staging-service-secret');
  }finally{globalThis.fetch=originalFetch;}
});
