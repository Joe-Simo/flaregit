import { generationBuildPrefix, buildPrefix } from "./preview-access.js";
import type { PreviewStorageIdentity, PreviewStorageManifest } from "./preview-storage-upload.js";
export const previewManifestPrefix=(identity:PreviewStorageIdentity)=>identity.generation?generationBuildPrefix(identity.projectId,identity.commit,identity.incarnation,identity.generation):buildPrefix(identity.projectId,identity.commit);
export interface PreviewStorageBudget { globalBytes:number|null;accountBytes:number|null }
/** Retained bytes only; failed and unknown uploads remain charged. No automatic deletion. */
export class PreviewStorageLedger {
 constructor(private storage:DurableObjectStorage){storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_storage_reservations(physical_key TEXT PRIMARY KEY,account_key TEXT NOT NULL,bytes INTEGER NOT NULL,manifest_hash TEXT NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS preview_storage_account ON preview_storage_reservations(account_key); CREATE TABLE IF NOT EXISTS preview_copy_retirements(physical_key TEXT PRIMARY KEY,doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preview_storage_refusals(physical_key TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preview_copy_fences(project_id TEXT NOT NULL,incarnation TEXT NOT NULL,PRIMARY KEY(project_id,incarnation))");}
 estimate(manifest:PreviewStorageManifest,budget:PreviewStorageBudget):void{
  if(!manifest.identity.generation)throw new Error("Generation estimate required");
  this.storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_generation_estimates(physical_key TEXT PRIMARY KEY,finalized INTEGER NOT NULL)");
  this.storage.transactionSync(()=>{this.reserve(manifest,budget);this.storage.sql.exec("INSERT OR IGNORE INTO preview_generation_estimates VALUES(?,0)",previewManifestPrefix(manifest.identity));});
 }
 finalize(manifest:PreviewStorageManifest,budget:PreviewStorageBudget):void{
  const key=previewManifestPrefix(manifest.identity);
  this.storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_generation_estimates(physical_key TEXT PRIMARY KEY,finalized INTEGER NOT NULL)");
  this.storage.transactionSync(()=>{
   const phase=this.storage.sql.exec<{finalized:number}>("SELECT finalized FROM preview_generation_estimates WHERE physical_key=?",key).toArray()[0];
   const row=this.storage.sql.exec<{bytes:number;payload:string}>("SELECT bytes,payload FROM preview_storage_reservations WHERE physical_key=?",key).toArray()[0];
   if(!phase||!row)throw new Error("Generation estimate unavailable");
   if(phase.finalized){this.reserve(manifest,budget);return;}
   const previous=JSON.parse(row.payload) as PreviewStorageManifest;
   if(JSON.stringify(previous.identity)!==JSON.stringify(manifest.identity))throw new Error("Generation scope changed");
   if(this.storage.sql.exec("SELECT project_id FROM preview_copy_fences WHERE project_id=? AND incarnation=?",manifest.identity.projectId,manifest.identity.incarnation).toArray().length||this.storage.sql.exec("SELECT physical_key FROM preview_copy_retirements WHERE physical_key=?",key).toArray().length)throw new PreviewStorageAdmissionError("storage_retired");
   const charge=Math.max(row.bytes,manifest.totalBytes),delta=charge-row.bytes;
   if(budget.globalBytes===null||budget.accountBytes===null)throw new PreviewStorageAdmissionError("storage_unconfigured");
   const total=this.storage.sql.exec<{bytes:number}>("SELECT SUM(bytes) AS bytes FROM preview_storage_reservations").one().bytes;
   const owned=this.storage.sql.exec<{bytes:number}>("SELECT SUM(bytes) AS bytes FROM preview_storage_reservations WHERE account_key=?",manifest.identity.accountKey).one().bytes;
   if(delta>budget.globalBytes-total||delta>budget.accountBytes-owned)throw new PreviewStorageAdmissionError("storage_capacity");
   this.storage.sql.exec("UPDATE preview_storage_reservations SET bytes=?,manifest_hash=?,payload=? WHERE physical_key=?",charge,manifest.manifestHash,JSON.stringify(manifest),key);
   this.storage.sql.exec("UPDATE preview_generation_estimates SET finalized=1 WHERE physical_key=?",key);
  });
 }
 capacity(bytes:number,accountKey:string,budget:PreviewStorageBudget):PreviewStorageAdmission{
  if(budget.globalBytes===null||budget.accountBytes===null)return{allowed:false,reason:"storage_unconfigured"};
  const total=this.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM preview_storage_reservations").one().bytes;
  const owned=this.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM preview_storage_reservations WHERE account_key=?",accountKey).one().bytes;
  return bytes<=budget.globalBytes-total&&bytes<=budget.accountBytes-owned?{allowed:true}:{allowed:false,reason:"storage_capacity"};
 }
 rememberRefusal(manifest:PreviewStorageManifest):void{
  const key=previewManifestPrefix(manifest.identity);
  this.storage.transactionSync(()=>{
   if(this.storage.sql.exec("SELECT physical_key FROM preview_storage_reservations WHERE physical_key=?",key).toArray().length)return;
   if(this.storage.sql.exec("SELECT physical_key FROM preview_copy_retirements WHERE physical_key=?",key).toArray().length)return;
   this.storage.sql.exec("INSERT INTO preview_storage_refusals VALUES(?,?) ON CONFLICT(physical_key) DO UPDATE SET payload=excluded.payload",key,JSON.stringify(manifest));
  });
 }
 readmit(identity:PreviewStorageIdentity,budget:PreviewStorageBudget):PreviewStorageAdmission{
  const key=previewManifestPrefix(identity);
  return this.storage.transactionSync(()=>{
   if(this.storage.sql.exec("SELECT physical_key FROM preview_copy_retirements WHERE physical_key=?",key).toArray().length)return{allowed:false,reason:"storage_retired"};
   if(this.storage.sql.exec("SELECT project_id FROM preview_copy_fences WHERE project_id=? AND incarnation=?",identity.projectId,identity.incarnation).toArray().length)return{allowed:false,reason:"storage_retired"};
   // Admitted or ambiguous writes cannot become a new capacity re-admission.
   if(this.storage.sql.exec("SELECT physical_key FROM preview_storage_reservations WHERE physical_key=?",key).toArray().length)return{allowed:false,reason:"storage_capacity"};
   const row=this.storage.sql.exec<{payload:string}>("SELECT payload FROM preview_storage_refusals WHERE physical_key=?",key).toArray()[0];
   if(!row)return{allowed:false,reason:"storage_capacity"};
   const saved=JSON.parse(row.payload) as PreviewStorageManifest;
   if(["projectId","incarnation","commit","accountKey"].some(field=>saved.identity[field as keyof PreviewStorageIdentity]!==identity[field as keyof PreviewStorageIdentity]))return{allowed:false,reason:"storage_retired"};
   if(budget.globalBytes===null||budget.accountBytes===null)return{allowed:false,reason:"storage_unconfigured"};
   const total=this.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM preview_storage_reservations").one().bytes;
   const owned=this.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM preview_storage_reservations WHERE account_key=?",identity.accountKey).one().bytes;
   return saved.totalBytes<=budget.globalBytes-total&&saved.totalBytes<=budget.accountBytes-owned?{allowed:true}:{allowed:false,reason:"storage_capacity"};
  });
 }

 reserve(manifest:PreviewStorageManifest,budget:PreviewStorageBudget):void{
  const {projectId,incarnation,commit,accountKey}=manifest.identity;
  if(manifest.version!==1||! /^[a-z0-9]{12,16}$/.test(projectId)||! /^[a-f0-9-]{36}$/.test(incarnation)||! /^[a-f0-9]{40}$/.test(commit)||! /^[a-f0-9]{12}$/.test(accountKey)||! /^[a-f0-9]{64}$/.test(manifest.manifestHash)||!Number.isSafeInteger(manifest.totalBytes)||manifest.totalBytes<1||manifest.totalBytes>64*1024*1024||manifest.assets.length<1||manifest.assets.length>1000||manifest.assets.reduce((sum,asset)=>sum+asset.size,0)!==manifest.totalBytes)throw new Error("Invalid preview storage manifest");
  if(manifest.assets.some(asset=>!Number.isSafeInteger(asset.size)||asset.size<0||asset.size>16*1024*1024||! /^[a-f0-9]{64}$/.test(asset.sha256)))throw new Error("Invalid preview storage asset");
  const physicalKey=previewManifestPrefix(manifest.identity),payload=JSON.stringify(manifest);
  this.storage.transactionSync(()=>{
   if(this.storage.sql.exec("SELECT project_id FROM preview_copy_fences WHERE project_id=? AND incarnation=?",projectId,incarnation).toArray().length)throw new PreviewStorageAdmissionError("storage_retired");
   if(this.storage.sql.exec("SELECT physical_key FROM preview_copy_retirements WHERE physical_key=?",physicalKey).toArray().length)throw new PreviewStorageAdmissionError("storage_retired");
   const old=this.storage.sql.exec<{payload:string}>("SELECT payload FROM preview_storage_reservations WHERE physical_key=?",physicalKey).toArray()[0];
   if(old){if(old.payload!==payload)throw new Error("Preview output identity changed; existing assets are preserved");return;}
   if(budget.globalBytes===null||budget.accountBytes===null||!Number.isSafeInteger(budget.globalBytes)||!Number.isSafeInteger(budget.accountBytes)||budget.globalBytes<0||budget.accountBytes<0)throw new PreviewStorageAdmissionError("storage_unconfigured");
   const total=this.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM preview_storage_reservations").one().bytes;
   const owned=this.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM preview_storage_reservations WHERE account_key=?",accountKey).one().bytes;
   if(total+manifest.totalBytes>budget.globalBytes||owned+manifest.totalBytes>budget.accountBytes)throw new PreviewStorageAdmissionError("storage_capacity");
   this.storage.sql.exec("INSERT INTO preview_storage_reservations VALUES(?,?,?,?,?)",physicalKey,accountKey,manifest.totalBytes,manifest.manifestHash,payload);
  });
 }
}
export const previewStorageBudget=(env:{PREVIEW_STORAGE_GLOBAL_BYTES?:string;PREVIEW_STORAGE_ACCOUNT_BYTES?:string}):PreviewStorageBudget=>{
 const bytes=(value:string|undefined)=>value&&/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
 return {globalBytes:bytes(env.PREVIEW_STORAGE_GLOBAL_BYTES),accountBytes:bytes(env.PREVIEW_STORAGE_ACCOUNT_BYTES)};
};

export type PreviewStorageAdmission = {allowed:true}|{allowed:false;reason:"storage_unconfigured"|"storage_capacity"|"storage_retired"};
export class PreviewStorageAdmissionError extends Error {
 constructor(public readonly reason: "storage_unconfigured"|"storage_capacity"|"storage_retired"){super(reason==="storage_retired"?"Retired preview storage identity cannot be reused":reason==="storage_capacity"?"Preview storage allowance is exhausted; operator allowance changes or confirmed storage reconciliation are required":"Preview storage allowance is not configured; an operator must configure funding");}
}
export function assertPreviewStorageAdmission(result:PreviewStorageAdmission):void{if(!result.allowed)throw new PreviewStorageAdmissionError(result.reason);}
