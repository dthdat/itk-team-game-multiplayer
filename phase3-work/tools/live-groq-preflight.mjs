import { readFile,writeFile } from 'node:fs/promises';
import { Grader } from '../dist/server/grader.js';
import { missions } from '../dist/server/catalog.js';
const config=Object.fromEntries((await readFile('/etc/prompt-works/prompt-works.env','utf8')).split('\n').filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const grader=new Grader({provider:'groq',apiKey:config.GROQ_API_KEY,model:config.GROQ_MODEL||'openai/gpt-oss-20b',maxOutputTokens:3072,inputUsdPerMillion:0,outputUsdPerMillion:0,attempts:1});
const m=missions.get('onboard');
try{const result=await grader.review(m,m.ref,'en');if(!result.verified||result.score<60)throw Error('reference_review_failed');const report={at:new Date().toISOString(),model:result.model,verified:result.verified,score:result.score,tokens:result.tokens,criteria:result.items.length,result:'PASS'};await writeFile('reports/groq-live-preflight.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
catch(e){console.error('Live preflight failed:', e.status||'validation',e.name);process.exitCode=1;}
