import {Database} from "bun:sqlite";
import {expect,test} from "bun:test";
import {RetainedCredentialIncidents} from "../src/server/retained-credential-incidents";
import type {RetainedInput} from "../src/server/retained-inputs";
const now=1000,expiry=2000;
function input():RetainedInput{const id=crypto.randomUUID(),incarnation=crypto.randomUUID();return{id,projectId:"p123456789abc",incarnation,taskId:"task",commit:"a".repeat(40),base:"b".repeat(40),canonicalRepoName:"flaregit-p123456789abc",workspaceRepoName:"flaregit-p123456789abc-task",branch:"task/work",protectedRef:`refs/flaregit/inputs/${incarnation}/task/${"a".repeat(40)}`,protectedBaseRef:`refs/flaregit/inputs/${incarnation}/task/${"b".repeat(40)}`,workflowId:"integration-actual-fixture",candidateId:"candidate",actorId:"synthetic-actor",ownerId:"synthetic-owner",accountKey:"a".repeat(12),version:1};}
function fixture(){const db=new Database(":memory:");const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};return{db,ledger:new RetainedCredentialIncidents(storage as unknown as DurableObjectStorage)};}
test("issuance requires an immutable current authorized pin before any token receipt",async()=>{
 const{ledger,db}=fixture(),scope=input();let validations=0;
 expect(()=>ledger.begin(scope,"canonical",expiry,"write",()=>{validations++;throw Error("Owner revoked");},now)).toThrow("Owner revoked");
 expect(validations).toBe(1);expect(db.query("SELECT COUNT(*) AS n FROM retained_credential_incidents").get()).toEqual({n:0});
 await expect(ledger.record(scope.id,"canonical",scope.canonicalRepoName,"synthetic-private-token",expiry,undefined,now)).rejects.toThrow("exact issuance intent");
 expect(ledger.begin(scope,"canonical",expiry,"write",()=>{validations++;},now)).toBe(true);expect(ledger.begin(scope,"canonical",expiry,"write",undefined,now)).toBe(false);
 expect(ledger.summary(scope.id,"canonical")).toEqual({status:"issuance_unknown",expiresAt:null,fingerprint:null});
 expect(()=>ledger.begin({...scope,ownerId:"another-owner"},"canonical",expiry,"write",undefined,now)).toThrow("intent changed");
 expect(()=>ledger.begin(scope,"canonical",expiry,"read",undefined,now)).toThrow("intent changed");
 expect(()=>ledger.begin(scope,"canonical",expiry+1,"write",undefined,now)).toThrow("intent changed");
});
test("cleanup receipt survives owner withdrawal but rejects any other repo or issuance identity",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"workspace",expiry,"read",undefined,now);
 await expect(ledger.record(scope.id,"workspace",scope.canonicalRepoName,"synthetic-private-token",expiry,undefined,now)).rejects.toThrow("exact issuance intent");
 await expect(ledger.record(scope.id,"canonical",scope.canonicalRepoName,"synthetic-private-token",expiry,undefined,now)).rejects.toThrow("exact issuance intent");
 // There is intentionally no fresh-owner callback for recording an already-issued cleanup capability.
 await ledger.record(scope.id,"workspace",scope.workspaceRepoName,"synthetic-private-token",expiry,undefined,now);
 expect(ledger.pendingBatch(now)[0]).toMatchObject({inputId:scope.id,purpose:"workspace",accountKey:scope.accountKey,repoName:scope.workspaceRepoName,token:"synthetic-private-token"});
 const summary=ledger.summary(scope.id,"workspace");expect(summary?.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(summary)).not.toContain("synthetic-private-token");expect(JSON.stringify(summary)).not.toContain(scope.accountKey);
 await expect(ledger.record(scope.id,"workspace",scope.workspaceRepoName,"another-private-token",expiry,undefined,now)).rejects.toThrow("receipt changed");
 await expect(ledger.record(scope.id,"workspace",scope.workspaceRepoName,"synthetic-private-token",expiry+1,undefined,now)).rejects.toThrow("receipt changed");
 await expect(ledger.markRevoked(scope.id,"workspace","wrong-token")).rejects.toThrow("mismatch");
 await ledger.markRevoked(scope.id,"workspace","synthetic-private-token");expect(ledger.summary(scope.id,"workspace")?.status).toBe("revoked");expect(db.query("SELECT token FROM retained_credential_incidents").get()).toEqual({token:null});
 await ledger.record(scope.id,"workspace",scope.workspaceRepoName,"synthetic-private-token",expiry,undefined,now);expect(ledger.summary(scope.id,"workspace")?.status).toBe("revoked");expect(ledger.pendingBatch(now)).toHaveLength(0);expect(ledger.begin(scope,"workspace",expiry,"read",undefined,now)).toBe(false);
});
test("receipt hashing is followed by a fresh exact-intent check before saving the secret",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"canonical",expiry,"write",undefined,now);let calls=0;
 await expect(ledger.record(scope.id,"canonical",scope.canonicalRepoName,"synthetic-private-token",expiry,()=>{calls++;throw Error("Exact cleanup scope changed");},now)).rejects.toThrow("scope changed");
 expect(calls).toBe(1);expect(db.query("SELECT token,fingerprint,status FROM retained_credential_incidents").get()).toEqual({token:null,fingerprint:null,status:"issuance_unknown"});
});
test("bounded retries retain uncertainty and provider expiry erases secrets without claiming revocation",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"canonical",expiry,"write",undefined,now);await ledger.record(scope.id,"canonical",scope.canonicalRepoName,"synthetic-private-token",expiry,undefined,now);
 for(let index=0;index<4;index++)expect(ledger.markAttempt(scope.id,"canonical")).toBe(true);expect(ledger.markAttempt(scope.id,"canonical")).toBe(false);expect(ledger.pendingBatch(now)).toHaveLength(0);expect(ledger.hasPending()).toBe(true);
 ledger.pendingBatch(expiry);expect(ledger.summary(scope.id,"canonical")?.status).toBe("expired_unverified");expect(ledger.hasPending()).toBe(false);expect(db.query("SELECT token FROM retained_credential_incidents").get()).toEqual({token:null});await expect(ledger.markRevoked(scope.id,"canonical","synthetic-private-token")).rejects.toThrow("unverified");
});
test("lost creation responses and malformed actual expiry never fabricate clean credentials",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"canonical",expiry,"write",undefined,now);ledger.pendingBatch(expiry+1);expect(ledger.summary(scope.id,"canonical")?.status).toBe("issuance_unknown");
 await ledger.record(scope.id,"canonical",scope.canonicalRepoName,"synthetic-private-token",NaN,undefined,now);ledger.pendingBatch(Number.MAX_SAFE_INTEGER);expect(ledger.summary(scope.id,"canonical")).toMatchObject({status:"pending",expiresAt:null});expect(db.query("SELECT token FROM retained_credential_incidents").get()).toEqual({token:"synthetic-private-token"});
 await ledger.markRevoked(scope.id,"canonical","synthetic-private-token");expect(ledger.summary(scope.id,"canonical")?.status).toBe("revoked");
});
test("oversized and malformed intents reject before storage, and alarm batches have a separate cap",async()=>{
 const{ledger,db}=fixture();expect(()=>ledger.begin(input(),"canonical",now+900001,"write",undefined,now)).toThrow("Invalid");const wrong=input();expect(()=>ledger.begin({...wrong,protectedRef:`refs/flaregit/retained/${crypto.randomUUID()}/input`},"canonical",expiry,"write",undefined,now)).toThrow("Invalid");
 for(let index=0;index<21;index++){const scope=input();ledger.begin(scope,"workspace",expiry,"read",undefined,now);await ledger.record(scope.id,"workspace",scope.workspaceRepoName,"synthetic-private-token",expiry,undefined,now);}expect(ledger.pendingBatch(now)).toHaveLength(20);expect(db.query("SELECT COUNT(*) AS n FROM retained_credential_incidents").get()).toEqual({n:21});
});

test("retention capacity denies new issuance before creation while exact old replay remains closed",()=>{
 const{ledger,db}=fixture();let first:RetainedInput|null=null;
 for(let index=0;index<1000;index++){const scope=input();first??=scope;ledger.begin(scope,"canonical",expiry,"write",undefined,now);}
 expect(()=>ledger.begin(input(),"canonical",expiry,"write",undefined,now)).toThrow("limit reached");
 expect(ledger.begin(first!,"canonical",expiry,"write",undefined,now)).toBe(false);
 expect(db.query("SELECT COUNT(*) AS n FROM retained_credential_incidents").get()).toEqual({n:1000});
});

test("unknown expiry exhausts automatic work without clearing an uncertain secret or looping alarms",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"canonical",expiry,"write",undefined,now);await ledger.record(scope.id,"canonical",scope.canonicalRepoName,"synthetic-private-token",NaN,undefined,now);
 expect(ledger.nextWake(now)).toBe(now+120000);
 for(let index=0;index<4;index++){expect(ledger.markAutomaticSweep(scope.id,"canonical")).toBe(true);expect(ledger.markAttempt(scope.id,"canonical")).toBe(true);}
 expect(ledger.markAutomaticSweep(scope.id,"canonical")).toBe(false);expect(ledger.pendingBatch(now)).toHaveLength(0);expect(ledger.nextWake(now)).toBeNull();expect(ledger.nextWake(now+10_000_000)).toBeNull();expect(ledger.hasPending()).toBe(true);expect(ledger.summary(scope.id,"canonical")).toMatchObject({status:"pending",expiresAt:null});expect(db.query("SELECT token,attempts,automatic_sweeps FROM retained_credential_incidents").get()).toEqual({token:"synthetic-private-token",attempts:4,automatic_sweeps:4});expect(ledger.credentialForRevocation(scope.id,"canonical",now)).toBeNull();
});
test("exhausted known expiry schedules only its final erasure wake without claiming verified revocation",async()=>{
 const{ledger,db}=fixture(),scope=input(),expires=now+500000;ledger.begin(scope,"canonical",expires,"write",undefined,now);await ledger.record(scope.id,"canonical",scope.canonicalRepoName,"synthetic-private-token",expires,undefined,now);
 expect(ledger.nextWake(now)).toBe(now+120000);for(let index=0;index<4;index++){ledger.markAutomaticSweep(scope.id,"canonical");ledger.markAttempt(scope.id,"canonical");}
 expect(ledger.nextWake(now)).toBe(expires);expect(ledger.nextWake(now+300000)).toBe(expires);expect(ledger.nextWake(expires)).toBeNull();expect(ledger.summary(scope.id,"canonical")?.status).toBe("expired_unverified");expect(db.query("SELECT token FROM retained_credential_incidents").get()).toEqual({token:null});
});
test("funding denial consumes automatic opportunities without fake provider attempts and permits remaining explicit cleanup",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"workspace",expiry,"read",undefined,now);await ledger.record(scope.id,"workspace",scope.workspaceRepoName,"synthetic-private-token",NaN,undefined,now);
 // Four automatic funding denials: no provider was called and markAttempt was never invoked.
 for(let index=0;index<4;index++)ledger.markAutomaticSweep(scope.id,"workspace");
 expect(ledger.nextWake(now)).toBeNull();expect(ledger.pendingBatch(now)).toHaveLength(0);expect(db.query("SELECT attempts,automatic_sweeps FROM retained_credential_incidents").get()).toEqual({attempts:0,automatic_sweeps:4});
 expect(ledger.credentialForRevocation(scope.id,"workspace",now)?.token).toBe("synthetic-private-token");expect(ledger.markAttempt(scope.id,"workspace")).toBe(true);await ledger.markRevoked(scope.id,"workspace","synthetic-private-token");expect(ledger.summary(scope.id,"workspace")?.status).toBe("revoked");expect(db.query("SELECT attempts,automatic_sweeps,token FROM retained_credential_incidents").get()).toEqual({attempts:1,automatic_sweeps:4,token:null});
});
test("accepted mirror follow-up credential intents remain canonical and read-only",()=>{
 const{ledger}=fixture();const scope:RetainedInput={...input(),followup:true};expect(()=>ledger.begin(scope,"workspace",expiry,"read",undefined,now)).toThrow("Invalid");expect(()=>ledger.begin(scope,"canonical",expiry,"write",undefined,now)).toThrow("Invalid");expect(ledger.begin(scope,"canonical",expiry,"read",undefined,now)).toBe(true);
});

test("historical canonical-write issuance proof requires exact normalized scope and a recorded token",async()=>{
 const{ledger}=fixture(),scope=input();expect(ledger.canonicalWriteIssued(scope)).toBe(false);expect(ledger.canonicalWriteIssued({...scope,commit:"not-a-commit"})).toBe(false);
 ledger.begin(scope,"canonical",expiry,"write",undefined,now);expect(ledger.canonicalWriteIssued(scope)).toBe(false);
 await ledger.record(scope.id,"canonical",scope.canonicalRepoName,"synthetic-private-token",expiry,undefined,now);expect(ledger.canonicalWriteIssued(scope)).toBe(true);
 const {ownerId,...rest}=scope;const reordered:RetainedInput={...rest,ownerId};expect(ledger.canonicalWriteIssued(reordered)).toBe(true);
 for(const changed of [{...scope,actorId:"other-actor"},{...scope,ownerId:"other-owner"},{...scope,incarnation:crypto.randomUUID()},{...scope,taskId:"other-task"},{...scope,commit:"c".repeat(40)},{...scope,base:"c".repeat(40)},{...scope,workflowId:"other-workflow"},{...scope,candidateId:"other-candidate"},{...scope,accountKey:"b".repeat(12)},{...scope,canonicalRepoName:"other-canonical"},{...scope,workspaceRepoName:"other-workspace"}])expect(ledger.canonicalWriteIssued(changed)).toBe(false);
 await ledger.markRevoked(scope.id,"canonical","synthetic-private-token");expect(ledger.canonicalWriteIssued(scope)).toBe(true);expect(typeof ledger.canonicalWriteIssued(scope)).toBe("boolean");
});
test("expired issuance still proves historical scope but read-only or workspace credentials do not",async()=>{
 const{ledger}=fixture(),scope=input();ledger.begin(scope,"canonical",expiry,"write",undefined,now);await ledger.record(scope.id,"canonical",scope.canonicalRepoName,"synthetic-private-token",expiry,undefined,now);ledger.nextWake(expiry);expect(ledger.summary(scope.id,"canonical")?.status).toBe("expired_unverified");expect(ledger.canonicalWriteIssued(scope)).toBe(true);
 const readonly=input();ledger.begin(readonly,"canonical",expiry,"read",undefined,now);await ledger.record(readonly.id,"canonical",readonly.canonicalRepoName,"synthetic-read-token",expiry,undefined,now);expect(ledger.canonicalWriteIssued(readonly)).toBe(false);
 const workspace=input();ledger.begin(workspace,"workspace",expiry,"write",undefined,now);await ledger.record(workspace.id,"workspace",workspace.workspaceRepoName,"synthetic-workspace-token",expiry,undefined,now);expect(ledger.canonicalWriteIssued(workspace)).toBe(false);
});

test("unborn credentials bind the actual checkpoint and explicit absence of a base pin",async()=>{const{ledger,db}=fixture(),original=input(),scope:RetainedInput={...original,base:null,protectedBaseRef:null,acceptedTarget:{kind:"unborn",projectId:original.projectId,incarnation:original.incarnation,canonicalRepoName:original.canonicalRepoName,ref:"refs/heads/trunk",branch:"trunk",acceptedCommit:null,acceptedVersion:0,requirements:[],policyVersion:1,policy:{}}};try{expect(()=>ledger.begin({...scope,acceptedTarget:undefined},"canonical",expiry,"write",undefined,now)).toThrow("exact recorded target");expect(()=>ledger.begin({...scope,protectedBaseRef:`refs/flaregit/inputs/${scope.incarnation}/task/null`},"canonical",expiry,"write",undefined,now)).toThrow("no base pin");expect(ledger.begin(scope,"canonical",expiry,"write",()=>{},now)).toBe(true);await ledger.record(scope.id,"canonical",scope.canonicalRepoName,"synthetic-root-token",expiry,undefined,now);expect(ledger.summary(scope.id,"canonical")?.status).toBe("pending");await ledger.markRevoked(scope.id,"canonical","synthetic-root-token");expect(ledger.summary(scope.id,"canonical")?.status).toBe("revoked");expect(db.query("SELECT token FROM retained_credential_incidents").get()).toEqual({token:null});expect(ledger.begin(scope,"canonical",expiry,"write",undefined,now)).toBe(false);}finally{db.close();}});
