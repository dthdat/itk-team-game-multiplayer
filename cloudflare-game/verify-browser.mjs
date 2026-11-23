import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const target=process.env.TEST_URL||'http://127.0.0.1:8787/';
const reportName=process.env.REPORT_NAME||'browser';
const targetURL=new URL(target);
const base=targetURL.href.endsWith('/')?targetURL.href:targetURL.href+'/';
const output=new URL('./verification/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const errors=[],consoleErrors=[],failures=[],requests=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)failures.push({url:r.url(),status:r.status()});});
 page.on('request',r=>requests.push(r.url()));
 // Test-only introspection of the existing closure; never written into shipped HTML.
 await page.route('**/*',async route=>{
   if(route.request().url()===base){
     const response=await route.fetch();
     const html=(await response.text()).replace('initService();\n})();', 'window.__gameQA={scene,gl,P,MISSIONS,npcs,openMission,isLocked,state};\ninitService();\n})();');
     await route.fulfill({response,body:html});
   }else await route.continue();
 });
 await page.goto(base);
 await page.locator('#name-in').fill('Cloudflare QA');
 await page.locator('.disc').first().click();
 await page.locator('#clockin').click();
 await page.locator('#hud').waitFor({state:'visible'});
 await page.waitForTimeout(1500);
 const world=await page.evaluate(()=>{const q=window.__gameQA;let meshes=0;q.scene.traverse(o=>{if(o.isMesh)meshes++;});return {three:THREE.REVISION,meshes,npcs:q.npcs.length,drawCalls:q.gl.info.render.calls,triangles:q.gl.info.render.triangles,missions:q.MISSIONS.length,allUnlocked:q.MISSIONS.every(m=>!q.isLocked(m)),position:{...q.P}};});
 assert.equal(world.missions,8);assert(world.allUnlocked);assert(world.meshes>100);assert(world.npcs>0);assert(world.drawCalls>0);assert(world.triangles>0);
 await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.up('w');
 const after=await page.evaluate(()=>({...window.__gameQA.P}));
 assert(Math.hypot(after.x-world.position.x,after.z-world.position.z)>0.05);
 await page.screenshot({path:new URL(`${reportName}-office.png`,output).pathname});
 await page.locator('#logbtn').click();assert.equal(await page.locator('#l-list li').count(),8);await page.locator('#l-close').click();
 const missions=[];
 for(let i=0;i<8;i++){
   await page.evaluate(i=>window.__gameQA.openMission(window.__gameQA.MISSIONS[i]),i);
   assert(await page.locator('#mission').isVisible());
   const english=await page.locator('#m-title').innerText();
   await page.locator('#m-lang').click();const vietnamese=await page.locator('#m-title').innerText();assert.notEqual(english,vietnamese);
   await page.locator('#m-lang').click();assert.equal(await page.locator('#m-title').innerText(),english);
   missions.push({english,vietnamese});await page.locator('#m-close').click();
 }
 await page.evaluate(()=>window.__gameQA.openMission(window.__gameQA.MISSIONS[0]));
 await page.locator('#m-text').fill('A fictional engineering prompt to verify that disconnected grading is reported honestly and never awards XP.');
 await page.locator('#m-submit').click();await page.locator('#toast').filter({hasText:'Grading unavailable'}).waitFor();
 assert.equal(await page.evaluate(()=>window.__gameQA.state.progress.xp),0);
 await page.screenshot({path:new URL(`${reportName}-mission.png`,output).pathname});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
 const mobile=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,sheet:document.querySelector('#mission .sheet').scrollWidth,sheetClient:document.querySelector('#mission .sheet').clientWidth}));
 assert(mobile.document<=mobile.viewport&&mobile.sheet<=mobile.sheetClient);
 await page.screenshot({path:new URL(`${reportName}-mobile.png`,output).pathname});
 const report={at:new Date().toISOString(),target:base,world,movement:true,missionLanguageChecks:missions,mobile,errors,consoleErrors,failures,backendRequests:requests.filter(u=>/\/api\/|\/ws(?:$|\?)/.test(u)),grading:'Unavailable; explicit message; zero XP',multiplayer:'Disconnected; no peers or backend simulated'};
 await writeFile(new URL(`${reportName}.json`,output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 assert.equal(errors.length,0);assert.equal(failures.filter(f=>f.url.startsWith(targetURL.origin)).length,0);assert.equal(report.backendRequests.length,0);
}finally{await browser.close();}
