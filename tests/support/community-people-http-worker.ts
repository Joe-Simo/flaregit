import worker from "../../src/server/worker";
import {PeopleFixture as BasePeopleFixture} from "./community-people-worker";
import {accountKeyFor} from "../../src/server/projects";
import type {Env} from "../../src/server/env";
export class PeopleFixture extends BasePeopleFixture {
 async armDetailWithdraw(){await this.ctx.storage.put("detailWithdraw",true);}
 override async followingRecord(key:string){if(await this.ctx.storage.get("detailWithdraw")){await this.ctx.storage.delete("detailWithdraw");const target=this.env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("human")}`) as unknown as PeopleFixture;await target.setPublicProfileVisibility("private",false,"human");}return super.followingRecord(key);}
 async armProfileWithdraw(){await this.ctx.storage.put({profileWithdrawAt:3,acceptedReads:0});}
 async armUnfollow(){await this.ctx.storage.put({unfollowAt:3,acceptedReads:0});}
 override async publicAcceptedActivity(userId:string){const snapshot=await super.publicAcceptedActivity(userId);if(await this.ctx.storage.get("unfollowAt")||await this.ctx.storage.get("profileWithdrawAt")){const count=Number(await this.ctx.storage.get("acceptedReads")??0)+1;await this.ctx.storage.put("acceptedReads",count);if(count===3){if(await this.ctx.storage.get("profileWithdrawAt")){await this.ctx.storage.delete("profileWithdrawAt");const target=this.env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("human")}`) as unknown as PeopleFixture;await target.setPublicProfileVisibility("private",false,"human");return snapshot;}await this.ctx.storage.delete("unfollowAt");const viewer=this.env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("viewer")}`) as unknown as PeopleFixture;const saved=await viewer.followingForHandle("ada");if(saved)await viewer.setFollowing({accountKey:saved.targetAccount,ownerId:saved.targetOwner,handle:saved.handle},{following:false,expectedVersion:saved.version,idempotencyKey:crypto.randomUUID()});}}return snapshot;}
}
interface FixtureEnv {REPOSITORY_CONTROLLER:DurableObjectNamespace<PeopleFixture>;FIXTURE_ISSUER:string}
let limited=false;
export default {async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){const url=new URL(request.url),get=(name:string)=>env.REPOSITORY_CONTROLLER.getByName(name);
 if(url.pathname==="/fixture/seed"){await get("project:p123456abcdef").seed();const key=await accountKeyFor("human"),account=get(`account:${key}`),global=get("global");await account.setProfile({handle:"ada",displayName:"Ada",bio:"Explicit synthetic public profile",joinedAt:"2026-10-03"},0);await account.setPublicProfileVisibility("public",true,"human",1);await global.claimHandle("ada",key);await global.commitHandle("ada",key);await account.addProject({id:"p123456abcdef",name:"Synthetic",role:"member",kind:"empty"});const viewerKey=await accountKeyFor("viewer"),token=`fgt_${viewerKey}_`+"x".repeat(32);await get(`account:${viewerKey}`).createApiToken("viewer","Synthetic full token",token,{scope:"full"});return Response.json({token});}
 if(url.pathname==="/fixture/withdraw-profile-at-final-snapshot"){await get("project:p123456abcdef").armProfileWithdraw();return new Response("ok");}
 if(url.pathname==="/fixture/republish"){const account=get(`account:${await accountKeyFor("human")}`),profile=await account.publicProfileState();await account.setPublicProfileVisibility("public",true,"human",profile.version);const state=await account.peopleSnapshot();await account.configureDiscovery({enabled:true,confirmed:true,expectedVersion:state.discovery.version},"human");return new Response("ok");}
 if(url.pathname==="/fixture/withdraw-on-follow-read"){await get(`account:${await accountKeyFor("viewer")}`).armDetailWithdraw();return new Response("ok");}
 if(url.pathname==="/fixture/unfollow-at-final-snapshot"){await get("project:p123456abcdef").armUnfollow();return new Response("ok");}
 if(url.pathname==="/fixture/withdraw-profile"){await get(`account:${await accountKeyFor("human")}`).setPublicProfileVisibility("private",false,"human");return new Response("ok");}
 if(url.pathname==="/fixture/rate"){limited=url.searchParams.get("enabled")==="true";return new Response("ok");}
 return worker.fetch(request,{REPOSITORY_CONTROLLER:env.REPOSITORY_CONTROLLER,API_LIMITER:{limit:async()=>({success:!limited})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:"https://fixture.example"} as unknown as Env,ctx);
}};
