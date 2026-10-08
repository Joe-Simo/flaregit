import { handleGitGateway } from "../../src/server/git-gateway-handler";
import { accountKeyFor } from "../../src/server/projects";
import type { Env } from "../../src/server/env";
import { RepositoryController } from "../../src/server/durable-object";
import type { FlareGitProjectState, Task } from "../../src/core/types";
export class GitFixture extends RepositoryController {
  seed(){const state={projectId:"p123456789abc",projectName:"Fixture",canonicalRepoName:"repo",acceptedState:{currentCommit:"a".repeat(40),history:[],activeRequirements:[],buildDigest:"",acceptedAt:"now"},tasks:{},candidates:{},decisions:{},evidence:{},journal:[],policyVersion:1,verificationPolicy:{}} satisfies FlareGitProjectState;this.ctx.storage.sql.exec("INSERT INTO project(id,doc) VALUES(1,?)",JSON.stringify(state));}
}
export default {async fetch(request:Request,env:{TEST:DurableObjectNamespace<GitFixture>;REPOSITORY_CONTROLLER:DurableObjectNamespace<GitFixture>}){const url=new URL(request.url),stub=env.TEST.getByName(url.searchParams.get("repo")??"one");try{
  if(url.pathname.startsWith("/git/"))return handleGitGateway(request,{...env,API_LIMITER:{limit:async()=>({success:true})},ARTIFACTS:{get:async()=>({info:async()=>({remote:"https://"+"a".repeat(32)+".artifacts.cloudflare.net/git/test/repo.git"}),createToken:async()=>{const revoke=request.headers.get("X-Fixture-Revoke-On-Mint");if(revoke)await env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("author-full-user")}`).revokeApiToken(revoke);return{plaintext:"fixture-provider-secret"};},revokeToken:async()=>true,[Symbol.dispose]:()=>{}})}} as unknown as Env,async()=>({finish:async()=>{}}));
  if(url.pathname==="/handler-setup"){
    const repo=env.REPOSITORY_CONTROLLER.getByName("project:p123456789abc");await repo.seed();await repo.addMember("author-full-user","owner");
    const key=await accountKeyFor("author-full-user"),account=env.REPOSITORY_CONTROLLER.getByName(`account:${key}`),token=`fgt_${key}_${"x".repeat(32)}`;const issued=await account.createApiToken("author-full-user","fixture",token,{scope:"read",repo:"p123456789abc"});const personal=`fgt_${key}_${"z".repeat(32)}`,parent=`fgt_${key}_${"w".repeat(32)}`;const personalId=(await account.createApiToken("author-full-user","personal revocation",personal,{scope:"read",repo:"p123456789abc"})).id,parentId=(await account.createApiToken("author-full-user","capability parent",parent,{scope:"read",repo:"p123456789abc"})).id;
    const parentHash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(parent)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");const capability=await repo.mintGitCapability("author-full-user",null,false,parentHash);return Response.json({token,apiTokenId:issued.id,personal,personalId,capability:capability.token,parentId});
  }
  if(url.pathname==="/handler-delete"){await env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("author-full-user")}`).beginAccountDeletion();return Response.json({ok:true});}
  if(url.pathname==="/seed"){await stub.seed();await stub.addMember("owner","owner");await stub.addMember("author-full-user","member");await stub.addMember("another-full-user","member");}
  if(url.pathname==="/task"){const task={id:"task-one",goal:"Purpose",contributor:{id:"truncated",name:"Author",type:"human"},baseCommit:"a".repeat(40),currentCommit:"a".repeat(40),allowedScope:[],requirements:[],status:"working",workspace:{repoName:"workspace",remote:"https://provider.test/repo.git",branch:"task/task-one"},checkpoints:[],createdAt:"now",updatedAt:"now"} satisfies Task;await stub.createTask(task,url.searchParams.get("legacy")==="true"?undefined:"author-full-user");}
  if(url.pathname==="/fork-permission")return Response.json(await stub.taskForkPermissionUpdate("task-one",url.searchParams.get("user")!,{enabled:url.searchParams.get("enabled")==="true",expectedRevision:Number(url.searchParams.get("revision")??0)},{viaToken:false,sessionExpiresAt:Date.now()+60000}));
  if(url.pathname==="/can")return Response.json(await stub.canGitAccess(url.searchParams.get("user")!,url.searchParams.get("task"),url.searchParams.get("write")==="true"));
  if(url.pathname==="/mint")return Response.json(await stub.mintGitCapability(url.searchParams.get("user")!,url.searchParams.get("task"),url.searchParams.get("write")==="true"));
  if(url.pathname==="/verify")return Response.json(await stub.verifyGitCapability(await request.text(),url.searchParams.get("task"),url.searchParams.get("write")==="true"));
  if(url.pathname==="/revoke")await stub.revokeGitCapabilities(url.searchParams.get("user")!);
  if(url.pathname==="/remove")await stub.removeMember(url.searchParams.get("user")!);
  if(url.pathname==="/cancel")await stub.cancelTask("task-one");
  return Response.json({ok:true});
}catch{return Response.json({error:"Denied"},{status:403});}}};
