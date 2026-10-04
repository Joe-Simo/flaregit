import { z } from "zod";
import { isSafeRef } from "../core/sanitize";
import { ManagedSpendLedger, type ManagedBudget } from "./managed-spend-ledger";
const sha=z.string().regex(/^[a-f0-9]{40}$/).refine(value=>!/^0{40}$/.test(value));
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const browserSessionScopeSchema=z.object({
 leaseId:z.uuid(),attemptId:z.uuid(),projectId:z.string().regex(/^[a-z0-9]{12,16}$/),incarnation:z.uuid(),
 accountKey:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),actorId:z.string().min(1).max(256),candidateId:z.string().min(1).max(200),canonicalRepoName:z.string().min(1).max(200),
 targetRef:z.string().refine(value=>value.startsWith("refs/heads/")&&isSafeRef(value)),expectedBase:sha.nullable(),acceptedVersion:z.number().int().nonnegative(),
 commit:sha,tree:sha,policyVersion:z.number().int().positive(),policyDigest:digest,buildDigest:digest,sourceDigest:digest,maxSeconds:z.literal(120),
}).strict().refine(scope=>scope.expectedBase!==null||scope.acceptedVersion===0,"Unborn browser scope has no accepted version");
export type BrowserSessionScope=z.infer<typeof browserSessionScopeSchema>;
export interface BrowserSessionFunding {reservationUsdMicros:number|null;budget:ManagedBudget}
export interface BrowserNeverAcquiredClosure {sessionId:null;observation:"never-acquired";observedAt:number}
export interface BrowserSessionClosure {sessionId:string;observation:"closed"|"absent";observedAt:number}
export interface BrowserSessionBudgetCallbacks {
 /** Server authority binds the current account, accepted base, candidate and policy.
  * Its returned synchronous fence runs inside every consequential transaction. */
 authorize(scope:BrowserSessionScope):Promise<()=>void>;
 /** Current operator configuration, never caller supplied prices or allowances. */
 funding(scope:BrowserSessionScope):BrowserSessionFunding;
 /** Trusted native adapter closes and reads back ONLY this stored exact session.
  * No inventory scan and no caller-provided `closed: true` receipt. */
 attestClosure(sessionId:string):Promise<BrowserSessionClosure|null>;
}
export interface BrowserSessionLease {scope:BrowserSessionScope;phase:"funded"|"acquire_possible"|"acquired"|"cleanup_pending"|"closed";reservationUsdMicros:number;fundingRunId:string;admittedAt:string;deadlineAt:string;sessionId:string|null;closure:BrowserSessionClosure|BrowserNeverAcquiredClosure|null}
const frozenScope=(input:BrowserSessionScope)=>Object.freeze(browserSessionScopeSchema.parse(input));
const amount=z.number().int().min(100000).max(1000000);
const closureSchema=z.object({sessionId:z.uuid(),observation:z.enum(["closed","absent"]),observedAt:z.number().int().positive().safe()}).strict();
/** One canary browser globally. Admission is bounded and funded, not a promise
 * about Browser Run billing, shared account concurrency or unknown session life.
 * Timeouts NEVER release a lease; uncertain acquisition/cleanup stays held. */
export class BrowserSessionBudget {
 private readonly managed:ManagedSpendLedger;
 private readonly authorityMs:number;
 private readonly cleanupMs:number;
 private async bounded<T>(operation:()=>Promise<T>,milliseconds:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Browser callback deadline expired")),milliseconds);})]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
 }
 private async authority(scope:BrowserSessionScope):Promise<()=>void>{
  const deadline=performance.now()+this.authorityMs,fence=await this.bounded(()=>this.callbacks.authorize(scope),this.authorityMs);
  if(typeof fence!=="function")throw Error("Synchronous browser authority fence required");
  return()=>{if(performance.now()>=deadline)throw Error("Browser authority callback deadline expired");const result:unknown=fence();if(result!==null&&(typeof result==="object"||typeof result==="function")&&"then" in result){void Promise.resolve(result).catch(()=>{});throw Error("Browser authority fence must be synchronous");}if(performance.now()>=deadline)throw Error("Browser authority callback deadline expired");};
 }
 constructor(private readonly storage:DurableObjectStorage,private readonly callbacks:BrowserSessionBudgetCallbacks,limits:{authorityMs?:number;cleanupMs?:number}={}){
  if(typeof callbacks.authorize!=="function"||typeof callbacks.funding!=="function"||typeof callbacks.attestClosure!=="function")throw Error("Browser authority, funding and native cleanup callbacks are required");
  this.authorityMs=limits.authorityMs??4000;this.cleanupMs=limits.cleanupMs??8000;
  for(const value of [this.authorityMs,this.cleanupMs])if(!Number.isInteger(value)||value<1||value>8000)throw Error("Invalid browser callback deadline");
  storage.sql.exec("CREATE TABLE IF NOT EXISTS browser_session_leases(lease_id TEXT PRIMARY KEY,payload TEXT NOT NULL,phase TEXT NOT NULL,doc TEXT NOT NULL)");
  this.managed=new ManagedSpendLedger(storage);
 }
 /** Backend readback only. HTTP adapters must separately authorize disclosure. */
 get(leaseId:string):BrowserSessionLease|null{z.uuid().parse(leaseId);const row=this.storage.sql.exec<{doc:string}>("SELECT doc FROM browser_session_leases WHERE lease_id=?",leaseId).toArray()[0];return row?JSON.parse(row.doc) as BrowserSessionLease:null;}
 private exact(scope:BrowserSessionScope):BrowserSessionLease{const record=this.get(scope.leaseId);if(!record||JSON.stringify(record.scope)!==JSON.stringify(scope))throw Error("Browser lease context changed");return record;}
 private save(record:BrowserSessionLease){this.storage.sql.exec("UPDATE browser_session_leases SET phase=?,doc=? WHERE lease_id=?",record.phase,JSON.stringify(record),record.scope.leaseId);}
 async admit(input:BrowserSessionScope,now=new Date()):Promise<BrowserSessionLease>{
  const scope=frozenScope(input),fence=await this.authority(scope);if(!Number.isFinite(now.getTime()))throw Error("Invalid browser admission time");
  return this.storage.transactionSync(()=>{fence();const existing=this.get(scope.leaseId);if(existing){const recorded=this.exact(scope);if(recorded.phase==="closed")throw Error("Browser lease UUID is consumed");return recorded;}
   if(this.storage.sql.exec("SELECT lease_id FROM browser_session_leases WHERE phase!='closed' LIMIT 1").toArray().length)throw Error("Browser canary capacity is held by another lease");
   if(this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM browser_session_leases").toArray()[0]!.n>=10000)throw Error("Browser lease audit capacity reached");
   const config=this.callbacks.funding(scope);if(config&&typeof config==="object"&&"then" in config){void Promise.resolve(config).catch(()=>{});throw Error("Browser funding configuration must be synchronous");}fence();const usdMicros=amount.parse(config.reservationUsdMicros),runId=`browser-${scope.leaseId}`;
   const reservation=this.managed.reserve({runId,accountKey:scope.accountKey,resourceKind:"optional-unclassified",usdMicros,maxInputBytes:1,maxOutputTokens:1,maxCalls:1,maxContainerSeconds:1},config.budget,now);
   if(!reservation.allowed||reservation.existing)throw Error("Browser funding unavailable or already consumed");
   this.managed.consume(runId,0,0,0,now);fence();
   const record:BrowserSessionLease={scope,phase:"funded",reservationUsdMicros:usdMicros,fundingRunId:runId,admittedAt:now.toISOString(),deadlineAt:new Date(now.getTime()+120000).toISOString(),sessionId:null,closure:null};
   this.storage.sql.exec("INSERT INTO browser_session_leases VALUES(?,?,?,?)",scope.leaseId,JSON.stringify(scope),record.phase,JSON.stringify(record));return record;
  });
 }
 async beginAcquire(input:BrowserSessionScope,now=new Date()):Promise<boolean>{const scope=frozenScope(input),fence=await this.authority(scope);return this.storage.transactionSync(()=>{fence();const record=this.exact(scope);if(!Number.isFinite(now.getTime())||now.getTime()>=Date.parse(record.deadlineAt))throw Error("Browser acquisition deadline expired");if(record.phase!=="funded")return false;record.phase="acquire_possible";this.save(record);return true;});}
 /** Capture known provider identity even after cancellation/authority withdrawal.
  * Recording a late fact never permits more browser work. */
 recordAcquired(input:BrowserSessionScope,sessionId:string):void{const scope=frozenScope(input),id=z.uuid().parse(sessionId);this.storage.transactionSync(()=>{const record=this.exact(scope);if(!["acquire_possible","acquired","cleanup_pending"].includes(record.phase)||record.sessionId!==null&&record.sessionId!==id)throw Error("Browser session acquisition identity changed");record.sessionId=id;if(record.phase!=="cleanup_pending")record.phase="acquired";this.save(record);});}
 async beforeWork(input:BrowserSessionScope,now=new Date()):Promise<void>{const scope=frozenScope(input),fence=await this.authority(scope);this.storage.transactionSync(()=>{fence();const record=this.exact(scope);if(record.phase!=="acquired"||record.sessionId===null||!Number.isFinite(now.getTime())||now.getTime()>=Date.parse(record.deadlineAt))throw Error("Browser work authority or deadline is unavailable");});}
 /** Cleanup remains possible after account/base/policy withdrawal. The adapter
  * must inspect the stored exact session; an unknown acquisition holds the slot. */
 async close(input:BrowserSessionScope):Promise<BrowserSessionLease>{const scope=frozenScope(input);const requested=this.storage.transactionSync(()=>{const record=this.exact(scope);if(record.phase==="funded"){record.phase="closed";record.closure={sessionId:null,observation:"never-acquired",observedAt:Date.now()};this.save(record);}else if(record.phase!=="closed"){record.phase="cleanup_pending";this.save(record);}return record;});if(requested.phase==="closed"||requested.sessionId===null)return requested;
  const sessionId=requested.sessionId,deadline=performance.now()+this.cleanupMs;let proof:BrowserSessionClosure|null;try{proof=await this.bounded(()=>this.callbacks.attestClosure(sessionId),this.cleanupMs);}catch{return this.exact(scope);}
  if(performance.now()>=deadline)return this.exact(scope);
  const checked=closureSchema.safeParse(proof);if(!checked.success||checked.data.sessionId!==requested.sessionId)return this.exact(scope);
  return this.storage.transactionSync(()=>{const record=this.exact(scope);if(performance.now()>=deadline)return record;if(record.sessionId!==requested.sessionId)throw Error("Browser cleanup session changed");if(record.phase==="closed")return record;record.closure=checked.data;record.phase="closed";this.save(record);return record;});
 }
}
