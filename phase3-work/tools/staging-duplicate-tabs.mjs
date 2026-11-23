import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const context=await browser.newContext();let first;
try{
  await context.addInitScript(()=>{window.__socketCloses=[];window.__socketOpens=0;const Native=WebSocket;window.WebSocket=new Proxy(Native,{construct(Target,args){const ws=Reflect.construct(Target,args);ws.addEventListener('open',()=>window.__socketOpens++);ws.addEventListener('close',event=>window.__socketCloses.push(event.code));return ws;}});});
  first=await context.newPage();await first.goto('https://game-staging.itkvn.workers.dev/');await first.waitForFunction(()=>window.ITK_SESSION_DATA);
  await first.evaluate(async()=>{const r=await fetch('/api/profile',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':window.ITK_SESSION_DATA.csrfToken},body:JSON.stringify({name:'Tab Network Probe',disc:'powertrain'})});if(!r.ok)throw new Error('Profile failed');});
  await first.reload();await first.waitForFunction(()=>!document.querySelector('#clockin').disabled);await first.locator('#clockin').click();await first.waitForFunction(()=>document.querySelector('#net-status').textContent==='Online');
  const second=await context.newPage();await second.goto('https://game-staging.itkvn.workers.dev/');await second.waitForFunction(()=>!document.querySelector('#clockin').disabled);await second.locator('#clockin').click();
  await second.waitForTimeout(7000);
  const read=page=>page.evaluate(()=>({opens:window.__socketOpens,closeCodes:window.__socketCloses,status:document.querySelector('#net-status').textContent,ping:document.querySelector('#net-latency')?.textContent}));
  const report={at:new Date().toISOString(),first:await read(first),second:await read(second)};
  const fixed=process.env.EXPECT_FIXED==='1';
  await writeFile('reports/staging-duplicate-tabs-'+(fixed?'after':'before')+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  if(fixed){assert.deepEqual(report.first.closeCodes,[4001]);assert.equal(report.first.opens,1);assert.equal(report.second.opens,1);assert.equal(report.second.status,'Online');assert.equal(report.first.status,'Active in another tab');assert.match(report.second.ping,/^\d+ ms$/);}
  else assert(report.first.closeCodes.filter(c=>c===4001).length>1,'reproduce automatic retry fighting between duplicate tabs');
}finally{
  if(first)await first.evaluate(async()=>{if(window.ITK_SESSION_DATA)await fetch('/api/session',{method:'DELETE',headers:{'x-csrf-token':window.ITK_SESSION_DATA.csrfToken}});}).catch(()=>{});
  await context.close();await browser.close();
}
