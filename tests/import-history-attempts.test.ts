import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import type { ImportHistoryAttempt } from "../src/server/import-history-attempts";
test("inspection attempts retain unknown dispatch and require terminal plus exact native stop before fresh identity", async () => {
  if (await workerdChild("tests/import-history-attempts.test.ts")) return;
  const built = await Bun.build({ entrypoints: ["tests/support/import-history-attempts-worker.ts"], target: "browser", external: ["cloudflare:workers"] });
  if (!built.success) throw new Error(String(built.logs));
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "attempts", modules: true, script: await built.outputs[0]!.text(), compatibilityDate: "2026-10-02", durableObjects: { TEST: { className: "AttemptsTest", useSQLite: true } } }] }));
  const call = async (method: string, generation: number, extra = {}) => (await mf.getWorker("attempts")).fetch("http://fixture", { method: "POST", body: JSON.stringify({ method, generation, ...extra }) });
  try {
    const first = await (await call("start", 0)).json() as ImportHistoryAttempt;
    expect(await (await call("start", 0)).json()).toEqual(first);
    expect(Date.parse(first.deliveryUntil) - Date.parse(first.createdAt)).toBe(86400_000);
    expect(await (await call("start", 0, { now: Date.parse(first.deliveryUntil) + 1 })).json()).toEqual(first);
    await call("dispatchUnknown", 1);
    expect((await call("start", 1)).status).toBe(409);
    expect((await call("start", 1, { now: Date.parse(first.deliveryUntil) + 1 })).status).toBe(409);
    await call("nativeAllocationIntent", 1);
    await call("observed", 1, { status: "terminated" });
    expect((await call("start", 1)).status).toBe(409);
    expect((await call("nativeStopped", 1, { nativeRunId: "native-wrong" })).status).toBe(409);
    await call("nativeStopped", 1, { nativeRunId: first.nativeRunId });
    const second = await (await call("start", 1)).json() as ImportHistoryAttempt;
    expect(second.generation).toBe(2);
    expect(second.workflowId).not.toBe(first.workflowId);
    expect(second.nativeRunId).not.toBe(first.nativeRunId);
    expect((await call("nativeAllocationIntent", 1)).status).toBe(409);
    expect(await (await call("start", 1)).json()).toEqual(second);
    expect((await call("start", 2, { now: -1 })).status).toBe(409);
  } finally { await mf.dispose(); }
}, 30000);
