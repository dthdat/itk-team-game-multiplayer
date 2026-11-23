import { randomUUID } from 'node:crypto';
import { Store, type Review } from './store.js';
import { missions, catalog, type Mission } from './catalog.js';
import { validateProviderResult, validateReviewEvidence, RUBRIC_VERSION } from './grading-provider.js';

interface Job { id:string;owner:string;mission_id:string;answer:string;locale:'en'|'vi';grading_attempts:number;lease_token:string;created_at:number }
export interface JobConfig { enabled:boolean; minIntervalMs:number; dailyTokens:number; minuteTokens:number; dailyCalls:number; maxOutputTokens:number }
interface Reviewer { review(mission:Mission,answer:string,locale?:'en'|'vi'):Promise<Review> }

/** One bounded consumer. SQLite leases protect restart and competing consumers. */
export class GradingJobs {
  private timer?:NodeJS.Timeout;
  private running?:Promise<void>;
  private stopped=false;
  private nextCall=0;
  constructor(private store:Store,private reviewer:Reviewer,private config:JobConfig,private changed:(id:string)=>void=()=>{}) {}
  start(){if(!this.config.enabled||this.timer)return;this.timer=setInterval(()=>{void this.tick();},1000);this.timer.unref();}
  tick():Promise<void>{if(this.stopped||!this.config.enabled)return Promise.resolve();if(this.running)return this.running;this.running=this.consume().catch(()=>{/* no answers or provider errors in logs */}).finally(()=>{this.running=undefined;});return this.running;}
  async stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);await this.running;}
  private claim(now:number):Job|undefined {
    const db=this.store.db;db.exec('BEGIN IMMEDIATE');
    try{
      // Exhausted expired leases become terminal instead of remaining stuck.
      db.prepare("UPDATE mission_submissions SET state='failed',error_code='review_interrupted',lease_token=NULL,lease_until=0,updated_at=? WHERE grading_enabled=1 AND state='reviewing' AND lease_until<=? AND grading_attempts>=3").run(now,now);
      const job=db.prepare(`SELECT s.* FROM mission_submissions s JOIN guests g ON g.id=s.owner
        WHERE grading_enabled=1 AND grading_attempts<3 AND g.expires>?
        AND ((state IN ('pending','retryable') AND next_attempt_at<=?) OR (state='reviewing' AND lease_until<=?))
        ORDER BY created_at,id LIMIT 1`).get(now,now,now) as unknown as Job|undefined;
      if(!job){db.exec('COMMIT');return;}
      job.lease_token=randomUUID();job.grading_attempts++;
      db.prepare("UPDATE mission_submissions SET state='reviewing',grading_attempts=?,lease_token=?,lease_until=?,updated_at=?,error_code=NULL WHERE id=?").run(job.grading_attempts,job.lease_token,now+90000,now,job.id);
      db.exec('COMMIT');return job;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  private reserve(job:Job,mission:Mission,now:number):boolean {
    const estimate=Math.ceil(Buffer.byteLength(JSON.stringify({answer:job.answer,brief:mission.brief,task:mission.task,rubric:mission.rubric}))/2)+this.config.maxOutputTokens+300;
    if(estimate>this.config.minuteTokens){this.fail(job,'answer_too_long',false);return false;}
    const day=Math.floor(now/86400000),minute=Math.floor(now/60000),db=this.store.db;
    db.exec('BEGIN IMMEDIATE');
    try{
      for(const key of [`day:${day}`,`minute:${minute}`])db.prepare('INSERT OR IGNORE INTO grading_budget(window) VALUES(?)').run(key);
      const daily=db.prepare('SELECT tokens,calls FROM grading_budget WHERE window=?').get(`day:${day}`) as {tokens:number;calls:number};
      const recent=db.prepare('SELECT tokens FROM grading_budget WHERE window=?').get(`minute:${minute}`) as {tokens:number};
      const dailyFull=daily.tokens+estimate>this.config.dailyTokens||daily.calls>=this.config.dailyCalls;
      if(dailyFull||recent.tokens+estimate>this.config.minuteTokens){
        db.prepare("UPDATE mission_submissions SET state='retryable',error_code='quota_wait',next_attempt_at=?,grading_attempts=grading_attempts-1,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=?").run(dailyFull?(day+1)*86400000:(minute+1)*60000+1000,now,job.id,job.lease_token);
        db.exec('COMMIT');return false;
      }
      for(const key of [`day:${day}`,`minute:${minute}`])db.prepare('UPDATE grading_budget SET tokens=tokens+?,calls=calls+1 WHERE window=?').run(estimate,key);
      db.prepare('INSERT INTO grading_reservations(lease_token,day,minute,tokens) VALUES(?,?,?,?)').run(job.lease_token,`day:${day}`,`minute:${minute}`,estimate);
      db.prepare("DELETE FROM grading_budget WHERE (window LIKE 'minute:%' AND CAST(substr(window,8) AS INTEGER)<?) OR (window LIKE 'day:%' AND CAST(substr(window,5) AS INTEGER)<?)").run(minute-5,day-90);
      db.prepare('DELETE FROM grading_reservations WHERE day NOT IN (SELECT window FROM grading_budget)').run();
      db.exec('COMMIT');return true;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  private fail(job:Job,code:string,retry:boolean){
    const now=Date.now();this.store.db.prepare("UPDATE mission_submissions SET state=?,error_code=?,next_attempt_at=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND state='reviewing' AND lease_token=?").run(retry&&job.grading_attempts<3?'retryable':'failed',code,now+Math.min(300000,60000*2**(job.grading_attempts-1))+Math.floor(Math.random()*3000),now,job.id,job.lease_token);
  }
  private complete(job:Job,mission:Mission,review:Review){
    // Re-validate even internal adapter results; scores and XP never come from JSON.
    if(review.verified){if(review.provider!=='groq'||review.rubricVersion!==RUBRIC_VERSION||!Number.isInteger(review.tokens)||review.tokens<0||review.tokens>1000000)throw Error('Invalid review provenance');const checked=validateProviderResult(mission,{summary:review.summary,items:review.items},review.provider,review.model,review.tokens,{answer:job.answer,locale:job.locale});review={...checked,words:job.answer.trim().split(/\s+/u).length,...validateReviewEvidence(mission,review,checked)};}
    else if(!review.short||review.provider!=='local'||review.score!==0||job.answer.trim().split(/\s+/u).length>=mission.minWords)throw Error('Unverified result cannot complete a live job');
    const db=this.store.db;db.exec('BEGIN IMMEDIATE');
    try{
      const row=db.prepare("SELECT owner FROM mission_submissions WHERE id=? AND state='reviewing' AND lease_token=?").get(job.id,job.lease_token);
      const guest=this.store.guestById(job.owner);
      if(!row||!guest){db.exec('COMMIT');return;}
      const reservation=db.prepare('SELECT day,minute,tokens FROM grading_reservations WHERE lease_token=?').get(job.lease_token) as {day:string;minute:string;tokens:number}|undefined;
      if(reservation&&review.verified){
        const delta=review.tokens-reservation.tokens;
        for(const key of [reservation.day,reservation.minute])db.prepare('UPDATE grading_budget SET tokens=MAX(0,tokens+?) WHERE window=?').run(delta,key);
        db.prepare('DELETE FROM grading_reservations WHERE lease_token=?').run(job.lease_token);
      }
      const old=db.prepare('SELECT xp FROM results WHERE guest=? AND mission=?').get(job.owner,mission.id) as {xp:number}|undefined;
      const xp=review.verified&&review.score>=catalog.pass?Math.round(mission.xp*review.score/100*(mission.dept===guest.disc?1.2:1)):0;
      if(xp<0||xp>Math.round(mission.xp*1.2))throw Error('XP bound violated');
      if(review.verified)db.prepare('INSERT INTO results(guest,mission,score,xp) VALUES(?,?,?,?) ON CONFLICT(guest,mission) DO UPDATE SET score=MAX(score,excluded.score),xp=MAX(xp,excluded.xp)').run(job.owner,mission.id,review.score,xp);
      const gain=Math.max(0,xp-(old?.xp||0));
      db.prepare("UPDATE mission_submissions SET state='graded',score=?,xp=?,result=?,lease_token=NULL,lease_until=0,error_code=NULL,updated_at=? WHERE id=? AND lease_token=?").run(review.score,gain,JSON.stringify(review),Date.now(),job.id,job.lease_token);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    this.changed(job.owner);
  }
  private async consume(){
    if(Date.now()<this.nextCall)return;
    const job=this.claim(Date.now());if(!job)return;
    const mission=missions.get(job.mission_id);if(!mission){this.fail(job,'mission_unavailable',false);return;}
    const short=job.answer.trim().split(/\s+/u).length<mission.minWords;
    if(!short&&!this.reserve(job,mission,Date.now()))return;
    this.nextCall=Date.now()+this.config.minIntervalMs;
    const queueWaitMs=Math.max(0,Date.now()-job.created_at);
    try{const review=await this.reviewer.review(mission,job.answer,job.locale);this.complete(job,mission,{...review,queueWaitMs});}
    catch(e){const status=(e as {status?:number})?.status;this.fail(job,status===429?'provider_busy':status===401||status===403?'provider_auth':status===400?'provider_configuration':'review_unavailable',![400,401,403].includes(status||0));}
  }
}
