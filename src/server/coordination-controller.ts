import type { ContradictionProof } from "../core/decision/contradiction-proof.js";
import type { FlareGitProjectState } from "../core/types.js";
import type { DecidedRequirements } from "../core/decision/requirement-gate.js";
import { enqueueChanges, enqueueRequestSchema, MergeQueueLedger, planMergeQueue, removeFromQueue, settleLanding, type LandingOutcome, type MergeQueueEntry, type QueueAction } from "./merge-queue-runner.js";
import { claimDueRevisions, claimManualRevision, markRebaseRevision, nextRevisionRetryAt, PostLandRebaseLedger, planPostLandRebase, rebaseExecutionSchema, rebaseUpdate, recordPostLandRebase, type PostLandRebaseItem, type ManualRetry, type PostLandRebaseRecord, type RebaseExecution, type RevisionClaim, type RevisionOutcome } from "./post-land-rebase.js";
import { decisionAffectedTaskIds, decisionProofSources, planLosingRevisions, recordDecisionProof, RequirementDecisionLedger, revisionWorkflowId, settleRevisions, type ProofSources, type RequirementDecisionView, type RequirementRevision } from "./requirement-decisions.js";

/** Repository Durable Object ports used by coordination; the controller never reaches into other state. */
export interface CoordinationPorts {
  storage: DurableObjectStorage;
  load(): FlareGitProjectState;
  save(): void;
  /** Drop the cached state after a failed transaction so the next read comes from storage. */
  reset(): void;
  activity(type: string, summary: string): Promise<void>;
  comment(subject: string, body: string): Promise<void>;
}

export interface CoordinationView {
  queue: Array<MergeQueueEntry & { goal: string; contributor: string }>;
  decisions: RequirementDecisionView[];
  updates: UpdateView[];
}

/** What members see of an update: the frozen agent context and the funding identity stay on the server. */
export type UpdateView = Omit<PostLandRebaseRecord, "revisionContext" | "revisionRetry"> & { retry: { refusal: string; refusedReason: string; attempts: number; nextAttemptAt: string | null } | null };
function updateView(record: PostLandRebaseRecord): UpdateView {
  const { revisionContext: _context, revisionRetry, ...rest } = record;
  void _context;
  return { ...rest, retry: revisionRetry ? { refusal: revisionRetry.refusal, refusedReason: revisionRetry.refusedReason, attempts: revisionRetry.attempts, nextAttemptAt: revisionRetry.nextAttemptAt } : null };
}

export class CoordinationController {
  constructor(private readonly ports: CoordinationPorts) {}
  private get decisions() { return new RequirementDecisionLedger(this.ports.storage); }
  private get queue() { return new MergeQueueLedger(this.ports.storage); }
  private get rebases() { return new PostLandRebaseLedger(this.ports.storage); }
  private transaction<T>(work: () => T): T {
    try { return this.ports.storage.transactionSync(work); } catch (error) { this.ports.reset(); throw error; }
  }

  decisionSources(decisionId: string): ProofSources {
    return decisionProofSources(this.decisions, this.ports.load(), decisionId);
  }

  async recordProof(raw: unknown): Promise<ContradictionProof> {
    const before = this.decisions.proof((raw as { decisionId?: string } | null)?.decisionId ?? "");
    const proof = this.transaction(() => recordDecisionProof(this.decisions, this.ports.load(), raw));
    if (!before) await this.ports.activity("decision.proven", `Ran both changes for decision ${proof.decisionId}: ${proof.summary}`);
    return proof;
  }

  async prepareRevisions(decisionId: string): Promise<RequirementRevision[]> {
    const state = this.ports.load(), decision = state.decisions[decisionId];
    if (!decision || decision.status !== "resolved") throw new Error("This decision has not been resolved");
    const ids: Record<string, string> = {};
    for (const taskId of decisionAffectedTaskIds(state, decisionId)) ids[taskId] = await revisionWorkflowId(state.projectId, decisionId, taskId);
    return this.transaction(() => {
      const planned = planLosingRevisions(this.decisions, this.ports.load(), decisionId, ids);
      this.ports.save();
      return planned;
    });
  }

  /** Requirements chosen in resolved decisions; they hold for every later candidate in the repository. */
  decidedRequirements(): DecidedRequirements {
    return this.decisions.decided();
  }

  markRevision(decisionId: string, taskId: string, outcome: { dispatched: true } | { dispatched: false; reason: string }): RequirementRevision {
    return this.transaction(() => {
      const saved = this.decisions.revision(decisionId, taskId);
      if (!saved) throw new Error("Unknown revision");
      if (saved.status !== "planned" && saved.status !== "failed") return saved;
      const next: RequirementRevision = outcome.dispatched ? { ...saved, status: "dispatched", reason: undefined, updatedAt: new Date().toISOString() } : { ...saved, status: "failed", reason: outcome.reason.slice(0, 500), updatedAt: new Date().toISOString() };
      this.decisions.saveRevision(next);
      return next;
    });
  }

  async enqueue(raw: unknown, actorId: string): Promise<{ entries: MergeQueueEntry[]; replayed: boolean }> {
    const request = enqueueRequestSchema.parse(raw);
    const result = this.transaction(() => enqueueChanges(this.queue, this.ports.load(), request, actorId));
    if (!result.replayed) await this.ports.activity("queue.added", `Queued ${request.taskIds.join(", ")} to land in order`);
    return result;
  }

  remove(taskId: string, actorId: string, isOwner: boolean): MergeQueueEntry {
    return this.transaction(() => removeFromQueue(this.queue, taskId, actorId, isOwner));
  }

  /** Brings the queue up to date and returns the one action the caller must dispatch. */
  advance(): QueueAction {
    return this.transaction(() => {
      const state = this.ports.load();
      settleRevisions(this.decisions, state);
      return planMergeQueue(this.queue, state, { rebaseUpdate: (taskId, landed) => rebaseUpdate(this.rebases, taskId, landed), landingEventId: () => `mq-${crypto.randomUUID()}` }).action;
    });
  }

  async settle(eventId: string, outcome: LandingOutcome, reason?: string): Promise<MergeQueueEntry[]> {
    const settled = this.transaction(() => settleLanding(this.queue, this.ports.load(), eventId, outcome, reason));
    for (const entry of settled) if (entry.status === "waiting_rebase" || entry.status === "refused") await this.ports.activity("queue.refused", `${entry.taskId}: ${entry.reason ?? "refused"}`);
    return settled;
  }

  planRebase(landedCommit: string, workflowId: string): PostLandRebaseItem[] {
    return this.transaction(() => planPostLandRebase(this.rebases, this.ports.load(), landedCommit, workflowId));
  }

  async recordRebase(input: { taskId: string; landedCommit: string; fromCommit: string; execution: RebaseExecution }): Promise<{ record: PostLandRebaseRecord; revise: boolean }> {
    const execution = rebaseExecutionSchema.parse(input.execution);
    const result = this.transaction(() => {
      const recorded = recordPostLandRebase(this.rebases, this.ports.load(), { ...input, execution });
      this.ports.save();
      return recorded;
    });
    if (result.revision) await this.ports.comment(`change:${input.taskId}`, result.revision.comment);
    await this.ports.activity("change.updated", `${input.taskId}: ${result.record.reason}`);
    return { record: result.record, revise: result.revision !== null };
  }

  async markRebaseRevision(taskId: string, landedCommit: string, revisionWorkflowId: string, outcome: RevisionOutcome): Promise<PostLandRebaseRecord> {
    const before = this.rebases.get(taskId, landedCommit)?.status;
    const record = this.transaction(() => markRebaseRevision(this.rebases, taskId, landedCommit, revisionWorkflowId, outcome));
    if (before === "agent_waiting" && record.status !== "agent_waiting") await this.ports.activity("change.revising", `${taskId}: the agent is running again on the latest version`);
    else if (record.status === "agent_waiting" && before !== "agent_waiting") await this.ports.activity("change.revision_waiting", `${taskId}: ${record.reason}`);
    return record;
  }

  /** Refused re-runs due to be sent again; each is claimed so concurrent callers never send it twice. */
  claimDueRevisions(): RevisionClaim[] {
    return this.transaction(() => claimDueRevisions(this.rebases, this.ports.load()));
  }

  claimManualRevision(taskId: string, actorId: string, rerunWorkflowId?: string): ManualRetry {
    return this.transaction(() => claimManualRevision(this.rebases, this.ports.load(), taskId, actorId, new Date(), rerunWorkflowId));
  }

  nextRevisionRetryAt(): number | null {
    return nextRevisionRetryAt(this.rebases);
  }

  view(): CoordinationView {
    const state = this.ports.load();
    const queue = this.queue.entries().filter((entry) => entry.status !== "removed").slice(-100).map((entry) => ({ ...entry, goal: state.tasks[entry.taskId]?.goal ?? entry.taskId, contributor: state.tasks[entry.taskId]?.contributor.name ?? "" }));
    const decisionIds = Object.values(state.decisions).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map((decision) => decision.id);
    return { queue, decisions: this.decisions.views(decisionIds), updates: this.rebases.latest(100).map(updateView) };
  }
}
