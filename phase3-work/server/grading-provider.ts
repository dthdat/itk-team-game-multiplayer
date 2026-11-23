import { z } from 'zod';
import type { Mission } from './catalog.js';
import type { Review } from './store.js';

export interface GradingProviderRequest {
  missionId: string;
  locale: 'en' | 'vi';
  task: string;
  brief: string;
  rubric: Array<{ id: string; criterion: string; guidance: string }>;
  answer: string;
}

/** Provider adapters return untrusted structured data and never write XP or DB state. */
export interface GradingProviderAdapter {
  readonly id: string;
  grade(request: GradingProviderRequest, signal: AbortSignal): Promise<unknown>;
}

const providerEnvelope = z.object({
  model: z.string().trim().min(1).max(128),
  tokens: z.number().int().min(0).max(1_000_000),
  result: z.unknown()
}).strict();

/** Shared adapter path. It validates the envelope and rubric before returning a verified Review. */
export async function gradeWithProvider(mission: Mission, answer: string, adapter: GradingProviderAdapter, locale: 'en'|'vi'='en', signal: AbortSignal=AbortSignal.timeout(25_000)): Promise<Review> {
  const envelope=providerEnvelope.parse(await adapter.grade({
    missionId:mission.id,locale,task:mission.task,brief:mission.brief,
    rubric:mission.rubric.map(item=>({id:item.id,criterion:item.label,guidance:item.tip})),answer
  },signal));
  return validateProviderResult(mission,envelope.result,adapter.id,envelope.model,envelope.tokens);
}

export const RUBRIC_VERSION=2;
export const reviewSummary=(locale:'en'|'vi')=>locale==='vi'?'Đã chấm xong.':'Assessment complete.';
const normalizeQuote=(text:string)=>text.normalize('NFKC').replace(/\s+/gu,' ').trim();

const responseSchema = z.object({
  summary: z.string().trim().min(1).max(700),
  items: z.array(z.object({
    criterionId: z.string().min(1).max(40),
    passed: z.boolean(),
    feedback: z.string().trim().min(1).max(500),
    evidence:z.string().trim().max(500).optional(),
    improvement:z.string().trim().max(700).optional()
  }).strict()).max(24)
}).strict();

/** Validate any adapter's result and calculate its score from rubric booleans. */
export function validateProviderResult(mission: Mission, raw: unknown, provider: string, model: string, tokens: number, grounding?:{answer:string;locale:'en'|'vi'}): Review {
  const parsed = responseSchema.parse(raw);
  const expected = new Set(mission.rubric.map(item => item.id));
  if (parsed.items.length !== expected.size) throw new Error('Incomplete rubric response');
  const seen = new Set<string>();
  for (const item of parsed.items) {
    if (!expected.has(item.criterionId) || seen.has(item.criterionId)) throw new Error('Rubric response does not match mission');
    seen.add(item.criterionId);
    if(grounding){
      if(typeof item.evidence!=='string'||typeof item.improvement!=='string')throw new Error('Missing grounded feedback');
      if(item.passed&&(!item.evidence||item.improvement))throw new Error('Passed criterion requires evidence and no fix');
      if(!item.passed&&!item.improvement)throw new Error('Failed criterion requires a suggested change');
      if(item.evidence&&!normalizeQuote(grounding.answer).includes(normalizeQuote(item.evidence)))throw new Error('Feedback evidence is not in the submitted answer');
      const minimum=mission.rubric.find(c=>c.id===item.criterionId)?.label.match(/(\d+)\s*\+\s*words/i);
      if(item.passed&&minimum&&grounding.answer.trim().split(/\s+/u).length<Number(minimum[1]))throw new Error('Word-count decision contradicts the answer');
    }

  }
  if(grounding&&parsed.summary!==reviewSummary(grounding.locale))throw new Error('Invalid overall review label');
  const byId = new Map(parsed.items.map(item => [item.criterionId, item]));
  const items = mission.rubric.map(criterion => {
    const item = byId.get(criterion.id)!;
    return { criterionId: criterion.id, passed: item.passed, feedback: item.feedback,...(item.evidence!==undefined?{evidence:item.evidence}:{}),...(item.improvement!==undefined?{improvement:item.improvement}:{}) };
  });
  return {
    ...(grounding?{rubricVersion:RUBRIC_VERSION}:{}),
    score: Math.round(items.filter(item => item.passed).length * 100 / items.length), items,
    summary: parsed.summary, words: 0, short: false, verified: true,
    provider, model, tokens
  };
}

/** Preserve final response text and measured metadata, never a raw API envelope/reasoning. */
export function validateReviewEvidence(mission:Mission, review:Review, checked:Review): Partial<Review> {
  const evidence:Partial<Review>={};
  if(review.responseText!==undefined){
    if(typeof review.responseText!=='string'||review.responseText.length>12000)throw new Error('Invalid response evidence');
    const parsed=validateProviderResult(mission,JSON.parse(review.responseText),review.provider,review.model,review.tokens);
    if(parsed.summary!==checked.summary||JSON.stringify(parsed.items)!==JSON.stringify(checked.items))throw new Error('Response evidence differs from review');
    evidence.responseText=review.responseText;
  }
  for(const [field,max] of [['providerMs',300000],['queueWaitMs',90*86400000],['promptTokens',1000000],['completionTokens',1000000],['reasoningTokens',1000000]] as const){
    const value=review[field];if(value!==undefined){if(!Number.isInteger(value)||value<0||value>max)throw new Error('Invalid response measurement');evidence[field]=value;}
  }
  if(evidence.promptTokens!==undefined&&evidence.completionTokens!==undefined&&evidence.promptTokens+evidence.completionTokens!==review.tokens)throw new Error('Inconsistent response measurements');
  if(review.reasoningEffort!==undefined){if(review.reasoningEffort!=='low')throw new Error('Invalid effort metadata');evidence.reasoningEffort=review.reasoningEffort;}
  if(evidence.reasoningTokens!==undefined&&evidence.reasoningTokens>(evidence.completionTokens??review.tokens))throw new Error('Invalid reasoning token count');
  return evidence;
}
