import { describe, expect, test } from "bun:test";
import { activeReviews, retargetBaseBranch, type BaseBranchChange } from "../src/core/base-branch-change";
import { evaluateMergeGate } from "../src/core/merge-gate";

const change: BaseBranchChange = {
  headBranch: "feature",
  baseBranch: "main",
  previousBases: [],
  reviews: [
    { reviewerId: "bob", decision: "approve", commit: "c1", stale: false },
    { reviewerId: "cara", decision: "comment", commit: "c1", stale: false },
  ],
};

describe("retargetBaseBranch", () => {
  test("records the previous base and marks approvals stale", () => {
    const result = retargetBaseBranch(change, "release");
    if (!result.ok) throw new Error(result.error);
    expect(result.change.baseBranch).toBe("release");
    expect(result.change.previousBases).toEqual(["main"]);
    expect(result.staleApprovals).toEqual(["bob"]);
    expect(result.change.reviews.every((review) => review.stale)).toBe(true);
  });

  test("stale approvals no longer satisfy the merge gate", () => {
    const result = retargetBaseBranch(change, "release");
    if (!result.ok) throw new Error(result.error);
    const gate = (c: BaseBranchChange) =>
      evaluateMergeGate({ authorId: "alice", headCommit: "c1", changedPaths: [], requiredApprovals: 1, codeOwners: [], reviews: activeReviews(c) });
    expect(gate(change).mergeable).toBe(true);
    expect(gate(result.change).mergeable).toBe(false);
  });

  test("refuses to target the change's own head", () => {
    expect(retargetBaseBranch(change, "feature")).toEqual({ ok: false, error: "A change cannot target its own head branch" });
  });

  test("refuses an empty base", () => {
    expect(retargetBaseBranch(change, "  ").ok).toBe(false);
  });

  test("retargeting to the same base is a no-op", () => {
    const result = retargetBaseBranch(change, "main");
    expect(result).toEqual({ ok: true, change, staleApprovals: [] });
  });

  test("keeps the full history across repeated retargets", () => {
    const first = retargetBaseBranch(change, "release");
    if (!first.ok) throw new Error(first.error);
    const second = retargetBaseBranch(first.change, "develop");
    if (!second.ok) throw new Error(second.error);
    expect(second.change.previousBases).toEqual(["main", "release"]);
    expect(second.staleApprovals).toEqual([]);
  });
});
