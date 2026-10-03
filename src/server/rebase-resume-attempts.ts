import { z } from "zod";
import type { HumanDecisionActor } from "../core/types.js";
import type { RebaseApplication } from "./retained-inputs.js";
import type { RebaseRecoverySnapshot } from "./rebase-recovery.js";
import { RebaseRecoveryError } from "./rebase-recovery.js";
export interface RebaseResumeAttempt {
  id:string; applicationId:string; generation:number; workflowId:string; nativeRunId:string;
  actor:HumanDecisionActor; expectedVersion:number; requestId:string;
  scope:{projectId:string;incarnation:string|null;canonicalRepoName:string};
  application:RebaseApplication; snapshot:RebaseRecoverySnapshot;
  credentialHash?:string;sessionExpiresAt?:number;
  /** A fresh owner POST grants only this immutable background attempt a bounded session delegation. */
  sessionDelegation?:{version:1;expiresAt:number};
  dispatch:"saved"|"unknown"|"observed"; nativeState:"unallocated"|"possible"|"stopped";
  terminal?:"completed"|"failed";pauseReason?:string;createdAt:string;
}
export const REBASE_RESUME_SESSION_DELEGATION_MS=15*60_000;
export function assertRebaseResumeSessionDelegation(attempt:RebaseResumeAttempt,now=Date.now()):void {
  if(attempt.actor.viaToken)return;
  const issuedAt=Date.parse(attempt.createdAt),grant=attempt.sessionDelegation;
  if(!grant||grant.version!==1||!Number.isSafeInteger(issuedAt)||!Number.isSafeInteger(grant.expiresAt)||grant.expiresAt!==issuedAt+REBASE_RESUME_SESSION_DELEGATION_MS||now>=grant.expiresAt)throw new RebaseRecoveryError("Saved recovery session delegation is unavailable or expired. Confirm execution stopped before starting another attempt.",409);
}
const uuid=z.string().uuid();
export class RebaseResumeAttempts {
  constructor(private readonly storage:DurableObjectStorage){storage.sql.exec("CREATE TABLE IF NOT EXISTS rebase_resume_attempts(id TEXT PRIMARY KEY, application_id TEXT NOT NULL, request_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, doc TEXT NOT NULL)");storage.sql.exec("CREATE INDEX IF NOT EXISTS rebase_resume_application ON rebase_resume_attempts(application_id)");}
  get(id:string):RebaseResumeAttempt|null {const row=this.storage.sql.exec<{doc:string}>("SELECT doc FROM rebase_resume_attempts WHERE id=?",id).toArray()[0];return row?JSON.parse(row.doc) as RebaseResumeAttempt:null;}
  latest(applicationId:string):RebaseResumeAttempt|null {const row=this.storage.sql.exec<{doc:string}>("SELECT doc FROM rebase_resume_attempts WHERE application_id=? ORDER BY rowid DESC LIMIT 1",applicationId).toArray()[0];return row?JSON.parse(row.doc) as RebaseResumeAttempt:null;}
  replay(applicationId:string,requestId:string,actor:HumanDecisionActor,expectedVersion:number):RebaseResumeAttempt|null {
    uuid.parse(requestId);uuid.parse(applicationId);z.number().int().nonnegative().parse(expectedVersion);
    const payload=JSON.stringify({applicationId,userId:actor.userId,viaToken:actor.viaToken,expectedVersion});
    const row=this.storage.sql.exec<{payload:string;doc:string}>("SELECT payload,doc FROM rebase_resume_attempts WHERE request_id=?",requestId).toArray()[0];
    if(row&&row.payload!==payload)throw new RebaseRecoveryError("Request identity belongs to another saved recovery",409);
    return row?JSON.parse(row.doc) as RebaseResumeAttempt:null;
  }
  begin(input:{application:RebaseApplication;snapshot:RebaseRecoverySnapshot;actor:HumanDecisionActor;expectedVersion:number;requestId:string;credentialHash?:string;sessionExpiresAt?:number}):RebaseResumeAttempt {
    return this.storage.transactionSync(()=>{
      const {application,snapshot,actor,expectedVersion,requestId}=input;
      const replay=this.replay(application.input.id,requestId,actor,expectedVersion);if(replay)return replay;
      const count=this.storage.sql.exec<{count:number}>("SELECT COUNT(*) AS count FROM rebase_resume_attempts").toArray()[0]?.count??0;
      if(count>=10_000)throw new RebaseRecoveryError("Saved recovery audit capacity reached. Existing requests remain replayable and Git history is preserved.",429);
      const old=this.latest(application.input.id);
      if(old&&(!old.terminal||old.nativeState!=="stopped"||old.dispatch==="unknown"))throw new RebaseRecoveryError("An earlier recovery may still be running. Its dispatch and native execution must be confirmed before another attempt.",409);
      const id=crypto.randomUUID(),generation=(old?.generation??0)+1,now=Date.now();
      const attempt:RebaseResumeAttempt={id,applicationId:application.input.id,generation,workflowId:`rebase-resume-${id}`,nativeRunId:`rebase-resume-${id}`,actor,expectedVersion,requestId,scope:{projectId:snapshot.projectId,incarnation:snapshot.incarnation,canonicalRepoName:snapshot.canonicalRepoName},application,snapshot,credentialHash:input.credentialHash,sessionExpiresAt:input.sessionExpiresAt,dispatch:"saved",nativeState:"unallocated",createdAt:new Date(now).toISOString(),...(!actor.viaToken?{sessionDelegation:{version:1 as const,expiresAt:now+REBASE_RESUME_SESSION_DELEGATION_MS}}:{})};
      this.storage.sql.exec("INSERT INTO rebase_resume_attempts(id,application_id,request_id,payload,doc) VALUES(?,?,?,?,?)",id,application.input.id,requestId,JSON.stringify({applicationId:application.input.id,userId:actor.userId,viaToken:actor.viaToken,expectedVersion}),JSON.stringify(attempt));return attempt;
    });
  }
  update(id:string,generation:number,change:(attempt:RebaseResumeAttempt)=>void):RebaseResumeAttempt {return this.storage.transactionSync(()=>{const attempt=this.get(id);if(!attempt||attempt.generation!==generation||this.latest(attempt.applicationId)?.id!==id)throw new RebaseRecoveryError("Saved recovery generation changed",409);change(attempt);this.storage.sql.exec("UPDATE rebase_resume_attempts SET doc=? WHERE id=?",JSON.stringify(attempt),id);return attempt;});}
  dispatch(id:string,generation:number,state:RebaseResumeAttempt["dispatch"]){return this.update(id,generation,a=>{if(a.dispatch==="observed"&&state!=="observed")return;if(state==="saved"&&a.dispatch!=="saved")throw new RebaseRecoveryError("Uncertain dispatch cannot be reset",409);a.dispatch=state;});}
  nativeIntent(id:string,generation:number){return this.update(id,generation,a=>{if(a.nativeState==="stopped"||a.terminal)throw new RebaseRecoveryError("Native execution has ended",409);a.nativeState="possible";});}
  nativeStopped(id:string,generation:number,nativeRunId:string){return this.update(id,generation,a=>{if(a.nativeRunId!==nativeRunId)throw new RebaseRecoveryError("Native execution identity changed",409);a.nativeState="stopped";});}
  terminal(id:string,generation:number,state:"completed"|"failed"){return this.update(id,generation,a=>{if(a.terminal&&a.terminal!==state)throw new RebaseRecoveryError("Terminal recovery outcome changed",409);a.terminal=state;});}
}
