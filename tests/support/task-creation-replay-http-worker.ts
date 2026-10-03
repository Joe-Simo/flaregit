import worker from "../../src/server/worker";
import {RepositoryController} from "../../src/server/durable-object";
import {accountKeyFor} from "../../src/server/projects";
import type {Task} from "../../src/core/types";
import type {Env} from "../../src/server/env";
const projectId="p123456789abc",actor="creator-abcdefghijkl",collision="different-abcdefghijkl";
const providerCalls:string[]=[];
export class TaskReplayFixture extends RepositoryController {
 async armDemotion(after:number){await this.ctx.storage.put("demoteAfter",after);await this.ctx.storage.put("lifecycleCalls",0);}
 override async accountLifecycle():Promise<"active"|"deleting"|"deleted">{
  const after=await this.ctx.storage.get<number>("demoteAfter");
  if(after){const count=(await this.ctx.storage.get<number>("lifecycleCalls")??0)+1;await this.ctx.storage.put("lifecycleCalls",count);if(count===after){await this.ctx.storage.delete("demoteAfter");await (this.env.REPOSITORY_CONTROLLER as unknown as DurableObjectNamespace<TaskReplayFixture>).getByName(`project:${projectId}`).removeMember(actor);}}
  return super.accountLifecycle();
 }
 async attemptFreshCreation(){const old=(await this.getState()).tasks.working!;try{await this.createTask({...old,id:"raced-new",workspace:{...old.workspace,branch:"task/raced-new"}},actor,{goal:old.goal,dependsOn:null,issue:null});return {created:true};}catch{return {created:false};}}
 async seed(){
  await this.initialize({projectId,projectName:"Replay fixture",canonicalRepoName:"fixture-canonical",head:"a".repeat(40),tree:"b".repeat(40),verificationPolicy:{},ownerId:"owner"});
  await this.addMember(actor,"member");await this.addMember(collision,"member");
  for(const [id,status] of [["working","working"],["accepted","accepted"],["cancelled","cancelled"],["legacy","working"]] as const){
   const task:Task={id,goal:"Preserve saved work",contributor:{id:actor.slice(-12),name:"Creator",type:"human"},baseCommit:"a".repeat(40),currentCommit:"a".repeat(40),allowedScope:[],status,requirements:[],workspace:{repoName:`fixture-${id}`,remote:"https://private.invalid",branch:`task/${id}`},checkpoints:[],createdAt:"2026-10-03T00:00:00Z",updatedAt:"2026-10-03T00:00:00Z",agentRunId:`run-${id}`};
   await this.createTask(task,actor,id==="legacy"?undefined:{goal:task.goal,dependsOn:null,issue:null});
  }
  // Materialize every Git table before read-only snapshots.
  await this.canGitAccess(actor,"working",true);
 }
 snapshot(){const result:Record<string,unknown>={};for(const {name} of this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").toArray())result[name]=this.ctx.storage.sql.exec(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).toArray();return result;}
}
interface FixtureEnv{REPOSITORY_CONTROLLER:DurableObjectNamespace<TaskReplayFixture>;FIXTURE_ISSUER:string}
export default {async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){
 const url=new URL(request.url),repo=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`);
 if(url.pathname==="/fixture/bootstrap"){try{await repo.seed();return Response.json({actor,collision});}catch(error){return new Response(error instanceof Error?error.stack:String(error),{status:500});}}
 if(url.pathname==="/fixture/snapshot")return Response.json(await repo.snapshot());
 if(url.pathname==="/fixture/provider-calls")return Response.json(providerCalls);
 if(url.pathname==="/fixture/restore"){await repo.addMember(actor,"member");return new Response("ok");}
 if(url.pathname==="/fixture/arm-demotion"){await env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor(actor)}`).armDemotion(Number(url.searchParams.get("after")));return new Response("ok");}
 if(url.pathname==="/fixture/direct-create")return Response.json(await repo.attemptFreshCreation());
 if(url.pathname==="/fixture/seal-account"){await env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor(actor)}`).beginAccountDeletion();return new Response("ok");}
 if(url.pathname==="/fixture/revoke"){await repo.removeMember(actor);return new Response("ok");}
 const deny=(name:string)=>()=>{providerCalls.push(name);throw new Error(`Replay unexpectedly invoked ${name}`);};
 return worker.fetch(request,{REPOSITORY_CONTROLLER:env.REPOSITORY_CONTROLLER,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:"https://fixture.example",ARTIFACTS:{get:deny("artifact.get"),fork:deny("artifact.fork"),create:deny("artifact.create")},INTEGRATOR:{getByName:deny("integrator")},AGENT:{getByName:deny("agent")}} as unknown as Env,ctx);
}};
