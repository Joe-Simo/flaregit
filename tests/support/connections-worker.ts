import { DurableObject } from "cloudflare:workers";
import { RepositoryConnections } from "../../src/server/connections";
import type { IntegrationCallback } from "../../src/server/integration-auth";
import type { FrozenExternalChecks, ExternalCheckPolicy } from "../../src/core/external-checks";
export class ConnectionFixture extends DurableObject {
  override async fetch(request: Request) {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT,subject TEXT,author TEXT,body TEXT,path TEXT,line INTEGER,"commit" TEXT,created_at TEXT)');
    const ledger = new RepositoryConnections(this.ctx.storage, "repo-one");
    const route = new URL(request.url).pathname;
    try {
      if (route === "/create") return Response.json(ledger.create("Custom company", ["read-candidate", "report-check", "comment"]));
      if (route === "/revoke") { const data = await request.json() as { id: string }; ledger.revoke(data.id); return Response.json({ ok: true }); }
      if (route === "/list") return Response.json(ledger.list());
      if (route === "/policy") { ledger.setPolicy(await request.json() as ExternalCheckPolicy); return Response.json({ ok: true }); }
      if (route === "/freeze") return Response.json(ledger.freeze(await request.json() as FrozenExternalChecks));
      if (route === "/run") { const data = await request.json() as { candidate: string; check: string; run: string }; return Response.json(ledger.registerRun(data.candidate, data.check, data.run)); }
      if (route === "/callback") return Response.json(await ledger.accept(await request.json() as IntegrationCallback));
      if (route === "/read") { const data = await request.json() as { service: string; candidate: string; commit: string; nonce: string }; return Response.json(ledger.serviceCandidateSnapshot(data.service, data.candidate, data.commit, data.nonce)); }
      if (route === "/reports") return Response.json(ledger.reports("candidate-one"));
      if (route === "/comments") return Response.json(this.ctx.storage.sql.exec("SELECT * FROM comments").toArray());
      return new Response("Not found", { status: 404 });
    } catch { return new Response("Rejected", { status: 409 }); }
  }
}
export default { fetch: (request: Request, env: { TEST: DurableObjectNamespace<ConnectionFixture> }) => env.TEST.getByName("one").fetch(request) };
