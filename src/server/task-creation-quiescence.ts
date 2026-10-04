import {z} from "zod";
import {taskCreationIntentSchema} from "./task-creation-intents";
import {initialForkCredentialScopeSchema} from "./initial-fork-credentials";
const id=z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const scopeSchema=z.object({projectId:id,incarnation:z.uuid(),canonicalRepoName:id,taskId:id,workspaceRepoName:id}).strict();
export type TaskCreationQuiescenceScope=z.infer<typeof scopeSchema>;
const ackSchema=z.object({providerRepoId:id,name:id,description:z.string().max(200),allocationId:z.uuid(),sourceRepoName:id,sourceCommit:z.string().regex(/^[a-f0-9]{40}$/).nullable(),emptySourceProof:z.object({ref:z.string().min(1).max(1024),refs:z.tuple([])}).strict().optional()}).strict().refine(value=>value.sourceCommit===null||value.emptySourceProof===undefined,"A committed source cannot also claim empty history");
const recordSchema=taskCreationIntentSchema.safeExtend({phase:z.literal("committed"),createdAt:z.number().int().nonnegative().safe(),updatedAt:z.number().int().nonnegative().safe(),providerRepoId:id});
const unavailable=()=>new Error("Original workspace issuance or cleanup coverage remains unverified");
/** Positive original creation coverage only. Legacy receipt presence, an empty
 * credential table or elapsed time never proves absence of an SDK-issued token.
 * Read-only: this function creates no coverage, tables, receipts or provider state. */
export function assertTaskCreationQuiescence(storage:DurableObjectStorage,rawScope:TaskCreationQuiescenceScope,validate:()=>void):{eventId:string;allocationId:string;providerRepoId:string;native:"not_allocated"}{
 const scope=scopeSchema.parse(rawScope);
 return storage.transactionSync(()=>{
  validate();const tables=new Set(storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('task_creation_intents','task_fork_acknowledgements','initial_fork_credentials')").toArray().map(row=>row.name));if(tables.size!==3)throw unavailable();
  const row=storage.sql.exec<{payload:string|null;doc:string|null}>("SELECT CASE WHEN LENGTH(CAST(payload AS BLOB))<=256000 THEN payload ELSE NULL END AS payload,CASE WHEN LENGTH(CAST(doc AS BLOB))<=262144 THEN doc ELSE NULL END AS doc FROM task_creation_intents WHERE task_id=?",scope.taskId).toArray()[0];if(!row?.doc||!row.payload)throw unavailable();
  let record:z.infer<typeof recordSchema>;try{record=recordSchema.parse(JSON.parse(row.doc));}catch{throw unavailable();}
  for(const key of ["projectId","incarnation","canonicalRepoName","taskId","workspaceRepoName"] as const)if(record[key]!==scope[key])throw unavailable();
  const {phase:_phase,createdAt:_createdAt,updatedAt:_updatedAt,providerRepoId:_providerRepoId,...intent}=record;if(JSON.stringify(taskCreationIntentSchema.parse(intent))!==row.payload)throw unavailable();
  const ackRow=storage.sql.exec<{payload:string|null}>("SELECT CASE WHEN LENGTH(CAST(payload AS BLOB))<=4096 THEN payload ELSE NULL END AS payload FROM task_fork_acknowledgements WHERE event_id=?",record.eventId).toArray()[0];if(!ackRow?.payload)throw unavailable();let ack:z.infer<typeof ackSchema>;try{ack=ackSchema.parse(JSON.parse(ackRow.payload));}catch{throw unavailable();}
  if(ack.providerRepoId!==record.providerRepoId||ack.name!==record.workspaceRepoName||ack.allocationId!==record.allocationId||ack.description!==`FlareGit creation ${record.eventId}/${record.allocationId}`||ack.sourceRepoName!==record.selection.sourceRepoName||ack.sourceCommit!==record.selection.baseCommit||(record.selection.baseCommit===null&&(!ack.emptySourceProof||ack.emptySourceProof.ref!==record.selection.acceptedTarget?.ref)))throw unavailable();
  const credentialScope=initialForkCredentialScopeSchema.parse({eventId:record.eventId,allocationId:record.allocationId,taskId:record.taskId,projectId:record.projectId,incarnation:record.incarnation,canonicalRepoName:record.canonicalRepoName,workspaceRepoName:record.workspaceRepoName,accountKey:record.accountKey,actorId:record.actor.userId});
  const credential=storage.sql.exec<{payload:string|null;status:string;fingerprint:string|null;cleared:number}>("SELECT CASE WHEN LENGTH(CAST(payload AS BLOB))<=4096 THEN payload ELSE NULL END AS payload,status,fingerprint,token IS NULL AS cleared FROM initial_fork_credentials WHERE event_id=?",record.eventId).toArray()[0];if(!credential||credential.payload!==JSON.stringify(credentialScope)||credential.status!=="revoked"||credential.cleared!==1||!credential.fingerprint||!/^[a-f0-9]{64}$/.test(credential.fingerprint))throw unavailable();
  validate();return{eventId:record.eventId,allocationId:record.allocationId,providerRepoId:record.providerRepoId,native:"not_allocated"};
 });
}
