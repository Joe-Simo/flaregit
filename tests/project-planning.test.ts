import {expect, test} from "bun:test";
import {addItem, progress, updateItem, type Project} from "../src/core/project-planning";

const empty: Project = {statuses: ["todo", "done"], fieldTypes: {points: "number", owner: "text"}, items: []};

function must(result: ReturnType<typeof addItem>): Project {
  if (!result.ok) throw new Error(result.error);
  return result.project;
}

test("only accessible issues are referenced, once", () => {
  expect(addItem(empty, 3, [1]).ok).toBe(false);
  const added = must(addItem(empty, 3, [3]));
  expect(added.items[0]?.status).toBe("todo");
  expect(addItem(added, 3, [3]).ok).toBe(false);
});

test("stale edits are detected and fields are typed", () => {
  const added = must(addItem(empty, 3, [3]));
  const updated = must(updateItem(added, 3, 1, {status: "done", fields: {points: 5}}));
  expect(updated.items[0]?.version).toBe(2);
  expect(updateItem(updated, 3, 1, {status: "todo"}).ok).toBe(false);
  expect(updateItem(updated, 3, 2, {fields: {points: "five"}}).ok).toBe(false);
  expect(updateItem(updated, 3, 2, {fields: {nope: 1}}).ok).toBe(false);
  expect(updateItem(updated, 3, 2, {status: "bogus"}).ok).toBe(false);
});

test("progress counts stored items", () => {
  const two = must(addItem(must(addItem(empty, 1, [1, 2])), 2, [1, 2]));
  const moved = must(updateItem(two, 2, 1, {status: "done"}));
  expect(progress(moved)).toEqual({todo: 1, done: 1});
});
