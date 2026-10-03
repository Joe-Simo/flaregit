import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";

test("real child binding invokes the main named broker and isolates real R2 repository assets", async () => {
  if (await workerdChild("tests/preview-service-binding.test.ts")) return;
  async function bundle(entrypoint: string) {
    const output = `/tmp/flaregit-preview-binding-${crypto.randomUUID()}.js`;
    const build = Bun.spawn([process.execPath, "build", entrypoint, "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${output}`], { stdout: "ignore", stderr: "pipe" });
    try {
      const [error, code] = await Promise.all([new Response(build.stderr).text(), build.exited]);
      if (code !== 0) throw new Error(error);
      return await Bun.file(output).text();
    } finally { if (await Bun.file(output).exists()) await Bun.file(output).delete(); }
  }
  const [mainScript, childScript] = await Promise.all([bundle("tests/support/preview-service-worker.ts"), bundle("tests/support/preview-service-child.ts")]);
  const repoA = "abcdef123456", repoB = "123456abcdef", repoC = "abcdef123457", repoD = "abcdef123458";
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "preview-main", modules: true, script: mainScript, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], unsafeDirectSockets: [{ host: "127.0.0.1" }], r2Buckets: ["EVIDENCE_BUCKET"], durableObjects: { REPOSITORY_CONTROLLER: { className: "RepositoryController", useSQLite: true } }, bindings: { PREVIEW_SIGNING_KEY: "binding-test-only-secret", CLERK_AUTHORIZED_PARTIES: "https://flaregit.com", REPOSITORY_PREVIEW_ORIGINS: JSON.stringify({ [repoA]: "https://repo-a.preview-fixture.workers.dev", [repoB]: "https://repo-b.preview-fixture.workers.dev", [repoC]: "https://repo-c.preview-fixture.workers.dev", [repoD]: "https://repo-d.preview-fixture.workers.dev" }) } },
    { name: "preview-child", modules: true, script: childScript, compatibilityDate: "2026-10-02", unsafeDirectSockets: [{ host: "127.0.0.1" }], bindings: { REPOSITORY_ID: repoA }, serviceBindings: { ASSET_BROKER: { name: "preview-main", entrypoint: "PreviewAssetBroker" } } },
    ...[repoC, repoD].map(repository => ({ name: `preview-child-${repository}`, modules: true as const, script: childScript, compatibilityDate: "2026-10-02", unsafeDirectSockets: [{ host: "127.0.0.1" }], bindings: { REPOSITORY_ID: repository }, serviceBindings: { ASSET_BROKER: { name: "preview-main", entrypoint: "PreviewAssetBroker" } } })),
  ] }));
  try {
    const main = await mf.unsafeGetDirectURL("preview-main");
    const links = await (await fetch(main)).json() as Record<string, string>;
    const child = await mf.unsafeGetDirectURL("preview-child");
    const call = (target: string, method = "GET") => {
      const url = new URL(child); url.searchParams.set("target", target);
      return fetch(url, { method, headers: { Connection: "close", Cookie: "fixture-secret=never-forward", Authorization: "Bearer never-forward", "x-preview-repository-id": repoB } });
    };
    const index = await call(links[repoA]!);
    expect(index.status).toBe(200);
    expect(await index.text()).toBe(`private fixture ${repoA}`);
    expect(index.headers.get("Set-Cookie")).toBeNull();
    expect(index.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(index.headers.get("Referrer-Policy")).toBe("no-referrer");
    const module = await call(new URL("assets/main.js", links[repoA]).href);
    expect(module.status).toBe(200);
    expect(module.headers.get("Content-Type")).toBe("application/javascript");
    expect(await module.text()).toContain(repoA);
    const head = await call(links[repoA]!, "HEAD");
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
    for (const target of [links[repoB]!, links[repoA]!.replace("repo-a", "repo-b"), links[repoA]!.replace("a".repeat(40), "b".repeat(40)), `${links[repoA]}x/%2e%2e%2fsecret`, links[repoA]!.replace(/\/[0-9a-f]{64}\/$/, `/${"0".repeat(64)}/`)]) {
      const response = await call(target);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain("private fixture");
    }
    // Real SQLite lifecycle fences revoke still-signed links while their real R2 bytes remain.
    for (const [repository, operation] of [[repoA, "delete-account"], [repoC, "delete-repository"], [repoD, "destroy-repository"]] as const) {
      const endpoint = repository === repoA ? child : await mf.unsafeGetDirectURL(`preview-child-${repository}`);
      const target = new URL(endpoint); target.searchParams.set("target", links[repository]!);
      expect((await fetch(target)).status).toBe(200);
      if (operation === "destroy-repository") await fetch(new URL(`/delete-repository?repository=${repository}`, main));
      expect((await fetch(new URL(`/${operation}?repository=${repository}`, main))).status).toBe(200);
      for (const method of ["GET", "HEAD"]) {
        const revoked = await fetch(target, {method});
        expect(revoked.status).toBe(404); expect(await revoked.text()).not.toContain("private fixture");
      }
    }
  } finally { await mf.dispose(); }
}, 30_000);
