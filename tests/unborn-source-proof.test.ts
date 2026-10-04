import {expect,test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {assertEmptyNativeAdvertisement,unbornSourceAdvertisementCommand,proveUnbornSource,recoverUnbornSource,type UnbornSourceInput,type UnbornSourceJournal} from "../src/server/unborn-source-proof";
import {TaskSourceInspections,taskSourceInspectionScopeSchema} from "../src/server/task-source-inspections";
import {Database} from "bun:sqlite";
import {q} from "../src/server/shell";
import type {Env} from "../src/server/env";

test("actual native inventory succeeds only for an empty repository and detects a tag or branch",()=>{
 const work=fs.mkdtempSync(path.join(os.tmpdir(),"flaregit-source-native-"));
 try{
  const bare=path.join(work,"canonical.git"),source=path.join(work,"source"),remote="https://"+"a".repeat(32)+".artifacts.cloudflare.net/git/default/canonical.git";
  spawnSync("git",["init","--bare","--quiet","-b","main",bare]);
  const command=unbornSourceAdvertisementCommand(remote).replaceAll(q(remote),q(bare)).replaceAll("/workspace/unborn-source-proof",path.join(work,"inspection"));
  const run=()=>{const result=spawnSync("sh",["-c",command],{encoding:"utf8"});return{success:result.status===0,stdout:result.stdout};};
  expect(assertEmptyNativeAdvertisement(run(),"refs/heads/main")).toEqual({headSymref:null});
  spawnSync("git",["init","--quiet",source]);fs.writeFileSync(path.join(source,"README.md"),"Actual Git content\n");spawnSync("git",["-C",source,"add","."]);spawnSync("git",["-C",source,"-c","user.name=Owner","-c","user.email=owner@example.test","commit","--quiet","-m","Root"]);spawnSync("git",["-C",source,"push","--quiet",bare,"HEAD:refs/tags/retained"]);
  expect(()=>assertEmptyNativeAdvertisement(run(),"refs/heads/main")).toThrow("objects");
 }finally{fs.rmSync(work,{recursive:true,force:true});}
});

test("interruption after inventory recovers the saved observation without another credential or Git dispatch",async()=>{
 const db=new Database(":memory:"),storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};
 const ledger=new TaskSourceInspections(storage as unknown as DurableObjectStorage,()=>{}),eventId=crypto.randomUUID(),incarnation=crypto.randomUUID();
 const target={kind:"unborn" as const,projectId:"p123456789abc",incarnation,canonicalRepoName:"canonical",ref:"refs/heads/main",branch:"main",acceptedCommit:null,acceptedVersion:0 as const,policyVersion:1,policy:{kind:"git-integrity"},requirements:[] as []};
 const input:UnbornSourceInput={eventId,purpose:"source",repositoryName:"canonical",projectId:target.projectId,incarnation,sourceRepoName:"canonical",userId:"owner",acceptedTarget:target};
 const {userId:_user,...sourceScope}=input;ledger.prepare(taskSourceInspectionScopeSchema.parse({...sourceScope,actorId:"owner",accountKey:"a".repeat(12)}));
 const metadata={id:"provider-id",name:"canonical",remote:"https://"+"a".repeat(32)+".artifacts.cloudflare.net/git/default/canonical.git",defaultBranch:"main",source:null,description:null};
 ledger.bindSource(eventId,"source",metadata);ledger.beginCredential(eventId,"source");ledger.recordCredential(eventId,"source","read-id","synthetic-private-token",new Date(Date.now()+900000).toISOString());
 const nativeName=`unborn-source-${eventId}`;ledger.beginNative(eventId,"source",nativeName);
 const proof={providerRepoId:metadata.id,purpose:"source" as const,repositoryName:"canonical",sourceRepoName:"canonical",defaultRef:target.ref,expectedHead:null,visibleRefs:[] as [],headSymref:null,nativeName};ledger.pending(eventId,"source",proof);
 expect(ledger.receipt(eventId,"source")).toBeNull();
 let issuances=0,commands=0;
 const repository={info:async()=>metadata,createToken:async()=>{issuances++;throw new Error("No repeated issuance");},revokeToken:async(id:string)=>{expect(id).toBe("read-id");return true;},[Symbol.dispose]:()=>{}};
 const native={exec:async()=>{commands++;throw new Error("No repeated inventory");},seal:async()=>{},destroy:async()=>{},lifetimeStatus:async()=>({state:"stopped",sealed:true})};
 const env={ARTIFACTS:{get:async()=>repository},INTEGRATOR:{getByName:(name:string)=>{expect(name).toBe(nativeName);return native;}}} as unknown as Env;
 const journal:UnbornSourceJournal={beforeProvider:async()=>{},authorize:async()=>{},bindSource:async()=>{},beforeCredential:async()=>{throw new Error("No repeated issuance");},credentialIssued:async()=>{},nativeIntent:async()=>{},credentialRevoked:async(id)=>ledger.confirmRevoked(eventId,"source",id),nativeStopped:async(name)=>ledger.confirmStopped(eventId,"source",{name,state:"stopped",sealed:true}),pendingObservation:async(value)=>ledger.pending(eventId,"source",value),observed:async(value)=>ledger.observe(eventId,"source",value)};
 expect(await recoverUnbornSource(env,input,journal,ledger.recovery(eventId,"source")!)).toEqual(proof);
 expect(await recoverUnbornSource(env,input,journal,ledger.recovery(eventId,"source")!)).toEqual(proof);
 expect(issuances).toBe(0);expect(commands).toBe(0);expect(ledger.receipt(eventId,"source")).toEqual(proof);
});

test("source proof never becomes usable until its read credential and sealed native workspace close",async()=>{
 for(const mode of ["closed","unsealed","unrevoked","bad-expiry","issue-quota"]){
  const events:string[]=[],eventId=crypto.randomUUID(),incarnation=crypto.randomUUID();
  const input:UnbornSourceInput={eventId,purpose:"source",repositoryName:"canonical",projectId:"p123456789abc",incarnation,sourceRepoName:"canonical",userId:"owner",acceptedTarget:{kind:"unborn",projectId:"p123456789abc",incarnation,canonicalRepoName:"canonical",ref:"refs/heads/main",branch:"main",acceptedCommit:null,acceptedVersion:0,requirements:[],policyVersion:1,policy:{kind:"git-integrity"}}};
  const metadata={id:"provider-id",name:"canonical",remote:"https://"+"a".repeat(32)+".artifacts.cloudflare.net/git/default/canonical.git",defaultBranch:"main",source:null,description:null};
  const repository={info:async()=>metadata,createToken:async(scope:string)=>{expect(scope).toBe("read");events.push("issued");return{id:"read-id",plaintext:"synthetic-server-secret",scope:"read",expiresAt:mode==="bad-expiry"?"invalid":new Date(Date.now()+900000).toISOString()};},revokeToken:async()=>{events.push("revoke");return mode!=="unrevoked";},[Symbol.dispose]:()=>{}};
  const native={exec:async(argv:string[])=>{expect(JSON.stringify(argv)).not.toContain("synthetic-server-secret");events.push("exec");return{success:true,stdout:JSON.stringify({version:1,advertisement:""})};},seal:async()=>{events.push("seal");},destroy:async()=>{events.push("destroy");},lifetimeStatus:async()=>({state:"stopped",sealed:mode!=="unsealed"})};
  const accountGlobal={accountLifecycle:async()=>"active",reserveManagedSpend:async()=>({allowed:true}),consumeManagedSpend:async()=>{}};
  const env={ARTIFACTS:{get:async()=>repository},REPOSITORY_CONTROLLER:{idFromName:()=>"synthetic",get:()=>accountGlobal},INTEGRATOR:{getByName:()=>native}} as unknown as Env;
  const journal:UnbornSourceJournal={beforeProvider:async(operation)=>{if(mode==="issue-quota"&&operation==="createToken")throw new Error("Read credential quota denied");},authorize:async()=>{},bindSource:async()=>{events.push("identity");},beforeCredential:async()=>{events.push("credential-intent");},credentialIssued:async()=>{events.push("credential-recorded");},nativeIntent:async()=>{events.push("native-intent");},credentialRevoked:async()=>{events.push("revoked-receipt");},nativeStopped:async()=>{events.push("stopped-receipt");},pendingObservation:async()=>{events.push("pending-observation");},observed:async()=>{events.push("usable");}};
  if(mode==="closed")expect((await proveUnbornSource(env,input,journal)).expectedHead).toBeNull();else await expect(proveUnbornSource(env,input,journal)).rejects.toThrow();
  if(mode!=="issue-quota")expect(events.indexOf("credential-recorded")).toBeGreaterThan(events.indexOf("issued"));
  else{expect(events).not.toContain("issued");expect(events).not.toContain("exec");}
  expect(events.includes("usable")).toBe(mode==="closed");
  if(mode==="closed"){expect(events.indexOf("usable")).toBeGreaterThan(events.indexOf("stopped-receipt"));expect(events.indexOf("seal")).toBeLessThan(events.indexOf("destroy"));}
  if(mode==="bad-expiry"){expect(events).toContain("credential-recorded");expect(events).not.toContain("exec");}
 }
});
