import {z} from 'zod';
import {selectPublicationNativePhase} from './publication-native-phase';
import {runtimeRelease} from './runtime-release';
import {accountKeyFor,accountOf} from './projects';
import {ensureBuild} from "./build";
import {previewStorageFromIsolatedArtifact} from "./isolated-preview-storage";
import type {IsolatedBuildArtifact} from "./isolated-build-job";
import type {ProtectedConflictContext} from './protected-conflict-source';
import {captureTrustedGitSource} from './trusted-git-source';
import {repairDigest,type RepairPatch} from './protected-model-repair';
import {applyProtectedNativeRepair,applyProtectedNativeConflictRepair,reconstructProtectedNativeConflict} from './protected-native-repair';
import {runWorkflowMirrorFollowup} from "./workflow-mirror";
import {deriveTrustedBrowserPolicy} from './isolated-browser-policy';
import {verifyIsolatedGitCandidate,IsolatedGitVerificationError} from './isolated-git-verification';
import type { NativeComputeKind } from "./managed-spend-ledger.js";
import {retainCandidateGitPin,retainConflictInputGitPin} from "./candidate-git-pin";
import {confirmCompositionBranch} from "./composition-branch";
import { retainGitInput, retainUnbornGitInput, retainedGitInputRef } from "./retained-git-input.js";
import type { RetainedInput } from "./retained-inputs.js";
import { validateRecoveryRemote } from "./private-recovery-bundle.js";
import { admitGitOperation } from "./core-git-budget.js";
import {rebaseAcceptedFollowup} from "./accepted-followups.js";
import { assertPreviewStorageAdmission, PreviewStorageAdmissionError } from "./preview-storage.js";
import { publishPreviewStorageManifest } from "./preview-storage-upload.js";
import { admitNativeCompute } from "./native-compute.js";
import { buildPrefix } from "./preview-access.js";
import { publicationInHistory } from "./publication.js";
import {checkpointedNativeRefUpdate} from './c03-native-publication-checkpoint';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { WorkersAIClient, DEFAULT_CODE_MODEL } from "../ai/workers-ai.js";
import { buildRepairPrompt, parseRepairResponse, MAX_REPAIR_ROUNDS } from "../core/pipeline/repair.js";
import {acceptedTargetSchema,assertCompatibleAcceptedTargetBatch,effectiveTaskAcceptedTarget} from "../core/accepted-target.js";
import type { CandidateGeneration, VerificationEvidence, FlareGitProjectState, PublicationJournalEntry } from "../core/types.js";
import type { Env } from "./env.js";
import type { ClaimResult, Ledger, PrepareResult } from "./durable-object.js";
import { gitAuthEnv, q } from "./shell.js";
import { ledgerOf } from "./scenario-workflow.js";
import { settingsFor,isGitIntegrityPolicy } from "../core/command-policy.js";
import { inAgentScope, isProtectedPath, redactSecrets } from "../agents/prompt.js";
import { globalOf, reserveManagedAgent, assertManagedInitiator } from "./projects.js";
import type { WorkflowOutcome } from "./durable-object.js";
import {coordinationFollowup,runPostLandRebaseWorkflow,type PostLandRebaseParams} from "./coordination-dispatch.js";

/** Pure selection: explicit bindings never consult a mutable default branch. */
export function integrationTargetBranch(candidate:Pick<CandidateGeneration,"acceptedTarget"|"expectedAcceptedBase"|"frozenPolicyVersion"|"frozenVerificationPolicy">,state:Pick<FlareGitProjectState,"projectId"|"canonicalRepoName"|"defaultBranch">):string|undefined{
  if(!candidate.acceptedTarget)return state.defaultBranch;
  const target=acceptedTargetSchema.parse(candidate.acceptedTarget);
  if(target.projectId!==state.projectId||target.canonicalRepoName!==state.canonicalRepoName)throw Error("Frozen integration target repository scope changed");
  assertCompatibleAcceptedTargetBatch([target,acceptedTargetSchema.parse({...target,acceptedCommit:candidate.expectedAcceptedBase,policyVersion:candidate.frozenPolicyVersion,policy:candidate.frozenVerificationPolicy})]);
  return target.branch;
}
/** Bind protected evidence to the same immutable base and policy before ledger recording. */
export function integrationVerificationEvidence(candidate:CandidateGeneration,evidence:VerificationEvidence):VerificationEvidence{
  if(!candidate.acceptedTarget)return evidence;
  assertCompatibleAcceptedTargetBatch([candidate.acceptedTarget,acceptedTargetSchema.parse({...candidate.acceptedTarget,acceptedCommit:evidence.expectedAcceptedBase,policyVersion:evidence.requirementsVersion,policy:evidence.policy})]);
  return{...evidence,acceptedTarget:structuredClone(candidate.acceptedTarget)};
}
/** A bound target requires an exact admitted journal, never the live primary alias. */
export function assertIntegrationPublicationTarget(candidate:CandidateGeneration,journal:PublicationJournalEntry,state:Pick<FlareGitProjectState,"projectId"|"canonicalRepoName"|"defaultBranch">,commit:string,branch:string):void{
  if(!candidate.acceptedTarget){if(journal.acceptedTarget||journal.publicationAuthority?.acceptedTarget)throw Error("Publication target binding is missing from the candidate");return;}
  const target=candidate.acceptedTarget;
  if(integrationTargetBranch(candidate,state)!==branch)throw Error("Publication branch differs from the immutable target");
  if(!journal.acceptedTarget||!journal.publicationAuthority?.acceptedTarget||journal.candidateId!==candidate.id||journal.candidateCommit!==commit||journal.newHead!==commit||journal.expectedHead!==target.acceptedCommit||!journal.candidateTree||!/^[a-f0-9]{40}$/.test(journal.candidateTree)||journal.publicationAuthority.commit!==commit||journal.publicationAuthority.tree!==journal.candidateTree||journal.publicationAuthority.policyVersion!==candidate.frozenPolicyVersion)throw Error("Exact frozen target publication authority is unavailable");
  assertCompatibleAcceptedTargetBatch([target,journal.acceptedTarget,journal.publicationAuthority.acceptedTarget]);
}

/** Last awaited server fence: a bound CAS becomes possible durably before native dispatch. */
export async function authorizeIntegrationPublicationDispatch(candidate:CandidateGeneration,journal:PublicationJournalEntry,commit:string,ledger:Pick<Ledger,"authorizeCandidatePublication"|"markCandidatePublicationDispatch">):Promise<void>{
  if(!await ledger.authorizeCandidatePublication(candidate.id,commit))throw Error("Exact publication authority changed before dispatch; nothing was pushed");
  if(candidate.acceptedTarget&&!await ledger.markCandidatePublicationDispatch(candidate.id,journal.id,commit))throw Error("Prepared publication was cancelled or its dispatch marker changed; nothing was pushed");
}

export interface IntegrationParams {
  mode?: "integrate";
  nativeRuntimeProtocolVersion?:1;
  projectId: string;
  accountKey?: string;
  /** One to eight changes, merged in this order. */
  taskIds: string[];
}

export interface PreparedPublicationParams {mode:'prepared-publication';projectId:string;candidateId:string;journalId:string}
export type IntegrationWorkflowParams=IntegrationParams|PreparedPublicationParams|PostLandRebaseParams;
const preparedPublicationSchema=z.object({mode:z.literal('prepared-publication'),projectId:z.string().regex(/^[a-z0-9]{12,16}$/),candidateId:z.string().regex(/^[a-z0-9_-]{1,128}$/),journalId:z.string().regex(/^jrnl_[a-f0-9-]{36}$/)}).strict();

const WORK = "/workspace/integration";

type Stub = Ledger;

export class FlareGitIntegrationWorkflow extends WorkflowEntrypoint<Env, IntegrationWorkflowParams> {
  override async run(event: WorkflowEvent<IntegrationWorkflowParams>, step: WorkflowStep) {
    const params=event.payload;if(params.mode==='prepared-publication')return this.publishPrepared({...event,payload:params},step);
    if(params.mode==='post-land-rebase')return runPostLandRebaseWorkflow(this.env,{...event,payload:params},step);
    const requested={...event,payload:params};
    // Merge queue, contradiction proof and post-land updates follow every requested integration.
    let outcome:Awaited<ReturnType<FlareGitIntegrationWorkflow['integrateRequested']>>;
    try{outcome=await this.integrateRequested(requested,step);}catch(error){await coordinationFollowup(this.env,requested,step,{status:'failed',error:'Integration stopped unexpectedly'});throw error;}
    await coordinationFollowup(this.env,requested,step,outcome);
    return outcome;
  }

  private async integrateRequested(event: Readonly<WorkflowEvent<IntegrationParams>>, step: WorkflowStep) {
    const params=event.payload;
    const repository = ledgerOf(this.env, event.payload.projectId) as Stub;
    const admitted = await step.do("repository-dispatch-identity", () => repository.admitIntegrationDispatch(event.instanceId,params.taskIds));
    if (admitted.terminal) return { status: "skipped" as const, duplicate: true };
    const record = async (status: WorkflowOutcome) => {
      await step.do(`repository-outcome-${status}`, () => repository.recordIntegrationDispatchOutcome(event.instanceId,status));
      try { await step.do(`outcome-${status}`, async () => globalOf(this.env).recordWorkflowOutcome("integration", event.instanceId, status)); }
      catch { console.error("Workflow outcome recording unavailable"); }
    };
    await record("started");
    let result: Awaited<ReturnType<FlareGitIntegrationWorkflow["execute"]>>;
    let publicationConfirmed=false;
    const accepted=async()=>{publicationConfirmed=true;await record("accepted");};
    try { result = await this.execute({...event,payload:params}, step, accepted); }
    catch (error) {
      if (!publicationConfirmed) {
        await step.do("reconcile-failed-candidate", async () => {
          const state = await repository.getState();
          for (const candidate of Object.values(state.candidates)) {
            if (candidate.workflowInstanceId !== event.instanceId || !["composing", "repairing", "verifying", "verified", "awaiting_review"].includes(candidate.status)) continue;
            if(candidate.acceptedTarget&&state.journal.some(journal=>journal.candidateId===candidate.id&&journal.state==="PREPARED")){
              await repository.logActivity("FlareGit","integration.publication_pending","Bound target publication outcome is unresolved. Its prepared journal and original review remain preserved for read-only reconciliation.").catch(()=>console.warn("Publication recovery activity delivery was not confirmed"));
              continue;
            }
            // abortPublish preserves uncertain publication, accepted history, newer
            // task ownership and native recovery holds. Never persist raw errors.
            await repository.abortPublish(candidate.id, undefined, "Integration stopped before completion. Saved contributions remain available for recovery.", "failed");
          }
        });
        await record("failed");
      }
      throw error;
    }
    // A receipt delivery failure after successful publication must retry that
    // outcome, rather than overwrite accepted work with a fabricated failure.
    await record(result.status);
    return result;
  }
  private async publishPrepared(event:WorkflowEvent<PreparedPublicationParams>,step:WorkflowStep){
    const input=preparedPublicationSchema.parse(event.payload);if(event.instanceId!==`pub-${input.journalId}`)throw Error('Exact original publication invocation required');
    const controller=ledgerOf(this.env,input.projectId),state=await controller.getState(),candidate=state.candidates[input.candidateId],journal=state.journal.find(row=>row.id===input.journalId&&row.candidateId===input.candidateId);
    if(!candidate?.workflowInstanceId||!candidate.candidateCommit||!candidate.evidenceId||!candidate.acceptedTarget||!journal||journal.newHead!==candidate.candidateCommit||journal.candidateTree!==state.evidence[candidate.evidenceId]?.candidateTree)throw Error('Exact stored publication unavailable');
    if(journal.state==='ACCEPTED'){const receipt=await controller.acceptedPublicationReceipt(candidate.id,journal.id);if(!receipt||receipt.commit!==journal.newHead||receipt.ref!==candidate.acceptedTarget.ref)throw Error('Accepted publication history is unconfirmed');return{status:'accepted' as const,commit:journal.newHead,duplicate:true};}
    if(journal.state!=='PREPARED'||journal.publicationAuthority?.kind!=='human-review'||!candidate.review?.approved||candidate.review.commit!==journal.newHead||candidate.review.actor?.userId!==journal.publicationAuthority.actor.userId)throw Error('Exact prepared human review required');
    const original=await controller.getWorkflowRun(candidate.workflowInstanceId);if(original?.kind!=='integration'||!original.actorId)throw Error('Original registered integration required');
    const accountKey=await accountKeyFor(original.actorId),phase=selectPublicationNativePhase(this.env,{workflowId:candidate.workflowInstanceId!,candidateId:candidate.id,journalId:journal.id}),release=runtimeRelease(this.env);
    const derived={projectId:state.projectId,incarnation:candidate.acceptedTarget.incarnation,workflowId:candidate.workflowInstanceId,candidateId:candidate.id,actorId:original.actorId,accountKey,journalId:journal.id,commit:journal.newHead,tree:journal.candidateTree,evidenceId:candidate.evidenceId,reviewActorId:candidate.review.actor!.userId};
    for(const key of Object.keys(derived) as (keyof typeof derived)[])if(phase[key]!==derived[key])throw Error('Publication grant differs from recorded authority');
    if(!release.releaseIdentified||phase.sourceVersion!==release.sourceVersion||Date.now()<phase.activatedAt||Date.now()>=phase.admissionExpiresAt||await accountOf(this.env,accountKey).accountLifecycle()!=='active'||!await controller.authorizeCandidatePublication(candidate.id,journal.newHead))throw Error('Current publication authority unavailable');
    const fresh=await controller.getState();if(JSON.stringify(fresh.candidates[candidate.id])!==JSON.stringify(candidate)||JSON.stringify(fresh.journal.find(row=>row.id===journal.id))!==JSON.stringify(journal))throw Error('Prepared publication changed during admission');
    this.projectId=state.projectId;this.computeWorkflowId=candidate.workflowInstanceId;this.computeAccountKey=accountKey;this.nativeRuntimeCandidateId=candidate.id;
    const published=await step.do('publish-original-prepared-candidate',{retries:{limit:0,delay:'1 second'},timeout:'20 minutes'},()=>this.casPush(candidate,journal.newHead,controller,candidate.acceptedTarget!.branch,journal));
    if(!published.ok)return{status:'blocked' as const,publicationPending:true,journalId:journal.id,error:published.error};
    await step.do('complete-original-publication',()=>controller.completePublish(journal.id,published.readbackScope));
    await step.do('record-original-publication-outcome',()=>controller.recordIntegrationDispatchOutcome(candidate.workflowInstanceId!,'accepted'));
    return{status:'accepted' as const,commit:journal.newHead,journalId:journal.id};
  }
  private async execute(event: WorkflowEvent<IntegrationParams>, step: WorkflowStep, recordAccepted:()=>Promise<void>) {
    const stub = ledgerOf(this.env, event.payload.projectId) as Stub;
    this.projectId = event.payload.projectId;
    this.computeAccountKey = event.payload.accountKey;
    this.computeWorkflowId = event.instanceId;
    const holder = event.instanceId;

    // Merge queue: landings are serialized by the ledger lease. A busy lease means "wait your turn" (durably, via
    // Workflow sleeps), never a silently dropped request. Other refusals are final and reported.
    let claim: ClaimResult = { reason: "not attempted" };
    for (let turn = 0; turn < 72; turn++) {
      claim = (await step.do(`claim-landing-${turn}`, async () => (await stub.claimLanding({ holder, taskIds: event.payload.taskIds, preservationProtocolVersion: 1 })) as never)) as ClaimResult;
      if (claim.candidate || claim.decision || claim.reason !== "Another landing holds the lease") break;
      await step.sleep(`queued-${turn}`, "30 seconds");
    }
    if (!claim.candidate) {
      if (!claim.decision) await step.do("report-not-started", async () => stub.logActivity("FlareGit", "integration.not_started", `Integration of ${event.payload.taskIds.join(" + ")} did not start: ${claim.reason}`));
      return { status: claim.decision ? "needs_decision" as const : "not_started" as const, reason: claim.reason, decision: claim.decision };
    }
    const candidate = claim.candidate;
    if(event.payload.nativeRuntimeProtocolVersion===1){await step.do("declare-native-runtime-coverage",()=>stub.declareIntegrationNativeRuntime(event.instanceId,candidate.id));this.nativeRuntimeCandidateId=candidate.id;}

    const integrated = await step.do(
      "compose-repair-verify",
      { retries: { limit: 1, delay: "10 seconds", backoff: "constant" }, timeout: "20 minutes" },
      async () => this.composeRepairVerify(candidate, event.payload, stub, event.instanceId)
    );

    if (!integrated.ok) {
      await step.do("abort", async () => stub.abortPublish(candidate.id, undefined, integrated.error, "failed"));
      return { status: "blocked" as const, error: integrated.error };
    }

    if (event.payload.nativeRuntimeProtocolVersion === 1 || 'trustedBrowserFixture' in candidate.frozenVerificationPolicy || 'trustedBrowserPolicyDigest' in candidate.frozenVerificationPolicy) {
      await step.do("close-verification-native-phase", () => stub.closeIntegrationVerification(event.instanceId, candidate.id, integrated.commit, integrated.evidenceId));
    }
    // Freeze external checks before choosing the current maintainer acceptance policy.
    await step.do("await-review", async () => stub.awaitReview(candidate.id, integrated.commit, event.instanceId));
    const acceptance = await step.do("candidate-acceptance", async () => {
      const decision = await stub.candidateAcceptance(candidate.id, integrated.commit, event.instanceId);
      return {mode: decision.mode};
    });
    if (acceptance.mode === "human-review-required") {
    await step.do("repository-outcome-awaiting-review", () => stub.recordIntegrationDispatchOutcome(event.instanceId,"awaiting_review"));
    await step.do("outcome-awaiting-review", async () => globalOf(this.env).recordWorkflowOutcome("integration", event.instanceId, "awaiting_review"));
    let review: { approved: boolean; by: string; note?: string };
    try {
      review = (await step.waitForEvent<{ approved: boolean; by: string; note?: string }>("human-review", { type: "review", timeout: "7 days" })).payload;
    } catch {
      await step.do("abort-unreviewed", async () => stub.abortPublish(candidate.id, undefined, "Nobody reviewed the candidate within 7 days; run the integration again", "stale"));
      return { status: "stale" as const, error: "review timed out" };
    }
    if (!review.approved) {
      await step.do("abort-rejected", async () => stub.abortPublish(candidate.id, undefined, `Rejected in review by ${review.by}${review.note ? `: ${review.note}` : ""}`, "failed"));
      return { status: "rejected" as const, by: review.by };
    }

    } else if (acceptance.mode !== "maintainer-policy") {
      throw new Error("Unknown candidate acceptance mode");
    }

    const prepared = (await step.do("prepare-publish", async () => (await stub.preparePublish(candidate.id)) as never)) as PrepareResult;
    if (!prepared.ok || !prepared.journal) {
      await step.do("abort-prepare", async () => stub.abortPublish(candidate.id, undefined, prepared.error ?? "refused", prepared.stale ? "stale" : "failed"));
      return { status: prepared.stale ? "stale" as const : "blocked" as const, error: prepared.error };
    }

    const pushed = await step.do("cas-push-to-artifacts", { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } }, async () => this.casPush(candidate, integrated.commit, stub, integrated.branch, prepared.journal!));
    if (!pushed.ok && candidate.acceptedTarget) {
      await step.do("record-target-publication-pending",async()=>{await stub.logActivity("FlareGit","integration.publication_pending",`Publication of ${integrated.commit} on ${candidate.acceptedTarget!.ref} is unresolved. The prepared journal, review, and committed Git state remain preserved for read-only reconciliation.`).catch(()=>console.warn("Publication recovery activity delivery was not confirmed"));return{journalId:prepared.journal!.id,targetRef:candidate.acceptedTarget!.ref};});
      return{status:"blocked" as const,publicationPending:true as const,journalId:prepared.journal.id,error:pushed.error};
    }
    if (!pushed.ok) {
      await step.do("abort-push", async () => stub.abortPublish(candidate.id, prepared.journal!.id, pushed.error, pushed.stale ? "stale" : "failed"));
      return { status: pushed.stale ? "stale" as const : "blocked" as const, error: pushed.error };
    }
    await step.do("complete-publish", async () => stub.completePublish(prepared.journal!.id,pushed.readbackScope));
    // Core publication is durable before optional follow-ups consume resources.
    await recordAccepted();
    // Stacked changes: re-base every dependent change onto what just landed, so the stack keeps tracking upstream.
    await step.do("rebase-dependents", { retries: { limit: 1, delay: "5 seconds" } }, async () => candidate.acceptedTarget ? this.rebaseDependents(candidate,integrated.commit,integrated.branch,stub) : rebaseAcceptedFollowup(stub,integrated.commit,()=>this.rebaseDependents(candidate,integrated.commit,integrated.branch,stub)));
    // Composition already required remote-verified original/base pins and durable receipts.
    // Accepted history never depends on the optional stack/mirror follow-ups below.
    const targetDeploymentFollowup=candidate.acceptedTarget?await step.do("record-target-deployment-boundary",async()=>{
      await stub.logActivity("FlareGit","deployment.target_mapping_required",`Accepted commit ${integrated.commit} on ${candidate.acceptedTarget!.ref} is durable. No deployment was requested; an owner-approved target mapping is required.`).catch(()=>console.warn("Target deployment boundary activity delivery was not confirmed"));
      return{status:"not_requested" as const,reason:"target_mapping_required" as const,targetRef:candidate.acceptedTarget!.ref};
    }):undefined;
    // Mirror delivery is optional and has an existing owner-controlled retry route.
    const mirrorFollowup=await step.do("mirror-to-github", {retries:{limit:1,delay:"5 seconds"}}, ()=>runWorkflowMirrorFollowup(this.env,stub,event.instanceId,prepared.journal!.id,candidate.acceptedTarget?.ref,integrated.commit));
    return { status: "accepted" as const, commit: integrated.commit, evidenceId: integrated.evidenceId,...(candidate.acceptedTarget?{targetRef:candidate.acceptedTarget.ref,followups:{mirror:mirrorFollowup,deployment:targetDeploymentFollowup}}:{}) };
  }

  /**
   * After a landing, replay each dependent change on top of its parent's new tip (`git rebase --onto new old`),
   * walking the stack downwards. A conflict stops that branch of the stack and flags the change for its author.
   */
  private async rebaseDependents(candidate: CandidateGeneration, landed: string, branch: string, stub: Stub): Promise<{ rebased: string[]; blocked: string[]; status?:"deferred"; reason?:string; targetRef?:string; truncated?:boolean }> {
    const workflowId = candidate.workflowInstanceId ?? this.computeWorkflowId;
    if (!workflowId) throw new Error("Registered integration workflow required for dependent updates");
    const state = await stub.getState(), tasks = Object.values(state.tasks);
    if(candidate.acceptedTarget){
      try{if(integrationTargetBranch(candidate,state)!==branch)throw Error("Dependent target changed");}catch{return{status:"deferred",reason:"target_scope_unconfirmed",targetRef:candidate.acceptedTarget.ref,rebased:[],blocked:[]};}
      const parents=new Set(candidate.participatingTaskIds),dependents=tasks.filter(task=>task.dependsOn&&parents.has(task.dependsOn)&&!["accepted","cancelled"].includes(task.status));
      if(!dependents.length)return{rebased:[],blocked:[]};
      const mixed=dependents.some(task=>{try{if(!task.acceptedTarget)return true;assertCompatibleAcceptedTargetBatch([candidate.acceptedTarget!,task.acceptedTarget]);return false;}catch{return true;}});
      await stub.logActivity("FlareGit","stack.target_rebase_deferred",`Accepted commit ${landed} is preserved on ${candidate.acceptedTarget.ref}. ${dependents.length} dependent change(s) require an explicit fresh target generation; original bindings and reviews were retained.${mixed?" Mixed or unbound targets were not rebased.":""}`).catch(()=>console.warn("Target rebase follow-up is deferred; activity delivery was not confirmed"));
      return{status:"deferred",reason:mixed?"mixed_target_generation_required":"fresh_target_generation_required",targetRef:candidate.acceptedTarget.ref,rebased:[],blocked:dependents.slice(0,100).map(task=>task.id),truncated:dependents.length>100};
    }
    const accepted = new Set(candidate.participatingTaskIds), visited = new Set<string>();
    const queue: Array<{id:string;parentId:string;target:string}> = [];
    const discover = async (parentId:string,target:string) => {
      for (const task of tasks) {
        if (visited.has(task.id) || accepted.has(task.id) || ["accepted","cancelled"].includes(task.status)) continue;
        if (task.dependsOn === parentId) queue.push({id:task.id,parentId,target});
        else if (!task.dependsOn && task.baseCommit === target) {
          // A lost metadata ACK can leave an already-applied child without its old dependency.
          const saved = await stub.rebaseApplication(task.id,workflowId,candidate.id,target);
          if (saved?.status === "applied" && saved.input.dependsOn === parentId) queue.push({id:task.id,parentId,target});
        }
      }
    };
    for (const parentId of accepted) await discover(parentId,landed);
    if (!queue.length) return {rebased:[],blocked:[]};
    let sb:Awaited<ReturnType<FlareGitIntegrationWorkflow["sandbox"]>>|undefined;const rebased:string[] = [], blocked:string[] = [];
    try {
      while (queue.length) {
        const item = queue.shift()!; if (visited.has(item.id)) continue; visited.add(item.id);
        let application = await stub.rebaseApplication(item.id,workflowId,candidate.id,item.target);
        if (application?.status === "applied") {
          rebased.push(item.id); await discover(item.id,application.commit); continue;
        }
        // Fresh credential identity for each attempt; old issuance intents are never reused.
        const input = await stub.prepareRetainedInput(item.id,workflowId,candidate.id,crypto.randomUUID());
        if (input.dependsOn !== item.parentId || (application && (input.commit !== application.input.commit || input.base !== application.input.base || input.workspaceRepoName !== application.input.workspaceRepoName))) throw new Error("Dependent checkpoint changed; its pushed branch is preserved");
        try{await stub.assertRetainedWorkspaceWrite(input);}catch{
          blocked.push(item.id);await stub.logActivity('FlareGit','stack.rebase_deferred',`Change ${item.id} retains its original checkpoint and base; creator consent for maintainer edits is unavailable.`).catch(()=>undefined);continue;
        }
        sb??=await this.sandbox(`rebase-${candidate.id}`);
        const canonical = await this.canonicalRemote(stub,input);
        let workspace: Awaited<ReturnType<FlareGitIntegrationWorkflow["retainedRemote"]>> | undefined;
        try {
          workspace = await this.retainedRemote(stub,input,"workspace","write");
          const run = async (command:string,env?:Record<string,string>) => {
            await stub.assertRetainedWorkspaceWrite(input);await this.fundedRetainedCommand(input,stub);await stub.assertRetainedWorkspaceWrite(input);
            const result = await sb!.exec(command,env);
            await stub.assertRetainedWorkspaceWrite(input);await this.retainedAuthority(input,stub); return result;
          };
          const inspectBranch = async () => {
            const result = await run(`git ls-remote --refs ${q(workspace!.remote)} ${q(`refs/heads/${input.branch}`)}`,gitAuthEnv(workspace!.token));
            if (!result.success) throw new Error("Dependent branch read-back is unavailable");
            const rows = result.stdout.trim().split("\n").filter(Boolean), suffix=`\trefs/heads/${input.branch}`;
            if(rows.length!==1||!rows[0]!.endsWith(suffix)||!/^[a-f0-9]{40}$/.test(rows[0]!.slice(0,40)))throw new Error("Dependent branch identity is unconfirmed");
            return rows[0]!.slice(0,40);
          };
          const before = await inspectBranch();
          if (application && before === application.commit) {
            await stub.recordRebaseRemoteOutcome(application.input.id,before);
          } else {
            if (before !== input.commit) throw new Error("Dependent branch moved; no newer work was overwritten");
            let result = await run(`rm -rf ${WORK} && git clone --quiet ${q(canonical.remote)} ${WORK} && git -C ${WORK} config user.name FlareGit && git -C ${WORK} config user.email integrator@flaregit.com`,gitAuthEnv(canonical.token));
            if (!result.success) throw new Error("Could not restore the preserved rebase workspace");
            if (application) {
              const ref = retainedGitInputRef(application.input.incarnation,item.id,application.commit);
              result = await run(`git -C ${WORK} fetch --quiet ${q(canonical.remote)} ${q(`${ref}:refs/flaregit/rebase-result`)}`,gitAuthEnv(canonical.token));
              if (!result.success || (await run(`git -C ${WORK} rev-parse refs/flaregit/rebase-result`)).stdout.trim() !== application.commit) throw new Error("Stored rebase result is unavailable; no alternate result was substituted");
            } else {
              result = await run(`git -C ${WORK} fetch --quiet ${q(workspace.remote)} ${q(`+refs/heads/${input.branch}:refs/flaregit/rb/${item.id}`)}`,gitAuthEnv(workspace.token));
              if (!result.success || (await run(`git -C ${WORK} rev-parse ${q(`refs/flaregit/rb/${item.id}`)}`)).stdout.trim() !== input.commit) throw new Error("Dependent branch changed while loading its checkpoint");
              await this.pinInput(input,WORK,canonical,stub,run);
              const targetRef = accepted.has(item.parentId) ? `refs/heads/${branch}` : retainedGitInputRef(input.incarnation,item.parentId,item.target);
              result = await run(`git -C ${WORK} fetch --quiet ${q(canonical.remote)} ${q(`${targetRef}:refs/flaregit/rebase-parent`)}`,gitAuthEnv(canonical.token));
              if(!result.success || (await run("git -C /workspace/integration rev-parse refs/flaregit/rebase-parent")).stdout.trim()!==item.target)throw new Error("The recorded rebase target is unavailable; no newer parent was substituted");
              if (input.base === null) throw new Error("Unborn contributor history requires an explicit root rebase protocol");
              result = await run(`git -C ${WORK} checkout --quiet --detach ${q(input.commit)} && git -C ${WORK} rebase --onto ${q(item.target)} ${q(input.base)}`);
              if (!result.success) {
                await run(`git -C ${WORK} rebase --abort`);
                await stub.applyRebase(item.id,{failed:"Could not rebase onto the recorded parent; original checkpoint and base are protected",expected:input});
                blocked.push(item.id); continue;
              }
              const newCommit=(await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
              const beforeCommand=async(phase:"before"|"after")=>{await stub.assertRetainedWorkspaceWrite(input);if(phase==="before")await this.fundedRetainedCommand(input,stub);else await this.retainedAuthority(input,stub);await stub.assertRetainedWorkspaceWrite(input);};
              // Preserve the result and target BEFORE persisting an intent or modifying the fork.
              await retainGitInput({exec:run,directory:WORK,remote:canonical.remote,token:canonical.token,incarnation:input.incarnation,taskId:item.id,commit:newCommit,beforeCommand});
              await retainGitInput({exec:run,directory:WORK,remote:canonical.remote,token:canonical.token,incarnation:input.incarnation,taskId:item.id,commit:item.target,beforeCommand});
              application=await stub.prepareRebaseApplication(input,newCommit,item.target,accepted.has(item.parentId));
            }
            const pushed=await run(`git -C ${WORK} push --quiet --force-with-lease=${q(`refs/heads/${input.branch}:${input.commit}`)} ${q(workspace.remote)} ${q(`${application.commit}:refs/heads/${input.branch}`)}`,gitAuthEnv(workspace.token));
            const observed=await inspectBranch();
            if(observed!==application.commit)throw new Error(pushed.success?"The rebased remote head was not confirmed":"Rebase push outcome remains unconfirmed; protected originals and result are preserved");
            await stub.recordRebaseRemoteOutcome(application.input.id,observed);
          }
          await stub.applyRebase(item.id,{commit:application.commit,base:application.base,parentAccepted:application.parentAccepted,expected:application.input,receiptId:application.input.id,applicationId:application.input.id});
          rebased.push(item.id); await discover(item.id,application.commit);
        } finally { await workspace?.close(); await canonical.close(); }
      }
      return {rebased,blocked,...(!sb&&blocked.length?{status:"deferred" as const,reason:"creator_consent_required"}:{})};
    } finally { await sb?.destroy(); }
  }

  private projectId = "";

  /** Every allocation is isolated; interrupted work is recovered from retained Git refs. */
  private nativeRuntimeCandidateId?:string;
  private computeAccountKey?: string;
  private computeWorkflowId?: string;
  private async sandbox(id: string,resourceKind:NativeComputeKind="native-essential") {
    const repository=ledgerOf(this.env,this.projectId);
    await assertManagedInitiator(this.env,repository,this.computeWorkflowId,this.computeAccountKey);
    const nativeId=crypto.randomUUID(),allocationId=`native-${nativeId}`;
    if(this.nativeRuntimeCandidateId)await repository.reserveIntegrationNativeRuntime(this.computeWorkflowId!,this.nativeRuntimeCandidateId,nativeId,id);
    await admitNativeCompute(this.env,this.computeAccountKey!,allocationId,resourceKind);
    const sb = this.env.INTEGRATOR.getByName(allocationId);
    const command=async()=>{const commandId=crypto.randomUUID(),scope=await repository.admitIntegrationNativeCommand(this.computeWorkflowId!,this.nativeRuntimeCandidateId!,nativeId,commandId);return {commandId,scope};};
    return {
      nativeRunId:nativeId,
      exec: async(cmd:string,env?:Record<string,string>,beforeDispatch?:()=>Promise<void>)=>{if(!this.nativeRuntimeCandidateId){await beforeDispatch?.();return sb.exec(["sh","-c",cmd],{env});}const permit=await command();try{await beforeDispatch?.();}catch(error){await repository.finishIntegrationNativeCommand(permit.scope,nativeId,permit.commandId,"refused");throw error;}return sb.integrationExec(permit.scope,nativeId,permit.commandId,["sh","-c",cmd],{env});},
      readFile: async(p:string)=>{if(!this.nativeRuntimeCandidateId)return {content:await sb.readFile(p)};const permit=await command();return {content:await sb.integrationReadFile(permit.scope,nativeId,permit.commandId,p)};},
      readFileBytes: async(p:string)=>{if(!this.nativeRuntimeCandidateId)return sb.readFileBytes(p);const permit=await command();return sb.integrationReadFileBytes(permit.scope,nativeId,permit.commandId,p);},
      inspectProtectedConflict:async(context:ProtectedConflictContext)=>{if(!this.nativeRuntimeCandidateId)throw Error('Scoped fixed conflict inspector required');const permit=await command();return sb.integrationInspectProtectedConflict(permit.scope,nativeId,permit.commandId,context);},
      readGitObject: async(kind:'commit'|'tree'|'blob',hash:string,maxBytes:number)=>{if(!this.nativeRuntimeCandidateId)throw Error('Scoped native Git reader required');const permit=await command();return sb.integrationReadGitObject(permit.scope,nativeId,permit.commandId,kind,hash,maxBytes);},
      writeFile: async(p:string,c:string)=>{if(!this.nativeRuntimeCandidateId)return sb.writeFile(p,c);const permit=await command();return sb.integrationWriteFile(permit.scope,nativeId,permit.commandId,p,c);},
      destroy: async () => {
        try { await sb.destroy();if(this.nativeRuntimeCandidateId)await repository.confirmIntegrationNativeRuntimeStopped(this.computeWorkflowId!,this.nativeRuntimeCandidateId,nativeId); }
        catch {
          console.warn("Container cleanup failed");
          await ledgerOf(this.env, this.projectId).logActivity("FlareGit", "container.cleanup_failed", `Container ${id} did not confirm shutdown; durable Git refs are preserved`).catch(() => console.warn("Container cleanup evidence unavailable"));
        }
      },
    };
  }

  private async retainedAuthority(input: RetainedInput, stub: Stub) {
    await assertManagedInitiator(this.env, stub, input.workflowId, this.computeAccountKey);
    if (!await stub.assertRetainedInput(input)) throw new Error("Retained contribution authority changed");
  }
  private async fundedRetainedCommand(input: RetainedInput, stub: Stub) {
    await this.retainedAuthority(input, stub);
    const admission = await admitGitOperation(this.env, input.ownerId, `retain-${crypto.randomUUID()}`);
    if (admission instanceof Response) throw new Error("Contribution preservation funding is unavailable");
    await this.retainedAuthority(input, stub);
  }
  /** Issuance is recorded before use; failed revocation stays in the durable cleanup queue. */
  private async retainedRemote(stub: Stub, input: RetainedInput, purpose: "canonical" | "workspace", scope: "read" | "write") {
    const repoName = purpose === "canonical" ? input.canonicalRepoName : input.workspaceRepoName;
    if(purpose==="workspace"&&scope==="write")await stub.assertRetainedWorkspaceWrite(input);
    await this.fundedRetainedCommand(input, stub);
    using repo = await this.env.ARTIFACTS.get(repoName);
    await this.retainedAuthority(input, stub);
    await this.fundedRetainedCommand(input, stub);
    const remote = String((await repo.info()).remote);
    validateRecoveryRemote(remote);
    await this.retainedAuthority(input, stub);
    const plannedExpiry = Date.now() + 900_000;
    if (!await stub.beginRetainedCredential(input, purpose, plannedExpiry, scope)) throw new Error("A prior credential issuance remains recorded; no duplicate credential was created");
    await this.fundedRetainedCommand(input, stub);
    if(purpose==="workspace"&&scope==="write")await stub.assertRetainedWorkspaceWrite(input);
    const issued = await repo.createToken(scope, 900);
    const expiresAt = Date.parse(issued.expiresAt);
    try {
      // Record first even when expiry/scope is malformed: cleanup must not lose an issued secret.
      await stub.recordRetainedCredential(input.id, purpose, repoName, issued.plaintext, expiresAt);
    } catch {
      // Keep the exact same issued capability on a lost receipt ACK; never issue another.
      try { await stub.recordRetainedCredential(input.id, purpose, repoName, issued.plaintext, expiresAt); }
      catch {
        try {
          // Revocation is restrictive cleanup and may continue after actor withdrawal,
          // but its provider call still requires a funded conservative envelope.
          await stub.revokeKnownRetainedCredential(input.id,purpose,repoName,issued.plaintext,expiresAt);
        } catch { /* The saved issuance intent remains uncertain. */ }
        throw new Error("Credential cleanup receipt is unavailable; no Git command used the credential");
      }
    }
    const close = async () => {
      const confirmed = await stub.revokeRetainedCredential(input.id, purpose).catch(() => false);
      if (!confirmed) await stub.logActivity("FlareGit", "credential.cleanup_pending", "Contribution preservation credential cleanup is unconfirmed; its incident remains recorded for recovery").catch(() => undefined);
    };
    if (issued.scope !== scope || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 905_000) {
      await close(); throw new Error("Provider credential scope or expiry was not confirmed");
    }
    try { await this.retainedAuthority(input, stub);if(purpose==="workspace"&&scope==="write")await stub.assertRetainedWorkspaceWrite(input); }
    catch { await close(); throw new Error("Contribution authority changed before credential use"); }
    return { remote, token: issued.plaintext, close };
  }
  private async canonicalRemote(stub: Stub, input: RetainedInput) { return this.retainedRemote(stub, input, "canonical", "write"); }
  private async pinInput(input: RetainedInput, directory: string, remote: {remote:string;token:string}, stub: Stub, exec: (command:string,env?:Record<string,string>)=>Promise<{success:boolean;stdout:string}>) {
    const beforeCommand = async (phase: "before" | "after") => { if (phase === "before") await this.fundedRetainedCommand(input, stub); else await this.retainedAuthority(input, stub); };
    if (input.base === null || input.acceptedTarget?.kind === "unborn") {
      if (input.acceptedTarget?.kind !== "unborn") throw new Error("Unborn preservation requires the frozen target");
      const original = await retainUnbornGitInput({ exec, directory, remote: remote.remote, token: remote.token, incarnation: input.incarnation, taskId: input.taskId, commit: input.commit, beforeCommand, acceptedTarget: input.acceptedTarget, base:input.base, stackedOn:input.stackedOn });
      if (original.ref !== input.protectedRef || original.protectedBaseRef !== input.protectedBaseRef) throw new Error("Protected unborn contribution scope differs");
      return stub.recordRetainedInput(input, { commit: original.commit, base: original.base, rootCommit: original.rootCommit, rootAncestryVerified: true });
    }
    const original = await retainGitInput({ exec, directory, remote: remote.remote, token: remote.token, incarnation: input.incarnation, taskId: input.taskId, commit: input.commit, beforeCommand });
    const base = await retainGitInput({ exec, directory, remote: remote.remote, token: remote.token, incarnation: input.incarnation, taskId: input.taskId, commit: input.base, beforeCommand });
    if (original.ref !== input.protectedRef || base.ref !== input.protectedBaseRef) throw new Error("Protected contribution refs do not match the stored scope");
    return stub.recordRetainedInput(input, { commit: original.commit, base: base.commit });
  }

  private async composeRepairVerify(
    candidate: CandidateGeneration,
    params: IntegrationParams,
    stub: Stub,
    parentWorkflowId: string
  ): Promise<{ ok: true; commit: string; evidenceId: string; branch: string } | { ok: false; error: string }> {
    const state = await stub.getState(),tasks=candidate.participatingTaskIds.map(id=>state.tasks[id]!);
    let selectedBranch:string|undefined;
    try{selectedBranch=integrationTargetBranch(candidate,state);if(candidate.acceptedTarget){assertCompatibleAcceptedTargetBatch([candidate.acceptedTarget,...tasks.map(task=>{if(!task)throw Error("Frozen task target unavailable");const target=effectiveTaskAcceptedTarget(task);if(!target)throw Error("Frozen task target unavailable");return target;})]);}else if(tasks.some(task=>task&&effectiveTaskAcceptedTarget(task)))throw Error("Frozen candidate target binding unavailable");}catch{return{ok:false,error:"Frozen integration target scope, base, requirements or policy could not be confirmed; saved contributions remain preserved"};}
    const settings = settingsFor(candidate.frozenVerificationPolicy);
    const externalOnly = candidate.frozenExternalChecksPolicy?.mode === "external";
    const nativeOnly=externalOnly||isGitIntegrityPolicy(candidate.frozenVerificationPolicy);
    const isolatedBrowser='trustedBrowserFixture' in candidate.frozenVerificationPolicy||'trustedBrowserPolicyDigest' in candidate.frozenVerificationPolicy;
    if(isolatedBrowser){
      try{await deriveTrustedBrowserPolicy(candidate.frozenVerificationPolicy,candidate.frozenRequirements.filter(requirement=>requirement.status==="approved").map(requirement=>requirement.id));}catch{return{ok:false,error:'Frozen isolated browser policy is invalid; saved contributions remain preserved'};}
      if(!this.env.UNTRUSTED_EXECUTION||!this.env.ISOLATED_EXECUTION_IMAGE||!this.env.VERIFICATION_BROWSER)return{ok:false,error:'Isolated execution resources are not configured; no application code was executed'};
    }
    if(candidate.expectedAcceptedBase===null && (!nativeOnly||candidate.acceptedTarget?.kind!=="unborn"||settings.landing!=="merge"))return{ok:false,error:"First publication requires an explicit unborn target and native merge verification preserving contributor roots"};
    if (externalOnly && ((settings.fixture !== "custom"&&settings.fixture!=="git-integrity") || !candidate.frozenExternalChecksPolicy?.checks.some((check) => check.required) || !candidate.frozenContributorProofs?.length)) return { ok: false, error: "External CI requires a custom repository, frozen contributor proofs and at least one required check" };
    candidate.repairAttempts=structuredClone(state.candidates[candidate.id]?.repairAttempts??candidate.repairAttempts);
    const savedRepair=isolatedBrowser?[...candidate.repairAttempts].reverse().find(attempt=>attempt.protectedRepair):undefined;
    const recoveryIdentity=savedRepair?.protectedRepair?{sourceCommit:savedRepair.protectedRepair.sourceCommit,sourceDigest:savedRepair.protectedRepair.sourceDigest,planDigest:savedRepair.protectedRepair.planDigest,...(savedRepair.protectedRepair.modelAttemptId?{modelAttemptId:savedRepair.protectedRepair.modelAttemptId}:{})}:undefined;
    let recovery:Awaited<ReturnType<Stub['protectedRepairRecovery']>>|undefined;
    let textRecovery:Awaited<ReturnType<Stub['protectedConflictRepairRecovery']>>|undefined;
    const textIdentity=savedRepair?.protectedRepair?.kind==='text'&&savedRepair.protectedRepair.text&&recoveryIdentity?{...recoveryIdentity,text:structuredClone(savedRepair.protectedRepair.text)}:undefined;
    if(savedRepair&&textIdentity){
      try{textRecovery=await stub.protectedConflictRepairRecovery(candidate.id,parentWorkflowId,savedRepair.round,textIdentity);}catch{return{ok:false,error:'Original text conflict source pin, owner or native shutdown remains unconfirmed; no allocation or model redispatch occurred'};}
      if(textRecovery.outcome.phase!=='completed'||!textRecovery.outcome.patch||textRecovery.outcome.attemptId!==textRecovery.outcome.patch.attemptId)return{ok:false,error:'Original text model outcome remains prepared or unknown; no successor dispatch is permitted'};
    }
    if(savedRepair&&recoveryIdentity&&!textIdentity){
      try{recovery=await stub.protectedRepairRecovery(candidate.id,parentWorkflowId,savedRepair.round,recoveryIdentity);}catch{return{ok:false,error:'Original protected repair/native ownership or shutdown is unconfirmed; no resource allocation or successor model request was made'};}
      if(recovery.outcome.phase!=='completed'||!recovery.outcome.patch||recovery.outcome.attemptId!==recovery.outcome.patch.attemptId)return{ok:false,error:'Original protected model outcome remains prepared or unknown; the same round is held without redispatch'};
    }
    const spendRunId = `repair-${candidate.id}`;
    let spending: Awaited<ReturnType<typeof reserveManagedAgent>> | null = null;
    try {
      if (!nativeOnly) await assertManagedInitiator(this.env, stub, parentWorkflowId, params.accountKey);
      spending = nativeOnly ? null : await reserveManagedAgent(this.env, params.accountKey, spendRunId);
      if (spending) await globalOf(this.env).consumeManagedSpend(spendRunId, 0, 0, 600);
    } catch {
      return { ok: false, error: "Managed verification budget unavailable; saved contributor checkpoints remain available. Configure a budget or use external checks." };
    }

    if(candidate.acceptedTarget?.kind==="unborn"){
      const pending=[...tasks],ordered:typeof tasks=[];
      while(pending.length){const index=pending.findIndex(task=>{const proof=candidate.frozenContributorProofs?.find(value=>value.id===task.id);return proof?.baseCommit===null||!!proof?.stackedOn&&ordered.some(parent=>parent.id===proof.stackedOn!.taskId);});if(index<0)return{ok:false,error:"Initial stacked contributions require their exact frozen parent in this batch"};ordered.push(pending.splice(index,1)[0]!);}
      tasks.splice(0,tasks.length,...ordered);
    }
    const inputs = await Promise.all(tasks.map(task => stub.prepareRetainedInput(task.id, parentWorkflowId, candidate.id, crypto.randomUUID())));
    if(candidate.acceptedTarget&&inputs.some(input=>input.incarnation!==candidate.acceptedTarget!.incarnation||input.projectId!==candidate.acceptedTarget!.projectId||input.canonicalRepoName!==candidate.acceptedTarget!.canonicalRepoName))return{ok:false,error:"Frozen integration target incarnation or repository changed before preservation"};
    if (!inputs.length || inputs.some(input => input.commit !== candidate.participatingCommits[input.taskId])) return { ok: false, error: "A frozen contribution advanced before preservation; no candidate was composed" };
    const sb = await this.sandbox(`integrate-${candidate.id}`);
    let canonical: Awaited<ReturnType<FlareGitIntegrationWorkflow["canonicalRemote"]>> | undefined;
    try {
    const run = async (cmd: string, env?: Record<string, string>) => sb.exec(cmd, env);
    if (nativeOnly && (candidate.frozenContributorProofs!.length !== tasks.length || !candidate.participatingTaskIds.every((id) => candidate.frozenContributorProofs!.some((proof) => proof.id === id && proof.commit === candidate.participatingCommits[id] && proof.ref === `refs/flaregit/tasks/${id}`)))) return { ok: false, error: "Frozen contributor proofs do not match every participating checkpoint" };
    canonical = await this.canonicalRemote(stub, inputs[0]!);
    const activeCanonical = canonical;

    await this.fundedRetainedCommand(inputs[0]!, stub);
    let r = await run(`rm -rf ${WORK} && git clone --quiet ${q(activeCanonical.remote)} ${WORK}`, gitAuthEnv(activeCanonical.token));
    if (!r.success) return { ok: false, error: "Could not clone canonical repository" };
    const branch=await confirmCompositionBranch({branch:selectedBranch,expectedBase:candidate.expectedAcceptedBase,acceptedTarget:candidate.acceptedTarget,remote:activeCanonical.remote,token:activeCanonical.token,directory:WORK,exec:run,beforeCommand:async phase=>{if(phase==="before")await this.fundedRetainedCommand(inputs[0]!,stub);else await this.retainedAuthority(inputs[0]!,stub);}});
    await run(`git -C ${WORK} config user.name FlareGit && git -C ${WORK} config user.email integrator@flaregit.com${candidate.expectedAcceptedBase === null ? "" : ` && git -C ${WORK} checkout --quiet --detach ${q(candidate.expectedAcceptedBase)}`}`);

    for (const input of inputs) {
      const t = tasks.find(task => task.id === input.taskId)!;
      const workspace = await this.retainedRemote(stub, input, "workspace", "read");
      try {
        await this.fundedRetainedCommand(input, stub);
        r = await run(`git -C ${WORK} fetch --quiet ${q(workspace.remote)} ${q(`+refs/heads/${input.branch}:refs/flaregit/tasks/${input.taskId}`)}`, gitAuthEnv(workspace.token));
        await this.retainedAuthority(input, stub);
        const head = (await run(`git -C ${WORK} rev-parse refs/flaregit/tasks/${input.taskId}`)).stdout.trim();
        if (!r.success || head !== input.commit) return { ok: false, error: `Task ${t.id} head does not match the frozen checkpoint` };
        // Preserve both the original checkpoint and its recorded base before any squash or repair.
        await this.pinInput(input, WORK, activeCanonical, stub, run);
        const changed = await run(input.base === null ? `git -C ${WORK} ls-tree -r --name-only -z ${q(input.commit)}` : `git -C ${WORK} diff --name-only -z ${q(input.base)} ${q(input.commit)}`);
        if (!changed.success) return { ok: false, error: `Could not inspect contributor changes for ${t.id}` };
        const touched = changed.stdout.split("\0").filter(Boolean);
        const bad = touched.filter((f) => isProtectedPath(f, settings.protectedPaths) || !inAgentScope(t, f) || !inAgentScope({ allowedScope: settings.allowedScope }, f));
        if (bad.length) return { ok: false, error: `Contributor change rejected: ${bad.join(", ")}` };
      } finally { await workspace.close(); }
    }

    const ai = new WorkersAIClient({ binding: this.env.AI, gatewayId: this.env.AI_GATEWAY_ID, model: DEFAULT_CODE_MODEL, maxOutputTokens: 8192, maxCalls: 8, beforeDispatch: async ({ model, inputBytes, maxOutputTokens }) => {
      if (!spending || model !== DEFAULT_CODE_MODEL) throw new Error("Managed repair budget unavailable");
      await assertManagedInitiator(this.env, stub, parentWorkflowId, params.accountKey);
      await globalOf(this.env).consumeManagedSpend(spendRunId, inputBytes, maxOutputTokens, 0);
    } });
    let round = 0;
    candidate.repairAttempts = structuredClone(state.candidates[candidate.id]?.repairAttempts ?? candidate.repairAttempts);
    round = Math.max(0, ...candidate.repairAttempts.map(attempt => attempt.round));
    await stub.recordComposition(candidate.id, candidate.repairAttempts);
    const repair = async (type: "text_conflict" | "behavior_failure", files: string[], evidence?: VerificationEvidence): Promise<boolean> => {
      if (nativeOnly) return false; // Native integrity never grants implicit model repair authority.
      const started = Date.now();
      round += 1;
      if (round > MAX_REPAIR_ROUNDS) return false;
      const contents: Record<string, string> = {};
      for (const f of files) {
        const parts = f.split("/");
        if (f.startsWith("/") || parts.some((part) => !part || part === "." || part === "..")) return false;
        const ancestors = parts.map((_, i) => `${WORK}/${parts.slice(0, i + 1).join("/")}`);
        if (!(await run(ancestors.map((ancestor) => `test ! -L ${q(ancestor)}`).join(" && "))).success) return false;
        contents[f] = (await sb.readFile(`${WORK}/${f}`)).content;
      }
      // Whole-file model responses cannot preserve values the model is forbidden to see.
      // Leave credential-bearing files untouched for an explicit contributor correction.
      if (Object.values(contents).some((content) => redactSecrets(content) !== content)) {
        candidate.repairAttempts.push({ round, prompt: `Resolve ${type}`, patch: "", affectedContracts: [], diagnosticError: "Automatic repair refused: an editable file contains credentials; a contributor must resolve it", durationMs: Date.now() - started, timestamp: new Date().toISOString() });
        await stub.recordComposition(candidate.id, candidate.repairAttempts);
        return false;
      }
      const prompt = buildRepairPrompt({
        repoDir: WORK, candidate, tasks, round, conflictType: type,
        editableFiles: files, fileContents: contents, failureEvidence: evidence, protectedPaths: settings.protectedPaths, model: ai.asModel(),
      });
      const proposed = parseRepairResponse(await ai.complete(prompt));
      if (proposed.size === 0) return false;
      for (const [file, content] of proposed) {
        if (!files.includes(file) || /^(<<<<<<<|=======|>>>>>>>)/m.test(content)) return false;
        await sb.writeFile(`${WORK}/${file}`, content.endsWith("\n") ? content : `${content}\n`);
      }
      const committed = await run(`git -C ${WORK} add -A && git -C ${WORK} commit --quiet --allow-empty -m ${q(`FlareGit repair round ${round}`)}`);
      const patch = committed.success ? (await run(`git -C ${WORK} diff HEAD^ HEAD -- ${files.map(q).join(" ")}`)).stdout : "";
      candidate.repairAttempts.push({ round, prompt: redactSecrets(`Resolve ${type} in ${files.join(", ")}`), patch: redactSecrets(patch), affectedContracts: [], diagnosticError: committed.success ? "" : "Repair commit failed", durationMs: Date.now() - started, timestamp: new Date().toISOString() });
      await stub.recordComposition(candidate.id, candidate.repairAttempts);
      return committed.success;
    };

    let protectedRepairCommit: string | undefined;
    let protectedRepairNeedsRevision=Boolean(recovery);
    let recoveredNativeEvidence: VerificationEvidence | undefined;
    const protectedRepair = async (): Promise<boolean> => {
      const result = await stub.protectedBrowserRepairPlan(candidate.id,parentWorkflowId);
      if (!result.eligible || result.plan.source.kind !== 'committed-browser-failure') return false;
      if (++round > MAX_REPAIR_ROUNDS) return false;
      const sourceContext = structuredClone(result.sourceContext), plan = structuredClone(result.plan), planDigest = await repairDigest(JSON.stringify(plan));
      const marker: NonNullable<CandidateGeneration['repairAttempts'][number]['protectedRepair']> = {kind:'browser',sourceCommit:sourceContext.scope.commit,sourceDigest:sourceContext.sourceDigest,planDigest,status:'requested'};
      const attempt: CandidateGeneration['repairAttempts'][number] = {round,prompt:'Repair the frozen protected browser contract',patch:'',affectedContracts:[...plan.failedCaseIds],diagnosticError:'Protected model dispatch acknowledgement pending',durationMs:0,timestamp:new Date().toISOString(),protectedRepair:marker};
      candidate.repairAttempts.push(attempt); await stub.recordComposition(candidate.id,candidate.repairAttempts);
      const started = Date.now();
      const authorize = async () => { await this.retainedAuthority(inputs[0]!,stub); const current=await stub.protectedBrowserRepairPlan(candidate.id,parentWorkflowId); if(!current.eligible || JSON.stringify(current.plan)!==JSON.stringify(plan) || JSON.stringify(current.sourceContext)!==JSON.stringify(sourceContext))throw Error('Frozen protected repair authority changed'); };
      try {
        await authorize(); const provider=await stub.isolatedSourceProvider(sourceContext); await authorize();
        const source=await captureTrustedGitSource({scope:sourceContext.scope,provider,authorize,reader:{readObject:async(kind,hash,maxBytes,signal)=>{signal.throwIfAborted();return sb.readGitObject(kind,hash,maxBytes);}}});
        if(source.sourceManifest.digest!==sourceContext.sourceDigest)throw Error('Original protected repair source digest differs');
        let patch: RepairPatch;
        try{patch=await stub.executeProtectedBrowserRepair(candidate.id,parentWorkflowId,round,source);}catch{
          const outcome=await stub.protectedRepairOutcome(candidate.id,parentWorkflowId,round,sourceContext);
          if(outcome.phase!=='completed'||!outcome.patch||outcome.attemptId!==outcome.patch.attemptId)throw Error('Original model dispatch remains unconfirmed');
          patch=outcome.patch; // Read-only recovery of the same durable patch; no successor model request.
        }
        await authorize(); marker.modelAttemptId=patch.attemptId; marker.status='patch_ready'; attempt.diagnosticError='Protected native application acknowledgement pending'; await stub.recordComposition(candidate.id,candidate.repairAttempts);
        const applied=await applyProtectedNativeRepair(plan,source,patch,{directory:WORK,authorize,exec:run,readFileBytes:path=>sb.readFileBytes(path),writeFile:(path,content)=>sb.writeFile(path,content),readGitObject:(kind,hash,maxBytes)=>sb.readGitObject(kind,hash,maxBytes)},settings.landing==='squash'?{kind:'squash',acceptedBase:sourceContext.expectedBase??''}:{kind:'merge'});
        protectedRepairCommit=applied.commit;protectedRepairNeedsRevision=true; marker.resultCommit=applied.commit;
        attempt.patch=redactSecrets((await run(`git -C ${WORK} diff --no-ext-diff --no-textconv ${q(sourceContext.scope.commit)} ${q(applied.commit)} -- ${patch.changes.map(change=>q(change.path)).join(' ')}`)).stdout);
        attempt.durationMs=Date.now()-started; attempt.diagnosticError='New exact repair commit awaits independent native/build/browser verification'; await stub.recordComposition(candidate.id,candidate.repairAttempts);
        return true;
      } catch {
        marker.status='unknown'; attempt.durationMs=Date.now()-started; attempt.diagnosticError='Original protected repair dispatch or native acknowledgement is unconfirmed; saved source, failure and model receipt require reconciliation';
        await stub.recordComposition(candidate.id,candidate.repairAttempts); return false;
      }
    };

    const protectedConflictRepair=async():Promise<boolean>=>{
      try{
      if(candidate.expectedAcceptedBase===null||++round>MAX_REPAIR_ROUNDS)return false;
      const derived=await stub.protectedConflictContext(candidate.id,parentWorkflowId,sb.nativeRunId,crypto.randomUUID());
      const receipt=await sb.inspectProtectedConflict(derived.context),result=await stub.protectedConflictRepairPlan(candidate.id,parentWorkflowId,sb.nativeRunId,receipt.commandId,derived.context.attemptId);
      if(!result.eligible||result.plan.source.kind!=='uncommitted-conflict-input')return false;
      const plan=structuredClone(result.plan),context=structuredClone(result.context),snapshot=structuredClone(receipt.snapshot),planDigest=await repairDigest(JSON.stringify(plan));
      if(plan.source.kind!=='uncommitted-conflict-input')return false;
      const marker:NonNullable<CandidateGeneration['repairAttempts'][number]['protectedRepair']>={kind:'text',text:{nativeRunId:sb.nativeRunId,commandId:receipt.commandId,attemptId:context.attemptId},sourceCommit:snapshot.head,sourceDigest:plan.source.sourceDigest,planDigest,status:'requested'};
      const attempt:CandidateGeneration['repairAttempts'][number]={round,prompt:'Repair the frozen native text conflict',patch:'',affectedContracts:[...plan.textConflictPaths],diagnosticError:'Original protected conflict model acknowledgement pending',durationMs:0,timestamp:new Date().toISOString(),protectedRepair:marker};candidate.repairAttempts.push(attempt);await stub.recordComposition(candidate.id,candidate.repairAttempts);
      const inputPin=await retainConflictInputGitPin({candidateId:candidate.id,attemptId:context.attemptId,commit:snapshot.head,directory:WORK,remote:activeCanonical.remote,token:activeCanonical.token,exec:run,beforeCommand:async phase=>{if(phase==='before')await this.fundedRetainedCommand(inputs[0]!,stub);else await this.retainedAuthority(inputs[0]!,stub);}});
      await stub.recordProtectedConflictInputPin(candidate.id,parentWorkflowId,sb.nativeRunId,receipt.commandId,context.attemptId,round,inputPin);
      const started=Date.now(),authorize=async()=>{await this.retainedAuthority(inputs[0]!,stub);const current=await stub.protectedConflictRepairPlan(candidate.id,parentWorkflowId,sb.nativeRunId,receipt.commandId,context.attemptId);if(!current.eligible||JSON.stringify(current.plan)!==JSON.stringify(plan)||JSON.stringify(current.context)!==JSON.stringify(context))throw Error('Frozen native conflict authority changed');};
      try{
        const files=[];for(const file of plan.files){await authorize();const bytes=await sb.readFileBytes(`${WORK}/${file.path}`);await authorize();files.push({path:file.path,kind:'file' as const,bytes});}
        let patch:RepairPatch;try{patch=await stub.executeProtectedConflictRepair(candidate.id,parentWorkflowId,sb.nativeRunId,receipt.commandId,context.attemptId,round,files);}catch{const outcome=await stub.protectedConflictRepairOutcome(candidate.id,parentWorkflowId,sb.nativeRunId,receipt.commandId,context.attemptId,round);if(outcome.phase!=='completed'||!outcome.patch||outcome.attemptId!==outcome.patch.attemptId)throw Error('Original conflict model remains unknown');patch=outcome.patch;}
        await authorize();marker.modelAttemptId=patch.attemptId;marker.status='patch_ready';await stub.recordComposition(candidate.id,candidate.repairAttempts);
        const applied=await applyProtectedNativeConflictRepair(plan,context,snapshot,patch,{directory:WORK,authorize,exec:run,readFileBytes:path=>sb.readFileBytes(path),writeFile:(path,content)=>sb.writeFile(path,content),readGitObject:(kind,hash,maxBytes)=>sb.readGitObject(kind,hash,maxBytes)},settings.landing==='squash'?{kind:'squash',acceptedBase:context.acceptedBase,coauthors:tasks.map(task=>`Co-authored-by: ${task.contributor.name} <${task.contributor.id}@users.flaregit.com>`)}:{kind:'merge'});
        protectedRepairCommit=applied.commit;protectedRepairNeedsRevision=false;marker.resultCommit=applied.commit;attempt.patch=redactSecrets((await run(`git -C ${WORK} diff --no-ext-diff --no-textconv ${q(snapshot.head)} ${q(applied.commit)} -- ${patch.changes.map(file=>q(file.path)).join(' ')}`)).stdout);attempt.durationMs=Date.now()-started;attempt.diagnosticError='Native conflict repaired to a new exact commit; independent verification remains required';await stub.recordComposition(candidate.id,candidate.repairAttempts);return true;
      }catch{marker.status='unknown';attempt.durationMs=Date.now()-started;attempt.diagnosticError='Original native conflict model or command acknowledgement requires reconciliation; no successor model request permitted';await stub.recordComposition(candidate.id,candidate.repairAttempts);return false;}
      }catch{return false;} // Unsupported native shape or an unknown inspector receipt never grants repair.
    };

    if(textRecovery&&savedRepair&&textIdentity){
      const original=structuredClone(textRecovery),patch=original.outcome.patch;if(!patch)throw Error('Original completed text patch unavailable');
      const binding=(value:typeof original)=>JSON.stringify({plan:value.plan,context:value.context,scope:value.scope,snapshot:value.snapshot,provider:value.provider,pinRef:value.pinRef,outcome:value.outcome}),expectedBinding=binding(original);
      const authorize=async()=>{await this.retainedAuthority(inputs[0]!,stub);const current=await stub.protectedConflictRepairRecovery(candidate.id,parentWorkflowId,savedRepair.round,textIdentity,sb.nativeRunId);if(binding(current)!==expectedBinding)throw Error('Original text source or model receipt changed');};
      await authorize();await this.fundedRetainedCommand(inputs[0]!,stub);const fetched=await run(`git -C ${WORK} fetch --quiet ${q(activeCanonical.remote)} ${q(`+${original.pinRef}:${original.pinRef}`)}`,gitAuthEnv(activeCanonical.token));await authorize();
      if(!fetched.success||(await run(`git -C ${WORK} rev-parse ${q(original.pinRef)}`)).stdout.trim()!==original.snapshot.head)throw Error('Unverified original conflict input pin readback differs');
      if(!(await run(`git -c core.hooksPath=/dev/null -C ${WORK} checkout --quiet --detach ${q(original.snapshot.head)}`)).success)throw Error('Original conflict HEAD checkout unconfirmed');
      const ports={directory:WORK,authorize,exec:run,readFileBytes:(path:string)=>sb.readFileBytes(path),writeFile:(path:string,content:string)=>sb.writeFile(path,content),readGitObject:(kind:'commit'|'tree'|'blob',hash:string,max:number)=>sb.readGitObject(kind,hash,max)};
      await reconstructProtectedNativeConflict(original.context,original.snapshot,{...ports,inspectConflict:async()=>{const current=await stub.protectedConflictContext(candidate.id,parentWorkflowId,sb.nativeRunId,original.context.attemptId);const inspected=await sb.inspectProtectedConflict(current.context);return inspected.snapshot;}});
      const applied=await applyProtectedNativeConflictRepair(original.plan,original.context,original.snapshot,patch,ports,settings.landing==='squash'?{kind:'squash',acceptedBase:original.context.acceptedBase,coauthors:tasks.map(task=>`Co-authored-by: ${task.contributor.name} <${task.contributor.id}@users.flaregit.com>`)}:{kind:'merge'});
      const attempt=candidate.repairAttempts.find(value=>value.round===savedRepair.round),marker=attempt?.protectedRepair;if(!attempt||!marker||marker.resultCommit&&marker.resultCommit!==applied.commit)throw Error('Recorded deterministic text repair result differs');
      marker.modelAttemptId=patch.attemptId;marker.resultCommit=applied.commit;marker.status='patch_ready';attempt.patch=redactSecrets((await run(`git -C ${WORK} diff --no-ext-diff --no-textconv ${q(original.snapshot.head)} ${q(applied.commit)} -- ${patch.changes.map(file=>q(file.path)).join(' ')}`)).stdout);attempt.diagnosticError='Original text patch reconstructed; exact native verification and candidate pin remain required';await stub.recordComposition(candidate.id,candidate.repairAttempts);
      protectedRepairCommit=applied.commit;protectedRepairNeedsRevision=false;
      const saved=state.candidates[candidate.id],native=saved?.evidenceId?state.evidence[saved.evidenceId]:undefined;if(native?.status==='passed'&&native.candidateCommit===applied.commit&&native.candidateTree===applied.tree)recoveredNativeEvidence=native;
    }

    if(recovery&&savedRepair&&recoveryIdentity){
      const original=structuredClone(recovery),patch=original.outcome.patch;
      if(!patch)throw Error('Completed historical patch unavailable');
      const binding=(value:typeof original)=>JSON.stringify({plan:value.plan,sourceContext:value.sourceContext,provider:value.provider,pinRef:value.pinRef,outcome:value.outcome});
      const expectedBinding=binding(original);
      const authorize=async()=>{await this.retainedAuthority(inputs[0]!,stub);const current=await stub.protectedRepairRecovery(candidate.id,parentWorkflowId,savedRepair.round,recoveryIdentity,sb.nativeRunId);if(binding(current)!==expectedBinding)throw Error('Original historical repair binding changed');};
      await authorize();await this.fundedRetainedCommand(inputs[0]!,stub);
      const fetched=await run(`git -C ${WORK} fetch --quiet ${q(activeCanonical.remote)} ${q(`+${original.pinRef}:${original.pinRef}`)}`,gitAuthEnv(activeCanonical.token));await authorize();
      if(!fetched.success||(await run(`git -C ${WORK} rev-parse ${q(original.pinRef)}`)).stdout.trim()!==original.sourceContext.scope.commit)return{ok:false,error:'Immutable original repair source pin readback differs; no new model request was made'};
      if(!(await run(`git -c core.hooksPath=/dev/null -C ${WORK} checkout --quiet --detach ${q(original.sourceContext.scope.commit)}`)).success)throw Error('Original repair source checkout unconfirmed');
      const source=await captureTrustedGitSource({scope:original.sourceContext.scope,provider:original.provider,authorize,reader:{readObject:async(kind,hash,maxBytes,signal)=>{signal.throwIfAborted();return sb.readGitObject(kind,hash,maxBytes);}}});
      if(source.sourceManifest.digest!==original.sourceContext.sourceDigest)throw Error('Historical repair source digest differs');
      const result=await applyProtectedNativeRepair(original.plan,source,patch,{directory:WORK,authorize,exec:run,readFileBytes:path=>sb.readFileBytes(path),writeFile:(path,content)=>sb.writeFile(path,content),readGitObject:(kind,hash,maxBytes)=>sb.readGitObject(kind,hash,maxBytes)},settings.landing==='squash'?{kind:'squash',acceptedBase:original.sourceContext.expectedBase??''}:{kind:'merge'});
      const attempt=candidate.repairAttempts.find(value=>value.round===savedRepair.round),marker=attempt?.protectedRepair;
      if(!attempt||!marker||marker.resultCommit&&marker.resultCommit!==result.commit)throw Error('Historical deterministic repair commit differs from saved result');
      marker.modelAttemptId=patch.attemptId;marker.resultCommit=result.commit;marker.status='patch_ready';attempt.diagnosticError='Historical exact repair commit reconstructed; independent verification and revision pin remain required';
      attempt.patch=redactSecrets((await run(`git -C ${WORK} diff --no-ext-diff --no-textconv ${q(original.sourceContext.scope.commit)} ${q(result.commit)} -- ${patch.changes.map(file=>q(file.path)).join(' ')}`)).stdout);
      await stub.recordComposition(candidate.id,candidate.repairAttempts);protectedRepairCommit=result.commit;
      const saved=state.candidates[candidate.id],native=saved?.evidenceId?state.evidence[saved.evidenceId]:undefined;
      if(native?.status==='passed'&&native.candidateCommit===result.commit&&native.candidateTree===result.tree)recoveredNativeEvidence=native;
    }

    for (const [index, t] of tasks.entries()) {
      if(recovery||textRecovery)break;
      if (candidate.expectedAcceptedBase === null && index === 0) {
        const first = await run(`git -C ${WORK} checkout --quiet --detach ${q(candidate.participatingCommits[t.id]!)}`);
        if (!first.success) return { ok: false, error: "First contributor checkpoint is unavailable" };
        continue;
      }
      const m = await run(`git -C ${WORK} merge ${candidate.expectedAcceptedBase === null ? "--allow-unrelated-histories " : ""}--no-ff -m ${q(`FlareGit candidate ${candidate.id}: ${t.id}`)} refs/flaregit/tasks/${t.id}`);
      if (m.success) continue;
      const files = (await run(`git -C ${WORK} diff --name-only --diff-filter=U`)).stdout.split("\n").filter(Boolean);
      if(isolatedBrowser){if(await protectedConflictRepair())continue;return{ok:false,error:'Protected text conflict could not be safely repaired; unsupported delete/mode/unborn conflicts or pending product decisions require explicit resolution, and original source/model acknowledgements remain preserved'};}
      if (nativeOnly) return { ok: false, error: "Native Git conflict requires explicit contributor resolution; saved branches are preserved" };
      if (files.length === 0 || !(await repair("text_conflict", files))) return { ok: false, error: "Conflict repair failed" };
    }

    // Squash landing: one commit on the accepted base with the combined tree. It is rebuilt before every
    // verification, so the commit that is verified, reviewed and published is always the squashed one.
    const squash = async () => {
      if (settings.landing !== "squash") return true;
      if (candidate.expectedAcceptedBase === null) return false;
      const tree = (await run(`git -C ${WORK} rev-parse ${q("HEAD^{tree}")}`)).stdout.trim();
      const coauthors = [...new Map(tasks.map((t) => [t.contributor.name, `Co-authored-by: ${t.contributor.name} <${t.contributor.id}@users.flaregit.com>`])).values()];
      const message = [`Land ${tasks.map((t) => t.id).join(" + ")}`, "", ...tasks.map((t) => `- ${t.goal}`), "", ...coauthors].join("\n");
      const made = await run(`git -C ${WORK} commit-tree ${q(tree)} -p ${q(candidate.expectedAcceptedBase)} -m ${q(message)}`);
      if (!made.success) return false;
      return (await run(`git -C ${WORK} checkout --quiet --detach ${q(made.stdout.trim())}`)).success;
    };

    for (;;) {
      let verifiedOutput:IsolatedBuildArtifact|undefined;
      if (!protectedRepairCommit && !(await squash())) return { ok: false, error: "Could not create the squashed commit" };
      const commit = (await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
      const tree = nativeOnly ? (await run(`git -C ${WORK} rev-parse ${q(`${commit}^{tree}`)}`)).stdout.trim() : undefined;
      const nativeInput = { repoDir: WORK, candidateCommit: commit, candidateTree: tree, expectedBase: candidate.expectedAcceptedBase, acceptedTarget: candidate.acceptedTarget, requirementsVersion: candidate.frozenPolicyVersion, policy: candidate.frozenVerificationPolicy, protectedPaths: settings.protectedPaths, allowedScope: settings.allowedScope, contributors: candidate.frozenContributorProofs, landing: settings.landing };
      const v = await run(nativeOnly
        ? `cd /opt/flaregit && bun src/core/verification/cli.ts --native-integrity ${q(JSON.stringify(nativeInput))}`
        : `cd /opt/flaregit && bun src/core/verification/cli.ts ${settings.fixture} ${WORK} ${commit} ${candidate.expectedAcceptedBase} ${candidate.frozenPolicyVersion} ${q(JSON.stringify(candidate.frozenVerificationPolicy))}`
      );
      if (!v.success) return { ok: false, error: `Verifier crashed: ${v.stderr.slice(-500)}` };
      const parsedEvidence = JSON.parse(v.stdout.trim().split("\n").at(-1)!) as VerificationEvidence;
      const evidence=integrationVerificationEvidence(candidate,parsedEvidence);
      if(recoveredNativeEvidence){
        const saved=recoveredNativeEvidence;
        if(evidence.status!=='passed'||evidence.candidateCommit!==saved.candidateCommit||evidence.candidateTree!==saved.candidateTree||evidence.expectedAcceptedBase!==saved.expectedAcceptedBase||evidence.requirementsVersion!==saved.requirementsVersion||JSON.stringify(evidence.policy)!==JSON.stringify(saved.policy)||evidence.testBundleDigest!==saved.testBundleDigest||evidence.toolchainDigest!==saved.toolchainDigest)return{ok:false,error:'Recovered repair native proof changed; original revision and model receipt remain preserved'};
        evidence.id=saved.id;evidence.timestamp=saved.timestamp;recoveredNativeEvidence=undefined;
      }
      await stub.recordVerification(candidate.id, commit, evidence);
      if (evidence.status === "passed") {
        // Retain the verified Git candidate before optional R2 copies.
        const pin=await retainCandidateGitPin({candidateId:candidate.id,commit,...(protectedRepairCommit===commit&&protectedRepairNeedsRevision?{revision:true as const}:{}),directory:WORK,remote:activeCanonical.remote,token:activeCanonical.token,exec:(command,env)=>sb.exec(command,env,()=>this.retainedAuthority(inputs[0]!,stub)),beforeCommand:async phase=>{if(phase==="before")await this.fundedRetainedCommand(inputs[0]!,stub);else await this.retainedAuthority(inputs[0]!,stub);}});
        await stub.recordCandidateProtectedPin(candidate.id,commit,{...pin,workflowId:parentWorkflowId,...(protectedRepairCommit===commit&&protectedRepairNeedsRevision?{revision:true as const}:{})});
        if(protectedRepairCommit===commit){const marker=candidate.repairAttempts.find(attempt=>attempt.protectedRepair?.resultCommit===commit)?.protectedRepair;if(!marker)throw Error('Exact protected repair marker differs');marker.status='applied';await stub.recordComposition(candidate.id,candidate.repairAttempts);}
        if(isolatedBrowser){
          try{
            if(!tree||!this.env.UNTRUSTED_EXECUTION||!this.env.ISOLATED_EXECUTION_IMAGE)throw Error('Exact isolated execution identity unavailable');
            const policy=await deriveTrustedBrowserPolicy(candidate.frozenVerificationPolicy,candidate.frozenRequirements.filter(requirement=>requirement.status==="approved").map(requirement=>requirement.id)),input=inputs[0]!;
            const receipt=await verifyIsolatedGitCandidate({scope:{attemptId:crypto.randomUUID(),projectId:params.projectId,incarnation:input.incarnation,commit,tree,policyDigest:policy.digest},workflowId:parentWorkflowId,candidateId:candidate.id,actorId:input.actorId,accountKey:input.accountKey,sourceDigest:'0'.repeat(64),image:this.env.ISOLATED_EXECUTION_IMAGE,policyVersion:candidate.frozenPolicyVersion,expectedBase:candidate.expectedAcceptedBase,candidateSnapshotDigest:'0'.repeat(64)},{ledger:stub,namespace:this.env.UNTRUSTED_EXECUTION,verifiedOutput:artifact=>{verifiedOutput=artifact;},reader:{readObject:async(kind,hash,maxBytes,signal)=>{signal.throwIfAborted();return sb.readGitObject(kind,hash,maxBytes);}}});
            // Optional durable copies must match the controller's final browser-bound digest.
            evidence.builtOutputDigest=receipt.buildDigest;
          }catch(error){
            const verificationStage=error instanceof IsolatedGitVerificationError?error.stage:'source';
            const reason=verificationStage==='source'?'Committed source or current authority could not be confirmed':verificationStage==='build'?'Isolated build or exact cleanup is unconfirmed':'Trusted browser checks or exact session cleanup did not pass';
            await stub.logActivity('FlareGit',`verification.${verificationStage}_failed`,reason).catch(()=>console.warn('Verification failure activity unavailable'));
            if(verificationStage==='browser' && await protectedRepair()) continue;
            return {ok:false,error:`${reason}. The candidate Git pin, original failure and contributor checkpoints remain preserved; inspect the saved ${verificationStage} and repair attempt before retrying`};
          }
        }
        const previewKey=`build-${params.projectId}-${commit}`;
        try {
          const hasPage = verifiedOutput !== undefined || (!nativeOnly && settings.fixture === "ticket-booking" && (await run(`test -f ${WORK}/index.html`)).success);
          if (hasPage) {
            if(verifiedOutput){
              const scope=await stub.previewStorageScope(commit,state.canonicalRepoName);
              const output=await previewStorageFromIsolatedArtifact(scope,verifiedOutput);
              await publishPreviewStorageManifest(output.manifest,{
                prefix:buildPrefix(params.projectId,commit),bucket:this.env.EVIDENCE_BUCKET,
                reserve:async value=>assertPreviewStorageAdmission(await globalOf(this.env).reservePreviewStorage(value)),
                writer:{begin:id=>globalOf(this.env).reservePreviewWriter(buildPrefix(params.projectId,commit),id),beforePut:(id,path)=>globalOf(this.env).beginPreviewPut(buildPrefix(params.projectId,commit),id,path),settledPut:(id,path)=>globalOf(this.env).finishPreviewPut(buildPrefix(params.projectId,commit),id,path),finish:id=>globalOf(this.env).finishPreviewWriter(buildPrefix(params.projectId,commit),id)},
                authorize:async()=>{await this.retainedAuthority(inputs[0]!,stub);const current=await stub.previewStorageScope(commit,state.canonicalRepoName);if(JSON.stringify(current)!==JSON.stringify(scope))throw new Error("Preview storage owner or incarnation changed");},
                getFile:output.getFile,
              });
            }else{
              if(!spending)throw new Error("Optional preview funding is unavailable");
              await ensureBuild(this.env,params.projectId,commit,state.canonicalRepoName,spending.accountKey,{candidateId:candidate.id,workflowId:parentWorkflowId});
            }
          }
        } catch(error) {
          const unfinished=(await globalOf(this.env).previewStorageWriterState(buildPrefix(params.projectId,commit)).catch(()=>({unfinished:true}))).unfinished;
          await globalOf(this.env).setNativeComputeFailureReason(previewKey,unfinished?"storage_reconciliation":error instanceof PreviewStorageAdmissionError?error.reason:"build_failed").catch(()=>console.warn("Preview failure state unavailable"));
          await stub.logActivity("FlareGit","preview.failed","Optional preview is unavailable; verified Git candidate and review evidence remain saved").catch(()=>console.warn("Preview failure activity unavailable"));
        }
        try {
          const scope=await stub.previewStorageScope(commit,state.canonicalRepoName);
          const bytes=new TextEncoder().encode(JSON.stringify(evidence));
          const sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");
          const writerId=crypto.randomUUID(),controller=globalOf(this.env);
          const plannedKey=`evidence/${scope.projectId}/${scope.incarnation}/${evidence.id}.json`;
          await stub.recordScopedEvidenceCopy(evidence.id,plannedKey,scope.incarnation);
          if(JSON.stringify(await stub.previewStorageScope(commit,state.canonicalRepoName))!==JSON.stringify(scope))throw new Error("Evidence copy owner scope changed before allocation");
          assertPreviewStorageAdmission(await controller.reserveEvidenceStorage(scope,evidence.id,bytes.byteLength,sha256));
          const evidenceKey=await controller.registerPreviewEvidenceCopy(scope,evidence.id,bytes.byteLength,sha256,writerId);
          if(evidenceKey!==plannedKey)throw new Error("Evidence copy immutable key changed");
          let pending=false;
          try {
            const existing=await this.env.EVIDENCE_BUCKET.head(evidenceKey);
            if(existing){if(existing.size!==bytes.byteLength||existing.customMetadata?.sha256!==sha256||existing.customMetadata?.projectId!==scope.projectId||existing.customMetadata?.incarnation!==scope.incarnation)throw new Error("Immutable evidence copy scope changed");}
            else {
              const current=await stub.previewStorageScope(commit,state.canonicalRepoName);
              if(JSON.stringify(current)!==JSON.stringify(scope))throw new Error("Evidence copy owner scope changed");
              await controller.beginPreviewPut(evidenceKey,writerId,"");pending=true;
              const stored=await this.env.EVIDENCE_BUCKET.put(evidenceKey,bytes,{onlyIf:{etagDoesNotMatch:"*"},httpMetadata:{contentType:"application/json"},customMetadata:{projectId:scope.projectId,incarnation:scope.incarnation,commit,tree:evidence.candidateTree,sha256}});
              if(!stored)throw new Error("Evidence copy write is unconfirmed");
              await controller.finishPreviewPut(evidenceKey,writerId,"");pending=false;
            }
          } finally {if(!pending)await controller.finishPreviewWriter(evidenceKey,writerId);}

        } catch {
          await stub.logActivity("FlareGit","evidence.copy_failed","Optional evidence storage copy failed; authoritative verification evidence remains in the repository ledger").catch(()=>console.warn("Evidence copy activity unavailable"));
        }
        return { ok: true, commit, evidenceId: evidence.id, branch };
      }
      if (nativeOnly) return { ok: false, error: "Native Git integrity failed; no customer commands or automatic repairs ran" };
      const editable = (await run(`git -C ${WORK} ls-files`)).stdout
        .split("\n")
        .filter((f) => f && inAgentScope({ allowedScope: settings.allowedScope }, f) && !isProtectedPath(f, settings.protectedPaths) && /\.(ts|tsx|js|jsx|mjs|css|json|html|md|py|go|rs|rb|java|c|h|cpp|sh)$/.test(f))
        .slice(0, 40);
      if (!(await repair("behavior_failure", editable, evidence))) return { ok: false, error: "Protected verification failed and repair did not fix it" };
    }
    } finally {
      await canonical?.close();
      await sb.destroy();
    }
  }

  /** Compare-and-swap: only moves main if it still equals the verified base. */
  /**
   * Compare-and-swap publication. It depends on nothing that lived through review: a fresh workspace fetches the
   * stored candidate ref, proves it is the reviewed commit, and only moves the branch if it still equals the base.
   */
  private async casPush(candidate: CandidateGeneration, commit: string, stub: Stub, branch: string, journal:PublicationJournalEntry): Promise<{ ok: true;readbackScope?:string } | { ok: false; error: string; stale?: boolean }> {
    if(candidate.acceptedTarget){
      try{assertIntegrationPublicationTarget(candidate,journal,await stub.getState(),commit,branch);}catch{return{ok:false,error:"Frozen accepted target publication scope or journal is unavailable; no Git push was started"};}
      const observed=await stub.observeCandidatePublicationReadback(candidate.id,journal.id,commit);
      if(observed.ref!==candidate.acceptedTarget.ref||observed.commit!==commit)return{ok:false,error:"Publication readback belongs to another target or commit; the original prepared journal remains preserved"};
      if(observed.status==="landed"&&observed.readbackScope)return{ok:true,readbackScope:observed.readbackScope};
      if(observed.status!=="not_landed")return{ok:false,error:"Original target publication could not be confirmed; read-only reconciliation remains pending"};
      if(!await stub.authorizeCandidatePublication(candidate.id,commit))return{ok:false,error:"Original target readback did not find the commit and new write authority is unavailable; the prepared journal remains preserved"};
    }
    const targetRef=candidate.acceptedTarget?.ref??`refs/heads/${branch}`,publicationBranch=candidate.acceptedTarget?.branch??branch;
    const input = await stub.prepareRetainedInput(candidate.participatingTaskIds[0]!,this.computeWorkflowId!,candidate.id,crypto.randomUUID());
    const sb = await this.sandbox(`publish-${candidate.id}`);
    let credential: Awaited<ReturnType<FlareGitIntegrationWorkflow["canonicalRemote"]>> | undefined;
    try {
    const canonical = credential = await this.canonicalRemote(stub,input);
    await this.fundedRetainedCommand(input,stub);
    const dir = "/workspace/publish";
    const fetched = await sb.exec(
      `rm -rf ${dir} && git init --quiet ${dir} && git -C ${dir} fetch --quiet --filter=blob:none ${q(canonical.remote)} ${q(`refs/flaregit/candidates/${candidate.id}:refs/flaregit/candidate`)}`,
      gitAuthEnv(canonical.token)
    );
    if (!fetched.success) return { ok: false, error: "The stored candidate could not be read back; nothing was published" };
    const head = (await sb.exec(`git -C ${dir} rev-parse refs/flaregit/candidate`)).stdout.trim();
    if (head !== commit) return { ok: false, error: "Stored candidate differs from the reviewed commit; nothing was published" };
    // A response can be lost after Git accepted the push. Prove ancestry from the real
    // canonical branch before retrying, including when another contributor advanced it.
    const alreadyLanded = () => publicationInHistory((command, env) => sb.exec(command, env), dir, canonical.remote, canonical.token, publicationBranch, commit, candidate.expectedAcceptedBase === null);
    if (await alreadyLanded()) return { ok: true };
    await this.fundedRetainedCommand(input,stub);
    if (!await stub.authorizeCandidatePublication(candidate.id, commit)) return { ok: false, error: "The approving owner no longer authorizes this exact publication; nothing was pushed" };
    const updated = await checkpointedNativeRefUpdate(this.env,{projectId:this.projectId!,workflowId:this.computeWorkflowId!,candidate,journal,commit,ref:targetRef},()=>sb.exec(
      `git -C ${dir} push --quiet --force-with-lease=${q(`${targetRef}:${candidate.expectedAcceptedBase ?? ""}`)} ${q(canonical.remote)} ${q(`${commit}:${targetRef}`)}`,
      gitAuthEnv(canonical.token),
      ()=>authorizeIntegrationPublicationDispatch(candidate,journal,commit,stub)
    ));
    if(updated.kind==='held-before')return{ok:false,error:'Private publication checkpoint held before the actual ref update; the prepared journal and stored Git remain preserved'};
    if(updated.kind==='held-after')return{ok:false,error:'Private publication checkpoint held after the ref update; exact read-only history reconciliation is required'};
    const res=updated.result;
    if (res.success) return { ok: true };
    // A retried step may find its own earlier push already landed: that is success, not a conflict.
    if (await alreadyLanded()) return { ok: true };
    return { ok: false, error: `Canonical ref update refused: ${res.stderr.replace(/Bearer [^\s"]+/g, "Bearer ***").slice(-300).trim()}`, stale: /stale info|rejected/i.test(res.stderr) };
    } finally {
      await credential?.close();
      await sb.destroy();
    }
  }

}
