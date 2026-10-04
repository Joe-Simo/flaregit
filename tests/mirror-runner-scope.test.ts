import {expect,test} from "bun:test";
import type {Env} from "../src/server/env";
import type {MirrorExecutionRecord} from "../src/server/mirror-execution";
import {runMirrorExecution,type MirrorRunnerAuthority} from "../src/server/mirror-runner";

test("a completed mirror receipt cannot settle a different execution scope",async()=>{
 const scope={id:crypto.randomUUID(),projectId:"owned-project",incarnation:crypto.randomUUID(),accountKey:"owned-account",actorId:"owner",sessionExpiresAt:Date.now()+60000,journalId:"accepted-journal",canonicalRepoName:"owned-repository",acceptedRef:"refs/heads/trunk",commit:"a".repeat(40),tree:"b".repeat(40),target:"https://github.com/owner/repository.git",configDigest:"c".repeat(64),exportApproved:true as const};
 const saved:MirrorExecutionRecord={scope,admission:"granted",nativeAdmission:{nativeRunId:`mirror-${scope.id}`,seconds:1200},phase:"observed",token:null,tokenDigest:"d".repeat(64),nativePossible:true,expiresAt:Date.now()-1000,credentialRevoked:true,nativeStopped:true,result:{status:"ok",detail:"Recorded delivery"}};
 let providerReads=0,authorityReads=0;
 const env=new Proxy({} as Env,{get(){providerReads++;throw Error("No provider access is permitted");}});
 const unexpected=async()=>{authorityReads++;throw Error("No mismatched receipt recovery is permitted");};
 const authority:MirrorRunnerAuthority={authorize:unexpected,admit:unexpected,access:unexpected,assertReadAccess:unexpected,fund:unexpected,recordCredential:unexpected,journal:{get:async()=>saved,beginIssue:unexpected,recordCredential:unexpected,beginNative:unexpected,beginPush:unexpected,observed:unexpected,credentialRevoked:unexpected,nativeStopped:unexpected}};
 await expect(runMirrorExecution(env,{...scope,commit:"e".repeat(40)},authority)).rejects.toThrow("Original mirror execution scope differs");
 expect(providerReads).toBe(0);expect(authorityReads).toBe(0);
});
