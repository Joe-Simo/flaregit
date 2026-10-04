import {expect,test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {parseUnbornAdvertisement} from "../src/server/unborn-source-advertisement";
import {validateUnbornPrivateRefs,type UnbornPrivateRefProof} from "../src/server/unborn-private-refs";
import {TaskSourceInspections,type TaskSourceInspectionScope} from "../src/server/task-source-inspections";
import {Database} from "bun:sqlite";

test("complete native inventory admits only exact recorded private pins while accepted HEAD stays missing",()=>{
 const work=fs.mkdtempSync(path.join(os.tmpdir(),"flaregit-private-inventory-"));try{
  const bare=path.join(work,"canonical.git"),source=path.join(work,"source");const git=(args:string[])=>{const result=spawnSync("git",args,{encoding:"utf8"});if(result.status!==0)throw new Error("Native fixture Git failed");return result.stdout.trim();};
  git(["init","--bare","--quiet","-b","trunk",bare]);git(["init","--quiet",source]);fs.writeFileSync(path.join(source,"README.md"),"Actual preserved contribution\n");git(["-C",source,"add","."]);git(["-C",source,"-c","user.name=Owner","-c","user.email=owner@example.test","commit","--quiet","-m","Contributor root"]);
  const commit=git(["-C",source,"rev-parse","HEAD"]),incarnation=crypto.randomUUID(),scope={projectId:"synthetic-project",incarnation,sourceRepoName:"canonical"},ref=`refs/flaregit/inputs/${incarnation}/first/${commit}`;
  const witness:UnbornPrivateRefProof={kind:"retained-input",ref,commit,receiptId:crypto.randomUUID(),projectId:scope.projectId,incarnation,canonicalRepoName:scope.sourceRepoName};validateUnbornPrivateRefs([witness],scope);
  git(["-C",source,"push","--quiet",bare,`${commit}:${ref}`]);const read=()=>git(["ls-remote","--symref",bare]);
  expect(parseUnbornAdvertisement(read(),"refs/heads/trunk",[witness],true)).toEqual({headSymref:null,privateRefs:[{ref,commit}]});
  expect(git(["--git-dir",bare,"for-each-ref","--format=%(refname)","refs/heads/"])).toBe("");
  expect(()=>parseUnbornAdvertisement(read(),"refs/heads/trunk",[])).toThrow("Git history");expect(()=>parseUnbornAdvertisement(read(),"refs/heads/trunk",[{ref,commit:"b".repeat(40)}])).toThrow();
  expect(()=>validateUnbornPrivateRefs([{...witness,incarnation:crypto.randomUUID()}],scope)).toThrow();
  expect(()=>parseUnbornAdvertisement("","refs/heads/trunk",[witness],true)).toThrow("missing");expect(parseUnbornAdvertisement("","refs/heads/main",[witness],false).privateRefs).toEqual([]);
  git(["-C",source,"push","--quiet",bare,`${commit}:refs/heads/rogue`]);expect(()=>parseUnbornAdvertisement(read(),"refs/heads/trunk",[witness],true)).toThrow("Git history");
  expect(()=>parseUnbornAdvertisement(`${commit}\trefs/heads/trunk\n`,"refs/heads/trunk",[{ref:"refs/heads/trunk",commit}])).toThrow("private preservation");
 }finally{fs.rmSync(work,{recursive:true,force:true});}
});

test("durable logical-unborn proof binds the immutable private preservation snapshot",()=>{
 const db=new Database(":memory:"),storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};
 const ledger=new TaskSourceInspections(storage as unknown as DurableObjectStorage,()=>{}),eventId=crypto.randomUUID(),incarnation=crypto.randomUUID(),commit="a".repeat(40),ref=`refs/flaregit/inputs/${incarnation}/first/${commit}`;
 const witness:UnbornPrivateRefProof={kind:"retained-input",ref,commit,receiptId:crypto.randomUUID(),projectId:"p123456789abc",incarnation,canonicalRepoName:"canonical"};
 const scope:TaskSourceInspectionScope={protocol:2,eventId,purpose:"source",projectId:witness.projectId,incarnation,sourceRepoName:"canonical",repositoryName:"canonical",actorId:"owner",accountKey:"a".repeat(12),allowedPrivateRefs:[witness],acceptedTarget:{kind:"unborn",projectId:witness.projectId,incarnation,canonicalRepoName:"canonical",ref:"refs/heads/trunk",branch:"trunk",acceptedCommit:null,acceptedVersion:0,policyVersion:1,policy:{kind:"git-integrity"},requirements:[]}};
 ledger.prepare(scope);expect(()=>ledger.prepare({...scope,allowedPrivateRefs:[]})).toThrow("scope changed");ledger.bindSource(eventId,"source",{id:"provider-id",name:"canonical",remote:"https://synthetic.artifacts.cloudflare.net/canonical.git",defaultBranch:"trunk",source:null,description:null});ledger.beginCredential(eventId,"source");ledger.recordCredential(eventId,"source","read-id","synthetic-private-token",new Date(Date.now()+900000).toISOString());const nativeName=`unborn-source-${eventId}`;ledger.beginNative(eventId,"source",nativeName);
 const proof={providerRepoId:"provider-id",purpose:"source" as const,repositoryName:"canonical",sourceRepoName:"canonical",defaultRef:"refs/heads/trunk",inspectedDefaultRef:"refs/heads/trunk",headSymref:null,expectedHead:null,visibleRefs:[{ref,commit}],nativeName};
 expect(()=>ledger.pending(eventId,"source",{...proof,visibleRefs:[]})).toThrow();expect(()=>ledger.pending(eventId,"source",{...proof,visibleRefs:[{ref,commit:"b".repeat(40)}]})).toThrow();ledger.pending(eventId,"source",proof);ledger.confirmRevoked(eventId,"source","read-id");ledger.confirmStopped(eventId,"source",{name:nativeName,state:"stopped",sealed:true});ledger.observe(eventId,"source",proof);expect(ledger.receipt(eventId,"source")?.expectedHead).toBeNull();expect(ledger.receipt(eventId,"source")?.visibleRefs).toEqual([{ref,commit}]);
});
