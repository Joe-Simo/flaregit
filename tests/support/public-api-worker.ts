import { RepositoryController } from "../../src/server/durable-object";
import worker from "../../src/server/worker";
import type { Env } from "../../src/server/env";

const projectId = "abcdef123456", hash = "a".repeat(40), tree = "b".repeat(40), blob = "c".repeat(40);
/** Local synthetic source; authority and funding use the actual SQLite controller. */
export class PublicApiFixture extends RepositoryController {
  async ensureFixture() {
    if (this.ctx.storage.sql.exec("SELECT id FROM project WHERE id=1").toArray().length) return;
    this.ctx.storage.sql.exec("INSERT INTO project VALUES(1,?)", JSON.stringify({ projectId, projectName: "Owner confirmed fixture", canonicalRepoName: "server-private-canonical", acceptedBaseline: { commit: hash, tree, acceptedAt: "2026-10-03" }, acceptedState: { currentCommit: hash, history: [] }, journal: [], tasks: {}, candidates: {}, verificationPolicy: {} }));
    await this.addMember("synthetic-public-owner", "owner");
    this.ctx.storage.sql.exec("CREATE TABLE repository_visibility(id INTEGER PRIMARY KEY,visibility TEXT,version INTEGER,confirmed_by TEXT)");
    this.ctx.storage.sql.exec("INSERT INTO repository_visibility VALUES(1,'private',1,'synthetic-public-owner')");
  }
  setFixtureMode(mode: string) {
    this.ctx.storage.sql.exec("UPDATE repository_visibility SET visibility=?,version=version+1", mode === "private" ? "private" : "public");
    return this.ctx.storage.put("mode", mode);
  }
  revokeFixtureVisibility() { this.ctx.storage.sql.exec("UPDATE repository_visibility SET visibility='private',version=version+1"); }
  fixtureMode() { return this.ctx.storage.get<string>("mode"); }
  async countFixtureRead() { await this.ctx.storage.put("reads", Number(await this.ctx.storage.get("reads") ?? 0) + 1); }
  async fixtureStats() { return { reads: await this.ctx.storage.get("reads") ?? 0 }; }
}

interface FixtureEnv { REPOSITORY_CONTROLLER: DurableObjectNamespace<PublicApiFixture> }
export default { async fetch(request: Request, env: FixtureEnv, ctx: ExecutionContext) {
  const url = new URL(request.url), project = env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`);
  await project.ensureFixture();
  if (url.pathname === "/mode") { await project.setFixtureMode(url.searchParams.get("value") ?? "private"); return Response.json({ ok: true }); }
  if (url.pathname === "/stats") return Response.json(await project.fixtureStats());
  const mode = await project.fixtureMode() ?? "private";
  const rejectWrite = () => { throw new Error("Synthetic public read fixture forbids provider writes"); };
  return worker.fetch(request, {
    REPOSITORY_CONTROLLER: env.REPOSITORY_CONTROLLER,
    LOOKUP_LIMITER: { limit: async ({ key }: { key: string }) => { if (key !== "flaregit:credential/lookups:192.0.2.1") throw new Error("Wrong lookup limiter identity"); return { success: true }; } },
    API_LIMITER: { limit: async ({ key }: { key: string }) => { if (key !== `public:${projectId}:192.0.2.1`) throw new Error("Wrong limiter identity"); return { success: mode !== "limit" }; } },
    ARTIFACTS: { create: rejectWrite, delete: rejectWrite, get: async (name: string) => {
      if (name !== "server-private-canonical") throw new Error("Wrong repository");
      await project.countFixtureRead();
      return {
        [Symbol.dispose]() {},
        log: async (options: { ref?: string }) => { if (options.ref !== hash) throw new Error("Only accepted ancestry may be queried"); return [{ hash, treeHash: tree, message: "Public accepted fixture", author: { name: "Contributor", email: "private@example.com" }, parents: [], committedAt: 1 }]; },
        readTree: async (requested: string) => { if (requested !== tree) throw new Error("Hidden tree read"); return [{ name: "README.md", type: "blob", hash: blob, mode: "100644" }]; },
        readBlob: async (requested: string) => { if (requested !== blob) throw new Error("Hidden blob read"); if (mode === "revoke") await project.revokeFixtureVisibility(); return new Blob(["Owner confirmed accepted source"]); },
      };
    } },
  } as unknown as Env, ctx);
} };
