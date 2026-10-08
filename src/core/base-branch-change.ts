/** F04 slice: retargeting a change to a new base branch. Approvals given against the old base become stale. */

import type { Review } from "./merge-gate";

export interface TrackedReview extends Review {
  /** Set when the base branch changed after the review; stale reviews must not count toward the merge gate. */
  readonly stale: boolean;
}

export interface BaseBranchChange {
  readonly headBranch: string;
  readonly baseBranch: string;
  /** Bases this change targeted before, oldest first. */
  readonly previousBases: readonly string[];
  readonly reviews: readonly TrackedReview[];
}

export type RetargetResult =
  | { readonly ok: true; readonly change: BaseBranchChange; readonly staleApprovals: string[] }
  | { readonly ok: false; readonly error: string };

/** Retargets a change. Refuses an empty base or the change's own head; a no-op retarget keeps reviews fresh. */
export function retargetBaseBranch(change: BaseBranchChange, newBase: string): RetargetResult {
  if (newBase.trim() === "") return { ok: false, error: "The new base branch must not be empty" };
  if (newBase === change.headBranch) return { ok: false, error: "A change cannot target its own head branch" };
  if (newBase === change.baseBranch) return { ok: true, change, staleApprovals: [] };
  const staleApprovals = change.reviews
    .filter((review) => review.decision === "approve" && !review.stale)
    .map((review) => review.reviewerId)
    .sort();
  return {
    ok: true,
    change: {
      ...change,
      baseBranch: newBase,
      previousBases: [...change.previousBases, change.baseBranch],
      reviews: change.reviews.map((review) => (review.stale ? review : { ...review, stale: true })),
    },
    staleApprovals,
  };
}

/** Reviews that still count for the merge gate: those not made stale by a base change. */
export function activeReviews(change: BaseBranchChange): Review[] {
  return change.reviews.filter((review) => !review.stale).map(({ reviewerId, decision, commit }) => ({ reviewerId, decision, commit }));
}
