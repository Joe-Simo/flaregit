import { RepositoryController, PreviewAssetBroker } from "../../src/server/worker";
import worker from "../../src/server/worker";
import { globalOf, accountKeyFor, accountOf } from "../../src/server/projects";
import { resolveRepositoryPreviewOrigin } from "../../src/server/preview-registry";
import { signPreview } from "../../src/server/preview-access";
import type { Env } from "../../src/server/env";
export { RepositoryController, PreviewAssetBroker };

// Test-only RPC control surface. It is never deployed with the application.
export default { async fetch(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  if (url.pathname === "/api/operator/preview-origins/abcdef123456") {
    const account = await accountKeyFor("registry-operator-fixture");
    return worker.fetch(request, { ...env, OPERATOR_ACCOUNTS: account, API_LIMITER: { limit: async () => ({ success: true }) } }, ctx);
  }
  const registry = globalOf(env);
  if (url.pathname === "/fixture/token") {
    const key = await accountKeyFor("registry-operator-fixture");
    const token = `fgt_${key}_${"x".repeat(32)}`;
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
      await env.EVIDENCE_BUCKET.put(`builds/${value.repository}/${commit}/index.html`, `private fixture ${value.repository}`, { httpMetadata: { contentType: "text/html" } });
      const { exp, sig } = await signPreview(env, value.repository, commit, origin);
      return Response.json({ url: `${origin}/preview/${commit}/${exp}/${sig}/` });
    }
    return new Response("Not found", { status: 404 });
  } catch (cause) { return new Response(cause instanceof Error ? cause.message : "Conflict", { status: 409 }); }
} };
