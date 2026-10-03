import worker from "../../src/server/worker";
import { SharingOwnerFixture } from "./public-git-sharing-owner-worker";
import { accountKeyFor } from "../../src/server/projects";
import type { Env } from "../../src/server/env";
export class SharingHttpFixture extends SharingOwnerFixture {}
export default {async fetch(request:Request,env:{TEST:DurableObjectNamespace<SharingHttpFixture>;ISSUER:string},ctx:ExecutionContext){
 if(new URL(request.url).pathname==="/bootstrap"){
  const project=env.TEST.getByName("project:abcdef123456");await project.ready();await project.addMember("member","member");
  const key=await accountKeyFor("owner"),token=`fgt_${key}_${"x".repeat(32)}`;await env.TEST.getByName(`account:${key}`).createApiToken("owner","fixture",token,{scope:"full"});return Response.json({token});
 }
 const production={REPOSITORY_CONTROLLER:env.TEST,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.ISSUER,CLERK_AUTHORIZED_PARTIES:"https://fixture.example"} as unknown as Env;
 return worker.fetch(request,production,ctx);
}};
