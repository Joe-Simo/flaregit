/** F04 slice: merge queue and explicit revert. Entries merge in order; a failing entry is removed and later entries are re-checked against the new base. */

export interface QueueEntry {
  readonly change: string;
  readonly baseCommit: string;
}

export type QueueStep =
  | {readonly action: "merge"; readonly change: string; readonly newBase: string}
  | {readonly action: "requeue"; readonly change: string; readonly reason: string}
  | {readonly action: "idle"};

export type QueueDecision =
  | {readonly action: "merge"; readonly change: string}
  | {readonly action: "requeue"; readonly change: string; readonly reason: string}
  | {readonly action: "idle"};

export const STALE_BASE_REASON = "The base changed since this change was checked";
export const CHECKS_NOT_PASSING_REASON = "Required checks are not passing";

/** Decides what the head of the queue may do. A change built on an older base must be re-checked, never merged silently. */
export function headDecision(queue: readonly QueueEntry[], currentBase: string, checksPass: (change: string) => boolean): QueueDecision {
  const head = queue[0];
  if (!head) return {action: "idle"};
  if (head.baseCommit !== currentBase) return {action: "requeue", change: head.change, reason: STALE_BASE_REASON};
  if (!checksPass(head.change)) return {action: "requeue", change: head.change, reason: CHECKS_NOT_PASSING_REASON};
  return {action: "merge", change: head.change};
}

/** Decides the next step for the head of the queue and, when it may merge, produces the merge. */
export function nextStep(queue: readonly QueueEntry[], currentBase: string, checksPass: (change: string) => boolean, produceMerge: (change: string) => string): QueueStep {
  const decision = headDecision(queue, currentBase, checksPass);
  return decision.action === "merge" ? {action: "merge", change: decision.change, newBase: produceMerge(decision.change)} : decision;
}

export interface RevertIntent {
  readonly revertsChange: string;
  readonly requestedBy: string;
  readonly reason: string;
}

/** A revert is a new change that names what it reverts and why; it never rewrites accepted history. */
export function planRevert(acceptedChanges: readonly string[], intent: RevertIntent): {readonly ok: true; readonly title: string} | {readonly ok: false; readonly error: string} {
  if (!acceptedChanges.includes(intent.revertsChange)) return {ok: false, error: "Only accepted changes can be reverted"};
  if (!intent.reason.trim()) return {ok: false, error: "A revert needs a reason"};
  return {ok: true, title: `Revert ${intent.revertsChange}: ${intent.reason.trim()}`};
}
