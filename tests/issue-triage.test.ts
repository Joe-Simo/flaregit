import {expect, test} from "bun:test";
import {addLabel, assign, closeThroughAcceptedChange, reopen, transfer, type Issue} from "../src/core/issue-triage";

const open: Issue = {number: 1, state: "open", labels: [], assignees: []};

function ok(result: ReturnType<typeof addLabel>): Issue {
  if (!result.ok) throw new Error(result.error);
  return result.issue;
}

test("labels are trimmed, deduplicated and bounded", () => {
  const labeled = ok(addLabel(open, " bug "));
  expect(labeled.labels).toEqual(["bug"]);
  expect(ok(addLabel(labeled, "bug")).labels).toEqual(["bug"]);
  expect(addLabel(open, "  ").ok).toBe(false);
  expect(addLabel(open, "x".repeat(51)).ok).toBe(false);
});

test("only members can be assigned", () => {
  expect(assign(open, "outsider", ["alice"]).ok).toBe(false);
  expect(ok(assign(open, "alice", ["alice"])).assignees).toEqual(["alice"]);
});

test("an accepted change closes an issue once and reopening fabricates no history", () => {
  const closed = ok(closeThroughAcceptedChange(open, "change-1"));
  expect(closed.closedByChange).toBe("change-1");
  expect(ok(closeThroughAcceptedChange(closed, "change-2")).closedByChange).toBe("change-1");
  const reopened = ok(reopen(closed));
  expect(reopened.state).toBe("open");
  expect(reopened.closedByChange).toBeUndefined();
});

test("a transferred issue keeps a tombstone and refuses further changes", () => {
  const moved = ok(transfer(open, "org/other#7"));
  expect(moved.tombstone).toEqual({kind: "transferred", to: "org/other#7"});
  expect(addLabel(moved, "bug").ok).toBe(false);
  expect(closeThroughAcceptedChange(moved, "change-1").ok).toBe(false);
  expect(transfer(open, " ").ok).toBe(false);
});
