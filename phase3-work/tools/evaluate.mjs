import { mkdir, writeFile } from 'node:fs/promises';
import { loadSource } from './source.mjs';
import { Grader } from '../dist/server/grader.js';

const apiKey=process.env.GROQ_API_KEY;
const model=process.env.GROQ_MODEL||'openai/gpt-oss-20b';
const inputPrice=Number(process.env.GROQ_INPUT_USD_PER_MILLION);
const outputPrice=Number(process.env.GROQ_OUTPUT_USD_PER_MILLION);
const cap=Number(process.env.EVALUATION_MAX_USD);
const maxOutputTokens=Number(process.env.GRADING_MAX_OUTPUT_TOKENS||1200);
if(!apiKey)throw new Error('Set GROQ_API_KEY in the private environment before running evaluation.');
if(!(inputPrice>0&&outputPrice>0&&cap>0))throw new Error('Set verified positive input/output prices and EVALUATION_MAX_USD before making provider calls.');

const {AP}=loadSource(new URL('../baseline/ITK-BGSV Prompt Works_backup_2026-11-09_10-25-05-288.html',import.meta.url));
const missions=new Map(AP.MISSIONS.map(mission=>[mission.id,mission]));
const grader=new Grader({provider:'groq',apiKey,model,maxOutputTokens,inputUsdPerMillion:inputPrice,outputUsdPerMillion:outputPrice});
const estimatedCeiling=AP.MISSIONS.reduce((total,mission)=>total+grader.reserveEstimate(mission.ref).usd,0);
if(estimatedCeiling>cap)throw new Error(`Estimated worst-case spend $${estimatedCeiling.toFixed(4)} exceeds EVALUATION_MAX_USD=$${cap.toFixed(4)}; no calls made.`);

const results=[];
for(const item of AP.MISSIONS){
  try{
    const mission=missions.get(item.id);
    const review=await grader.review(mission,item.ref);
    results.push({missionId:item.id,score:review.score,passed:review.items.filter(entry=>entry.passed).length,criteria:review.items.length,verified:review.verified,provider:review.provider,model:review.model,tokens:review.tokens});
  }catch(error){
    results.push({missionId:item.id,error:error instanceof Error?error.message:'Unknown evaluation error'});
    break;
  }
}
const completed=results.filter(result=>'score'in result);
const report={at:new Date().toISOString(),provider:'groq',model,missions:results.length,completed:completed.length,meanScore:completed.length?Math.round(completed.reduce((sum,result)=>sum+result.score,0)/completed.length):null,estimatedWorstCaseUsd:estimatedCeiling,configuredEvaluationCapUsd:cap,results,disclaimer:'Reference-answer smoke evaluation only. It does not establish correctness, language fairness, or safety for arbitrary user submissions.'};
await mkdir('reports',{recursive:true});
await writeFile('reports/grading-evaluation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(results.length!==AP.MISSIONS.length||completed.length!==AP.MISSIONS.length)process.exitCode=1;