export interface PrivateRecoveryReceipt { projectId:string; incarnation:string; commit:string; tree:string; journalId:string; size:number; sha256:string; objectCount:number; objectScope:"exact-accepted-reachable-closure"; createdAt:string }
export type PrivateRecoveryTarget = Pick<import("./deployments.js").AcceptedDeploymentTarget,"journalId"|"commit"|"acceptedAt"> & { tree: string | null };
export interface PrivateRecoveryOperation { id:string; projectId:string; incarnation:string; commit:string; tree:string|null; journalId:string; canonicalRepoName:string; ownerId:string; accountKey:string; status:"pending"|"ready"|"failed"; dispatchState?: "not-started" | "uncertain" | "started"; cacheState?: "deleting" | "deleted"; uploadState?: "not-started" | "allocating" | "active" | "closed"; uploadId?: string; createdAt:string; error?:string; receipt?:PrivateRecoveryReceipt }
const RECOVERY_UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const RECOVERY_SCOPE_ID = new RegExp(`^[a-z0-9]{12,16}-${RECOVERY_UUID}-${RECOVERY_UUID}$`);
export function recoveryScopeId(scope: Pick<PrivateRecoveryOperation, "projectId" | "incarnation" | "id">): string {
 const id = `${scope.projectId}-${scope.incarnation}-${scope.id}`;
 if (!RECOVERY_SCOPE_ID.test(id)) throw new Error("Invalid private recovery scope identity");
 return id;
}
export const recoveryBundleKey=(scope:Pick<PrivateRecoveryOperation,"projectId"|"incarnation"|"commit"|"id">)=>{
 if(!/^[a-z0-9]{12,16}$/.test(scope.projectId)||! /^[a-f0-9-]{36}$/.test(scope.incarnation)||! /^[a-f0-9]{40}$/.test(scope.commit)||! /^[a-f0-9-]{36}$/.test(scope.id))throw new Error("Invalid private recovery scope");
 return `private-recovery/${scope.projectId}/${scope.incarnation}/${scope.commit}/${scope.id}/repository.bundle`;
};

/** Conservative retained storage admission. Unknown preparation outcomes retain their reservation. */
export class PrivateRecoveryStorage {
 constructor(private storage:DurableObjectStorage) { storage.sql.exec("CREATE TABLE IF NOT EXISTS private_recovery_slots(id TEXT PRIMARY KEY,account_key TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS private_recovery_retirements(id TEXT PRIMARY KEY,account_key TEXT NOT NULL)"); }
 release(id: string, accountKey: string): void {
  if (!RECOVERY_SCOPE_ID.test(id) || !accountKey) throw new Error("Invalid recovery storage reservation");
  this.storage.transactionSync(() => {
   const retired = this.storage.sql.exec<{account_key: string}>("SELECT account_key FROM private_recovery_retirements WHERE id=?", id).toArray()[0];
   const slot = this.storage.sql.exec<{account_key: string}>("SELECT account_key FROM private_recovery_slots WHERE id=?", id).toArray()[0];
   if ((retired && retired.account_key !== accountKey) || (slot && slot.account_key !== accountKey)) throw new Error("Recovery reservation scope changed");
   this.storage.sql.exec("INSERT OR IGNORE INTO private_recovery_retirements VALUES(?,?)", id, accountKey);
   this.storage.sql.exec("DELETE FROM private_recovery_slots WHERE id=? AND account_key=?", id, accountKey);
  });
 }
 reserve(id:string,accountKey:string):void {
  if(!RECOVERY_SCOPE_ID.test(id)||!accountKey)throw new Error("Invalid recovery storage reservation");
  this.storage.transactionSync(()=>{
   if (this.storage.sql.exec("SELECT id FROM private_recovery_retirements WHERE id=?", id).toArray().length) throw new Error("Recovery storage identity is permanently retired");
   const old=this.storage.sql.exec<{account_key:string}>("SELECT account_key FROM private_recovery_slots WHERE id=?",id).toArray()[0];
   if(old){if(old.account_key!==accountKey)throw new Error("Recovery reservation scope changed");return;}
   const total=this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM private_recovery_slots").one().n;
   const owned=this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM private_recovery_slots WHERE account_key=?",accountKey).one().n;
   if(total>=8||owned>=2)throw new Error("Private recovery retained storage capacity reached");
   this.storage.sql.exec("INSERT INTO private_recovery_slots VALUES(?,?,?)",id,accountKey,new Date().toISOString());
  });
 }
}
export class PrivateRecoveryOperations {
 constructor(private storage:DurableObjectStorage){storage.sql.exec("CREATE TABLE IF NOT EXISTS private_recovery_incarnation(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS private_recovery_operations(id TEXT PRIMARY KEY,doc TEXT NOT NULL)");}
 incarnation():string {
  let value=this.storage.sql.exec<{value:string}>("SELECT value FROM private_recovery_incarnation WHERE id=1").toArray()[0]?.value;
  if(!value){value=crypto.randomUUID();this.storage.sql.exec("INSERT INTO private_recovery_incarnation VALUES(1,?)",value);}return value;
 }
 get(id:string):PrivateRecoveryOperation|null {const row=this.storage.sql.exec<{doc:string}>("SELECT doc FROM private_recovery_operations WHERE id=?",id).toArray()[0];return row?JSON.parse(row.doc) as PrivateRecoveryOperation:null;}
 all(): PrivateRecoveryOperation[] { return this.storage.sql.exec<{doc: string}>("SELECT doc FROM private_recovery_operations ORDER BY rowid").toArray().map(row => JSON.parse(row.doc) as PrivateRecoveryOperation); }
 list():PrivateRecoveryOperation[]{return this.storage.sql.exec<{doc:string}>("SELECT doc FROM private_recovery_operations ORDER BY CASE WHEN json_extract(doc, '$.cacheState')='deleted' THEN 1 ELSE 0 END, rowid DESC LIMIT 20").toArray().map(row=>JSON.parse(row.doc) as PrivateRecoveryOperation);}
 create(op:PrivateRecoveryOperation):PrivateRecoveryOperation {
  const old=this.get(op.id);if(old){if(old.projectId!==op.projectId||old.incarnation!==op.incarnation||old.journalId!==op.journalId||old.accountKey!==op.accountKey||old.commit!==op.commit||old.tree!==op.tree||old.ownerId!==op.ownerId||old.canonicalRepoName!==op.canonicalRepoName)throw new Error("Recovery retry identity changed");return old;}
  this.storage.sql.exec("INSERT INTO private_recovery_operations VALUES(?,?)",op.id,JSON.stringify(op));return op;
 }
 markDispatch(id: string, dispatchState: "uncertain" | "started"): void {
  const op = this.get(id);
  if (!op) throw new Error("Unknown recovery operation");
  if (op.cacheState) throw new Error("Recovery cache is retired");
  if (op.status === "ready") throw new Error("Completed recovery cannot be dispatched again");
  this.storage.sql.exec("UPDATE private_recovery_operations SET doc=? WHERE id=?", JSON.stringify({ ...op, dispatchState, ...(dispatchState === "uncertain" ? { status: "pending", error: undefined } : {}) }), id);
 }
 beginUpload(id: string): void {
  const op = this.get(id);
  if (!op || op.cacheState || op.status !== "pending" || !["not-started", "closed"].includes(op.uploadState ?? "")) throw new Error("Recovery upload lifecycle is unresolved");
  this.storage.sql.exec("UPDATE private_recovery_operations SET doc=? WHERE id=?", JSON.stringify({ ...op, uploadState: "allocating", uploadId: undefined }), id);
 }
 saveUpload(id: string, uploadId: string): void {
  const op = this.get(id);
  if (!op || op.cacheState || op.status !== "pending" || !uploadId || uploadId.length > 4096 || !["allocating", "active"].includes(op.uploadState ?? "") || (op.uploadId && op.uploadId !== uploadId)) throw new Error("Recovery multipart upload identity changed");
  this.storage.sql.exec("UPDATE private_recovery_operations SET doc=? WHERE id=?", JSON.stringify({ ...op, uploadState: "active", uploadId }), id);
 }
 closeUpload(id: string, uploadId: string): void {
  const op = this.get(id);
  if (!op || !uploadId || op.uploadId !== uploadId || !["active", "closed"].includes(op.uploadState ?? "")) throw new Error("Recovery multipart closure is unconfirmed");
  this.storage.sql.exec("UPDATE private_recovery_operations SET doc=? WHERE id=?", JSON.stringify({ ...op, uploadState: "closed" }), id);
 }
 beginDeletion(id: string): void {
  const op = this.get(id);
  if (!op) throw new Error("Unknown recovery operation");
  if (op.cacheState) return;
  this.storage.sql.exec("UPDATE private_recovery_operations SET doc=? WHERE id=?", JSON.stringify({ ...op, cacheState: "deleting" }), id);
 }
 finishDeletion(id: string): void {
  const op = this.get(id);
  if (!op?.cacheState) throw new Error("Recovery cache deletion was not started");
  this.storage.sql.exec("UPDATE private_recovery_operations SET doc=? WHERE id=?", JSON.stringify({ ...op, cacheState: "deleted", receipt: undefined }), id);
 }
 recordTree(id:string,tree:string):PrivateRecoveryOperation {
  const op=this.get(id);if(!op||op.status!=="pending"||! /^[a-f0-9]{40}$/.test(tree)||(op.tree!==null&&op.tree!==tree))throw new Error("Recovery tree scope changed");
  const updated={...op,tree};this.storage.sql.exec("UPDATE private_recovery_operations SET doc=? WHERE id=?",JSON.stringify(updated),id);return updated;
 }
 complete(id:string,receipt:PrivateRecoveryReceipt):void {
  const op=this.get(id);if(!op)throw new Error("Unknown recovery operation");
  if (op.cacheState) throw new Error("Recovery cache is retired");
  if (op.uploadState !== "closed") throw new Error("Recovery multipart closure is unconfirmed");
  if(receipt.projectId!==op.projectId||receipt.incarnation!==op.incarnation||receipt.commit!==op.commit||receipt.tree!==op.tree||receipt.journalId!==op.journalId||receipt.objectScope!=="exact-accepted-reachable-closure"||! /^[a-f0-9]{64}$/.test(receipt.sha256)||!Number.isSafeInteger(receipt.size)||receipt.size<1||receipt.size>512*1024*1024||!Number.isSafeInteger(receipt.objectCount)||receipt.objectCount<1)throw new Error("Recovery receipt scope mismatch");
  if(op.receipt&&JSON.stringify(op.receipt)!==JSON.stringify(receipt))throw new Error("Recovery receipt is immutable");
  this.storage.sql.exec("UPDATE private_recovery_operations SET doc=? WHERE id=?",JSON.stringify({...op,status:"ready",receipt,error:undefined}),id);
 }
 fail(id:string):void {const op=this.get(id);if(!op||op.status==="ready")return;this.storage.sql.exec("UPDATE private_recovery_operations SET doc=? WHERE id=?",JSON.stringify({...op,status:"failed",error:"Preparation did not complete. The accepted repository history remains intact."}),id);}
}
