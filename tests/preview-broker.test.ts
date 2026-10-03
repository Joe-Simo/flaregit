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
  const lookups: string[] = [];
  const env = {
    REPOSITORY_PREVIEW_ORIGINS: JSON.stringify({ [repository]: origin, "123456abcdef": "https://repo-b.account.workers.dev" }),
    PREVIEW_SIGNING_KEY: "unit-test-signing-key",
    REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: () => ({ previewAvailable: async () => true, activePreviewOrigin: async (id: string) => { lookups.push(id); return id === repository ? origin : "https://repo-b.account.workers.dev"; } }) },
    CLERK_AUTHORIZED_PARTIES: "https://flaregit.com",
    EVIDENCE_BUCKET: {
      async get(key: string) {
        keys.push(key);
        return { body: "verified build", httpMetadata: { contentType: "text/html" } };
      },
    },
  } as unknown as Env;
  return { env, keys, lookups };
}
async function link(env: Env, asset = "", ttl = 3600) {
  const { exp, sig } = await signPreview(env, repository, commit, origin, ttl);
  return `${origin}/preview/${commit}/${exp}/${sig}/${asset}`;
}

describe("repository preview broker", () => {
  test("invalid capabilities and malformed paths never invoke the global registry", async () => {
    const { env, keys, lookups } = fixture();
    const valid = await link(env);
    for (const target of [valid.replace(/\/[0-9a-f]{64}\/$/, `/${"0".repeat(64)}/`), await link(env, "", -10), valid.replace(commit, "b".repeat(40)), `${valid}x/%2e%2e%2fsecret`, `${origin}/not-a-preview`]) {
      expect((await handlePreviewAsset(new Request(target), env, repository)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await handlePreviewAsset(new Request(valid, { method: "POST" }), env, repository)).status).toBe(405);
    expect(lookups).toEqual([]);
    expect(keys).toEqual([]);
  });
  test("registry outage returns sanitized retryable 503 without reading private assets", async () => {
    const { env, keys } = fixture();
    env.REPOSITORY_CONTROLLER = { idFromName: (name: string) => name, get: () => ({ previewAvailable: async () => true, activePreviewOrigin: async () => { throw new Error("provider secret=test-private-value"); } }) } as unknown as DurableObjectNamespace;
    const response = await handlePreviewAsset(new Request(await link(env)), env, repository);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).not.toContain("test-private-value");
    expect(keys).toEqual([]);
  });

  test("repository or owner revocation blocks storage and authority outage returns retryable failure", async () => {
    for (const unavailable of [false, true]) {
      const { env, keys } = fixture();
      env.REPOSITORY_CONTROLLER = {idFromName: (name: string) => name, get: (id: string) => id === "global" ? {activePreviewOrigin:async()=>origin} : {previewAvailable:async()=>{if(unavailable)throw new Error("private lifecycle internals");return false;}}} as unknown as Env["REPOSITORY_CONTROLLER"];
      const response = await handlePreviewAsset(new Request(await link(env)), env, repository);
      expect(response.status).toBe(unavailable ? 503 : 404); expect(await response.text()).not.toContain("internals"); expect(keys).toEqual([]);
    }
  });
  test("revocation during storage read withholds response headers and private bytes", async () => {
    const { env, keys } = fixture(); let active = true;
    env.REPOSITORY_CONTROLLER = {idFromName: (name: string) => name, get: (id: string) => id === "global" ? {activePreviewOrigin:async()=>origin} : {previewAvailable:async()=>active}} as unknown as Env["REPOSITORY_CONTROLLER"];
    const originalGet = env.EVIDENCE_BUCKET.get.bind(env.EVIDENCE_BUCKET);
    env.EVIDENCE_BUCKET.get = (async (key: string) => {const object=await originalGet(key);active=false;return object;}) as typeof env.EVIDENCE_BUCKET.get;
    const response = await handlePreviewAsset(new Request(await link(env)), env, repository);
    expect(response.status).toBe(404); expect(await response.text()).not.toContain("verified build"); expect(keys).toHaveLength(1);
  });
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
