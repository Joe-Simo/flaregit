import {EVIDENCE_COPY_ID} from "./evidence-copy-id.js";
import type { PreviewStorageIdentity } from "./preview-storage-upload.js";
import { PreviewStorageAdmissionError, type PreviewStorageBudget } from "./preview-storage.js";
/** Separate retained-byte pool: unknown uploads remain charged. */
export class EvidenceStorageLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS evidence_storage_reservations(physical_key TEXT PRIMARY KEY,account_key TEXT NOT NULL,bytes INTEGER NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS evidence_storage_account ON evidence_storage_reservations(account_key); CREATE TABLE IF NOT EXISTS preview_copy_retirements(physical_key TEXT PRIMARY KEY,doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preview_copy_fences(project_id TEXT NOT NULL,incarnation TEXT NOT NULL,PRIMARY KEY(project_id,incarnation))");
  }
  reserve(identity: PreviewStorageIdentity, id: string, size: number, sha256: string, budget: PreviewStorageBudget): void {
    const {projectId,incarnation,commit,accountKey}=identity;
    if(!/^[a-z0-9]{12,16}$/.test(projectId)||!/^[a-f0-9-]{36}$/.test(incarnation)||!/^[a-f0-9]{40}$/.test(commit)||!/^[a-f0-9]{12}$/.test(accountKey)||!EVIDENCE_COPY_ID.test(id)||!/^[a-f0-9]{64}$/.test(sha256)||!Number.isSafeInteger(size)||size<1||size>1024*1024)throw new Error("Invalid evidence storage identity");
    const key=`evidence/${projectId}/${incarnation}/${id}.json`,payload=JSON.stringify({identity,id,size,sha256});
    this.storage.transactionSync(()=>{
      if(this.storage.sql.exec("SELECT project_id FROM preview_copy_fences WHERE project_id=? AND incarnation=?",projectId,incarnation).toArray().length)throw new PreviewStorageAdmissionError("storage_retired");
      if(this.storage.sql.exec("SELECT physical_key FROM preview_copy_retirements WHERE physical_key=?",key).toArray().length)throw new PreviewStorageAdmissionError("storage_retired");
      const existing=this.storage.sql.exec<{payload:string}>("SELECT payload FROM evidence_storage_reservations WHERE physical_key=?",key).toArray()[0];
      if(existing){if(existing.payload!==payload)throw new Error("Evidence output identity changed");return;}
      if(budget.globalBytes===null||budget.accountBytes===null||!Number.isSafeInteger(budget.globalBytes)||!Number.isSafeInteger(budget.accountBytes)||budget.globalBytes<0||budget.accountBytes<0)throw new PreviewStorageAdmissionError("storage_unconfigured");
      const total=this.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM evidence_storage_reservations").one().bytes;
      const owned=this.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM evidence_storage_reservations WHERE account_key=?",accountKey).one().bytes;
      if(size>budget.globalBytes-total||size>budget.accountBytes-owned)throw new PreviewStorageAdmissionError("storage_capacity");
      this.storage.sql.exec("INSERT INTO evidence_storage_reservations VALUES(?,?,?,?)",key,accountKey,size,payload);
    });
  }
}
