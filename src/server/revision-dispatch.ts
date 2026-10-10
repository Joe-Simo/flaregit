import type { Env } from "./env.js";
import type { Ledger } from "./durable-object.js";
import { accountKeyFor, accountOf, admitRun, cancelManagedRuns, globalOf, startManagedRuns } from "./projects.js";
import { planLimits } from "./polar.js";
import type { PostLandRebaseRecord, RevisionClaim, RevisionRefusal } from "./post-land-rebase.js";

export type RevisionDispatch = { dispatched: true; replayed: boolean } | { dispatched: false; reason: string; refusal: RevisionRefusal };

/** Spending and run limits come back once capacity returns; a pause is passing; anything else is passing too. */
async function refusalOf(response: Response): Promise<{ reason: string; refusal: RevisionRefusal }> {
  const reason = (await response.text()).slice(0, 300);
  return { reason, refusal: /paused/i.test(reason) ? "transient" : "budget" };
}

/**
 * Re-runs the coding agent on an existing change so it revises its own work. Uses the same funding,
 * run admission and registration as a person starting the agent, under the identity of the person whose
 * action caused the revision. The workflow id is stable, so a retried dispatch never starts a second run.
 */
export async function dispatchRevisionAgent(env: Env, project: Ledger, input: { projectId: string; taskId: string; workflowId: string; actorId: string }): Promise<RevisionDispatch> {
  try {
    await (await env.AGENT_WORKFLOW.get(input.workflowId)).status();
    return { dispatched: true, replayed: true };
  } catch {
    /* No saved run under this identity yet. */
  }
  if (!await project.roleOf(input.actorId)) return { dispatched: false, reason: "The person who made this choice no longer has access", refusal: "access" };
  const accountKey = await accountKeyFor(input.actorId);
  const account = accountOf(env, accountKey);
  if (await account.accountLifecycle() !== "active") return { dispatched: false, reason: "The account that would fund the agent is unavailable", refusal: "access" };
  const limits = planLimits(env), funded = await startManagedRuns(env, accountKey, [input.workflowId], { free: limits.free, paid: limits.pro });
  if (funded instanceof Response) return { dispatched: false, ...await refusalOf(funded) };
  const denied = await admitRun(env, account, funded.dailyLimit, input.workflowId);
  if (denied) {
    await cancelManagedRuns(env, accountKey, [input.workflowId]);
    return { dispatched: false, ...await refusalOf(denied) };
  }
  if (!await project.beginAgentTask(input.taskId, input.workflowId)) {
    await cancelManagedRuns(env, accountKey, [input.workflowId]);
    return { dispatched: false, reason: "This change already has active agent work or cannot start an agent", refusal: "transient" };
  }
  let attempted = false;
  try {
    await project.registerWorkflow(input.workflowId, "agent", input.taskId, input.actorId);
    attempted = true;
    await globalOf(env).markManagedDispatchAttempted([input.workflowId], accountKey);
    await env.AGENT_WORKFLOW.create({ id: input.workflowId, params: { projectId: input.projectId, accountKey, taskId: input.taskId } });
    return { dispatched: true, replayed: false };
  } catch {
    if (!attempted) await cancelManagedRuns(env, accountKey, [input.workflowId]);
    await project.failAgentTask(input.taskId, input.workflowId);
    return { dispatched: false, reason: "The agent could not start. Its saved branch is unchanged.", refusal: "transient" };
  }
}

/** Sends one claimed post-land re-run and saves how it ended. */
export async function sendRebaseRevision(env: Env, project: Ledger, projectId: string, claim: RevisionClaim): Promise<{ record: PostLandRebaseRecord; dispatch: RevisionDispatch }> {
  const dispatch = await dispatchRevisionAgent(env, project, { projectId, taskId: claim.taskId, workflowId: claim.workflowId, actorId: claim.actorId });
  const record = await project.markPostLandRevision(claim.taskId, claim.landedCommit, claim.workflowId, dispatch.dispatched ? { ok: true } : { ok: false, reason: dispatch.reason, refusal: dispatch.refusal, actorId: claim.actorId });
  return { record, dispatch };
}

/**
 * Sends again every refused post-land re-run whose backoff has elapsed. Called when capacity may have
 * returned: after each merge queue advance and from the repository alarm. One failure never stops the rest.
 */
export async function retryDueRebaseRevisions(env: Env, project: Ledger, projectId: string): Promise<PostLandRebaseRecord[]> {
  const claims = await project.claimDueRebaseRevisions();
  const records: PostLandRebaseRecord[] = [];
  for (const claim of claims) {
    try { records.push((await sendRebaseRevision(env, project, projectId, claim)).record); } catch { console.warn("A waiting agent re-run was not confirmed; it is sent again after its claim expires"); }
  }
  return records;
}
