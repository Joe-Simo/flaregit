import {expect, test} from "bun:test";
import {addLink, duplicatesOf, removeLink, subIssues, type IssueLink} from "../src/core/issue-relations";

function linked(result: ReturnType<typeof addLink>): readonly IssueLink[] {
  if (!result.ok) throw new Error(result.error);
  return result.links;
}

test("self-links are rejected", () => {
  expect(addLink([], {kind: "duplicate-of", from: 1, to: 1}).ok).toBe(false);
  expect(addLink([], {kind: "sub-issue-of", from: 2, to: 2}).ok).toBe(false);
});

test("duplicate links are recorded once and an issue has one canonical target", () => {
  const links = linked(addLink([], {kind: "duplicate-of", from: 2, to: 1}));
  expect(linked(addLink(links, {kind: "duplicate-of", from: 2, to: 1}))).toEqual(links);
  expect(addLink(links, {kind: "duplicate-of", from: 2, to: 3}).ok).toBe(false);
  expect(duplicatesOf(links, 1)).toEqual([2]);
});

test("sub-issue cycles are rejected at any depth", () => {
  let links = linked(addLink([], {kind: "sub-issue-of", from: 2, to: 1}));
  links = linked(addLink(links, {kind: "sub-issue-of", from: 3, to: 2}));
  expect(addLink(links, {kind: "sub-issue-of", from: 1, to: 3}).ok).toBe(false);
  expect(addLink(links, {kind: "sub-issue-of", from: 1, to: 2}).ok).toBe(false);
  expect(addLink(links, {kind: "sub-issue-of", from: 3, to: 1}).ok).toBe(false);
  expect(subIssues(links, 1)).toEqual([2]);
});

test("duplicate chains cannot loop but kinds are independent", () => {
  const links = linked(addLink([], {kind: "duplicate-of", from: 2, to: 1}));
  expect(addLink(links, {kind: "duplicate-of", from: 1, to: 2}).ok).toBe(false);
  expect(addLink(links, {kind: "sub-issue-of", from: 1, to: 2}).ok).toBe(true);
});

test("removing a link frees the issue to be linked elsewhere", () => {
  const links = linked(addLink([], {kind: "sub-issue-of", from: 2, to: 1}));
  const cleared = removeLink(links, {kind: "sub-issue-of", from: 2, to: 1});
  expect(cleared).toEqual([]);
  expect(addLink(cleared, {kind: "sub-issue-of", from: 2, to: 3}).ok).toBe(true);
});
