import {RepositoryController} from "../../src/server/durable-object";
import type {Env} from "../../src/server/env";
export class AcceptanceControllerFixture extends RepositoryController{
 override async fetch(request:Request){const url=new URL(request.url),actor={userId:url.searchParams.get("actor")??"owner",displayName:"Fixture owner",viaToken:url.searchParams.has("token")};try{
 if(url.pathname==="/seed"){await this.initialize({projectId:"p123456789abc",projectName:"Acceptance fixture",canonicalRepoName:"canonical",head:"a".repeat(40),ownerId:"owner",verificationPolicy:{kind:"git-integrity"}});await this.addMember("member","member");return Response.json({seeded:true});}
 if(url.pathname==="/read")return Response.json(await this.acceptancePolicyState(actor,undefined,Date.now()+60000));
 if(url.pathname==="/configure")return Response.json(await this.configureAcceptancePolicy(actor,{eventId:url.searchParams.get("event")!,expectedVersion:Number(url.searchParams.get("version")),config:url.searchParams.has("auto")?{mode:"verified-auto-accept",protectedAdapter:"ticket-booking-browser"}:{mode:"review-required"}},Date.now()+60000));
 if(url.pathname==="/remove"){this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id=?",actor.userId);return Response.json({removed:true});}
 return new Response("Not found",{status:404});
 }catch{return Response.json({error:"Authority or policy refused"},{status:409});}}
}
export default {fetch:(request:Request,env:Env)=>env.REPOSITORY_CONTROLLER.getByName("fixture").fetch(request)};
