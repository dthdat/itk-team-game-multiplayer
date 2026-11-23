const HOP_BY_HOP = ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'];

function fail(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const dynamic = url.pathname === '/ws' || url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (!dynamic) return env.ASSETS.fetch(request);
    if (url.pathname === '/ws' && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail(426, 'WebSocket upgrade required');
    if (!env.ORIGIN_BASE || !env.GAME_PROXY_SECRET || !env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) return fail(503, 'Game service is not configured');
    let origin;
    try { origin = new URL(env.ORIGIN_BASE); } catch { return fail(503, 'Game service is not configured'); }
    if (origin.protocol !== 'https:' && !(env.ENVIRONMENT === 'local' && origin.hostname === '127.0.0.1')) return fail(503, 'Game service must use HTTPS');
    const target = new URL(url.pathname + url.search, origin);
    const isWebSocket=url.pathname==='/ws';
    const headers = new Headers(request.headers);
    for (const name of HOP_BY_HOP) headers.delete(name);
    for (const name of ['host','x-game-proxy-auth','x-game-client-ip','cf-access-client-id','cf-access-client-secret','x-forwarded-host','x-forwarded-for']) headers.delete(name);
    if(isWebSocket)headers.set('Upgrade','websocket');
    headers.set('x-game-proxy-auth', env.GAME_PROXY_SECRET);
    headers.set('x-game-client-ip', request.headers.get('CF-Connecting-IP') || 'unknown');
    headers.set('cf-access-client-id', env.CF_ACCESS_CLIENT_ID);
    headers.set('cf-access-client-secret', env.CF_ACCESS_CLIENT_SECRET);
    let upstream;
    try {
      upstream = await fetch(new Request(target, { method:request.method, headers, body:['GET','HEAD'].includes(request.method)?undefined:request.body, redirect:'manual' }));
    } catch {
      return fail(502, 'Game service is temporarily unavailable');
    }
    const cookies=upstream.headers.getSetCookie?.()||[];
    const responseHeaders = new Headers(upstream.headers);
    for(const name of HOP_BY_HOP)responseHeaders.delete(name);
    responseHeaders.delete('set-cookie');
    for(const value of cookies){
      const separator=value.indexOf('=');
      const cookieName=separator<0?'':value.slice(0,separator).trim().toLowerCase();
      if(cookieName!=='cf_authorization')responseHeaders.append('set-cookie',value);
    }
    responseHeaders.set('cache-control','no-store');
    responseHeaders.set('x-content-type-options','nosniff');
    if (upstream.status===101 && upstream.webSocket) return new Response(null,{status:101,webSocket:upstream.webSocket});
    return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders});
  }
};
