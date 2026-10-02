import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env.js";
import { ledgerOf } from "./scenario-workflow.js";
import { runAgentTask } from "./agent-run.js";

export interface AgentParams {
  projectId: string;
  taskId: string;
}

/** Runs one AI coding agent on one task of a customer's repository. */
export class FlareGitAgentWorkflow extends WorkflowEntrypoint<Env, AgentParams> {
  override async run(event: WorkflowEvent<AgentParams>, step: WorkflowStep) {
    const { projectId, taskId } = event.payload;
    const ledger = ledgerOf(this.env, projectId);
    return step.do("agent", { retries: { limit: 1, delay: "5 seconds", backoff: "constant" }, timeout: "10 minutes" }, async () => {
      const task = (await ledger.getState()).tasks[taskId];
      if (!task || task.status === "cancelled") return { commit: "" };
      return runAgentTask(this.env, ledger, task);
    });
  }
}
