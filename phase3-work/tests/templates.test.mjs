import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {catalog} from '../dist/server/catalog.js';import {Store} from '../dist/server/store.js';import {Accounts} from '../dist/server/accounts.js';
test('all eight bilingual brainstorming templates are incomplete scaffolds and cannot be graded for XP untouched',()=>{
 const store=new Store(':memory:');try{const accounts=new Accounts(store.db),g=store.createGuest().guest;store.profile(g,'Template Tester','powertrain');assert.equal(Object.keys(catalog.templates).length,8);
 for(const mission of catalog.missions)for(const locale of ['en','vi']){const template=catalog.templates[mission.id][locale];assert(template.includes('[')&&template.includes(']'));assert.notEqual(template,mission.ref);const legacy=catalog.templateHistory[mission.id][locale];assert.throws(()=>accounts.submit(g.id,{submissionId:randomUUID(),missionId:mission.id,answer:legacy,locale,aiConsent:true},true),e=>e.status===422);assert.throws(()=>accounts.submit(g.id,{submissionId:randomUUID(),missionId:mission.id,answer:template,locale,aiConsent:true},true),e=>e.status===422);}
 assert.equal(accounts.submissions(g.id).length,0);assert.equal(store.progress(g.id).xp,0);
 }finally{store.close();}
});

test('starters follow each sample answer’s mission-specific sections',()=>{
 const expected={onboard:['Context:','Task:','Format:','Constraints:'],dyno:['{dyno_data}','BSFC','next actions'],bms:['{bms_log}','Evidence against','Confidence'],skill:['name:','description:','# Steps','# Self-check'],agent:['Guardrails:','Escalation:','Output: JSON'],dvpr:['DVP&R','{requirements}','Acceptance criteria'],eightd:['D2:','D3:','D4:','{facts}'],release:['Requirements agent:','Test-evidence agent:','Risk agent:','JSON schema']};for(const [id,parts]of Object.entries(expected))for(const part of parts)assert(catalog.templates[id].en.includes(part),id+' missing '+part);
});
