import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGitArtifactsClient } from "../src/artifacts/local-git";
import { FlareGitRepositoryController } from "../src/core/controller";
import { GIT_INTEGRITY_POLICY } from "../src/core/command-policy";
import { git, gitOrThrow } from "../src/core/pipeline/git";
import type { ControllerDeps } from "../src/core/controller";
import type { UnbornAcceptedTarget } from "../src/core/accepted-target";
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"flaregit-controller-root-")),artifacts=new LocalGitArtifactsClient(join(directory,"artifacts")),canonical=await artifacts.create("canonical");
 const policy={...GIT_INTEGRITY_POLICY};
 const target:UnbornAcceptedTarget={kind:"unborn",projectId:"root-project",incarnation:crypto.randomUUID(),canonicalRepoName:"canonical",branch:"main",ref:"refs/heads/main",acceptedCommit:null,acceptedVersion:0,requirements:[],policyVersion:1,policy};
 const deps:ControllerDeps={artifacts,storageDir:join(directory,"state"),unbornTarget:target,verifier:{identity:"flaregit-native-integrity-v1",protectedPaths:[".flaregit/"],defaultPolicy:policy,verify:async()=>{throw Error("Root verification must inspect actual native Git");}},repairModel:async()=>{throw Error("No concealed initial conflict repair");}};
 const controller=new FlareGitRepositoryController(deps,{projectId:target.projectId,projectName:"Empty native repository",canonicalRepoName:"canonical",acceptedState:{kind:"unborn",currentCommit:null,acceptedAt:null,buildDigest:null,activeRequirements:[],history:[]},tasks:{},candidates:{},evidence:{},decisions:{},journal:[],policyVersion:1,verificationPolicy:policy,kind:"empty"});
 const task=async(id:string,file:string,content:string)=>{const contribution=await controller.createTask({taskId:id,goal:`Create ${file}`,contributorName:id,contributorType:"human"});expect(contribution.currentCommit).toBeNull();await Bun.write(join(contribution.workspace.localPath!,file),content);const checkpoint=controller.recordTaskCheckpoint({taskId:id,isReadyForIntegration:true,message:`Initial ${file}`});if(checkpoint.currentCommit===null)throw Error("Native checkpoint did not produce a commit");return {...checkpoint,currentCommit:checkpoint.currentCommit};};
 return{directory,canonical,controller,deps,task};
}
test("parallel genuine first commits require exact review and only one wins missing-ref CAS",async()=>{
 const f=await fixture();try{
  expect(git(f.canonical.remote,["for-each-ref"],{gitDir:true}).stdout).toBe("");
  const [a,b]=await Promise.all([f.task("alice","README.md","# Alice\n"),f.task("bob","README.md","# Bob\n")]);
  const [first,second]=await Promise.all([f.controller.prepareFirstRootCandidate(a.id),f.controller.prepareFirstRootCandidate(b.id)]);
  expect(first.candidate?.status).toBe("verified");expect(second.candidate?.status).toBe("verified");
  expect(first.candidate?.candidateCommit).toBe(a.currentCommit);expect(second.candidate?.candidateCommit).toBe(b.currentCommit);
  expect(f.controller.getState().acceptedState.currentCommit).toBeNull();expect(git(f.canonical.remote,["for-each-ref"],{gitDir:true}).stdout).toBe("");
  const recoveredPending=await FlareGitRepositoryController.restore(f.deps,"root-project");expect(recoveredPending?.getState().acceptedState.currentCommit).toBeNull();expect(recoveredPending?.getState().candidates[first.candidate!.id]?.candidateCommit).toBe(a.currentCommit!);
  const candidate=first.candidate!,evidence=first.evidence!;
  expect((await f.controller.acceptFirstRootCandidate(candidate.id,{commit:candidate.candidateCommit!,tree:"b".repeat(40),actorId:"reviewer"})).success).toBe(false);
  const accepted=await f.controller.acceptFirstRootCandidate(candidate.id,{commit:candidate.candidateCommit!,tree:evidence.candidateTree,actorId:"reviewer"});expect(accepted.success).toBe(true);
  const loser=await f.controller.acceptFirstRootCandidate(second.candidate!.id,{commit:second.candidate!.candidateCommit!,tree:second.evidence!.candidateTree,actorId:"reviewer"});expect(loser.success).toBe(false);expect(loser.candidate?.status).toBe("stale");
  expect(gitOrThrow(f.canonical.remote,["rev-parse","refs/heads/main"],{gitDir:true})).toBe(a.currentCommit!);
  expect(gitOrThrow(b.workspace.localPath!,["rev-parse","HEAD"])).toBe(b.currentCommit!);
  expect(f.controller.getState().acceptedState.history).toHaveLength(1);
  expect(f.controller.getState().journal.at(-1)?.publicationAuthority).toMatchObject({actor:{userId:"reviewer",viaToken:false},commit:a.currentCommit,tree:evidence.candidateTree});
  const restored=await FlareGitRepositoryController.restore(f.deps,"root-project");expect(restored?.getState().acceptedState.currentCommit).toBe(a.currentCommit!);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test("initial batch preserves real root parents and exposes overlapping add/add conflicts",async()=>{
 const f=await fixture();try{
  const a=await f.task("first","README.md","# First\n"),b=await f.task("second","LICENSE","MIT\n");
  const prepared=await f.controller.prepareFirstRootCandidate([a.id,b.id]);expect(prepared.candidate?.status).toBe("verified");
  const dir=join(f.deps.storageDir,"integration",prepared.candidate!.id),parents=gitOrThrow(dir,["rev-list","--parents","-n","1",prepared.candidate!.candidateCommit!]).split(" ").slice(1);expect(parents).toEqual([a.currentCommit!,b.currentCommit!]);
  expect((await f.controller.acceptFirstRootCandidate(prepared.candidate!.id,{commit:prepared.candidate!.candidateCommit!,tree:prepared.evidence!.candidateTree,actorId:"reviewer"})).success).toBe(true);
 }finally{await rm(f.directory,{recursive:true,force:true});}
 const conflict=await fixture();try{
  const a=await conflict.task("left","README.md","Left\n"),b=await conflict.task("right","README.md","Right\n");
  const result=await conflict.controller.prepareFirstRootCandidate([a.id,b.id]);expect(result.candidate?.status).toBe("failed");expect(result.error).toContain("README.md");expect(conflict.controller.getState().acceptedState.currentCommit).toBeNull();
  expect(gitOrThrow(a.workspace.localPath!,["rev-parse","HEAD"])).toBe(a.currentCommit!);expect(gitOrThrow(b.workspace.localPath!,["rev-parse","HEAD"])).toBe(b.currentCommit!);
 }finally{await rm(conflict.directory,{recursive:true,force:true});}
});

test("independent controllers race create-only publication without overwriting either original root",async()=>{
 const f=await fixture();try{
  const other=new FlareGitRepositoryController({...f.deps,storageDir:join(f.directory,"second-state")},f.controller.getState());
  const first=await f.task("race-a","README.md","First publisher\n");
  const second=await other.createTask({taskId:"race-b",goal:"Alternative first README",contributorName:"Second",contributorType:"human"});
  await Bun.write(join(second.workspace.localPath!,"README.md"),"Second publisher\n");
  const secondCheckpoint=other.recordTaskCheckpoint({taskId:second.id,isReadyForIntegration:true});
  const [a,b]=await Promise.all([f.controller.prepareFirstRootCandidate(first.id),other.prepareFirstRootCandidate(second.id)]);
  const outcomes=await Promise.all([f.controller.acceptFirstRootCandidate(a.candidate!.id,{commit:a.candidate!.candidateCommit!,tree:a.evidence!.candidateTree,actorId:"reviewer-a"}),other.acceptFirstRootCandidate(b.candidate!.id,{commit:b.candidate!.candidateCommit!,tree:b.evidence!.candidateTree,actorId:"reviewer-b"})]);
  expect(outcomes.filter(outcome=>outcome.success)).toHaveLength(1);expect(outcomes.find(outcome=>!outcome.success)?.candidate?.status).toBe("stale");
  const winner=outcomes.find(outcome=>outcome.success)!;expect(gitOrThrow(f.canonical.remote,["rev-parse","refs/heads/main"],{gitDir:true})).toBe(winner.candidate!.candidateCommit!);
  expect(gitOrThrow(first.workspace.localPath!,["rev-parse","HEAD"])).toBe(first.currentCommit!);
  expect(gitOrThrow(second.workspace.localPath!,["rev-parse","HEAD"])).toBe(secondCheckpoint.currentCommit!);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
