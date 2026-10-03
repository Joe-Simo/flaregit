import {Database} from "bun:sqlite";
import {expect,test} from "bun:test";
import {SavedRebaseResumeCredentials} from "../src/server/saved-rebase-resume-credentials";
import type {SavedRebaseResumeCredentialIntent} from "../src/server/saved-rebase-resume-credentials";
const now=1000,expiry=2000;
function input():SavedRebaseResumeCredentialIntent{return{attemptId:crypto.randomUUID(),applicationId:crypto.randomUUID(),projectId:"p123456789abc",incarnation:crypto.randomUUID(),canonicalRepoName:"flaregit-p123456789abc",workspaceRepoName:"flaregit-p123456789abc-task",actorId:"current-owner",accountKey:"a".repeat(12)};}
function fixture(){const db=new Database(":memory:");const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};return{db,ledger:new SavedRebaseResumeCredentials(storage as unknown as DurableObjectStorage)};}
test("issuance requires an immutable current authorized pin before any token receipt",async()=>{
 const{ledger,db}=fixture(),scope=input();let validations=0;
 expect(()=>ledger.begin(scope,"canonical",expiry,()=>{validations++;throw Error("Owner revoked");},now)).toThrow("Owner revoked");
 expect(validations).toBe(1);expect(db.query("SELECT COUNT(*) AS n FROM saved_rebase_resume_credentials").get()).toEqual({n:0});
 await expect(ledger.record(scope.attemptId,"canonical",scope.canonicalRepoName,"synthetic-private-token",expiry,now)).rejects.toThrow("exact issuance intent");
 expect(ledger.begin(scope,"canonical",expiry,()=>{validations++;},now)).toBe(true);expect(ledger.begin(scope,"canonical",expiry,undefined,now)).toBe(false);
 expect(ledger.summary(scope.attemptId,"canonical")).toEqual({status:"issuance_unknown",expiresAt:null,fingerprint:null});
 expect(()=>ledger.begin({...scope,actorId:"another-owner"},"canonical",expiry,undefined,now)).toThrow("intent changed");
 expect(()=>ledger.begin(scope,"canonical",expiry+1,undefined,now)).toThrow("intent changed");
});
test("cleanup receipt survives owner withdrawal but rejects any other repo or issuance identity",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"workspace",expiry,undefined,now);
 await expect(ledger.record(scope.attemptId,"workspace",scope.canonicalRepoName,"synthetic-private-token",expiry,now)).rejects.toThrow("exact issuance intent");
 await expect(ledger.record(scope.attemptId,"canonical",scope.canonicalRepoName,"synthetic-private-token",expiry,now)).rejects.toThrow("exact issuance intent");
 // There is intentionally no fresh-owner callback for recording an already-issued cleanup capability.
 await ledger.record(scope.attemptId,"workspace",scope.workspaceRepoName,"synthetic-private-token",expiry,now);
 expect(ledger.pendingBatch(now)[0]).toMatchObject({attemptId:scope.attemptId,purpose:"workspace",accountKey:scope.accountKey,repoName:scope.workspaceRepoName,token:"synthetic-private-token"});
 const summary=ledger.summary(scope.attemptId,"workspace");expect(summary?.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(summary)).not.toContain("synthetic-private-token");expect(JSON.stringify(summary)).not.toContain(scope.accountKey);
 await expect(ledger.record(scope.attemptId,"workspace",scope.workspaceRepoName,"another-private-token",expiry,now)).rejects.toThrow("receipt changed");
 await expect(ledger.record(scope.attemptId,"workspace",scope.workspaceRepoName,"synthetic-private-token",expiry+1,now)).rejects.toThrow("receipt changed");
 await expect(ledger.markRevoked(scope.attemptId,"workspace","wrong-token")).rejects.toThrow("mismatch");
 await ledger.markRevoked(scope.attemptId,"workspace","synthetic-private-token");expect(ledger.summary(scope.attemptId,"workspace")?.status).toBe("revoked");expect(db.query("SELECT token FROM saved_rebase_resume_credentials").get()).toEqual({token:null});
 await ledger.record(scope.attemptId,"workspace",scope.workspaceRepoName,"synthetic-private-token",expiry,now);expect(ledger.summary(scope.attemptId,"workspace")?.status).toBe("revoked");expect(ledger.pendingBatch(now)).toHaveLength(0);expect(ledger.begin(scope,"workspace",expiry,undefined,now)).toBe(false);
});
test("bounded retries retain uncertainty and provider expiry erases secrets without claiming revocation",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"canonical",expiry,undefined,now);await ledger.record(scope.attemptId,"canonical",scope.canonicalRepoName,"synthetic-private-token",expiry,now);
 for(let index=0;index<4;index++)expect(ledger.markAttempt(scope.attemptId,"canonical")).toBe(true);expect(ledger.markAttempt(scope.attemptId,"canonical")).toBe(false);expect(ledger.pendingBatch(now)).toHaveLength(0);expect(ledger.hasPending(now)).toBe(true);
 ledger.pendingBatch(expiry);expect(ledger.summary(scope.attemptId,"canonical")?.status).toBe("expired_unverified");expect(ledger.hasPending(expiry)).toBe(false);expect(db.query("SELECT token FROM saved_rebase_resume_credentials").get()).toEqual({token:null});await expect(ledger.markRevoked(scope.attemptId,"canonical","synthetic-private-token")).rejects.toThrow("unverified");
});
test("lost creation responses and malformed actual expiry never fabricate clean credentials",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"canonical",expiry,undefined,now);ledger.pendingBatch(expiry+1);expect(ledger.summary(scope.attemptId,"canonical")?.status).toBe("issuance_unknown");
 await ledger.record(scope.attemptId,"canonical",scope.canonicalRepoName,"synthetic-private-token",NaN,now);ledger.pendingBatch(Number.MAX_SAFE_INTEGER);expect(ledger.summary(scope.attemptId,"canonical")).toMatchObject({status:"pending",expiresAt:null});expect(db.query("SELECT token FROM saved_rebase_resume_credentials").get()).toEqual({token:"synthetic-private-token"});
 await ledger.markRevoked(scope.attemptId,"canonical","synthetic-private-token");expect(ledger.summary(scope.attemptId,"canonical")?.status).toBe("revoked");
});
test("oversized and malformed intents reject before storage, and alarm batches have a separate cap",async()=>{
 const{ledger,db}=fixture();expect(()=>ledger.begin(input(),"canonical",now+900001,undefined,now)).toThrow("Invalid");const wrong=input();expect(()=>ledger.begin({...wrong,workspaceRepoName:wrong.canonicalRepoName},"canonical",expiry,undefined,now)).toThrow("isolated");
 for(let index=0;index<21;index++){const scope=input();ledger.begin(scope,"workspace",expiry,undefined,now);await ledger.record(scope.attemptId,"workspace",scope.workspaceRepoName,"synthetic-private-token",expiry,now);}expect(ledger.pendingBatch(now)).toHaveLength(20);expect(db.query("SELECT COUNT(*) AS n FROM saved_rebase_resume_credentials").get()).toEqual({n:21});
});

test("retention capacity denies new issuance before creation while exact old replay remains closed",()=>{
 const{ledger,db}=fixture();let first:SavedRebaseResumeCredentialIntent|null=null;
 for(let index=0;index<1000;index++){const scope=input();first??=scope;ledger.begin(scope,"canonical",expiry,undefined,now);}
 expect(()=>ledger.begin(input(),"canonical",expiry,undefined,now)).toThrow("limit reached");
 expect(ledger.begin(first!,"canonical",expiry,undefined,now)).toBe(false);
 expect(db.query("SELECT COUNT(*) AS n FROM saved_rebase_resume_credentials").get()).toEqual({n:1000});
});

test("unknown expiry exhausts automatic work without clearing an uncertain secret or looping alarms",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"canonical",expiry,undefined,now);await ledger.record(scope.attemptId,"canonical",scope.canonicalRepoName,"synthetic-private-token",NaN,now);
 expect(ledger.nextWake(now)).toBe(now+120000);
 for(let index=0;index<4;index++){expect(ledger.markAutomaticSweep(scope.attemptId,"canonical")).toBe(true);expect(ledger.markAttempt(scope.attemptId,"canonical")).toBe(true);}
 expect(ledger.markAutomaticSweep(scope.attemptId,"canonical")).toBe(false);expect(ledger.pendingBatch(now)).toHaveLength(0);expect(ledger.nextWake(now)).toBeNull();expect(ledger.nextWake(now+10_000_000)).toBeNull();expect(ledger.hasPending()).toBe(true);expect(ledger.summary(scope.attemptId,"canonical")).toMatchObject({status:"pending",expiresAt:null});expect(db.query("SELECT token,attempts,automatic_sweeps FROM saved_rebase_resume_credentials").get()).toEqual({token:"synthetic-private-token",attempts:4,automatic_sweeps:4});expect(ledger.credentialForRevocation(scope.attemptId,"canonical",now)).toBeNull();
});
test("exhausted known expiry schedules only its final erasure wake without claiming verified revocation",async()=>{
 const{ledger,db}=fixture(),scope=input(),expires=now+500000;ledger.begin(scope,"canonical",expires,undefined,now);await ledger.record(scope.attemptId,"canonical",scope.canonicalRepoName,"synthetic-private-token",expires,now);
 expect(ledger.nextWake(now)).toBe(now+120000);for(let index=0;index<4;index++){ledger.markAutomaticSweep(scope.attemptId,"canonical");ledger.markAttempt(scope.attemptId,"canonical");}
 expect(ledger.nextWake(now)).toBe(expires);expect(ledger.nextWake(now+300000)).toBe(expires);expect(ledger.nextWake(expires)).toBeNull();expect(ledger.summary(scope.attemptId,"canonical")?.status).toBe("expired_unverified");expect(db.query("SELECT token FROM saved_rebase_resume_credentials").get()).toEqual({token:null});
});
test("funding denial consumes automatic opportunities without fake provider attempts and permits remaining explicit cleanup",async()=>{
 const{ledger,db}=fixture(),scope=input();ledger.begin(scope,"workspace",expiry,undefined,now);await ledger.record(scope.attemptId,"workspace",scope.workspaceRepoName,"synthetic-private-token",NaN,now);
 // Four automatic funding denials: no provider was called and markAttempt was never invoked.
 for(let index=0;index<4;index++)ledger.markAutomaticSweep(scope.attemptId,"workspace");
 expect(ledger.nextWake(now)).toBeNull();expect(ledger.pendingBatch(now)).toHaveLength(0);expect(db.query("SELECT attempts,automatic_sweeps FROM saved_rebase_resume_credentials").get()).toEqual({attempts:0,automatic_sweeps:4});
 expect(ledger.credentialForRevocation(scope.attemptId,"workspace",now)?.token).toBe("synthetic-private-token");expect(ledger.markAttempt(scope.attemptId,"workspace")).toBe(true);await ledger.markRevoked(scope.attemptId,"workspace","synthetic-private-token");expect(ledger.summary(scope.attemptId,"workspace")?.status).toBe("revoked");expect(db.query("SELECT attempts,automatic_sweeps,token FROM saved_rebase_resume_credentials").get()).toEqual({attempts:1,automatic_sweeps:4,token:null});
});

test("resume owner intent grants only canonical read and isolated workspace write; returned secret is journaled synchronously",async()=>{
 const {ledger,db}=fixture(),scope=input();
 ledger.begin(scope,"canonical",expiry,undefined,now);ledger.begin(scope,"workspace",expiry,undefined,now);
 expect(db.query("SELECT purpose,scope FROM saved_rebase_resume_credentials ORDER BY purpose").all()).toEqual([{purpose:"canonical",scope:"read"},{purpose:"workspace",scope:"write"}]);
 const recording=ledger.record(scope.attemptId,"workspace",scope.workspaceRepoName,"synthetic-private-token",now+900001,now);
 // Scope/expiry validation can fail immediately after issuance without losing the secret needed for revocation.
 expect(db.query("SELECT token,status FROM saved_rebase_resume_credentials WHERE purpose='workspace'").get()).toEqual({token:"synthetic-private-token",status:"pending"});
 await recording;await ledger.markRevoked(scope.attemptId,"workspace","synthetic-private-token");
 expect(ledger.summary(scope.attemptId,"workspace")?.status).toBe("revoked");
});

test("unknown issuance prevents destructive cleanup after its requested lifetime without fabricating expiry",()=>{
 const {ledger,db}=fixture(),scope=input();ledger.begin(scope,"canonical",expiry,undefined,now);
 expect(ledger.hasPending()).toBe(true);ledger.pendingBatch(expiry+900000);
 expect(ledger.nextWake(expiry+900000)).toBeNull();expect(ledger.hasPending()).toBe(true);
 expect(ledger.summary(scope.attemptId,"canonical")?.status).toBe("issuance_unknown");
 expect(db.query("SELECT token,status FROM saved_rebase_resume_credentials").get()).toEqual({token:null,status:"issuance_unknown"});
});

test("actual elapsed provider expiry releases deletion on the same incident while preserving its audit",async()=>{
 const {ledger,db}=fixture(),scope=input();ledger.begin(scope,"workspace",expiry,undefined,now);
 const actualExpiry=expiry+5000;
 await ledger.record(scope.attemptId,"workspace",scope.workspaceRepoName,"synthetic-private-token",actualExpiry,now);
 const summary=ledger.summary(scope.attemptId,"workspace");if(!summary)throw Error("Missing issued credential receipt");
 expect(ledger.hasPending(expiry)).toBe(true);expect(ledger.hasPending(actualExpiry-1)).toBe(true);
 expect(ledger.hasPending(actualExpiry)).toBe(false);
 expect(ledger.summary(scope.attemptId,"workspace")).toEqual({...summary,status:"expired_unverified"});
 expect(db.query("SELECT token FROM saved_rebase_resume_credentials").get()).toEqual({token:null});
 expect(ledger.credentialForRevocation(scope.attemptId,"workspace",actualExpiry)).toBeNull();
 expect(ledger.pendingBatch(actualExpiry)).toEqual([]);expect(ledger.nextWake(actualExpiry)).toBeNull();
 await expect(ledger.markRevoked(scope.attemptId,"workspace","synthetic-private-token")).rejects.toThrow("unverified");
 expect(ledger.hasPending(actualExpiry+1)).toBe(false);
});
test("unknown actual expiry and lost issuance remain deletion fences beyond requested TTL",async()=>{
 const {ledger}=fixture(),scope=input();ledger.begin(scope,"canonical",expiry,undefined,now);
 expect(ledger.hasPending(expiry+10_000_000)).toBe(true);
 await ledger.record(scope.attemptId,"canonical",scope.canonicalRepoName,"synthetic-private-token",NaN,now);
 expect(ledger.hasPending(expiry+10_000_000)).toBe(true);
 expect(ledger.summary(scope.attemptId,"canonical")).toMatchObject({status:"pending",expiresAt:null});
});
