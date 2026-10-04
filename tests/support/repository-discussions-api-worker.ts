import worker from "../../src/server/worker";
import {RepositoryController,type PublicGrantMetadata} from "../../src/server/durable-object";
import {accountKeyFor} from "../../src/server/projects";
import type{Env}from"../../src/server/env";
import type{PublicCommunityActor}from"../../src/server/public-community";
export class DiscussionApiRepository extends RepositoryController{
 async bootstrap(){await this.initialize({projectId:"pabcdef123456",projectName:"Owned discussion fixture",canonicalRepoName:"fixture",head:"a".repeat(40),verificationPolicy:{kind:"command",test:"bun test"},ownerId:"discussion-owner"});await this.addMember("discussion-member","member");}
 async prepare(publicEnabled:boolean,privateEnabled:boolean){const actor={userId:"discussion-owner",accountKey:await accountKeyFor("discussion-owner"),displayName:"Maintainer"};await this.setRepositoryVisibility("public",true,actor.userId);await this.configurePublicCommunity({enabled:publicEnabled,scopes:publicEnabled?["discussions"]:[]},true,actor);await this.discussionSettings(actor,{enabled:privateEnabled,confirmed:true});}
 async race(mode:string){await this.ctx.storage.put("fixture_race",mode);}
 override async discussionList(publicOnly:boolean,actor?:PublicCommunityActor){const value=await super.discussionList(publicOnly,actor);const mode=await this.ctx.storage.get<string>("fixture_race");if(publicOnly&&mode){await this.ctx.storage.delete("fixture_race");if(mode==="version")await this.setRepositoryVisibility("private",false,"discussion-owner");else{const state=await this.getState();state.acceptedState.currentCommit="b".repeat(40);this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));}}return value;}
 override async publicGrant():Promise<PublicGrantMetadata|null>{return super.publicGrant();}
}
interface FixtureEnv{TEST:DurableObjectNamespace<DiscussionApiRepository>}
export default{async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){const url=new URL(request.url),repo=env.TEST.getByName("project:pabcdef123456");
 if(url.pathname==="/fixture/bootstrap"){await repo.bootstrap();const tokens:Record<string,string>={};for(const[userId,displayName]of [["discussion-owner","Verified maintainer"],["discussion-member","Verified member"],["discussion-outsider","Verified outsider"]]){const key=await accountKeyFor(userId!),account=env.TEST.getByName(`account:${key}`);await account.setProfile({handle:userId!,displayName:displayName!,bio:"",joinedAt:new Date().toISOString()});for(const[scope,secret,pinned]of [["full","x",false],["read","y",false],["write","z",false],["full","w",true]] as const){const token=`fgt_${key}_${secret.repeat(32)}`;await account.createApiToken(userId!,"discussion fixture",token,{scope,...(pinned?{repo:"pabcdef123456"}:{})});tokens[`${userId}-${scope}${pinned?"-pinned":""}`]=token;}}return Response.json(tokens);}
 if(url.pathname==="/fixture/prepare"){await repo.prepare(url.searchParams.get("public")!=="false",url.searchParams.get("private")!=="false");return Response.json({ready:true});}
 if(url.pathname==="/fixture/race"){await repo.race(url.searchParams.get("mode")??"version");return Response.json({ready:true});}
 return worker.fetch(request,{REPOSITORY_CONTROLLER:env.TEST,API_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
}};
