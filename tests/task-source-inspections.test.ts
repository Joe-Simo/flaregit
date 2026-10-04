import { Database } from "bun:sqlite";
import { expect,test } from "bun:test";
import { TaskSourceInspections,type TaskSourceInspectionScope } from "../src/server/task-source-inspections";
import { assertEmptyNativeAdvertisement } from "../src/server/unborn-source-proof";

test("empty-source receipts require exact immutable scope and read/native cleanup before fork use",()=>{
 const db=new Database(":memory:");
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};
 let authorized=true;
 const ledger=new TaskSourceInspections(storage as unknown as DurableObjectStorage,()=>{if(!authorized)throw new Error("Authority changed");});
 const eventId=crypto.randomUUID(),incarnation=crypto.randomUUID(),scope:TaskSourceInspectionScope={eventId,purpose:"source",projectId:"p123456789abc",incarnation,sourceRepoName:"canonical",repositoryName:"canonical",actorId:"owner",accountKey:"a".repeat(12),acceptedTarget:{kind:"unborn",projectId:"p123456789abc",incarnation,canonicalRepoName:"canonical",ref:"refs/heads/main",branch:"main",acceptedCommit:null,acceptedVersion:0,policyVersion:1,policy:{kind:"git-integrity"},requirements:[]}};
 ledger.prepare(scope);ledger.prepare(scope);expect(()=>ledger.prepare({...scope,actorId:"outsider"})).toThrow("scope changed");
 ledger.bindSource(eventId,"source",{id:"actual-provider-id",name:"canonical",remote:"https://synthetic.artifacts.cloudflare.net/canonical.git",defaultBranch:"main",source:null,description:null});
 expect(ledger.beginCredential(eventId,"source")).toBe(true);expect(ledger.beginCredential(eventId,"source")).toBe(false);
 ledger.recordCredential(eventId,"source","read-id","synthetic-server-only",new Date(Date.now()+900000).toISOString());
 const nativeName=`unborn-source-${eventId}`;expect(ledger.beginNative(eventId,"source",nativeName)).toBe(true);expect(ledger.beginNative(eventId,"source",nativeName)).toBe(false);
 const proof={providerRepoId:"actual-provider-id",purpose:"source" as const,repositoryName:"canonical",sourceRepoName:"canonical",defaultRef:"refs/heads/main",expectedHead:null,visibleRefs:[] as [],headSymref:null,nativeName};
 ledger.pending(eventId,"source",proof);expect(()=>ledger.observe(eventId,"source",proof)).toThrow("Completed");expect(ledger.receipt(eventId,"source")).toBeNull();
 expect(()=>ledger.confirmStopped(eventId,"source",{name:nativeName,state:"stopped",sealed:false})).toThrow("Sealed");
 ledger.confirmStopped(eventId,"source",{name:nativeName,state:"stopped",sealed:true});ledger.confirmRevoked(eventId,"source","read-id");
 ledger.pending(eventId,"source",proof);ledger.observe(eventId,"source",proof);expect(ledger.receipt(eventId,"source")).toEqual(proof);expect(ledger.credential(eventId,"source")?.plaintext).toBe("");
 expect(()=>ledger.observe(eventId,"source",{...proof,providerRepoId:"replacement"})).toThrow();
 const workspaceScope={...scope,purpose:"workspace" as const,repositoryName:"workspace",expectedParentProviderRepoId:"actual-provider-id",expectedProviderRepoId:"workspace-id",expectedForkSource:"artifacts:namespace/canonical",expectedMarker:"frozen-marker"};ledger.prepare(workspaceScope);
 expect(()=>ledger.bindSource(eventId,"workspace",{id:"workspace-id",name:"workspace",remote:"https://synthetic.artifacts.cloudflare.net/workspace.git",defaultBranch:"main",source:"wrong-parent",description:"frozen-marker"})).toThrow("identity");
 authorized=false;expect(()=>ledger.receipt(eventId,"source")).toThrow("Authority");
});

test("complete advertisement distinguishes missing HEAD from a matched unborn symbolic HEAD",()=>{
 const result=(advertisement:string)=>({success:true,stdout:JSON.stringify({version:1,advertisement})});
 expect(assertEmptyNativeAdvertisement(result(""),"refs/heads/main")).toEqual({headSymref:null});
 expect(assertEmptyNativeAdvertisement(result("ref: refs/heads/main\tHEAD\n"),"refs/heads/main")).toEqual({headSymref:"refs/heads/main"});
 for(const value of [{success:true,stdout:""},{success:false,stdout:JSON.stringify({version:1,advertisement:""})},result("a".repeat(40)+"\trefs/heads/main\n"),result("ref: refs/heads/other\tHEAD\n")])expect(()=>assertEmptyNativeAdvertisement(value,"refs/heads/main")).toThrow();
});
