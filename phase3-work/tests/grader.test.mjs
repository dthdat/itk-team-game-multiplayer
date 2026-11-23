import test from 'node:test';
import assert from 'node:assert/strict';
import { GradeQueue, Grader, ProviderError } from '../dist/server/grader.js';
import { gradeWithProvider } from '../dist/server/grading-provider.js';
import { missions } from '../dist/server/catalog.js';

const mission = missions.get('onboard');
const answer = 'You are an automotive engineer. Review a brake noise concern for a vehicle operating at highway speed. Compare likely causes and request missing evidence. Return a concise table with prioritized checks. Do not invent measurements or state uncertain conclusions as facts.';
const config = { provider:'groq',apiKey:'test-only',model:'test-model',maxOutputTokens:800,inputUsdPerMillion:0,outputUsdPerMillion:0 };
const validItems = mission.rubric.map(item => ({ criterionId:item.id,passed:true,feedback:'Explicitly addressed.',evidence:'You are an automotive engineer.',improvement:'' }));
const response = payload => new Response(JSON.stringify(payload), { status:200,headers:{'content-type':'application/json'} });

test('mock and short reviews are unverified and cannot be treated as progress', async () => {
  const mock = await new Grader({ ...config,provider:'mock' }).review(mission,answer);
  const short = await new Grader(config).review(mission,'too short');
  assert.equal(mock.verified,false);
  assert.equal(mock.score,0);
  assert.equal(mock.provider,'mock');
  assert.equal(short.verified,false);
  assert.equal(short.short,true);
});

test('provider response must include each criterion exactly once', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => response({ choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Assessment complete.',items:validItems})}}],usage:{total_tokens:321} });
  const review = await new Grader(config).review(mission,answer);
  assert.equal(review.verified,true);
  assert.equal(review.score,100);
  assert.equal(review.tokens,321);
  assert.equal(review.items.length,mission.rubric.length);

  globalThis.fetch = async () => response({ choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Incomplete.',items:validItems.slice(1)})}}],usage:{total_tokens:300} });
  await assert.rejects(new Grader(config).review(mission,answer),ProviderError);

  globalThis.fetch = async () => response({ choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Duplicate.',items:[...validItems.slice(1),validItems[0],validItems[0]]})}}],usage:{total_tokens:300} });
  await assert.rejects(new Grader(config).review(mission,answer),ProviderError);

  globalThis.fetch = async () => response({ choices:[{finish_reason:'stop',message:{content:'not-json'}}],usage:{total_tokens:300} });
  await assert.rejects(new Grader(config).review(mission,answer),ProviderError);
});

test('provider-neutral adapter contract validates structured output and language metadata without network access', async () => {
  let requestSeen;
  const adapter={id:'test-adapter',async grade(request,signal){requestSeen=request;assert.equal(signal.aborted,false);return {model:'fixture-v1',tokens:123,result:{summary:'Evidence-based response.',items:validItems}};}};
  const review=await gradeWithProvider(mission,answer,adapter,'vi',AbortSignal.timeout(1000));
  assert.equal(requestSeen.locale,'vi');assert.equal(requestSeen.missionId,'onboard');assert.equal(requestSeen.rubric.length,mission.rubric.length);
  assert.equal(review.provider,'test-adapter');assert.equal(review.model,'fixture-v1');assert.equal(review.tokens,123);assert.equal(review.score,100);
  const invalid={...adapter,async grade(){return {model:'fixture-v1',tokens:1,result:{summary:'Invalid',score:100,items:validItems}};}};
  await assert.rejects(gradeWithProvider(mission,answer,invalid,'en',AbortSignal.timeout(1000)));
});

test('provider retries one transient response and queues only bounded work', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls=0;
  globalThis.fetch = async () => ++calls===1 ? new Response('',{status:503}) : response({ choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Assessment complete.',items:validItems})}}],usage:{total_tokens:300} });
  await new Grader(config).review(mission,answer);
  assert.equal(calls,2);

  const queue = new GradeQueue(1,1,1000);
  let release;
  const blocker = queue.run(()=>new Promise(resolve=>{release=resolve;}));
  const waiting = queue.run(async()=>42);
  await assert.rejects(queue.run(async()=>0),ProviderError);
  release();
  await blocker;
  assert.equal(await waiting,42);
});

test('Groq request explicitly localizes both summary and criterion feedback',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);let sent;
 globalThis.fetch=async(_url,options)=>{sent=JSON.parse(options.body);return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Đã chấm xong.',items:validItems})}}],usage:{total_tokens:123}});};
 await new Grader(config).review(mission,answer,'vi');assert.equal(JSON.parse(sent.messages[1].content).locale,'vi');assert(sent.messages[0].content.includes('Vietnamese with diacritics'));assert.equal(sent.response_format.json_schema.strict,true);
});

test('actual final response and measured provider metadata are retained without the hidden reasoning envelope',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 const final=JSON.stringify({summary:'Assessment complete.',items:validItems});
 globalThis.fetch=async()=>response({choices:[{finish_reason:'stop',message:{content:final,reasoning:'HIDDEN_ENVELOPE_MUST_NOT_BE_EXPOSED'}}],usage:{total_tokens:100,prompt_tokens:60,completion_tokens:40,completion_tokens_details:{reasoning_tokens:10}}});
 const review=await new Grader({...config,model:'openai/gpt-oss-20b'}).review(mission,answer);
 assert.equal(review.responseText,final);assert(Number.isInteger(review.providerMs)&&review.providerMs>=0);assert.equal(review.promptTokens,60);assert.equal(review.completionTokens,40);assert.equal(review.reasoningTokens,10);assert.equal(review.reasoningEffort,'low');assert(!JSON.stringify(review).includes('HIDDEN_ENVELOPE'));
 globalThis.fetch=async()=>response({choices:[{finish_reason:'stop',message:{content:final}}],usage:{total_tokens:100,prompt_tokens:99,completion_tokens:99}});
 await assert.rejects(new Grader(config).review(mission,answer),ProviderError);
});

test('grounded reviews reject invented evidence and contradictory fixes',async()=>{
 const {validateProviderResult}=await import('../dist/server/grading-provider.js');
 const validate=items=>validateProviderResult(mission,{summary:'Assessment complete.',items},'groq','test',100,{answer,locale:'en'});
 assert.equal(validate(validItems).rubricVersion,2);
 for(const changed of [{evidence:'Invented torque of 999 Nm'},{improvement:'Fix this passed criterion.'},{passed:false,improvement:''},{evidence:undefined}]){
  assert.throws(()=>validate(validItems.map((it,i)=>i===0?{...it,...changed}:it)));
 }
 const fixed=validItems.map((it,i)=>i===0?{...it,passed:false,improvement:'State the engineering role explicitly.'}:it);
 assert.equal(validate(fixed).items[0].improvement,'State the engineering role explicitly.');
});
