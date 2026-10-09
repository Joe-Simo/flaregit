import { z } from "zod";
import { redactSecrets } from "../agents/prompt.js";
import { safeContent } from "./public-community.js";
import { isSafeRef } from "../core/sanitize.js";

export interface AcceptedDeploymentTarget { journalId:string;candidateId:string;commit:string;tree:string;acceptedAt:string;recoverableRef:string;acceptedRef?:string;acceptedRootVersion?:number }
/** Server-derived actual primary journal binding; never accept this from a client.
 * It permits reading an older exact receipt without rewriting its event metadata. */
export interface LegacyPrimaryDeploymentCompatibility { acceptedRef:string;journalId:string;commit:string;tree:string }
function sameDeploymentPayload(saved:string,target:AcceptedDeploymentTarget,serviceId:string,environment:string,compatibility?:LegacyPrimaryDeploymentCompatibility):boolean {
  const frozen=targetSchema.parse(target),payload=JSON.stringify({target:frozen,serviceId,environment:environment.trim()});
  if(saved===payload)return true;
  if(!compatibility||frozen.acceptedRef!==compatibility.acceptedRef||!compatibility.acceptedRef.startsWith("refs/heads/")||!isSafeRef(compatibility.acceptedRef)||frozen.journalId!==compatibility.journalId||frozen.commit!==compatibility.commit||frozen.tree!==compatibility.tree)return false;
  let previous:unknown;try{previous=JSON.parse(saved);}catch{return false;}
  const old=z.object({target:targetSchema,serviceId:z.string(),environment:z.string()}).strict().safeParse(previous);
  if(!old.success||old.data.target.acceptedRef!==undefined||old.data.target.acceptedRootVersion!==undefined)return false;
  const {acceptedRef:_ref,acceptedRootVersion:_version,...legacyTarget}=frozen;
  return JSON.stringify(old.data)===JSON.stringify({target:legacyTarget,serviceId,environment:environment.trim()});
}
export type DeploymentStatus="requested"|"queued"|"running"|"succeeded"|"failed"|"cancelled";
export interface DeploymentArtifact { artifactId:string;digest:string;environmentId:string;approvalId?:string;rollbackOf?:string }
export interface DeploymentEnvironment { id:string;name:string;revision:number;requireApproval:boolean }
export interface DeploymentRecord { requesterMembershipEpoch?:number;artifactSelector?:DeploymentArtifactParameters;artifact?:DeploymentArtifact; id:string;repositoryId:string;serviceId:string;environment:string;target:AcceptedDeploymentTarget;requestEventId:string;status:DeploymentStatus;sequence:number;summary?:string;detailsUrl?:string;createdAt:string;updatedAt:string }
export interface DeploymentRequestedEvent { id:string;type:"deployment.requested";createdAt:string;repositoryId:string;data:{deploymentId:string;serviceId:string;environment:string;commit:string;tree:string;acceptedJournalId:string;recoverableRef:string;acceptedRef?:string;acceptedRootVersion?:number;artifact?:DeploymentArtifact} }
const id=z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const environmentSchema=z.string().trim().min(1).max(100).refine(value=>!/[\x00-\x1f<>]/.test(value)&&redactSecrets(value)===value);
export const deploymentArtifactParametersSchema=z.object({releaseId:z.uuid(),assetId:z.uuid(),environmentId:id,approvalId:id.optional(),rollbackOf:id.optional()}).strict();
export type DeploymentArtifactParameters=z.infer<typeof deploymentArtifactParametersSchema>;
export const deploymentRequestParametersSchema=z.object({artifact:deploymentArtifactParametersSchema.optional(),journalId:id,serviceId:id,environment:environmentSchema,idempotencyKey:id}).strict();
const targetSchema=z.object({journalId:id,candidateId:id,commit:sha,tree:sha,acceptedAt:z.string().datetime(),recoverableRef:z.string().refine(value=>value.startsWith("refs/flaregit/deployments/")&&isSafeRef(value)),acceptedRef:z.string().refine(value=>value.startsWith("refs/heads/")&&isSafeRef(value)).optional(),acceptedRootVersion:z.number().int().positive().safe().optional()}).strict().refine(value=>value.acceptedRootVersion===undefined||value.acceptedRef!==undefined,"Accepted root version requires an explicit ref");
const link=z.string().url().max(2048).refine(value=>{try{const url=new URL(value);decodeURIComponent(value);if(url.protocol!=="https:"||url.username||url.password)return false;for(const [key,entry]of url.searchParams)if(/(?:^|[_-])(?:token|sig|signature|secret|password|api[_-]?key|credential|authorization)(?:$|[_-])/i.test(key)||redactSecrets(entry)!==entry)return false;return redactSecrets(decodeURIComponent(url.pathname+url.hash))===decodeURIComponent(url.pathname+url.hash);}catch{return false;}});
export const deploymentReportSchema=z.object({type:z.literal("deployment"),deploymentId:id,commit:sha,tree:sha,sequence:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),status:z.enum(["queued","running","succeeded","failed","cancelled"]),summary:z.string().max(4000).refine(value=>{try{safeContent(value);return true;}catch{return false;}}),detailsUrl:link.optional(),artifactId:id.optional(),digest:z.string().regex(/^[a-f0-9]{64}$/).optional(),environmentId:id.optional()}).strict();
export type DeploymentReport=z.infer<typeof deploymentReportSchema> & {eventId:string};
export type DeploymentApply={kind:"applied"|"duplicate";deployment:DeploymentRecord}|{kind:"rejected";reason:string};

/** No deploy executes here. The controller proves the accepted journal and pinned
 * recoverable Git ref before recording a request. Outbox staging is synchronous
 * and atomic with this record; delivery/replay belongs to the existing outbox.
 */
export class RepositoryDeployments {
  constructor(private readonly storage:DurableObjectStorage,private readonly repositoryId:string,private readonly canApprove:(actorId:string)=>boolean=()=>false,private readonly membershipEpoch:(actorId:string)=>number|null=()=>null){storage.sql.exec(`CREATE TABLE IF NOT EXISTS deployments(id TEXT PRIMARY KEY,doc TEXT NOT NULL);CREATE TABLE IF NOT EXISTS deployment_requests(actor_id TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,deployment_id TEXT NOT NULL,PRIMARY KEY(actor_id,event_key));CREATE TABLE IF NOT EXISTS deployment_receipts(service_id TEXT NOT NULL,event_id TEXT NOT NULL,payload TEXT NOT NULL,deployment_id TEXT NOT NULL,PRIMARY KEY(service_id,event_id));CREATE TABLE IF NOT EXISTS deployment_approval_fences(id TEXT PRIMARY KEY,membership_epoch INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS deployment_environments(id TEXT PRIMARY KEY,doc TEXT NOT NULL);CREATE TABLE IF NOT EXISTS deployment_approvals(id TEXT PRIMARY KEY,payload TEXT NOT NULL,actor_id TEXT NOT NULL,environment_revision INTEGER NOT NULL);`);}
  environments():DeploymentEnvironment[]{return this.storage.sql.exec<{doc:string}>("SELECT doc FROM deployment_environments ORDER BY id").toArray().map(row=>JSON.parse(row.doc) as DeploymentEnvironment);}
  configureEnvironment(input:{id:string;name:string;requireApproval:boolean},expectedRevision:number):DeploymentEnvironment{
    const parsed=z.object({id,name:environmentSchema,requireApproval:z.boolean()}).strict().parse(input);
    return this.storage.transactionSync(()=>{const rows=this.environments(),old=rows.find(row=>row.id===parsed.id);if(rows.some(row=>row.name===parsed.name&&row.id!==parsed.id))throw Error("Environment name already exists");if(!old&&rows.length>=100)throw Error("Environment limit reached");if((old?.revision??0)!==expectedRevision)throw Error("Environment revision changed");const next={...parsed,revision:expectedRevision+1};this.storage.sql.exec("INSERT OR REPLACE INTO deployment_environments VALUES(?,?)",next.id,JSON.stringify(next));return next;});
  }
  approve(target:AcceptedDeploymentTarget,artifact:Omit<DeploymentArtifact,"approvalId">,actorId:string):string{
    targetSchema.parse(target);id.parse(actorId);if(!this.canApprove(actorId))throw Error("Current owner approval authority required");this.validateArtifact(artifact);
    const environment=this.environments().find(row=>row.id===artifact.environmentId);if(!environment)throw Error("Deployment environment unavailable");
    const epoch=this.membershipEpoch(actorId);if(epoch===null||!Number.isSafeInteger(epoch)||epoch<1)throw Error("Current membership epoch required");
    return this.storage.transactionSync(()=>{const approvalId=`approval_${crypto.randomUUID()}`;this.storage.sql.exec("INSERT INTO deployment_approvals VALUES(?,?,?,?)",approvalId,JSON.stringify({target,artifact}),actorId,environment.revision);this.storage.sql.exec("INSERT INTO deployment_approval_fences VALUES(?,?)",approvalId,epoch);return approvalId;});
  }
  private validateArtifact(artifact:Omit<DeploymentArtifact,"approvalId">):void{z.object({artifactId:id,digest:z.string().regex(/^[a-f0-9]{64}$/),environmentId:id,rollbackOf:id.optional()}).strict().parse(artifact);}
  private authorizeArtifact(target:AcceptedDeploymentTarget,environmentName:string,binding:DeploymentArtifact):void{
    const {approvalId,...artifact}=binding;this.validateArtifact(artifact);
    const environment=this.environments().find(row=>row.id===artifact.environmentId);if(!environment||environment.name!==environmentName)throw Error("Exact deployment environment required");
    if(environment.requireApproval||approvalId){id.parse(approvalId);
    const approval=this.storage.sql.exec<{payload:string;environment_revision:number;actor_id:string}>("SELECT payload,environment_revision,actor_id FROM deployment_approvals WHERE id=?",approvalId!).toArray()[0];
    const fence=this.storage.sql.exec<{membership_epoch:number}>("SELECT membership_epoch FROM deployment_approval_fences WHERE id=?",approvalId!).toArray()[0];
    if(!approval||!fence||fence.membership_epoch!==this.membershipEpoch(approval.actor_id)||approval.payload!==JSON.stringify({target,artifact})||approval.environment_revision!==environment.revision||!this.canApprove(approval.actor_id))throw Error("Fresh exact artifact approval required");}
    if(artifact.rollbackOf){const previous=this.get(artifact.rollbackOf);if(!previous?.artifact||previous.status!=="succeeded"||previous.artifact.environmentId!==artifact.environmentId||previous.artifact.artifactId!==artifact.artifactId||previous.artifact.digest!==artifact.digest||JSON.stringify(previous.target)!==JSON.stringify(target))throw Error("Rollback must restore an observed exact artifact in the same environment");}
  }
  assertDispatchable(deploymentId:string,eventId:string):void{
    const record=this.get(deploymentId);if(!record||record.requestEventId!==eventId)throw Error("Saved deployment intent unavailable");
    if(record.artifact)this.authorizeArtifact(record.target,record.environment,record.artifact);else if(this.environments().some(row=>row.name===record.environment))throw Error("Current environment requires an approved artifact");
  }
  dispatchAuthority(deploymentId:string,eventId:string){
    this.assertDispatchable(deploymentId,eventId);const record=this.get(deploymentId)!;
    const requester=this.storage.sql.exec<{actor_id:string}>("SELECT actor_id FROM deployment_requests WHERE deployment_id=?",deploymentId).toArray()[0]?.actor_id;
    if(!requester||!this.canApprove(requester)||record.requesterMembershipEpoch===undefined||record.requesterMembershipEpoch!==this.membershipEpoch(requester))throw Error("Original deployment requester membership authority required");
    const approval=record.artifact?.approvalId?this.storage.sql.exec<{actor_id:string;payload:string;environment_revision:number}>("SELECT actor_id,payload,environment_revision FROM deployment_approvals WHERE id=?",record.artifact.approvalId).toArray()[0]:undefined;
    return{actors:[...new Set([requester,...(approval?[approval.actor_id]:[])])],identity:JSON.stringify({record,approval,epochs:[requester,...(approval?[approval.actor_id]:[])].map(actorId=>this.membershipEpoch(actorId)),environment:this.environments().find(row=>row.name===record.environment)})};
  }
  get(deploymentId:string):DeploymentRecord|null{const row=this.storage.sql.exec<{doc:string}>("SELECT doc FROM deployments WHERE id=?",deploymentId).toArray()[0];return row?JSON.parse(row.doc) as DeploymentRecord:null;}
  list():DeploymentRecord[]{return this.storage.sql.exec<{doc:string}>("SELECT doc FROM deployments ORDER BY id").toArray().map(row=>JSON.parse(row.doc) as DeploymentRecord);}
  existingRequest(target: AcceptedDeploymentTarget, serviceId: string, environment: string, key: string, actorId: string, compatibility?: LegacyPrimaryDeploymentCompatibility,artifactSelector?:DeploymentArtifactParameters): DeploymentRecord | null {
    const row=this.storage.sql.exec<{payload:string;deployment_id:string}>("SELECT payload,deployment_id FROM deployment_requests WHERE actor_id=? AND event_key=?",actorId,key).toArray()[0];
    if(!row)return null;
    if(!sameDeploymentPayload(row.payload,target,serviceId,environment,compatibility))throw new Error("Deployment request key belongs to different accepted state");
    const record=this.get(row.deployment_id);if(!record)throw new Error("Saved deployment receipt is unavailable");if(record.artifact&&!record.artifactSelector)throw Error("Historical deployment artifact selector cannot be proven");if(JSON.stringify(record.artifactSelector)!==JSON.stringify(artifactSelector?deploymentArtifactParametersSchema.parse(artifactSelector):undefined))throw Error("Saved deployment artifact selector cannot be proven");return record;
  }
  request(target:AcceptedDeploymentTarget,serviceId:string,environment:string,idempotencyKey:string,actorId:string,stage:(event:DeploymentRequestedEvent)=>void,compatibility?:LegacyPrimaryDeploymentCompatibility,artifact?:DeploymentArtifact,artifactSelector?:DeploymentArtifactParameters){
    const frozen=targetSchema.parse(target);id.parse(serviceId);id.parse(actorId);id.parse(idempotencyKey);
    if(typeof environment!=="string"||!environment.trim()||environment.length>100||/[\x00-\x1f<>]/.test(environment)||redactSecrets(environment)!==environment)throw new Error("Invalid deployment environment");
    return this.storage.transactionSync(()=>{
      const payload=JSON.stringify({target:frozen,serviceId,environment:environment.trim()});
      const previous=this.storage.sql.exec<{payload:string;deployment_id:string}>("SELECT payload,deployment_id FROM deployment_requests WHERE actor_id=? AND event_key=?",actorId,idempotencyKey).toArray()[0];
      if(previous){const saved=this.get(previous.deployment_id);if(JSON.stringify(saved?.artifactSelector)!==JSON.stringify(artifactSelector?deploymentArtifactParametersSchema.parse(artifactSelector):undefined))throw Error("Deployment request artifact selector identity changed");if(JSON.stringify(saved?.artifact)!==JSON.stringify(artifact))throw Error("Deployment request key belongs to a different artifact");if(!sameDeploymentPayload(previous.payload,frozen,serviceId,environment,compatibility))throw new Error("Deployment request key belongs to different accepted state");const record=this.get(previous.deployment_id);if(!record)throw new Error("Saved deployment receipt is unavailable");return{kind:"duplicate" as const,deployment:record};}
      if(artifactSelector){const selector=deploymentArtifactParametersSchema.parse(artifactSelector);if(!artifact||selector.assetId!==artifact.artifactId||selector.environmentId!==artifact.environmentId||selector.approvalId!==artifact.approvalId||selector.rollbackOf!==artifact.rollbackOf)throw Error("Deployment selector differs from resolved artifact");}
      if(artifact)this.authorizeArtifact(frozen,environment.trim(),artifact);else if(this.environments().some(row=>row.name===environment.trim()))throw Error("Configured environments require an exact approved artifact");
      if(this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM deployments").toArray()[0]!.n>=1000)throw new Error("Deployment record limit reached");
      const requesterMembershipEpoch=this.membershipEpoch(actorId);if(requesterMembershipEpoch!==null&&(!Number.isSafeInteger(requesterMembershipEpoch)||requesterMembershipEpoch<1||!this.canApprove(actorId)))throw Error("Current deployment requester membership epoch required");
      const now=new Date().toISOString(),record:DeploymentRecord={id:`deploy_${crypto.randomUUID()}`,...(requesterMembershipEpoch!==null?{requesterMembershipEpoch}:{}),repositoryId:this.repositoryId,serviceId,environment:environment.trim(),target:frozen,requestEventId:`evt_${crypto.randomUUID()}`,...(artifact?{artifact}:{}),...(artifactSelector?{artifactSelector:deploymentArtifactParametersSchema.parse(artifactSelector)}:{}),status:"requested",sequence:-1,createdAt:now,updatedAt:now};
      this.storage.sql.exec("INSERT INTO deployments VALUES(?,?)",record.id,JSON.stringify(record));this.storage.sql.exec("INSERT INTO deployment_requests VALUES(?,?,?,?)",actorId,idempotencyKey,payload,record.id);
      stage({id:record.requestEventId,type:"deployment.requested",createdAt:now,repositoryId:this.repositoryId,data:{deploymentId:record.id,serviceId,environment:record.environment,commit:frozen.commit,tree:frozen.tree,...(artifact?{artifact}:{}),acceptedJournalId:frozen.journalId,recoverableRef:frozen.recoverableRef,...(frozen.acceptedRef?{acceptedRef:frozen.acceptedRef}:{}),...(frozen.acceptedRootVersion!==undefined?{acceptedRootVersion:frozen.acceptedRootVersion}:{})}});
      return{kind:"created" as const,deployment:record};
    });
  }
  apply(input:DeploymentReport,authenticatedServiceId:string):DeploymentApply{
    const {eventId,...body}=input;id.parse(eventId);const report=deploymentReportSchema.parse(body);
    return this.storage.transactionSync(()=>{
      const record=this.get(report.deploymentId);if(!record||record.serviceId!==authenticatedServiceId)return{kind:"rejected",reason:"Deployment is unavailable to this service"};
      if(record.artifact&&(report.artifactId!==record.artifact.artifactId||report.digest!==record.artifact.digest||report.environmentId!==record.artifact.environmentId))return{kind:"rejected",reason:"Deployment receipt does not match exact artifact and environment"};
      if(record.target.commit!==report.commit||record.target.tree!==report.tree)return{kind:"rejected",reason:"Deployment report does not match accepted committed state"};
      const payload=JSON.stringify(report),prior=this.storage.sql.exec<{payload:string;deployment_id:string}>("SELECT payload,deployment_id FROM deployment_receipts WHERE service_id=? AND event_id=?",authenticatedServiceId,eventId).toArray()[0];
      if(prior)return prior.payload===payload&&prior.deployment_id===record.id?{kind:"duplicate",deployment:record}:{kind:"rejected",reason:"Deployment event identity reused with different contents"};
      if(report.sequence<=record.sequence||["succeeded","failed","cancelled"].includes(record.status)||(record.status==="running"&&report.status==="queued"))return{kind:"rejected",reason:"Deployment report is stale or deployment already finished"};
      const next:DeploymentRecord={...record,status:report.status,sequence:report.sequence,summary:report.summary,...(report.detailsUrl?{detailsUrl:report.detailsUrl}:{}),updatedAt:new Date().toISOString()};
      this.storage.sql.exec("UPDATE deployments SET doc=? WHERE id=?",JSON.stringify(next),record.id);this.storage.sql.exec("INSERT INTO deployment_receipts VALUES(?,?,?,?)",authenticatedServiceId,eventId,payload,record.id);return{kind:"applied",deployment:next};
    });
  }
}
