import {PreviewStorageAdmissionError,assertPreviewStorageAdmission} from './preview-storage';
import {publishPreviewStorageManifest} from './preview-storage-upload';
import {globalOf,projectOf} from './projects';
import type {Env} from './env';
import {buildPrefix} from './preview-access';
import {buildIsolatedPreview,PreviewExecutionBusyError,type PreviewBuildRequest} from './isolated-preview-build';
import {previewStorageFromIsolatedArtifact} from './isolated-preview-storage';
import {StaticPreviewNotSupportedError, STATIC_PREVIEW_UNSUPPORTED} from './preview-static-capability';
class PreviewPublicationBusyError extends Error{constructor(){super('Original preview storage writer remains held');this.name='PreviewPublicationBusyError';}}
/** Builds exact immutable Git bytes only in the existing isolated execution namespace. */
export async function ensureBuild(env:Env,projectId:string,commit:string,canonicalRepo:string,accountKey:string,nativeCandidate?:PreviewBuildRequest['nativeCandidate']):Promise<void>{
 const prefix=buildPrefix(projectId,commit),global=globalOf(env),repository=projectOf(env,projectId),operation=`build-${projectId}-${commit}`;
 if(await env.EVIDENCE_BUCKET.head(`${prefix}/index.html`))return;
 if(await global.nativeComputeFailure(operation))throw Error('Preview build failed; owner retry is required');
 try{
  const identity=await repository.previewStorageScope(commit,canonicalRepo);if(identity.accountKey!==accountKey)throw Error('Preview storage owner changed');
  const authorize=async()=>{const fresh=await repository.previewStorageScope(commit,canonicalRepo);if(JSON.stringify(fresh)!==JSON.stringify(identity))throw Error('Preview storage owner or incarnation changed');};
  if(!env.UNTRUSTED_EXECUTION)throw Error('Isolated preview runtime unavailable');
  const artifact=await buildIsolatedPreview({projectId,commit,canonicalRepoName:canonicalRepo,...(nativeCandidate?{nativeCandidate}:{})},{ledger:repository,namespace:env.UNTRUSTED_EXECUTION});
  await authorize();const output=await previewStorageFromIsolatedArtifact(identity,artifact);await authorize();
  await publishPreviewStorageManifest(output.manifest,{prefix,bucket:env.EVIDENCE_BUCKET,reserve:async value=>assertPreviewStorageAdmission(await global.reservePreviewStorage(value)),writer:{begin:async id=>{const claim=await global.claimPreviewWriter(prefix,id);if(claim.status==='held')throw new PreviewPublicationBusyError();if(claim.status!=='owned')throw Error('Preview writer ownership unconfirmed');},beforePut:(id,path)=>global.beginPreviewPut(prefix,id,path),settledPut:(id,path)=>global.finishPreviewPut(prefix,id,path),finish:id=>global.finishPreviewWriter(prefix,id)},authorize,getFile:output.getFile});
 }catch(error){if(error instanceof PreviewExecutionBusyError||error instanceof PreviewPublicationBusyError)return;const unfinished=(await global.previewStorageWriterState(prefix).catch(()=>({unfinished:true}))).unfinished;await global.setNativeComputeFailureReason(operation,unfinished?'storage_reconciliation':error instanceof PreviewStorageAdmissionError?error.reason:error instanceof StaticPreviewNotSupportedError?STATIC_PREVIEW_UNSUPPORTED:'build_failed');throw error;}
}
