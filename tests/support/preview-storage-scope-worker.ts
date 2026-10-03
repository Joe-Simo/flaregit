import {assertPreviewStorageAdmission} from "../../src/server/preview-storage.js";
import { RepositoryController } from "../../src/server/durable-object";
import { accountKeyFor } from "../../src/server/projects";
import { createPreviewStorageManifest, publishPreviewStorageManifest } from "../../src/server/preview-storage-upload";
import type { Env } from "../../src/server/env";
import type { FlareGitProjectState, VerificationEvidence } from "../../src/core/types";
const projectId="p123456789abc",accepted="a".repeat(40),candidate="b".repeat(40);
export class PreviewScopeFixture extends RepositoryController {
 async fixtureAllowance(){this.env.PREVIEW_STORAGE_GLOBAL_BYTES="1000";}
 async fixtureHeldBytes(){return this.ctx.storage.sql.exec<{bytes:number}>("SELECT COALESCE(SUM(bytes),0) AS bytes FROM preview_storage_reservations").one().bytes;}
 async fixtureRace(mode:string){await this.ctx.storage.put("race",mode);}
 override async accountLifecycle():Promise<"active"|"deleting"|"deleted"> {const mode=await this.ctx.storage.get<string>("race");if(mode){await this.ctx.storage.delete("race");await (this.env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as PreviewScopeFixture).fixtureMutate(mode);}return super.accountLifecycle();}
 async fixtureMutate(mode:string){const state=await this.getState();if(mode==="canonical")state.canonicalRepoName="changed-repo";if(mode==="project")state.projectId="p999999999abc";if(mode==="commit")state.acceptedState.currentCommit="d".repeat(40);if(mode==="incarnation")this.ctx.storage.sql.exec("DELETE FROM private_recovery_incarnation");if(mode==="owner")this.ctx.storage.sql.exec("INSERT INTO members(user_id,role,label,added_at) VALUES('earlier-owner','owner','Earlier owner','2000-01-01')");this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));}
 seed(){const state={projectId,projectName:"Scope fixture",canonicalRepoName:"scope-repo",acceptedState:{currentCommit:accepted,history:[],activeRequirements:[]},journal:[],tasks:{},candidates:{one:{id:"one",status:"verifying"}},policyVersion:1,verificationPolicy:{},decisions:{},evidence:{}} as unknown as FlareGitProjectState;this.ctx.storage.sql.exec("INSERT INTO project(id,doc) VALUES(1,?)",JSON.stringify(state));}
}
export default {async fetch(request:Request,env:Env){
 const url=new URL(request.url),ledger=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as PreviewScopeFixture;
 try {
 if(url.pathname==="/seed"){await ledger.seed();await ledger.addMember("owner","owner","Owner");await ledger.addMember("requester","member","Requester");return Response.json({ownerKey:await accountKeyFor("owner"),requesterKey:await accountKeyFor("requester")});}
 if(url.pathname==="/race"){await (env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("owner")}`) as unknown as PreviewScopeFixture).fixtureRace(url.searchParams.get("mode")!);await ledger.previewStorageScope(accepted,"scope-repo");throw new Error("Race incorrectly admitted");}
 if(url.pathname==="/scope")return Response.json(await ledger.previewStorageScope(url.searchParams.get("commit")??accepted,url.searchParams.get("repo")??"scope-repo"));
 if(url.pathname==="/promote"){await ledger.addMember("owner","owner");return new Response("ok");}
 if(url.pathname==="/demote"){await ledger.addMember("owner","member");return new Response("ok");}
 if(url.pathname==="/seal"){await (env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("owner")}`) as unknown as PreviewScopeFixture).beginAccountDeletion();return new Response("ok");}
 if(url.pathname==="/readmit"){const global=env.REPOSITORY_CONTROLLER.getByName("global") as unknown as PreviewScopeFixture;if(url.searchParams.has("raise"))await global.fixtureAllowance();const scope=await ledger.previewStorageScope(candidate,"scope-repo");return Response.json({admission:await global.previewStorageReadmission(scope),held:await global.fixtureHeldBytes()});}
 if(url.pathname==="/state")return Response.json(await ledger.getState());
 if(url.pathname==="/verify"){await ledger.recordVerification("one",candidate,{id:"proof",candidateCommit:candidate,status:"passed"} as VerificationEvidence);return new Response("ok");}
 if(url.pathname==="/upload"){
 const scope=await ledger.previewStorageScope(candidate,"scope-repo"),bytes=new TextEncoder().encode("preview"),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");
 const manifest=await createPreviewStorageManifest(scope,[{path:"index.html",size:bytes.length,sha256:hash}]);
 const global=env.REPOSITORY_CONTROLLER.getByName("global") as unknown as PreviewScopeFixture;
 if(url.searchParams.get("admission")==="true")return Response.json(await global.reservePreviewStorage(manifest));
 await publishPreviewStorageManifest(manifest,{writer:{begin:id=>global.reservePreviewWriter(`builds/${projectId}/${candidate}`,id),beforePut:(id,path)=>global.beginPreviewPut(`builds/${projectId}/${candidate}`,id,path),settledPut:(id,path)=>global.finishPreviewPut(`builds/${projectId}/${candidate}`,id,path),finish:id=>global.finishPreviewWriter(`builds/${projectId}/${candidate}`,id)},prefix:`builds/${projectId}/${candidate}`,reserve:async value=>assertPreviewStorageAdmission(await (env.REPOSITORY_CONTROLLER.getByName("global") as unknown as PreviewScopeFixture).reservePreviewStorage(value)),authorize:async()=>{await ledger.previewStorageScope(candidate,"scope-repo");},getFile:async()=>bytes,bucket:{head:async()=>null,put:async()=>{throw new Error("Optional preview upload failed");}}});
 return new Response("ok");
 }
 return new Response("missing",{status:404});
 }catch(error){return new Response(error instanceof Error?error.message:"failed",{status:409});}
}};
