import {expect, test} from "bun:test";
import {createMilestone, deleteMilestone, isOverdue, milestoneProgress, type Milestone, type MilestoneIssue} from "../src/core/issue-milestones";

function made(result: ReturnType<typeof createMilestone>): Milestone {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const v1 = made(createMilestone([], " v1 ", "2026-03-01"));
const v2 = made(createMilestone([v1], "v2"));
const issues: MilestoneIssue[] = [
  {number: 1, state: "open", milestone: v1.id},
  {number: 2, state: "closed", milestone: v1.id},
  {number: 3, state: "closed", milestone: v1.id},
  {number: 4, state: "open"},
];

test("milestones validate title, uniqueness and due date", () => {
  expect(v1).toEqual({id: 1, title: "v1", dueDate: "2026-03-01"});
  expect(v2.id).toBe(2);
  expect(createMilestone([v1], "v1").ok).toBe(false);
  expect(createMilestone([], " ").ok).toBe(false);
  expect(createMilestone([], "x", "2026-02-30").ok).toBe(false);
  expect(createMilestone([], "x", "tomorrow").ok).toBe(false);
});

test("progress counts open and closed issues and overdue needs open work", () => {
  expect(milestoneProgress(v1.id, issues)).toEqual({open: 1, closed: 2});
  expect(isOverdue(v1, issues, "2026-04-01")).toBe(true);
  expect(isOverdue(v1, issues, "2026-02-01")).toBe(false);
  expect(isOverdue(v2, issues, "2030-01-01")).toBe(false);
});

test("a milestone with open issues is only deleted with an explicit reassignment", () => {
  expect(deleteMilestone([v1, v2], issues, v1.id).ok).toBe(false);
  expect(deleteMilestone([v1, v2], issues, v1.id, v1.id).ok).toBe(false);
  expect(deleteMilestone([v1, v2], issues, v1.id, 99).ok).toBe(false);
  expect(deleteMilestone([v1, v2], issues, 99).ok).toBe(false);
  const moved = deleteMilestone([v1, v2], issues, v1.id, v2.id);
  if (!moved.ok) throw new Error(moved.error);
  expect(moved.value.milestones).toEqual([v2]);
  expect(milestoneProgress(v2.id, moved.value.issues)).toEqual({open: 1, closed: 2});
});

test("a milestone with only closed issues deletes and clears the reference", () => {
  const closedOnly: MilestoneIssue[] = [{number: 2, state: "closed", milestone: v1.id}];
  const deleted = deleteMilestone([v1, v2], closedOnly, v1.id);
  if (!deleted.ok) throw new Error(deleted.error);
  expect(deleted.value.issues[0]?.milestone).toBeUndefined();
});
