import worker, { RepositoryController } from "../../src/server/worker";
import { accountKeyFor } from "../../src/server/projects";
import { TICKET_BOOKING_POLICY } from "../../src/fixtures/ticket-booking/policy";
import { createPreviewStorageManifest } from "../../src/server/preview-storage-upload";
import type { Env } from "../../src/server/env";
const projectId="abcdef123456",commit="a".repeat(40),prefix=`builds/${projectId}/${commit}`;
export class GenerationApiFixture extends RepositoryController {
  snapshot(){return {holds:this.ctx.storage.sql.exec("SELECT physical_key,bytes FROM preview_storage_reservations").toArray(),writers:this.ctx.storage.sql.exec("SELECT physical_key,closed,pending FROM preview_copy_writers").toArray()};}
}
interface FixtureEnv extends Omit<Env,"REPOSITORY_CONTROLLER"> { REPOSITORY_CONTROLLER:DurableObjectNamespace<GenerationApiFixture> }
let computeCalls=0;
export default {async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){
  const path=new URL(request.url).pathname,global=env.REPOSITORY_CONTROLLER.getByName("global"),project=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`);
  if(path==="/fixture/bootstrap"){try{
    const tokens:Record<string,string>={};
    for(const user of ["owner","member","outsider"]){const key=await accountKeyFor(user),token=`fgt_${key}_${"x".repeat(32)}`;await env.REPOSITORY_CONTROLLER.getByName(`account:${key}`).createApiToken(user,"fixture",token,{scope:"full"});tokens[user]=token;}
    await project.initialize({projectId,projectName:"Recovery API fixture",canonicalRepoName:"fixture-repo",head:commit,verificationPolicy:TICKET_BOOKING_POLICY,ownerId:"owner"});
    await project.addMember("member","member");
    const scope=await project.previewStorageScope(commit,"fixture-repo");
    const manifest=await createPreviewStorageManifest(scope,[{path:"index.html",size:12,sha256:"b".repeat(64)}]);
    const admitted=await global.reservePreviewStorage(manifest);if(!admitted.allowed)throw new Error(admitted.reason);
    const writer="11111111-1111-4111-8111-111111111111";
    await global.reservePreviewWriter(prefix,writer);await global.beginPreviewPut(prefix,writer,"index.html");
    await global.setNativeComputeFailureReason(`build-${projectId}-${commit}`,"storage_reconciliation");
    return Response.json(tokens); }catch(error){return new Response(String(error),{status:500});}
  }
  if(path==="/fixture/snapshot")return Response.json({...await global.snapshot(),computeCalls});
  const production={...env,REPOSITORY_CONTROLLER:env.REPOSITORY_CONTROLLER,API_LIMITER:{limit:async()=>({success:true})},INTEGRATOR:{getByName:()=>{computeCalls++;throw new Error("Compute should not dispatch in storage denial fixture");}}} as unknown as Env;
  return worker.fetch(request,production,ctx);
}};
