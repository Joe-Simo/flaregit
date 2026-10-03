import { createHash } from "node:crypto";
import { z } from "zod";
import type { HumanDecisionActor, TaskStatus } from "../core/types.js";
import type { RebaseApplication } from "./retained-inputs.js";
import { retainedInputSchema } from "./retained-inputs.js";
import { retainedGitInputRef } from "./retained-git-input.js";
import { isSafeRef } from "../core/sanitize.js";
import { openRepositoryRead, RepositoryReadError, type RepositoryReadCapability } from "./repository-read-budget.js";
import type { CoreGitAdmission } from "./core-git-budget.js";

export interface RebaseRecoverySnapshot {
  projectId: string; incarnation: string | null; canonicalRepoName: string;
  /** Derived from the committed parent candidate's history/journal, never caller JSON. */
  accepted: boolean;
  task: { id: string; currentCommit: string; baseCommit: string; workspaceRepoName: string; branch: string; dependsOn?: string; status: TaskStatus; busy?: boolean };
}
export interface RebaseRecoveryProof {
  workspaceHead: string | null;
  original: string | null; originalBase: string | null; result: string | null; targetBase: string | null;
}
export type RebaseRecoveryStatus = "already_applied" | "reconciled" | "reconcile_available" | "remote_old_resume_required" | "newer_work" | "metadata_changed" | "unavailable";
export interface RebaseRecoveryReport {
  id: string; taskId: string; originalCommit: string; originalBase: string; commit: string; base: string; parentAccepted: boolean;
  status: RebaseRecoveryStatus; savedStatus: RebaseApplication["status"]; createdAt: string; version: number;
  observedHead: string | null; canReconcile: boolean; detail: string;
}
export interface RebaseRecoveryReceipt {
  applicationId: string; version: number; status: "reconciled" | "already_applied";
  actor: HumanDecisionActor; recordedAt: string;
}
export interface RebaseRecoveryMutation {
  applicationId: string; commit: string; base: string; dependsOn?: string;
  metadataState: "original" | "new_head_partial" | "result";
}
export class RebaseRecoveryError extends Error {
  constructor(message: string, readonly status: 409 | 503 | 429, readonly report?: RebaseRecoveryReport) { super(message); }
}
const sha = /^[a-f0-9]{40}$/;
const actorSchema = z.object({ userId: z.string().min(1).max(256), displayName: z.string().min(1).max(200), viaToken: z.boolean() }).strict();
const versionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const uuid = z.string().uuid();
export const REBASE_RECOVERY_AUDIT_CAPACITY = 10_000;
function normalized(application: RebaseApplication, snapshot: RebaseRecoverySnapshot) {
  const input = retainedInputSchema.parse(application.input);
  if (!sha.test(application.commit) || !sha.test(application.base)) throw new RebaseRecoveryError("Saved rebase identity is invalid", 409);
  return { application: { input, commit: application.commit, base: application.base, parentAccepted: application.parentAccepted, status: application.status }, snapshot: { projectId: snapshot.projectId, incarnation: snapshot.incarnation, canonicalRepoName: snapshot.canonicalRepoName, accepted: snapshot.accepted, task: { id: snapshot.task.id, currentCommit: snapshot.task.currentCommit, baseCommit: snapshot.task.baseCommit, workspaceRepoName: snapshot.task.workspaceRepoName, branch: snapshot.task.branch, dependsOn: snapshot.task.dependsOn ?? null, status: snapshot.task.status, busy: Boolean(snapshot.task.busy) } } };
}
function fingerprint(application: RebaseApplication, snapshot: RebaseRecoverySnapshot) { return createHash("sha256").update(JSON.stringify(normalized(application, snapshot))).digest("hex"); }
function metadataState(application: RebaseApplication, snapshot: RebaseRecoverySnapshot): RebaseRecoveryMutation["metadataState"] | null {
  const input = application.input, task = snapshot.task;
  if (!snapshot.accepted || snapshot.projectId !== input.projectId || snapshot.incarnation !== input.incarnation || snapshot.canonicalRepoName !== input.canonicalRepoName || task.id !== input.taskId || task.workspaceRepoName !== input.workspaceRepoName || task.branch !== input.branch || task.busy || ["accepted", "cancelled", "integrating", "verifying"].includes(task.status)) return null;
  const oldDependency = task.dependsOn === input.dependsOn;
  const newDependency = task.dependsOn === (application.parentAccepted ? undefined : input.dependsOn);
  if (task.currentCommit === input.commit && task.baseCommit === input.base && oldDependency) return "original";
  if (task.currentCommit === application.commit && task.baseCommit === input.base && oldDependency) return "new_head_partial";
  if (task.currentCommit === application.commit && task.baseCommit === application.base && newDependency) return "result";
  return null;
}
function projection(application: RebaseApplication, snapshot: RebaseRecoverySnapshot, version: number, proof?: RebaseRecoveryProof): RebaseRecoveryReport {
  if (snapshot.projectId !== application.input.projectId || snapshot.incarnation !== application.input.incarnation || snapshot.canonicalRepoName !== application.input.canonicalRepoName) throw new RebaseRecoveryError("Saved rebase is unavailable in this repository scope", 409);
  const base = { id: application.input.id, taskId: application.input.taskId, originalCommit: application.input.commit, originalBase: application.input.base, commit: application.commit, base: application.base, parentAccepted: application.parentAccepted, savedStatus: application.status, createdAt: application.createdAt, version, observedHead: proof?.workspaceHead ?? null };
  if (!snapshot.accepted) return { ...base, status: "metadata_changed", canReconcile: false, detail: "Repository scope or committed parent history changed. No work was replaced." };
  if (application.status === "applied") return { ...base, status: "already_applied", canReconcile: false, detail: "This saved update was already recorded. Later work is unchanged." };
  if (!metadataState(application, snapshot)) return { ...base, status: "metadata_changed", canReconcile: false, detail: "Contribution metadata changed or is in use. Review the current work before recovering this saved update." };
  if (!proof) return { ...base, status: "unavailable", canReconcile: true, detail: "Remote state has not been checked. Check the saved result before reconciling metadata." };
  if (proof.original !== application.input.commit || proof.originalBase !== application.input.base || proof.result !== application.commit || proof.targetBase !== application.base || !proof.workspaceHead) return { ...base, status: "unavailable", canReconcile: false, detail: "Protected history or the workspace head could not be confirmed. No metadata was changed." };
  if (proof.workspaceHead === application.input.commit) return { ...base, status: "remote_old_resume_required", canReconcile: false, detail: "The branch is still at its original checkpoint. Applying the saved Git result is not implemented in this metadata-only recovery action." };
  if (proof.workspaceHead !== application.commit) return { ...base, status: "newer_work", canReconcile: false, detail: "The branch contains different or newer work. This saved result will not replace it." };
  return { ...base, status: "reconcile_available", canReconcile: true, detail: "The branch already contains the exact saved result. Its contribution metadata can be reconciled without a Git push." };
}

/** Read-only SDK proof, funded before lookup; no credential issuance, VM or Git writes. */
export async function verifyRebaseRecovery(binding: { get(name: string): Promise<RepositoryReadCapability> }, application: RebaseApplication, options: { authorize(): Promise<void>; reserveGroup(operationId: string): Promise<CoreGitAdmission> }): Promise<RebaseRecoveryProof> {
  const input = retainedInputSchema.parse(application.input);
  if (!isSafeRef(input.branch) || !sha.test(application.commit) || !sha.test(application.base) || input.followup) throw new RebaseRecoveryError("Saved rebase scope is invalid", 409);
  const resultRef = retainedGitInputRef(input.incarnation, input.taskId, application.commit), targetRef = retainedGitInputRef(input.incarnation, input.taskId, application.base);
  if (input.protectedRef !== retainedGitInputRef(input.incarnation, input.taskId, input.commit) || input.protectedBaseRef !== retainedGitInputRef(input.incarnation, input.taskId, input.base)) throw new RebaseRecoveryError("Protected source identity changed", 409);
  const hashAt = async (repo: RepositoryReadCapability, ref: string) => { const rows = await repo.log({ ref, limit: 1 }); if (rows.length > 1 || (rows[0] && !sha.test(rows[0].hash))) throw new RebaseRecoveryError("Remote identity is unavailable", 503); return rows[0]?.hash ?? null; };
  try {
    using canonical = await openRepositoryRead({ ARTIFACTS: binding }, { repoName: input.canonicalRepoName, ...options, limits: { maxProviderCalls: 8, maxMetadataBytes: 65536 } });
    const original = await hashAt(canonical, input.protectedRef), originalBase = await hashAt(canonical, input.protectedBaseRef), result = await hashAt(canonical, resultRef), targetBase = await hashAt(canonical, targetRef);
    using workspace = await openRepositoryRead({ ARTIFACTS: binding }, { repoName: input.workspaceRepoName, ...options, limits: { maxProviderCalls: 4, maxMetadataBytes: 65536 } });
    const workspaceHead = await hashAt(workspace, `refs/heads/${input.branch}`);
    await options.authorize();
    return { original, originalBase, result, targetBase, workspaceHead };
  } catch (error) {
    if (error instanceof RebaseRecoveryError) throw error;
    throw new RebaseRecoveryError(error instanceof RepositoryReadError ? error.message : "Saved rebase state could not be confirmed; no metadata changed", error instanceof RepositoryReadError && error.status === 429 ? 429 : 503);
  }
}

/** Receipts and the caller's metadata mutation share one SQLite transaction. */
export class RebaseRecoveryLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS rebase_recovery_versions(application_id TEXT PRIMARY KEY,version INTEGER NOT NULL,fingerprint TEXT NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS rebase_recovery_receipts(request_id TEXT PRIMARY KEY,payload TEXT NOT NULL,doc TEXT NOT NULL)");
  }
  version(applicationId: string): number { uuid.parse(applicationId); return this.storage.sql.exec<{ version: number }>("SELECT version FROM rebase_recovery_versions WHERE application_id=?", applicationId).toArray()[0]?.version ?? 0; }
  private payload(key: string, applicationId: string, actor: HumanDecisionActor, expectedVersion: number) { uuid.parse(key); uuid.parse(applicationId); actorSchema.parse(actor); versionSchema.parse(expectedVersion); return JSON.stringify({ applicationId, userId: actor.userId, viaToken: actor.viaToken, expectedVersion }); }
  replay(key: string, applicationId: string, actor: HumanDecisionActor, expectedVersion: number): RebaseRecoveryReceipt | null {
    const payload = this.payload(key, applicationId, actor, expectedVersion), row = this.storage.sql.exec<{ payload: string; doc: string }>("SELECT payload,doc FROM rebase_recovery_receipts WHERE request_id=?", key).toArray()[0];
    if (!row) return null; if (row.payload !== payload) throw new RebaseRecoveryError("Recovery request key was already used for another operation", 409); return JSON.parse(row.doc) as RebaseRecoveryReceipt;
  }
  /** Check before provider reads, then again in the mutation transaction. Replays never need a new row. */
  preflight(key: string, applicationId: string, actor: HumanDecisionActor, expectedVersion: number): RebaseRecoveryReceipt | null {
    const previous = this.replay(key, applicationId, actor, expectedVersion);
    if (previous) return previous;
    const count = this.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM rebase_recovery_receipts").toArray()[0]?.count ?? 0;
    if (count >= REBASE_RECOVERY_AUDIT_CAPACITY) throw new RebaseRecoveryError("Recovery audit capacity reached. Existing saved requests remain replayable; historical receipts and Git work are preserved.", 429);
    return null;
  }
  observe(application: RebaseApplication, snapshot: RebaseRecoverySnapshot, proof?: RebaseRecoveryProof): RebaseRecoveryReport {
    const hash = fingerprint(application, snapshot);
    return this.storage.transactionSync(() => {
      const old = this.storage.sql.exec<{ version: number; fingerprint: string }>("SELECT version,fingerprint FROM rebase_recovery_versions WHERE application_id=?", application.input.id).toArray()[0];
      const version = old ? old.version + Number(old.fingerprint !== hash) : 0;
      if (!old || old.fingerprint !== hash) this.storage.sql.exec("INSERT INTO rebase_recovery_versions VALUES(?,?,?) ON CONFLICT(application_id) DO UPDATE SET version=excluded.version,fingerprint=excluded.fingerprint", application.input.id, version, hash);
      return projection(application, snapshot, version, proof);
    });
  }
  reconcile(input: { application: RebaseApplication; snapshot: RebaseRecoverySnapshot; proof: RebaseRecoveryProof; actor: HumanDecisionActor; expectedVersion: number; idempotencyKey: string }, apply: (plan: RebaseRecoveryMutation) => void, validateSync?: () => void): RebaseRecoveryReceipt {
    const { application, snapshot, proof, actor, expectedVersion, idempotencyKey } = input;
    const payload = this.payload(idempotencyKey, application.input.id, actor, expectedVersion);
    return this.storage.transactionSync(() => {
      validateSync?.();
      const previous = this.preflight(idempotencyKey, application.input.id, actor, expectedVersion); if (previous) return previous;
      const report = this.observe(application, snapshot, proof);
      if (report.version !== expectedVersion) throw new RebaseRecoveryError("Recovery metadata changed; refresh before reconciling", 409, report);
      if (report.status !== "reconcile_available" && report.status !== "already_applied") throw new RebaseRecoveryError(report.detail, report.status === "unavailable" ? 503 : 409, report);
      const state = metadataState(application, snapshot);
      if (report.status !== "already_applied") {
        if (!state) throw new RebaseRecoveryError("Recovery metadata changed", 409, report);
        apply({ applicationId: application.input.id, commit: application.commit, base: application.base, dependsOn: application.parentAccepted ? undefined : application.input.dependsOn, metadataState: state });
      }
      const version = expectedVersion + Number(report.status !== "already_applied");
      const receipt: RebaseRecoveryReceipt = { applicationId: application.input.id, version, status: report.status === "already_applied" ? "already_applied" : "reconciled", actor: actorSchema.parse(actor), recordedAt: new Date().toISOString() };
      if (report.status !== "already_applied") {
        const nextSnapshot = { ...snapshot, task: { ...snapshot.task, currentCommit: application.commit, baseCommit: application.base, dependsOn: application.parentAccepted ? undefined : application.input.dependsOn } };
        this.storage.sql.exec("UPDATE rebase_recovery_versions SET version=?,fingerprint=? WHERE application_id=?", version, fingerprint({ ...application, status: "applied" }, nextSnapshot), application.input.id);
      }
      this.storage.sql.exec("INSERT INTO rebase_recovery_receipts VALUES(?,?,?)", idempotencyKey, payload, JSON.stringify(receipt));
      return receipt;
    });
  }
}
