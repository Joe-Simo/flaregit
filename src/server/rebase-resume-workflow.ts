import {WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep} from "cloudflare:workers";
import type {Env} from "./env.js";
import {projectOf,globalOf} from "./projects.js";
import {admitNativeCompute,NativeComputeAdmissionError} from "./native-compute.js";
import {admitGitOperation} from "./core-git-budget.js";
import {RebaseRecoveryError} from "./rebase-recovery.js";
import {resumeSavedRebaseGit,SavedRebaseGitError} from "./saved-rebase-git.js";
import {validateRecoveryRemote} from "./private-recovery-bundle.js";
export interface RebaseResumeParams{projectId:string;attemptId:string;generation:number}
/** Transports a previously protected result. It never executes repository code or recomposes history. */
export class FlareGitRebaseResumeWorkflow extends WorkflowEntrypoint<Env,RebaseResumeParams>{
 override async run(event:WorkflowEvent<RebaseResumeParams>,step:WorkflowStep){
  const {projectId,attemptId,generation}=event.payload,project=projectOf(this.env,projectId);
  await step.do("load-saved-resume",{retries:{limit:0,delay:"5 seconds",backoff:"constant"},timeout:"30 seconds"},async()=>{await project.assertRebaseResume(attemptId,generation,event.instanceId);return {loaded:true};});
  const initial=await project.assertRebaseResume(attemptId,generation,event.instanceId);
  const authorize=async()=>{await project.assertRebaseResume(attemptId,generation,event.instanceId);};
  const fund=async()=>{await authorize();const result=await admitGitOperation(this.env,initial.actor.userId,`resume-${crypto.randomUUID()}`);if(result instanceof Response)throw new RebaseRecoveryError("Saved-result transport capacity is unavailable",429);await authorize();};
  try{
   return await step.do("transport-saved-result",{retries:{limit:0,delay:"5 seconds",backoff:"constant"},timeout:"10 minutes"},async()=>{
    try{
     if(initial.receipt)return initial.receipt;
     await authorize();
     if(initial.application.input.canonicalRepoName===initial.application.input.workspaceRepoName)throw new RebaseRecoveryError("Workspace must be separate from the canonical repository",409);
     const proof=await project.verifySavedResumeGit(attemptId,generation,event.instanceId);
     const app=initial.application;
     if(proof.workspaceHead===app.commit)return project.finishRebaseResume(attemptId,generation,event.instanceId,proof);
     if(proof.workspaceHead!==app.input.commit)throw new RebaseRecoveryError("Workspace contains newer work; saved recovery did not replace it",409);
     if(proof.original!==app.input.commit||proof.originalBase!==app.input.base||proof.result!==app.commit||proof.targetBase!==app.base)throw new RebaseRecoveryError("Protected result proof is unavailable",503);
     await authorize();await admitNativeCompute(this.env,initial.accountKey,initial.nativeRunId,"native-essential");await authorize();
     await project.rebaseResumeNativeIntent(attemptId,generation,event.instanceId);
     const sandbox=this.env.INTEGRATOR.getByName(initial.nativeRunId);
     const connection=async(purpose:"canonical"|"workspace")=>{
      const repoName=purpose==="canonical"?app.input.canonicalRepoName:app.input.workspaceRepoName,scope=purpose==="canonical"?"read":"write";
      await fund();using repo=await this.env.ARTIFACTS.get(repoName);await authorize();await fund();const remote=String((await repo.info()).remote);validateRecoveryRemote(remote);await authorize();
      if(!await project.beginRebaseResumeCredential(attemptId,generation,purpose,Date.now()+900_000,scope))throw new RebaseRecoveryError("Prior credential issuance is unconfirmed; no duplicate credential was issued",503);
      await fund();const issued=await repo.createToken(scope,900),expiry=Date.parse(issued.expiresAt);
      try{await project.recordRebaseResumeCredential(attemptId,generation,purpose,repoName,issued.plaintext,expiry);}
      catch{try{await project.recordRebaseResumeCredential(attemptId,generation,purpose,repoName,issued.plaintext,expiry);}catch{
       // Restrictive cleanup may run after owner withdrawal, but still needs prepaid provider capacity.
       const cleanup=await globalOf(this.env).reserveCoreGitOperation(`resume-cleanup-${crypto.randomUUID()}`,initial.accountKey,{accountUsdMicros:null,globalUsdMicros:null});
       if(cleanup.allowed&&await repo.revokeToken(issued.plaintext).catch(()=>false))await project.markRebaseResumeCredentialRevoked(attemptId,purpose,issued.plaintext).catch(()=>undefined);
       throw new RebaseRecoveryError("Issued credential receipt is unconfirmed; no Git command used it",503);
      }}
      if(issued.scope!==scope||!Number.isSafeInteger(expiry)||expiry<=Date.now()||expiry>Date.now()+905_000)throw new RebaseRecoveryError("Credential scope or lifetime is unconfirmed",503);
      await authorize();return{remote,token:issued.plaintext};
     };
     const canonical=await connection("canonical"),workspace=await connection("workspace");
     await resumeSavedRebaseGit({application:app,directory:`/tmp/flaregit-rebase-resume-${attemptId}`,canonical,workspace,exec:(command,env)=>sandbox.exec(["sh","-c",command],{env,timeoutMs:120_000}),beforeCommand:async phase=>{if(phase==="before")await fund();else await authorize();}});
     const confirmed=await project.verifySavedResumeGit(attemptId,generation,event.instanceId);
     await authorize();return project.finishRebaseResume(attemptId,generation,event.instanceId,confirmed);
    }catch(error){await project.pauseRebaseResume(attemptId,generation,event.instanceId,error instanceof NativeComputeAdmissionError?"funding_refused":error instanceof RebaseRecoveryError||error instanceof SavedRebaseGitError?error.status===429?"funding_refused":error.status===409?"git_state_changed":"transport_unconfirmed":"transport_unconfirmed").catch(()=>undefined);throw new Error("Saved-result recovery was not confirmed; protected history and attempt remain available");}
   });
  }finally{
   try{await step.do("cleanup-saved-resume-credentials",{retries:{limit:0,delay:"5 seconds",backoff:"constant"},timeout:"30 seconds"},async()=>{const results=await Promise.allSettled((["canonical","workspace"] as const).map(purpose=>project.revokeRebaseResumeCredential(attemptId,generation,purpose)));if(results.some(result=>result.status==="rejected"||result.value!==true)){await project.pauseRebaseResume(attemptId,generation,event.instanceId,"cleanup_unconfirmed");throw new Error("Credential cleanup remains unconfirmed");}});}
   finally{await step.do("confirm-saved-resume-stop",async()=>{await project.rebaseResumeNativeStopped(attemptId,generation,initial.nativeRunId);return {checked:true};});}
  }
 }
}
