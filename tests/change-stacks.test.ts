import {expect, test} from "bun:test";
import {applySuggestion, canMergeInStack, maintainerMayPush} from "../src/core/change-stacks";

const stack = [
  {id: "a", merged: true},
  {id: "b", parent: "a", merged: false},
  {id: "c", parent: "b", merged: false},
];

test("a stacked change merges only after its ancestors", () => {
  expect(canMergeInStack(stack, "b")).toEqual({ok: true});
  expect(canMergeInStack(stack, "c")).toEqual({ok: false, error: "Merge b first"});
  expect(canMergeInStack(stack, "z").ok).toBe(false);
  expect(canMergeInStack([{id: "x", parent: "y", merged: false}, {id: "y", parent: "x", merged: true}], "x").ok).toBe(true);
});

test("a missing parent and a cycle are refused", () => {
  expect(canMergeInStack([{id: "x", parent: "gone", merged: false}], "x").ok).toBe(false);
  expect(canMergeInStack([{id: "x", parent: "y", merged: true}, {id: "y", parent: "x", merged: true}], "x").ok).toBe(false);
});

test("suggestions replace exactly one existing line", () => {
  const edit = {path: "a.ts", line: 2, replacement: "B", authorId: "u"};
  expect(applySuggestion("a\nb\nc", edit)).toEqual({ok: true, content: "a\nB\nc"});
  expect(applySuggestion("a\nb", {...edit, line: 3}).ok).toBe(false);
  expect(applySuggestion("a", {...edit, line: 0}).ok).toBe(false);
});

test("maintainer pushes to forks need the owner's opt-in", () => {
  expect(maintainerMayPush(true, true)).toBe(true);
  expect(maintainerMayPush(false, true)).toBe(false);
  expect(maintainerMayPush(true, false)).toBe(false);
});
