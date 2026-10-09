/** F04 slice: platform merge gate for pull requests (approvals, self-approval, stale approvals, CODEOWNERS). */

export interface Review {
  readonly reviewerId: string;
  readonly decision: "approve" | "request_changes" | "comment";
  /** The head commit the review was made on. An approval for an older head is stale. */
  readonly commit: string;
}

export interface CodeOwnerRule {
  /** Path prefix, e.g. "src/payments/". Matching is by prefix. */
  readonly pathPrefix: string;
  readonly owners: readonly string[];
}

export interface MergeGateInput {
  readonly authorId: string;
  readonly headCommit: string;
  readonly changedPaths: readonly string[];
  readonly requiredApprovals: number;
  readonly codeOwners: readonly CodeOwnerRule[];
  readonly reviews: readonly Review[];
}

export interface MergeGateResult {
  readonly mergeable: boolean;
  /** Every reason the gate is not satisfied; empty when mergeable. */
  readonly blockers: string[];
  readonly approvedBy: string[];
}

/** Platform policy decides gate satisfaction. Only the latest review per reviewer counts, and only if it is an approval on the current head. */
export function evaluateMergeGate(input: MergeGateInput): MergeGateResult {
  const latest = new Map<string, Review>();
  for (const review of input.reviews) {
    if (review.commit !== input.headCommit) continue;
    latest.set(review.reviewerId, review);
  }
  const approvedBy = [...latest.values()]
    .filter((review) => review.decision === "approve" && review.reviewerId !== input.authorId)
    .map((review) => review.reviewerId)
    .sort();
  const blockers: string[] = [];
  const blocking = [...latest.values()].filter((review) => review.decision === "request_changes").map((review) => review.reviewerId);
  if (blocking.length > 0) blockers.push(`Changes were requested by ${blocking.sort().join(", ")}`);
  if (approvedBy.length < input.requiredApprovals) blockers.push(`${input.requiredApprovals} approval(s) required on the current head; ${approvedBy.length} present`);
  for (const path of [...new Set(input.changedPaths)].sort()) {
    const rules = input.codeOwners.filter((rule) => path.startsWith(rule.pathPrefix));
    if (rules.length === 0) continue;
    const owners = rules[rules.length - 1]!.owners;
    if (!owners.some((owner) => approvedBy.includes(owner) && owner !== input.authorId)) {
      blockers.push(`A code owner approval is required for ${path}`);
    }
  }
  return {mergeable: blockers.length === 0, blockers, approvedBy};
}
