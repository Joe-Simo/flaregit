import { describe, expect, test } from "bun:test";
import type { Env } from "../src/server/env.js";
import { handlePreviewAsset } from "../src/server/preview-broker.js";
import { signPreview } from "../src/server/preview-access.js";
import child from "../src/server/preview-worker.js";

const repository = "abcdef123456";
const commit = "a".repeat(40);
const origin = "https://repo-a.account.workers.dev";
function fixture() {
  const keys: string[] = [];
  const env = {
    REPOSITORY_PREVIEW_ORIGINS: JSON.stringify({ [repository]: origin, "123456abcdef": "https://repo-b.account.workers.dev" }),
    PREVIEW_SIGNING_KEY: "unit-test-signing-key",
    REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: () => ({ previewOrigin: async (id: string) => ({ status: "active", origin: id === repository ? origin : "https://repo-b.account.workers.dev" }) }) },
    CLERK_AUTHORIZED_PARTIES: "https://flaregit.com",
    EVIDENCE_BUCKET: {
      async get(key: string) {
        keys.push(key);
        return { body: "verified build", httpMetadata: { contentType: "text/html" } };
      },
    },
  } as unknown as Env;
  return { env, keys };
}
async function link(env: Env, asset = "", ttl = 3600) {
  const { exp, sig } = await signPreview(env, repository, commit, origin, ttl);
  return `${origin}/preview/${commit}/${exp}/${sig}/${asset}`;
}

describe("repository preview broker", () => {
  test("serves only the signed repository commit prefix and supplies private browser boundaries", async () => {
    const { env, keys } = fixture();
    const response = await handlePreviewAsset(new Request(await link(env)), env, repository);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("verified build");
    expect(keys).toEqual([`builds/${repository}/${commit}/index.html`]);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
  test("relative document and module assets retain the capability path without granting CORS", async () => {
    const { env, keys } = fixture();
    const documentUrl = await link(env);
    const moduleUrl = new URL("./assets/main.js", documentUrl).href;
    const chunkUrl = new URL("./chunk.js", moduleUrl).href;
    for (const url of [documentUrl, moduleUrl, chunkUrl]) {
      const response = await handlePreviewAsset(new Request(url, { headers: { Origin: "https://attacker.example" } }), env, repository);
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
    expect(keys).toEqual([`builds/${repository}/${commit}/index.html`, `builds/${repository}/${commit}/assets/main.js`, `builds/${repository}/${commit}/assets/chunk.js`]);
  });
  test("HEAD authorizes and resolves the same object without returning bytes", async () => {
    const { env, keys } = fixture();
    const response = await handlePreviewAsset(new Request(await link(env, "assets/main.js"), { method: "HEAD" }), env, repository);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(keys).toEqual([`builds/${repository}/${commit}/assets/main.js`]);
  });
  test("rejects audience, repository, commit and expiry substitution before R2", async () => {
    const { env, keys } = fixture();
    const url = await link(env);
    for (const [requestUrl, repo] of [
      [url.replace("repo-a", "repo-b"), repository],
      [url, "123456abcdef"],
      [url.replace(commit, "b".repeat(40)), repository],
      [await link(env, "", -10), repository],
    ]) {
      expect((await handlePreviewAsset(new Request(requestUrl!), env, repo!)).status).toBeGreaterThanOrEqual(400);
    }
    expect(keys).toEqual([]);
  });
  test("rejects ambiguous encoded paths and unsupported methods before R2", async () => {
    const { env, keys } = fixture();
    for (const asset of ["%252e%252e/secret", "%2fsecret", "x%5cy", "x%00y", "x//y", "bad%zz", "x/%2e%2e%2fsecret"]) {
      expect((await handlePreviewAsset(new Request(await link(env, asset)), env, repository)).status).toBe(404);
    }
    expect((await handlePreviewAsset(new Request(await link(env), { method: "POST" }), env, repository)).status).toBe(405);
    expect(keys).toEqual([]);
  });
  test("missing asset is private and fail closed", async () => {
    const { env } = fixture();
    env.EVIDENCE_BUCKET = { get: async () => null } as unknown as R2Bucket;
    const response = await handlePreviewAsset(new Request(await link(env)), env, repository);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("stateless preview child", () => {
  test("forwards only fixed repository identity, dropping all browser credentials and IP metadata", async () => {
    const { env } = fixture();
    let forwarded: Request | undefined;
    const binding = { fetch: async (request: Request) => { forwarded = request; return new Response("asset"); } } as unknown as Fetcher;
    const url = await link(env);
    const response = await child.fetch(new Request(url, { headers: { Cookie: "session=secret", Authorization: "Bearer secret", "x-preview-repository-id": "other", "CF-Connecting-IP": "192.0.2.1", Origin: "https://flaregit.com" } }), { REPOSITORY_ID: repository, ASSET_BROKER: binding });
    expect(response.status).toBe(200);
    expect(forwarded?.url).toBe(url);
    expect([...forwarded!.headers]).toEqual([["x-preview-repository-id", repository]]);
  });
  test("app APIs and root never reach the privileged service binding", async () => {
    let calls = 0;
    const binding = { fetch: async () => { calls++; return new Response(); } } as unknown as Fetcher;
    for (const path of ["/", "/api/config", "/api/repositories", `/preview/${commit}/`]) {
      expect((await child.fetch(new Request(`${origin}${path}`), { REPOSITORY_ID: repository, ASSET_BROKER: binding })).status).toBe(404);
    }
    expect(calls).toBe(0);
  });
});
