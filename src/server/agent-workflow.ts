import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env.js";
import { ledgerOf } from "./scenario-workflow.js";
import { runAgentTask } from "./agent-run.js";
import { globalOf } from "./projects.js";

export interface AgentParams {
  projectId: string;
  taskId: string;
}

/** Runs one AI coding agent on one task of a customer's repository. */
export class FlareGitAgentWorkflow extends WorkflowEntrypoint<Env, AgentParams> {
  override async run(event: WorkflowEvent<AgentParams>, step: WorkflowStep) {
    const record = async (status: "started" | "completed" | "skipped" | "failed") => {
      try { await step.do(`outcome-${status}`, async () => globalOf(this.env).recordWorkflowOutcome("agent", event.instanceId, status)); }
      catch { console.error("Workflow outcome recording unavailable"); }
    };
    await record("started");
    try {
      const result = await this.execute(event, step);
      await record(result.commit ? "completed" : "skipped");
      return result;
    } catch (error) {
      await record("failed");
      throw error;
    }
  }
  private async execute(event: WorkflowEvent<AgentParams>, step: WorkflowStep) {
    const { projectId, taskId } = event.payload;
    const ledger = ledgerOf(this.env, projectId);
    try {
      return await step.do("agent", { retries: { limit: 1, delay: "5 seconds", backoff: "constant" }, timeout: "10 minutes" }, async () => {
        const task = (await ledger.getState()).tasks[taskId];
        if (!task || ["accepted", "cancelled", "integrating", "verifying"].includes(task.status)) return { commit: "" };
        return runAgentTask(this.env, ledger, task);
      });
    } catch {
      await step.do("record-agent-failure", async () => ledger.failAgentTask(taskId));
      throw new Error("Agent run failed; saved checkpoints remain available. Retry or continue on the saved branch.");
    }
  }
}
