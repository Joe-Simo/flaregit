import { retainGitInput, retainedGitInputRef } from "./retained-git-input.js";
import type { RetainedInput } from "./retained-inputs.js";
import { validateRecoveryRemote } from "./private-recovery-bundle.js";
import { admitGitOperation } from "./core-git-budget.js";
import {rebaseAcceptedFollowup,mirrorAcceptedFollowup} from "./accepted-followups.js";
import { assertPreviewStorageAdmission, PreviewStorageAdmissionError } from "./preview-storage.js";
import { inspectPreviewStorageManifest, publishPreviewStorageManifest } from "./preview-storage-upload.js";
import { admitNativeCompute } from "./native-compute.js";
import { isSafeRef } from "../core/sanitize.js";
import { buildPrefix } from "./preview-access.js";
import { publicationInHistory } from "./publication.js";
import { pushMirror } from "./mirror.js";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { WorkersAIClient, DEFAULT_CODE_MODEL } from "../ai/workers-ai.js";
import { buildRepairPrompt, parseRepairResponse, MAX_REPAIR_ROUNDS } from "../core/pipeline/repair.js";
import type { CandidateGeneration, VerificationEvidence } from "../core/types.js";
import type { Env } from "./env.js";
import type { ClaimResult, Ledger, PrepareResult } from "./durable-object.js";
import { gitAuthEnv, q } from "./shell.js";
import { ledgerOf } from "./scenario-workflow.js";
import { settingsFor } from "../core/command-policy.js";
import { inAgentScope, isProtectedPath, redactSecrets } from "../agents/prompt.js";
import { globalOf, reserveManagedAgent, assertManagedInitiator } from "./projects.js";
import type { WorkflowOutcome } from "./durable-object.js";

export interface IntegrationParams {
  projectId: string;
  accountKey?: string;
  /** One to eight changes, merged in this order. */
  taskIds: string[];
}

const WORK = "/workspace/integration";

type Stub = Ledger;

export class FlareGitIntegrationWorkflow extends WorkflowEntrypoint<Env, IntegrationParams> {
  override async run(event: WorkflowEvent<IntegrationParams>, step: WorkflowStep) {
    const repository = ledgerOf(this.env, event.payload.projectId) as Stub;
    const admitted = await step.do("repository-dispatch-identity", () => repository.admitIntegrationDispatch(event.instanceId,event.payload.taskIds));
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
    try { result = await this.execute(event, step, accepted); }
    catch (error) { if(!publicationConfirmed)await record("failed"); throw error; }
    // A receipt delivery failure after successful publication must retry that
    // outcome, rather than overwrite accepted work with a fabricated failure.
    await record(result.status);
    return result;
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
      claim = (await step.do(`claim-landing-${turn}`, async () => (await stub.claimLanding({ holder, taskIds: event.payload.taskIds })) as never)) as ClaimResult;
      if (claim.candidate || claim.decision || claim.reason !== "Another landing holds the lease") break;
      await step.sleep(`queued-${turn}`, "30 seconds");
    }
    if (!claim.candidate) {
      if (!claim.decision) await step.do("report-not-started", async () => stub.logActivity("FlareGit", "integration.not_started", `Integration of ${event.payload.taskIds.join(" + ")} did not start: ${claim.reason}`));
      return { status: claim.decision ? "needs_decision" as const : "not_started" as const, reason: claim.reason, decision: claim.decision };
    }
    const candidate = claim.candidate;

    const integrated = await step.do(
      "compose-repair-verify",
      { retries: { limit: 1, delay: "10 seconds", backoff: "constant" }, timeout: "20 minutes" },
      async () => this.composeRepairVerify(candidate, event.payload, stub, event.instanceId)
    );

    if (!integrated.ok) {
      await step.do("abort", async () => stub.abortPublish(candidate.id, undefined, integrated.error, "failed"));
      return { status: "blocked" as const, error: integrated.error };
    }

    // Human control over history: the verified candidate waits until a person accepts this exact commit.
    await step.do("await-review", async () => stub.awaitReview(candidate.id, integrated.commit, event.instanceId));
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

    const prepared = (await step.do("prepare-publish", async () => (await stub.preparePublish(candidate.id)) as never)) as PrepareResult;
    if (!prepared.ok || !prepared.journal) {
      await step.do("abort-prepare", async () => stub.abortPublish(candidate.id, undefined, prepared.error ?? "refused", prepared.stale ? "stale" : "failed"));
      return { status: prepared.stale ? "stale" as const : "blocked" as const, error: prepared.error };
    }

    const pushed = await step.do("cas-push-to-artifacts", { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } }, async () => this.casPush(candidate, integrated.commit, stub, integrated.branch));
    if (!pushed.ok) {
      await step.do("abort-push", async () => stub.abortPublish(candidate.id, prepared.journal!.id, pushed.error, pushed.stale ? "stale" : "failed"));
      return { status: pushed.stale ? "stale" as const : "blocked" as const, error: pushed.error };
    }
    await step.do("complete-publish", async () => stub.completePublish(prepared.journal!.id));
    // Core publication is durable before optional follow-ups consume resources.
    await recordAccepted();
    // Stacked changes: re-base every dependent change onto what just landed, so the stack keeps tracking upstream.
    await step.do("rebase-dependents", { retries: { limit: 1, delay: "5 seconds" } }, async () => rebaseAcceptedFollowup(stub,integrated.commit,()=>this.rebaseDependents(candidate,integrated.commit,integrated.branch,stub)));
    // Composition already required remote-verified original/base pins and durable receipts.
    // Accepted history never depends on the optional stack/mirror follow-ups below.
    // Mirror delivery is optional and has an existing owner-controlled retry route.
    await step.do("mirror-to-github", {retries:{limit:1,delay:"5 seconds"}}, async () => mirrorAcceptedFollowup(stub,integrated.commit,async()=>{
      let mirror:Awaited<ReturnType<FlareGitIntegrationWorkflow["sandbox"]>>|undefined;
      try {
        const cfg=await stub.mirrorSecret();
        if(!cfg)return{skipped:true as const};
        mirror=await this.sandbox(`mirror-${candidate.id}`);
        const input=await stub.prepareRetainedInput(candidate.participatingTaskIds[0]!,event.instanceId,candidate.id,crypto.randomUUID(),true);
        const canonical=await this.retainedRemote(stub,input,"canonical","read");
        try { await this.fundedRetainedCommand(input,stub);return await pushMirror({exec:mirror.exec},{target:cfg.target,githubToken:cfg.token,canonicalRemote:canonical.remote,canonicalToken:canonical.token,branch:integrated.branch,commit:integrated.commit}); }
        finally { await canonical.close(); }
      } finally {if(mirror)await mirror.destroy();}
    }));
    return { status: "accepted" as const, commit: integrated.commit, evidenceId: integrated.evidenceId };
  }

  /**
   * After a landing, replay each dependent change on top of its parent's new tip (`git rebase --onto new old`),
   * walking the stack downwards. A conflict stops that branch of the stack and flags the change for its author.
   */
  private async rebaseDependents(candidate: CandidateGeneration, landed: string, branch: string, stub: Stub): Promise<{ rebased: string[]; blocked: string[] }> {
    const workflowId = candidate.workflowInstanceId ?? this.computeWorkflowId;
    if (!workflowId) throw new Error("Registered integration workflow required for dependent updates");
    const state = await stub.getState(), tasks = Object.values(state.tasks);
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
    const sb = await this.sandbox(`rebase-${candidate.id}`), rebased:string[] = [], blocked:string[] = [];
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
        const canonical = await this.canonicalRemote(stub,input);
        let workspace: Awaited<ReturnType<FlareGitIntegrationWorkflow["retainedRemote"]>> | undefined;
        try {
          workspace = await this.retainedRemote(stub,input,"workspace","write");
          const run = async (command:string,env?:Record<string,string>) => {
            await this.fundedRetainedCommand(input,stub);
            const result = await sb.exec(command,env);
            await this.retainedAuthority(input,stub); return result;
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
              result = await run(`git -C ${WORK} checkout --quiet --detach ${q(input.commit)} && git -C ${WORK} rebase --onto ${q(item.target)} ${q(input.base)}`);
              if (!result.success) {
                await run(`git -C ${WORK} rebase --abort`);
                await stub.applyRebase(item.id,{failed:"Could not rebase onto the recorded parent; original checkpoint and base are protected",expected:input});
                blocked.push(item.id); continue;
              }
              const newCommit=(await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
              const beforeCommand=async(phase:"before"|"after")=>{if(phase==="before")await this.fundedRetainedCommand(input,stub);else await this.retainedAuthority(input,stub);};
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
      return {rebased,blocked};
    } finally { await sb.destroy(); }
  }

  private projectId = "";

  /** Every allocation is isolated; interrupted work is recovered from retained Git refs. */
  private computeAccountKey?: string;
  private computeWorkflowId?: string;
  private async sandbox(id: string) {
    const repository=ledgerOf(this.env,this.projectId);
    await assertManagedInitiator(this.env,repository,this.computeWorkflowId,this.computeAccountKey);
    const allocationId=`native-${crypto.randomUUID()}`;
    await admitNativeCompute(this.env,this.computeAccountKey!,allocationId);
    const sb = this.env.INTEGRATOR.getByName(allocationId);
    return {
      exec: (cmd: string, env?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env }),
      readFile: async (p: string) => ({ content: await sb.readFile(p) }),
      readFileBytes: (p: string) => sb.readFileBytes(p),
      writeFile: (p: string, c: string) => sb.writeFile(p, c),
      destroy: async () => {
        try { await sb.destroy(); }
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
          const cleanup = await globalOf(this.env).reserveCoreGitOperation(`retained-cleanup-${crypto.randomUUID()}`,input.accountKey,{accountUsdMicros:null,globalUsdMicros:null});
          if (cleanup.allowed && await repo.revokeToken(issued.plaintext)) await stub.markRetainedCredentialRevoked(input.id,purpose,issued.plaintext);
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
    try { await this.retainedAuthority(input, stub); }
    catch { await close(); throw new Error("Contribution authority changed before credential use"); }
    return { remote, token: issued.plaintext, close };
  }
  private async canonicalRemote(stub: Stub, input: RetainedInput) { return this.retainedRemote(stub, input, "canonical", "write"); }
  private async pinInput(input: RetainedInput, directory: string, remote: {remote:string;token:string}, stub: Stub, exec: (command:string,env?:Record<string,string>)=>Promise<{success:boolean;stdout:string}>) {
    const beforeCommand = async (phase: "before" | "after") => { if (phase === "before") await this.fundedRetainedCommand(input, stub); else await this.retainedAuthority(input, stub); };
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
    const settings = settingsFor(candidate.frozenVerificationPolicy);
    const externalOnly = candidate.frozenExternalChecksPolicy?.mode === "external";
    if (externalOnly && (settings.fixture !== "custom" || !candidate.frozenExternalChecksPolicy?.checks.some((check) => check.required) || !candidate.frozenContributorProofs?.length)) return { ok: false, error: "External CI requires a custom repository, frozen contributor proofs and at least one required check" };
    const spendRunId = `repair-${candidate.id}`;
    let spending: Awaited<ReturnType<typeof reserveManagedAgent>> | null = null;
    try {
      if (!externalOnly) await assertManagedInitiator(this.env, stub, parentWorkflowId, params.accountKey);
      spending = externalOnly ? null : await reserveManagedAgent(this.env, params.accountKey, spendRunId);
      if (spending) await globalOf(this.env).consumeManagedSpend(spendRunId, 0, 0, 600);
    } catch {
      return { ok: false, error: "Managed verification budget unavailable; saved contributor checkpoints remain available. Configure a budget or use external checks." };
    }
    const state = await stub.getState();
    const tasks = candidate.participatingTaskIds.map((id) => state.tasks[id]!);
    const inputs = await Promise.all(tasks.map(task => stub.prepareRetainedInput(task.id, parentWorkflowId, candidate.id, crypto.randomUUID())));
    if (!inputs.length || inputs.some(input => input.commit !== candidate.participatingCommits[input.taskId])) return { ok: false, error: "A frozen contribution advanced before preservation; no candidate was composed" };
    const sb = await this.sandbox(`integrate-${candidate.id}`);
    let canonical: Awaited<ReturnType<FlareGitIntegrationWorkflow["canonicalRemote"]>> | undefined;
    try {
    const run = async (cmd: string, env?: Record<string, string>) => sb.exec(cmd, env);
    if (externalOnly && (candidate.frozenContributorProofs!.length !== tasks.length || !candidate.participatingTaskIds.every((id) => candidate.frozenContributorProofs!.some((proof) => proof.id === id && proof.commit === candidate.participatingCommits[id] && proof.ref === `refs/flaregit/tasks/${id}`)))) return { ok: false, error: "Frozen contributor proofs do not match every participating checkpoint" };
    canonical = await this.canonicalRemote(stub, inputs[0]!);
    const activeCanonical = canonical;

    await this.fundedRetainedCommand(inputs[0]!, stub);
    let r = await run(`rm -rf ${WORK} && git clone --quiet ${q(activeCanonical.remote)} ${WORK}`, gitAuthEnv(activeCanonical.token));
    if (!r.success) return { ok: false, error: "Could not clone canonical repository" };
    // The clone's HEAD names the remote's real default branch (Artifacts metadata can differ for imported repos).
    const branch = (await run(`git -C ${WORK} symbolic-ref --short HEAD`)).stdout.trim() || state.defaultBranch || "main";
    // The default branch name comes from the (possibly imported) repository: whitelist it before it reaches any command.
    if (!isSafeRef(branch)) throw new Error("Default branch name contains characters FlareGit does not accept");
    await run(`git -C ${WORK} config user.name FlareGit && git -C ${WORK} config user.email integrator@flaregit.com && git -C ${WORK} checkout --quiet --detach ${q(candidate.expectedAcceptedBase)}`);

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
        const changed = await run(`git -C ${WORK} diff --name-only -z ${q(input.base)} ${q(input.commit)}`);
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
    candidate.repairAttempts = [];
    await stub.recordComposition(candidate.id, []);
    const repair = async (type: "text_conflict" | "behavior_failure", files: string[], evidence?: VerificationEvidence): Promise<boolean> => {
      if (externalOnly) return false; // External CI never grants implicit model repair authority.
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

    for (const t of tasks) {
      const m = await run(`git -C ${WORK} merge --no-ff -m ${q(`FlareGit candidate ${candidate.id}: ${t.id}`)} refs/flaregit/tasks/${t.id}`);
      if (m.success) continue;
      const files = (await run(`git -C ${WORK} diff --name-only --diff-filter=U`)).stdout.split("\n").filter(Boolean);
      if (externalOnly) return { ok: false, error: "Native Git conflict requires explicit contributor resolution; saved branches are preserved" };
      if (files.length === 0 || !(await repair("text_conflict", files))) return { ok: false, error: "Conflict repair failed" };
    }

    // Squash landing: one commit on the accepted base with the combined tree. It is rebuilt before every
    // verification, so the commit that is verified, reviewed and published is always the squashed one.
    const squash = async () => {
      if (settings.landing !== "squash") return true;
      const tree = (await run(`git -C ${WORK} rev-parse ${q("HEAD^{tree}")}`)).stdout.trim();
      const coauthors = [...new Map(tasks.map((t) => [t.contributor.name, `Co-authored-by: ${t.contributor.name} <${t.contributor.id}@users.flaregit.com>`])).values()];
      const message = [`Land ${tasks.map((t) => t.id).join(" + ")}`, "", ...tasks.map((t) => `- ${t.goal}`), "", ...coauthors].join("\n");
      const made = await run(`git -C ${WORK} commit-tree ${q(tree)} -p ${q(candidate.expectedAcceptedBase)} -m ${q(message)}`);
      if (!made.success) return false;
      return (await run(`git -C ${WORK} checkout --quiet --detach ${q(made.stdout.trim())}`)).success;
    };

    for (;;) {
      if (!(await squash())) return { ok: false, error: "Could not create the squashed commit" };
      const commit = (await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
      const tree = externalOnly ? (await run(`git -C ${WORK} rev-parse ${q(`${commit}^{tree}`)}`)).stdout.trim() : undefined;
      const nativeInput = { repoDir: WORK, candidateCommit: commit, candidateTree: tree, expectedBase: candidate.expectedAcceptedBase, requirementsVersion: candidate.frozenPolicyVersion, policy: candidate.frozenVerificationPolicy, protectedPaths: settings.protectedPaths, allowedScope: settings.allowedScope, contributors: candidate.frozenContributorProofs, landing: settings.landing };
      const v = await run(externalOnly
        ? `cd /opt/flaregit && bun src/core/verification/cli.ts --native-integrity ${q(JSON.stringify(nativeInput))}`
        : `cd /opt/flaregit && bun src/core/verification/cli.ts ${settings.fixture} ${WORK} ${commit} ${candidate.expectedAcceptedBase} ${candidate.frozenPolicyVersion} ${q(JSON.stringify(candidate.frozenVerificationPolicy))}`
      );
      if (!v.success) return { ok: false, error: `Verifier crashed: ${v.stderr.slice(-500)}` };
      const evidence = JSON.parse(v.stdout.trim().split("\n").at(-1)!) as VerificationEvidence;
      await stub.recordVerification(candidate.id, commit, evidence);
      if (evidence.status === "passed") {
        // Retain the verified Git candidate before optional R2 copies.
        await this.fundedRetainedCommand(inputs[0]!, stub);
        const shared = await run(`git -C ${WORK} push --quiet ${q(activeCanonical.remote)} ${q(`${commit}:refs/flaregit/candidates/${candidate.id}`)}`, gitAuthEnv(activeCanonical.token));
        if (!shared.success) return { ok: false, error: "Could not store the candidate for review" };
        const previewKey=`build-${params.projectId}-${commit}`;
        try {
          const hasPage = !externalOnly && settings.fixture === "ticket-booking" && (await run(`test -f ${WORK}/index.html`)).success;
          if (hasPage) {
            const built = await run(`bun /opt/flaregit/src/core/verification/build-preview.ts ${q(WORK)} /tmp/build-out`);
            if (!built.success) throw new Error("Optional preview build failed");
            const scope=await stub.previewStorageScope(commit,state.canonicalRepoName);
            const manifest=await inspectPreviewStorageManifest({exec:argv=>sb.exec(argv.map(q).join(" "))},scope);
            await publishPreviewStorageManifest(manifest,{
              prefix:buildPrefix(params.projectId,commit),bucket:this.env.EVIDENCE_BUCKET,
              reserve:async value=>assertPreviewStorageAdmission(await globalOf(this.env).reservePreviewStorage(value)),
      writer:{begin:id=>globalOf(this.env).reservePreviewWriter(buildPrefix(params.projectId,commit),id),beforePut:(id,path)=>globalOf(this.env).beginPreviewPut(buildPrefix(params.projectId,commit),id,path),settledPut:(id,path)=>globalOf(this.env).finishPreviewPut(buildPrefix(params.projectId,commit),id,path),finish:id=>globalOf(this.env).finishPreviewWriter(buildPrefix(params.projectId,commit),id)},
              authorize:async()=>{const current=await stub.previewStorageScope(commit,state.canonicalRepoName);if(JSON.stringify(current)!==JSON.stringify(scope))throw new Error("Preview storage owner or incarnation changed");},
              getFile:path=>sb.readFileBytes(path),
            });
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
      if (externalOnly) return { ok: false, error: "Native Git integrity failed; no customer commands or automatic repairs ran" };
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
  private async casPush(candidate: CandidateGeneration, commit: string, stub: Stub, branch: string): Promise<{ ok: true } | { ok: false; error: string; stale?: boolean }> {
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
    const alreadyLanded = () => publicationInHistory((command, env) => sb.exec(command, env), dir, canonical.remote, canonical.token, branch, commit);
    if (await alreadyLanded()) return { ok: true };
    if (!await stub.authorizeCandidatePublication(candidate.id, commit)) return { ok: false, error: "The approving owner no longer authorizes this exact publication; nothing was pushed" };
    await this.fundedRetainedCommand(input,stub);
    const res = await sb.exec(
      `git -C ${dir} push --quiet --force-with-lease=${q(`refs/heads/${branch}:${candidate.expectedAcceptedBase}`)} ${q(canonical.remote)} ${q(`${commit}:refs/heads/${branch}`)}`,
      gitAuthEnv(canonical.token)
    );
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
