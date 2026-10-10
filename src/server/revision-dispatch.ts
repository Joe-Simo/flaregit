import type { Env } from "./env.js";
import type { Ledger } from "./durable-object.js";
import { accountKeyFor, accountOf, admitRun, cancelManagedRuns, globalOf, startManagedRuns } from "./projects.js";
import { planLimits } from "./polar.js";

export type RevisionDispatch = { dispatched: true; replayed: boolean } | { dispatched: false; reason: string };

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
  if (!await project.roleOf(input.actorId)) return { dispatched: false, reason: "The person who made this choice no longer has access" };
  const accountKey = await accountKeyFor(input.actorId);
  const account = accountOf(env, accountKey);
  if (await account.accountLifecycle() !== "active") return { dispatched: false, reason: "The account that would fund the agent is unavailable" };
  const limits = planLimits(env), funded = await startManagedRuns(env, accountKey, [input.workflowId], { free: limits.free, paid: limits.pro });
  if (funded instanceof Response) return { dispatched: false, reason: (await funded.text()).slice(0, 300) };
  const denied = await admitRun(env, account, funded.dailyLimit, input.workflowId);
  if (denied) {
    await cancelManagedRuns(env, accountKey, [input.workflowId]);
    return { dispatched: false, reason: (await denied.text()).slice(0, 300) };
  }
  if (!await project.beginAgentTask(input.taskId, input.workflowId)) {
    await cancelManagedRuns(env, accountKey, [input.workflowId]);
    return { dispatched: false, reason: "This change already has active agent work or cannot start an agent" };
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
    return { dispatched: false, reason: "The agent could not start. Its saved branch is unchanged; start it again from the change." };
  }
}
