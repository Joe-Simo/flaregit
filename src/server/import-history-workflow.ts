import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import { accountOf, projectOf, PROJECT_ID } from "./projects";
import { capturePublicSourceHistory } from "./import-source-history";
import { verifyImportedHistory } from "./import-history";

export interface ImportHistoryParams { accountKey: string; projectId: string; expectedHead: string }
export const importHistoryReceiptKey = (projectId: string, head: string, instanceId: string) => {
  if (!PROJECT_ID.test(projectId) || !/^[a-f0-9]{40}$/.test(head) || !/^[A-Za-z0-9_-]{1,100}$/.test(instanceId)) throw new Error("Invalid receipt identity");
  return `migration-history/${projectId}/${head}/${instanceId}.json`;
};
/** Separate background verification: unavailable external source never blocks imported browsing.
 * Dispatch only after the authenticated owner requests inspection of a ready saved import.
 */
export class FlareGitImportHistoryWorkflow extends WorkflowEntrypoint<Env, ImportHistoryParams> {
  override async run(event: WorkflowEvent<ImportHistoryParams>, step: WorkflowStep) {
    const { accountKey, projectId, expectedHead } = event.payload;
    const key = importHistoryReceiptKey(projectId, expectedHead, event.instanceId);
    const scope = await step.do("authorize-saved-import", async () => {
      const job = await accountOf(this.env, accountKey).getImportJob(projectId);
      if (!job || job.status !== "ready" || job.id !== projectId) throw new Error("Ready saved import required");
      const ledger = projectOf(this.env, projectId);
      if (await ledger.roleOf(job.ownerId) !== "owner") throw new Error("Import owner membership required");
      const state = await ledger.getState();
      if (state.canonicalRepoName !== job.canonicalRepoName || state.acceptedState.currentCommit !== expectedHead) throw new Error("Import inspection head changed");
      return { canonicalRepoName: job.canonicalRepoName, source: job.source, branch: state.defaultBranch ?? job.branch ?? "main" };
    });
    const source = await step.do("capture-trusted-provider-history", { retries: { limit: 1, delay: "5 seconds", backoff: "constant" }, timeout: "5 minutes" }, async () => {
      const sandbox = this.env.INTEGRATOR.getByName(`import-history-${projectId}-${event.instanceId}`);
      try {
        return await capturePublicSourceHistory({ exec: (command, options) => sandbox.exec(["sh", "-c", command], { env: options?.env, timeoutMs: options?.timeout }) }, scope.source, scope.branch);
      } finally { await sandbox.destroy(); }
    });
    const result = await step.do("compare-pinned-import-history", { retries: { limit: 1, delay: "5 seconds", backoff: "constant" }, timeout: "30 seconds" }, async () => verifyImportedHistory(this.env.ARTIFACTS, scope.canonicalRepoName, scope.branch, expectedHead, source));
    await step.do("persist-private-history-receipt", async () => {
      const document = { version: 1, projectId, canonicalRepoName: scope.canonicalRepoName, expectedHead, branch: scope.branch, workflowInstanceId: event.instanceId, inspectedAt: new Date().toISOString(), result };
      await this.env.EVIDENCE_BUCKET.put(key, JSON.stringify(document), { httpMetadata: { contentType: "application/json" } });
    });
    return { projectId, expectedHead, receiptKey: key, status: result.status };
  }
}
