import { z } from "zod";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env, QueueMessage } from "./env.js";
import type { HumanDecisionActor } from "../core/types.js";
import type { Ledger } from "./durable-object.js";
import { ledgerOf } from "./scenario-workflow.js";
import { accountKeyFor, assertManagedInitiator } from "./projects.js";
import { nativeCoordinationRuntime } from "./coordination-runtime.js";
import { proveRecordedContradiction, revisionWorkflowId } from "./requirement-decisions.js";
import { executePostLandRebase } from "./post-land-rebase.js";
import { dispatchRevisionAgent } from "./revision-dispatch.js";
import type { LandingOutcome } from "./merge-queue-runner.js";

/** Environment-level drivers that connect the repository ledger to workflows, queues and agents. */

export const postLandRebaseParamsSchema = z.object({ mode: z.literal("post-land-rebase"), projectId: z.string().regex(/^[a-z0-9]{12,16}$/), accountKey: z.string().min(1).max(200), landedCommit: z.string().regex(/^[a-f0-9]{40}$/) }).strict();
export type PostLandRebaseParams = z.infer<typeof postLandRebaseParamsSchema>;

/** Dispatches the queue's next action. Safe to call repeatedly: every dispatch is keyed by a saved identity. */
export async function advanceMergeQueue(env: Env, projectId: string): Promise<{ action: string; detail: string }> {
  const project = ledgerOf(env, projectId);
  const action = await project.mergeQueueAdvance();
  if (action.kind === "land") {
    await project.registerWorkflow(action.eventId, "integration", undefined, action.actorId, 1);
    await env.INTEGRATION_QUEUE.send({ type: "integration.requested", projectId, taskIds: action.taskIds, eventId: action.eventId } satisfies QueueMessage);
    return { action: "land", detail: action.taskIds.join(" + ") };
  }
  if (action.kind === "rebase") {
    await startPostLandRebase(env, projectId, action.landedCommit, action.actorId);
    return { action: "rebase", detail: action.taskId };
  }
  return { action: "idle", detail: action.reason };
}

/** One update workflow per landed commit covers every affected change. */
export async function startPostLandRebase(env: Env, projectId: string, landedCommit: string, actorId: string): Promise<string> {
  const project = ledgerOf(env, projectId);
  const id = `plr-${projectId}-${landedCommit}`;
  if (!await project.roleOf(actorId)) throw new Error("The person who started this landing no longer has access");
  await project.registerWorkflow(id, "integration", undefined, actorId);
  const params: PostLandRebaseParams = { mode: "post-land-rebase", projectId, accountKey: await accountKeyFor(actorId), landedCommit };
  const created = await env.INTEGRATION_WORKFLOW.createBatch([{ id, params }]);
  if (!Array.isArray(created) || created.length > 1) throw new Error("Update dispatch acknowledgment is invalid");
  return id;
}

/** Workflow body for `mode: "post-land-rebase"`: plan, update each change in its own step, then advance the queue. */
export async function runPostLandRebaseWorkflow(env: Env, event: Readonly<WorkflowEvent<PostLandRebaseParams>>, step: WorkflowStep) {
  const params = postLandRebaseParamsSchema.parse(event.payload);
  const project = ledgerOf(env, params.projectId);
  const items = await step.do("plan-updates", () => project.postLandRebasePlan(params.landedCommit, event.instanceId));
  const results: Array<{ taskId: string; status: string }> = [];
  for (const item of items) {
    if (item.status !== "pending") { results.push({ taskId: item.taskId, status: item.status }); continue; }
    const recorded = await step.do(`update-${item.taskId}`, { retries: { limit: 1, delay: "10 seconds", backoff: "constant" }, timeout: "20 minutes" }, async () => {
      await assertManagedInitiator(env, project, event.instanceId, params.accountKey);
      const execution = await executePostLandRebase(nativeCoordinationRuntime(env, params.accountKey), item);
      const result = await project.recordPostLandRebase({ taskId: item.taskId, landedCommit: item.landedCommit, fromCommit: item.fromCommit, execution });
      return { status: result.record.status, revise: result.revise };
    });
    if (recorded.revise) {
      await step.do(`revise-${item.taskId}`, async () => {
        const run = await project.getWorkflowRun(event.instanceId);
        const workflowId = await revisionWorkflowId(params.projectId, `update-${item.landedCommit}`, item.taskId);
        const dispatched = run?.actorId ? await dispatchRevisionAgent(env, project, { projectId: params.projectId, taskId: item.taskId, workflowId, actorId: run.actorId }) : { dispatched: false as const, reason: "The person who started this landing is unavailable" };
        await project.markPostLandRevision(item.taskId, item.landedCommit, workflowId, dispatched.dispatched ? { ok: true } : { ok: false, reason: dispatched.reason });
        return dispatched.dispatched;
      });
    }
    results.push({ taskId: item.taskId, status: recorded.status });
  }
  await step.do("merge-queue-advance", async () => {
    try { return await advanceMergeQueue(env, params.projectId); } catch { console.warn("Merge queue advance after updates was not confirmed"); return { action: "unconfirmed", detail: "" }; }
  });
  return { status: "updated" as const, landedCommit: params.landedCommit, results };
}

const outcomeSchema = z.object({ status: z.string(), error: z.string().optional(), reason: z.string().optional(), commit: z.string().optional(), decision: z.object({ id: z.string() }).passthrough().optional() }).passthrough();
const LANDING_OUTCOMES: readonly LandingOutcome[] = ["accepted", "stale", "needs_decision", "blocked", "rejected", "failed", "not_started"];

/**
 * Runs after every requested integration: proves any recorded contradiction by running code, records how a
 * queued landing ended, starts updates of other changes after a landing, and advances the queue. Each
 * part is its own step and never changes the integration's own result.
 */
export async function coordinationFollowup(env: Env, event: Readonly<WorkflowEvent<{ projectId: string; accountKey?: string }>>, step: WorkflowStep, raw: unknown): Promise<void> {
  const parsed = outcomeSchema.safeParse(raw);
  const outcome = parsed.success ? parsed.data : { status: "failed", error: "Integration ended unexpectedly" };
  const project = ledgerOf(env, event.payload.projectId);
  const accountKey = event.payload.accountKey;
  if (outcome.status === "needs_decision" && outcome.decision?.id && accountKey) {
    const decisionId = outcome.decision.id;
    await step.do("prove-requirement-contradiction", { retries: { limit: 1, delay: "10 seconds", backoff: "constant" }, timeout: "10 minutes" }, async () => {
      try {
        await assertManagedInitiator(env, project, event.instanceId, accountKey);
        return await proveRecordedContradiction(nativeCoordinationRuntime(env, accountKey), project, decisionId);
      } catch {
        return { verdict: "unavailable" as const, summary: "The code could not be run; the written requirements still disagree" };
      }
    });
  }
  const status = (LANDING_OUTCOMES as readonly string[]).includes(outcome.status) ? (outcome.status as LandingOutcome) : "failed";
  await step.do("merge-queue-settle", async () => {
    try { return (await project.mergeQueueSettle(event.instanceId, status, outcome.error ?? outcome.reason)).length; } catch { console.warn("Merge queue settlement was not confirmed"); return 0; }
  });
  if (status === "accepted" && outcome.commit) {
    const landed = outcome.commit;
    await step.do("start-post-land-updates", async () => {
      try {
        const run = await project.getWorkflowRun(event.instanceId);
        if (!run?.actorId) return "unavailable";
        return await startPostLandRebase(env, event.payload.projectId, landed, run.actorId);
      } catch { console.warn("Post-land updates were not started"); return "unconfirmed"; }
    });
  }
  await step.do("merge-queue-advance", async () => {
    try { return await advanceMergeQueue(env, event.payload.projectId); } catch { console.warn("Merge queue advance was not confirmed"); return { action: "unconfirmed", detail: "" }; }
  });
}

/** Re-runs the agent of every change whose requirement lost, with the winning requirement attached. */
export async function dispatchDecisionRevisions(env: Env, project: Ledger, projectId: string, decisionId: string, actorId: string) {
  const planned = await project.prepareRequirementRevisions(decisionId);
  const results = [];
  for (const revision of planned) {
    if (revision.status !== "planned" && revision.status !== "failed") { results.push(revision); continue; }
    const dispatched = await dispatchRevisionAgent(env, project, { projectId, taskId: revision.taskId, workflowId: revision.workflowId, actorId });
    results.push(await project.markRequirementRevision(decisionId, revision.taskId, dispatched.dispatched ? { dispatched: true } : { dispatched: false, reason: dispatched.reason }));
  }
  return results;
}

/**
 * Follow-up of a maintainer's decision. Saved reruns keep their existing continuation. Otherwise the losing
 * agent revises its change, every resolved change goes into the merge queue, and the queue advances; the
 * revised change re-enters automatically once its agent marks it ready.
 */
export async function afterRequirementDecision(env: Env, project: Ledger, input: { projectId: string; decisionId: string; result: { taskIds: string[]; continuationWorkflowId?: string }; actor: HumanDecisionActor; credentialHash?: string; sessionExpiresAt?: number }): Promise<{ revisions: number; queued: number }> {
  const { projectId, decisionId, result, actor } = input;
  if (!result.taskIds.length) return { revisions: 0, queued: 0 };
  if (result.continuationWorkflowId) {
    await project.registerWorkflow(result.continuationWorkflowId, "integration", undefined, actor.userId, 1);
    await env.INTEGRATION_QUEUE.send({ type: "integration.requested", projectId, taskIds: result.taskIds, eventId: result.continuationWorkflowId } satisfies QueueMessage);
    return { revisions: 0, queued: 0 };
  }
  const revisions = await dispatchDecisionRevisions(env, project, projectId, decisionId, actor.userId);
  const requestId = `decision-${decisionId}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 128);
  const queued = await project.mergeQueueEnqueue({ requestId, taskIds: result.taskIds }, actor, input.credentialHash, input.sessionExpiresAt);
  // A failed dispatch surfaces to the caller; choosing the same option again resends it (all steps are keyed).
  await advanceMergeQueue(env, projectId);
  return { revisions: revisions.filter((revision) => revision.status === "dispatched").length, queued: queued.entries.length };
}
