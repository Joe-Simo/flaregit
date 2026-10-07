import { afterEach, expect, test } from "bun:test";
import { generationRecoveryDraft,readGenerationRecovery,saveGenerationRecovery, requestGenerationRecovery } from "../src/web/preview-generation-recovery";

test('replacement UUID survives reload, stays actor scoped and refuses unsaved requests',()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 const draft=generationRecoveryDraft(null,'project:commit','commit',null);saveGenerationRecovery(storage,'owner',draft);
 const restored=readGenerationRecovery(storage,'owner',draft.scope);expect(restored).toEqual(draft);
 expect(generationRecoveryDraft(restored,draft.scope,draft.commit,null).idempotencyKey).toBe(draft.idempotencyKey);
 expect(readGenerationRecovery(storage,'other',draft.scope)).toBeNull();
 expect(()=>saveGenerationRecovery(storage,'owner',{...draft,idempotencyKey:crypto.randomUUID()})).toThrow('original');
 expect(()=>saveGenerationRecovery({getItem:()=>null,setItem:()=>{}},'owner',draft)).toThrow('could not be saved');
 const next=generationRecoveryDraft(restored,draft.scope,draft.commit,'new-generation');expect(saveGenerationRecovery(storage,'owner',next)).toEqual(next);
});

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("unconfirmed retries keep the request identity for the same commit and generation", async () => {
  const draft = generationRecoveryDraft(null, "project:commit", "commit", null);
  globalThis.fetch = Object.assign(async () => { throw new Error("lost response"); }, { preconnect: originalFetch.preconnect });
  await expect(requestGenerationRecovery("project", draft)).rejects.toThrow("lost response");
  expect(generationRecoveryDraft(draft, draft.scope, draft.commit, null)).toBe(draft);
  expect(generationRecoveryDraft(draft, draft.scope, draft.commit, "new-generation").idempotencyKey).not.toBe(draft.idempotencyKey);
  expect(generationRecoveryDraft(draft, "project:other", "other", null).idempotencyKey).not.toBe(draft.idempotencyKey);
});

test("recovery binds exact commit, generation, and identity and requires accepted generation confirmation", async () => {
  const draft = generationRecoveryDraft(null, "project:commit", "commit", "old-generation");
  let status = 202;
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    expect(url).toBe("/api/p/project/preview/recover-generation");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ commit: draft.commit, expectedGeneration: draft.expectedGeneration, idempotencyKey: draft.idempotencyKey });
    return Response.json({ generationId: "replacement", status: "requested" }, { status });
  }, { preconnect: originalFetch.preconnect });
  expect(await requestGenerationRecovery("project", draft)).toEqual({ status: "requested" });
  status = 403;
  expect(await requestGenerationRecovery("project", draft)).toMatchObject({ status: "forbidden" });
  status = 409;
  expect(await requestGenerationRecovery("project", draft)).toMatchObject({ status: "conflict" });
  status = 200;
  await expect(requestGenerationRecovery("project", draft)).rejects.toThrow("not confirmed");
});

 test("saved terminal generations never imply a new build request and funding conflicts keep their reason", async () => {
  const draft = generationRecoveryDraft(null, "project:commit", "commit", null);
  for (const status of ["ready", "failed", "quarantined", "building"] as const) {
    globalThis.fetch = Object.assign(async () => Response.json({ generationId: "replacement", status }, { status: 202 }), { preconnect: originalFetch.preconnect });
    expect(await requestGenerationRecovery("project", draft)).toEqual({ status });
  }
  globalThis.fetch = Object.assign(async () => new Response("Storage allowance is unavailable; old holds preserved", { status: 409 }), { preconnect: originalFetch.preconnect });
  expect(await requestGenerationRecovery("project", draft)).toEqual({ status: "conflict", detail: "Storage allowance is unavailable; old holds preserved" });
  globalThis.fetch = Object.assign(async () => Response.json({ generationId: "replacement" }, { status: 202 }), { preconnect: originalFetch.preconnect });
  await expect(requestGenerationRecovery("project", draft)).rejects.toThrow("not confirmed");
});
