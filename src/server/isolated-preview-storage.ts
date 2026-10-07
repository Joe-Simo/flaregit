import {verifyBuildManifest,type BuildFile,type BuildManifest} from "./static-build-artifact";
import {createPreviewStorageManifest,type PreviewStorageIdentity} from "./preview-storage-upload";

/** Publish only the frozen bytes bound to the isolated output, never workspace files. */
export async function previewStorageFromIsolatedArtifact(identity:PreviewStorageIdentity,artifact:{manifest:BuildManifest;files:BuildFile[]}){
 const scope=structuredClone(identity),output=structuredClone(artifact.manifest);
 const files=artifact.files.map(file=>({...file,bytes:file.bytes.slice()}));
 if(output.kind!=="static"||!output.sourceDigest||output.scope.projectId!==scope.projectId||output.scope.incarnation!==scope.incarnation||output.scope.commit!==scope.commit)throw Error("Preview output scope differs");
 await verifyBuildManifest(output,output.scope,files,output.sourceDigest);
 const manifest=await createPreviewStorageManifest(scope,output.files.map(file=>({path:file.path,size:file.size,sha256:file.digest})));
 const bytes=new Map(files.map(file=>[file.path,file.bytes]));
 return {manifest,getFile:async(path:string)=>{
  const prefix="/tmp/build-out/";
  if(!path.startsWith(prefix))throw Error("Preview asset path differs");
  const value=bytes.get(path.slice(prefix.length));
  if(!value)throw Error("Preview asset unavailable");
  return value.slice();
 }};
}
