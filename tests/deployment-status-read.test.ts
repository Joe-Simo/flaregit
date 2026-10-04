import { expect, test } from "bun:test";
import { deploymentStatusRead } from "../src/web/deployment-status-read";

test("a stalled status source settles without discarding other successful sources", async () => {
  let signal: AbortSignal | undefined;
  const result = await Promise.allSettled([
    deploymentStatusRead(async () => ["saved-record"]),
    deploymentStatusRead(current => { signal = current; return new Promise<never>(() => undefined); }, 5),
  ]);
  expect(result[0]).toEqual({ status: "fulfilled", value: ["saved-record"] });
  expect(result[1]?.status).toBe("rejected");
  expect(signal?.aborted).toBe(true);
  expect(signal?.reason.name).toBe("TimeoutError");
});

test("a completed read keeps its result and cancels its deadline", async () => {
  let signal: AbortSignal | undefined;
  expect(await deploymentStatusRead(async current => { signal = current; return "current"; }, 5)).toBe("current");
  await Bun.sleep(10);
  expect(signal?.aborted).toBe(false);
});

test("source errors retain their identity", async () => {
  const error = new Error("Service configuration unavailable");
  await expect(deploymentStatusRead(async () => { throw error; })).rejects.toBe(error);
});
