import {expect, test} from "bun:test";
import {InMemoryWikiStore, normalizeSlug, type WikiResult} from "../src/core/wiki";

function steppingClock(): () => Date {
  let minute = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, minute++));
}

function newStore(): InMemoryWikiStore {
  return new InMemoryWikiStore({clock: steppingClock()});
}

/** "ok" for a success, otherwise the failure code. */
function codeOf<T>(result: WikiResult<T>): string {
  return result.ok ? "ok" : result.code;
}

function valueOf<T>(result: WikiResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** Saves `count` revisions in order, each based on the previous head. */
async function appendRevisions(store: InMemoryWikiStore, slug: string, count: number): Promise<void> {
  for (let n = 1; n <= count; n++) {
    valueOf(await store.save(slug, {author: "ana", body: `revision ${n}`, expectedRevision: n === 1 ? null : n - 1}));
  }
}

test("slugs are lowercased and must be 1-80 characters of lowercase letters, digits and hyphens", () => {
  expect(normalizeSlug("Getting-Started-2")).toEqual({ok: true, value: "getting-started-2"});
  expect(normalizeSlug("a".repeat(80))).toEqual({ok: true, value: "a".repeat(80)});
  expect(codeOf(normalizeSlug(""))).toBe("invalid-slug");
  expect(codeOf(normalizeSlug("a".repeat(81)))).toBe("invalid-slug");
  expect(codeOf(normalizeSlug(undefined as unknown as string))).toBe("invalid-slug");
});

test("path traversal and other unsafe slugs are refused and nothing is stored", async () => {
  const store = newStore();
  for (const slug of ["../secrets", "a/b", "..", ".", "a\\b", "home page", "home_page", "%2e%2e", "a.b", "a\u0000b", "café"]) {
    expect(codeOf(normalizeSlug(slug))).toBe("invalid-slug");
    expect(codeOf(await store.save(slug, {author: "ana", body: "x", expectedRevision: null}))).toBe("invalid-slug");
  }
  expect(codeOf(await store.history("../secrets"))).toBe("invalid-slug");
  expect(codeOf(await store.history("home"))).toBe("not-found");
});

test("pages are keyed by their normalized slug", async () => {
  const store = newStore();
  const created = valueOf(await store.save("Home", {author: "ana", body: "welcome", expectedRevision: null}));
  expect(created.slug).toBe("home");
  expect(valueOf(await store.read("HOME")).body).toBe("welcome");
  // The same page exists under the lowercase key, so creating it again is a conflict.
  expect(codeOf(await store.save("home", {author: "ana", body: "again", expectedRevision: null}))).toBe("conflict");
});

test("a save based on a stale or wrong revision is refused and stores nothing", async () => {
  const store = newStore();
  const first = valueOf(await store.save("notes", {author: "ana", body: "one", expectedRevision: null}));
  valueOf(await store.save("notes", {author: "ana", body: "two", expectedRevision: first.id}));

  // Head is now revision 2, so a save based on revision 1 must fail.
  expect(codeOf(await store.save("notes", {author: "ben", body: "stale", expectedRevision: 1}))).toBe("conflict");
  // Creating over an existing page is a conflict too.
  expect(codeOf(await store.save("notes", {author: "ben", body: "fresh", expectedRevision: null}))).toBe("conflict");
  // A page that does not exist cannot be based on a revision.
  expect(codeOf(await store.save("missing", {author: "ben", body: "x", expectedRevision: 3}))).toBe("conflict");
  expect(codeOf(await store.save("notes", {author: "ben", body: "x", expectedRevision: 0}))).toBe("invalid-revision");

  const history = valueOf(await store.history("notes"));
  expect(history.revisions.map((revision) => revision.body)).toEqual(["two", "one"]);
  expect(codeOf(await store.read("missing"))).toBe("not-found");
});

test("each save appends an immutable revision stamped by the injected clock", async () => {
  const store = newStore();
  const first = valueOf(await store.save("spec", {author: " ana ", body: "v1", expectedRevision: null}));
  const second = valueOf(await store.save("spec", {author: "ben", body: "v2", expectedRevision: 1}));
  const third = valueOf(await store.save("spec", {author: "ana", body: "v3", expectedRevision: 2}));

  expect([first.id, second.id, third.id]).toEqual([1, 2, 3]);
  expect([first.parentRevision, second.parentRevision, third.parentRevision]).toEqual([null, 1, 2]);
  expect(first.author).toBe("ana");
  expect(first.timestamp).toBe("2026-01-01T00:00:00.000Z");
  expect(third.timestamp).toBe("2026-01-01T00:02:00.000Z");
  expect(Object.isFrozen(first)).toBe(true);
  // Later saves leave earlier revisions untouched.
  expect(valueOf(await store.read("spec", 1)).body).toBe("v1");
  expect(valueOf(await store.read("spec")).id).toBe(3);
});

test("history pages newest first and reads the next page from nextBefore", async () => {
  const store = newStore();
  await appendRevisions(store, "log", 5);

  const page1 = valueOf(await store.history("log", {limit: 2}));
  expect(page1.revisions.map((revision) => revision.id)).toEqual([5, 4]);
  expect(page1.nextBefore).toBe(4);

  const page2 = valueOf(await store.history("log", {limit: 2, before: page1.nextBefore!}));
  expect(page2.revisions.map((revision) => revision.id)).toEqual([3, 2]);
  expect(page2.nextBefore).toBe(2);

  const page3 = valueOf(await store.history("log", {limit: 2, before: page2.nextBefore!}));
  expect(page3.revisions.map((revision) => revision.id)).toEqual([1]);
  expect(page3.nextBefore).toBeNull();
});

test("history defaults to 50 revisions per page and refuses limits outside 1-200", async () => {
  const store = newStore();
  await appendRevisions(store, "big", 120);

  const defaultPage = valueOf(await store.history("big"));
  expect(defaultPage.revisions).toHaveLength(50);
  expect(defaultPage.revisions[0]!.id).toBe(120);
  expect(defaultPage.revisions.at(-1)!.id).toBe(71);
  expect(defaultPage.nextBefore).toBe(71);

  const everything = valueOf(await store.history("big", {limit: 200}));
  expect(everything.revisions).toHaveLength(120);
  expect(everything.nextBefore).toBeNull();

  for (const limit of [0, 201, 1.5, Number.NaN]) {
    expect(codeOf(await store.history("big", {limit}))).toBe("invalid-limit");
  }
  expect(codeOf(await store.history("big", {before: 0}))).toBe("invalid-cursor");
});

test("diff reports removed, added and unchanged lines for a known example", async () => {
  const store = newStore();
  valueOf(await store.save("poem", {author: "ana", body: "alpha\nbeta\ngamma\ndelta", expectedRevision: null}));
  valueOf(await store.save("poem", {author: "ana", body: "alpha\ngamma\nepsilon\ndelta", expectedRevision: 1}));

  const diff = valueOf(await store.diff("poem", 1, 2));
  expect(diff).toEqual({
    added: ["epsilon"],
    removed: ["beta"],
    unchanged: ["alpha", "gamma", "delta"],
  });
  expect(valueOf(await store.diff("poem", 2, 2)).unchanged).toEqual(["alpha", "gamma", "epsilon", "delta"]);
  expect(codeOf(await store.diff("poem", 1, 9))).toBe("not-found");
  expect(codeOf(await store.diff("poem", 0, 1))).toBe("invalid-revision");
});

test("emptying a page removes its lines and adds none", async () => {
  const store = newStore();
  valueOf(await store.save("draft", {author: "ana", body: "one\ntwo", expectedRevision: null}));
  valueOf(await store.save("draft", {author: "ana", body: "", expectedRevision: 1}));
  expect(valueOf(await store.diff("draft", 1, 2))).toEqual({added: [], removed: ["one", "two"], unchanged: []});
});

test("diffs refuse more than 2000 lines on either side", async () => {
  const store = newStore();
  const lines = (count: number): string => Array.from({length: count}, (_, index) => `line ${index}`).join("\n");
  valueOf(await store.save("long", {author: "ana", body: lines(2000), expectedRevision: null}));
  valueOf(await store.save("long", {author: "ana", body: lines(2001), expectedRevision: 1}));

  expect(valueOf(await store.diff("long", 1, 1)).unchanged).toHaveLength(2000);
  expect(codeOf(await store.diff("long", 1, 2))).toBe("diff-too-large");
  expect(codeOf(await store.diff("long", 2, 1))).toBe("diff-too-large");
});

test("revert appends a new revision that copies an old body and keeps all history", async () => {
  const store = newStore();
  await appendRevisions(store, "guide", 3);

  const reverted = valueOf(await store.revert("guide", 1, "carol"));
  expect(reverted.id).toBe(4);
  expect(reverted.body).toBe("revision 1");
  expect(reverted.author).toBe("carol");
  expect(reverted.parentRevision).toBe(3);

  expect(valueOf(await store.history("guide", {limit: 200})).revisions).toHaveLength(4);
  expect(valueOf(await store.read("guide", 2)).body).toBe("revision 2");
  expect(valueOf(await store.read("guide", 3)).body).toBe("revision 3");
  expect(codeOf(await store.revert("guide", 99, "carol"))).toBe("not-found");
  expect(codeOf(await store.revert("guide", 1, "  "))).toBe("invalid-author");
  expect(valueOf(await store.history("guide", {limit: 200})).revisions).toHaveLength(4);
});

test("bodies are capped at 100000 characters and authors are required", async () => {
  const store = newStore();
  valueOf(await store.save("limits", {author: "ana", body: "a".repeat(100_000), expectedRevision: null}));
  expect(codeOf(await store.save("limits", {author: "ana", body: "a".repeat(100_001), expectedRevision: 1}))).toBe("invalid-body");
  // Characters are counted as code points, so 100000 emoji are within the limit.
  expect(codeOf(await store.save("emoji", {author: "ana", body: "\u{1F600}".repeat(100_000), expectedRevision: null}))).toBe("ok");
  expect(codeOf(await store.save("limits", {author: "", body: "x", expectedRevision: 1}))).toBe("invalid-author");
  expect(valueOf(await store.history("limits")).revisions).toHaveLength(1);
});
