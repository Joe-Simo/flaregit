import { z } from "zod";
import { redactSecrets } from "../agents/prompt.js";
import { safeContent } from "./public-community.js";
import { isSafeRef } from "../core/sanitize.js";

export interface AcceptedDeploymentTarget { journalId:string;candidateId:string;commit:string;tree:string;acceptedAt:string;recoverableRef:string }
export type DeploymentStatus="requested"|"queued"|"running"|"succeeded"|"failed"|"cancelled";
export interface DeploymentRecord { id:string;repositoryId:string;serviceId:string;environment:string;target:AcceptedDeploymentTarget;requestEventId:string;status:DeploymentStatus;sequence:number;summary?:string;detailsUrl?:string;createdAt:string;updatedAt:string }
export interface DeploymentRequestedEvent { id:string;type:"deployment.requested";createdAt:string;repositoryId:string;data:{deploymentId:string;serviceId:string;environment:string;commit:string;tree:string;acceptedJournalId:string;recoverableRef:string} }
const id=z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const environmentSchema=z.string().trim().min(1).max(100).refine(value=>!/[\x00-\x1f<>]/.test(value)&&redactSecrets(value)===value);
export const deploymentRequestParametersSchema=z.object({journalId:id,serviceId:id,environment:environmentSchema,idempotencyKey:id}).strict();
const targetSchema=z.object({journalId:id,candidateId:id,commit:sha,tree:sha,acceptedAt:z.string().datetime(),recoverableRef:z.string().refine(value=>value.startsWith("refs/flaregit/deployments/")&&isSafeRef(value))}).strict();
const link=z.string().url().max(2048).refine(value=>{try{const url=new URL(value);decodeURIComponent(value);if(url.protocol!=="https:"||url.username||url.password)return false;for(const [key,entry]of url.searchParams)if(/(?:^|[_-])(?:token|sig|signature|secret|password|api[_-]?key|credential|authorization)(?:$|[_-])/i.test(key)||redactSecrets(entry)!==entry)return false;return redactSecrets(decodeURIComponent(url.pathname+url.hash))===decodeURIComponent(url.pathname+url.hash);}catch{return false;}});
export const deploymentReportSchema=z.object({type:z.literal("deployment"),deploymentId:id,commit:sha,tree:sha,sequence:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),status:z.enum(["queued","running","succeeded","failed","cancelled"]),summary:z.string().max(4000).refine(value=>{try{safeContent(value);return true;}catch{return false;}}),detailsUrl:link.optional()}).strict();
export type DeploymentReport=z.infer<typeof deploymentReportSchema> & {eventId:string};
export type DeploymentApply={kind:"applied"|"duplicate";deployment:DeploymentRecord}|{kind:"rejected";reason:string};

/** No deploy executes here. The controller proves the accepted journal and pinned
 * recoverable Git ref before recording a request. Outbox staging is synchronous
 * and atomic with this record; delivery/replay belongs to the existing outbox.
 */
export class RepositoryDeployments {
  constructor(private readonly storage:DurableObjectStorage,private readonly repositoryId:string){storage.sql.exec(`CREATE TABLE IF NOT EXISTS deployments(id TEXT PRIMARY KEY,doc TEXT NOT NULL);CREATE TABLE IF NOT EXISTS deployment_requests(actor_id TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,deployment_id TEXT NOT NULL,PRIMARY KEY(actor_id,event_key));CREATE TABLE IF NOT EXISTS deployment_receipts(service_id TEXT NOT NULL,event_id TEXT NOT NULL,payload TEXT NOT NULL,deployment_id TEXT NOT NULL,PRIMARY KEY(service_id,event_id));`);}
  get(deploymentId:string):DeploymentRecord|null{const row=this.storage.sql.exec<{doc:string}>("SELECT doc FROM deployments WHERE id=?",deploymentId).toArray()[0];return row?JSON.parse(row.doc) as DeploymentRecord:null;}
  list():DeploymentRecord[]{return this.storage.sql.exec<{doc:string}>("SELECT doc FROM deployments ORDER BY id").toArray().map(row=>JSON.parse(row.doc) as DeploymentRecord);}
  existingRequest(target: AcceptedDeploymentTarget, serviceId: string, environment: string, key: string, actorId: string): DeploymentRecord | null {
    const row=this.storage.sql.exec<{payload:string;deployment_id:string}>("SELECT payload,deployment_id FROM deployment_requests WHERE actor_id=? AND event_key=?",actorId,key).toArray()[0];
    if(!row)return null;
    if(row.payload!==JSON.stringify({target:targetSchema.parse(target),serviceId,environment:environment.trim()}))throw new Error("Deployment request key belongs to different accepted state");
    return this.get(row.deployment_id);
  }
  request(target:AcceptedDeploymentTarget,serviceId:string,environment:string,idempotencyKey:string,actorId:string,stage:(event:DeploymentRequestedEvent)=>void){
    const frozen=targetSchema.parse(target);id.parse(serviceId);id.parse(actorId);id.parse(idempotencyKey);
    if(typeof environment!=="string"||!environment.trim()||environment.length>100||/[\x00-\x1f<>]/.test(environment)||redactSecrets(environment)!==environment)throw new Error("Invalid deployment environment");
    return this.storage.transactionSync(()=>{
      const payload=JSON.stringify({target:frozen,serviceId,environment:environment.trim()});
      const previous=this.storage.sql.exec<{payload:string;deployment_id:string}>("SELECT payload,deployment_id FROM deployment_requests WHERE actor_id=? AND event_key=?",actorId,idempotencyKey).toArray()[0];
      if(previous){if(previous.payload!==payload)throw new Error("Deployment request key belongs to different accepted state");return{kind:"duplicate" as const,deployment:this.get(previous.deployment_id)!};}
      if(this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM deployments").toArray()[0]!.n>=1000)throw new Error("Deployment record limit reached");
      const now=new Date().toISOString(),record:DeploymentRecord={id:`deploy_${crypto.randomUUID()}`,repositoryId:this.repositoryId,serviceId,environment:environment.trim(),target:frozen,requestEventId:`evt_${crypto.randomUUID()}`,status:"requested",sequence:-1,createdAt:now,updatedAt:now};
      this.storage.sql.exec("INSERT INTO deployments VALUES(?,?)",record.id,JSON.stringify(record));this.storage.sql.exec("INSERT INTO deployment_requests VALUES(?,?,?,?)",actorId,idempotencyKey,payload,record.id);
      stage({id:record.requestEventId,type:"deployment.requested",createdAt:now,repositoryId:this.repositoryId,data:{deploymentId:record.id,serviceId,environment:record.environment,commit:frozen.commit,tree:frozen.tree,acceptedJournalId:frozen.journalId,recoverableRef:frozen.recoverableRef}});
      return{kind:"created" as const,deployment:record};
    });
  }
  apply(input:DeploymentReport,authenticatedServiceId:string):DeploymentApply{
    const {eventId,...body}=input;id.parse(eventId);const report=deploymentReportSchema.parse(body);
    return this.storage.transactionSync(()=>{
      const record=this.get(report.deploymentId);if(!record||record.serviceId!==authenticatedServiceId)return{kind:"rejected",reason:"Deployment is unavailable to this service"};
      if(record.target.commit!==report.commit||record.target.tree!==report.tree)return{kind:"rejected",reason:"Deployment report does not match accepted committed state"};
      const payload=JSON.stringify(report),prior=this.storage.sql.exec<{payload:string;deployment_id:string}>("SELECT payload,deployment_id FROM deployment_receipts WHERE service_id=? AND event_id=?",authenticatedServiceId,eventId).toArray()[0];
      if(prior)return prior.payload===payload&&prior.deployment_id===record.id?{kind:"duplicate",deployment:record}:{kind:"rejected",reason:"Deployment event identity reused with different contents"};
      if(report.sequence<=record.sequence||["succeeded","failed","cancelled"].includes(record.status)||(record.status==="running"&&report.status==="queued"))return{kind:"rejected",reason:"Deployment report is stale or deployment already finished"};
      const next:DeploymentRecord={...record,status:report.status,sequence:report.sequence,summary:report.summary,...(report.detailsUrl?{detailsUrl:report.detailsUrl}:{}),updatedAt:new Date().toISOString()};
      this.storage.sql.exec("UPDATE deployments SET doc=? WHERE id=?",JSON.stringify(next),record.id);this.storage.sql.exec("INSERT INTO deployment_receipts VALUES(?,?,?,?)",authenticatedServiceId,eventId,payload,record.id);return{kind:"applied",deployment:next};
    });
  }
}
