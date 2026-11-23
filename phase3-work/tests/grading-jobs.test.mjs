import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {Store} from '../dist/server/store.js';import {Accounts} from '../dist/server/accounts.js';import {GradingJobs} from '../dist/server/grading-jobs.js';import {missions} from '../dist/server/catalog.js';
const config={enabled:true,minIntervalMs:0,dailyTokens:100000,minuteTokens:30000,dailyCalls:100,maxOutputTokens:500};
function fixture(){const store=new Store(':memory:'),accounts=new Accounts(store.db);const g=store.createGuest().guest;store.profile(g,'Job Guest','powertrain');const m=missions.get('onboard');const answer='Measured engineering evidence and safe verification plan. '.repeat(50);return {store,accounts,g,m,answer};}
const review=(m,pass=true)=>({provider:'groq',model:'synthetic',verified:true,rubricVersion:2,tokens:200,short:false,words:200,score:99999,summary:'Assessment complete.',items:m.rubric.map(c=>({criterionId:c.id,passed:pass,feedback:'Synthetic evidence.',evidence:'Measured engineering evidence',improvement:pass?'':'Add a concrete measurement plan.'}))});
const submit=f=>f.accounts.submit(f.g.id,{submissionId:randomUUID(),missionId:f.m.id,answer:f.answer,aiConsent:true},true);

test('validated live jobs calculate bounded XP, guest leaderboard, dedup and improved-best XP only',async()=>{
 const f=fixture();try{const first=submit(f);let calls=0;const worker=new GradingJobs(f.store,{async review(){calls++;return review(f.m);}},config);await worker.tick();const saved=f.accounts.submission(f.g.id,first.submissionId);assert.equal(saved.state,'graded');assert.equal(saved.score,100);const max=Math.round(f.m.xp*(f.m.dept==='powertrain'?1.2:1));assert.equal(saved.xp,max);assert.equal(f.store.progress(f.g.id).xp,max);assert.equal(f.accounts.leaderboard()[0].id,f.g.id);assert.equal(f.store.db.prepare("SELECT tokens FROM grading_budget WHERE window LIKE 'day:%'").get().tokens,200);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM grading_reservations').get().n,0);
 assert.equal(submit(f).submissionId,first.submissionId);await worker.tick();assert.equal(calls,1);
 f.answer+=' Additional evidence.';const second=submit(f);await worker.tick();assert.equal(f.accounts.submission(f.g.id,second.submissionId).xp,0);assert.equal(f.store.progress(f.g.id).xp,max);
 }finally{f.store.close();}
});

test('provider failures retry at most three times and invalid/mock reviews award zero XP',async()=>{
 for(const type of ['network','invalid','mock','tampered_response']){const f=fixture();try{const submitted=submit(f);const worker=new GradingJobs(f.store,{async review(){if(type==='network')throw Error('sensitive response must not be persisted');if(type==='tampered_response')return {...review(f.m),responseText:JSON.stringify({summary:'Different from the reviewed summary.',items:review(f.m).items})};if(type==='mock')return {...review(f.m),verified:false,provider:'mock'};return {...review(f.m),items:[review(f.m).items[0],review(f.m).items[0]]};}},config);
 for(let i=0;i<4;i++){f.store.db.prepare('UPDATE mission_submissions SET next_attempt_at=0').run();await worker.tick();}
 const row=f.accounts.submission(f.g.id,submitted.submissionId);assert.equal(row.state,'failed');assert.equal(row.attempts,3);assert.equal(row.result,null);assert.equal(f.store.progress(f.g.id).xp,0);assert.equal(JSON.stringify(row).includes('sensitive'),false);
 }finally{f.store.close();}}
});

test('leases recover restart, concurrent consumers do not duplicate XP, and deleted jobs cannot commit',async()=>{
 const f=fixture();try{const s=submit(f);const releases=[];let calls=0;const grader={review:async()=>{calls++;return new Promise(r=>releases.push(r));}};const one=new GradingJobs(f.store,grader,config),two=new GradingJobs(f.store,grader,config);
 const pending=one.tick();await two.tick();assert.equal(calls,1);f.store.db.prepare('UPDATE mission_submissions SET lease_until=0').run();const recovered=two.tick();assert.equal(calls,2);releases[1](review(f.m));await recovered;const xp=f.store.progress(f.g.id).xp;assert(xp>0); // abandoned first request never owns the new lease
 assert.equal(f.accounts.submission(f.g.id,s.submissionId).attempts,2);
 releases[0](review(f.m));await pending;assert.equal(f.store.progress(f.g.id).xp,xp,'stale lease completion cannot award a second time');
 f.answer+=' revised';const next=submit(f);let finish;const deleting=new GradingJobs(f.store,{review:()=>new Promise(r=>finish=r)},config);const running=deleting.tick();f.store.deleteGuest(f.g.id);finish(review(f.m));await running;assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM results').get().n,0);
 }finally{f.store.close();}
});

test('old submissions remain private, quotas defer without exhausting attempts, and short answers use zero provider budget',async()=>{
 const f=fixture();try{f.accounts.submit(f.g.id,{submissionId:randomUUID(),missionId:f.m.id,answer:f.answer});let calls=0;const w=new GradingJobs(f.store,{async review(){calls++;return review(f.m);}},config);await w.tick();assert.equal(calls,0);
 const newJob=submit(f);const capped=new GradingJobs(f.store,{async review(){calls++;return review(f.m);}}, {...config,dailyTokens:1});await capped.tick();const row=f.accounts.submission(f.g.id,newJob.submissionId);assert.equal(row.state,'retryable');assert.equal(row.attempts,0);assert.equal(row.errorCode,'quota_wait');assert.equal(calls,0);
 const short=f.accounts.submit(f.g.id,{submissionId:randomUUID(),missionId:f.m.id,answer:'too short',aiConsent:true},true);const local=new GradingJobs(f.store,{async review(){return {provider:'local',model:'word-check',verified:false,short:true,score:0,items:[],summary:'Too short',tokens:0,words:2};}},config);await local.tick();assert.equal(f.accounts.submission(f.g.id,short.submissionId).state,'graded');assert.equal(f.store.progress(f.g.id).xp,0);
 }finally{f.store.close();}
});

 test('all eight missions enforce discipline bonus and best-score XP deltas',async()=>{
 const f=fixture();try{for(const m of missions.values()){
 const input={submissionId:randomUUID(),missionId:m.id,answer:f.answer+' '+m.id,aiConsent:true};
 const first=f.accounts.submit(f.g.id,input,true);let high=false;const grader={async review(){const r=review(m);if(!high)r.items=r.items.map((it,i)=>({...it,passed:i!==0,improvement:i===0?'Add a concrete measurement plan.':''}));return r;}};
 const jobs=new GradingJobs(f.store,grader,{...config,minuteTokens:100000,dailyTokens:1000000});await jobs.tick();const low=f.accounts.submission(f.g.id,first.submissionId);assert.equal(low.state,'graded');const score=Math.round((m.rubric.length-1)*100/m.rubric.length);const factor=m.dept==='powertrain'?1.2:1;const lowXp=score>=60?Math.round(m.xp*score/100*factor):0;assert.equal(low.xp,lowXp);
 high=true;const second=f.accounts.submit(f.g.id,{...input,submissionId:randomUUID(),answer:input.answer+' improved'},true);await jobs.tick();assert.equal(f.accounts.submission(f.g.id,second.submissionId).xp,Math.round(m.xp*factor)-lowXp);
 }assert.equal(f.store.progress(f.g.id).xp,[...missions.values()].reduce((n,m)=>n+Math.round(m.xp*(m.dept==='powertrain'?1.2:1)),0));}finally{f.store.close();}
 });

test('consent is explicit and daily submission quotas survive progress reset',async()=>{
 const f=fixture();try{
 const noConsent=f.accounts.submit(f.g.id,{submissionId:randomUUID(),missionId:f.m.id,answer:f.answer},true);assert.equal(noConsent.gradingEnabled,false);
 let calls=0;await new GradingJobs(f.store,{async review(){calls++;return review(f.m);}},config).tick();assert.equal(calls,0);
 for(let i=1;i<20;i++){f.accounts.submit(f.g.id,{submissionId:randomUUID(),missionId:f.m.id,answer:f.answer+' '+i,aiConsent:true},true);f.store.reset(f.g.id);f.store.profile(f.store.guestById(f.g.id),'Job Guest','powertrain');}
 assert.throws(()=>submit(f),e=>e.status===429);assert.equal(f.store.progress(f.g.id).xp,0);
 }finally{f.store.close();}
});

test('final AI output and timings survive validation and database persistence',async()=>{
 const f=fixture();try{const job=submit(f);const result=review(f.m);result.responseText=JSON.stringify({summary:result.summary,items:result.items});result.providerMs=321;result.promptTokens=150;result.completionTokens=50;result.reasoningTokens=10;result.reasoningEffort='low';
 await new GradingJobs(f.store,{review:async()=>result},config).tick();const saved=JSON.parse(f.accounts.submission(f.g.id,job.submissionId).result);assert.equal(saved.responseText,result.responseText);assert.equal(saved.providerMs,321);assert.equal(saved.tokens,200);assert.equal(saved.reasoningEffort,'low');assert(Number.isInteger(saved.queueWaitMs)&&saved.queueWaitMs>=0);
 }finally{f.store.close();}
});

test('old review refresh is deliberate, current reviews deduplicate and cannot farm XP',async()=>{
 const f=fixture();try{
  const first=submit(f),jobs=new GradingJobs(f.store,{review:async()=>review(f.m)},config);await jobs.tick();const xp=f.store.progress(f.g.id).xp;
  const old=JSON.parse(f.accounts.submission(f.g.id,first.submissionId).result);delete old.rubricVersion;
  f.store.db.prepare('UPDATE mission_submissions SET result=? WHERE id=?').run(JSON.stringify(old),first.submissionId);
  const refreshed=submit(f);assert.notEqual(refreshed.submissionId,first.submissionId);await jobs.tick();
  assert.equal(f.accounts.submission(f.g.id,refreshed.submissionId).xp,0);assert.equal(f.store.progress(f.g.id).xp,xp);
  assert.equal(submit(f).submissionId,refreshed.submissionId);assert.equal(f.accounts.submission(f.g.id,refreshed.submissionId).answer,f.answer.trim());
 }finally{f.store.close();}
});
