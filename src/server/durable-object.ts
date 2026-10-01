import { DurableObject } from "cloudflare:workers";
import { freezeCandidateGeneration } from "../core/pipeline/freeze.js";
import { createProductDecision, detectContradiction } from "../core/decision/contradiction.js";
import type { Env } from "./env.js";
import type {
  CandidateGeneration,
  FlareGitProjectState,
  ProductDecision,
  PublicationJournalEntry,
  Requirement,
  Task,
  VerificationEvidence,
} from "../core/types.js";

export interface ClaimResult { candidate?: CandidateGeneration; decision?: ProductDecision; reason?: string }
export interface PrepareResult { ok: boolean; journal?: PublicationJournalEntry; error?: string; stale?: boolean }

/** Plain-typed view of the ledger RPC surface used by Workflows and Queues. */
export interface Ledger {
  initialize(init: { projectId: string; projectName: string; canonicalRepoName: string; head: string; verificationPolicy: Record<string, unknown> }): Promise<FlareGitProjectState>;
  createTask(task: Task): Promise<Task>;
  resolveDecision(decisionId: string, selectedOptionId: string): Promise<{ taskIds: string[] }>;
  getState(): Promise<FlareGitProjectState>;
  claimLanding(req: { holder: string; taskIds: [string, string] }): Promise<ClaimResult>;
  recordVerification(candidateId: string, commit: string, evidence: VerificationEvidence): Promise<void>;
  preparePublish(candidateId: string): Promise<PrepareResult>;
  completePublish(journalId: string): Promise<void>;
  abortPublish(candidateId: string, journalId: string | undefined, reason: string, outcome: "failed" | "stale"): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  getBilling(): Promise<{ plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }>;
  setBilling(b: { plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }): Promise<void>;
  usageToday(): Promise<number>;
  consumeRun(limit: number): Promise<{ allowed: boolean; used: number }>;
  ingestCheckpoint(ev: { eventId: string; taskId: string; commit: string; ready: boolean }): Promise<{ applied: boolean }>;
}

const LEASE_MS = 20 * 60_000;

/**
 * Authoritative project state (SQLite-backed). Single writer: every transition — event ingestion,
 * landing lease, publication ledger, decisions — is validated and committed here, so duplicate or
 * late events and concurrent landings cannot corrupt accepted state.
 */
export class RepositoryController extends DurableObject<Env> {
  private state: FlareGitProjectState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS billing (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (day TEXT PRIMARY KEY, n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `);
  }

  private load(): FlareGitProjectState {
    if (this.state) return this.state;
    const row = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM project WHERE id = 1").toArray()[0];
    if (!row) throw new Error("Project not initialized: call initialize() with the seeded canonical head");
    this.state = JSON.parse(row.doc) as FlareGitProjectState;
    return this.state;
  }

  private save(): void {
    this.ctx.storage.sql.exec("INSERT INTO project (id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc", JSON.stringify(this.state));
  }

  /** First-time setup with the real head of the canonical Artifacts repository. */
  async initialize(init: { projectId: string; projectName: string; canonicalRepoName: string; head: string; verificationPolicy: Record<string, unknown> }): Promise<FlareGitProjectState> {
    const existing = this.ctx.storage.sql.exec("SELECT 1 FROM project WHERE id = 1").toArray();
    if (existing.length > 0) return this.load();
    this.state = {
      projectId: init.projectId,
      projectName: init.projectName,
      canonicalRepoName: init.canonicalRepoName,
      acceptedState: { currentCommit: init.head, acceptedAt: new Date().toISOString(), buildDigest: "seed", activeRequirements: [], history: [] },
      tasks: {},
      candidates: {},
      evidence: {},
      decisions: {},
      journal: [],
      policyVersion: 1,
      verificationPolicy: init.verificationPolicy,
    };
    this.save();
    return this.state;
  }

  async getState(): Promise<FlareGitProjectState> {
    return this.load();
  }

  /** Returns false if this event id was already processed (at-least-once delivery safe). */
  private firstDelivery(eventId: string): boolean {
    const res = this.ctx.storage.sql.exec("INSERT OR IGNORE INTO events (id, at) VALUES (?, ?)", eventId, new Date().toISOString());
    return res.rowsWritten > 0;
  }

  async createTask(task: Task): Promise<Task> {
    const s = this.load();
    if (s.tasks[task.id]) return s.tasks[task.id]!;
    s.tasks[task.id] = task;
    this.save();
    return task;
  }

  async ingestCheckpoint(ev: { eventId: string; taskId: string; commit: string; ready: boolean; filesChanged?: string[] }): Promise<{ applied: boolean }> {
    if (!this.firstDelivery(ev.eventId)) return { applied: false };
    const s = this.load();
    const task = s.tasks[ev.taskId];
    if (!task || task.status === "cancelled" || task.status === "accepted") return { applied: false };
    // A push that arrives while the task is being integrated is newer work; it applies after the landing.
    task.currentCommit = ev.commit;
    task.checkpoints.push({
      id: `chk_${ev.eventId.slice(0, 8)}`,
      commitHash: ev.commit,
      author: task.contributor.name,
      message: ev.ready ? "Ready for integration" : "Work in progress",
      timestamp: new Date().toISOString(),
      isReadyForIntegration: ev.ready,
      filesChanged: ev.filesChanged ?? [],
    });
    if (task.status !== "integrating" && task.status !== "verifying") task.status = ev.ready ? "ready" : "checkpointed";
    task.updatedAt = new Date().toISOString();
    this.save();
    return { applied: true };
  }

  async getBilling(): Promise<{ plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }> {
    const row = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM billing WHERE id = 1").toArray()[0];
    return row ? JSON.parse(row.doc) : { plan: "free", status: "none", updatedAt: new Date(0).toISOString() };
  }

  async setBilling(b: { plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO billing (id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc", JSON.stringify(b));
  }

  async usageToday(): Promise<number> {
    const day = new Date().toISOString().slice(0, 10);
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT n FROM runs WHERE day = ?", day).toArray()[0]?.n ?? 0;
  }

  /** Spend guard: atomically count a model-backed run against today's per-project allowance. */
  async consumeRun(limit: number): Promise<{ allowed: boolean; used: number }> {
    const day = new Date().toISOString().slice(0, 10);
    const row = this.ctx.storage.sql.exec<{ n: number }>("SELECT n FROM runs WHERE day = ?", day).toArray()[0];
    const used = row?.n ?? 0;
    if (used >= limit) return { allowed: false, used };
    this.ctx.storage.sql.exec("INSERT INTO runs (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1", day);
    return { allowed: true, used: used + 1 };
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this.load().tasks[taskId];
    if (!task || task.status === "accepted") throw new Error("Cannot cancel");
    task.status = "cancelled";
    this.save();
  }

  /** Acquire the single landing lease and freeze a candidate against the current accepted head. */
  async claimLanding(req: { holder: string; taskIds: [string, string] }): Promise<ClaimResult> {
    const s = this.load();
    const now = Date.now();
    const lease = this.ctx.storage.sql.exec<{ holder: string; expires_at: number }>("SELECT holder, expires_at FROM lease WHERE id = 1").toArray()[0];
    if (lease && lease.expires_at > now && lease.holder !== req.holder) return { reason: "Another landing holds the lease" };

    const tasks = req.taskIds.map((id) => s.tasks[id]);
    if (tasks.some((t) => !t)) return { reason: "Unknown task" };
    const [a, b] = tasks as [Task, Task];
    for (const t of [a, b]) {
      if (t.status === "accepted" || t.status === "cancelled") return { reason: `Task ${t.id} is ${t.status}` };
      if (t.status === "working" || t.status === "checkpointed" || t.status === "needs_decision") return { reason: `Task ${t.id} is not ready` };
    }
    for (const ra of a.requirements.filter((r) => r.status === "approved")) {
      for (const rb of b.requirements.filter((r) => r.status === "approved")) {
        if (!detectContradiction(ra, rb)) continue;
        const decision = createProductDecision(ra, rb);
        s.decisions[decision.id] = decision;
        a.status = b.status = "needs_decision";
        this.save();
        return { decision };
      }
    }
    const candidate = freezeCandidateGeneration({
      tasks: [a, b],
      acceptedBaseCommit: s.acceptedState.currentCommit,
      policyVersion: s.policyVersion,
      verificationPolicy: s.verificationPolicy,
      approvedRequirements: [...s.acceptedState.activeRequirements, ...a.requirements, ...b.requirements].filter((r: Requirement) => r.status === "approved"),
    });
    s.candidates[candidate.id] = candidate;
    a.status = b.status = "integrating";
    a.activeCandidateId = b.activeCandidateId = candidate.id;
    this.ctx.storage.sql.exec("INSERT INTO lease (id, holder, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at", req.holder, now + LEASE_MS);
    this.save();
    return { candidate };
  }

  private releaseLease(): void {
    this.ctx.storage.sql.exec("DELETE FROM lease WHERE id = 1");
  }

  async recordVerification(candidateId: string, commit: string, evidence: VerificationEvidence): Promise<void> {
    const s = this.load();
    const c = s.candidates[candidateId];
    if (!c) throw new Error("Unknown candidate");
    s.evidence[evidence.id] = evidence;
    c.candidateCommit = commit;
    c.evidenceId = evidence.id;
    c.status = evidence.status === "passed" && evidence.candidateCommit === commit ? "verified" : "verifying";
    this.save();
  }

  /** Ledger step 1: validate every invariant, then journal PREPARED. The workflow then pushes with a lease. */
  async preparePublish(candidateId: string): Promise<PrepareResult> {
    const s = this.load();
    const c = s.candidates[candidateId];
    const ev = c?.evidenceId ? s.evidence[c.evidenceId] : undefined;
    if (!c || !ev || !c.candidateCommit) return { ok: false, error: "No verified candidate" };
    if (ev.status !== "passed" || ev.candidateCommit !== c.candidateCommit) return { ok: false, error: "Evidence does not match candidate" };
    if (ev.expectedAcceptedBase !== c.expectedAcceptedBase || ev.requirementsVersion !== c.frozenPolicyVersion) return { ok: false, error: "Evidence was produced for different inputs" };
    const cancelled = c.participatingTaskIds.filter((id) => s.tasks[id]?.status === "cancelled");
    if (cancelled.length > 0) return { ok: false, error: `Task ${cancelled[0]} was cancelled before publication` };
    if (s.acceptedState.currentCommit !== c.expectedAcceptedBase) {
      c.status = "stale";
      this.save();
      return { ok: false, stale: true, error: "Accepted head moved" };
    }
    const journal: PublicationJournalEntry = {
      id: `jrnl_${crypto.randomUUID().slice(0, 8)}`,
      candidateId,
      candidateCommit: c.candidateCommit,
      candidateTree: ev.candidateTree,
      expectedHead: c.expectedAcceptedBase,
      newHead: c.candidateCommit,
      outputDigest: ev.builtOutputDigest,
      state: "PREPARED",
      timestamp: new Date().toISOString(),
    };
    s.journal.push(journal);
    this.save();
    return { ok: true, journal };
  }

  /** Ledger step 2: the Artifacts ref update succeeded (or was found already applied). */
  async completePublish(journalId: string): Promise<void> {
    const s = this.load();
    const j = s.journal.find((e) => e.id === journalId);
    if (!j) throw new Error("Unknown journal entry");
    if (j.state === "ACCEPTED") return; // idempotent
    const c = s.candidates[j.candidateId]!;
    j.state = "ACCEPTED";
    j.timestamp = new Date().toISOString();
    c.status = "accepted";
    s.acceptedState.currentCommit = j.newHead;
    s.acceptedState.buildDigest = j.outputDigest;
    s.acceptedState.acceptedAt = j.timestamp;
    s.acceptedState.history.push({ commit: j.newHead, candidateId: c.id, acceptedAt: j.timestamp, participatingTasks: c.participatingTaskIds, evidenceId: c.evidenceId!, outputDigest: j.outputDigest });
    for (const id of c.participatingTaskIds) {
      const t = s.tasks[id]!;
      t.status = t.currentCommit === c.participatingCommits[id] ? "accepted" : "ready";
      for (const r of t.requirements) if (r.status === "approved" && !s.acceptedState.activeRequirements.some((x) => x.id === r.id)) s.acceptedState.activeRequirements.push(r);
    }
    this.releaseLease();
    this.save();
  }

  async abortPublish(candidateId: string, journalId: string | undefined, reason: string, outcome: "failed" | "stale"): Promise<void> {
    const s = this.load();
    const c = s.candidates[candidateId];
    if (!c) return;
    const j = journalId ? s.journal.find((e) => e.id === journalId) : undefined;
    if (j && j.state !== "ACCEPTED") Object.assign(j, { state: "ABORTED", error: reason, timestamp: new Date().toISOString() });
    c.status = outcome;
    c.failureBlocker = outcome === "failed" ? reason : undefined;
    for (const id of c.participatingTaskIds) {
      const t = s.tasks[id]!;
      if (t.status === "cancelled") continue;
      t.status = outcome === "stale" ? "ready" : "blocked";
      t.blockedReason = outcome === "failed" ? reason : undefined;
    }
    this.releaseLease();
    this.save();
  }

  async resolveDecision(decisionId: string, selectedOptionId: string): Promise<{ taskIds: string[] }> {
    const s = this.load();
    const d = s.decisions[decisionId];
    if (!d) throw new Error("Unknown decision");
    if (d.status === "resolved") return { taskIds: [] };
    const [idA, idB] = d.conflictingRequirementIds;
    if (selectedOptionId !== idA && selectedOptionId !== idB) throw new Error("Unknown option");
    d.selectedOptionId = selectedOptionId;
    d.status = "resolved";
    d.resolvedAt = new Date().toISOString();
    const taskIds: string[] = [];
    for (const t of Object.values(s.tasks)) {
      for (const r of t.requirements) {
        if (r.id === (selectedOptionId === idA ? idB : idA)) r.status = "superseded";
        if (r.id === selectedOptionId && r.policyPatch) {
          s.verificationPolicy = { ...s.verificationPolicy, ...r.policyPatch };
          s.policyVersion += 1;
        }
      }
      if (t.status === "needs_decision") {
        t.status = "ready";
        taskIds.push(t.id);
      }
    }
    this.save();
    return { taskIds };
  }
}
