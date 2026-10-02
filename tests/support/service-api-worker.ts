import { DurableObject } from "cloudflare:workers";
import worker from "../../src/server/worker";
import { RepositoryConnections } from "../../src/server/connections";
import type { Env } from "../../src/server/env";
import type { IntegrationCallback } from "../../src/server/integration-auth";

export class ServiceApiFixture extends DurableObject {
  override async fetch(request: Request) {
    const repositoryId = "abcdef123456";
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT,subject TEXT,author TEXT,body TEXT,path TEXT,line INTEGER,"commit" TEXT,created_at TEXT)');
    const ledger = new RepositoryConnections(this.ctx.storage, repositoryId);
    const route = new URL(request.url).pathname;
    if (route === "/setup") {
      const created = ledger.create("Test company", ["read-candidate", "report-check", "comment"]);
      const policy = { version: 2, mode: "augment" as const, checks: [{ id: "check-one", providerId: created.metadata.id, required: true }] };
      ledger.setPolicy(policy);
      ledger.freeze({ repositoryId, candidateId: "candidate-one", commit: "a".repeat(40), tree: "b".repeat(40), policy });
      ledger.registerRun("candidate-one", "check-one", "run-one");
      return Response.json(created);
    }
    if (route === "/expensive-count") return Response.json(this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM expensive_calls").toArray()[0]);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS expensive_calls(id INTEGER)");
    if (route === "/revoke") { const value = await request.json() as { id: string }; ledger.revoke(value.id); return Response.json({ ok: true }); }
    const env = {
      REPOSITORY_CONTROLLER: {
        idFromName: (name: string) => name,
        get: (name: string) => ({
          verifyApiToken: async (token: string) => token === `fgt_abcdef123456_${"x".repeat(32)}` ? { userId:"fixture-user",scope:"full",repo:null } : null,
          roleOf: async () => "owner",
          listProjects: async () => [],listImportJobs: async () => [],
          getState: async () => ({ verificationPolicy:{},acceptedState:{currentCommit:"a".repeat(40)},tasks:{"task-one":{id:"task-one",status:"working"}} }),
          connectionSigningConfig: async (id: string) => name === `project:${repositoryId}` ? ledger.signingConfig(id) : null,
          acceptIntegrationCallback: async (callback: IntegrationCallback) => ledger.accept(callback),
          serviceCandidateSnapshot: async (id: string, candidate: string, commit: string, nonce: string) => { try { return ledger.serviceCandidateSnapshot(id, candidate, commit, nonce); } catch { return null; } },
        }),
      },
      ARTIFACTS: {create:async()=>{this.ctx.storage.sql.exec("INSERT INTO expensive_calls VALUES(1)");throw new Error("Unexpected creation");}},
      AGENT_WORKFLOW: {create:async()=>{this.ctx.storage.sql.exec("INSERT INTO expensive_calls VALUES(1)");throw new Error("Unexpected agent start");}},
      API_LIMITER: { limit: async () => ({ success: true }) },
    } as unknown as Env;
    return worker.fetch(request, env, this.ctx as unknown as ExecutionContext);
  }
}
export default { fetch: (request: Request, env: { TEST: DurableObjectNamespace<ServiceApiFixture> }) => env.TEST.getByName("one").fetch(request) };
