import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";

test("real durable preview reservations are atomic, immutable, and retirement blocks existing signed links", async () => {
  if (await workerdChild("tests/preview-registry.test.ts")) return;
  async function bundle(entrypoint: string) {
    const output = `/tmp/flaregit-preview-registry-${crypto.randomUUID()}.js`;
    const build = Bun.spawn([process.execPath, "build", entrypoint, "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${output}`], { stdout: "ignore", stderr: "pipe" });
    try {
      const [error, code] = await Promise.all([new Response(build.stderr).text(), build.exited]);
      if (code !== 0) throw new Error(error);
      return await Bun.file(output).text();
    } finally { if (await Bun.file(output).exists()) await Bun.file(output).delete(); }
  }
  const [mainScript, childScript] = await Promise.all([bundle("tests/support/preview-registry-worker.ts"), bundle("tests/support/preview-service-child.ts")]);
  const repoA = "abcdef123456", repoB = "123456abcdef", repoC = "abcdef654321";
  const originA = "https://repo-a.fixture.workers.dev", originB = "https://repo-b.fixture.workers.dev";
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "registry-main", modules: true, script: mainScript, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], unsafeDirectSockets: [{ host: "127.0.0.1" }], durableObjects: { REPOSITORY_CONTROLLER: { className: "PreviewRegistryFixture", useSQLite: true } }, ratelimits: { PREVIEW_ASSET_LIMITER: { namespace_id: "1003", simple: { limit: 600, period: 60 } } }, r2Buckets: ["EVIDENCE_BUCKET"], bindings: { PREVIEW_SIGNING_KEY: "registry-test-only-secret", CLERK_AUTHORIZED_PARTIES: "https://flaregit.com", REPOSITORY_PREVIEW_ORIGINS: JSON.stringify({ [repoA]: originA }) } },
    { name: "registry-child", modules: true, script: childScript, compatibilityDate: "2026-10-02", unsafeDirectSockets: [{ host: "127.0.0.1" }], bindings: { REPOSITORY_ID: repoA }, serviceBindings: { ASSET_BROKER: { name: "registry-main", entrypoint: "PreviewAssetBroker" } } },
  ] }));
  try {
    const base = await mf.unsafeGetDirectURL("registry-main");
    const call = (operation: string, repository = repoA, origin?: string) => fetch(base, { method: "POST", headers: { Connection: "close" }, body: JSON.stringify({ operation, repository, origin }) });
    expect(await (await call("resolve")).json<unknown>()).toEqual({ origin: originA });
    const writes = async () => (await (await fetch(new URL("/fixture/writes", base))).json() as { writes: number }).writes;
    const initialWrites = await writes();
    for (let index = 0; index < 3; index++) expect(await (await call("resolve")).json<unknown>()).toEqual({ origin: originA });
    expect(await writes()).toBe(initialWrites);
    await fetch(new URL("/fixture/restart", base));
    const restartedWrites = await writes();
    expect(await (await call("resolve")).json<unknown>()).toEqual({ origin: originA });
    expect(await writes()).toBe(restartedWrites);
    expect((await call("register", repoB, originA)).status).toBe(409);
    const races = await Promise.all([call("register", repoB, originB), call("register", repoC, originB)]);
    expect(races.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await call("register", repoA, "https://replacement.fixture.workers.dev")).status).toBe(409);
    expect((await call("register", repoA, originA)).status).toBe(200);
    const { url: link } = await (await call("link")).json() as { url: string };
    const childBase = await mf.unsafeGetDirectURL("registry-child");
    const asset = new URL(childBase); asset.searchParams.set("target", link);
    expect((await fetch(asset)).status).toBe(200);
    expect((await call("retire")).status).toBe(200);
    expect(await (await call("resolve")).json<unknown>()).toEqual({ origin: null });
    expect((await fetch(asset)).status).toBe(404);
    expect((await call("register", repoA, originA)).status).toBe(409);
    const replacement = "https://replacement.fixture.workers.dev";
    expect((await call("register", repoA, replacement)).status).toBe(200);
    expect(await (await call("resolve")).json<unknown>()).toEqual({ origin: replacement });
    const { url: replacementLink } = await (await call("link")).json() as { url: string };
    const replacementAsset = new URL(childBase); replacementAsset.searchParams.set("target", replacementLink);
    expect((await fetch(replacementAsset)).status).toBe(200);
    expect((await fetch(asset)).status).toBe(404);
    await fetch(new URL("/fixture/restart", base));
    expect(await (await call("resolve")).json<unknown>()).toEqual({ origin: replacement });
    expect((await fetch(asset)).status).toBe(404);
    expect((await call("register", repoC, originA)).status).toBe(409);
    for (const origin of ["https://flaregit.com", "https://x.flaregit.com", "https://valid.fixture.workers.dev/path", "https://valid.fixture.workers.dev:444", "http://valid.fixture.workers.dev"]) {
      expect((await call("register", repoC, origin)).status).toBe(409);
    }
    const { token } = await (await fetch(new URL("/fixture/token", base))).json() as { token: string };
    const previewOutage = await fetch(new URL(`/api/p/${repoA}/preview`, base), { headers: { Authorization: `Bearer ${token}`, Connection: "close" } });
    expect(previewOutage.status).toBe(200);
    expect(previewOutage.headers.get("Cache-Control")).toBe("no-store");
    expect(previewOutage.headers.get("x-fixture-registry-calls")).toBe("1");
    const pending = await previewOutage.json() as { ready: boolean; status: string; canRetry: boolean; reason: string };
    expect(pending.ready).toBe(false); expect(pending.status).toBe("pending"); expect(pending.canRetry).toBe(false);
    expect(pending.reason).not.toContain("secret");
    const repositoryView = await fetch(new URL(`/api/p/${repoA}`, base), { headers: { Authorization: `Bearer ${token}`, Connection: "close" } });
    expect(repositoryView.status).toBe(200);
    expect(repositoryView.headers.get("x-fixture-registry-calls")).toBe("0");
    const operatorApi = new URL(`/api/operator/preview-origins/${repoA}`, base);
    for (const method of ["GET", "PUT", "DELETE"]) {
      expect((await fetch(operatorApi, { method, headers: { Authorization: `Bearer ${token}`, Connection: "close" }, ...(method === "PUT" ? { body: JSON.stringify({ origin: originA, remoteConfigurationVerified: true }) } : {}) })).status).toBe(404);
    }
  } finally { await mf.dispose(); }
}, 30_000);
