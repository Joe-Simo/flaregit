export type PreviewCredentialIncidentStatus="pending"|"revoked"|"expired_unverified";
export interface PendingPreviewCredentialIncident {generation:string;repoName:string;token:string;expiresAt:number;attempts:number}
type Row = {generation:string;repo_name:string;token:string|null;fingerprint:string;expires_at:number;attempts:number;status:PreviewCredentialIncidentStatus}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function fingerprint(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))),v=>v.toString(16).padStart(2,"0")).join("");}
/** Backend-only revocation queue. Never expose pendingBatch through a client RPC. */
export class PreviewCredentialIncidents {
 constructor(private storage:DurableObjectStorage){storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_credential_incidents(generation TEXT PRIMARY KEY,repo_name TEXT NOT NULL,token TEXT,fingerprint TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL,status TEXT NOT NULL)");}
 private row(g:string){return this.storage.sql.exec<Row>("SELECT * FROM preview_credential_incidents WHERE generation=?",g).toArray()[0];}
 async record(generation:string,repoName:string,token:string,expiresAt:number,now?:number,validate?:()=>void):Promise<void>{
 const initialNow=now??Date.now();
 if(!uuid.test(generation)||!/^flaregit-[a-z0-9]{12,16}$/.test(repoName)||typeof token!=="string"||!token||token.length>16384||!Number.isFinite(initialNow)||!Number.isFinite(expiresAt)||expiresAt>initialNow+900000)throw new Error("Invalid preview credential incident");
 const digest=await fingerprint(token);
 this.storage.transactionSync(()=>{validate?.();const currentNow=now??Date.now();const old=this.row(generation);if(old){if(old.repo_name!==repoName||old.expires_at!==expiresAt||old.fingerprint!==digest||(old.token!==null&&old.token!==token))throw new Error("Preview credential incident input changed");return;}
 if(this.storage.sql.exec<{count:number}>("SELECT COUNT(*) AS count FROM preview_credential_incidents").one().count>=1000)throw new Error("Preview credential incident limit reached");
 const expired=expiresAt<=currentNow;this.storage.sql.exec("INSERT INTO preview_credential_incidents VALUES(?,?,?,?,?,0,?)",generation,repoName,expired?null:token,digest,expiresAt,expired?"expired_unverified":"pending");});}
 /** Internal alarm use only: contains secrets while active and within attempt budget. */
 pendingBatch(now=Date.now()):PendingPreviewCredentialIncident[]{if(!Number.isFinite(now))throw new Error("Invalid preview incident time");return this.storage.transactionSync(()=>{this.storage.sql.exec("UPDATE preview_credential_incidents SET token=NULL,status='expired_unverified' WHERE status='pending' AND expires_at<=?",now);return this.storage.sql.exec<Row>("SELECT * FROM preview_credential_incidents WHERE status='pending' AND attempts<4 ORDER BY expires_at,generation LIMIT 20").toArray().map(r=>({generation:r.generation,repoName:r.repo_name,token:r.token!,expiresAt:r.expires_at,attempts:r.attempts}));});}
 markAttempt(g:string):boolean{return this.storage.transactionSync(()=>{const r=this.row(g);if(!r)throw new Error("Unknown preview credential incident");if(r.status!=="pending"||r.attempts>=4)return false;this.storage.sql.exec("UPDATE preview_credential_incidents SET attempts=attempts+1 WHERE generation=?",g);return true;});}
 async markRevoked(g:string,token:string):Promise<void>{const digest=await fingerprint(token);this.storage.transactionSync(()=>{const r=this.row(g);if(!r||r.fingerprint!==digest||(r.token!==null&&r.token!==token))throw new Error("Preview credential receipt mismatch");if(r.status==="expired_unverified")throw new Error("Preview credential expiry is unverified");this.storage.sql.exec("UPDATE preview_credential_incidents SET token=NULL,status='revoked' WHERE generation=?",g);});}
 summary(g:string):{status:PreviewCredentialIncidentStatus;expiresAt:number}|null{const r=this.row(g);return r?{status:r.status,expiresAt:r.expires_at}:null;}
}
