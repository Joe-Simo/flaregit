import type {Env} from "./env";
import type {PreviewExecutionContext} from "./preview-execution-authority";
import {captureTrustedGitSource,type TrustedGitSource} from "./trusted-git-source";
import {validateRecoveryRemote} from "./private-recovery-bundle";
import {gitAuthEnv,q} from "./shell";
import {READ_GIT_OBJECT} from "./git-object-read-command";

export interface PreviewSourceNativePorts{
 /** Controller records and funds the exact native allocation before returning it. */
 journal(context:PreviewExecutionContext):Promise<{nativeRunId:string;credentialIntentId:string}>;
 authorize(context:PreviewExecutionContext):Promise<void>;
 beforeCredentialIssue(context:PreviewExecutionContext):Promise<void>;
 recordCredential(context:PreviewExecutionContext,value:{repoName:string;token:string;scope:"read";expiresAt:number}):Promise<void>;
 recordNativeStarted(context:PreviewExecutionContext):Promise<void>;
 /** Performs the controller-owned SDK revoke and records its positive result. */
 closeCredential(context:PreviewExecutionContext):Promise<void>;
 confirmNativeStopped(context:PreviewExecutionContext):Promise<void>;
 persistSource(context:PreviewExecutionContext,source:TrustedGitSource):Promise<void>;
}

/** Trusted object capture only. No checkout, hooks, macros or repository scripts. */
export async function capturePreviewSourceNative(env:Env,context:PreviewExecutionContext,ports:PreviewSourceNativePorts):Promise<TrustedGitSource>{
 const frozen=structuredClone(context),authorize=()=>ports.authorize(frozen);
 await authorize();const intent=await ports.journal(frozen);await authorize();
 if(!/^[a-f0-9-]{36}$/.test(intent.nativeRunId)||!intent.credentialIntentId)throw Error("Recorded preview source allocation required");
 const sandbox=env.INTEGRATOR.getByName(`native-${intent.nativeRunId}`);
 let token:string|undefined,repository:Awaited<ReturnType<Env["ARTIFACTS"]["get"]>>|undefined,source:TrustedGitSource|undefined;
 let credentialClosed=false,nativeClosed=false,credentialRecorded=false;
 try{
  await authorize();await ports.recordNativeStarted(frozen);await authorize();
  repository=await env.ARTIFACTS.get(frozen.snapshot.canonicalRepoName);await authorize();
  const info=await repository.info();await authorize();
  if(info.id!==frozen.snapshot.providerRepoId||info.name!==frozen.snapshot.canonicalRepoName)throw Error("Recorded preview provider identity changed");
  const remote=String(info.remote);validateRecoveryRemote(remote);
  await ports.beforeCredentialIssue(frozen);await authorize();
  const issued=await repository.createToken("read",120);token=issued.plaintext;
  const expiresAt=Date.parse(issued.expiresAt);
  if(issued.scope!=="read"||!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+120000)throw Error("Issued preview credential scope or expiry differs");
  await ports.recordCredential(frozen,{repoName:frozen.snapshot.canonicalRepoName,token,scope:issued.scope,expiresAt});credentialRecorded=true;await authorize();
  const fetched=await sandbox.exec(["sh","-c",`git -c core.hooksPath=/dev/null clone --bare --quiet ${q(remote)} /workspace/integration`],{env:gitAuthEnv(token),timeoutMs:120000});
  await authorize();if(!fetched.success)throw Error("Preview source Git fetch unavailable");
  source=await captureTrustedGitSource({scope:frozen.scope,provider:{providerRepoId:frozen.snapshot.providerRepoId,canonicalRepoName:frozen.snapshot.canonicalRepoName},authorize,reader:{readObject:async(kind,hash,maxBytes,signal)=>{
   signal.throwIfAborted();await authorize();
   const script=READ_GIT_OBJECT.replace("await Bun.write(Bun.stdout,bytes);","console.log(Buffer.from(bytes).toString('base64'));");
   const result=await sandbox.exec(["/usr/local/bin/bun","-e",script,kind,hash,String(maxBytes)],{timeoutMs:30000});
   signal.throwIfAborted();await authorize();
   if(!result.success||result.stdout.length>Math.ceil(maxBytes/3)*4+8||! /^[A-Za-z0-9+/]*={0,2}\s*$/.test(result.stdout))throw Error("Preview Git object read unavailable");
   return Uint8Array.from(atob(result.stdout.trim()),char=>char.charCodeAt(0));
  }}});
  await authorize();await ports.persistSource(frozen,source);await authorize();
 }finally{
  if(token&&repository){try{if(credentialRecorded){await ports.closeCredential(frozen);credentialClosed=true;}else{await repository.revokeToken(token);}}catch{/* Durable intent retains unknown credential cleanup. */}}
  try{await sandbox.destroy();if((await sandbox.lifetimeStatus())?.state==="stopped"){await ports.confirmNativeStopped(frozen);nativeClosed=true;}}catch{/* Durable allocation remains held. */}
 }
 if(!source||!credentialClosed||!nativeClosed)throw Error("Preview source capture or cleanup remains unconfirmed");
 await authorize();return source;
}
