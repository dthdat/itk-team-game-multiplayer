import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
let html = await readFile(new URL('index.html', root), 'utf8');
function replaceOnce(before, after) {
  if (html.split(before).length !== 2) throw new Error(`Source changed: expected one match for ${before.slice(0, 70)}`);
  html = html.replace(before, after);
}
replaceOnce('<script src="/vendor/three.min.js"></script>', '<script src="/game-config.js"></script>\n<script src="/vendor/three.min.js"></script>');
replaceOnce('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' __SCRIPT_HASHES__; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com data:; img-src \'self\' data: blob:; connect-src \'self\' ws: wss:; object-src \'none\'; base-uri \'self\'; form-action \'self\'">');
replaceOnce('</body></html>', '<script src="/phase3-ui.js"></script>\n</body></html>');
replaceOnce("const STORE='apex-prompt-works-v1';", `const STORE='itk-cloudflare-preview-v1';
const config=window.ITK_GAME_CONFIG||{};
const frontendOnly=config.serviceEnabled!==true;
const backend=new URL(config.backendOrigin||location.origin);
if(backend.origin!==location.origin && backend.protocol!=='https:')throw new Error('Backend must use HTTPS');
if(backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw new Error('Configure a backend origin only');
const previewNotice='Frontend preview: multiplayer and grading are disconnected. No XP is awarded. All eight mission briefs are open for testing.';`);
replaceOnce("const state={playing:false,modal:false,disc:null,done:{},progress:{xp:0,passed:0,rank:'Trainee',done:{}},drafts:{},name:'',csrf:'',provider:'mock',sessionReady:false,connected:false,socket:null};", "const state={playing:false,modal:false,disc:null,done:{},progress:{xp:0,passed:0,rank:'Trainee',done:{}},drafts:{},submissions:[],name:'',csrf:'',provider:'disabled',sessionReady:false,connected:false,socket:null};");
replaceOnce("\nconst MISSIONS=AP.MISSIONS", "\nwindow.ITK_SESSION_PROMISE=frontendOnly?Promise.resolve(null):api('/api/session').then(data=>{window.ITK_SESSION_DATA=data;return data;});\nconst MISSIONS=AP.MISSIONS");
replaceOnce('byId[m.id]=m;m.n=i+1;', 'byId[m.id]=m;m.n=i+1;m.rubric.forEach((criterion,index)=>{criterion.id=`c${index+1}`;});');
replaceOnce('const totalXp=()=>state.progress.xp||0;', 'window.ITK_GAME_TRANSLATIONS=VI;\nconst totalXp=()=>state.progress.xp||0;');
const templateHistory=JSON.parse(await readFile(new URL('mission-template-history.json', import.meta.url),'utf8'));
const templates=JSON.parse(await readFile(new URL('mission-templates.json', import.meta.url),'utf8'));
replaceOnce('function openMission(m){', 'function openMission(m){reviewSelection++;activeReview=null;lastR=null;window.ITK_LAST_SUBMISSION=\'\';');
replaceOnce('function paintMission(m){',`const BRAINSTORM_TEMPLATES=${JSON.stringify(templates).replaceAll('<','\\u003c')};
const OLD_BRAINSTORM_TEMPLATES=${JSON.stringify(templateHistory).replaceAll('<','\\u003c')};
function brainstormTemplate(m){return BRAINSTORM_TEMPLATES[m.id]?.[mLang]||'';}
function untouchedTemplate(m,text){return [...Object.values(BRAINSTORM_TEMPLATES[m.id]||{}),...Object.values(OLD_BRAINSTORM_TEMPLATES[m.id]||{})].some(value=>value.trim()===text.trim());}
function paintMission(m){
  const area=$('#m-text');if(untouchedTemplate(m,area.value)){area.value=brainstormTemplate(m);updateWords();}
  $('#review-privacy').textContent=state.provider==='groq'?(mLang==='vi'?'Khi nộp, bài của bạn sẽ được gửi đến Groq để AI chấm. Không đưa thông tin cá nhân hoặc bí mật. Phản hồi AI có thể chưa chính xác. XP do máy chủ xác minh.':'Submitting sends your answer to Groq for AI review. Do not include personal or confidential information. AI feedback may be imperfect. XP is validated by the server.'):(mLang==='vi'?'Chấm AI tạm thời không khả dụng. Bài được lưu và chưa có XP.':'AI grading is unavailable. Answers are saved; no XP is awarded.');
  area.placeholder=mLang==='vi'?'Điền các phần trong ngoặc bằng ý tưởng của bạn.':'Fill the bracketed sections with your own ideas.';
  $('#m-starter').textContent=mLang==='vi'?'Dùng mẫu gợi ý':'Use template';`);
replaceOnce("const ta=$('#m-text');ta.value=state.drafts[m.id]||'';","const ta=$('#m-text');ta.value=Object.hasOwn(state.drafts,m.id)&&!untouchedTemplate(m,state.drafts[m.id])?state.drafts[m.id]:brainstormTemplate(m);");
replaceOnce("$('#m-starter').hidden=!m.starter;","$('#m-starter').hidden=false;");
replaceOnce("if(!ta.value.trim()){ta.value=cur.starter;}else{ta.value=ta.value+'\\n'+cur.starter;}","if(ta.value.trim()&&!untouchedTemplate(cur,ta.value)){toast(mLang==='vi'?'Bản nháp được giữ lại. Xóa ô nhập trước khi chèn mẫu mới.':'Your draft is kept. Clear the box first to insert a new template.');return;}ta.value=brainstormTemplate(cur);");
replaceOnce("const raw=$('#m-text').value;","const selection=reviewSelection;const raw=$('#m-text').value;if(untouchedTemplate(m,raw)){toast(mLang==='vi'?'Điền mẫu bằng ý tưởng của bạn trước khi nộp.':'Fill the template with your own ideas before submitting.');return;}");
replaceOnce("$('#m-result').hidden=true;","$('#m-result').hidden=true;reviewSelection++;activeReview=null;lastR=null;window.ITK_LAST_SUBMISSION='';$('#r-list').textContent='';window.ITK_REVIEW_OUTPUT?.clear(mLang);");
replaceOnce("button.disabled=true;button.textContent='Reviewing…';","button.disabled=true;button.textContent='Reviewing…';activeReview=null;lastR=null;window.ITK_LAST_SUBMISSION='';$('#r-score').textContent='—';$('#m-result').hidden=true;window.ITK_REVIEW_OUTPUT?.clear(mLang);");
replaceOnce("const data=await api('/api/review',{submissionId:crypto.randomUUID(),missionId:m.id,answer:raw});", `const data=await api('/api/submissions',{submissionId:crypto.randomUUID(),missionId:m.id,answer:raw,locale:mLang,aiConsent:state.provider==='groq'});
    if(cur?.id!==m.id||selection!==reviewSelection)return;
    if(data.state){window.ITK_LAST_SUBMISSION=data.submissionId;window.ITK_LAST_SUBMISSION_DUPLICATE=!!data.duplicate;$('#r-score').textContent='—';$('#r-verdict').textContent=mLang==='vi'?'Đang chờ chấm AI':'Pending AI review';$('#r-xp').textContent=mLang==='vi'?'Chưa có XP được trao.':'No XP awarded yet.';$('#r-summary').textContent=state.provider==='groq'?(mLang==='vi'?'Đã lưu và xếp hàng chấm bằng Groq. Bạn có thể tiếp tục khám phá.':'Saved and queued for Groq review. You can keep exploring.'):(mLang==='vi'?'Chấm AI tạm thời không khả dụng. Bài nộp đã được lưu.':'AI grading is unavailable. Your submission is saved.');$('#r-list').textContent='';$('#r-ref').textContent='';$('#m-result').hidden=false;button.textContent=mLang==='vi'?'Nộp lại':'Submit again';if(data.gradingEnabled||data.state==='graded')window.ITK_TRACK_SUBMISSION?.(data.submissionId);return;}`);
const originalRenderer=html.slice(html.indexOf('function renderResult(m,r){'),html.indexOf("$('#m-lang').addEventListener('click'"));
replaceOnce(originalRenderer,`function renderResult(m,r){
  const vi=mLang==='vi',v=vi?VI[m.id]:null,ul=$('#r-list');ul.textContent='';
  r.items.forEach((it,i)=>{
    const li=document.createElement('li');li.className=it.ok?'ok':'bad';li.dataset.criterionId=it.id;
    const tag=document.createElement('span');tag.className='tag';tag.textContent=it.ok?'PASS':'FIX';
    const d=document.createElement('div'),b=document.createElement('b');b.textContent=it.id+' · '+(v?v.rubric[i][0]:it.label);d.appendChild(b);
    const add=(className,text)=>{const p=document.createElement('p');p.className=className;p.textContent=text;d.appendChild(p);};
    add('review-feedback',it.tip);
    if(it.evidence)add('review-evidence',(vi?'Bằng chứng: ':'Evidence: ')+it.evidence);
    if(!it.ok&&it.improvement)add('review-improvement',(vi?'Gợi ý sửa: ':'Suggested change: ')+it.improvement);
    li.append(tag,d);ul.appendChild(li);
  });
}
`);
replaceOnce('let lastR=null;', `let activeReview=null,reviewSelection=0;
function renderActiveReview(){
  if(!activeReview||cur?.id!==activeReview.submission.missionId)return;
  const {submission:s,progress}=activeReview,vi=mLang==='vi';
  if(s.state!=='graded'){
    lastR=null;$('#r-score').textContent='—';$('#r-list').textContent='';$('#r-ref').textContent='';
    window.ITK_REVIEW_OUTPUT?.status(s.state,mLang);
    $('#r-verdict').textContent=s.state==='failed'?(vi?'Không thể chấm bài':'Review unavailable'):(s.state==='reviewing'?(vi?'Đang chấm bài':'Reviewing'):(vi?'Đang chờ chấm AI':'Pending AI review'));
    $('#r-xp').textContent=vi?'Chưa có XP mới được trao.':'No new XP awarded.';
    $('#r-summary').textContent=s.errorCode==='answer_too_long'?(vi?'Hãy rút ngắn bài để phù hợp giới hạn chấm miễn phí.':'Please shorten the answer to fit the Free review limit.'):(s.errorCode==='quota_wait'?(vi?'Đã lưu. Đang chờ hạn mức AI miễn phí; sẽ tự thử lại.':'Saved. Waiting for the Free AI allowance; review will retry automatically.'):(vi?'Bài đã được lưu. Chưa có kết quả chấm hợp lệ.':'Your answer is saved. No validated review is available yet.'));
    $('#m-result').hidden=false;return;
  }
  let review;try{review=JSON.parse(s.result);}catch{return;}
  const reused=activeReview.reused;
  window.ITK_REVIEW_OUTPUT?.show(review,s,mLang,reused);
  const passed=review.items.filter(it=>it.passed).length;
  $('#r-score').textContent=review.score+'%';$('#r-verdict').textContent=review.short?(vi?'Bài quá ngắn':'Answer too short'):(review.score>=AP.PASS?(vi?'Đạt yêu cầu':'Passes review'):(vi?'Cần chỉnh sửa':'Needs revision'));
  const best=progress?.done?.[cur.id]?.score;
  $('#r-xp').textContent=(s.xp>0&&!reused?'+'+s.xp+' XP':vi?'Không có XP mới':'No additional XP')+(Number.isFinite(best)?(vi?' · Điểm tốt nhất: ':' · Best saved score: ')+best+'%':'');
  $('#r-summary').textContent=review.verified?(vi?passed+'/'+review.items.length+' tiêu chí đạt. Xem các mục FIX bên dưới.':passed+' of '+review.items.length+' criteria passed. Review any FIX items below.'):review.summary;
  lastR={score:review.score,items:cur.rubric.map(c=>{const item=review.items.find(r=>r.criterionId===c.id);return {id:c.id,label:c.label,tip:item?.feedback||(vi?'Không có phản hồi đã lưu.':'No saved feedback available.'),evidence:item?.evidence,improvement:item?.improvement,ok:!!item?.passed};}),short:review.short};
  renderResult(cur,lastR);$('#m-result').hidden=false;$('#r-ref').textContent=cur.ref;
}
window.addEventListener('itk-ai-review',event=>{
  const {submission:s,progress}=event.detail;applyProgress(progress);refreshHud();refreshMarkers();
  if(!cur||cur.id!==s.missionId||window.ITK_LAST_SUBMISSION!==s.submissionId)return;
  activeReview={submission:s,progress,reused:window.ITK_LAST_SUBMISSION_DUPLICATE};renderActiveReview();
});
window.ITK_OPEN_REVIEW=(submission,progress)=>{const mission=byId[submission.missionId];if(!mission)return;mLang=submission.locale==='vi'?'vi':'en';openMission(mission);if(submission.answer)$('#m-text').value=submission.answer;updateWords();window.ITK_LAST_SUBMISSION=submission.submissionId;window.ITK_LAST_SUBMISSION_DUPLICATE=true;window.dispatchEvent(new CustomEvent('itk-ai-review',{detail:{submission,progress}}));};
let lastR=null;`);
replaceOnce("if(lastR&&!$('#m-result').hidden)renderResult(cur,lastR);","if(activeReview&&!$('#m-result').hidden)renderActiveReview();");
replaceOnce("save();updateWords();});", "save();updateWords();if(activeReview)renderActiveReview();});");
replaceOnce("  const verb=method||(body?'POST':'GET');", `  if(frontendOnly){
    if(path==='/api/review'||path==='/api/submissions')throw new Error('Grading unavailable: Oracle backend is not connected. Your draft is saved locally.');
    if(path==='/api/session' && method==='DELETE')return {};
    if(path==='/api/profile')return {profile:{name:body.name,disc:body.disc},progress:state.progress};
    if(path==='/api/reset')return {progress:null};
    throw new Error('Backend is not connected');
  }
  const verb=method||(body?'POST':'GET');`);
replaceOnce("fetch(path,{method:verb,credentials:'same-origin'", "fetch(new URL(path,backend),{method:verb,credentials:'include'");
replaceOnce('const isLocked=m=>!!m.needs&&passedCount()<m.needs;', 'const isLocked=m=>false;');
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
replaceOnce("const data=await api('/api/session');", "const data=await window.ITK_SESSION_PROMISE;if(!data)throw new Error('Backend is not connected');");
replaceOnce("state.csrf=data.csrfToken;state.provider=data.grading.provider;state.sessionReady=true;applyProgress(data.progress);", "state.csrf=data.csrfToken;state.provider=data.grading.provider;state.submissions=data.submissions||[];state.sessionReady=true;applyProgress(data.progress);");
replaceOnce("$('#review-privacy').textContent=state.provider==='mock'?'Mock mode: answers are not sent to an AI provider and do not earn XP.':'Live mode: your answer is sent to Groq for review. Do not include personal or confidential information.';", "$('#review-privacy').textContent=state.provider==='groq'?'Submitting sends your answer to Groq for AI review. Do not include personal or confidential information. AI feedback may be imperfect. XP is awarded only after server validation.':'AI grading is unavailable. Answers are saved as pending; no XP is awarded.';");
replaceOnce("function makeAvatar(player){\n  const color=discById[player.disc]?.color||'#546574',g=new THREE.Group();", "function makeAvatar(player){\n  const color=player.avatar?.color||discById[player.disc]?.color||'#546574',g=new THREE.Group();");
replaceOnce("cyl(0.2,0.23,0.6,color,0,0.8,0,{parent:g});\n  const head=", "cyl(0.2,0.23,0.6,color,0,0.8,0,{parent:g});\n  if(player.avatar?.style==='vest')box(0.38,0.12,0.225,'#f0c344',0,0.78,0,{parent:g});\n  const head=");
replaceOnce("head.position.y=1.25;g.add(head);", "head.position.y=1.25;g.add(head);if(player.avatar?.style==='helmet'){const helmet=new THREE.Mesh(new THREE.SphereGeometry(0.17,16,10,0,Math.PI*2,0,Math.PI/2),mat('#e3a008'));helmet.position.y=1.36;g.add(helmet);}");
replaceOnce("if(message.player.id===myId&&message.progress){applyProgress(message.progress);refreshHud();refreshMarkers();}","if(message.player.id===myId&&message.progress){applyProgress(message.progress);refreshHud();refreshMarkers();window.dispatchEvent(new Event('itk-review-refresh'));}");
replaceOnce("toast('Walk to the glowing marker at reception to begin.');", "toast(frontendOnly?previewNotice:'Walk to the glowing marker at reception to begin.');");
replaceOnce("myId=message.you;applyProgress(message.progress);", "myId=message.you;window.dispatchEvent(new Event('itk-review-refresh'));if(message.self){P.x=message.self.x;P.z=message.self.z;P.yaw=freshShift?0:message.self.yaw;freshShift=false;lastX=-99;lastZ=-99;lastYaw=-99;}applyProgress(message.progress);");
await mkdir(new URL('public/vendor/', import.meta.url), { recursive: true });
await writeFile(new URL('public/game-config.js', import.meta.url), `// Public config only.\nwindow.ITK_GAME_CONFIG=Object.freeze({serviceEnabled:${process.env.PHASE3_SERVICE_ENABLED==='1'},backendOrigin:''});\n`);
await copyFile(new URL('node_modules/three/build/three.min.js', root), new URL('public/vendor/three.min.js', import.meta.url));
await copyFile(new URL('node_modules/three/LICENSE', root), new URL('public/vendor/three.LICENSE.txt', import.meta.url));
await copyFile(new URL('phase3-ui.js', import.meta.url), new URL('public/phase3-ui.js', import.meta.url));
const inlineScripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match=>!/\bsrc\s*=/i.test(match[1])).map(match=>match[2]);
if(inlineScripts.length!==2)throw new Error(`Expected two pinned inline game scripts; found ${inlineScripts.length}`);
const scriptHashes=inlineScripts.map(script=>`'sha256-${createHash('sha256').update(script).digest('base64')}'`).join(' ');
html=html.replace('__SCRIPT_HASHES__',scriptHashes);
await writeFile(new URL('public/index.html', import.meta.url), html);
console.log('Prepared actual frontend, configuration and Three.js 0.128.0; original source unchanged.');
