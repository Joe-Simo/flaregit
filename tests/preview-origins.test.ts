import { expect, test } from "bun:test";
import type { Env } from "../src/server/env.js";
import { repositoryPreviewOrigin, repositoryForPreviewOrigin, signPreview, verifyPreview } from "../src/server/preview-access.js";
const origin = "https://repo.account.workers.dev";
const env = (mapping: unknown, overrides: Partial<Env> = {}) => ({ REPOSITORY_PREVIEW_ORIGINS: JSON.stringify(mapping), ...overrides }) as Env;
test("repository origins resolve in both directions", () => {
  const config = env({ p0123456789ab: origin, pabcdef012345: "https://other.account.workers.dev/" });
  expect(repositoryPreviewOrigin(config, "p0123456789ab")).toBe(origin);
  expect(repositoryForPreviewOrigin(config, origin)).toBe("p0123456789ab");
  expect(repositoryPreviewOrigin(config, "unknown")).toBeNull();
});
test("ambiguous or unsafe mappings fail closed", () => {
  for (const mapping of [[], null, { "../repository": origin }, { p0123456789ab: origin, pabcdef012345: origin }, { p0123456789ab: "https://account.workers.dev" }, { p0123456789ab: "https://preview.example.com" }, { p0123456789ab: origin + "/path" }, { p0123456789ab: origin + "?a=b" }, { p0123456789ab: origin + "#a" }, { p0123456789ab: "http://repo.account.workers.dev" }, { p0123456789ab: "https://user@repo.account.workers.dev" }, { p0123456789ab: "https://repo.account.workers.dev:8080" }]) {
    expect(repositoryPreviewOrigin(env(mapping), "p0123456789ab")).toBeNull();
  }
  expect(repositoryPreviewOrigin(env({ p0123456789ab: origin }, { CLERK_AUTHORIZED_PARTIES: origin }), "p0123456789ab")).toBeNull();
  expect(repositoryPreviewOrigin(env({ p0123456789ab: origin }, { CLERK_ISSUER: origin }), "p0123456789ab")).toBeNull();
  expect(repositoryPreviewOrigin(env({ p0123456789ab: origin }), "p0123456789ab", origin)).toBeNull();
  expect(repositoryPreviewOrigin(env({ p0123456789ab: origin }), "p0123456789ab", "https://app.account.workers.dev")).toBeNull();
  expect(repositoryPreviewOrigin(env({ p0123456789ab: origin }, { CLERK_ISSUER: "https://account.workers.dev" }), "p0123456789ab")).toBeNull();
  expect(repositoryPreviewOrigin(env({ p0123456789ab: origin }, { CLERK_AUTHORIZED_PARTIES: "https://auth.account.workers.dev" }), "p0123456789ab")).toBeNull();
});
test("capability binds its audience", async () => {
  const config = env({ p0123456789ab: origin }, { PREVIEW_SIGNING_KEY: "test-key" });
  const { exp, sig } = await signPreview(config, "p0123456789ab", "a".repeat(40), origin);
  expect(await verifyPreview(config, "p0123456789ab", "a".repeat(40), origin, exp, sig)).toBe(true);
  expect(await verifyPreview(config, "p0123456789ab", "a".repeat(40), "https://other.account.workers.dev", exp, sig)).toBe(false);
});
