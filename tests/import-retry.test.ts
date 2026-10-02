import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
test("unknown import dispatch retry preserves original operation and head after accepted history moves", async () => {
  if (await workerdChild("tests/import-retry.test.ts")) return;
  const path = `/tmp/flaregit-import-retry-${crypto.randomUUID()}.js`;
  const built = Bun.spawn([process.execPath, "build", "tests/support/import-retry-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:crypto", `--outfile=${path}`], { stdout: "ignore", stderr: "pipe" });
  if (await built.exited !== 0) throw new Error(await new Response(built.stderr).text());
  const script = await Bun.file(path).text(); await Bun.file(path).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "import-retry-test", modules: true, script, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { TEST: { className: "ImportRetryFixture", useSQLite: true } } }] }));
  const request = async (path: string, body?: object) => (await mf.getWorker("import-retry-test")).fetch(`http://test${path}`, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { Authorization: `Bearer fgt_abcdef123456_${"x".repeat(32)}` } });
  try {
    const route = "/api/p/abcdef123456/import-history";
    const firstResponse = await request(route, {});
    expect(firstResponse.status).toBe(202);
    const first = await firstResponse.json() as { instanceId: string; head: string; status: string };
    expect(first.status).toBe("dispatch-unknown");
    await request("/move");
    const retry = await (await request(route, { instanceId: first.instanceId })).json() as typeof first;
    expect(retry.instanceId).toBe(first.instanceId);
    expect(retry.head).toBe("a".repeat(40));
    expect(await (await request("/dispatch")).json()).toMatchObject({ id: first.instanceId, params: { expectedHead: "a".repeat(40) } });
    expect((await request(route, { instanceId: "invalid" })).status).toBe(400);
    const observed = await request(`${route}/${first.instanceId}`);
    expect(observed.status).toBe(200);
    expect(observed.headers.get("Cache-Control")).toBe("no-store");
    expect(await observed.json()).toMatchObject({ status: "handle-unavailable", receipt: null });
    await request("/outsider");
    expect((await request(route, { instanceId: first.instanceId })).status).toBe(403);
    expect((await request(`${route}/${first.instanceId}`)).status).toBe(403);
  } finally { await mf.dispose(); }
}, 30_000);
