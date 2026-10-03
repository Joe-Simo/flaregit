import {RepositoryController} from "../../src/server/durable-object";
import {RetainedInputs} from "../../src/server/retained-inputs";
import {PrivateRecoveryOperations} from "../../src/server/private-recovery";
import {accountKeyFor} from "../../src/server/projects";
import {VERIFIER_IDENTITIES} from "../../src/core/verification-identities";
import type {CandidateGeneration,FlareGitProjectState,Task} from "../../src/core/types";
import type {Env} from "../../src/server/env";
const base="a".repeat(40),original="b".repeat(40),commit="c".repeat(40),actor={userId:"owner",displayName:"Owner",viaToken:false};
export class CandidatePreservationFixture extends RepositoryController {
 async seed(mode:string){
  await this.initialize({projectId:"p123456789abc",projectName:"Synthetic preservation fixture",canonicalRepoName:"canonical",head:base,ownerId:"owner",verificationPolicy:{}});
  const state=await this.getState();
  const task:Task={id:"task-one",goal:"Synthetic input",contributor:{id:"owner",name:"Owner",type:"human"},baseCommit:base,currentCommit:original,status:"ready",allowedScope:["*"],requirements:[],workspace:{repoName:"workspace",remote:"https://fixture.invalid",branch:"work"},checkpoints:[],createdAt:"now",updatedAt:"now"};
  state.tasks[task.id]=task;
  const candidate:CandidateGeneration={id:"candidate",attemptNumber:1,participatingTaskIds:[task.id],participatingCommits:{[task.id]:original},expectedAcceptedBase:base,frozenPolicyVersion:1,frozenVerificationPolicy:{},frozenRequirements:[],frozenContributorProofs:[{id:task.id,commit:original,baseCommit:base,ref:`refs/flaregit/tasks/${task.id}`,allowedScope:["*"]}],repairAttempts:[],candidateCommit:commit,status:"awaiting_review",evidenceId:"proof",workflowInstanceId:"workflow",createdAt:"now",updatedAt:"now",...(mode!=="legacy"?{preservationProtocolVersion:1 as const}:{})};
  state.candidates.candidate=candidate;
  state.evidence.proof={id:"proof",candidateCommit:commit,candidateTree:"d".repeat(40),status:"passed",expectedAcceptedBase:base,requirementsVersion:1,verifierIdentity:VERIFIER_IDENTITIES["ticket-booking"],builtOutputDigest:"synthetic"} as FlareGitProjectState["evidence"][string];
  this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));
  if(["current","wrong-scope"].includes(mode)){
   const incarnation=new PrivateRecoveryOperations(this.ctx.storage).incarnation();
   // Test-only synthetic provider proof. Production records this only after exact native Git readback.
   new RetainedInputs(this.ctx.storage).record({id:crypto.randomUUID(),projectId:mode==="wrong-scope"?"other":state.projectId,incarnation,taskId:task.id,commit:original,base,canonicalRepoName:state.canonicalRepoName,workspaceRepoName:"workspace",branch:"work",workflowId:"workflow",candidateId:candidate.id,actorId:"owner",ownerId:"owner",accountKey:await accountKeyFor("owner"),protectedRef:`refs/flaregit/inputs/${incarnation}/${task.id}/${original}`,protectedBaseRef:`refs/flaregit/inputs/${incarnation}/${task.id}/${base}`,version:1},{commit:original,base});
  }
 }
 async syntheticApproved(){const state=await this.getState();state.candidates.candidate!.review={approved:true,actor,by:"Owner",at:"now",commit};state.candidates.candidate!.status="verified";this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));}
 async legacyPrepared(){const state=await this.getState();state.candidates.candidate!.review={approved:true,actor,by:"Owner",at:"now",commit};state.journal.push({id:"legacy-journal",candidateId:"candidate",candidateCommit:commit,candidateTree:"d".repeat(40),expectedHead:base,newHead:commit,outputDigest:"synthetic",state:"PREPARED",timestamp:"now"});this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));}
}
export default {async fetch(request:Request,env:Env){const mode=new URL(request.url).searchParams.get("mode")!,repo=env.REPOSITORY_CONTROLLER.getByName(`project:${mode}`) as unknown as CandidatePreservationFixture;await repo.seed(mode);if(mode==="accepted"){await repo.legacyPrepared();await repo.completePublish("legacy-journal");await repo.completePublish("legacy-journal");return Response.json(await repo.getState());}
 if(mode==="claims"){const legacy=await repo.claimLanding({holder:"legacy",taskIds:["task-one"]});const current=await repo.claimLanding({holder:"new",taskIds:["task-one"],preservationProtocolVersion:1});return Response.json({legacy,current});}
 const before=await repo.getState(),review=await repo.recordReview("candidate",{approved:true,actor},commit);const after=await repo.getState();await repo.syntheticApproved();const prepared=await repo.preparePublish("candidate"),authorized=await repo.authorizeCandidatePublication("candidate",commit);return Response.json({before,review,after,prepared,authorized});}};
