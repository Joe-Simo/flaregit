import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
test("saved import operations and compute admission retries are durable and idempotent", async () => {
  if (await workerdChild("tests/import-operation.test.ts")) return;
  const path = `/tmp/flaregit-import-operation-${crypto.randomUUID()}.js`;
  const built = Bun.spawn([process.execPath, "build", "tests/support/import-operation-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:crypto", `--outfile=${path}`], { stdout: "ignore", stderr: "pipe" });
  if (await built.exited !== 0) throw new Error(await new Response(built.stderr).text());
  const script = await Bun.file(path).text();
  await Bun.file(path).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "import-operation-test", modules: true, script, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { TEST: { className: "RepositoryController", useSQLite: true } }, queueProducers: ["INTEGRATION_QUEUE"] }] }));
  const request = async (path: string, body?: unknown) => (await mf.getWorker("import-operation-test")).fetch(`http://test${path}`, body ? { method: "POST", body: JSON.stringify(body) } : undefined);
  try {
    const input = { projectId: "abcdef123456", head: "a".repeat(40), canonicalRepoName: "repo", ownerId: "owner", instanceId: `import-history-${crypto.randomUUID()}` };
    const first = await (await request("/claim", input)).json() as { instanceId: string };
    const retry = await (await request("/claim", { ...input, instanceId: `import-history-${crypto.randomUUID()}` })).json() as typeof first;
    expect(retry.instanceId).toBe(first.instanceId);
    expect(await (await request("/admit?key=operation-one")).json()).toEqual({ allowed: true, used: 1 });
    expect(await (await request("/admit?key=operation-one")).json()).toEqual({ allowed: true, used: 1 });
    expect(await (await request("/admit?key=operation-two")).json()).toEqual({ allowed: false, used: 1 });
  } finally { await mf.dispose(); }
}, 30_000);
