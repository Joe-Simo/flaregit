import { z } from "zod";
import { headDecision, STALE_BASE_REASON } from "../core/merge-queue.js";
import { canMergeInStack } from "../core/change-stacks.js";
import { detectContradiction } from "../core/decision/contradiction.js";
import type { FlareGitProjectState, Task } from "../core/types.js";

/**
 * Merge queue: ready changes land one at a time, in the order they were queued. The head is landed only
 * when it was last checked against the current accepted commit; otherwise it is refused with a reason,
 * updated onto the latest version (post-land rebase) and re-queued in its original place.
 */

export const queueStatusSchema = z.enum(["queued", "landing", "landed", "waiting_rebase", "needs_decision", "awaiting_revision", "refused", "removed"]);
export type QueueStatus = z.infer<typeof queueStatusSchema>;
const SHA = z.string().regex(/^[a-f0-9]{40}$/);
const TASK_ID = z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/);
export const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

export const mergeQueueEntrySchema = z
  .object({
    taskId: TASK_ID,
    position: z.number().int().positive(),
    status: queueStatusSchema,
    /** Accepted commit this change was built on when last checked. */
    checkedBase: SHA.nullable(),
    checkedCommit: SHA.nullable(),
    reason: z.string().max(500).nullable(),
    eventId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).nullable(),
    attempts: z.number().int().nonnegative(),
    actorId: z.string().min(1).max(200),
    requestId: z.string().regex(REQUEST_ID),
    enqueuedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type MergeQueueEntry = z.infer<typeof mergeQueueEntrySchema>;

export const enqueueRequestSchema = z.object({ requestId: z.string().regex(REQUEST_ID), taskIds: z.array(TASK_ID).min(1).max(8) }).strict().refine((value) => new Set(value.taskIds).size === value.taskIds.length, "Each change can be queued once per request");
export type EnqueueRequest = z.infer<typeof enqueueRequestSchema>;

export class MergeQueueError extends Error {
  constructor(message: string) { super(message); this.name = "MergeQueueError"; }
}

export class MergeQueueLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS merge_queue_entries(task_id TEXT PRIMARY KEY,position INTEGER NOT NULL,doc TEXT NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS merge_queue_requests(request_id TEXT PRIMARY KEY,payload TEXT NOT NULL,actor_id TEXT NOT NULL,result TEXT NOT NULL)");
  }
  entries(): MergeQueueEntry[] {
    return this.storage.sql.exec<{ doc: string }>("SELECT doc FROM merge_queue_entries ORDER BY position").toArray().map((row) => mergeQueueEntrySchema.parse(JSON.parse(row.doc)));
  }
  save(entry: MergeQueueEntry): void {
    const parsed = mergeQueueEntrySchema.parse(entry);
    this.storage.sql.exec("INSERT INTO merge_queue_entries VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET position=excluded.position,doc=excluded.doc", parsed.taskId, parsed.position, JSON.stringify(parsed));
  }
  request(requestId: string): { payload: string; actorId: string; result: MergeQueueEntry[] } | null {
    const row = this.storage.sql.exec<{ payload: string; actor_id: string; result: string }>("SELECT payload,actor_id,result FROM merge_queue_requests WHERE request_id=?", requestId).toArray()[0];
    return row ? { payload: row.payload, actorId: row.actor_id, result: z.array(mergeQueueEntrySchema).parse(JSON.parse(row.result)) } : null;
  }
  saveRequest(requestId: string, payload: string, actorId: string, result: MergeQueueEntry[]): void {
    this.storage.sql.exec("INSERT INTO merge_queue_requests VALUES(?,?,?,?)", requestId, payload, actorId, JSON.stringify(result));
  }
  nextPosition(): number {
    return (this.storage.sql.exec<{ position: number | null }>("SELECT MAX(position) AS position FROM merge_queue_entries").toArray()[0]?.position ?? 0) + 1;
  }
}

const ACTIVE: readonly QueueStatus[] = ["queued", "landing", "waiting_rebase", "needs_decision", "awaiting_revision"];
const isActive = (entry: MergeQueueEntry) => ACTIVE.includes(entry.status);

function unbound(task: Task): boolean {
  return task.acceptedTarget === undefined && task.targetGeneration === undefined;
}

/** Queue requests are replayable by request id; the same id with different changes is refused. */
export function enqueueChanges(ledger: MergeQueueLedger, state: FlareGitProjectState, request: EnqueueRequest, actorId: string, now = new Date()): { entries: MergeQueueEntry[]; replayed: boolean } {
  const payload = JSON.stringify(request.taskIds);
  const saved = ledger.request(request.requestId);
  if (saved) {
    if (saved.payload !== payload || saved.actorId !== actorId) throw new MergeQueueError("This request id was already used for different changes");
    return { entries: saved.result, replayed: true };
  }
  if (state.acceptedState.currentCommit === null) throw new MergeQueueError("The first accepted version is created by an explicit review, not the queue");
  const existing = new Map(ledger.entries().map((entry) => [entry.taskId, entry]));
  const queued = new Set([...existing.values()].filter(isActive).map((entry) => entry.taskId));
  const result: MergeQueueEntry[] = [];
  let position = ledger.nextPosition();
  for (const taskId of request.taskIds) {
    const task = state.tasks[taskId];
    if (!task) throw new MergeQueueError(`Change ${taskId} does not exist`);
    if (!unbound(task)) throw new MergeQueueError(`Change ${taskId} targets a specific branch generation; land it from that branch`);
    if (task.status === "accepted" || task.status === "cancelled") throw new MergeQueueError(`Change ${taskId} is already ${task.status}`);
    if (!task.currentCommit) throw new MergeQueueError(`Change ${taskId} has no saved commit yet`);
    if (task.dependsOn) {
      const parent = state.tasks[task.dependsOn];
      if (!parent) throw new MergeQueueError(`Change ${taskId} builds on a missing change`);
      if (parent.status !== "accepted" && !queued.has(parent.id)) throw new MergeQueueError(`Queue ${parent.id} before ${taskId}; it builds on that change`);
    }
    const current = existing.get(taskId);
    if (current && isActive(current)) { result.push(current); queued.add(taskId); continue; }
    const stamp = now.toISOString();
    const entry: MergeQueueEntry = { taskId, position: current?.position ?? position++, status: "queued", checkedBase: task.baseCommit, checkedCommit: task.currentCommit, reason: null, eventId: null, attempts: current?.attempts ?? 0, actorId, requestId: request.requestId, enqueuedAt: stamp, updatedAt: stamp };
    ledger.save(entry);
    queued.add(taskId);
    result.push(entry);
  }
  ledger.saveRequest(request.requestId, payload, actorId, result);
  return { entries: result, replayed: false };
}

export function removeFromQueue(ledger: MergeQueueLedger, taskId: string, actorId: string, isOwner: boolean, now = new Date()): MergeQueueEntry {
  const entry = ledger.entries().find((value) => value.taskId === taskId);
  if (!entry) throw new MergeQueueError("This change is not in the queue");
  if (!isOwner && entry.actorId !== actorId) throw new MergeQueueError("Only the person who queued this change or the repository owner can remove it");
  if (entry.status === "landing" && !isOwner) throw new MergeQueueError("This change is landing now; wait for the result");
  if (entry.status === "removed" || entry.status === "landed") return entry;
  const removed = { ...entry, status: "removed" as const, reason: "Removed from the queue", updatedAt: now.toISOString() };
  ledger.save(removed);
  return removed;
}

export type QueueAction =
  | { kind: "land"; taskIds: string[]; eventId: string; actorId: string }
  | { kind: "rebase"; taskId: string; landedCommit: string; actorId: string }
  | { kind: "idle"; reason: string };

export interface QueuePlanContext {
  /** Post-land update recorded for this change onto `landedCommit`, so a waiting entry shows why. */
  rebaseUpdate(taskId: string, landedCommit: string): { reason: string; settled: boolean } | null;
  landingEventId(): string;
}

/** Brings every entry up to date with its change, then decides the one next action for the queue. */
export function planMergeQueue(ledger: MergeQueueLedger, state: FlareGitProjectState, context: QueuePlanContext, now = new Date()): { action: QueueAction; entries: MergeQueueEntry[] } {
  const stamp = now.toISOString(), currentBase = state.acceptedState.currentCommit;
  const update = (entry: MergeQueueEntry, patch: Partial<MergeQueueEntry>): MergeQueueEntry => {
    const next = { ...entry, ...patch, updatedAt: stamp };
    if (JSON.stringify({ ...next, updatedAt: entry.updatedAt }) === JSON.stringify(entry)) return entry;
    ledger.save(next);
    return next;
  };
  ledger.entries().forEach((entry) => {
    if (!isActive(entry) || entry.status === "landing") return;
    const task = state.tasks[entry.taskId];
    if (!task || task.status === "cancelled") return update(entry, { status: "removed", reason: "The change was withdrawn" });
    if (task.status === "accepted") return update(entry, { status: "landed", reason: null });
    if (task.status === "needs_decision") return update(entry, { status: "needs_decision", reason: "Waiting for a maintainer to choose between conflicting requirements" });
    if (task.status === "working" || task.status === "checkpointed") return update(entry, { status: "awaiting_revision", reason: "Waiting for the change to be updated and marked ready" });
    if (task.status === "blocked") return update(entry, { status: "refused", reason: task.blockedReason ?? "The change is blocked" });
    if (task.status !== "ready") return;
    if (task.baseCommit !== currentBase) return update(entry, { status: "waiting_rebase", checkedBase: task.baseCommit, checkedCommit: task.currentCommit, reason: (currentBase ? context.rebaseUpdate(task.id, currentBase)?.reason : null) ?? (entry.status === "waiting_rebase" && entry.reason ? entry.reason : STALE_BASE_REASON) });
    if (entry.status === "queued" && entry.checkedBase === task.baseCommit && entry.checkedCommit === task.currentCommit) return;
    update(entry, { status: "queued", checkedBase: task.baseCommit, checkedCommit: task.currentCommit, reason: entry.status === "waiting_rebase" ? "Updated onto the latest version and re-queued" : null });
  });
  for (const entry of ledger.entries()) {
    if (entry.status !== "refused") continue;
    const task = state.tasks[entry.taskId];
    // A refused change returns only with new work; the same commit is not retried in a loop.
    if (task?.status === "ready" && task.currentCommit !== entry.checkedCommit) update(entry, { status: "queued", checkedBase: task.baseCommit, checkedCommit: task.currentCommit, reason: "New work was saved; re-queued" });
  }
  const current = ledger.entries();
  const landing = current.filter((entry) => entry.status === "landing" && entry.eventId);
  // One landing at a time. Re-issuing its dispatch is safe: the workflow and queue receipt are keyed by the event id.
  if (landing.length) return { action: { kind: "land", taskIds: landing.filter((entry) => entry.eventId === landing[0]!.eventId).sort((a, b) => a.position - b.position).map((entry) => entry.taskId), eventId: landing[0]!.eventId!, actorId: landing[0]!.actorId }, entries: current };
  if (!currentBase) return { action: { kind: "idle", reason: "No accepted version exists yet" }, entries: current };
  const stack = Object.values(state.tasks).map((task) => ({ id: task.id, ...(task.dependsOn ? { parent: task.dependsOn } : {}), merged: task.status === "accepted" }));
  const approved = (value: Task) => value.requirements.filter((requirement) => requirement.status === "approved");
  for (const head of current.filter((entry) => entry.status === "queued" || entry.status === "waiting_rebase")) {
    if (!canMergeInStack(stack, head.taskId).ok) continue;
    const task = state.tasks[head.taskId];
    if (!task) continue;
    const decision = headDecision([{ change: head.taskId, baseCommit: task.baseCommit ?? "" }], currentBase, () => task.status === "ready");
    if (decision.action === "idle") break;
    if (decision.action === "requeue" && decision.reason === STALE_BASE_REASON) {
      const update_ = context.rebaseUpdate(head.taskId, currentBase);
      update(head, { status: "waiting_rebase", reason: update_?.reason ?? (head.status === "waiting_rebase" ? head.reason : null) ?? decision.reason });
      // An update that already ran for this base and could not bring the change current is skipped with
      // its reason; one that has not finished keeps its place at the head so changes still land in order.
      if (update_?.settled) continue;
      return { action: { kind: "rebase", taskId: head.taskId, landedCommit: currentBase, actorId: head.actorId }, entries: ledger.entries() };
    }
    if (decision.action === "requeue") { update(head, { status: "refused", reason: decision.reason }); continue; }
    // Two queued changes whose requirements contradict are landed together once, so the platform records
    // (and proves) the product decision instead of silently landing whichever came first.
    const rival = current.find((entry) => entry.taskId !== head.taskId && entry.status === "queued" && state.tasks[entry.taskId]?.status === "ready" && approved(task).some((left) => approved(state.tasks[entry.taskId]!).some((right) => detectContradiction(left, right))));
    const taskIds = rival ? [head.taskId, rival.taskId] : [head.taskId];
    const eventId = context.landingEventId();
    for (const id of taskIds) {
      const entry = ledger.entries().find((value) => value.taskId === id)!;
      update(entry, { status: "landing", eventId, attempts: entry.attempts + 1, reason: rival ? "Landing together to settle conflicting requirements" : "Landing on the latest version" });
    }
    return { action: { kind: "land", taskIds, eventId, actorId: head.actorId }, entries: ledger.entries() };
  }
  return { action: { kind: "idle", reason: "Nothing in the queue can land right now" }, entries: ledger.entries() };
}

export type LandingOutcome = "accepted" | "stale" | "needs_decision" | "blocked" | "rejected" | "failed" | "not_started" | "awaiting_review";

/** Records how a queued landing ended; a stale landing goes back to wait for its update. */
export function settleLanding(ledger: MergeQueueLedger, state: FlareGitProjectState, eventId: string, outcome: LandingOutcome, reason: string | undefined, now = new Date()): MergeQueueEntry[] {
  const settled: MergeQueueEntry[] = [];
  for (const entry of ledger.entries()) {
    if (entry.eventId !== eventId || entry.status !== "landing") continue;
    const task = state.tasks[entry.taskId];
    const status: QueueStatus = outcome === "accepted" ? (task?.status === "accepted" ? "landed" : "queued")
      : outcome === "stale" ? "waiting_rebase"
      : outcome === "needs_decision" || task?.status === "needs_decision" ? "needs_decision"
      : outcome === "awaiting_review" ? "landing"
      : "refused";
    if (status === "landing") continue;
    const text = status === "landed" ? null
      : status === "waiting_rebase" ? (reason ? `Refused: ${reason}. Updating onto the latest version.` : `Refused: ${STALE_BASE_REASON}. Updating onto the latest version.`)
      : status === "needs_decision" ? "Waiting for a maintainer to choose between conflicting requirements"
      : status === "queued" ? "Newer work arrived while landing; re-queued"
      : (reason ?? "Landing did not complete").slice(0, 500);
    const next = { ...entry, status, reason: text, updatedAt: now.toISOString() };
    ledger.save(next);
    settled.push(next);
  }
  return settled;
}
