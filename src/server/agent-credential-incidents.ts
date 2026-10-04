import { agentNativeAttemptSchema, type AgentNativeAttemptIdentity } from "./agent-runtime-ledger.js";
export type AgentCredentialStatus = 'issuance_unknown' | 'pending' | 'revoked' | 'expired_unverified';
export interface AgentCredentialScope extends AgentNativeAttemptIdentity { repoName: string; scope: 'read' | 'write' }
export interface PendingAgentCredential { id: string; context: AgentCredentialScope; token: string; expiresAt: number | null; attempts: number; automaticSweeps: number }
type Row = {id:string;payload:string;intent_expires_at:number;token:string|null;fingerprint:string|null;expires_at:number|null;status:AgentCredentialStatus;attempts:number;automatic_sweeps:number};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function time(now:number){if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid agent credential time');}
function identity(id:string){if(!uuid.test(id))throw Error('Invalid agent credential identity');}
function payload(value:AgentCredentialScope):string {
 if(!value || !['read','write'].includes(value.scope) || typeof value.repoName!=='string' || !value.repoName || value.repoName.length>200 || /[\x00-\x1f\x7f]/.test(value.repoName))throw Error('Invalid agent credential scope');
 const {repoName,scope,...attempt}=value;
 const checked=agentNativeAttemptSchema.parse(attempt);
 return JSON.stringify({...checked,repoName,scope});
}
async function fingerprint(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),value=>value.toString(16).padStart(2,'0')).join('');}
/** Trusted backend only. Revocation batches contain secrets and must never be exposed to clients or agent context. */
export class AgentCredentialIncidents {
 constructor(private readonly storage:DurableObjectStorage){storage.sql.exec("CREATE TABLE IF NOT EXISTS agent_credential_incidents(id TEXT PRIMARY KEY,payload TEXT NOT NULL,intent_expires_at INTEGER NOT NULL,token TEXT,fingerprint TEXT,expires_at INTEGER,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,automatic_sweeps INTEGER NOT NULL DEFAULT 0)");}
 private row(id:string){identity(id);return this.storage.sql.exec<Row>('SELECT * FROM agent_credential_incidents WHERE id=?',id).toArray()[0];}
 begin(id:string,context:AgentCredentialScope,expiresAt:number,validate:()=>void,now=Date.now()):boolean {
  identity(id);time(now);const scope=payload(context);
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+900000)throw Error('Invalid agent credential issuance lifetime');
  return this.storage.transactionSync(()=>{validate();const old=this.row(id);if(old){if(old.payload!==scope||old.intent_expires_at!==expiresAt)throw Error('Agent credential intent changed');return false;}
   if(this.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM agent_credential_incidents').one().n>=1000)throw Error('Agent credential incident limit reached');
   this.storage.sql.exec("INSERT INTO agent_credential_incidents(id,payload,intent_expires_at,status) VALUES(?,?,?,'issuance_unknown')",id,scope,expiresAt);return true;});
 }
 /** Cleanup authority is the immutable pre-issuance intent, even after membership/run authority withdrawal. */
 async record(id:string,context:AgentCredentialScope,token:string,expiresAt:number,now=Date.now()):Promise<void>{
  identity(id);time(now);const scope=payload(context);
  if(typeof token!=='string'||!token||token.length>16384||/[\r\n\0]/.test(token))throw Error('Invalid agent credential receipt');
  const digest=await fingerprint(token);
  this.storage.transactionSync(()=>{const row=this.row(id);if(!row||row.payload!==scope)throw Error('Agent credential receipt has no exact issuance intent');
   const expiry=Number.isSafeInteger(expiresAt)&&expiresAt>=0&&expiresAt<=now+31536000000?expiresAt:null;
   if(row.fingerprint){if(row.fingerprint!==digest||row.expires_at!==expiry||(row.token!==null&&row.token!==token))throw Error('Agent credential receipt changed');return;}
   const expired=expiry!==null&&expiry<=now;
   this.storage.sql.exec('UPDATE agent_credential_incidents SET token=?,fingerprint=?,expires_at=?,status=? WHERE id=?',expired?null:token,digest,expiry,expired?'expired_unverified':'pending',id);});
 }
 private expire(now:number){time(now);this.storage.sql.exec("UPDATE agent_credential_incidents SET token=NULL,status='expired_unverified' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at<=?",now);}
 private pending(row:Row):PendingAgentCredential{return{id:row.id,context:JSON.parse(row.payload) as AgentCredentialScope,token:row.token!,expiresAt:row.expires_at,attempts:row.attempts,automaticSweeps:row.automatic_sweeps};}
 pendingBatch(now=Date.now()):PendingAgentCredential[]{return this.storage.transactionSync(()=>{this.expire(now);return this.storage.sql.exec<Row>("SELECT * FROM agent_credential_incidents WHERE status='pending' AND attempts<4 AND automatic_sweeps<4 ORDER BY COALESCE(expires_at,9223372036854775807),id LIMIT 20").toArray().map(row=>this.pending(row));});}
 credentialForRevocation(id:string,now=Date.now()):PendingAgentCredential|null{return this.storage.transactionSync(()=>{this.expire(now);const row=this.row(id);return row?.status==='pending'&&row.token&&row.attempts<4?this.pending(row):null;});}
 markAutomaticSweep(id:string):boolean{return this.storage.transactionSync(()=>{const row=this.row(id);if(!row||row.status!=='pending'||row.automatic_sweeps>=4||row.attempts>=4)return false;this.storage.sql.exec('UPDATE agent_credential_incidents SET automatic_sweeps=automatic_sweeps+1 WHERE id=?',id);return true;});}
 markAttempt(id:string):boolean{return this.storage.transactionSync(()=>{const row=this.row(id);if(!row||row.status!=='pending'||row.attempts>=4)return false;this.storage.sql.exec('UPDATE agent_credential_incidents SET attempts=attempts+1 WHERE id=?',id);return true;});}
 async markRevoked(id:string,token:string):Promise<void>{const digest=await fingerprint(token);this.storage.transactionSync(()=>{const row=this.row(id);if(!row||row.fingerprint!==digest||(row.token!==null&&row.token!==token))throw Error('Agent credential revocation receipt mismatch');if(row.status==='expired_unverified')throw Error('Agent credential expiry is unverified');this.storage.sql.exec("UPDATE agent_credential_incidents SET token=NULL,status='revoked' WHERE id=?",id);});}
 nextAlarm(now=Date.now()):number|null{return this.storage.transactionSync(()=>{this.expire(now);let wake:number|null=null;for(const row of this.storage.sql.exec<Row>("SELECT * FROM agent_credential_incidents WHERE status='pending'").toArray()){const retry=row.attempts<4&&row.automatic_sweeps<4?now+120000:null;const next=retry===null?row.expires_at:row.expires_at===null?retry:Math.min(retry,row.expires_at);if(next!==null&&(wake===null||next<wake))wake=next;}return wake;});}
 context(id:string):AgentCredentialScope|null{const row=this.row(id);return row?JSON.parse(row.payload) as AgentCredentialScope:null;}
 summary(id:string):{status:AgentCredentialStatus;expiresAt:number|null;attempts:number;automaticSweeps:number}|null{const row=this.row(id);return row?{status:row.status,expiresAt:row.expires_at,attempts:row.attempts,automaticSweeps:row.automatic_sweeps}:null;}
}
