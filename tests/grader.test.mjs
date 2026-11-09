import test from 'node:test';
import assert from 'node:assert/strict';
import { GradeQueue, Grader, ProviderError } from '../dist/server/grader.js';
import { missions } from '../dist/server/catalog.js';

const mission = missions.get('onboard');
const answer = 'You are an automotive engineer. Review a brake noise concern for a vehicle operating at highway speed. Compare likely causes and request missing evidence. Return a concise table with prioritized checks. Do not invent measurements or state uncertain conclusions as facts.';
const config = { provider:'groq',apiKey:'test-only',model:'test-model',maxOutputTokens:800,inputUsdPerMillion:0,outputUsdPerMillion:0 };
const validItems = mission.rubric.map(item => ({ criterionId:item.id,passed:true,feedback:'Explicitly addressed.' }));
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
  globalThis.fetch = async () => response({ choices:[{message:{content:JSON.stringify({summary:'Complete.',items:validItems})}}],usage:{total_tokens:321} });
  const review = await new Grader(config).review(mission,answer);
  assert.equal(review.verified,true);
  assert.equal(review.score,100);
  assert.equal(review.tokens,321);
  assert.equal(review.items.length,mission.rubric.length);

  globalThis.fetch = async () => response({ choices:[{message:{content:JSON.stringify({summary:'Incomplete.',items:validItems.slice(1)})}}] });
  await assert.rejects(new Grader(config).review(mission,answer),ProviderError);

  globalThis.fetch = async () => response({ choices:[{message:{content:JSON.stringify({summary:'Duplicate.',items:[...validItems.slice(1),validItems[0],validItems[0]]})}}] });
  await assert.rejects(new Grader(config).review(mission,answer),ProviderError);

  globalThis.fetch = async () => response({ choices:[{message:{content:'not-json'}}] });
  await assert.rejects(new Grader(config).review(mission,answer),ProviderError);
});

test('provider retries one transient response and queues only bounded work', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls=0;
  globalThis.fetch = async () => ++calls===1 ? new Response('',{status:503}) : response({ choices:[{message:{content:JSON.stringify({summary:'Complete.',items:validItems})}}] });
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