import {RepositoryController} from "../../src/server/durable-object.js";
import {rebaseAcceptedFollowup,mirrorAcceptedFollowup} from "../../src/server/accepted-followups.js";
import {admitNativeCompute} from "../../src/server/native-compute.js";
import {assertManagedInitiator,accountKeyFor} from "../../src/server/projects.js";
import type {Env} from "../../src/server/env.js";
import type {FlareGitProjectState} from "../../src/core/types.js";
const base="a".repeat(40),landed="b".repeat(40),tip="c".repeat(40);
export class AcceptedFollowupFixture extends RepositoryController {
 async seed(){
  // Synthetic verifier/publication inputs; completion uses the production SQLite transition.
  const state={projectId:"p123456789abc",projectName:"Followups",canonicalRepoName:"flaregit-p123456789abc",policyVersion:1,verificationPolicy:{},decisions:{},evidence:{proof:{status:"passed"}},acceptedState:{currentCommit:base,activeRequirements:[],history:[]},tasks:{task:{id:"task",status:"verifying",currentCommit:tip,activeCandidateId:"candidate",requirements:[],checkpoints:[],workspace:{repoName:"preserved-task-fork"}},child:{id:"child",status:"working",currentCommit:"d".repeat(40),baseCommit:tip,dependsOn:"task",workspace:{repoName:"preserved-child-fork"}}},candidates:{candidate:{id:"candidate",status:"verified",participatingTaskIds:["task"],participatingCommits:{task:tip},evidenceId:"proof",frozenPolicyVersion:1,frozenRequirements:[]}},journal:[{id:"journal",candidateId:"candidate",state:"PREPARED",expectedHead:base,newHead:landed,outputDigest:"digest",candidateTree:"e".repeat(40)}]} as unknown as FlareGitProjectState;
  this.ctx.storage.sql.exec("INSERT INTO project VALUES(1,?)",JSON.stringify(state));
  this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS integration_dispatch_receipts(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,actor_id TEXT,outcome TEXT,terminal INTEGER NOT NULL DEFAULT 0)");
  this.ctx.storage.sql.exec("INSERT INTO integration_dispatch_receipts VALUES('followup-workflow','[]','contributor','started',0)");
  await this.addMember("contributor","member","Contributor");await this.registerWorkflow("followup-workflow","integration",undefined,"contributor");
 }
 async mirrorReceipts(){return this.ctx.storage.sql.exec("SELECT status FROM mirror_runs ORDER BY at DESC").toArray();}
 async breakMirrorLookup(){this.ctx.storage.sql.exec("DROP TABLE mirror");}
 async receipt(){return this.ctx.storage.sql.exec("SELECT outcome,terminal FROM integration_dispatch_receipts WHERE event_id='followup-workflow'").one();}
}
export default{async fetch(request:Request,env:Env){
 const mode=new URL(request.url).searchParams.get("mode")!,repo=env.REPOSITORY_CONTROLLER.getByName(`project:${mode}`) as unknown as AcceptedFollowupFixture;
 try{
  await repo.seed();await repo.completePublish("journal");await repo.recordIntegrationDispatchOutcome("followup-workflow","accepted");
  const before=await repo.getState();
  const operation=async()=>{
   if(mode==="budget")await admitNativeCompute(env,await accountKeyFor("contributor"),"followup-native");
   else if(mode==="owner-revoked"){await repo.removeMember("contributor");await assertManagedInitiator(env,repo,"followup-workflow",await accountKeyFor("contributor"));}
   else{await repo.breakMirrorLookup();await repo.mirrorSecret();}
   throw new Error("Failure fixture incorrectly continued");
  };
  const result=mode==="mirror-lookup"?await mirrorAcceptedFollowup(repo,landed,operation):await rebaseAcceptedFollowup(repo,landed,operation);
  return Response.json({result,before,after:await repo.getState(),receipt:await repo.receipt(),activities:await repo.listActivity(20),mirror:await repo.mirrorReceipts()});
 }catch{return new Response("Native followup fixture failed",{status:500});}
}};
