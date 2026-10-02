import { DurableObject } from "cloudflare:workers";
import worker from "../../src/server/worker";
import type { Env } from "../../src/server/env";
export class PublicApiFixture extends DurableObject {
  override async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/mode") { await this.ctx.storage.put("mode", url.searchParams.get("value")); return Response.json({ ok: true }); }
    if (url.pathname === "/stats") return Response.json({ reads: await this.ctx.storage.get("reads") ?? 0 });
    const mode = await this.ctx.storage.get<string>("mode") ?? "private";
    let calls = 0;
    const hash = "a".repeat(40), tree = "b".repeat(40);
    const grant = { visibility: "public" as const, confirmedByOwner: true as const, acceptedCommit: hash, name: "Owner confirmed fixture", version: 1, canonicalRepoName: "server-private-canonical" };
    const env = {
      REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: (name: string) => ({ publicGrant: async () => {
        calls++;
        return name !== "project:abcdef123456" || mode === "private" || (mode === "revoke" && calls > 1) ? null : grant;
      } }) },
      API_LIMITER: { limit: async ({ key }: { key: string }) => { if (key !== "public:abcdef123456:192.0.2.1") throw new Error("Wrong limiter identity"); return { success: mode !== "limit" }; } },
      ARTIFACTS: { get: async (name: string) => {
        if (name !== grant.canonicalRepoName) throw new Error("Wrong repository");
        await this.ctx.storage.put("reads", Number(await this.ctx.storage.get("reads") ?? 0) + 1);
        return {
          [Symbol.dispose]() {},
          log: async () => [{ hash, treeHash: tree, message: "Public accepted fixture", author: { name: "Contributor", email: "private@example.com" }, parents: [], committedAt: 1 }],
          readTree: async () => [{ name: "README.md", type: "blob", hash: "c".repeat(40), mode: "100644" }],
          readBlob: async () => new Blob(["Owner confirmed accepted source"]),
        };
      } },
    } as unknown as Env;
    return worker.fetch(request, env, this.ctx as unknown as ExecutionContext);
  }
}
export default { fetch: (request: Request, env: { TEST: DurableObjectNamespace<PublicApiFixture> }) => env.TEST.getByName("one").fetch(request) };
