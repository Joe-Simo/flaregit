import { expect, test } from "bun:test";
import { loadAuthConfiguration } from "../src/web/auth-configuration";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function clock() { let fire = () => {}; let cleared = false; return { schedule(callback: () => void, delay: number) { expect(delay).toBe(15_000); fire = callback; return () => { cleared = true; }; }, expire() { if (!cleared) fire(); }, get cleared() { return cleared; } }; }
const key = "pk_test_c3ludGhldGljLmNsZXJrLmFjY291bnRzLmRldiQ=";
test("configuration deadline aborts a stalled request without accepting its late response", async () => {
 const network = deferred<Response>(), timer = clock(); let signal!: AbortSignal;
 const pending = loadAuthConfiguration(new AbortController().signal, { schedule: timer.schedule, request: async (_path, init) => { signal = init.signal as AbortSignal; return network.promise; } });
 const failure = pending.then(() => { throw new Error("Unexpected configuration success"); }, error => error as Error);
 timer.expire(); expect((await failure).message).toContain("taking longer"); expect(signal.aborted).toBe(true); expect(timer.cleared).toBe(true);
 network.resolve(Response.json({ publishableKey: key })); await Promise.resolve();
});
test("the same deadline bounds response-body consumption", async () => {
 const body = deferred<unknown>(), timer = clock(); let signal!: AbortSignal;
 const pending = loadAuthConfiguration(new AbortController().signal, { schedule: timer.schedule, request: async (_path, init) => { signal = init.signal as AbortSignal; const response = Response.json({}); response.json = () => body.promise; return response; } });
 const failure = pending.catch(error => error as Error); await Promise.resolve(); await Promise.resolve(); timer.expire();
 expect(await failure).toBeInstanceOf(Error); expect(signal.aborted).toBe(true); body.resolve({ publishableKey: key }); await Promise.resolve();
});
test("manual retry cancels the previous request and cannot adopt its delayed key", async () => {
 const first = deferred<Response>(), parent = new AbortController(), observed: AbortSignal[] = [];
 const old = loadAuthConfiguration(parent.signal, { request: async (_path, init) => { observed.push(init.signal as AbortSignal); return first.promise; } });
 const rejected = old.catch(error => error as Error); parent.abort();
 const current = loadAuthConfiguration(new AbortController().signal, { request: async (_path, init) => { observed.push(init.signal as AbortSignal); expect(observed[0]?.aborted).toBe(true); return Response.json({ publishableKey: key }); } });
 expect(await current).toBe(key); expect(await rejected).toMatchObject({ name: "AbortError" }); first.resolve(Response.json({ publishableKey: "pk_test_old" })); await Promise.resolve(); expect(observed.every(signal => signal.aborted)).toBe(true);
});
test("cleanup cancellation prevents requests and removes deadline work", async () => {
 const parent = new AbortController(), timer = clock(); parent.abort(); let requests = 0;
 await expect(loadAuthConfiguration(parent.signal, { schedule: timer.schedule, request: async () => { requests++; return Response.json({ publishableKey: key }); } })).rejects.toMatchObject({ name: "AbortError" });
 expect(requests).toBe(0); expect(timer.cleared).toBe(true);
});
test("missing, malformed and failed configuration produce recoverable errors", async () => {
 for (const value of [null, {}, { publishableKey: null }, { publishableKey: "" }]) await expect(loadAuthConfiguration(new AbortController().signal, { request: async () => Response.json(value) })).rejects.toThrow("not configured");
 for (const value of [{ publishableKey: {} }, { publishableKey: 123 }, { publishableKey: "https://other.example" }]) await expect(loadAuthConfiguration(new AbortController().signal, { request: async () => Response.json(value) })).rejects.toThrow("could not be verified");
 await expect(loadAuthConfiguration(new AbortController().signal, { request: async () => new Response("unavailable", { status: 503 }) })).rejects.toThrow("Please retry");
});
test("successful configuration cancels its timer and sends no account credentials", async () => {
 const timer = clock(); expect(await loadAuthConfiguration(new AbortController().signal, { schedule: timer.schedule, request: async (path, init) => { expect(path).toBe("/auth-config"); expect(init.cache).toBe("no-store"); expect(init.credentials).toBe("omit"); return Response.json({ publishableKey: key }); } })).toBe(key);
 expect(timer.cleared).toBe(true); timer.expire();
});


test("transport and malformed JSON failures do not expose raw response or browser error text", async () => {
 await expect(loadAuthConfiguration(new AbortController().signal, { request: async () => { throw new TypeError("Synthetic raw transport detail"); } })).rejects.toThrow("Could not load sign-in. Please retry.");
 await expect(loadAuthConfiguration(new AbortController().signal, { request: async () => new Response("Synthetic invalid response detail") })).rejects.toThrow("Could not load sign-in. Please retry.");
});
