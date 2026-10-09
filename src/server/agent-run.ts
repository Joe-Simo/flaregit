import type { AgentExecutionEgressScope } from "./agent-execution-egress.js";
import type { AgentNativeAttemptIdentity } from "./agent-runtime-ledger.js";
import {acceptedTargetSchema,assertCompatibleAcceptedTargetBatch,effectiveTaskAcceptedTarget} from "../core/accepted-target.js";
import { globalOf, reserveManagedAgent, assertManagedInitiator } from "./projects.js";
import { DEFAULT_CODE_MODEL } from "../ai/workers-ai.js";
import { WorkersAIClient } from "../ai/workers-ai.js";
import { assertAgentWrites, buildAgentPrompt, inAgentScope, isProtectedPath, redactSecrets } from "../agents/prompt.js";
import { parseRepairResponse } from "../core/pipeline/repair.js";
import { settingsFor } from "../core/command-policy.js";
import type { Task } from "../core/types.js";
import type { Ledger } from "./durable-object.js";
import type { Env } from "./env.js";
import type { ArtifactsRepoCapability } from "../artifacts/cloudflare.js";
import { gitAuthEnv, q } from "./shell.js";

const WORK = "/workspace/task";
const MAX_CONTEXT_BYTES = 120_000;
const MAX_FILE_BYTES = 60_000;
const SHA = /^[0-9a-f]{40}$/;
const stopped = (task: Task | undefined) => !task || ["accepted", "cancelled", "integrating", "verifying"].includes(task.status);

/** Durable proposal and parent make retries reconstruct the same Git commit.
 * The service never treats a new model call as recovery of an already saved proposal.
 */
export type AgentExecutionLedger = Ledger;

/** Backend-only capability port around the actual AgentSandbox RPC. Positive
 * receipts must follow installed HTTP/HTTPS interceptions, Internet denial and
 * native CA trust. This interface never carries a Git token or VM environment. */
export interface RestrictedAgentRuntime {
  configure(attempt: AgentNativeAttemptIdentity, scope: AgentExecutionEgressScope): Promise<{ configured: boolean; internet: boolean; httpIntercept: boolean; httpsIntercept: boolean; caTrusted: boolean }>;
  assertConfigured(attempt: AgentNativeAttemptIdentity, scope: AgentExecutionEgressScope): Promise<void>;
  cleanup(attempt: AgentNativeAttemptIdentity): Promise<{ credentialsRevoked: boolean }>;
}

export async function runAgentTask(env: Env, ledger: AgentExecutionLedger, task: Task, runId = task.agentWorkflowInstanceId, options?: { stopAfterProposal?: boolean; resumeFrom?: string; accountKey?: string; parentWorkflowId?: string; restrictedEgress?: boolean; restrictedRuntime?: RestrictedAgentRuntime }): Promise<{ commit: string; recovered?: boolean; proposalId?: string }> {
  const restricted = options?.restrictedEgress === true || options?.restrictedRuntime !== undefined;
  if (!runId || !/^[A-Za-z0-9_-]{1,200}$/.test(runId)) throw new Error("A durable agent workflow identity is required");
  let durable = await ledger.getAgentRun(runId);
  if (durable && options?.resumeFrom && durable.resumedFrom !== options.resumeFrom) throw new Error("Resume selection differs from the durable run identity");
  if (durable && (durable.taskId !== task.id || durable.branch !== task.workspace.branch)) throw new Error("Durable agent run belongs to a different change");
  const state = await ledger.getState();
  const selectedTarget=effectiveTaskAcceptedTarget(task);
  const selectedGeneration=task.targetGeneration?{eventId:task.targetGeneration.eventId,generation:task.targetGeneration.generation}:undefined;
  const assertTarget=(currentState=state)=>{
    const currentTask=currentState.tasks[task.id];
    const currentTarget=currentTask?effectiveTaskAcceptedTarget(currentTask):undefined;
    const currentGeneration=currentTask?.targetGeneration?{eventId:currentTask.targetGeneration.eventId,generation:currentTask.targetGeneration.generation}:undefined;
    if(JSON.stringify(selectedGeneration)!==JSON.stringify(currentGeneration)||durable&&JSON.stringify(durable.targetGeneration)!==JSON.stringify(selectedGeneration))throw new Error("Agent target generation changed");
    if(Boolean(selectedTarget)!==Boolean(currentTarget))throw new Error("Agent task accepted target binding changed");
    if(!selectedTarget){if(durable?.acceptedTarget)throw new Error("Saved agent accepted target binding changed");return;}
    const target=acceptedTargetSchema.parse(selectedTarget);
    if(currentState.policyVersion!==state.policyVersion)throw new Error("Repository policy changed during bound agent execution");
    if(!currentTarget||target.projectId!==currentState.projectId||target.canonicalRepoName!==currentState.canonicalRepoName||!(task.baseCommit===null?target.kind==="unborn":SHA.test(task.baseCommit))||!task.dependsOn&&task.baseCommit!==target.acceptedCommit)throw new Error("Agent accepted target scope or recorded base changed");
    assertCompatibleAcceptedTargetBatch([target,currentTarget]);
    if(task.dependsOn){const parent=currentState.tasks[task.dependsOn];if(!parent?.acceptedTarget)throw new Error("Agent stack target is unavailable");const parentTarget=acceptedTargetSchema.parse(effectiveTaskAcceptedTarget(parent));if(parent.status==="accepted"){if((["projectId","incarnation","canonicalRepoName","ref","branch"] as const).some(key=>target[key]!==parentTarget[key]))throw new Error("Accepted parent target identity differs");}else assertCompatibleAcceptedTargetBatch([target,parentTarget]);}
    if(durable){if(!durable.acceptedTarget)throw new Error("Saved agent run has no frozen accepted target");assertCompatibleAcceptedTargetBatch([target,durable.acceptedTarget]);}
  };
  assertTarget();
  if (durable?.phase === "checkpointed" && durable.pushedCommit) {
    await assertManagedInitiator(env,ledger,options?.parentWorkflowId,options?.accountKey,task.id);
    return {commit:durable.pushedCommit};
  }
  if (restricted && !options?.restrictedRuntime) throw new Error("Restricted agent execution is unavailable; no Internet or VM credential fallback is permitted");
  if (stopped(state.tasks[task.id])) throw new Error("Change is no longer available for agent work");
  const settings = settingsFor(selectedTarget?acceptedTargetSchema.parse(selectedTarget).policy:state.verificationPolicy);
  await assertManagedInitiator(env, ledger, options?.parentWorkflowId, options?.accountKey, task.id);
  const spending = await reserveManagedAgent(env, options?.accountKey, runId);
  await globalOf(env).consumeManagedSpend(runId, 0, 0, 300);
  const deadline = Date.now() + 300_000;
  const attempt=await ledger.beginAgentNativeAttempt({workflowId:options?.parentWorkflowId??runId,runId,taskId:task.id,phase:options?.stopAfterProposal?"proposal":"apply",attemptId:crypto.randomUUID(),nativeId:crypto.randomUUID()});
  const sb = env.AGENT.getByName(`agent-${attempt.nativeId}`);
  let restrictedScope: AgentExecutionEgressScope | undefined;
  let repo: ArtifactsRepoCapability | undefined, token: string | undefined,credentialId:string|undefined;
  const authorize=async()=>{await assertManagedInitiator(env,ledger,options?.parentWorkflowId,options?.accountKey,task.id);if(selectedTarget)assertTarget(await ledger.getState());};
  const assertRestricted = async () => {
    if (!restricted) return;
    if (!restrictedScope || !options?.restrictedRuntime) throw new Error("Restricted agent policy has not been confirmed");
    await options.restrictedRuntime.assertConfigured(attempt, restrictedScope);
  };
  const configureRestricted = async (remote: string, expectedTip: string | null, access: "read" | "write") => {
    if (!restricted) return;
    if (!options?.restrictedRuntime) throw new Error("Restricted agent runtime unavailable");
    await authorize();
    const scope: AgentExecutionEgressScope = { projectId: attempt.projectId, incarnation: attempt.incarnation, actorId: attempt.actorId, accountKey: attempt.accountKey, taskId: task.id, runId, workflowId: attempt.workflowId, branchGeneration: selectedGeneration?.generation ?? 0, canonicalRepoName: state.canonicalRepoName, forkRepoName: task.workspace.repoName, remote, branch: task.workspace.branch, expectedTip, access };
    const receipt = await options.restrictedRuntime.configure(attempt, scope);
    if (receipt.configured !== true || receipt.internet !== false || receipt.httpIntercept !== true || receipt.httpsIntercept !== true || receipt.caTrusted !== true) throw new Error("Restricted agent interception, Internet denial or CA trust was not confirmed");
    restrictedScope = scope; await assertRestricted(); await authorize();
  };
  const run = async (cmd: string, e?: Record<string, string>) => {
    await authorize(); await assertRestricted();
    if (restricted && Object.keys(e ?? {}).some(key => key !== "GIT_AUTHOR_DATE" && key !== "GIT_COMMITTER_DATE")) throw new Error("Restricted agent VM environment cannot carry Git credentials");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Managed container deadline exhausted");
    const result=await sb.exec(["sh","-c",cmd],{env:e,timeoutMs:remaining});await assertRestricted();await authorize();return result;
  };
  try {
    repo = await env.ARTIFACTS.get(task.workspace.repoName);
    const remote = String((await repo.info()).remote);
    if (restricted) await configureRestricted(remote, task.currentCommit, "read");
    else {
    const scope=options?.stopAfterProposal?"read":"write",issuanceId=crypto.randomUUID();
    if(!await ledger.beginAgentCredential(attempt.attemptId,issuanceId,scope,Date.now()+300000))throw new Error("Agent credential issuance is unconfirmed");
    credentialId=issuanceId;
    const issued=await repo.createToken(scope,300);token=issued.plaintext;const expiry=Date.parse(issued.expiresAt);
    try{await ledger.recordAgentCredential(attempt.attemptId,issuanceId,token,expiry);}catch{await ledger.recordAgentCredential(attempt.attemptId,issuanceId,token,expiry);}
    if(issued.scope!==scope||!Number.isSafeInteger(expiry)||expiry<=Date.now()||expiry>Date.now()+305000)throw new Error("Agent credential scope or expiry is unavailable");
    }
    await assertManagedInitiator(env,ledger,options?.parentWorkflowId,options?.accountKey,task.id);
    let r = await run(`rm -rf ${WORK} && git clone --quiet ${q(remote)} ${WORK}`, restricted ? undefined : gitAuthEnv(token!));
    if (!r.success) throw new Error("Agent could not clone its saved branch; retry the run");
    const branchRef = `refs/heads/${task.workspace.branch}`;
    const remoteRef = `refs/remotes/origin/${task.workspace.branch}`;
    const observed = await run(`git -C ${WORK} rev-parse --verify --quiet ${q(remoteRef)}`);
    const observedHead = observed.success ? observed.stdout.trim() : "";
    if (observedHead && !SHA.test(observedHead)) throw new Error("Saved branch identity is unavailable");
    if (!durable && options?.resumeFrom) {
      const resumed = await ledger.resumeAgentRun(runId, task.id, options.resumeFrom);
      if (resumed.kind === "busy" || resumed.run.runId !== runId || !resumed.run.proposal) throw new Error("Selected proposal could not be resumed for this generation");
      durable = resumed.run;
    }
    if (!durable) {
      const priorRunId = state.tasks[task.id]?.agentRunId;
      const prior = priorRunId && priorRunId !== runId ? await ledger.getAgentRun(priorRunId) : null;
      if (prior?.phase === "failed" && prior.pushedCommit && prior.pushedCommit === observedHead) {
        const fresh = (await ledger.getState()).tasks[task.id];
        if (stopped(fresh) || fresh?.agentRunId !== priorRunId) throw new Error("Saved agent recovery ownership changed; no new model call was made");
        const recoveryDigest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(runId)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const recovered = await ledger.ingestCheckpoint({ eventId: `agent-recovery-${recoveryDigest}-${observedHead}`, taskId: task.id, commit: observedHead, ready: true });
        const latest = (await ledger.getState()).tasks[task.id];
        if (!recovered.applied && (latest?.currentCommit !== observedHead || latest.status !== "ready")) throw new Error("Saved push recovery checkpoint was refused");
        return { commit: observedHead, recovered: true };
      }
      if (prior?.phase === "failed" && prior.proposal && !prior.pushedCommit) throw new Error("An earlier failed run has a saved proposal without a confirmed push; inspect its proposal and branch before requesting new work");
      if (observedHead && observedHead !== state.tasks[task.id]!.currentCommit) {
        const recovered = await ledger.ingestCheckpoint({ eventId: `agent-recovered-${task.id}-${observedHead}`, taskId: task.id, commit: observedHead, ready: false });
        if (!recovered.applied && (await ledger.getState()).tasks[task.id]?.currentCommit !== observedHead) throw new Error("Saved branch advancement could not be reconciled; no model call was made");
      }
      const issue = task.issue ? await ledger.getIssue(task.issue) : null;
      const comments = await ledger.listComments(`change:${task.id}`);
      const claim = await ledger.claimAgentRun({ ...(selectedTarget?{acceptedTarget:structuredClone(selectedTarget)}:{}),...(selectedGeneration?{targetGeneration:selectedGeneration}:{}), runId, taskId: task.id, startingCommit: observedHead || task.currentCommit || task.baseCommit, branch: task.workspace.branch, startingBranchHead: observedHead || null,
        goal: task.goal, allowedScope: [...task.allowedScope], protectedPaths: [...settings.protectedPaths],
        context: { ...(issue ? { issue: { number: issue.number, title: issue.title.slice(0, 1000), summary: issue.body.slice(0, 6000) } } : {}), comments: comments.slice(-20).map((comment) => ({ id: comment.id, summary: `${comment.author}${comment.path ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ""}` : ""}: ${comment.body}`.slice(0, 1500) })) },
      });
      if (claim.kind === "busy") throw new Error("Another durable agent generation owns this change");
      durable = claim.run;
    }
    const ownership = await ledger.claimAgentRun({ ...(durable.acceptedTarget?{acceptedTarget:durable.acceptedTarget}:{}),...(durable.targetGeneration?{targetGeneration:durable.targetGeneration}:{}), runId: durable.runId, taskId: durable.taskId, branch: durable.branch, startingBranchHead: durable.startingBranchHead, startingCommit: durable.startingCommit, goal: durable.goal, context: durable.context, allowedScope: durable.allowedScope, protectedPaths: durable.protectedPaths });
    if (ownership.kind === "busy" || ownership.run.runId !== runId) throw new Error("Another durable agent generation owns this change");
    durable = ownership.run;
    assertTarget();
    if (durable.startingCommit===null && (selectedTarget?.kind!=="unborn" || durable.startingBranchHead!==null)) throw new Error("An absent baseline requires an unchanged unborn target and empty workspace branch");
    if (durable.taskId !== task.id || durable.branch !== task.workspace.branch || durable.phase === "failed") throw new Error("Agent generation is unavailable; inspect its saved proposal and branch");
    r = await run(durable.startingCommit===null ? `git -C ${WORK} checkout --quiet --orphan ${q(task.workspace.branch)} && git -C ${WORK} rm --quiet -rf --ignore-unmatch .` : `git -C ${WORK} checkout --quiet -B ${q(task.workspace.branch)} ${q(durable.startingCommit)}`);
    if (!r.success) throw new Error("Agent could not restore its branch; no changes were made");
    const frozenTask = { ...task, goal: durable.goal, allowedScope: durable.allowedScope };
    if (!durable.proposal) {
      if (observedHead && observedHead !== durable.startingCommit) throw new Error("Saved branch advanced before proposal; preserve the newer work and restart explicitly");
      const files: Record<string, string> = {}, secretFiles = new Set<string>();
      let total = 0;
      const listed = (await run(`git -C ${WORK} ls-files -z`)).stdout.split("\0").filter(Boolean);
      for (const file of listed) {
        if (!inAgentScope(frozenTask, file) || isProtectedPath(file, durable.protectedPaths) || !/\.(ts|tsx|js|jsx|mjs|cjs|css|json|html|md|py|go|rs|rb|java|c|h|cpp|sh|yml|yaml|toml)$/.test(file)) continue;
        assertAgentWrites(frozenTask, [file], durable.protectedPaths);
        if (!(await run(`test -f ${q(`${WORK}/${file}`)} && test ! -L ${q(`${WORK}/${file}`)}`)).success) continue;
        await authorize();await assertRestricted();const content = await sb.readFile(`${WORK}/${file}`);await assertRestricted();await authorize();
        if (redactSecrets(content) !== content) { secretFiles.add(file); continue; }
        if (content.length > MAX_FILE_BYTES || total + content.length > MAX_CONTEXT_BYTES) continue;
        total += content.length; files[file] = content;
      }
      const acceptedContext=durable.acceptedTarget&&durable.acceptedTarget.kind!=="unborn"?`Existing accepted behavior on ${durable.acceptedTarget.ref} at ${durable.acceptedTarget.acceptedCommit} (preserve unless this task explicitly proposes a change):\n${durable.acceptedTarget.requirements.filter(requirement=>requirement.status==="approved").map(requirement=>`- ${requirement.title}: ${requirement.description}`).join("\n")}`:"";
      // Shared multi-agent context: concurrent branches and persisted overlap warnings (agent-board.ts).
      const coordination = await ledger.agentCoordinationContext(runId, task.id);
      const context = [acceptedContext,...coordination,durable.context.issue ? `Issue #${durable.context.issue.number}: ${durable.context.issue.title}\n${durable.context.issue.summary}` : "", ...durable.context.comments.map((comment) => comment.summary), durable.startingCommit===null ? "Create the first contribution in this empty Git repository; no existing commit or accepted behavior exists." : `Continue from saved Git commit ${durable.startingCommit}.`].filter(Boolean).join("\n\n");
      const ai = new WorkersAIClient({ binding: env.AI, gatewayId: env.AI_GATEWAY_ID, model: DEFAULT_CODE_MODEL, maxCalls: spending.maxCalls, maxOutputTokens: spending.maxOutputTokens, beforeDispatch: async ({ model, inputBytes, maxOutputTokens }) => {
        if (model !== DEFAULT_CODE_MODEL || Date.now() >= deadline) throw new Error("Managed execution model or deadline unavailable");
        await authorize();
        await globalOf(env).consumeManagedSpend(runId, inputBytes, maxOutputTokens, 0);
        await authorize();
      } });
      const response=await ai.complete(buildAgentPrompt(frozenTask,task.contributor.name,files,settings.checkCommand,context));
      await authorize();
      const proposed=parseRepairResponse(response);
      if (!proposed.size) throw new Error("Model returned no file changes");
      assertAgentWrites(frozenTask, proposed.keys(), durable.protectedPaths);
      for (const file of proposed.keys()) if (secretFiles.has(file)) throw new Error("Agent proposed replacing a credential-bearing file; human editing is required");
      const normalized = Object.fromEntries([...proposed].map(([file, content]) => [file, content.endsWith("\n") ? content : `${content}\n`]));
      await authorize();
      if (!(await ledger.saveAgentProposal(runId, task.id, normalized))) throw new Error("Agent proposal was not durably saved for the active generation");
      durable = await ledger.getAgentRun(runId);
      if (!durable?.proposal) throw new Error("Saved agent proposal is unavailable");
    }
    await authorize();
    if (!(await ledger.saveAgentProposal(runId, task.id, durable.proposal.files))) throw new Error("Another agent generation superseded this run");
    if (options?.stopAfterProposal) return { commit: "", proposalId: runId };
    assertAgentWrites({ allowedScope: durable.allowedScope }, Object.keys(durable.proposal.files), durable.protectedPaths);
    for (const [file, content] of Object.entries(durable.proposal.files)) {
      const original = await run(`test -f ${q(`${WORK}/${file}`)} && test ! -L ${q(`${WORK}/${file}`)}`);
      if (original.success) { await authorize();await assertRestricted();const contentBefore = await sb.readFile(`${WORK}/${file}`);await assertRestricted();await authorize(); if (redactSecrets(contentBefore) !== contentBefore) throw new Error("Agent cannot replace a credential-bearing file"); }
      const dir = file.split("/").slice(0, -1).join("/");
      for (const prefix of file.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))) if ((await run(`test -L ${q(`${WORK}/${prefix}`)}`)).success) throw new Error("Agent write would traverse a repository symlink");
      if ((await run(`test -L ${q(`${WORK}/${file}`)}`)).success) throw new Error("Agent cannot replace a repository symlink");
      if (dir && !(await run(`mkdir -p ${q(`${WORK}/${dir}`)}`)).success) throw new Error("Agent directory could not be created");
      await authorize();await assertRestricted();await sb.writeFile(`${WORK}/${file}`,content);await assertRestricted();await authorize();
    }
    const date = `${Math.floor(Date.parse(durable.proposal.commitDate ?? durable.createdAt) / 1000)} +0000`;
    r = await run(`git -C ${WORK} add -A && git -C ${WORK} -c user.name=${q(`FlareGit agent ${task.id}`)} -c user.email=${q(`${task.id}@agents.flaregit.com`)} commit --quiet -m ${q(durable.goal)}`, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    if (!r.success) throw new Error("Agent could not reconstruct its saved proposal commit");
    const commit = (await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
    if (!SHA.test(commit) || (durable.pushedCommit && durable.pushedCommit !== commit)) throw new Error("Reconstructed proposal differs from the saved pushed commit");
    const changed = await run(durable.startingCommit===null ? `git -C ${WORK} diff-tree --root --no-commit-id --name-only -r -z ${q(commit)}` : `git -C ${WORK} diff --name-only -z ${q(durable.startingCommit)} ${q(commit)}`);
    if (!changed.success) throw new Error("Agent could not inspect its saved proposal");
    const filesChanged = changed.stdout.split("\0").filter(Boolean);
    assertAgentWrites({ allowedScope: durable.allowedScope }, filesChanged, durable.protectedPaths);
    if (stopped((await ledger.getState()).tasks[task.id])) throw new Error("Change was stopped before push; accepted history is unchanged");
    await authorize();
    if (!(await ledger.saveAgentProposal(runId, task.id, durable.proposal.files))) throw new Error("Agent generation changed before push");
    if (restricted) await configureRestricted(remote, durable.startingBranchHead, "write");
    const remoteHead = await run(`git ls-remote --heads ${q(remote)} ${q(branchRef)}`, restricted ? undefined : gitAuthEnv(token!));
    if (!remoteHead.success) throw new Error("Saved branch could not be inspected before publication");
    const tip = remoteHead.stdout.trim().split(/\s+/)[0] ?? "";
    if (tip !== commit) {
      if (tip !== (durable.startingBranchHead ?? "")) throw new Error("Another contributor advanced this branch; no work was overwritten");
      r = await run(`git -C ${WORK} push --quiet --force-with-lease=${q(`${branchRef}:${tip}`)} ${q(remote)} ${q(`${commit}:${branchRef}`)}`, restricted ? undefined : gitAuthEnv(token!));
      if (!r.success) throw new Error("Agent push outcome is unknown or refused; retry the saved proposal without regenerating it");
    }
    await authorize();
    if (!(await ledger.markAgentPushed(runId, task.id, commit))) throw new Error("Pushed branch is saved but run ownership changed; inspect its durable commit");
    const runDigest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(runId)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const eventId = `agent-${runDigest}-${commit}`;
    await authorize();
    const checkpoint = await ledger.ingestCheckpoint({ eventId, taskId: task.id, commit, ready: true, filesChanged });
    if (!checkpoint.applied && (await ledger.getState()).tasks[task.id]?.currentCommit !== commit) throw new Error("Pushed branch remains recoverable; checkpoint was refused");
    await authorize();
    if (!(await ledger.checkpointAgentRun(runId, task.id, eventId, commit))) throw new Error("Checkpoint was saved but agent completion is not confirmed");
    return { commit, ...(durable.resumedFrom ? { recovered: true } : {}) };
  } finally {
    const cleanupFailure = async (detail: string) => {
      try { await ledger.logActivity("FlareGit", "agent.cleanup_failed", detail); }
      catch { console.warn("Agent cleanup could not be recorded"); }
    };
    if (restricted && options?.restrictedRuntime) try {
      if (!(await options.restrictedRuntime.cleanup(attempt)).credentialsRevoked) await cleanupFailure("Restricted agent relay credential cleanup remains unconfirmed; its durable recovery records are preserved.");
    } catch { await cleanupFailure("Restricted agent relay credential cleanup remains unconfirmed; its durable recovery records are preserved."); }
    if(credentialId&&!await ledger.revokeAgentCredential(credentialId).catch(()=>false))await cleanupFailure("Agent credential cleanup remains unconfirmed; its durable recovery record is preserved.");
    try { repo?.[Symbol.dispose]?.(); } catch { console.warn("Agent repository capability disposal failed"); }
    try{await sb.destroy();if(!await ledger.confirmAgentNativeStopped(attempt.attemptId,attempt.nativeId))throw new Error("Native stop unavailable");}catch{await cleanupFailure("Agent container shutdown remains unconfirmed; saved identity, proposals and Git checkpoints remain available.");}
  }
}
