import worker from "../../src/server/worker";
import {RepositoryController} from "../../src/server/durable-object";
import {accountKeyFor} from "../../src/server/projects";
import type {Env} from "../../src/server/env";
export class ReportsRepository extends RepositoryController{
  async seedReports(reporter:string){
    for(let index=0;index<205;index++)this.ctx.storage.sql.exec("INSERT INTO reports (id,at,reporter,kind,target,details) VALUES (?,?,?,?,?,?)",`rpt_seed-${index.toString().padStart(3,"0")}`,new Date(Date.UTC(2026,0,1,0,0,index)).toISOString(),reporter,"other",`fixture-${index}`,"Accountability fixture details");
  }
}
interface TestEnv{TEST:DurableObjectNamespace<ReportsRepository>;FIXTURE_ISSUER:string}
export default{async fetch(request:Request,env:TestEnv,ctx:ExecutionContext){
  const path=new URL(request.url).pathname;
  if(path==="/fixture/bootstrap"){
    const tokens:Record<string,string>={};
    for(const userId of ["reporter","outsider","operator-one","operator-two"]){const key=await accountKeyFor(userId);const account=env.TEST.getByName(`account:${key}`);await account.setProfile({handle:userId,displayName:"Mutable display name",bio:"",joinedAt:new Date().toISOString()});const token=`fgt_${key}_${"x".repeat(32)}`;await account.createApiToken(userId,"fixture",token,{scope:"full"});tokens[userId]=token;}
    await env.TEST.getByName("global").seedReports(await accountKeyFor("reporter"));return Response.json(tokens);
  }
  if(path==="/fixture/rename"){const value=await request.json() as {userId:string};const account=env.TEST.getByName(`account:${await accountKeyFor(value.userId)}`);const profile=await account.getProfile();await account.setProfile({...profile,displayName:"Changed display name"});return Response.json({renamed:true});}
  if(path==="/fixture/profile-target") {const key=await accountKeyFor("original-profile-owner");const account=env.TEST.getByName(`account:${key}`);await account.setProfile({handle:"reported-handle",displayName:"Original owner",bio:"",joinedAt:"2026-10-02"});await account.setPublicProfileVisibility("public",true,"original-profile-owner",1);await env.TEST.getByName("global").claimHandle("reported-handle",key);return Response.json({ready:true});}
  if(path==="/fixture/reassign-handle") {const global=env.TEST.getByName("global"),key=await accountKeyFor("original-profile-owner");const account=env.TEST.getByName(`account:${key}`);const profile=await account.getProfile();await account.setProfile({...profile,handle:"renamed-original"});await global.releaseHandle("reported-handle",key);const replacement=await accountKeyFor("replacement-profile-owner");await env.TEST.getByName(`account:${replacement}`).setProfile({handle:"reported-handle",displayName:"Replacement owner",bio:"",joinedAt:"2026-10-02"});await global.claimHandle("reported-handle",replacement);return Response.json({reassigned:true});}
  const production={REPOSITORY_CONTROLLER:env.TEST,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:"https://fixture.example",OPERATOR_ACCOUNTS:[await accountKeyFor("operator-one"),await accountKeyFor("operator-two")].join(",")} as unknown as Env;
  return worker.fetch(request,production,ctx);
}};
