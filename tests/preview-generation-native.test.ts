import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
interface Begun { status: string; record: { generation: string } }
interface Snapshot { reservations: { physical_key: string; bytes: number }[]; writers: { physical_key: string; pending: string; closed: number }[] }
test("native SQLite generation CAS and actual R2 late legacy write preserve funded replacement isolation", async () => {
  if (await workerdChild("tests/preview-generation-native.test.ts")) return;
  const file = `/tmp/preview-generation-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, "build", "tests/support/preview-generation-native-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${file}`], { stdout: "ignore", stderr: "pipe" });
  const [error, code] = await Promise.all([new Response(build.stderr).text(), build.exited]); if (code) throw new Error(error);
  const script = await Bun.file(file).text(); await Bun.file(file).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "generation", modules: true, script, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], bindings: { PREVIEW_SIGNING_KEY: "fixture-secret-only", PREVIEW_STORAGE_GLOBAL_BYTES: "1000", PREVIEW_STORAGE_ACCOUNT_BYTES: "1000" }, r2Buckets: ["EVIDENCE_BUCKET"], durableObjects: { REPOSITORY_CONTROLLER: { className: "GenerationNativeFixture", useSQLite: true } } }] }));
  const call = async (path: string) => (await mf.getWorker("generation")).fetch(`http://fixture${path}`);
  const snapshot = async () => await (await call("/snapshot")).json() as Snapshot;
  try {
    expect((await call("/start")).status).toBe(200);
    const old = await snapshot(); expect(old.reservations).toHaveLength(1); expect(old.writers[0]?.pending).toContain("index.html");
    const results = await Promise.all([call(`/begin?key=${crypto.randomUUID()}`), call(`/begin?key=${crypto.randomUUID()}`)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = results.find(r => r.status === 200)!; const begun = await winner.json() as Begun; const g = begun.record.generation;
    expect(await (await call(`/claim?g=${g}`)).json()).toBe(true);
    expect((await call(`/publish?g=${g}`)).status).toBe(200);
    const held = await snapshot(); expect(held.reservations).toHaveLength(2); expect(held.reservations).toContainEqual(old.reservations[0]!);
    expect(held.writers.find(w => w.physical_key === old.reservations[0]!.physical_key)?.pending).toContain("index.html");
    const links = await (await call(`/links?g=${g}`)).json() as { generation: string; legacy: string };
    const asset = (url: string) => call(`/asset?url=${encodeURIComponent(url)}`);
    expect(await (await asset(links.generation)).text()).toBe("new preview");
    expect((await call("/late-old-put")).status).toBe(200);
    expect(await (await asset(links.generation)).text()).toBe("new preview");
    expect((await asset(links.legacy)).status).toBe(404);
    expect((await asset(links.generation.replace(g, crypto.randomUUID()))).status).toBe(403);
    expect((await snapshot()).reservations).toEqual(held.reservations);
    expect((await call("/delete-scope")).status).toBe(200); expect((await asset(links.generation)).status).toBe(404);
    // Provider refusal is synthetic; validation, retries, persisted SQLite state and alarm scheduling are production DO code.
    expect((await call(`/credential-start?g=${crypto.randomUUID()}`)).status).toBe(409);
    expect((await call(`/credential-start?g=${g}&repo=flaregit-p000000000000`)).status).toBe(409);
    expect((await call(`/credential-start?g=${g}`)).status).toBe(200);
    const summary = await (await call(`/credential-summary?g=${g}`)).text();
    expect(JSON.parse(summary).status).toBe("pending"); expect(summary).not.toContain("synthetic-fixture-secret");
    for (let attempt=1; attempt<=5; attempt++) {
      const result = await (await call("/credential-alarm")).json() as { alarm: number|null; attempts: { attempts: number; status: string; erased: number }[]; providerCalls: number };
      expect(result.providerCalls).toBe(Math.min(attempt,4)); expect(result.attempts[0]?.attempts).toBe(Math.min(attempt,4));
      expect(result.attempts[0]?.status).toBe("pending"); expect(result.attempts[0]?.erased).toBe(0); expect(result.alarm).not.toBeNull();
      expect(JSON.stringify(result)).not.toContain("synthetic-fixture-secret");
    }
    expect((await call("/credential-expire")).status).toBe(200);
    const expired = await (await call("/credential-alarm")).json() as { attempts: { attempts: number; status: string; erased: number }[]; providerCalls: number };
    expect(expired.providerCalls).toBe(4); expect(expired.attempts[0]).toEqual({ attempts: 4, status: "expired_unverified", erased: 1 });
    const expiredSummary = await (await call(`/credential-summary?g=${g}`)).text();
    expect(JSON.parse(expiredSummary).status).toBe("expired_unverified"); expect(expiredSummary).not.toContain("synthetic-fixture-secret");

  } finally { await mf.dispose(); }
}, 30000);
