import {expect,test} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {capturePreviewSourceNative,type PreviewSourceNativePorts} from "../src/server/preview-source-native";
import type {PreviewExecutionContext} from "../src/server/preview-execution-authority";
import type {Env} from "../src/server/env";

// Real Git objects; SDK/native lifecycle ports below are explicitly synthetic.
async function fixture(revoked=true){
 const dir=await mkdtemp(join(tmpdir(),"preview-source-native-"));
 const git=(...args:string[])=>{const result=Bun.spawnSync(["git","-C",dir,...args]);if(result.exitCode)throw Error("Local Git failed");return result.stdout;};
 git("init","-q");await Bun.write(join(dir,"index.html"),"<main>raw source</main>");git("add",".");git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-qm","source");
 const commit=git("rev-parse","HEAD").toString().trim(),tree=git("rev-parse","HEAD^{tree}").toString().trim();
 const context:PreviewExecutionContext={snapshot:{kind:"preview-execution",projectId:"p123456789abc",incarnation:crypto.randomUUID(),commit,tree,policyDigest:"a".repeat(64),actorId:"owner",accountKey:"b".repeat(12),canonicalRepoName:"canonical",providerRepoId:"provider",target:{kind:"accepted",receiptId:"receipt",ref:"refs/heads/main",version:1},generation:null,image:`registry.cloudflare.com/${"c".repeat(32)}/execution@sha256:${"d".repeat(64)}`},scope:{attemptId:crypto.randomUUID(),projectId:"p123456789abc",incarnation:"",commit,tree,policyDigest:"a".repeat(64)},sourceDigest:null};context.scope.incarnation=context.snapshot.incarnation;
 const events:string[]=[];let active=true,issued=0,providerId="provider";
 const ports:PreviewSourceNativePorts={journal:async()=>{events.push("intent");return{nativeRunId:crypto.randomUUID(),credentialIntentId:"credential"};},authorize:async()=>{if(!active)throw Error("Owner withdrawn");},beforeCredentialIssue:async()=>{events.push("possible");},recordCredential:async()=>{events.push("credential");},recordNativeStarted:async()=>{events.push("native");},closeCredential:async()=>{if(!revoked)throw Error("Revocation unknown");events.push("revoked");},confirmNativeStopped:async()=>{events.push("stopped");},persistSource:async()=>{events.push("saved");}};
 const env={ARTIFACTS:{get:async()=>({info:async()=>({id:providerId,name:"canonical",remote:"https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.artifacts.cloudflare.net/repository"}),createToken:async()=>{issued++;return{plaintext:"synthetic-local-read-token",scope:"read",expiresAt:new Date(Date.now()+119000).toISOString()};},revokeToken:async()=>revoked})},INTEGRATOR:{getByName:()=>({exec:async(argv:string[])=>{if(argv[0]==="sh"){expect(argv[2]).toContain("clone --bare");expect(argv[2]).not.toContain("checkout");return{success:true,stdout:"",stderr:"",exitCode:0};}const bytes=git("--no-replace-objects","cat-file",argv[3]!,argv[4]!);return{success:true,stdout:Buffer.from(bytes).toString("base64"),stderr:"",exitCode:0};},destroy:async()=>{events.push("destroy");},lifetimeStatus:async()=>({state:"stopped"})})}} as unknown as Env;
 return{env,context,ports,events,issued:()=>issued,changeProvider:()=>{providerId="different-provider";},withdraw:()=>{active=false;},close:()=>rm(dir,{recursive:true,force:true})};
}
test("native preview source captures real Git bytes and releases only after both cleanup receipts",async()=>{
 const f=await fixture();try{const source=await capturePreviewSourceNative(f.env,f.context,f.ports);expect(source.proof.commit).toBe(f.context.scope.commit);expect(new TextDecoder().decode(source.files[0]!.bytes)).toBe("<main>raw source</main>");expect(f.events).toEqual(["intent","native","possible","credential","saved","revoked","destroy","stopped"]);}finally{await f.close();}
});
test("unknown revocation refuses output while retaining source and stopping native workspace",async()=>{
 const f=await fixture(false);try{await expect(capturePreviewSourceNative(f.env,f.context,f.ports)).rejects.toThrow("cleanup remains unconfirmed");expect(f.events).toContain("saved");expect(f.events).toContain("stopped");expect(f.events).not.toContain("revoked");}finally{await f.close();}
});
test("withdrawn authority before credential issuance does not mint a token",async()=>{
 const f=await fixture();try{f.ports.beforeCredentialIssue=async()=>{f.withdraw();};await expect(capturePreviewSourceNative(f.env,f.context,f.ports)).rejects.toThrow("Owner withdrawn");expect(f.issued()).toBe(0);expect(f.events).toContain("stopped");}finally{await f.close();}
});

test("provider replacement refuses before issuing a private read credential",async()=>{
 const f=await fixture();try{f.changeProvider();await expect(capturePreviewSourceNative(f.env,f.context,f.ports)).rejects.toThrow("provider identity changed");expect(f.issued()).toBe(0);expect(f.events).toContain("stopped");}finally{await f.close();}
});
