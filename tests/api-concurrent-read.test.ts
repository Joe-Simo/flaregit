import { expect, test } from "bun:test";
import { apiJson, bindApiSession, clearVerifiedApiSession } from "../src/web/api";
test("concurrent session reads share transport but cancellation and parsed values remain independent", async () => {
  const original = globalThis.fetch;
  const release = bindApiSession("synthetic-dedup-session", async () => "synthetic-token");
  let finish!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = Object.assign(async () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); }, { preconnect: original.preconnect });
  try {
    const controller = new AbortController();
    const a = apiJson("/p/test/connections", { signal: controller.signal }).catch(error => error as Error);
    const b = apiJson<{ rows: number[] }>("/p/test/connections");
    const c = apiJson<{ rows: number[] }>("/p/test/connections");
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    expect(await a).toMatchObject({ name: "AbortError" });
    finish(Response.json({ rows: [1] }));
    const [left, right] = await Promise.all([b, c]);
    left.rows.push(2);
    expect(right.rows).toEqual([1]);
    expect(calls).toBe(1);
  } finally { release(); clearVerifiedApiSession(); globalThis.fetch = original; await Promise.resolve(); }
});

test("mutation invalidates preexisting reads and postmutation reads use fresh transport", async () => {
  const original = globalThis.fetch;
  const release = bindApiSession("synthetic-mutation-session", async () => "synthetic-token");
  let finish!: (response: Response) => void;
  let gets = 0;
  globalThis.fetch = Object.assign(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ saved: true });
    gets++; return gets === 1 ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json({ version: 2 });
  }, { preconnect: original.preconnect });
  try {
    const stale = apiJson("/p/test/connections").catch(error => error as Error);
    await Promise.resolve(); await Promise.resolve();
    await apiJson("/p/test/connections", { method: "POST", json: { change: true } });
    expect(await apiJson<{version:number}>("/p/test/connections")).toEqual({ version: 2 });
    finish(Response.json({ version: 1 }));
    expect(await stale).toMatchObject({ name: "AbortError" });
    expect(gets).toBe(2);
  } finally { release(); clearVerifiedApiSession(); globalThis.fetch = original; await Promise.resolve(); }
});
