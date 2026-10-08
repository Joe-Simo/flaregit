import { describe, expect, test } from "bun:test";
import { lfsOidOf } from "../src/core/git-lfs";
import { InMemoryLfsObjectStore } from "../src/core/lfs-object-store";

const bytesOf = (text: string) => new TextEncoder().encode(text);

async function refOf(bytes: Uint8Array<ArrayBuffer>) {
  return { oid: await lfsOidOf(bytes), size: bytes.byteLength };
}

describe("InMemoryLfsObjectStore", () => {
  test("stores and returns a verified object", async () => {
    const store = new InMemoryLfsObjectStore(1024);
    const bytes = bytesOf("hello lfs");
    const ref = await refOf(bytes);
    expect(await store.put("repo", ref, bytes)).toEqual({ ok: true, stored: true });
    expect(await store.exists("repo", ref.oid)).toBe(true);
    expect(await store.get("repo", ref.oid)).toEqual(bytes);
    expect(await store.exists("other", ref.oid)).toBe(false);
  });

  test("refuses a hash mismatch and stores nothing", async () => {
    const store = new InMemoryLfsObjectStore(1024);
    const bytes = bytesOf("content");
    const wrong = { oid: await lfsOidOf(bytesOf("different")), size: bytes.byteLength };
    const result = await store.put("repo", wrong, bytes);
    expect(result.ok).toBe(false);
    expect(await store.exists("repo", wrong.oid)).toBe(false);
    expect(store.usedBytes("repo")).toBe(0);
  });

  test("refuses a size mismatch", async () => {
    const store = new InMemoryLfsObjectStore(1024);
    const bytes = bytesOf("content");
    const ref = { oid: await lfsOidOf(bytes), size: bytes.byteLength + 1 };
    const result = await store.put("repo", ref, bytes);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(await store.exists("repo", ref.oid)).toBe(false);
  });

  test("enforces the per-repository quota without partial storage", async () => {
    const store = new InMemoryLfsObjectStore(10);
    const first = bytesOf("123456");
    const second = bytesOf("abcdef");
    expect((await store.put("repo", await refOf(first), first)).ok).toBe(true);
    const secondRef = await refOf(second);
    expect(await store.put("repo", secondRef, second)).toMatchObject({ ok: false, status: 413 });
    expect(await store.exists("repo", secondRef.oid)).toBe(false);
    expect(store.usedBytes("repo")).toBe(6);
    expect((await store.put("other", secondRef, second)).ok).toBe(true);
  });

  test("re-uploading an existing object costs no quota", async () => {
    const store = new InMemoryLfsObjectStore(6);
    const bytes = bytesOf("123456");
    const ref = await refOf(bytes);
    await store.put("repo", ref, bytes);
    expect(await store.put("repo", ref, bytes)).toEqual({ ok: true, stored: false });
    expect(store.usedBytes("repo")).toBe(6);
  });

  test("rejects an invalid quota", () => {
    expect(() => new InMemoryLfsObjectStore(-1)).toThrow(RangeError);
  });
});
