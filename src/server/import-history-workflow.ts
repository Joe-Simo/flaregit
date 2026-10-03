import {admitNativeCompute,NativeComputeAdmissionError} from "./native-compute.js";
import {WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep} from "cloudflare:workers";
import type {Env} from "./env.js";
import {projectOf,PROJECT_ID} from "./projects.js";
import {preparePublicSourceHistoryClone,readSourceHistoryTraversalChunk} from "./import-source-history.js";
import {captureArtifactsHistoryChunk,HistoryMetadataLimitError} from "./import-history.js";
import {admitGitOperation} from "./core-git-budget.js";
import {validateImportSource} from "./import-source.js";
export interface ImportHistoryParams{accountKey:string;projectId:string;expectedHead:string;operationId?:string;attemptGeneration?:number}
export const importHistoryReceiptKey=(projectId:string,head:string,instanceId:string)=>{if(!PROJECT_ID.test(projectId)||!/^[a-f0-9]{40}$/.test(head)||!/^[A-Za-z0-9_-]{1,100}$/.test(instanceId))throw new Error("Invalid receipt identity");return`migration-history/${projectId}/${head}/${instanceId}.json`;};
const MAX_CHUNKS_PER_ATTEMPT=12;
/** Durable, bounded metadata inspection only. Imported browsing never depends on this optional check. */
export class FlareGitImportHistoryWorkflow extends WorkflowEntrypoint<Env,ImportHistoryParams>{
 override async run(event:WorkflowEvent<ImportHistoryParams>,step:WorkflowStep){
  const {accountKey,projectId,expectedHead}=event.payload,operationId=event.payload.operationId??event.instanceId;
  const project=projectOf(this.env,projectId);
  const initial=await step.do("authorize-frozen-inspection",async()=>{
   const snapshot=await project.beginHistoryInspection(operationId,accountKey,expectedHead),attempt=await project.historyInspectionAttempt(operationId);
   if(snapshot.scope.projectId!==projectId||!attempt||attempt.workflowId!==event.instanceId||(event.payload.attemptGeneration!==undefined&&attempt.generation!==event.payload.attemptGeneration))throw new Error("Saved inspection attempt required");
   return{snapshot,attempt};
  });
  const scope=initial.snapshot.scope,attempt=initial.attempt;
  const authorize=async()=>{await project.assertHistoryInspectionAttempt(operationId,attempt.generation,event.instanceId);};
  const pauseFailure=async(error:unknown)=>{
   // Persist typed failure while it is still local: Workflow step errors are
   // serialized and cannot preserve instanceof identity at the outer boundary.
   const current=await project.getHistoryInspection(operationId);
   if(current?.status!=="running")return;
   await project.pauseHistoryInspection(operationId,error instanceof NativeComputeAdmissionError?"funding_unavailable":error instanceof HistoryMetadataLimitError?"history_metadata_capacity":"inspection_unavailable",{generation:attempt.generation,workflowId:event.instanceId});
  };
  let progress=initial.snapshot;
  let nativePrepared=false;
  const directory=`/tmp/flaregit-import-history-${attempt.nativeRunId.slice(7)}`;
  try{
   if(progress.status!=="running")return{operationId,status:progress.status};
   if(progress.source.pending){
    const sourceAllowed=await step.do("validate-source-provider",async()=>{await authorize();try{const url=validateImportSource(scope.source);return url.hostname==="github.com"&&/^\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+(?:\.git)?\/?$/.test(url.pathname);}catch{return false;}});
    if(!sourceAllowed){await step.do("pause-unsupported-source",async()=>project.pauseHistoryInspection(operationId,"unsupported_source",{generation:attempt.generation,workflowId:event.instanceId}));return{operationId,status:"paused"};}
    const prepared=await step.do("prepare-pinned-source",{retries:{limit:0,delay:"5 seconds",backoff:"constant"},timeout:"5 minutes"},async()=>{
     try{
     await authorize();await admitNativeCompute(this.env,accountKey,attempt.nativeRunId);await authorize();await project.historyInspectionNativeIntent(operationId,attempt.generation,event.instanceId);
     const sandbox=this.env.INTEGRATOR.getByName(attempt.nativeRunId);
     const source=await preparePublicSourceHistoryClone({exec:(command,options)=>sandbox.exec(["sh","-c",command],{env:options?.env,timeoutMs:options?.timeout})},scope.source,scope.branch,expectedHead,directory,authorize);
     if(!source||source.shallow){await project.pauseHistoryInspection(operationId,source?.shallow?"source_shallow":"source_unavailable",{generation:attempt.generation,workflowId:event.instanceId});return false;}await authorize();return true;
     }catch(error){await pauseFailure(error).catch(()=>undefined);throw error;}
    });
    if(!prepared)return{operationId,status:"paused"};nativePrepared=true;
   }
   for(let index=0;index<MAX_CHUNKS_PER_ATTEMPT&&progress.status==="running";index++){
    progress=await step.do(`capture-history-chunk-${index}`,{retries:{limit:0,delay:"5 seconds",backoff:"constant"},timeout:"2 minutes"},async()=>{
     try{
     await authorize();const current=await project.getHistoryInspection(operationId);if(!current)throw new Error("Saved inspection unavailable");if(current.status!=="running")return current;
     const side=current.source.pending?"source":"destination";
     if(!current.source.pending&&!current.destination.pending)return project.finishHistoryInspection(operationId,{generation:attempt.generation,workflowId:event.instanceId});
     const batch=await project.importHistoryBatch(operationId,side,side==="source"?256:128);if(batch.complete)return current;
     let commits:Record<string,{tree:string;parents:string[]}>,missing:string[]=[];
     if(side==="source"){
      if(!nativePrepared)throw new Error("Pinned source workspace unavailable");
      const sandbox=this.env.INTEGRATOR.getByName(attempt.nativeRunId);
      const captured=await readSourceHistoryTraversalChunk({exec:(command,options)=>sandbox.exec(["sh","-c",command],{env:options?.env,timeoutMs:options?.timeout})},directory,batch.requested,authorize);
      if(captured.shallow){return project.pauseHistoryInspection(operationId,"source_shallow",{generation:attempt.generation,workflowId:event.instanceId});}commits=captured.commits;
     }else{
      let calls=1;
      const reserve=async()=>{await authorize();const admitted=await admitGitOperation(this.env,scope.ownerId,`history-${crypto.randomUUID()}`);if(admitted instanceof Response)throw new NativeComputeAdmissionError();await authorize();};
      await reserve();const captured=await captureArtifactsHistoryChunk(this.env.ARTIFACTS,scope.canonicalRepoName,batch.requested,async()=>{if(calls>=8){await reserve();calls=0;}calls++;await authorize();},batch.knownHashes,authorize);
      commits=captured.commits;missing=captured.missing;
     }
     await authorize();const saved=await project.commitHistoryChunk(operationId,side,{batchId:batch.batchId,revision:batch.revision,requested:batch.requested,commits:Object.entries(commits).map(([hash,value])=>({hash,...value})),unavailable:missing},{generation:attempt.generation,workflowId:event.instanceId});
     return saved.snapshot;
     }catch(error){await pauseFailure(error).catch(()=>undefined);throw error;}
    });
    if(nativePrepared&&!progress.source.pending){
     // A fixed step name and cached result rebuild the same release boundary on
     // replay. Destination metadata uses the saved SQL graph, not the workspace.
     await step.do("release-complete-source-workspace",async()=>project.historyInspectionNativeStopped(operationId,attempt.generation,attempt.nativeRunId));
     nativePrepared=false;
    }
   }
   if(progress.status==="running")progress=await step.do("pause-attempt-frontier",async()=>{await authorize();const current=await project.getHistoryInspection(operationId);if(current&&!current.source.pending&&!current.destination.pending)return project.finishHistoryInspection(operationId,{generation:attempt.generation,workflowId:event.instanceId});return project.pauseHistoryInspection(operationId,"attempt_chunk_limit",{generation:attempt.generation,workflowId:event.instanceId});});
   return{operationId,status:progress.status};
  }catch(error){await step.do("pause-interrupted-inspection",async()=>pauseFailure(error)).catch(()=>undefined);throw new Error("Inspection paused; saved history chunks remain available");}
  finally{
   await step.do("confirm-source-workspace-stop",async()=>project.historyInspectionNativeStopped(operationId,attempt.generation,attempt.nativeRunId));
  }
 }
}
