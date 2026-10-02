import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { ACT1, ACT2, ACT3, type TaskSpec } from "../scenarios/ticket-booking.js";
import type { Task } from "../core/types.js";
import type { Env } from "./env.js";
import type { Ledger } from "./durable-object.js";
import { runAgentTask } from "./agent-run.js";

export interface ScenarioParams {
  projectId: string;
  act: "act1" | "act2" | "act3";
  /** Unique suffix so a scenario can be re-run against the same project. */
  runId: string;
}

const ACTS = { act1: ACT1, act2: ACT2, act3: ACT3 } as const;

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

    const tasks = await Promise.all(specs.map((spec) => step.do(`create-task-${spec.taskId}`, async () => ({ id: (await this.createTask(spec, ledger, projectId)).id }))));

    await Promise.all(
      tasks.map((t) =>
        step.do(`agent-${t.id}`, { retries: { limit: 1, delay: "5 seconds", backoff: "constant" }, timeout: "10 minutes" }, async () => runAgentTask(this.env, ledger, (await ledger.getState()).tasks[t.id]!))
      )
    );

    const instance = await step.do("start-integration", async () => {
      const wf = await this.env.INTEGRATION_WORKFLOW.create({
        id: `int-${projectId}-${runId}-${act}`,
        params: { projectId, taskIds: [tasks[0]!.id, tasks[1]!.id] },
      });
      return { id: wf.id };
    });
    return { tasks: tasks.map((t) => t.id), integrationInstance: instance.id };
  }

  private async createTask(spec: TaskSpec, ledger: Ledger, projectId: string) {
    const state = await ledger.getState();
    const canonical = await this.env.ARTIFACTS.get(state.canonicalRepoName);
    const fork = await canonical.fork(`t-${projectId}-${spec.taskId}`, { description: spec.goal });
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
    await (ledger as unknown as { createTask(t: Task): Promise<Task> }).createTask(task);
    return task;
  }
}
