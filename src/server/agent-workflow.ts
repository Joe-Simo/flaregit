import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env.js";
import { ledgerOf } from "./scenario-workflow.js";
import { runAgentTask } from "./agent-run.js";
import { globalOf } from "./projects.js";

export interface AgentParams {
  projectId: string;
  accountKey?: string;
  taskId: string;
  resumeFrom?: string;
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
    const { projectId, taskId, resumeFrom, accountKey } = event.payload;
    const ledger = ledgerOf(this.env, projectId);
    try {
      const proposal = await step.do("plan-agent-proposal", { retries: { limit: 1, delay: "5 seconds", backoff: "constant" }, timeout: "10 minutes" }, async () => {
        const task = (await ledger.getState()).tasks[taskId];
        if (!task || ["accepted", "cancelled", "integrating", "verifying"].includes(task.status)) return { commit: "" };
        return runAgentTask(this.env, ledger, task, event.instanceId, { stopAfterProposal: true, accountKey, parentWorkflowId: event.instanceId, ...(resumeFrom ? { resumeFrom } : {}) });
      });
      if (proposal.commit || !("proposalId" in proposal)) return proposal;
      return await step.do("apply-saved-proposal", { retries: { limit: 1, delay: "5 seconds", backoff: "constant" }, timeout: "10 minutes" }, async () => {
        const task = (await ledger.getState()).tasks[taskId];
        if (!task || ["accepted", "cancelled", "integrating", "verifying"].includes(task.status)) return { commit: "" };
        return runAgentTask(this.env, ledger, task, event.instanceId, { accountKey, parentWorkflowId: event.instanceId, ...(resumeFrom ? { resumeFrom } : {}) });
      });
    } catch {
      await step.do("record-agent-failure", async () => { await ledger.failAgentRun(event.instanceId, taskId); await ledger.failAgentTask(taskId, event.instanceId); });
      throw new Error("Agent run failed; saved checkpoints remain available. Retry or continue on the saved branch.");
    }
  }
}
