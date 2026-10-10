import { allocateArtifact } from "./storage-allocation.js";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { ACT1, ACT2, ACT3, type TaskSpec } from "../scenarios/ticket-booking.js";
import type { Task } from "../core/types.js";
import type { Env } from "./env.js";
import type { Ledger } from "./durable-object.js";
import { runAgentTask } from "./agent-run.js";
import { settleManagedRun } from "./projects.js";
import {restrictedAgentRuntimeOptions} from './restricted-agent-runtime';

export interface ScenarioParams {
  projectId: string;
  accountKey?: string;
  act: "act1" | "act2" | "act3";
  /** Unique suffix so a scenario can be re-run against the same project. */
  runId: string;
}

const ACTS = { act1: ACT1, act2: ACT2, act3: ACT3 } as const;

export function scenarioAgentRunIds(instanceId: string, act: ScenarioParams["act"], runId: string): string[] {
  return ACTS[act].map((spec) => `${instanceId}-${spec.taskId}-${runId}`);
}

/** Each project (tenant) has its own Durable Object ledger. */
export const ledgerOf = (env: Env, projectId: string): Ledger =>
  env.REPOSITORY_CONTROLLER.get(env.REPOSITORY_CONTROLLER.idFromName(`project:${projectId}`)) as unknown as Ledger;

/**
 * Two real coding agents work concurrently, each in its own Artifacts fork and its own container; their
 * pushes become ledger checkpoints; then the integration Workflow takes over.
 */
export class FlareGitScenarioWorkflow extends WorkflowEntrypoint<Env, ScenarioParams> {
  override async run(event: WorkflowEvent<ScenarioParams>, step: WorkflowStep) {
    const { act, runId, projectId } = event.payload;
    const specs = ACTS[act].map((s) => ({ ...s, taskId: `${s.taskId}-${runId}` })) as [TaskSpec, TaskSpec];
    const ledger = ledgerOf(this.env, projectId);
    const initiator = await ledger.getWorkflowRun(event.instanceId);

    const tasks = await Promise.all(specs.map((spec) => step.do(`create-task-${spec.taskId}`, async () => ({ id: (await this.createTask(spec, ledger, projectId, initiator?.actorId ?? undefined)).id }))));

    const stage = async (taskId: string, plan: boolean) => {
      const agentRunId = `${event.instanceId}-${taskId}`;
      try {
        return await step.do(`${plan ? "plan-agent" : "apply-agent"}-${taskId}`, { retries: { limit: 1, delay: "5 seconds", backoff: "constant" }, timeout: "10 minutes" }, async () => runAgentTask(this.env, ledger, (await ledger.getState()).tasks[taskId]!, agentRunId, { stopAfterProposal: plan, accountKey: event.payload.accountKey, parentWorkflowId: event.instanceId, ...restrictedAgentRuntimeOptions(this.env) }));
      } catch (error) {
        await step.do(`agent-failed-${taskId}`, async () => { await ledger.failAgentRun(agentRunId, taskId); await ledger.failAgentTask(taskId, agentRunId); });
        throw error;
      }
    };
    // Both real model plans run concurrently; proposals survive a pause before either apply stage.
    const settle = () => Promise.all(tasks.map((task) => step.do(`settle-managed-spend-${task.id}`, { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" } }, async () => (await settleManagedRun(this.env, `${event.instanceId}-${task.id}`))?.usdMicros ?? null).catch(() => null)));
    try {
      const proposals = await Promise.all(tasks.map((task) => stage(task.id, true)));
      await Promise.all(tasks.map((task, index) => proposals[index]?.commit ? proposals[index] : stage(task.id, false)));
    } finally { await settle(); }

    const instance = await step.do("start-integration", async () => {
      const parent = await ledger.getWorkflowRun(event.instanceId);
      await ledger.registerWorkflow(`int-${projectId}-${runId}-${act}`, "integration", undefined, parent?.kind === "scenario" ? parent.actorId ?? undefined : undefined,1);
      const wf = await this.env.INTEGRATION_WORKFLOW.create({
        id: `int-${projectId}-${runId}-${act}`,
        params: { projectId, accountKey: event.payload.accountKey, taskIds: [tasks[0]!.id, tasks[1]!.id],nativeRuntimeProtocolVersion:1 },
      });
      return { id: wf.id };
    });
    return { tasks: tasks.map((t) => t.id), integrationInstance: instance.id };
  }

  private async createTask(spec: TaskSpec, ledger: Ledger, projectId: string, actorId?: string) {
    const state = await ledger.getState();
    const canonical = await this.env.ARTIFACTS.get(state.canonicalRepoName);
    if(!actorId)throw new Error("Scenario storage allocation has no accountable owner");
    const fork=await allocateArtifact(this.env,{name:`t-${projectId}-${spec.taskId}`,projectId,userId:actorId,kind:"workspace"},()=>canonical.fork(`t-${projectId}-${spec.taskId}`,{description:spec.goal}));
    const task: Task = {
      id: spec.taskId,
      goal: spec.goal,
      contributor: { id: `agent-${spec.taskId}`, name: spec.contributorName, type: "agent" },
      baseCommit: state.acceptedState.currentCommit,
      allowedScope: spec.allowedScope ?? ["src/"],
      status: "working",
      requirements: spec.requirements,
      workspace: { repoName: `t-${projectId}-${spec.taskId}`, remote: fork.remote, branch: `task/${spec.taskId}` },
      checkpoints: [],
      currentCommit: state.acceptedState.currentCommit,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await ledger.createTask(task, actorId);
    return task;
  }
}
