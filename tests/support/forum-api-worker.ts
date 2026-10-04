import worker from "../../src/server/worker";
import {RepositoryController} from "../../src/server/durable-object";
import {accountKeyFor} from "../../src/server/projects";
import type {Env} from "../../src/server/env";
export class ForumApiRepository extends RepositoryController{
  seedPrivate(){this.ctx.storage.sql.exec("INSERT INTO issues(title,body,state,author,created_at,updated_at) VALUES('Private repo title','Private repository conversation body','open','private-subject','now','now')");}
}
interface TestEnv{TEST:DurableObjectNamespace<ForumApiRepository>;FIXTURE_ISSUER:string}
export default{async fetch(request:Request,env:TestEnv,ctx:ExecutionContext){
  const path=new URL(request.url).pathname;
  if(path==="/fixture/bootstrap"){
    const tokens:Record<string,string>={};
    for(const[userId,name]of [["forum-owner","Verified forum author"],["forum-other","Other signed contributor"],["forum-moderator","Signed moderator"]]){
      const key=await accountKeyFor(userId!),account=env.TEST.getByName(`account:${key}`);await account.setProfile({handle:userId!,displayName:name!,bio:"",joinedAt:new Date().toISOString()});
      const token=`fgt_${key}_${"x".repeat(32)}`;await account.createApiToken(userId!,"fixture",token,{scope:"full"});tokens[userId!]=token;
      if(userId==="forum-owner"){const pinned=`fgt_${key}_${"y".repeat(32)}`;await account.createApiToken(userId,"pinned fixture",pinned,{scope:"full",repo:"abcdef123456"});tokens.pinned=pinned;}
    }
    await env.TEST.getByName("global").seedPrivate();return Response.json(tokens);
  }
  if(path==="/fixture/delete"){const value=await request.json() as{userId:string};const account=env.TEST.getByName(`account:${await accountKeyFor(value.userId)}`);await account.beginAccountDeletion();await account.finishAccountDeletion();return Response.json({deleted:true});}
  const production={REPOSITORY_CONTROLLER:env.TEST,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:"https://fixture.example",OPERATOR_ACCOUNTS:await accountKeyFor("forum-moderator")} as unknown as Env;
  return worker.fetch(request,production,ctx);
}};
