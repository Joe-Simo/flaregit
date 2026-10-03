import { RepositoryController } from "../../src/server/durable-object";
import { accountKeyFor } from "../../src/server/projects";
import { createPreviewStorageManifest, publishPreviewStorageManifest } from "../../src/server/preview-storage-upload";
import type { Env } from "../../src/server/env";
import type { FlareGitProjectState, VerificationEvidence } from "../../src/core/types";
const projectId="p123456789abc",accepted="a".repeat(40),candidate="b".repeat(40);
export class PreviewScopeFixture extends RepositoryController {
 seed(){const state={projectId,projectName:"Scope fixture",canonicalRepoName:"scope-repo",acceptedState:{currentCommit:accepted,history:[],activeRequirements:[]},journal:[],tasks:{},candidates:{one:{id:"one",status:"verifying"}},policyVersion:1,verificationPolicy:{},decisions:{},evidence:{}} as unknown as FlareGitProjectState;this.ctx.storage.sql.exec("INSERT INTO project(id,doc) VALUES(1,?)",JSON.stringify(state));}
}
export default {async fetch(request:Request,env:Env){
 const url=new URL(request.url),ledger=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as PreviewScopeFixture;
 try {
 if(url.pathname==="/seed"){await ledger.seed();await ledger.addMember("owner","owner","Owner");await ledger.addMember("requester","member","Requester");return Response.json({ownerKey:await accountKeyFor("owner"),requesterKey:await accountKeyFor("requester")});}
 if(url.pathname==="/scope")return Response.json(await ledger.previewStorageScope(url.searchParams.get("commit")??accepted,url.searchParams.get("repo")??"scope-repo"));
 if(url.pathname==="/promote"){await ledger.addMember("owner","owner");return new Response("ok");}
 if(url.pathname==="/demote"){await ledger.addMember("owner","member");return new Response("ok");}
 if(url.pathname==="/seal"){await (env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("owner")}`) as unknown as PreviewScopeFixture).beginAccountDeletion();return new Response("ok");}
 if(url.pathname==="/state")return Response.json(await ledger.getState());
 if(url.pathname==="/verify"){await ledger.recordVerification("one",candidate,{id:"proof",candidateCommit:candidate,status:"passed"} as VerificationEvidence);return new Response("ok");}
 if(url.pathname==="/upload"){
 const scope=await ledger.previewStorageScope(candidate,"scope-repo"),bytes=new TextEncoder().encode("preview"),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");
 const manifest=await createPreviewStorageManifest(scope,[{path:"index.html",size:bytes.length,sha256:hash}]);
 await publishPreviewStorageManifest(manifest,{prefix:`builds/${projectId}/${candidate}`,reserve:value=>(env.REPOSITORY_CONTROLLER.getByName("global") as unknown as PreviewScopeFixture).reservePreviewStorage(value),authorize:async()=>{await ledger.previewStorageScope(candidate,"scope-repo");},getFile:async()=>bytes,bucket:{head:async()=>null,put:async()=>{throw new Error("Optional preview upload failed");}}});
 return new Response("ok");
 }
 return new Response("missing",{status:404});
 }catch(error){return new Response(error instanceof Error?error.message:"failed",{status:409});}
}};
