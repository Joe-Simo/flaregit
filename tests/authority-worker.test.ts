import { workerdChild } from "./support/workerd-child";
import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://app.example/cb";

test("the authority Durable Object runs under workerd: OAuth and registry state persist across requests", async () => {
  if (await workerdChild("tests/authority-worker.test.ts")) return;
  const built = await Bun.build({ entrypoints: ["tests/support/authority-worker.ts"], target: "browser", external: ["cloudflare:workers", "node:*"] });
  if (!built.success) throw new Error(built.logs.join("\n"));
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "authority-test",
      unsafeDirectSockets: [{ host: "127.0.0.1" }],
      modules: true,
      script: await built.outputs[0]!.text(),
      compatibilityDate: "2026-10-02",
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { AUTHORITY: { className: "AuthorityController", useSQLite: true } },
    }],
  }));
  try {
    const url = await mf.unsafeGetDirectURL("authority-test");
    const call = async (input: Record<string, unknown>) => {
      const response = await fetch(new URL("/__call", url), { method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json" } });
      return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
    };

    const app = await call({ method: "POST", pathname: "/api/oauth/apps", body: { name: "App", redirectUris: [REDIRECT], scopes: ["code:read"] }, userId: "u-1" });
    expect(app.status).toBe(201);
    const clientId = app.body!.clientId as string;

    const authorized = await call({ method: "POST", pathname: "/api/oauth/authorize", body: { clientId, redirectUri: REDIRECT, scope: "code:read", codeChallenge: CHALLENGE }, userId: "u-1" });
    expect(authorized.status).toBe(200);
    const code = authorized.body!.code as string;

    const token = { grant_type: "authorization_code", code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER };
    const exchanged = await call({ method: "POST", pathname: "/api/oauth/token", body: token });
    expect(exchanged.status).toBe(200);
    // The same code again, on a later request, must be refused: the used flag was stored in the object's SQLite.
    expect((await call({ method: "POST", pathname: "/api/oauth/token", body: token })).status).toBe(400);

    const published = await call({ method: "POST", pathname: "/api/registry/widget/1.0.0", body: { files: { "index.ts": "export const w = 1;\n" } }, userId: "acme" });
    expect(published.status).toBe(201);
    expect((await call({ method: "POST", pathname: "/api/registry/widget/1.0.0", body: { files: { "index.ts": "changed" } }, userId: "acme" })).status).toBe(409);
    const fetched = await fetch(new URL("/__call", url), {
      method: "POST",
      body: JSON.stringify({ method: "GET", pathname: "/api/registry/widget/1.0.0/files/index.ts", search: "", body: undefined }),
      headers: { "content-type": "application/json" },
    });
    expect(await fetched.text()).toBe("export const w = 1;\n");
  } finally {
    await mf.dispose();
  }
});
