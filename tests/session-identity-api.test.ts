import { afterEach, expect, test } from "bun:test";
import { apiFetch, apiJson, bindApiSession } from "../src/web/api";

const originalFetch = globalThis.fetch;
const cleanups: (() => void)[] = [];
function bind(identity: string, getter: () => Promise<string | null> = async () => `synthetic-${identity}`) { const release = bindApiSession(identity, getter); cleanups.push(release); return release; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(async () => { for (const release of cleanups.splice(0).reverse()) release(); await Promise.resolve(); globalThis.fetch = originalFetch; });

test("session change while obtaining a token never dispatches an old action under another identity", async () => {
  const token = deferred<string | null>(); let calls = 0;
  globalThis.fetch = Object.assign((async () => { calls++; return Response.json({}); }), { preconnect: originalFetch.preconnect });
  bind("A", () => token.promise);
  const pending = apiJson<Record<string, unknown>>("/synthetic-action", { method: "POST" });
  const rejection = pending.then(() => { throw new Error("Expected identity rejection"); }, cause => cause as Error);
  bind("B"); token.resolve("synthetic-A"); expect(await rejection).toMatchObject({ name: "AbortError" });
  expect(calls).toBe(0);
});

test("old private responses are rejected after a signed-in account switch", async () => {
  const network = deferred<Response>(); const called = deferred<void>(); const recorded: { authorization: string | null } = { authorization: null };
  globalThis.fetch = Object.assign((async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => { recorded.authorization = new Headers(init?.headers).get("Authorization"); called.resolve(); return network.promise; }), { preconnect: originalFetch.preconnect });
  bind("A"); const pending = apiJson<Record<string, unknown>>("/synthetic-private-state");
  const rejection = pending.then(() => { throw new Error("Expected identity rejection"); }, cause => cause as Error);
  await called.promise; bind("B"); network.resolve(Response.json({ secret: "synthetic A only" })); expect(await rejection).toMatchObject({ name: "AbortError" });
  expect(recorded.authorization).toBe("Bearer synthetic-A");
});

test("identity changes while reading a response body reject buffered JSON", async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  globalThis.fetch = Object.assign((async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller; } }))), { preconnect: originalFetch.preconnect });
  bind("A"); const response = await apiFetch("/synthetic-stream"); const pending = response.text();
  const rejection = pending.then(() => { throw new Error("Expected identity rejection"); }, cause => cause as Error);
  bind("B"); source.enqueue(new TextEncoder().encode('{"private":"synthetic"}')); expect(await rejection).toMatchObject({ name: "AbortError" });
});

test("sign-out clears credentials immediately and rejects pending private responses", async () => {
  const network = deferred<Response>(); const called = deferred<void>();
  globalThis.fetch = Object.assign((async () => { called.resolve(); return network.promise; }), { preconnect: originalFetch.preconnect });
  const release = bind("A"); const pending = apiJson<Record<string, unknown>>("/synthetic-private");
  const rejection = pending.then(() => { throw new Error("Expected identity rejection"); }, cause => cause as Error);
  await called.promise; release(); network.resolve(Response.json({})); expect(await rejection).toMatchObject({ name: "AbortError" });
  const recorded: { authorization: string | null } = { authorization: "not called" };
  globalThis.fetch = Object.assign((async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => { recorded.authorization = new Headers(init?.headers).get("Authorization"); return Response.json({ public: true }); }), { preconnect: originalFetch.preconnect });
  expect(await apiJson<Record<string, unknown>>("/synthetic-public")).toEqual({ public: true }); expect(recorded.authorization).toBeNull();
});

test("same-principal StrictMode cleanup and rebind preserve pending results", async () => {
  const network = deferred<Response>(); const called = deferred<void>();
  globalThis.fetch = Object.assign((async () => { called.resolve(); return network.promise; }), { preconnect: originalFetch.preconnect });
  const release = bind("A"); const pending = apiJson<Record<string, unknown>>("/synthetic-private"); await called.promise;
  release(); bind("A"); await Promise.resolve(); network.resolve(Response.json({ kept: true }));
  expect(await pending).toEqual({ kept: true });
});

test("old binding cleanup cannot clear a newer identity", async () => {
  const release = bind("A"); bind("B"); release(); await Promise.resolve();
  const recorded: { authorization: string | null } = { authorization: null };
  globalThis.fetch = Object.assign((async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => { recorded.authorization = new Headers(init?.headers).get("Authorization"); return Response.json({}); }), { preconnect: originalFetch.preconnect });
  await apiJson<Record<string, unknown>>("/synthetic-current"); expect(recorded.authorization).toBe("Bearer synthetic-B");
});

test("ordinary token refresh under the same principal does not invalidate a response", async () => {
  const network = deferred<Response>(); const called = deferred<void>();
  globalThis.fetch = Object.assign((async () => { called.resolve(); return network.promise; }), { preconnect: originalFetch.preconnect });
  bind("A", async () => "synthetic-token-one"); const pending = apiJson<Record<string, unknown>>("/synthetic-private"); await called.promise;
  bind("A", async () => "synthetic-token-two"); network.resolve(Response.json({ stable: true }));
  expect(await pending).toEqual({ stable: true });
});

test("an already anonymous public read survives a later sign-in", async () => {
  const network = deferred<Response>(); const called = deferred<void>();
  globalThis.fetch = Object.assign((async () => { called.resolve(); return network.promise; }), { preconnect: originalFetch.preconnect });
  const pending = apiJson<Record<string, unknown>>("/synthetic-public"); await called.promise; bind("A"); network.resolve(Response.json({ public: true }));
  expect(await pending).toEqual({ public: true });
});

test("missing captured-session token fails closed instead of anonymously dispatching a private action", async () => {
  let calls = 0; globalThis.fetch = Object.assign((async () => { calls++; return Response.json({}); }), { preconnect: originalFetch.preconnect });
  bind("A", async () => null);
  await expect(apiJson<Record<string, unknown>>("/synthetic-action", { method: "POST" })).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(0);
});

test("already buffered private responses cannot be consumed or cloned after switching", async () => {
  globalThis.fetch = Object.assign((async () => Response.json({ private: "synthetic A only" })), { preconnect: originalFetch.preconnect });
  bind("A");
  const response = await apiFetch("/synthetic-private"); const clone = response.clone();
  await Promise.resolve(); bind("B");
  await expect(response.blob()).rejects.toMatchObject({ name: "AbortError" });
  await expect(clone.json()).rejects.toMatchObject({ name: "AbortError" });
  expect(() => response.clone()).toThrow("Your signed-in session changed");
});
