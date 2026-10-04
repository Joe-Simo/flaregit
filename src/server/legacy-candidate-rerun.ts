import { z } from "zod";
import { createHash } from "node:crypto";
import { isSafeSha } from "../core/sanitize.js";
import type { CandidateGeneration, HumanDecisionActor, Task } from "../core/types.js";

export interface LegacyRerunSnapshot {
  projectId: string; incarnation: string; canonicalRepoName: string;
  candidate: CandidateGeneration;
  tasks: (Pick<Task,"id"|"currentCommit"|"baseCommit"|"dependsOn"|"status"|"activeCandidateId"|"agentRunId"> & {workspace:Pick<Task["workspace"],"repoName"|"branch">})[];
  publicationBlocked: boolean; busy: boolean;
}
export interface LegacyCandidateRerun {
  id: string; predecessorCandidateId: string; expectedCommit: string|null;
  successorWorkflowId: string; successorDecisionId?:string; decisionIds?:string[]; continuationWorkflowId?:string; continuationActor?:HumanDecisionActor; continuationCredentialHash?:string; successorCandidateId?: string; taskIds: string[];
  actor: HumanDecisionActor; credentialHash?: string; sessionExpiresAt?: number;
  snapshot: LegacyRerunSnapshot; phase: "prepared"|"stopped"|"reassigned"|"attached"|"abandoned"|"awaiting_decision";
  dispatch:"not_started"|"unknown"|"observed";
  abandoned?:{by:HumanDecisionActor;at:string};
  terminalState?: "complete"|"errored"|"terminated"; vmStopped?: true; createdAt: string;
}
export class LegacyRerunError extends Error { constructor(message:string, readonly status:409|429=409){super(message);} }
export function assertLegacyRerunEligible(snapshot:LegacyRerunSnapshot,expectedCommit:string|null):void {
  const candidate=snapshot.candidate;
  if(candidate.status==="accepted"||snapshot.publicationBlocked||snapshot.busy||(candidate.preservationProtocolVersion===1&&!["composing","repairing","verifying","failed","stale"].includes(candidate.status)))throw new LegacyRerunError("This candidate cannot be rerun while accepted or publication is pending.");
  if(!snapshot.incarnation||!candidate.workflowInstanceId||(expectedCommit===null?candidate.candidateCommit!==undefined:!/^([a-f0-9]{40})$/.test(expectedCommit)||candidate.candidateCommit!==expectedCommit))throw new LegacyRerunError("The original candidate identity changed.");
  const ids=candidate.participatingTaskIds;
  if(ids.length<1||ids.length>8||new Set(ids).size!==ids.length||snapshot.tasks.length!==ids.length)throw new LegacyRerunError("Frozen contribution scope is unavailable.");
  for(const id of ids){
    const task=snapshot.tasks.find(value=>value.id===id), proofs=candidate.frozenContributorProofs?.filter(value=>value.id===id);
    if(!task||proofs?.length!==1||proofs[0]!.commit!==candidate.participatingCommits[id]||!(proofs[0]!.baseCommit===null||isSafeSha(proofs[0]!.baseCommit))||!isSafeSha(proofs[0]!.commit)||task.currentCommit!==proofs[0]!.commit||task.baseCommit!==proofs[0]!.baseCommit||task.activeCandidateId!==candidate.id||["accepted","cancelled","working","checkpointed","needs_decision"].includes(task.status))throw new LegacyRerunError("Saved contribution inputs or assignment changed; no base is inferred.");
  }
}
export function legacyRerunInputFingerprint(inputs:Record<string,{commit:string;base:string|null}>):string {const keys=Object.keys(inputs).sort();if(!keys.length||keys.length>8||keys.some(key=>!isSafeSha(inputs[key]?.commit)||!(inputs[key]?.base===null||isSafeSha(inputs[key]?.base))))throw new LegacyRerunError("Exact frozen contribution inputs are required.");return createHash("sha256").update(JSON.stringify(keys.map(key=>[key,inputs[key]!.commit,inputs[key]!.base]))).digest("hex");}
export class LegacyCandidateReruns {
  constructor(private readonly storage:DurableObjectStorage){
    storage.sql.exec("CREATE TABLE IF NOT EXISTS legacy_candidate_reruns(id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,workflow_id TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,doc TEXT NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS legacy_candidate_rerun_workflows(workflow_id TEXT PRIMARY KEY,rerun_id TEXT NOT NULL)");
    storage.sql.exec("CREATE INDEX IF NOT EXISTS legacy_rerun_candidate ON legacy_candidate_reruns(candidate_id)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS legacy_candidate_rerun_active(candidate_id TEXT PRIMARY KEY,rerun_id TEXT UNIQUE NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS legacy_candidate_rerun_reservations(task_id TEXT PRIMARY KEY,rerun_id TEXT NOT NULL)");
    storage.sql.exec("CREATE INDEX IF NOT EXISTS legacy_rerun_reservation_owner ON legacy_candidate_rerun_reservations(rerun_id)");
  }
  private boundedRows(where:string,bindings:Array<string|number>,limit=1):Array<{payload:string;doc:string}>{
    const sizes=this.storage.sql.exec<{id:string;bytes:number}>(`SELECT id,length(CAST(doc AS BLOB))+length(CAST(payload AS BLOB)) AS bytes FROM legacy_candidate_reruns WHERE ${where} LIMIT ?`,...bindings,limit+1).toArray();
    if(sizes.length>limit||sizes.some(row=>row.bytes>128*1024)||sizes.reduce((sum,row)=>sum+row.bytes,0)>4*1024*1024)throw new LegacyRerunError("Saved rerun context exceeds the safe review limit.",429);
    if(!sizes.length)return [];
    return this.storage.sql.exec<{payload:string;doc:string}>(`SELECT payload,doc FROM legacy_candidate_reruns WHERE id IN (${sizes.map(()=>"?").join(",")}) LIMIT ?`,...sizes.map(row=>row.id),limit).toArray();
  }
  get(id:string):LegacyCandidateRerun|null{z.string().uuid().parse(id);const row=this.boundedRows("id=?",[id])[0];return row?JSON.parse(row.doc) as LegacyCandidateRerun:null;}
  hasCandidate(id:string):boolean{return this.storage.sql.exec("SELECT id FROM legacy_candidate_reruns WHERE candidate_id=? LIMIT 1",id).toArray().length>0;}
  forCandidate(id:string):LegacyCandidateRerun|null{const row=this.boundedRows("id=(SELECT id FROM legacy_candidate_reruns WHERE candidate_id=? ORDER BY rowid DESC LIMIT 1)",[id])[0];return row?JSON.parse(row.doc) as LegacyCandidateRerun:null;}
  forWorkflow(id:string):LegacyCandidateRerun|null{const row=this.boundedRows("workflow_id=? OR id=(SELECT rerun_id FROM legacy_candidate_rerun_workflows WHERE workflow_id=?)",[id,id])[0];return row?JSON.parse(row.doc) as LegacyCandidateRerun:null;}
  reservedForTasks(ids:string[]):LegacyCandidateRerun[]{
    if(!ids.length||ids.length>8||new Set(ids).size!==ids.length)throw new LegacyRerunError("One to eight distinct contribution identities are required.");
    return this.boundedRows(`id IN (SELECT rerun_id FROM legacy_candidate_rerun_reservations WHERE task_id IN (${ids.map(()=>"?").join(",")}))`,ids,8).map(row=>JSON.parse(row.doc) as LegacyCandidateRerun);
  }
  prepare(input:{id:string;expectedCommit:string|null;actor:HumanDecisionActor;snapshot:LegacyRerunSnapshot;credentialHash?:string;sessionExpiresAt?:number;expectedInputs:Record<string,{commit:string;base:string|null}>}):LegacyCandidateRerun {
    z.string().uuid().parse(input.id);const inputFingerprint=legacyRerunInputFingerprint(input.expectedInputs);
    return this.storage.transactionSync(()=>{
      const row=this.boundedRows("id=?",[input.id])[0],saved=row?JSON.parse(row.doc) as LegacyCandidateRerun:null;
      const snapshotFingerprint=createHash("sha256").update(JSON.stringify(saved?.snapshot??input.snapshot)).digest("hex");
      const payload=JSON.stringify({candidateId:input.snapshot.candidate.id,expectedCommit:input.expectedCommit,userId:input.actor.userId,viaToken:input.actor.viaToken,incarnation:input.snapshot.incarnation,inputFingerprint,snapshotFingerprint});
      if(row&&saved){if(row.payload!==payload)throw new LegacyRerunError("Request identity belongs to another rerun.");if(input.snapshot.projectId!==saved.snapshot.projectId||input.snapshot.canonicalRepoName!==saved.snapshot.canonicalRepoName||JSON.stringify(input.snapshot.candidate)!==JSON.stringify(saved.snapshot.candidate)||(["prepared","stopped"].includes(saved.phase)&&JSON.stringify(input.snapshot)!==JSON.stringify(saved.snapshot)))throw new LegacyRerunError("The frozen rerun context changed.");return saved;}
      assertLegacyRerunEligible(input.snapshot,input.expectedCommit);
      const frozen:Record<string,{commit:string;base:string|null}>={};for(const proof of input.snapshot.candidate.frozenContributorProofs??[])frozen[proof.id]={commit:proof.commit,base:proof.baseCommit};if(legacyRerunInputFingerprint(frozen)!==inputFingerprint)throw new LegacyRerunError("The observed frozen contribution inputs changed.");
      const existing=this.storage.sql.exec("SELECT rerun_id FROM legacy_candidate_rerun_active WHERE candidate_id=? LIMIT 1",input.snapshot.candidate.id).toArray();
      if(existing.length)throw new LegacyRerunError("A saved rerun already exists for this candidate.");
      if(this.storage.sql.exec<{count:number}>("SELECT COUNT(*) AS count FROM legacy_candidate_reruns").toArray()[0]!.count>=10_000)throw new LegacyRerunError("Rerun audit capacity reached; saved requests remain available.",429);
      const value:LegacyCandidateRerun={id:input.id,predecessorCandidateId:input.snapshot.candidate.id,expectedCommit:input.expectedCommit,successorWorkflowId:`legacy-${input.id}`,taskIds:[...input.snapshot.candidate.participatingTaskIds],actor:structuredClone(input.actor),snapshot:structuredClone(input.snapshot),credentialHash:input.credentialHash,sessionExpiresAt:input.sessionExpiresAt,phase:"prepared",dispatch:"not_started",createdAt:new Date().toISOString()};
      const doc=JSON.stringify(value);if(new TextEncoder().encode(doc+payload).byteLength>128*1024)throw new LegacyRerunError("Frozen rerun context exceeds the safe review limit.",429);
      if(this.reservedForTasks(value.taskIds).length)throw new LegacyRerunError("These contributions already belong to a saved rerun.");
      this.storage.sql.exec("INSERT INTO legacy_candidate_reruns VALUES(?,?,?,?,?)",value.id,value.predecessorCandidateId,value.successorWorkflowId,payload,doc);
      this.storage.sql.exec("INSERT INTO legacy_candidate_rerun_active VALUES(?,?)",value.predecessorCandidateId,value.id);
      for(const taskId of value.taskIds)this.storage.sql.exec("INSERT INTO legacy_candidate_rerun_reservations VALUES(?,?)",taskId,value.id);return value;
    });
  }
  awaitDecision(id:string,decisionId:string):LegacyCandidateRerun{return this.storage.transactionSync(()=>{const value=this.get(id);if(!value||value.phase!=="reassigned"||value.successorCandidateId)throw new LegacyRerunError("Saved rerun cannot enter this product decision.");if((value.decisionIds?.length??0)>=64)throw new LegacyRerunError("Rerun decision audit capacity reached.",429);value.phase="awaiting_decision";value.successorDecisionId=decisionId;value.decisionIds=[...(value.decisionIds??[]),decisionId];this.save(value);this.storage.sql.exec("DELETE FROM legacy_candidate_rerun_reservations WHERE rerun_id=?",value.id);return value;});}
  continueDecision(id:string,decisionId:string,workflowId:string,actor:HumanDecisionActor,credentialHash?:string):LegacyCandidateRerun{return this.storage.transactionSync(()=>{const value=this.get(id);if(!value||value.phase!=="awaiting_decision"||value.successorDecisionId!==decisionId)throw new LegacyRerunError("Product decision no longer owns this saved rerun.");if(this.reservedForTasks(value.taskIds).length)throw new LegacyRerunError("A contribution was assigned to other work during the decision.");value.continuationWorkflowId=workflowId;value.continuationActor=structuredClone(actor);value.continuationCredentialHash=credentialHash;value.phase="reassigned";this.storage.sql.exec("INSERT INTO legacy_candidate_rerun_workflows VALUES(?,?)",workflowId,value.id);for(const taskId of value.taskIds)this.storage.sql.exec("INSERT INTO legacy_candidate_rerun_reservations VALUES(?,?)",taskId,value.id);this.save(value);return value;});}
  markDispatch(id:string,dispatch:"unknown"|"observed"):LegacyCandidateRerun{if(dispatch!=="unknown"&&dispatch!=="observed")throw new LegacyRerunError("Invalid dispatch observation.");return this.storage.transactionSync(()=>{const value=this.get(id);if(!value||value.phase==="abandoned"||!["reassigned","attached","awaiting_decision"].includes(value.phase))throw new LegacyRerunError("Rerun dispatch scope is unavailable.");if(value.dispatch!=="observed")value.dispatch=dispatch;this.save(value);return value;});}
  abandon(id:string,actor:HumanDecisionActor):LegacyCandidateRerun{return this.storage.transactionSync(()=>{const value=this.get(id);if(!value)throw new LegacyRerunError("Saved rerun is unavailable.");if(value.phase==="abandoned")return value;if(value.dispatch!=="not_started"||value.successorCandidateId||value.phase==="attached")throw new LegacyRerunError("A dispatched or uncertain rerun cannot be abandoned.");if(!value.vmStopped||!value.terminalState||!["stopped","reassigned"].includes(value.phase))throw new LegacyRerunError("Stopped execution must be confirmed before abandonment.");value.phase="abandoned";value.abandoned={by:structuredClone(actor),at:new Date().toISOString()};this.save(value);return value;});}
  save(value:LegacyCandidateRerun):void{const doc=JSON.stringify(value);const payloadBytes=this.storage.sql.exec<{bytes:number}>("SELECT length(CAST(payload AS BLOB)) AS bytes FROM legacy_candidate_reruns WHERE id=?",value.id).toArray()[0]?.bytes??0;if(new TextEncoder().encode(doc).byteLength+payloadBytes>128*1024)throw new LegacyRerunError("Saved rerun context exceeds the safe review limit.",429);this.storage.transactionSync(()=>{this.storage.sql.exec("UPDATE legacy_candidate_reruns SET doc=? WHERE id=?",doc,value.id);if(value.phase==="attached"||value.phase==="abandoned")this.storage.sql.exec("DELETE FROM legacy_candidate_rerun_reservations WHERE rerun_id=?",value.id);if(value.phase==="abandoned")this.storage.sql.exec("DELETE FROM legacy_candidate_rerun_active WHERE candidate_id=? AND rerun_id=?",value.predecessorCandidateId,value.id);});}
}
