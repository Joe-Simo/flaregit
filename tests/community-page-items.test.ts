import { expect, test } from "bun:test";
import { appendCommunityItems } from "../src/web/community-page-items";

test("overlapping discovery pages do not duplicate people or replace already displayed publication", () => {
  const first = { handle: "alice", name: "Published Alice" };
  const next = { handle: "bob", name: "Published Bob" };
  expect(appendCommunityItems([first], [{ handle: "alice", name: "Later Alice" }, next, next], item => item.handle)).toEqual([first, next]);
  expect(appendCommunityItems([], [first, first, next], item => item.handle)).toEqual([first, next]);
});

test("distinct accepted revisions stay separate while duplicates retain original discovery order", () => {
  const entries = [{ repo: "one", commit: "a" }, { repo: "one", commit: "b" }, { repo: "two", commit: "a" }];
  let calls = 0;
  expect(appendCommunityItems(entries, entries, item => { calls++; return `${item.repo}:${item.commit}`; })).toEqual(entries);
  expect(calls).toBe(6);
});
