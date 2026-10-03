import type {PreviewStorageIdentity} from "./preview-storage-upload.js";
export type PreviewGenerationState="requested"|"building"|"ready"|"failed"|"quarantined";
export interface PreviewGenerationRecord {identity:PreviewStorageIdentity;generation:string;actorId:string;expectedGeneration:string|null;idempotencyKey:string;sourceKey:string;state:PreviewGenerationState;manifestHash:string|null;failureReason:string|null}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const equal=(a:PreviewStorageIdentity,b:PreviewStorageIdentity)=>a.projectId===b.projectId&&a.incarnation===b.incarnation&&a.commit===b.commit&&a.accountKey===b.accountKey;
function validate(i:PreviewStorageIdentity){if(!/^[a-z0-9]{12,16}$/.test(i.projectId)||!uuid.test(i.incarnation)||!/^[a-f0-9]{40}$/.test(i.commit)||!/^[a-f0-9]{12}$/.test(i.accountKey))throw new Error("Invalid preview generation identity");}
/** Durable operations and publication pointers only; no billing, refunds, hold release, or expiration. */
export class RepositoryPreviewGenerations {
 constructor(private storage:DurableObjectStorage){storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_generations(generation TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE NOT NULL,doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preview_generation_pointers(commit_id TEXT PRIMARY KEY,latest TEXT NOT NULL,active TEXT)");}
 get(g:string):PreviewGenerationRecord|null{const r=this.storage.sql.exec<{doc:string}>("SELECT doc FROM preview_generations WHERE generation=?",g).toArray()[0];return r?JSON.parse(r.doc) as PreviewGenerationRecord:null;}
 latest(commit:string){return this.pointer(commit,"latest");}
 active(commit:string){return this.pointer(commit,"active");}
 private pointer(commit:string,column:"latest"|"active"):PreviewGenerationRecord|null{const r=this.storage.sql.exec<{generation:string|null}>(`SELECT ${column} AS generation FROM preview_generation_pointers WHERE commit_id=?`,commit).toArray()[0];return r?.generation?this.get(r.generation):null;}
 private save(r:PreviewGenerationRecord){this.storage.sql.exec("UPDATE preview_generations SET doc=? WHERE generation=?",JSON.stringify(r),r.generation);}
 begin(identity:PreviewStorageIdentity,actorId:string,expectedGeneration:string|null,idempotencyKey:string,sourceKey=`builds/${identity.projectId}/${identity.commit}`):{status:"created"|"duplicate";record:PreviewGenerationRecord}{
 validate(identity);
 const legacySource=`builds/${identity.projectId}/${identity.commit}`,generationSource=`build-generations/${identity.projectId}/${identity.incarnation}/${identity.commit}/`;
 if(sourceKey!==legacySource&&(!sourceKey.startsWith(generationSource)||!uuid.test(sourceKey.slice(generationSource.length))))throw new Error("Invalid preview generation source scope");
 if(!actorId||actorId.length>256||!uuid.test(idempotencyKey)||(expectedGeneration!==null&&!uuid.test(expectedGeneration)))throw new Error("Invalid preview generation request");
 return this.storage.transactionSync(()=>{
 const old=this.storage.sql.exec<{doc:string}>("SELECT doc FROM preview_generations WHERE idempotency_key=?",idempotencyKey).toArray()[0];
 if(old){const record=JSON.parse(old.doc) as PreviewGenerationRecord;if(!equal(record.identity,identity)||record.actorId!==actorId||record.expectedGeneration!==expectedGeneration||record.sourceKey!==sourceKey)throw new Error("Preview generation idempotency input changed");return{status:"duplicate",record};}
 const previous=this.latest(identity.commit);if((previous?.generation??null)!==expectedGeneration)throw new Error("Preview generation changed");if(previous&&!equal(previous.identity,identity))throw new Error("Preview generation identity changed");
 if(this.storage.sql.exec<{count:number}>("SELECT COUNT(*) AS count FROM preview_generations").one().count>=1000)throw new Error("Preview generation limit reached");
 if(previous&&previous.state!=="ready"&&previous.state!=="quarantined")this.save({...previous,state:"quarantined"});
 const record:PreviewGenerationRecord={identity:{...identity},generation:crypto.randomUUID(),actorId,expectedGeneration,idempotencyKey,sourceKey,state:"requested",manifestHash:null,failureReason:null};
 this.storage.sql.exec("INSERT INTO preview_generations VALUES(?,?,?)",record.generation,idempotencyKey,JSON.stringify(record));this.storage.sql.exec("INSERT INTO preview_generation_pointers VALUES(?,?,NULL) ON CONFLICT(commit_id) DO UPDATE SET latest=excluded.latest",identity.commit,record.generation);return{status:"created",record};});}
 markBuilding(g:string):boolean{return this.storage.transactionSync(()=>{const r=this.requireLatest(g);if(r.state==="building")return false;if(r.state!=="requested")throw new Error("Preview generation cannot start");const next={...r,state:"building" as const};this.save(next);return true;});}
 fail(g:string,reason:string):PreviewGenerationRecord{if(!reason||reason.length>1000)throw new Error("Invalid preview failure reason");return this.storage.transactionSync(()=>{const r=this.requireLatest(g);if(r.state==="failed"&&r.failureReason===reason)return r;if(r.state!=="requested"&&r.state!=="building")throw new Error("Preview generation cannot fail");const next={...r,state:"failed" as const,failureReason:reason};this.save(next);return next;});}
 promote(g:string,identity:PreviewStorageIdentity,manifestHash:string):PreviewGenerationRecord{validate(identity);if(!/^[a-f0-9]{64}$/.test(manifestHash))throw new Error("Invalid preview manifest digest");return this.storage.transactionSync(()=>{const r=this.requireLatest(g);if(!equal(r.identity,identity))throw new Error("Preview generation identity changed");if(r.state!=="building")throw new Error("Preview generation cannot publish");const next={...r,state:"ready" as const,manifestHash};this.save(next);this.storage.sql.exec("UPDATE preview_generation_pointers SET active=? WHERE commit_id=? AND latest=?",g,identity.commit,g);return next;});}
 private requireLatest(g:string){const r=this.get(g);if(!r||this.latest(r.identity.commit)?.generation!==g)throw new Error("Preview generation is stale or unknown");return r;}
}
