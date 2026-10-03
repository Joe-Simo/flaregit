import { TICKET_BOOKING_POLICY } from "../../src/fixtures/ticket-booking/policy";
import { RepositoryController, PreviewAssetBroker } from "../../src/server/worker";
import worker from "../../src/server/worker";
import { globalOf, accountKeyFor, accountOf, projectOf } from "../../src/server/projects";
import { resolveRepositoryPreviewOrigin } from "../../src/server/preview-registry";
import { signPreview } from "../../src/server/preview-access";
import type { Env } from "../../src/server/env";
export { PreviewAssetBroker };
export class PreviewRegistryFixture extends RepositoryController {
  async seedPreviewMember(): Promise<void> {
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO members VALUES('registry-operator-fixture','owner','Fixture operator','now')");
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO project VALUES(1,?)", JSON.stringify({ projectId: "abcdef123456", projectName: "Synthetic registry fixture", canonicalRepoName: "fixture", acceptedState: { currentCommit: "a".repeat(40) }, tasks: {}, verificationPolicy: TICKET_BOOKING_POLICY }));
  }
  async registryWrites(): Promise<number> { return this.ctx.storage.sql.exec<{ count: number }>("SELECT total_changes() AS count").one().count; }
  async restartRegistry(): Promise<void> { this.ctx.abort("Synthetic fixture cold restart"); }
}

// Test-only RPC control surface. It is never deployed with the application.
export default { async fetch(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/p/abcdef123456")) {
    let registryCalls = 0;
    const sourceNamespace = env.REPOSITORY_CONTROLLER;
    const namespace = {
      idFromName: (name: string) => sourceNamespace.idFromName(name),
      get: (id: DurableObjectId) => id.equals(sourceNamespace.idFromName("global")) ? { activePreviewOrigin: async () => { registryCalls++; throw new Error("fixture outage secret=not-for-users"); } } : sourceNamespace.get(id),
    } as unknown as DurableObjectNamespace;
    const response = await worker.fetch(request, { ...env, REPOSITORY_CONTROLLER: namespace, API_LIMITER: { limit: async () => ({ success: true }) } }, ctx);
    const headers = new Headers(response.headers); headers.set("x-fixture-registry-calls", String(registryCalls));
    return new Response(response.body, { status: response.status, headers });
  }
  if (url.pathname === "/api/operator/preview-origins/abcdef123456") {
    const account = await accountKeyFor("registry-operator-fixture");
    return worker.fetch(request, { ...env, OPERATOR_ACCOUNTS: account, API_LIMITER: { limit: async () => ({ success: true }) } }, ctx);
  }
  const registry = globalOf(env);
  const fixture = env.REPOSITORY_CONTROLLER.getByName("global") as unknown as PreviewRegistryFixture;
  if (url.pathname === "/fixture/writes") return Response.json({ writes: await fixture.registryWrites() });
  if (url.pathname === "/fixture/restart") { try { await fixture.restartRegistry(); } catch { /* Expected cold restart. */ } return new Response("Restarted"); }
  if (url.pathname === "/fixture/token") {
    const key = await accountKeyFor("registry-operator-fixture");
    const token = `fgt_${key}_${"x".repeat(32)}`;
    await (env.REPOSITORY_CONTROLLER.getByName("project:abcdef123456") as unknown as PreviewRegistryFixture).seedPreviewMember();
    await accountOf(env, key).createApiToken("registry-operator-fixture", "test operator API token", token, { scope: "full" });
    return Response.json({ token });
  }
  const value = await request.json() as { repository: string; origin?: string; operation: string };
  try {
    if (value.operation === "register") return Response.json(await registry.registerPreviewOrigin(value.repository, value.origin!, "fixture-operator", "https://flaregit.com"));
    if (value.operation === "retire") return Response.json(await registry.retirePreviewOrigin(value.repository, "fixture-operator", "https://flaregit.com"));
    if (value.operation === "resolve") return Response.json({ origin: await resolveRepositoryPreviewOrigin(env, value.repository, "https://flaregit.com") });
    if (value.operation === "link") {
      const origin = await resolveRepositoryPreviewOrigin(env, value.repository, "https://flaregit.com");
      if (!origin) return new Response("Unavailable", { status: 404 });
      const commit = "a".repeat(40);
      await projectOf(env, value.repository).initialize({projectId:value.repository,projectName:"Synthetic registry fixture",canonicalRepoName:`flaregit-${value.repository}`,head:commit,verificationPolicy:TICKET_BOOKING_POLICY,ownerId:"registry-operator-fixture"});
      await env.EVIDENCE_BUCKET.put(`builds/${value.repository}/${commit}/index.html`, `private fixture ${value.repository}`, { httpMetadata: { contentType: "text/html" } });
      const { exp, sig } = await signPreview(env, value.repository, commit, origin);
      return Response.json({ url: `${origin}/preview/${commit}/${exp}/${sig}/` });
    }
    return new Response("Not found", { status: 404 });
  } catch (cause) { return new Response(cause instanceof Error ? cause.message : "Conflict", { status: 409 }); }
} };
