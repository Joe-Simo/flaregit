import {PrivateRecoveryOperations} from "../../src/server/private-recovery";
import {RetainedInputs} from "../../src/server/retained-inputs";
import {VERIFIER_IDENTITIES} from "../../src/core/verification-identities";
import worker from "../../src/server/worker";
import {RepositoryController} from "../../src/server/durable-object";
import {accountKeyFor} from "../../src/server/projects";
import type {Env} from "../../src/server/env";
import type {FlareGitProjectState} from "../../src/core/types";
const projectId="p123456789abc",commit="a".repeat(40);
const deliveries:unknown[]=[];let queueFailure=false;
export class ReviewAuthorityFixture extends RepositoryController {
 async arm(hook:"profile"|"lifecycle",effect:"demote"|"seal"|"delete"|"revoke",after:number){await this.ctx.storage.put({hook,effect,after,calls:0});}
 private async fixtureHook(hook:string){if(await this.ctx.storage.get("hook")!==hook)return;const count=Number(await this.ctx.storage.get("calls")??0)+1;await this.ctx.storage.put("calls",count);if(count!==await this.ctx.storage.get("after"))return;await this.ctx.storage.delete("hook");const repo=this.env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as ReviewAuthorityFixture;const effect=await this.ctx.storage.get("effect");if(effect==="demote")await repo.addMember("owner","member");else if(effect==="delete")await repo.beginRepositoryDeletion();else if(effect==="revoke"){const id=await this.ctx.storage.get<string>("fullTokenId");if(!id)throw new Error("Missing synthetic token");await this.revokeApiToken(id);}else await this.beginAccountDeletion();}
 override async getProfile(){await this.fixtureHook("profile");return super.getProfile();}
 override async accountLifecycle(){await this.fixtureHook("lifecycle");return super.accountLifecycle();}
 async keepFullTokenId(id:string){await this.ctx.storage.put("fullTokenId",id);}
 restoreLifecycle(){this.ctx.storage.sql.exec("UPDATE account_lifecycle SET status='active' WHERE id=1");}
 async seed(){await this.initialize({projectId,projectName:"Synthetic owner decision fixture",canonicalRepoName:"synthetic",head:"b".repeat(40),verificationPolicy:{},ownerId:"owner"});await this.addMember("member","member");const state=await this.getState();
 for(const id of ["candidate-session","candidate-token","candidate-race"]){state.candidates[id]={id,attemptNumber:1,preservationProtocolVersion:1,participatingTaskIds:[`input-${id}`],participatingCommits:{[`input-${id}`]:commit},frozenContributorProofs:[{id:`input-${id}`,commit,baseCommit:"b".repeat(40),ref:`refs/flaregit/tasks/input-${id}`,allowedScope:[]}],expectedAcceptedBase:"b".repeat(40),frozenPolicyVersion:1,frozenVerificationPolicy:{},frozenRequirements:[],repairAttempts:[],candidateCommit:commit,status:"awaiting_review",evidenceId:"proof",workflowInstanceId:`synthetic-${id}`,createdAt:"2026-10-03",updatedAt:"2026-10-03"};}
 const incarnation=new PrivateRecoveryOperations(this.ctx.storage).incarnation();
 for(const id of ["candidate-session","candidate-token","candidate-race"]){const taskId=`input-${id}`;state.tasks[taskId]={id:taskId,goal:"Synthetic preserved contribution",contributor:{id:"member",name:"Synthetic member",type:"human"},baseCommit:"b".repeat(40),currentCommit:commit,status:"ready",allowedScope:[],requirements:[],workspace:{repoName:"synthetic-workspace",remote:"https://fixture.invalid",branch:`task/${taskId}`},checkpoints:[],createdAt:"2026-10-03",updatedAt:"2026-10-03"};new RetainedInputs(this.ctx.storage).record({id:crypto.randomUUID(),version:1,projectId,incarnation,taskId,commit,base:"b".repeat(40),canonicalRepoName:"synthetic",workspaceRepoName:"synthetic-workspace",branch:`task/${taskId}`,protectedRef:`refs/flaregit/inputs/${incarnation}/${taskId}/${commit}`,protectedBaseRef:`refs/flaregit/inputs/${incarnation}/${taskId}/${"b".repeat(40)}`,workflowId:`synthetic-${id}`,candidateId:id,actorId:"member",ownerId:"owner",accountKey:await accountKeyFor("owner")},{commit,base:"b".repeat(40)});}
 for(const id of ["decision-session","decision-token","decision-race"]){state.decisions[id]={id,question:"Synthetic policy choice",explanation:"Local native fixture only",conflictingRequirementIds:["one","two"],options:[{id:"one",label:"One",description:"One",concreteExample:"One"},{id:"two",label:"Two",description:"Two",concreteExample:"Two"}],status:"pending",createdAt:"2026-10-03"};}
 state.tasks["policy-task"]={id:"policy-task",goal:"Synthetic policy conflict",contributor:{id:"fixture",name:"Fixture",type:"human"},baseCommit:"b".repeat(40),currentCommit:"b".repeat(40),allowedScope:[],status:"needs_decision",requirements:["one","two"].map(id=>({id,title:id,description:id,version:1,status:"approved" as const,assertions:[],originTaskId:"policy-task",approvedAt:"2026-10-03",policyPatch:id==="one"?{test:"synthetic"}:undefined})),workspace:{repoName:"synthetic",remote:"https://fixture.invalid",branch:"task/policy-task"},checkpoints:[],createdAt:"2026-10-03",updatedAt:"2026-10-03"};
 state.evidence.proof={id:"proof",candidateCommit:commit,candidateTree:"c".repeat(40),status:"passed",expectedAcceptedBase:"b".repeat(40),requirementsVersion:1,verifierIdentity:VERIFIER_IDENTITIES["ticket-booking"],builtOutputDigest:"synthetic-digest"} as FlareGitProjectState["evidence"][string];this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));
 }
 async fixtureComplete(){const journal=(await this.getState()).journal.find(item=>item.candidateId==="candidate-session");if(!journal)throw new Error("Missing synthetic prepared journal");await this.completePublish(journal.id);}
 async fixtureLegacy(){const state=await this.getState();const candidate=state.candidates["candidate-race"]!;candidate.status="verified";candidate.review={approved:true,by:"Unknown legacy display",at:"2026-10-03",commit};this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));return this.preparePublish("candidate-race");}
 replaceLegacyFixture(state:FlareGitProjectState){this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));}
 stateSnapshot(){return this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM project WHERE id=1").one().doc;}
}
interface FixtureEnv{REPOSITORY_CONTROLLER:DurableObjectNamespace<ReviewAuthorityFixture>;FIXTURE_ISSUER:string}
export default {async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){const url=new URL(request.url),repo=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`),account=env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("owner")}`);
 if(url.pathname==="/fixture/bootstrap"){await repo.seed();await account.setProfile({handle:"owner",displayName:"Original owner",bio:"",joinedAt:"2026-10-03"});const key=await accountKeyFor("owner"),tokens:{full?:string;write?:string}={};for(const scope of ["full","write"] as const){const token=`fgt_${key}_${scope==="full"?"f":"w"}`+"x".repeat(31);const created=await account.createApiToken("owner",scope,token,{scope});if(scope==="full")await account.keepFullTokenId(created.id);tokens[scope]=token;}return Response.json(tokens);}
 if(url.pathname==="/fixture/state")return new Response(await repo.stateSnapshot(),{headers:{"Content-Type":"application/json"}});
 if(url.pathname==="/fixture/queue-fail"){queueFailure=true;return new Response("ok");}
 if(url.pathname==="/fixture/prepare")return Response.json(await repo.preparePublish("candidate-session"));
 if(url.pathname==="/fixture/authorize")return Response.json(await repo.authorizeCandidatePublication("candidate-session",commit));
 if(url.pathname==="/fixture/demote"){await repo.addMember("owner","member");return new Response("ok");}
 if(url.pathname==="/fixture/complete"){await repo.fixtureComplete();return new Response("ok");}
 if(url.pathname==="/fixture/legacy-approval")return Response.json(await repo.fixtureLegacy());
 if(url.pathname==="/fixture/events")return Response.json(deliveries);
 if(url.pathname==="/fixture/rename"){await account.setProfile({handle:"owner",displayName:"Changed owner",bio:"",joinedAt:"2026-10-03"});return new Response("ok");}
 if(url.pathname==="/fixture/restore-full-token"){const key=await accountKeyFor("owner"),token=`fgt_${key}_f`+"x".repeat(31);const created=await account.createApiToken("owner","synthetic restored full token",token,{scope:"full"});await account.keepFullTokenId(created.id);return new Response("ok");}
 if(url.pathname==="/fixture/restore-account"){await account.restoreLifecycle();return new Response("ok");}
 if(url.pathname==="/fixture/restore"){await repo.addMember("owner","owner");return new Response("ok");}
 if(url.pathname==="/fixture/arm"){await account.arm(url.searchParams.get("hook") as "profile"|"lifecycle",url.searchParams.get("effect") as "demote"|"seal"|"delete"|"revoke",Number(url.searchParams.get("after")??1));return new Response("ok");}
 return worker.fetch(request,{REPOSITORY_CONTROLLER:env.REPOSITORY_CONTROLLER,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:"https://fixture.example",INTEGRATION_WORKFLOW:{get:async()=>({sendEvent:async(event:unknown)=>{deliveries.push(event);}})},INTEGRATION_QUEUE:{send:async(event:unknown)=>{deliveries.push(event);if(queueFailure){queueFailure=false;throw new Error("Synthetic lost queue acknowledgment");}}}} as unknown as Env,ctx);
}};
