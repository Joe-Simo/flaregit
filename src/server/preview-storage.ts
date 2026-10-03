import type { PreviewStorageManifest } from "./preview-storage-upload.js";
export interface PreviewStorageBudget { globalBytes:number|null;accountBytes:number|null }
/** Retained bytes only; failed and unknown uploads remain charged. No automatic deletion. */
export class PreviewStorageLedger {
 constructor(private storage:DurableObjectStorage){storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_storage_reservations(physical_key TEXT PRIMARY KEY,account_key TEXT NOT NULL,bytes INTEGER NOT NULL,manifest_hash TEXT NOT NULL,payload TEXT NOT NULL)");}
 reserve(manifest:PreviewStorageManifest,budget:PreviewStorageBudget):void{
  const {projectId,incarnation,commit,accountKey}=manifest.identity;
  if(manifest.version!==1||! /^[a-z0-9]{12,16}$/.test(projectId)||! /^[a-f0-9-]{36}$/.test(incarnation)||! /^[a-f0-9]{40}$/.test(commit)||! /^[a-f0-9]{12}$/.test(accountKey)||! /^[a-f0-9]{64}$/.test(manifest.manifestHash)||!Number.isSafeInteger(manifest.totalBytes)||manifest.totalBytes<1||manifest.totalBytes>64*1024*1024||manifest.assets.length<1||manifest.assets.length>1000||manifest.assets.reduce((sum,asset)=>sum+asset.size,0)!==manifest.totalBytes)throw new Error("Invalid preview storage manifest");
  if(manifest.assets.some(asset=>!Number.isSafeInteger(asset.size)||asset.size<0||asset.size>16*1024*1024||! /^[a-f0-9]{64}$/.test(asset.sha256)))throw new Error("Invalid preview storage asset");
  const physicalKey=`builds/${projectId}/${commit}`,payload=JSON.stringify(manifest);
  this.storage.transactionSync(()=>{
   const old=this.storage.sql.exec<{payload:string}>("SELECT payload FROM preview_storage_reservations WHERE physical_key=?",physicalKey).toArray()[0];
   if(old){if(old.payload!==payload)throw new Error("Preview output identity changed; existing assets are preserved");return;}
   if(budget.globalBytes===null||budget.accountBytes===null||!Number.isSafeInteger(budget.globalBytes)||!Number.isSafeInteger(budget.accountBytes)||budget.globalBytes<0||budget.accountBytes<0)throw new Error("Preview storage funding is not configured");
   const total=this.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM preview_storage_reservations").one().bytes;
   const owned=this.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM preview_storage_reservations WHERE account_key=?",accountKey).one().bytes;
   if(total+manifest.totalBytes>budget.globalBytes||owned+manifest.totalBytes>budget.accountBytes)throw new Error("Preview retained storage capacity reached; Git review remains available");
   this.storage.sql.exec("INSERT INTO preview_storage_reservations VALUES(?,?,?,?,?)",physicalKey,accountKey,manifest.totalBytes,manifest.manifestHash,payload);
  });
 }
}
export const previewStorageBudget=(env:{PREVIEW_STORAGE_GLOBAL_BYTES?:string;PREVIEW_STORAGE_ACCOUNT_BYTES?:string}):PreviewStorageBudget=>{
 const bytes=(value:string|undefined)=>value&&/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
 return {globalBytes:bytes(env.PREVIEW_STORAGE_GLOBAL_BYTES),accountBytes:bytes(env.PREVIEW_STORAGE_ACCOUNT_BYTES)};
};
