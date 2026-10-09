/** F04 slice: merge queue and explicit revert. Entries merge in order; a failing entry is removed and later entries are re-checked against the new base. */

export interface QueueEntry {
  readonly change: string;
  readonly baseCommit: string;
}

export type QueueStep =
  | {readonly action: "merge"; readonly change: string; readonly newBase: string}
  | {readonly action: "requeue"; readonly change: string; readonly reason: string}
  | {readonly action: "idle"};

/** Decides the next step for the head of the queue. A change built on an older base must be re-checked, never merged silently. */
export function nextStep(queue: readonly QueueEntry[], currentBase: string, checksPass: (change: string) => boolean, produceMerge: (change: string) => string): QueueStep {
  const head = queue[0];
  if (!head) return {action: "idle"};
  if (head.baseCommit !== currentBase) return {action: "requeue", change: head.change, reason: "The base changed since this change was checked"};
  if (!checksPass(head.change)) return {action: "requeue", change: head.change, reason: "Required checks are not passing"};
  return {action: "merge", change: head.change, newBase: produceMerge(head.change)};
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
