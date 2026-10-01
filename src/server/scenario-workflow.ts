import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { WorkersAIClient } from "../ai/workers-ai.js";
import { assertAgentWrites, buildAgentPrompt } from "../agents/prompt.js";
import { parseRepairResponse } from "../core/pipeline/repair.js";
import { ACT1, ACT2, ACT3, type TaskSpec } from "../scenarios/ticket-booking.js";
import type { Task } from "../core/types.js";
import type { Env } from "./env.js";
import type { Ledger } from "./durable-object.js";
import { PROTECTED_PATHS, gitAuthEnv, q } from "./shell.js";

export interface ScenarioParams {
  projectId: string;
  act: "act1" | "act2" | "act3";
  /** Unique suffix so a scenario can be re-run against the same project. */
  runId: string;
}

const ACTS = { act1: ACT1, act2: ACT2, act3: ACT3 } as const;
const WORK = "/workspace/task";

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

    const tasks = await Promise.all(specs.map((spec) => step.do(`create-task-${spec.taskId}`, async () => ({ id: (await this.createTask(spec, ledger)).id }))));

    await Promise.all(
      tasks.map((t) =>
        step.do(`agent-${t.id}`, { retries: { limit: 1, delay: "5 seconds", backoff: "constant" }, timeout: "10 minutes" }, async () => this.runAgent((await ledger.getState()).tasks[t.id]!, ledger))
      )
    );

    const instance = await step.do("start-integration", async () => {
      const wf = await this.env.INTEGRATION_WORKFLOW.create({
        id: `int-${projectId}-${runId}-${act}`,
        params: { projectId, taskIds: [tasks[0]!.id, tasks[1]!.id], fixture: "ticket-booking", protectedPaths: PROTECTED_PATHS },
      });
      return { id: wf.id };
    });
    return { tasks: tasks.map((t) => t.id), integrationInstance: instance.id };
  }

  private async createTask(spec: TaskSpec, ledger: Ledger) {
    const state = await ledger.getState();
    const canonical = await this.env.ARTIFACTS.get(state.canonicalRepoName);
    const fork = await canonical.fork(`task-${spec.taskId}`, { description: spec.goal });
    const task: Task = {
      id: spec.taskId,
      goal: spec.goal,
      contributor: { id: `agent-${spec.taskId}`, name: spec.contributorName, type: "agent" },
      baseCommit: state.acceptedState.currentCommit,
      allowedScope: spec.allowedScope ?? ["src/"],
      status: "working",
      requirements: spec.requirements,
      workspace: { repoName: `task-${spec.taskId}`, remote: fork.remote, branch: `task/${spec.taskId}` },
      checkpoints: [],
      currentCommit: state.acceptedState.currentCommit,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await (ledger as unknown as { createTask(t: Task): Promise<Task> }).createTask(task);
    return task;
  }

  private async runAgent(task: Task, ledger: Ledger) {
    const sb = this.env.AGENT.getByName(`agent-${task.id}`);
    const repo = await this.env.ARTIFACTS.get(task.workspace.repoName);
    const remote = String((await repo.info()).remote);
    const token = (await repo.createToken("write", 1800)).plaintext;
    const run = (cmd: string, env?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env });

    let r = await run(`rm -rf ${WORK} && git clone --quiet ${q(remote)} ${WORK}`, gitAuthEnv(token));
    if (!r.success) throw new Error(`clone failed: ${r.stderr.slice(-300)}`);
    await run(`git -C ${WORK} checkout --quiet -B ${q(task.workspace.branch)} ${q(task.baseCommit)}`);

    const listed = (await run(`git -C ${WORK} ls-files`)).stdout.split("\n").filter(Boolean);
    const files: Record<string, string> = {};
    for (const f of listed) {
      if (!task.allowedScope.some((s) => (s.endsWith("/") ? f.startsWith(s) : f === s)) || !/\.(ts|tsx|css|json|html|md)$/.test(f)) continue;
      files[f] = await sb.readFile(`${WORK}/${f}`);
    }

    const ai = new WorkersAIClient({ binding: this.env.AI, gatewayId: this.env.AI_GATEWAY_ID });
    const proposed = parseRepairResponse(await ai.complete(buildAgentPrompt(task, task.contributor.name, files)));
    if (proposed.size === 0) throw new Error("model returned no file changes");
    assertAgentWrites(task, proposed.keys(), PROTECTED_PATHS);
    for (const [file, content] of proposed) {
      await run(`mkdir -p ${q(`${WORK}/${file.split("/").slice(0, -1).join("/") || "."}`)}`);
      await sb.writeFile(`${WORK}/${file}`, content.endsWith("\n") ? content : `${content}\n`);
    }
    r = await run(`git -C ${WORK} add -A && git -C ${WORK} -c user.name=${q(task.contributor.name)} -c user.email=${q(`${task.id}@agents.flaregit.com`)} commit --quiet -m ${q(task.goal)}`);
    if (!r.success) throw new Error(`commit failed: ${r.stderr.slice(-300)}`);
    const commit = (await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
    r = await run(`git -C ${WORK} push --quiet ${q(remote)} ${q(`${task.workspace.branch}:refs/heads/${task.workspace.branch}`)}`, gitAuthEnv(token));
    if (!r.success) throw new Error(`push failed: ${r.stderr.slice(-300)}`);

    await ledger.ingestCheckpoint({ eventId: `push-${task.id}-${commit}`, taskId: task.id, commit, ready: true });
    await repo.revokeToken(token).catch(() => false); // the agent's credential dies with its run
    await sb.destroy();
    return { commit };
  }
}
