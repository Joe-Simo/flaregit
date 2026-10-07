import type {Env} from './env';
import {projectOf,globalOf} from './projects';
import {generationBuildPrefix} from './preview-access';
import {publishPreviewStorageManifest} from './preview-storage-upload';
import {assertPreviewStorageAdmission} from './preview-storage';
import {buildIsolatedPreview} from './isolated-preview-build';
import {previewStorageFromIsolatedArtifact} from './isolated-preview-storage';
import {StaticPreviewNotSupportedError, STATIC_PREVIEW_UNSUPPORTED} from './preview-static-capability';
/** Replacement storage is separately funded; unknown older work keeps its holds.
 * Contributor code runs exclusively in the existing isolated build namespace. */
export async function buildPreviewGeneration(env:Env,projectId:string,generation:string):Promise<void>{
 const repository=projectOf(env,projectId),global=globalOf(env);let claimed=false;
 const activity=async(type:string,message:string)=>{await repository.logActivity('FlareGit',type,message).catch(()=>console.error('Preview recovery activity could not be saved'));};
 const fail=async(reason:string)=>{if(claimed)await repository.previewGenerationFail(generation,reason).catch(()=>undefined);};
 try{claimed=await repository.previewGenerationClaim(generation);if(!claimed)return;
  const scope=await repository.previewGenerationScope(generation),state=await repository.getState();
  const authorize=async()=>{const current=await repository.previewGenerationScope(generation);if(JSON.stringify(current)!==JSON.stringify(scope))throw Error('Preview generation authorization changed');};
  await authorize();if(!env.UNTRUSTED_EXECUTION)throw Error('Isolated preview runtime unavailable');
  const artifact=await buildIsolatedPreview({projectId,commit:scope.commit,canonicalRepoName:state.canonicalRepoName,generation},{ledger:repository,namespace:env.UNTRUSTED_EXECUTION});
  await authorize();const output=await previewStorageFromIsolatedArtifact(scope,artifact);await authorize();
  const prefix=generationBuildPrefix(projectId,scope.commit,scope.incarnation,generation);
  await publishPreviewStorageManifest(output.manifest,{prefix,bucket:env.EVIDENCE_BUCKET,reserve:async value=>assertPreviewStorageAdmission(await global.finalizePreviewGenerationManifest(value)),writer:{begin:id=>global.reservePreviewWriter(prefix,id),beforePut:(id,path)=>global.beginPreviewPut(prefix,id,path),settledPut:(id,path)=>global.finishPreviewPut(prefix,id,path),finish:id=>global.finishPreviewWriter(prefix,id)},authorize,getFile:output.getFile});
  await authorize();await repository.previewGenerationPromote(generation,output.manifest.manifestHash);
 }catch(error){await fail(error instanceof StaticPreviewNotSupportedError?STATIC_PREVIEW_UNSUPPORTED:'publication_unavailable');await activity('preview.generation_failed','Replacement preview is unavailable; original upload reservations and Git history remain preserved');}
}
