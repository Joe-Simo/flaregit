import {expect,test} from "bun:test";
import {bindBuildManifest,type BuildFile} from "../src/server/static-build-artifact";
import {previewStorageFromIsolatedArtifact} from "../src/server/isolated-preview-storage";
import {publishPreviewStorageManifest} from "../src/server/preview-storage-upload";
const scope={attemptId:"11111111-1111-4111-8111-111111111111",projectId:"p123456789abc",incarnation:"22222222-2222-4222-8222-222222222222",commit:"a".repeat(40),tree:"b".repeat(40),policyDigest:"c".repeat(64)};
const identity={projectId:scope.projectId,incarnation:scope.incarnation,commit:scope.commit,accountKey:"owner"};
test("preview publication preserves isolated bytes across caller mutation",async()=>{
 const files:BuildFile[]=[{path:"index.html",kind:"file",bytes:new TextEncoder().encode("verified output")}];
 const manifest=await bindBuildManifest("static",scope,files,"d".repeat(64));
 const pending=previewStorageFromIsolatedArtifact(identity,{manifest,files});
 files[0]!.bytes.fill(0);manifest.files[0]!.digest="e".repeat(64);
 const output=await pending;
 expect(new TextDecoder().decode(await output.getFile("/tmp/build-out/index.html"))).toBe("verified output");
 const read=await output.getFile("/tmp/build-out/index.html");read.fill(0);
 expect(new TextDecoder().decode(await output.getFile("/tmp/build-out/index.html"))).toBe("verified output");
 await expect(output.getFile("/tmp/build-out/../index.html")).rejects.toThrow();
 await expect(output.getFile("index.html")).rejects.toThrow();
});
test("preview rejects altered bytes and repository identity",async()=>{
 const files:BuildFile[]=[{path:"index.html",kind:"file",bytes:new TextEncoder().encode("output")}];
 const manifest=await bindBuildManifest("static",scope,files,"d".repeat(64));
 await expect(previewStorageFromIsolatedArtifact({...identity,commit:"e".repeat(40)},{manifest,files})).rejects.toThrow();
 files[0]!.bytes.fill(0);
 await expect(previewStorageFromIsolatedArtifact(identity,{manifest,files})).rejects.toThrow();
});
test("standard preview publisher writes only isolated bytes and keeps an unresolved put pending",async()=>{
 const files:BuildFile[]=[{path:"index.html",kind:"file",bytes:new TextEncoder().encode("isolated page")}];
 const manifest=await bindBuildManifest("static",scope,files,"d".repeat(64));
 const output=await previewStorageFromIsolatedArtifact(identity,{manifest,files});
 let settled=0,finished=0,stored="";
 const options={prefix:"builds/exact",reserve:async()=>{},writer:{begin:async()=>{},beforePut:async()=>{},settledPut:async()=>{settled++;},finish:async()=>{finished++;}},authorize:async()=>{},getFile:output.getFile,bucket:{head:async()=>null,put:async(_key:string,bytes:Uint8Array)=>{stored=new TextDecoder().decode(bytes);return {};}}};
 await publishPreviewStorageManifest(output.manifest,options);
 expect(stored).toBe("isolated page");expect(settled).toBe(1);expect(finished).toBe(1);
 options.bucket.put=async()=>{throw Error("lost put response");};
 await expect(publishPreviewStorageManifest(output.manifest,options)).rejects.toThrow("lost put response");
 expect(settled).toBe(1);expect(finished).toBe(1);
});
