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

export async function runAgentTask(env: Env, ledger: AgentExecutionLedger, task: Task, runId = task.agentWorkflowInstanceId, options?: { stopAfterProposal?: boolean; resumeFrom?: string; accountKey?: string; parentWorkflowId?: string }): Promise<{ commit: string; recovered?: boolean; proposalId?: string }> {
  if (!runId || !/^[A-Za-z0-9_-]{1,200}$/.test(runId)) throw new Error("A durable agent workflow identity is required");
  let durable = await ledger.getAgentRun(runId);
  if (durable && options?.resumeFrom && durable.resumedFrom !== options.resumeFrom) throw new Error("Resume selection differs from the durable run identity");
  if (durable && (durable.taskId !== task.id || durable.branch !== task.workspace.branch)) throw new Error("Durable agent run belongs to a different change");
  if (durable?.phase === "checkpointed" && durable.pushedCommit) return { commit: durable.pushedCommit };
  const state = await ledger.getState();
  if (stopped(state.tasks[task.id])) throw new Error("Change is no longer available for agent work");
  const settings = settingsFor(state.verificationPolicy);
  await assertManagedInitiator(env, ledger, options?.parentWorkflowId, options?.accountKey, task.id);
  const spending = await reserveManagedAgent(env, options?.accountKey, runId);
  await globalOf(env).consumeManagedSpend(runId, 0, 0, 300);
  const deadline = Date.now() + 300_000;
  const sb = env.AGENT.getByName(`agent-${state.projectId}-${task.id}-${crypto.randomUUID()}`);
  let repo: ArtifactsRepoCapability | undefined, token: string | undefined;
  const run = (cmd: string, e?: Record<string, string>) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Managed container deadline exhausted");
    return sb.exec(["sh", "-c", cmd], { env: e, timeoutMs: remaining });
  };
  try {
    repo = await env.ARTIFACTS.get(task.workspace.repoName);
    const remote = String((await repo.info()).remote);
    token = (await repo.createToken(options?.stopAfterProposal ? "read" : "write", 1800)).plaintext;
    let r = await run(`rm -rf ${WORK} && git clone --quiet ${q(remote)} ${WORK}`, gitAuthEnv(token));
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
      const claim = await ledger.claimAgentRun({ runId, taskId: task.id, startingCommit: observedHead || task.currentCommit || task.baseCommit, branch: task.workspace.branch, startingBranchHead: observedHead || null,
        goal: task.goal, allowedScope: [...task.allowedScope], protectedPaths: [...settings.protectedPaths],
        context: { ...(issue ? { issue: { number: issue.number, title: issue.title.slice(0, 1000), summary: issue.body.slice(0, 6000) } } : {}), comments: comments.slice(-20).map((comment) => ({ id: comment.id, summary: `${comment.author}${comment.path ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ""}` : ""}: ${comment.body}`.slice(0, 1500) })) },
      });
      if (claim.kind === "busy") throw new Error("Another durable agent generation owns this change");
      durable = claim.run;
    }
    const ownership = await ledger.claimAgentRun({ runId: durable.runId, taskId: durable.taskId, branch: durable.branch, startingBranchHead: durable.startingBranchHead, startingCommit: durable.startingCommit, goal: durable.goal, context: durable.context, allowedScope: durable.allowedScope, protectedPaths: durable.protectedPaths });
    if (ownership.kind === "busy" || ownership.run.runId !== runId) throw new Error("Another durable agent generation owns this change");
    durable = ownership.run;
    if (durable.taskId !== task.id || durable.branch !== task.workspace.branch || durable.phase === "failed") throw new Error("Agent generation is unavailable; inspect its saved proposal and branch");
    r = await run(`git -C ${WORK} checkout --quiet -B ${q(task.workspace.branch)} ${q(durable.startingCommit)}`);
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
        const content = await sb.readFile(`${WORK}/${file}`);
        if (redactSecrets(content) !== content) { secretFiles.add(file); continue; }
        if (content.length > MAX_FILE_BYTES || total + content.length > MAX_CONTEXT_BYTES) continue;
        total += content.length; files[file] = content;
      }
      const context = [durable.context.issue ? `Issue #${durable.context.issue.number}: ${durable.context.issue.title}\n${durable.context.issue.summary}` : "", ...durable.context.comments.map((comment) => comment.summary), `Continue from saved Git commit ${durable.startingCommit}.`].filter(Boolean).join("\n\n");
      const ai = new WorkersAIClient({ binding: env.AI, gatewayId: env.AI_GATEWAY_ID, model: DEFAULT_CODE_MODEL, maxCalls: spending.maxCalls, maxOutputTokens: spending.maxOutputTokens, beforeDispatch: async ({ model, inputBytes, maxOutputTokens }) => {
        if (model !== DEFAULT_CODE_MODEL || Date.now() >= deadline) throw new Error("Managed execution model or deadline unavailable");
        await assertManagedInitiator(env, ledger, options?.parentWorkflowId, options?.accountKey, task.id);
        await globalOf(env).consumeManagedSpend(runId, inputBytes, maxOutputTokens, 0);
      } });
      const proposed = parseRepairResponse(await ai.complete(buildAgentPrompt(frozenTask, task.contributor.name, files, settings.checkCommand, context)));
      if (!proposed.size) throw new Error("Model returned no file changes");
      assertAgentWrites(frozenTask, proposed.keys(), durable.protectedPaths);
      for (const file of proposed.keys()) if (secretFiles.has(file)) throw new Error("Agent proposed replacing a credential-bearing file; human editing is required");
      const normalized = Object.fromEntries([...proposed].map(([file, content]) => [file, content.endsWith("\n") ? content : `${content}\n`]));
      if (!(await ledger.saveAgentProposal(runId, task.id, normalized))) throw new Error("Agent proposal was not durably saved for the active generation");
      durable = await ledger.getAgentRun(runId);
      if (!durable?.proposal) throw new Error("Saved agent proposal is unavailable");
    }
    if (!(await ledger.saveAgentProposal(runId, task.id, durable.proposal.files))) throw new Error("Another agent generation superseded this run");
    if (options?.stopAfterProposal) return { commit: "", proposalId: runId };
    assertAgentWrites({ allowedScope: durable.allowedScope }, Object.keys(durable.proposal.files), durable.protectedPaths);
    for (const [file, content] of Object.entries(durable.proposal.files)) {
      const original = await run(`test -f ${q(`${WORK}/${file}`)} && test ! -L ${q(`${WORK}/${file}`)}`);
      if (original.success) { const contentBefore = await sb.readFile(`${WORK}/${file}`); if (redactSecrets(contentBefore) !== contentBefore) throw new Error("Agent cannot replace a credential-bearing file"); }
      const dir = file.split("/").slice(0, -1).join("/");
      for (const prefix of file.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))) if ((await run(`test -L ${q(`${WORK}/${prefix}`)}`)).success) throw new Error("Agent write would traverse a repository symlink");
      if ((await run(`test -L ${q(`${WORK}/${file}`)}`)).success) throw new Error("Agent cannot replace a repository symlink");
      if (dir && !(await run(`mkdir -p ${q(`${WORK}/${dir}`)}`)).success) throw new Error("Agent directory could not be created");
      await sb.writeFile(`${WORK}/${file}`, content);
    }
    const date = `${Math.floor(Date.parse(durable.proposal.commitDate ?? durable.createdAt) / 1000)} +0000`;
    r = await run(`git -C ${WORK} add -A && git -C ${WORK} -c user.name=${q(`FlareGit agent ${task.id}`)} -c user.email=${q(`${task.id}@agents.flaregit.com`)} commit --quiet -m ${q(durable.goal)}`, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    if (!r.success) throw new Error("Agent could not reconstruct its saved proposal commit");
    const commit = (await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
    if (!SHA.test(commit) || (durable.pushedCommit && durable.pushedCommit !== commit)) throw new Error("Reconstructed proposal differs from the saved pushed commit");
    const changed = await run(`git -C ${WORK} diff --name-only -z ${q(durable.startingCommit)} ${q(commit)}`);
    if (!changed.success) throw new Error("Agent could not inspect its saved proposal");
    const filesChanged = changed.stdout.split("\0").filter(Boolean);
    assertAgentWrites({ allowedScope: durable.allowedScope }, filesChanged, durable.protectedPaths);
    if (stopped((await ledger.getState()).tasks[task.id])) throw new Error("Change was stopped before push; accepted history is unchanged");
    if (!(await ledger.saveAgentProposal(runId, task.id, durable.proposal.files))) throw new Error("Agent generation changed before push");
    const remoteHead = await run(`git ls-remote --heads ${q(remote)} ${q(branchRef)}`, gitAuthEnv(token));
    if (!remoteHead.success) throw new Error("Saved branch could not be inspected before publication");
    const tip = remoteHead.stdout.trim().split(/\s+/)[0] ?? "";
    if (tip !== commit) {
      if (tip !== (durable.startingBranchHead ?? "")) throw new Error("Another contributor advanced this branch; no work was overwritten");
      r = await run(`git -C ${WORK} push --quiet --force-with-lease=${q(`${branchRef}:${tip}`)} ${q(remote)} ${q(`${commit}:${branchRef}`)}`, gitAuthEnv(token));
      if (!r.success) throw new Error("Agent push outcome is unknown or refused; retry the saved proposal without regenerating it");
    }
    if (!(await ledger.markAgentPushed(runId, task.id, commit))) throw new Error("Pushed branch is saved but run ownership changed; inspect its durable commit");
    const runDigest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(runId)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const eventId = `agent-${runDigest}-${commit}`;
    const checkpoint = await ledger.ingestCheckpoint({ eventId, taskId: task.id, commit, ready: true, filesChanged });
    if (!checkpoint.applied && (await ledger.getState()).tasks[task.id]?.currentCommit !== commit) throw new Error("Pushed branch remains recoverable; checkpoint was refused");
    if (!(await ledger.checkpointAgentRun(runId, task.id, eventId, commit))) throw new Error("Checkpoint was saved but agent completion is not confirmed");
    return { commit, ...(durable.resumedFrom ? { recovered: true } : {}) };
  } finally {
    const cleanupFailure = async (detail: string) => {
      try { await ledger.logActivity("FlareGit", "agent.cleanup_failed", detail); }
      catch { console.warn("Agent cleanup could not be recorded"); }
    };
    if (repo && token && !(await repo.revokeToken(token).catch(() => false))) await cleanupFailure("Agent credential revocation could not be confirmed; its expiry remains bounded.");
    try { repo?.[Symbol.dispose]?.(); } catch { console.warn("Agent repository capability disposal failed"); }
    await sb.destroy().catch(() => cleanupFailure("Agent container cleanup failed; saved proposals and Git checkpoints remain available."));
  }
}
