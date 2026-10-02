import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
test("production public Worker routes deny private state and revoked reads without exposing admin data", async () => {
  if (await workerdChild("tests/public-api.test.ts")) return;
  const built = await Bun.build({ entrypoints: ["tests/support/public-api-worker.ts"], target: "browser", external: ["cloudflare:workers", "node:*"] });
  if (!built.success) throw new Error(built.logs.join("\n"));
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "public-api-test", modules: true, script: await built.outputs[0]!.text(), compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { TEST: { className: "PublicApiFixture", useSQLite: true } } }] }));
  const request = async (path: string, method = "GET") => (await mf.getWorker("public-api-test")).fetch(`http://test${path}`, { method, headers: { "CF-Connecting-IP": "192.0.2.1" } });
  const prefix = "/api/public/abcdef123456";
  try {
    expect((await request(`${prefix}/file?path=README.md`)).status).toBe(404);
    expect(await (await request("/stats")).json()).toEqual({ reads: 0 });
    await request("/mode?value=public");
    const meta = await request(`${prefix}/meta`);
    expect(meta.status).toBe(200);
    expect(meta.headers.get("Cache-Control")).toBe("no-store");
    expect(await meta.json()).toEqual({ id: "abcdef123456", name: "Owner confirmed fixture", acceptedCommit: "a".repeat(40), visibility: "public", version: 1 });
    const file = await request(`${prefix}/file?path=README.md`);
    expect(file.status).toBe(200);
    expect(await file.json()).toMatchObject({ kind: "file", file: { content: "Owner confirmed accepted source" } });
    const history = await (await request(`${prefix}/history`)).text();
    expect(history).not.toContain("private@example.com");
    expect(history).not.toContain("server-private-canonical");
    expect((await request(`${prefix}/file?commit=${"f".repeat(40)}&path=README.md`)).status).toBe(404);
    expect((await request(`${prefix}/tree?commit=refs/heads/hidden`)).status).toBe(400);
    expect((await request(`${prefix}/meta?token=secret`)).status).toBe(400);
    expect((await request(`${prefix}/connections`)).status).toBe(404);
    expect((await request(`${prefix}/meta`, "POST")).status).toBe(404);
    await request("/mode?value=revoke");
    const revoked = await request(`${prefix}/file?path=README.md`);
    expect(revoked.status).toBe(409);
    expect(await revoked.text()).not.toContain("Owner confirmed accepted source");
    await request("/mode?value=limit");
    expect((await request(`${prefix}/meta`)).status).toBe(429);
  } finally { await mf.dispose(); }
}, 30_000);
