import {z} from "zod";
import {branchNativeAttemptSchema,type BranchNativeAttemptIdentity} from "./branch-creation-operations";
export type BranchCredentialIdentity=BranchNativeAttemptIdentity;
export type BranchCredentialStatus="issuance_unknown"|"pending"|"revoked";
type Row={id:string;payload:string;repo_name:string;account_key:string;scope:"read"|"write";intent_expires_at:number;token:string|null;fingerprint:string|null;provider_scope:"read"|"write"|"unknown"|null;expires_at:number|null;status:BranchCredentialStatus;attempts:number;automatic_sweeps:number};
const idSchema=z.uuid();
const scopeFor=(identity:BranchCredentialIdentity)=>identity.kind==="inventory"?"read" as const:"write" as const;
async function fingerprint(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))),byte=>byte.toString(16).padStart(2,"0")).join("");}
/** Genuine branch-operation cleanup ownership, never an authorization grant.
 * Secret-bearing receipts/batches stay backend-only. Callers fund and authorize
 * every issuance/use, and fund revocation separately after authority withdrawal.
 * Expiry and observation timeouts never fabricate successful cleanup.
 */
export class BranchCredentialIncidents{
 constructor(private storage:DurableObjectStorage){storage.sql.exec("CREATE TABLE IF NOT EXISTS branch_credential_incidents(id TEXT PRIMARY KEY,payload TEXT NOT NULL,repo_name TEXT NOT NULL,account_key TEXT NOT NULL,scope TEXT NOT NULL,intent_expires_at INTEGER NOT NULL,token TEXT,fingerprint TEXT,provider_scope TEXT,expires_at INTEGER,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,automatic_sweeps INTEGER NOT NULL DEFAULT 0)");}
 private row(id:string){idSchema.parse(id);return this.storage.sql.exec<Row>("SELECT * FROM branch_credential_incidents WHERE id=?",id).toArray()[0];}
 begin(identity:BranchCredentialIdentity,expiresAt:number,validate:()=>void,now=Date.now()):boolean{
  const context=branchNativeAttemptSchema.parse(identity);
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+60000)throw new Error("Invalid branch credential intent");
  return this.storage.transactionSync(()=>{validate();const payload=JSON.stringify(context),row=this.row(context.attemptId),scope=scopeFor(context);if(row){if(row.payload!==payload||row.intent_expires_at!==expiresAt||row.scope!==scope)throw new Error("Branch credential intent changed");return false;}if(this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM branch_credential_incidents").one().n>=10000)throw new Error("Branch credential audit capacity reached");this.storage.sql.exec("INSERT INTO branch_credential_incidents(id,payload,repo_name,account_key,scope,intent_expires_at,status) VALUES(?,?,?,?,?,?,'issuance_unknown')",context.attemptId,payload,context.canonicalRepoName,context.accountKey,scope,expiresAt);return true;});
 }
 /** Store already-issued cleanup capability before judging scope/expiry or fresh
  * owner authority. A withdrawn actor must not strand an issued token.
  */
 async record(attemptId:string,repoName:string,token:string,expiresAt:number,providerScope:unknown):Promise<void>{
  if(typeof token!=="string"||!token||token.length>16384||/[\r\n\0]/.test(token))throw new Error("Invalid branch credential receipt");
  const expiry=Number.isSafeInteger(expiresAt)?expiresAt:null,scope=providerScope==="read"||providerScope==="write"?providerScope:"unknown";
  this.storage.transactionSync(()=>{const row=this.row(attemptId);if(!row||row.repo_name!==repoName)throw new Error("Exact branch credential issuance intent required");if(row.status!=="issuance_unknown"){if(row.expires_at!==expiry||row.provider_scope!==scope||row.token!==null&&row.token!==token)throw new Error("Branch credential receipt changed");return;}this.storage.sql.exec("UPDATE branch_credential_incidents SET token=?,expires_at=?,provider_scope=?,status='pending' WHERE id=?",token,expiry,scope,attemptId);});
  const digest=await fingerprint(token);this.storage.transactionSync(()=>{const row=this.row(attemptId);if(!row||row.repo_name!==repoName||row.expires_at!==expiry||row.provider_scope!==scope||row.fingerprint&&row.fingerprint!==digest||row.token!==null&&row.token!==token)throw new Error("Branch credential receipt changed");this.storage.sql.exec("UPDATE branch_credential_incidents SET fingerprint=?,token=CASE WHEN status='revoked' THEN NULL ELSE token END WHERE id=?",digest,attemptId);});
 }
 /** Trusted backend only; caller must freshly authorize actual operation use. */
 credentialForUse(identity:BranchCredentialIdentity,now=Date.now()){
  const context=branchNativeAttemptSchema.parse(identity);if(!Number.isSafeInteger(now)||now<0)throw new Error("Invalid branch credential clock");const row=this.row(context.attemptId);
  if(!row||row.payload!==JSON.stringify(context)||row.status!=="pending"||row.scope!==scopeFor(context)||row.provider_scope!==row.scope||!row.token||row.expires_at===null||row.expires_at<=now||row.expires_at>row.intent_expires_at+5000)return null;
  return{token:row.token,expiresAt:row.expires_at,scope:row.scope};
 }
 /** Cleanup remains possible without reminting or fresh operation authority. */
 credentialForRevocation(attemptId:string){const row=this.row(attemptId);return row?.status==="pending"&&row.attempts<4&&row.token?{attemptId:row.id,repoName:row.repo_name,accountKey:row.account_key,token:row.token}:null;}
 markAttempt(attemptId:string):boolean{return this.storage.transactionSync(()=>{const row=this.row(attemptId);if(row?.status!=="pending"||row.attempts>=4)return false;this.storage.sql.exec("UPDATE branch_credential_incidents SET attempts=attempts+1 WHERE id=?",attemptId);return true;});}
 markAutomaticSweep(attemptId:string):boolean{return this.storage.transactionSync(()=>{const row=this.row(attemptId);if(row?.status!=="pending"||row.automatic_sweeps>=4)return false;this.storage.sql.exec("UPDATE branch_credential_incidents SET automatic_sweeps=automatic_sweeps+1 WHERE id=?",attemptId);return true;});}
 async markRevoked(attemptId:string,token:string):Promise<void>{
  const initial=this.row(attemptId);if(!initial||initial.token!==null&&initial.token!==token||initial.token===null&&!initial.fingerprint)throw new Error("Branch credential revocation receipt differs");
  if(initial.token===token){this.storage.transactionSync(()=>{const row=this.row(attemptId);if(!row||row.token!==token)throw new Error("Branch credential revocation receipt differs");this.storage.sql.exec("UPDATE branch_credential_incidents SET status='revoked',token=CASE WHEN fingerprint IS NULL THEN token ELSE NULL END WHERE id=?",attemptId);});}
  let digest:string;try{digest=await fingerprint(token);}catch(error){if(initial.token===token)return;throw error;}
  this.storage.transactionSync(()=>{const row=this.row(attemptId);if(!row||row.fingerprint&&row.fingerprint!==digest||row.token!==null&&row.token!==token)throw new Error("Branch credential revocation receipt differs");this.storage.sql.exec("UPDATE branch_credential_incidents SET token=NULL,fingerprint=?,status='revoked' WHERE id=?",digest,attemptId);});
 }

 pendingBatch(){return this.storage.sql.exec<Row>("SELECT * FROM branch_credential_incidents WHERE status='pending' AND attempts<4 AND automatic_sweeps<4 ORDER BY intent_expires_at,id LIMIT 20").toArray().map(row=>({attemptId:row.id,repoName:row.repo_name,accountKey:row.account_key,token:row.token!}));}
 nextWake(now=Date.now()):number|null{if(!Number.isSafeInteger(now)||now<0)throw new Error("Invalid branch cleanup clock");return this.storage.sql.exec("SELECT id FROM branch_credential_incidents WHERE status='pending' AND attempts<4 AND automatic_sweeps<4 LIMIT 1").toArray().length?now+60000:null;}
 summary(attemptId:string){const row=this.row(attemptId);return row?{status:row.status,scope:row.scope,providerScope:row.provider_scope,expiresAt:row.expires_at,attempts:row.attempts,automaticSweeps:row.automatic_sweeps}:null;}
 hasPending():boolean{return this.storage.sql.exec("SELECT id FROM branch_credential_incidents WHERE status!='revoked' LIMIT 1").toArray().length>0;}
}
