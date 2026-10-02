import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import type { ImportJob } from "../src/server/import-job";

test("actual account DO atomically reserves imports, freezes owner/source/policy and never reverts ready", async () => {
  if (await workerdChild("tests/import-jobs-ledger.test.ts")) return;
  const bundle = `/tmp/flaregit-import-jobs-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, "build", "tests/support/import-jobs-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${bundle}`], { stdout: "ignore", stderr: "pipe" });
  const [buildError, exit] = await Promise.all([new Response(build.stderr).text(), build.exited]);
  if (exit !== 0) throw new Error(buildError);
  const script = await Bun.file(bundle).text();
  await import("node:fs/promises").then((fs) => fs.rm(bundle, { force: true }));
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "import-jobs-test", modules: true, script, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { TEST: { className: "ImportFixture", useSQLite: true } } }] }));
  const request = async (path: string, body?: unknown) => (await mf.getWorker("import-jobs-test")).fetch(`http://test${path}`, body ? { method: "POST", body: JSON.stringify(body) } : undefined);
  const job: ImportJob = { id: "pabcdef123456", ownerId: "subject", name: "Import fixture", canonicalRepoName: "fixture", source: "https://git.example.com/team/repo", branch: "main", verificationPolicy: { kind: "command", test: "bun test", allowedScope: ["*"], protectedPaths: [] }, status: "requested", historyIntent: "provider-default-no-depth-requested", createdAt: "2026-10-02", updatedAt: "2026-10-02", detail: "Fixture" };
  try {
    expect((await request("/save", job)).status).toBe(200);
    for (const altered of [{ ...job, ownerId: "different" }, { ...job, source: "https://git.example.com/other" }, { ...job, verificationPolicy: { ...job.verificationPolicy, test: "skip tests" } }]) expect((await request("/save", altered)).status).toBe(409);
    const concurrent = await Promise.all(Array.from({ length: 10 }, (_, index) => request("/save", { ...job, id: `p0000000000${String(index).padStart(2, "0")}`, canonicalRepoName: `fixture-${index}` })));
    expect(concurrent.filter((response) => response.status === 200).length).toBe(9);
    expect(concurrent.filter((response) => response.status === 409).length).toBe(1);
    expect((await request("/save", { ...job, status: "ready" })).status).toBe(200);
    await request("/save", { ...job, status: "pending" });
    const saved = await (await request("/list")).json() as ImportJob[];
    expect(saved.find((value) => value.id === job.id)?.status).toBe("ready");
    expect(saved.length).toBe(10);
  } finally { await mf.dispose(); }
}, 30_000);
