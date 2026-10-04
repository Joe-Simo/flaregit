import { z } from "zod";
const text = z.string().min(1).max(256);
const schema = z.object({ workflowId:text,candidateId:text,projectId:text,incarnation:z.string().uuid(),actorId:text,accountKey:text }).strict();
export type IntegrationNativeRuntimeScope = z.infer<typeof schema>;
export interface IntegrationNativeAllocation { nativeRunId:string;stage:string;stopped:boolean }
export class IntegrationNativeRuntimeError extends Error {}
/** Funded, authorized callers record intent before VM allocation. Coverage is
 * declared only at fresh workflow entry; historical absence is never backfilled. */
export class IntegrationNativeRuntimeLedger {
 constructor(private readonly storage:DurableObjectStorage, initialize=true) {
  if(!initialize)return;
  storage.sql.exec("CREATE TABLE IF NOT EXISTS integration_native_coverage(workflow_id TEXT PRIMARY KEY,scope TEXT NOT NULL,sealed INTEGER NOT NULL)");
  storage.sql.exec("CREATE TABLE IF NOT EXISTS integration_native_commands(command_id TEXT PRIMARY KEY,workflow_id TEXT NOT NULL,native_id TEXT NOT NULL,outcome TEXT)");
  storage.sql.exec("CREATE INDEX IF NOT EXISTS integration_native_commands_workflow ON integration_native_commands(workflow_id,outcome)");
  storage.sql.exec("CREATE INDEX IF NOT EXISTS integration_native_coverage_pending ON integration_native_coverage(sealed,workflow_id)");
  storage.sql.exec("CREATE TABLE IF NOT EXISTS integration_native_allocations(native_id TEXT PRIMARY KEY,workflow_id TEXT NOT NULL,stage TEXT NOT NULL,stopped INTEGER NOT NULL)");
  storage.sql.exec("CREATE INDEX IF NOT EXISTS integration_native_allocations_pending ON integration_native_allocations(workflow_id,stopped)");
 }
 static inspect(storage:DurableObjectStorage,identity:Pick<IntegrationNativeRuntimeScope,"workflowId"|"candidateId"|"projectId"|"incarnation">){return new IntegrationNativeRuntimeLedger(storage,false).inspect(identity);}
 inspect(identity:Pick<IntegrationNativeRuntimeScope,"workflowId"|"candidateId"|"projectId"|"incarnation">) {
  const tables=this.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('integration_native_coverage','integration_native_allocations','integration_native_commands')").toArray();
  if(tables.length!==3)return {coverage:false,sealed:null,status:"recovery_required" as const,allocations:null,commands:null};
  const row=this.storage.sql.exec<{scope:string;sealed:number}>("SELECT scope,sealed FROM integration_native_coverage WHERE workflow_id=?",identity.workflowId).toArray()[0];
  if(!row)return {coverage:false,sealed:null,status:"recovery_required" as const,allocations:null,commands:null};
  const scope=schema.parse(JSON.parse(row.scope));for(const key of ["workflowId","candidateId","projectId","incarnation"] as const)if(scope[key]!==identity[key])throw new IntegrationNativeRuntimeError("Saved native coverage identity differs");
  const allocations=this.allocations(scope),commands=this.storage.sql.exec<{total:number;pending:number;completed:number;refused:number}>("SELECT COUNT(*) AS total,COALESCE(SUM(outcome IS NULL),0) AS pending,COALESCE(SUM(outcome='completed'),0) AS completed,COALESCE(SUM(outcome='refused'),0) AS refused FROM integration_native_commands WHERE workflow_id=?",identity.workflowId).toArray()[0]!;
  return {coverage:true,sealed:row.sealed===1,status:this.recovery(scope),allocations,commands};
 }
 private encoded(scope:IntegrationNativeRuntimeScope) { return JSON.stringify(schema.parse(scope)); }
 private coverage(scope:IntegrationNativeRuntimeScope) {
  const encoded=this.encoded(scope), row=this.storage.sql.exec<{scope:string;sealed:number}>("SELECT scope,sealed FROM integration_native_coverage WHERE workflow_id=?",scope.workflowId).toArray()[0];
  if(row && row.scope!==encoded) throw new IntegrationNativeRuntimeError("Native runtime scope differs from saved workflow");
  return row;
 }
 declareCoverage(scope:IntegrationNativeRuntimeScope) { this.storage.transactionSync(()=> { if(this.coverage(scope)) return; this.storage.sql.exec("INSERT INTO integration_native_coverage VALUES(?,?,0)",scope.workflowId,this.encoded(scope)); }); }
 reserve(scope:IntegrationNativeRuntimeScope,nativeRunId:string,stage:string) {
  z.string().uuid().parse(nativeRunId);text.parse(stage);
  this.storage.transactionSync(()=> {
   const coverage=this.coverage(scope);if(!coverage || coverage.sealed) throw new IntegrationNativeRuntimeError("Native allocation coverage is absent or sealed");
   const existing=this.storage.sql.exec<{workflow_id:string;stage:string}>("SELECT workflow_id,stage FROM integration_native_allocations WHERE native_id=?",nativeRunId).toArray()[0];
   if(existing) { if(existing.workflow_id!==scope.workflowId || existing.stage!==stage) throw new IntegrationNativeRuntimeError("Native allocation identity belongs to another operation");return; }
   if(this.allocations(scope).length>=64) throw new IntegrationNativeRuntimeError("Native allocation limit reached");
   this.storage.sql.exec("INSERT INTO integration_native_allocations VALUES(?,?,?,0)",nativeRunId,scope.workflowId,stage);
  });
 }
 /** Must finish before terminating the old workflow. */
 seal(scope:IntegrationNativeRuntimeScope) { this.storage.transactionSync(()=> { if(!this.coverage(scope)) return;this.storage.sql.exec("UPDATE integration_native_coverage SET sealed=1 WHERE workflow_id=?",scope.workflowId); }); }
 allocations(scope:IntegrationNativeRuntimeScope):IntegrationNativeAllocation[] {
  if(!this.coverage(scope)) return [];
  const rows=this.storage.sql.exec<{native_id:string;stage:string;stopped:number}>("SELECT native_id,stage,stopped FROM integration_native_allocations WHERE workflow_id=? ORDER BY native_id LIMIT 65",scope.workflowId).toArray();
  if(rows.length>64 || JSON.stringify(rows).length>32768) throw new IntegrationNativeRuntimeError("Native runtime enumeration exceeds safety limits");
  return rows.map(row=>({nativeRunId:row.native_id,stage:row.stage,stopped:row.stopped===1}));
 }
 /** Accept only a server control read of the exact native ID, never stop-call ACK. */
 confirmStopped(scope:IntegrationNativeRuntimeScope,nativeRunId:string,proof:{nativeRunId:string;state:"stopped"}) {
  this.storage.transactionSync(()=> { if(proof.nativeRunId!==nativeRunId || proof.state!=="stopped" || !this.allocations(scope).some(row=>row.nativeRunId===nativeRunId)) throw new IntegrationNativeRuntimeError("Exact stopped native runtime proof required");this.storage.sql.exec("UPDATE integration_native_allocations SET stopped=1 WHERE native_id=? AND workflow_id=?",nativeRunId,scope.workflowId); });
 }
 /** An ambiguous execution retains its active permit until positive server proof. */
 admitCommand(scope:IntegrationNativeRuntimeScope,nativeRunId:string,commandId:string) {
  z.string().uuid().parse(commandId);
  this.storage.transactionSync(()=> {
   const coverage=this.coverage(scope);
   if(!coverage || coverage.sealed) throw new IntegrationNativeRuntimeError("Native commands are sealed or uncovered");
   const native=this.storage.sql.exec<{stopped:number}>("SELECT stopped FROM integration_native_allocations WHERE native_id=? AND workflow_id=?",nativeRunId,scope.workflowId).toArray()[0];
   if(!native || native.stopped) throw new IntegrationNativeRuntimeError("Native runtime is absent or stopped");
   const existing=this.storage.sql.exec<{workflow_id:string;native_id:string;outcome:string|null}>("SELECT workflow_id,native_id,outcome FROM integration_native_commands WHERE command_id=?",commandId).toArray()[0];
   if(existing) {
    if(existing.workflow_id!==scope.workflowId || existing.native_id!==nativeRunId || existing.outcome!==null) throw new IntegrationNativeRuntimeError("Command identity is consumed or differs");
    return;
   }
   const counts=this.storage.sql.exec<{total:number;active:number}>("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN outcome IS NULL THEN 1 ELSE 0 END),0) AS active FROM integration_native_commands WHERE workflow_id=?",scope.workflowId).toArray()[0];
   if((counts?.active??0)>=32 || (counts?.total??0)>=4096) throw new IntegrationNativeRuntimeError("Native command permit capacity reached");
   this.storage.sql.exec("INSERT INTO integration_native_commands VALUES(?,?,?,NULL)",commandId,scope.workflowId,nativeRunId);
  });
 }
 commandAllowed(scope:IntegrationNativeRuntimeScope,nativeRunId:string,commandId:string):boolean {
  const coverage=this.coverage(scope);if(!coverage || coverage.sealed) return false;
  return this.storage.sql.exec("SELECT c.command_id FROM integration_native_commands c JOIN integration_native_allocations a ON a.native_id=c.native_id AND a.workflow_id=c.workflow_id WHERE c.command_id=? AND c.workflow_id=? AND c.native_id=? AND c.outcome IS NULL AND a.stopped=0",commandId,scope.workflowId,nativeRunId).toArray().length===1;
 }
 /** Called by server execution controller only after completion or positive refusal;
  * thrown/unknown SDK outcomes must retain the active permit. */
 finishCommand(scope:IntegrationNativeRuntimeScope,nativeRunId:string,commandId:string,proof:{outcome:"completed"|"refused"}) {
  z.enum(["completed","refused"]).parse(proof.outcome);
  this.storage.transactionSync(()=> {
   if(!this.coverage(scope)) throw new IntegrationNativeRuntimeError("Native command scope is uncovered");
   const row=this.storage.sql.exec<{outcome:string|null}>("SELECT outcome FROM integration_native_commands WHERE command_id=? AND workflow_id=? AND native_id=?",commandId,scope.workflowId,nativeRunId).toArray()[0];
   if(!row || (row.outcome!==null && row.outcome!==proof.outcome)) throw new IntegrationNativeRuntimeError("Exact command completion proof required");
   this.storage.sql.exec("UPDATE integration_native_commands SET outcome=? WHERE command_id=? AND outcome IS NULL",proof.outcome,commandId);
   // A command completing after an earlier stop invalidates that stop proof.
   // Replayed completion must not invalidate a later fresh stop confirmation.
   if(row.outcome===null && proof.outcome==="completed") this.storage.sql.exec("UPDATE integration_native_allocations SET stopped=0 WHERE native_id=? AND workflow_id=?",nativeRunId,scope.workflowId);
  });
 }
 /** Bounded cleanup inventory; truncation requires another pass, never clearance. */
 pendingScopes(limit=20):{scopes:IntegrationNativeRuntimeScope[];truncated:boolean} {
  z.number().int().min(1).max(20).parse(limit);
  const pending="sealed=0 OR EXISTS(SELECT 1 FROM integration_native_allocations a WHERE a.workflow_id=c.workflow_id AND a.stopped=0) OR EXISTS(SELECT 1 FROM integration_native_commands m WHERE m.workflow_id=c.workflow_id AND m.outcome IS NULL)";
  const bytes=this.storage.sql.exec<{bytes:number}>(`SELECT COALESCE(SUM(LENGTH(CAST(scope AS BLOB))),0) AS bytes FROM (SELECT scope FROM integration_native_coverage c WHERE ${pending} ORDER BY workflow_id LIMIT ?)`,limit+1).toArray()[0]?.bytes??0;
  if(bytes>32768) throw new IntegrationNativeRuntimeError("Pending native scope inventory exceeds safety limits");
  const rows=this.storage.sql.exec<{scope:string}>(`SELECT scope FROM integration_native_coverage c WHERE ${pending} ORDER BY workflow_id LIMIT ?`,limit+1).toArray();
  return {scopes:rows.slice(0,limit).map(row=>schema.parse(JSON.parse(row.scope))),truncated:rows.length>limit};
 }
 hasUnconfirmed():boolean {
  return this.storage.sql.exec<{held:number}>("SELECT (EXISTS(SELECT 1 FROM integration_native_coverage WHERE sealed=0) OR EXISTS(SELECT 1 FROM integration_native_allocations WHERE stopped=0) OR EXISTS(SELECT 1 FROM integration_native_commands WHERE outcome IS NULL)) AS held").toArray()[0]?.held===1;
 }
 recovery(scope:IntegrationNativeRuntimeScope):"recovery_required"|"held"|"stopped" {
  const coverage=this.coverage(scope);if(!coverage) return "recovery_required";
  const active=this.storage.sql.exec<{count:number}>("SELECT COUNT(*) AS count FROM integration_native_commands WHERE workflow_id=? AND outcome IS NULL",scope.workflowId).toArray()[0]?.count??0;
  return !coverage.sealed || active>0 || this.allocations(scope).some(row=>!row.stopped)?"held":"stopped";
 }
}

export type IntegrationNativeInspection = ReturnType<IntegrationNativeRuntimeLedger["inspect"]>;
