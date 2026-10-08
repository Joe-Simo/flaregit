import {expect, test} from "bun:test";
import {buildManifest, type ExportObject} from "../src/core/export-bundle";
import {createMemoryStore, exportRoundTripCheck, importBundle, type BundleStore, type MemoryStore} from "../src/core/import-bundle";

const objects: ExportObject[] = [
  {kind: "issue", id: "1", body: "first issue", private: false},
  {kind: "comment", id: "c1", body: "a comment", private: false},
  {kind: "label", id: "bug", body: "bug", private: false},
  {kind: "milestone", id: "m1", body: "v1", private: false},
];

/** Wraps a store so tests can count every write the import attempts. */
function spyStore(store: MemoryStore): {target: BundleStore; writes: string[]} {
  const writes: string[] = [];
  const target: BundleStore = {
    has: (kind, id) => store.has(kind, id),
    get: (kind, id) => store.get(kind, id),
    put: (kind, id, body) => {
      writes.push(`${kind}:${id}`);
      store.put(kind, id, body);
    },
  };
  return {target, writes};
}

test("imports every verified object into an empty store", async () => {
  const store = createMemoryStore();
  const result = await importBundle(await buildManifest(objects, true), objects, store);
  expect(result).toEqual({ok: true, imported: 4, skipped: 0, conflicts: []});
  for (const object of objects) expect(store.get(object.kind, object.id)).toBe(object.body);
});

test("a tampered or missing object aborts the whole import with zero writes", async () => {
  const manifest = await buildManifest(objects, true);
  const store = createMemoryStore();
  store.put("issue", "1", "first issue");
  const before = store.entries();
  const spy = spyStore(store);

  const tampered = objects.map((object) => (object.id === "m1" ? {...object, body: "v1 edited"} : object));
  expect(await importBundle(manifest, tampered, spy.target)).toMatchObject({ok: false, error: expect.stringContaining("m1")});
  expect(await importBundle(manifest, objects.slice(0, 3), spy.target)).toMatchObject({ok: false, error: expect.stringContaining("m1")});

  expect(spy.writes).toEqual([]);
  expect(store.entries()).toEqual(before);
});

test("an object that the manifest does not list is rejected", async () => {
  const manifest = await buildManifest(objects.slice(0, 3), true);
  const spy = spyStore(createMemoryStore());
  expect(await importBundle(manifest, objects, spy.target)).toMatchObject({ok: false, error: expect.stringContaining("milestone:m1")});
  expect(spy.writes).toEqual([]);
});

test("a manifest listing the same kind and id twice is rejected", async () => {
  const manifest = await buildManifest(objects, true);
  const spy = spyStore(createMemoryStore());
  expect(await importBundle([...manifest, manifest[0]!], objects, spy.target)).toMatchObject({
    ok: false,
    error: expect.stringContaining("issue:1"),
  });
  expect(spy.writes).toEqual([]);
});

test("an unknown kind is rejected in both the manifest and the objects", async () => {
  const alien = {kind: "release", id: "9", body: "x", private: false} as unknown as ExportObject;
  const alienEntry = (await buildManifest([alien], true))[0]!;
  const clean = await buildManifest(objects, true);
  const spy = spyStore(createMemoryStore());

  expect(await importBundle([...clean, alienEntry], objects, spy.target)).toMatchObject({
    ok: false,
    error: expect.stringContaining("release"),
  });
  expect(await importBundle(clean, [...objects, alien], spy.target)).toMatchObject({
    ok: false,
    error: expect.stringContaining("release"),
  });
  expect(spy.writes).toEqual([]);
});

test("re-importing identical content skips every object", async () => {
  const manifest = await buildManifest(objects, true);
  const store = createMemoryStore();
  expect(await importBundle(manifest, objects, store)).toEqual({ok: true, imported: 4, skipped: 0, conflicts: []});
  expect(await importBundle(manifest, objects, store)).toEqual({ok: true, imported: 0, skipped: 4, conflicts: []});

  const partial = createMemoryStore();
  partial.put("label", "bug", "bug");
  expect(await importBundle(manifest, objects, partial)).toEqual({ok: true, imported: 3, skipped: 1, conflicts: []});
});

test("an existing object with a different body aborts with every conflicting id and zero writes", async () => {
  const store = createMemoryStore();
  store.put("issue", "1", "local edit");
  store.put("label", "bug", "bug");
  store.put("milestone", "m1", "v2");
  const before = store.entries();
  const spy = spyStore(store);

  expect(await importBundle(await buildManifest(objects, true), objects, spy.target)).toEqual({
    ok: false,
    error: expect.any(String),
    conflicts: ["issue:1", "milestone:m1"],
    written: [],
  });
  expect(spy.writes).toEqual([]);
  expect(store.entries()).toEqual(before);
});

test("export then import into a fresh store round-trips, and a rejected import reports false", async () => {
  const withPrivate: ExportObject[] = [...objects, {kind: "issue", id: "2", body: "secret", private: true}];
  expect(await exportRoundTripCheck(withPrivate, true)).toBe(true);
  expect(await exportRoundTripCheck(withPrivate, false)).toBe(true);
  expect(await exportRoundTripCheck([...objects, objects[0]!], true)).toBe(false);
});

test("a store failure mid-import reports the objects already written", async () => {
  const store = createMemoryStore();
  const failing: BundleStore = {
    has: (kind, id) => store.has(kind, id),
    get: (kind, id) => store.get(kind, id),
    put: (kind, id, body) => {
      if (id === "2") throw new Error("disk full");
      store.put(kind, id, body);
    },
  };
  const objects: ExportObject[] = [
    {kind: "issue", id: "1", body: "a", private: false},
    {kind: "issue", id: "2", body: "b", private: false},
  ];
  const result = await importBundle(await buildManifest(objects, true), objects, failing);
  expect(result).toEqual({ok: false, error: "Store write failed after 1 objects: disk full", conflicts: [], written: ["issue:1"]});
});
