/** F04 slice: review requests. An author cannot request their own review, requests are deduplicated, and only readers can be asked. */

export function requestReview(
  pending: readonly string[],
  authorId: string,
  reviewerId: string,
  canRead: (userId: string) => boolean,
): {readonly ok: true; readonly pending: string[]} | {readonly ok: false; readonly error: string} {
  if (reviewerId === authorId) return {ok: false, error: "Authors cannot request their own review"};
  if (!canRead(reviewerId)) return {ok: false, error: "That user cannot read this repository"};
  if (pending.includes(reviewerId)) return {ok: true, pending: [...pending]};
  return {ok: true, pending: [...pending, reviewerId]};
}
