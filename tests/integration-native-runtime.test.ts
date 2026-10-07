import { Database } from "bun:sqlite";
import { expect,test } from "bun:test";
import { IntegrationNativeRuntimeLedger } from "../src/server/integration-native-runtime";
function fixture() {
 const db=new Database(":memory:");
 const storage={sql:{exec(query:string,...bindings:Array<string|number>) { const rows=db.query(query).all(...bindings);return {toArray:()=>rows}; }},transactionSync<T>(fn:()=>T) {return db.transaction(fn)();}};
 const ledger=new IntegrationNativeRuntimeLedger(storage as unknown as DurableObjectStorage);
 const scope={workflowId:"workflow",candidateId:"candidate",projectId:"project",incarnation:crypto.randomUUID(),actorId:"actor",accountKey:"account"};
 return {db,ledger,scope,storage};
}
test("absent legacy coverage never proves zero native executions; seal fences late allocation",()=> {
 const {db,ledger,scope}=fixture();try {
 expect(ledger.recovery(scope)).toBe("recovery_required");ledger.seal(scope);expect(ledger.recovery(scope)).toBe("recovery_required");
 expect(()=>ledger.reserve(scope,crypto.randomUUID(),"merge")).toThrow();
 ledger.declareCoverage(scope);const id=crypto.randomUUID();ledger.reserve(scope,id,"merge");ledger.reserve(scope,id,"merge");expect(ledger.allocations(scope)).toHaveLength(1);
 ledger.seal(scope);expect(ledger.recovery(scope)).toBe("held");expect(()=>ledger.reserve(scope,crypto.randomUUID(),"late")).toThrow();
 expect(()=>ledger.confirmStopped(scope,id,{nativeRunId:crypto.randomUUID(),state:"stopped"})).toThrow();
 ledger.confirmStopped(scope,id,{nativeRunId:id,state:"stopped"});expect(ledger.recovery(scope)).toBe("stopped");
 expect(()=>ledger.allocations({...scope,actorId:"replacement"})).toThrow();expect(ledger.allocations(scope)[0]?.stopped).toBe(true);
 } finally {db.close();}
});
test("fresh successor is independent and enumeration has a durable conservative cap",()=> {
 const {db,ledger,scope}=fixture();try {
 ledger.declareCoverage(scope);for(let n=0;n<64;n++) ledger.reserve(scope,crypto.randomUUID(),"check");
 expect(()=>ledger.reserve(scope,crypto.randomUUID(),"overflow")).toThrow();expect(ledger.allocations(scope)).toHaveLength(64);
 const successor={...scope,workflowId:"successor",candidateId:"new-candidate"};ledger.declareCoverage(successor);ledger.seal(successor);expect(ledger.recovery(successor)).toBe("stopped");expect(ledger.recovery(scope)).toBe("held");
 }finally{db.close();}
});
test("sealed workflows remain held until every ambiguous command drains",()=> {
 const {db,ledger,scope}=fixture();try {
 ledger.declareCoverage(scope);const native=crypto.randomUUID(),command=crypto.randomUUID();ledger.reserve(scope,native,"check");ledger.admitCommand(scope,native,command);
 expect(ledger.commandAllowed(scope,native,command)).toBe(true);ledger.seal(scope);expect(ledger.commandAllowed(scope,native,command)).toBe(false);
 expect(()=>ledger.admitCommand(scope,native,crypto.randomUUID())).toThrow();ledger.confirmStopped(scope,native,{nativeRunId:native,state:"stopped"});expect(ledger.recovery(scope)).toBe("held");
 expect(()=>ledger.finishCommand({...scope,actorId:"different"},native,command,{outcome:"completed"})).toThrow();
 ledger.finishCommand(scope,native,command,{outcome:"completed"});expect(ledger.recovery(scope)).toBe("held");ledger.confirmStopped(scope,native,{nativeRunId:native,state:"stopped"});expect(ledger.recovery(scope)).toBe("stopped");ledger.finishCommand(scope,native,command,{outcome:"completed"});expect(ledger.recovery(scope)).toBe("stopped");expect(()=>ledger.finishCommand(scope,native,command,{outcome:"refused"})).toThrow();
 }finally{db.close();}
});
test("command admission bounds active and historical permits without deleting history",()=> {
 const {db,ledger,scope}=fixture();try {
 ledger.declareCoverage(scope);const native=crypto.randomUUID();ledger.reserve(scope,native,"check");const ids=Array.from({length:32},()=>crypto.randomUUID());for(const id of ids) ledger.admitCommand(scope,native,id);
 expect(()=>ledger.admitCommand(scope,native,crypto.randomUUID())).toThrow();for(const id of ids) ledger.finishCommand(scope,native,id,{outcome:"refused"});
 const insert=db.query("INSERT INTO integration_native_commands VALUES(?,?,?,'completed')");db.transaction(()=>{for(let i=32;i<4096;i++) insert.run(crypto.randomUUID(),scope.workflowId,native);})();
 expect(()=>ledger.admitCommand(scope,native,crypto.randomUUID())).toThrow();expect(db.query("SELECT COUNT(*) AS count FROM integration_native_commands").get()).toEqual({count:4096});
 }finally{db.close();}
});
test("cleanup inventory retains active commands even when every native stop is confirmed",()=> {
 const {db,ledger,scope}=fixture();try {
 ledger.declareCoverage(scope);const id=crypto.randomUUID(),command=crypto.randomUUID();ledger.reserve(scope,id,"check");ledger.admitCommand(scope,id,command);ledger.seal(scope);ledger.confirmStopped(scope,id,{nativeRunId:id,state:"stopped"});
 expect(ledger.hasUnconfirmed()).toBe(true);expect(ledger.pendingScopes()).toEqual({scopes:[scope],truncated:false});
 ledger.finishCommand(scope,id,command,{outcome:"refused"});expect(ledger.hasUnconfirmed()).toBe(false);expect(ledger.pendingScopes()).toEqual({scopes:[],truncated:false});
 }finally{db.close();}
});
test("cleanup scope inventory reports partial enumeration explicitly",()=> {
 const {db,ledger,scope}=fixture();try {
 for(let i=0;i<3;i++) ledger.declareCoverage({...scope,workflowId:`workflow-${i}`});
 const page=ledger.pendingScopes(2);expect(page.scopes).toHaveLength(2);expect(page.truncated).toBe(true);expect(ledger.hasUnconfirmed()).toBe(true);
 expect(()=>ledger.pendingScopes(21)).toThrow();for(let i=0;i<3;i++) ledger.seal({...scope,workflowId:`workflow-${i}`});expect(ledger.hasUnconfirmed()).toBe(false);
 }finally{db.close();}
});

test("owner inspection is read-only, bounded and excludes secret scope",()=>{const {db,ledger,scope}=fixture();try{const identity={workflowId:scope.workflowId,candidateId:scope.candidateId,projectId:scope.projectId,incarnation:scope.incarnation};expect(ledger.inspect(identity).status).toBe("recovery_required");expect(ledger.inspect(identity).allocations).toBeNull();expect(ledger.inspect(identity).commands).toBeNull();expect(db.query("SELECT COUNT(*) AS count FROM integration_native_coverage").get()).toEqual({count:0});ledger.declareCoverage(scope);const native=crypto.randomUUID(),command=crypto.randomUUID();ledger.reserve(scope,native,"check");ledger.admitCommand(scope,native,command);const before=JSON.stringify(db.query("SELECT * FROM integration_native_coverage").all());const report=ledger.inspect(identity);expect(report.status).toBe("held");expect(report.commands).toEqual({total:1,pending:1,completed:0,refused:0});expect(report.allocations).toHaveLength(1);expect(JSON.stringify(report)).not.toContain('accountKey');expect(JSON.stringify(report)).not.toContain('actorId');expect(JSON.stringify(db.query("SELECT * FROM integration_native_coverage").all())).toBe(before);expect(()=>ledger.inspect({...identity,incarnation:crypto.randomUUID()})).toThrow("identity differs");}finally{db.close();}});

test("read-only inspection does not create schema for historical repositories",()=>{const {db,scope,storage}=fixture();try{db.exec("DROP TABLE integration_native_commands;DROP TABLE integration_native_allocations;DROP TABLE integration_native_coverage");const before=db.query("SELECT name,type FROM sqlite_master ORDER BY name").all();const report=IntegrationNativeRuntimeLedger.inspect(storage as unknown as DurableObjectStorage,scope);expect(report.status).toBe("recovery_required");expect(report.allocations).toBeNull();expect(report.commands).toBeNull();expect(db.query("SELECT name,type FROM sqlite_master ORDER BY name").all()).toEqual(before);}finally{db.close();}});
test('verification closure binds exact stopped phase while permitting only future fixed publisher',()=>{const{db,ledger,scope,storage}=fixture();try{const identity={commit:'a'.repeat(40),tree:'b'.repeat(40),evidenceId:'evidence'},native=crypto.randomUUID(),command=crypto.randomUUID();expect(()=>ledger.closeVerification(scope,identity)).toThrow('coverage');ledger.declareCoverage(scope);ledger.reserve(scope,native,'integrate-'+scope.candidateId);ledger.admitCommand(scope,native,command);ledger.confirmStopped(scope,native,{nativeRunId:native,state:'stopped'});expect(()=>ledger.closeVerification(scope,identity)).toThrow('unconfirmed');ledger.finishCommand(scope,native,command,{outcome:'completed'});expect(()=>ledger.closeVerification(scope,identity)).toThrow('unconfirmed');ledger.confirmStopped(scope,native,{nativeRunId:native,state:'stopped'});const receipt=ledger.closeVerification(scope,identity);expect(receipt.snapshot.commands).toEqual({total:1,pending:0,completed:1,refused:0});const reopened=new IntegrationNativeRuntimeLedger(storage as unknown as DurableObjectStorage);expect(reopened.verificationClosure(scope,identity)).toEqual(receipt);expect(()=>reopened.closeVerification(scope,{...identity,commit:'c'.repeat(40)})).toThrow('changed');expect(()=>reopened.reserve(scope,crypto.randomUUID(),'integrate-'+scope.candidateId)).toThrow('closed');expect(()=>reopened.reserve(scope,crypto.randomUUID(),'publish-other')).toThrow('closed');const publisher=crypto.randomUUID(),publishCommand=crypto.randomUUID();reopened.reserve(scope,publisher,'publish-'+scope.candidateId);reopened.admitCommand(scope,publisher,publishCommand);expect(reopened.commandAllowed(scope,publisher,publishCommand)).toBe(true);expect(reopened.verificationClosure(scope,identity)).toEqual(receipt);expect(reopened.recovery(scope)).toBe('held');reopened.seal(scope);expect(()=>reopened.reserve(scope,crypto.randomUUID(),'publish-'+scope.candidateId)).toThrow('sealed');}finally{db.close();}});
test('verification closure refuses publisher allocated early and never creates historical coverage',()=>{const{db,ledger,scope}=fixture();try{const identity={commit:'a'.repeat(40),tree:'b'.repeat(40),evidenceId:'evidence'};expect(ledger.verificationClosure(scope,identity)).toBeNull();ledger.declareCoverage(scope);const publisher=crypto.randomUUID();ledger.reserve(scope,publisher,'publish-'+scope.candidateId);ledger.confirmStopped(scope,publisher,{nativeRunId:publisher,state:'stopped'});expect(()=>ledger.closeVerification(scope,identity)).toThrow('before');}finally{db.close();}});
test('post-acceptance rebase has separate exact journal authority without reopening verification',()=>{const{db,ledger,scope}=fixture();try{const identity={commit:'a'.repeat(40),tree:'b'.repeat(40),evidenceId:'evidence'},proof={journalId:'accepted-journal',commit:identity.commit};ledger.declareCoverage(scope);expect(()=>ledger.closeVerification(scope,identity)).toThrow('unconfirmed');expect(()=>ledger.authorizeAcceptedRebase(scope,proof)).toThrow('closure');const verifier=crypto.randomUUID(),verificationCommand=crypto.randomUUID();ledger.reserve(scope,verifier,'integrate-'+scope.candidateId);ledger.admitCommand(scope,verifier,verificationCommand);ledger.finishCommand(scope,verifier,verificationCommand,{outcome:'completed'});ledger.confirmStopped(scope,verifier,{nativeRunId:verifier,state:'stopped'});const receipt=ledger.closeVerification(scope,identity);expect(()=>ledger.reserve(scope,crypto.randomUUID(),'rebase-'+scope.candidateId)).toThrow('closed');expect(()=>ledger.authorizeAcceptedRebase(scope,{...proof,commit:'c'.repeat(40)})).toThrow('differs');ledger.authorizeAcceptedRebase(scope,proof);ledger.authorizeAcceptedRebase(scope,proof);expect(()=>ledger.authorizeAcceptedRebase(scope,{...proof,journalId:'other-journal'})).toThrow('changed');const native=crypto.randomUUID(),command=crypto.randomUUID();ledger.reserve(scope,native,'rebase-'+scope.candidateId);ledger.admitCommand(scope,native,command);expect(ledger.commandAllowed(scope,native,command)).toBe(true);expect(ledger.verificationClosure(scope,identity)).toEqual(receipt);expect(()=>ledger.reserve(scope,crypto.randomUUID(),'integrate-'+scope.candidateId)).toThrow('closed');expect(()=>ledger.reserve(scope,crypto.randomUUID(),'rebase-other')).toThrow('closed');ledger.seal(scope);expect(ledger.commandAllowed(scope,native,command)).toBe(false);}finally{db.close();}});
