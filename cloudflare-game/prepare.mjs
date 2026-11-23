import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
let html = await readFile(new URL('index.html', root), 'utf8');
function replaceOnce(before, after) {
  if (html.split(before).length !== 2) throw new Error(`Source changed: expected one match for ${before.slice(0, 70)}`);
  html = html.replace(before, after);
}
replaceOnce('<script src="/vendor/three.min.js"></script>', '<script src="/game-config.js"></script>\n<script src="/vendor/three.min.js"></script>');
replaceOnce("const STORE='apex-prompt-works-v1';", `const STORE='itk-cloudflare-preview-v1';
const config=window.ITK_GAME_CONFIG||{};
const frontendOnly=config.serviceEnabled!==true;
const backend=new URL(config.backendOrigin||location.origin);
if(backend.origin!==location.origin && backend.protocol!=='https:')throw new Error('Backend must use HTTPS');
if(backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw new Error('Configure a backend origin only');
const previewNotice='Frontend preview: multiplayer and grading are disconnected. No XP is awarded. All eight mission briefs are open for testing.';`);
replaceOnce("  const verb=method||(body?'POST':'GET');", `  if(frontendOnly){
    if(path==='/api/review')throw new Error('Grading unavailable: Oracle backend is not connected. Your draft is saved locally.');
    if(path==='/api/session' && method==='DELETE')return {};
    if(path==='/api/profile')return {profile:{name:body.name,disc:body.disc},progress:state.progress};
    if(path==='/api/reset')return {progress:null};
    throw new Error('Backend is not connected');
  }
  const verb=method||(body?'POST':'GET');`);
replaceOnce("fetch(path,{method:verb,credentials:'same-origin'", "fetch(new URL(path,backend),{method:verb,credentials:'include'");
replaceOnce('const isLocked=m=>!!m.needs&&passedCount()<m.needs;', 'const isLocked=m=>!frontendOnly&&!!m.needs&&passedCount()<m.needs;');
replaceOnce("  if(!state.sessionReady||!state.playing||state.socket&&state.socket.readyState<2)return;", "  if(frontendOnly){setNetworkStatus('Frontend preview · offline',false);return;}\n  if(!state.sessionReady||!state.playing||state.socket&&state.socket.readyState<2)return;");
replaceOnce("const scheme=location.protocol==='https:'?'wss:':'ws:';", "const scheme=backend.protocol==='https:'?'wss:':'ws:';");
replaceOnce('${scheme}//${location.host}/ws', '${scheme}//${backend.host}/ws');
replaceOnce('async function initService(){\n  try{', `async function initService(){
  if(frontendOnly){
    state.sessionReady=true;state.provider='disconnected';
    $('#review-privacy').textContent=previewNotice;
    const notice=document.createElement('p');notice.textContent=previewNotice;notice.style.cssText='padding:12px;border:1px solid #777;border-radius:8px';
    $('#clockin').before(notice);
    setNetworkStatus('Frontend preview · offline',false);buildDiscs();refreshHud();refreshMarkers();refreshClock();return;
  }
  try{`);
replaceOnce("toast('Walk to the glowing marker at reception to begin.');", "toast(frontendOnly?previewNotice:'Walk to the glowing marker at reception to begin.');");
await mkdir(new URL('public/vendor/', import.meta.url), { recursive: true });
await writeFile(new URL('public/index.html', import.meta.url), html);
await copyFile(new URL('node_modules/three/build/three.min.js', root), new URL('public/vendor/three.min.js', import.meta.url));
await copyFile(new URL('node_modules/three/LICENSE', root), new URL('public/vendor/three.LICENSE.txt', import.meta.url));
console.log('Prepared actual frontend, configuration and Three.js 0.128.0; original source unchanged.');
