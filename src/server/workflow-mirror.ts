import type {Env} from "./env";
import type {Ledger} from "./durable-object";
import {runMirrorExecution} from "./mirror-runner";
import {globalOf} from "./projects";
import {configuredGitCap} from "./core-git-budget";
/** Optional delivery is bound to the actual registered workflow and accepted journal, never a fabricated session. */
export async function runWorkflowMirrorFollowup(env:Env,repository:Ledger,workflowId:string,journalId:string,targetRef?:string,acceptedCommit?:string){
 let reportedCommit=acceptedCommit;
 try{
   const configuration=await repository.getMirror();if(!configuration?.target||!configuration.enabled)return{skipped:true as const};
   const state=await repository.getState();reportedCommit??=state.journal.find(entry=>entry.id===journalId&&entry.state==="ACCEPTED")?.newHead;
   if(targetRef&&targetRef!==`refs/heads/${state.defaultBranch}`){if(reportedCommit)await repository.recordMirrorRun(reportedCommit,"deferred","Accepted history is durable. An explicit mirror mapping for this branch is required.");return{status:"deferred" as const,reason:"target_mapping_required" as const,targetRef};}
   const authority={kind:"integration" as const,workflowId,journalId},saved=await repository.prepareMirrorExecutionForWorkflow(workflowId,journalId),id=saved.scope.id;
   const result=await runMirrorExecution(env,saved.scope,{recordCredential:(token,expiry,scope)=>repository.recordMirrorExecutionCredential(id,token,expiry,scope),authorize:mode=>repository.authorizeMirrorExecution(id,authority,undefined,undefined,mode),admit:()=>repository.admitMirrorExecution(id,authority),access:mode=>repository.mirrorExecutionAccess(id,authority,undefined,undefined,mode),assertReadAccess:digest=>repository.assertMirrorReadAccess(id,digest,authority),fund:async()=>{const admitted=await globalOf(env).reserveCoreGitOperation(`mirror-sdk-${crypto.randomUUID()}`,saved.scope.accountKey,{accountUsdMicros:configuredGitCap(env.CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS),globalUsdMicros:configuredGitCap(env.CORE_GIT_GLOBAL_MONTHLY_USD_MICROS)});if(!admitted.allowed)throw Error("Mirror transport funding unavailable");},journal:{get:()=>repository.mirrorExecutionRecord(id,authority),beginIssue:()=>repository.beginMirrorExecutionIssue(id,authority),recordCredential:(token,expiry,scope)=>repository.recordMirrorExecutionCredential(id,token,expiry,scope),beginNative:()=>repository.beginMirrorExecutionNative(id,authority),beginPush:()=>repository.beginMirrorExecutionPush(id,authority),observed:value=>repository.observeMirrorExecution(id,value,authority),credentialRevoked:token=>repository.confirmMirrorExecutionCredentialRevoked(id,token),nativeStopped:()=>repository.confirmMirrorExecutionStopped(id)}});
   if(result.status==="complete"&&result.result?.status==="ok")await repository.recordMirrorRun(saved.scope.commit,"ok",result.result.detail);else await repository.recordMirrorRun(saved.scope.commit,"deferred","Accepted Git history is preserved. Mirror delivery or credential cleanup remains unconfirmed; inspect the saved operation.");
   return{status:result.status,operationId:id};
 }catch{if(reportedCommit)await repository.recordMirrorRun(reportedCommit,"deferred","Accepted Git history is preserved. Mirror delivery or its status was not confirmed; inspect Mirror settings.").catch(()=>undefined);await repository.logActivity("FlareGit","mirror.pending","Accepted Git history is durable; mirror authorization, delivery or cleanup was not confirmed. Inspect the saved mirror operation before retrying.").catch(()=>undefined);return{status:"held" as const};}
}
