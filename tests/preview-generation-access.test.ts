import { expect, test } from "bun:test";
import type { Env } from "../src/server/env.js";
import { generationBuildPrefix, signPreview, signPreviewGeneration, verifyPreviewGeneration } from "../src/server/preview-access.js";
import { handlePreviewAsset } from "../src/server/preview-broker.js";
import child from "../src/server/preview-worker.js";

const pid = "abcdef123456";
const commit = "a".repeat(40);
const inc = "11111111-1111-4111-8111-111111111111";
const gen = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const origin = "https://repo.account.workers.dev";
function fixture(decisions: (boolean | Error)[] = [true, true]) {
  const keys: string[] = [];
  const checks: string[][] = [];
  const env = {
    PREVIEW_ASSET_LIMITER: { limit: async () => ({ success: true }) },
    PREVIEW_SIGNING_KEY: "unit-test-key",
    REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: (id: string) => id === "global" ? { activePreviewOrigin: async () => origin } : {
      previewGenerationForRead: async (...args: string[]) => { checks.push(args); const result = decisions.shift(); if (result instanceof Error) throw result; return result; },
      previewAvailable: async () => true, previewLegacyGenerationAllowed: async () => false,
    } },
    EVIDENCE_BUCKET: { get: async (key: string) => { keys.push(key); return { arrayBuffer: async () => new TextEncoder().encode("private asset").buffer, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("private asset")); controller.close(); } }), httpMetadata: { contentType: "text/html" } }; } },
  } as unknown as Env;
  return { env, keys, checks };
}
async function link(env: Env) {
  const { exp, sig } = await signPreviewGeneration(env, pid, commit, inc, gen, origin);
  return `${origin}/preview-v3/${commit}/${inc}/${gen}/${exp}/${sig}/`;
}
test("generation capabilities bind every identity and reject v2 signatures", async () => {
  const { env } = fixture();
  const { exp, sig } = await signPreviewGeneration(env, pid, commit, inc, gen, origin);
  expect(await verifyPreviewGeneration(env, pid, commit, inc, gen, origin, exp, sig)).toBe(true);
  for (const args of [["123456abcdef", commit, inc, gen, origin], [pid, "b".repeat(40), inc, gen, origin], [pid, commit, other, gen, origin], [pid, commit, inc, other, origin], [pid, commit, inc, gen, "https://elsewhere.example"]]) {
    expect(await verifyPreviewGeneration(env, args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, exp, sig)).toBe(false);
  }
  const old = await signPreview(env, pid, commit, origin);
  expect(await verifyPreviewGeneration(env, pid, commit, inc, gen, origin, old.exp, old.sig)).toBe(false);
});
test("generation broker reads exact immutable prefix and rechecks authority", async () => {
  const { env, keys, checks } = fixture();
  const response = await handlePreviewAsset(new Request(await link(env)), env, pid);
  expect(response.status).toBe(200); expect(await response.text()).toBe("private asset");
  expect(keys).toEqual([`${generationBuildPrefix(pid, commit, inc, gen)}/index.html`]);
  expect(checks).toEqual([[commit, inc, gen], [commit, inc, gen]]);
});
test("revocation and authority failures withhold generation bytes", async () => {
  for (const decisions of [[false], [new Error("private error")], [true, false], [true, new Error("private error")]]) {
    const { env, keys } = fixture([...decisions]);
    const response = await handlePreviewAsset(new Request(await link(env)), env, pid);
    expect(response.status).toBe(decisions.at(-1) instanceof Error ? 503 : 404);
    expect(await response.text()).not.toContain("private");
    expect(keys).toHaveLength(decisions.length === 1 ? 0 : 1);
  }
});
test("old capability cannot access quarantined commit or replacement prefix", async () => {
  const { env, keys } = fixture(); const { exp, sig } = await signPreview(env, pid, commit, origin);
  expect((await handlePreviewAsset(new Request(`${origin}/preview/${commit}/${exp}/${sig}/`), env, pid)).status).toBe(404);
  expect(keys).toEqual([]);
});
test("generation child strips browser secrets and rejects malformed identities", async () => {
  const { env } = fixture(); let forwarded: Request | undefined;
  const binding = { fetch: async (request: Request) => { forwarded = request; return new Response(); } } as unknown as Fetcher;
  const url = await link(env);
  expect((await child.fetch(new Request(url, { headers: { Cookie: "secret", Authorization: "secret" } }), { REPOSITORY_ID: pid, ASSET_BROKER: binding })).status).toBe(200);
  expect([...forwarded!.headers]).toEqual([["x-preview-repository-id", pid]]);
  expect((await child.fetch(new Request(url.replace(inc, "bad")), { REPOSITORY_ID: pid, ASSET_BROKER: binding })).status).toBe(404);
});
