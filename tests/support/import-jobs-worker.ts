import { RepositoryController } from "../../src/server/durable-object";
import type { ImportJob } from "../../src/server/import-job";
export class ImportFixture extends RepositoryController {
  override async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/save") { await this.saveImportJob(await request.json() as ImportJob); return Response.json({ saved: true }); }
      if (path === "/list") return Response.json(await this.listImportJobs());
      return new Response("Not found", { status: 404 });
    } catch { return new Response("Import metadata refused", { status: 409 }); }
  }
}
export default { fetch: (request: Request, env: { TEST: DurableObjectNamespace<ImportFixture> }) => env.TEST.getByName("account").fetch(request) };
