import { DurableObject } from "cloudflare:workers";
import worker from "../../src/server/worker";
import type { Env } from "../../src/server/env";
export class ImportRetryFixture extends DurableObject {
  override async fetch(request: Request) {
    if (new URL(request.url).pathname === "/move") { await this.ctx.storage.put("head", "b".repeat(40)); return Response.json({ ok: true }); }
    if (new URL(request.url).pathname === "/outsider") { await this.ctx.storage.put("outsider", true); return Response.json({ ok: true }); }
    const outsider = await this.ctx.storage.get("outsider") === true;
    const owner = "fixture-owner", canonical = "fixture-repo", projectId = "abcdef123456";
    const account = {
      verifyApiToken: async () => ({ userId: outsider ? "other-owner" : owner, scope: "full", repo: null }),
      getImportJob: async () => ({ ownerId: owner, status: "ready", canonicalRepoName: canonical }),
      getBilling: async () => ({ plan: "free" }),
      consumeRun: async () => ({ allowed: true, used: 1 }),
      getImportHistoryOperation: async (instanceId: string) => { const op = await this.ctx.storage.get<{instanceId:string}>("operation"); return op?.instanceId === instanceId ? op : null; },
      claimImportHistoryOperation: async (input: object) => { const op = { ...input, createdAt: new Date().toISOString() }; await this.ctx.storage.put("operation", op); return op; },
    };
    const project = { roleOf: async () => outsider ? "contributor" : "owner", getState: async () => ({ canonicalRepoName: canonical, projectName: "Fixture", verificationPolicy: {}, acceptedState: { currentCommit: await this.ctx.storage.get("head") ?? "a".repeat(40) } }) };
    const env = {
      REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: (name: string) => name === `project:${projectId}` ? project : account },
      API_LIMITER: { limit: async () => ({ success: true }) },
      EVIDENCE_BUCKET: { get: async () => null },
      IMPORT_HISTORY_WORKFLOW: { get: async () => { throw new Error("Unobserved handle"); }, create: async (input: unknown) => { await this.ctx.storage.put("lastDispatch", input); throw new Error("Ambiguous transport"); } },
    } as unknown as Env;
    if (new URL(request.url).pathname === "/dispatch") return Response.json(await this.ctx.storage.get("lastDispatch"));
    return worker.fetch(request, env, this.ctx as unknown as ExecutionContext);
  }
}
export default { fetch: (request: Request, env: { TEST: DurableObjectNamespace<ImportRetryFixture> }) => env.TEST.getByName("one").fetch(request) };
