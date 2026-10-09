import {expect, test} from "bun:test";
import {applyBulk, MAX_BULK_ISSUES} from "../src/core/issue-bulk";
import type {Issue} from "../src/core/issue-triage";

function issue(number: number, extra: Partial<Issue> = {}): Issue {
  return {number, state: "open", labels: [], assignees: [], ...extra};
}

test("a bulk label applies to every issue", () => {
  const result = applyBulk([issue(1), issue(2)], {kind: "label", label: "bug"});
  if (!result.ok) throw new Error("expected success");
  expect(result.issues.map((entry) => entry.labels)).toEqual([["bug"], ["bug"]]);
});

test("bulk assign and close use the triage rules", () => {
  const assigned = applyBulk([issue(1)], {kind: "assign", assignee: "alice", members: ["alice"]});
  if (!assigned.ok) throw new Error("expected success");
  expect(assigned.issues[0]?.assignees).toEqual(["alice"]);
  const closed = applyBulk([issue(1), issue(2)], {kind: "close", change: "change-9"});
  if (!closed.ok) throw new Error("expected success");
  expect(closed.issues.every((entry) => entry.state === "closed" && entry.closedByChange === "change-9")).toBe(true);
});

test("one failing issue fails the whole batch with per-issue errors", () => {
  const moved = issue(2, {tombstone: {kind: "deleted"}});
  const other = issue(3, {tombstone: {kind: "transferred", to: "org/x#1"}});
  const result = applyBulk([issue(1), moved, other], {kind: "label", label: "bug"});
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.errors.map((entry) => entry.number)).toEqual([2, 3]);
  expect(applyBulk([issue(1)], {kind: "assign", assignee: "bob", members: ["alice"]}).ok).toBe(false);
});

test("batches are capped at 100, non-empty and duplicate free", () => {
  const many = Array.from({length: MAX_BULK_ISSUES + 1}, (_, index) => issue(index + 1));
  expect(applyBulk(many, {kind: "label", label: "bug"}).ok).toBe(false);
  expect(applyBulk(many.slice(0, MAX_BULK_ISSUES), {kind: "label", label: "bug"}).ok).toBe(true);
  expect(applyBulk([], {kind: "label", label: "bug"}).ok).toBe(false);
  expect(applyBulk([issue(1), issue(1)], {kind: "label", label: "bug"}).ok).toBe(false);
});
