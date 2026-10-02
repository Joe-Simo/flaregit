import {RepositoryController} from "../../src/server/durable-object";
import worker from "../../src/server/worker";
import {accountKeyFor} from "../../src/server/projects";
import type {Env} from "../../src/server/env";

export class ScopedAccountFixture extends RepositoryController {
  seedPublic(id:string) {
    this.ctx.storage.sql.exec("INSERT INTO project VALUES(1,?)",JSON.stringify({projectId:id,projectName:"Scoped fixture",canonicalRepoName:"fixture",acceptedState:{currentCommit:"a".repeat(40)},tasks:{}}));
    this.ctx.storage.sql.exec("CREATE TABLE repository_visibility(id INTEGER PRIMARY KEY,visibility TEXT,version INTEGER,confirmed_by TEXT);INSERT INTO repository_visibility VALUES(1,'public',1,'owner')");
    this.ctx.storage.sql.exec("CREATE TABLE public_community_policy(id INTEGER PRIMARY KEY,doc TEXT);INSERT INTO public_community_policy VALUES(1,?)",JSON.stringify({enabled:true,scopes:["issues","contribution-requests"]}));
    this.ctx.storage.sql.exec("INSERT INTO members VALUES('scoped-user','member','Scoped user','now')");
  }
}
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const key=await accountKeyFor("scoped-user");
  const account=env.REPOSITORY_CONTROLLER.getByName(`account:${key}`) as unknown as ScopedAccountFixture;
  const path=new URL(request.url).pathname;
  if(path==="/fixture") {
    for(const id of["abcdef123456","abcdef123457"])await(env.REPOSITORY_CONTROLLER.getByName(`project:${id}`) as unknown as ScopedAccountFixture).seedPublic(id);
    const tokens:Record<string,string>={};
    for(const [label,character,scope] of[["pinned","x","full"],["read","y","read"],["full","z","full"]] as const){const token=`fgt_${key}_${character.repeat(32)}`;await account.createApiToken("scoped-user",label,token,{scope,repo:label==="full"?undefined:"abcdef123456"});tokens[label]=token;}
    return Response.json(tokens);
  }
  if(path==="/deleting"){await account.beginAccountDeletion();return Response.json({status:await account.accountLifecycle()});}
  if(path==="/deleted"){await account.finishAccountDeletion();return Response.json({status:await account.accountLifecycle()});}
  if(path==="/residual-role")return Response.json(await(env.REPOSITORY_CONTROLLER.getByName("project:abcdef123456") as unknown as ScopedAccountFixture).roleOf("scoped-user"));
  if(path==="/pending-registry"){
    await account.addProject({id:"abcdef123457",name:"Pending registration",role:"member",kind:"demo"});
    await(env.REPOSITORY_CONTROLLER.getByName("project:abcdef123457") as unknown as ScopedAccountFixture).cancelContributorRegistration("scoped-user");
    return Response.json({ready:true});
  }
  if(path==="/registry")return Response.json(await account.listProjects());
  return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})}},ctx);
}};
