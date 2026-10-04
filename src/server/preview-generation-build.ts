import type {Env} from "./env.js";
import {projectOf,globalOf} from "./projects.js";
import {claimNativeCompute,admitNativeCompute} from "./native-compute.js";
import {generationBuildPrefix} from "./preview-access.js";
import {inspectPreviewStorageManifest,publishPreviewStorageManifest} from "./preview-storage-upload.js";
import {assertPreviewStorageAdmission} from "./preview-storage.js";
import {validateRecoveryRemote} from "./private-recovery-bundle.js";
import {gitAuthEnv,q} from "./shell.js";

/** Replacement storage is separately funded; uncertain older requests retain their holds. */
export async function buildPreviewGeneration(env:Env,projectId:string,generation:string):Promise<void>{
 const repository=projectOf(env,projectId),global=globalOf(env),operation=`build-generation-${generation}`;
 let claimed=false,lease:string|null=null;
 let sandbox:ReturnType<Env["INTEGRATOR"]["getByName"]>|undefined;
 let repo:Awaited<ReturnType<Env["ARTIFACTS"]["get"]>>|undefined,token:string|undefined,repoName:string|undefined,expiresAt:number|undefined;
 const activity=async(type:string,message:string)=>{await repository.logActivity("FlareGit",type,message).catch(()=>console.error("Preview recovery activity could not be saved"));};
 const fail=async(reason:string)=>{if(claimed)await repository.previewGenerationFail(generation,reason).catch(()=>undefined);};
 try{
  claimed=await repository.previewGenerationClaim(generation);if(!claimed)return;
  const scope=await repository.previewGenerationScope(generation),commit=scope.commit;
  const authorize=async()=>{const current=await repository.previewGenerationScope(generation);if(JSON.stringify(current)!==JSON.stringify(scope))throw new Error("Preview generation authorization changed");};
  lease=await claimNativeCompute(env,operation);
  if(!lease){await fail("compute_start_unconfirmed");await activity("preview.generation_start_unconfirmed","Replacement preview compute could not be confirmed; saved reservations remain intact");return;}
  try{await admitNativeCompute(env,scope.accountKey,`native-${lease}`,"native-optional");}catch{await global.finishNativeCompute(operation,lease);lease=null;await fail("compute_unavailable");return;}
  await authorize();const workspace=env.INTEGRATOR.getByName(`native-${lease}`);sandbox=workspace;
  const run=async(command:string,environment?:Record<string,string>)=>{await authorize();return workspace.exec(["sh","-c",command],{env:environment});};
  const state=await repository.getState();await authorize();repoName=state.canonicalRepoName;
  repo=await env.ARTIFACTS.get(repoName);await authorize();
  const remote=String((await repo.info()).remote);validateRecoveryRemote(remote);await authorize();
  token=(await repo.createToken("read",900)).plaintext;expiresAt=Date.now()+900_000;await authorize();
  const dir="/workspace/generation";
  const checkout=await run(`git clone --quiet ${q(remote)} ${dir} && git -C ${dir} checkout --quiet --detach ${q(commit)} && git -C ${dir} rev-parse HEAD`,gitAuthEnv(token));
  if(!checkout.success||checkout.stdout.trim().split("\n").at(-1)!==commit)throw new Error("Exact committed preview checkout unavailable");
  const built=await run(`bun /opt/flaregit/src/core/verification/build-preview.ts ${q(dir)} /tmp/build-out`);
  if(!built.success)throw new Error("Preview generation build failed");
  const prefix=generationBuildPrefix(projectId,commit,scope.incarnation,generation);
  const manifest=await inspectPreviewStorageManifest({exec:async argv=>{await authorize();return workspace.exec(argv);}},scope);
  await publishPreviewStorageManifest(manifest,{prefix,bucket:env.EVIDENCE_BUCKET,
   reserve:async value=>assertPreviewStorageAdmission(await global.finalizePreviewGenerationManifest(value)),
   writer:{begin:id=>global.reservePreviewWriter(prefix,id),beforePut:(id,path)=>global.beginPreviewPut(prefix,id,path),settledPut:(id,path)=>global.finishPreviewPut(prefix,id,path),finish:id=>global.finishPreviewWriter(prefix,id)},
   authorize,getFile:async path=>{await authorize();return workspace.readFileBytes(path);}});
  await authorize();await repository.previewGenerationPromote(generation,manifest.manifestHash);
 }catch{
  await fail("publication_unavailable");
  await activity("preview.generation_failed","Replacement preview is unavailable; original upload reservations and Git history remain preserved");
 }finally{
  if(token&&repo){
   const revoked=await repo.revokeToken(token).catch(()=>false);
   if(!revoked){
    if(repoName&&expiresAt)await repository.previewGenerationCredentialIncident(generation,repoName,token,expiresAt).catch(()=>console.error("Preview credential recovery record could not be saved"));
    await activity("preview.credential_cleanup_pending","Preview credential revocation was not confirmed; its lifetime is bounded and recovery remains pending");
   }
  }
  if(sandbox&&lease){try{await sandbox.destroy();if((await sandbox.lifetimeStatus())?.state==="stopped")await global.finishNativeCompute(operation,lease);else await activity("preview.workspace_cleanup_pending","Preview workspace shutdown was not confirmed; its reservation remains held");}catch{await activity("preview.workspace_cleanup_pending","Preview workspace shutdown was not confirmed; its reservation remains held");}}
  else if(lease)await activity("preview.workspace_cleanup_pending","Preview workspace allocation was not confirmed; its reservation remains held");
 }
}
