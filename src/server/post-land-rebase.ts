import { z } from "zod";
import { isGitIntegrityPolicy, settingsFor } from "../core/command-policy.js";
import type { FlareGitProjectState, Task, VerificationEvidence } from "../core/types.js";
import type { CoordinationRuntime, ShellRuntime } from "./coordination-runtime.js";
import { gitAuthEnv, q } from "./shell.js";

/**
 * Post-land rebase: when a change lands, every other in-flight change built on an older accepted commit is
 * replayed onto the new one and checked again. Agent changes are updated in place; when the replay conflicts
 * (or the updated change fails its checks) the agent is re-run with the landed work as context. Changes
 * written by people are never rewritten: their author sees whether the update is clean and passes.
 */

const SHA = z.string().regex(/^[a-f0-9]{40}$/);
export const rebaseStatusSchema = z.enum(["pending", "updated", "verification_failed", "conflict_revising", "needs_author", "skipped", "failed", "agent_waiting"]);
export type RebaseStatus = z.infer<typeof rebaseStatusSchema>;
const WORKFLOW_ID = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
/** Why a re-run of the agent was refused: spending limits, a passing problem, or lost access/funding. */
export const revisionRefusalSchema = z.enum(["budget", "transient", "access"]);
export type RevisionRefusal = z.infer<typeof revisionRefusalSchema>;
/**
 * A re-run of the agent that was refused and is kept so it can be sent again. The context it was refused
 * with is frozen: the same request id, the landed diff and previous work (in `revisionContext`) and the
 * status it resumes once the agent is running.
 */
export const revisionRetrySchema = z
  .object({
    actorId: z.string().min(1).max(200),
    refusal: revisionRefusalSchema,
    refusedReason: z.string().max(500),
    resumeStatus: z.enum(["conflict_revising", "verification_failed"]),
    resumeReason: z.string().max(500),
    attempts: z.number().int().min(1).max(10_000),
    nextAttemptAt: z.string().datetime().nullable(),
    claimedUntil: z.string().datetime().nullable(),
  })
  .strict();
export type RevisionRetry = z.infer<typeof revisionRetrySchema>;
const failureSchema = z.object({ testId: z.string().max(200), description: z.string().max(500), message: z.string().max(500).optional() }).strict();
export const postLandRebaseRecordSchema = z
  .object({
    taskId: z.string().min(1).max(128),
    landedCommit: SHA,
    fromCommit: SHA,
    fromBase: SHA,
    status: rebaseStatusSchema,
    overlappingFiles: z.array(z.string().max(500)).max(200),
    conflictingFiles: z.array(z.string().max(500)).max(200),
    newCommit: SHA.nullable(),
    verification: z.object({ status: z.enum(["passed", "failed", "deferred"]), failures: z.array(failureSchema).max(10) }).strict().nullable(),
    reason: z.string().max(500),
    workflowId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    revisionWorkflowId: WORKFLOW_ID.nullable(),
    /** What the agent is told when it is re-run (landed diff, previous work ref, failing checks). */
    revisionContext: z.string().max(12_000).optional(),
    revisionRetry: revisionRetrySchema.optional(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PostLandRebaseRecord = z.infer<typeof postLandRebaseRecordSchema>;

export class PostLandRebaseLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS post_land_rebases(task_id TEXT NOT NULL,landed_commit TEXT NOT NULL,doc TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(task_id,landed_commit))");
  }
  get(taskId: string, landedCommit: string): PostLandRebaseRecord | null {
    const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM post_land_rebases WHERE task_id=? AND landed_commit=?", taskId, landedCommit).toArray()[0];
    return row ? postLandRebaseRecordSchema.parse(JSON.parse(row.doc)) : null;
  }
  save(record: PostLandRebaseRecord): void {
    const parsed = postLandRebaseRecordSchema.parse(record);
    this.storage.sql.exec("INSERT INTO post_land_rebases VALUES(?,?,?,?) ON CONFLICT(task_id,landed_commit) DO UPDATE SET doc=excluded.doc,updated_at=excluded.updated_at", parsed.taskId, parsed.landedCommit, JSON.stringify(parsed), parsed.updatedAt);
  }
  /** The newest update recorded for one change. */
  latestFor(taskId: string): PostLandRebaseRecord | null {
    const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM post_land_rebases WHERE task_id=? ORDER BY updated_at DESC LIMIT 1", taskId).toArray()[0];
    return row ? postLandRebaseRecordSchema.parse(JSON.parse(row.doc)) : null;
  }
  /** Updates whose agent re-run was refused and is waiting to be sent again. */
  waitingRevisions(limit = 20): PostLandRebaseRecord[] {
    return this.storage.sql.exec<{ doc: string }>("SELECT doc FROM post_land_rebases WHERE json_extract(doc,'$.status')='agent_waiting' ORDER BY updated_at LIMIT ?", limit).toArray().map((row) => postLandRebaseRecordSchema.parse(JSON.parse(row.doc)));
  }
  /** Latest update per change, newest first. */
  latest(limit = 200): PostLandRebaseRecord[] {
    const rows = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM post_land_rebases ORDER BY updated_at DESC LIMIT ?", limit * 4).toArray().map((row) => postLandRebaseRecordSchema.parse(JSON.parse(row.doc)));
    const seen = new Set<string>();
    return rows.filter((row) => !seen.has(row.taskId) && Boolean(seen.add(row.taskId))).slice(0, limit);
  }
}

export interface PostLandRebaseItem {
  taskId: string;
  landedCommit: string;
  fromCommit: string;
  fromBase: string;
  canonicalRepoName: string;
  workspaceRepoName: string;
  branch: string;
  agent: boolean;
  /** Verification policy as JSON, so the plan stays plain workflow step data. */
  policyJson: string;
  policyVersion: number;
  status: RebaseStatus;
}

const IN_FLIGHT_EXCLUDED: readonly Task["status"][] = ["accepted", "cancelled", "integrating", "verifying", "needs_decision", "working"];

/** Every unbound in-flight change built on an older commit than what just landed. Stacked changes are
 * updated by their parent's landing (rebaseDependents) and are left to that protocol. */
export function planPostLandRebase(ledger: PostLandRebaseLedger, state: FlareGitProjectState, landedCommit: string, workflowId: string, now = new Date()): PostLandRebaseItem[] {
  SHA.parse(landedCommit);
  if (state.acceptedState.currentCommit !== landedCommit) return [];
  const items: PostLandRebaseItem[] = [];
  for (const task of Object.values(state.tasks)) {
    if (IN_FLIGHT_EXCLUDED.includes(task.status) || task.dependsOn || task.acceptedTarget || task.targetGeneration) continue;
    if (!task.currentCommit || !task.baseCommit || task.baseCommit === landedCommit || task.currentCommit === task.baseCommit) continue;
    if (state.acceptedState.history.some((record) => record.commit === task.currentCommit)) continue;
    let record = ledger.get(task.id, landedCommit);
    if (record && record.fromCommit !== task.currentCommit) record = null;
    if (!record) {
      record = { taskId: task.id, landedCommit, fromCommit: task.currentCommit, fromBase: task.baseCommit, status: "pending", overlappingFiles: [], conflictingFiles: [], newCommit: null, verification: null, reason: `Updating onto ${landedCommit.slice(0, 7)}`, workflowId, revisionWorkflowId: null, updatedAt: now.toISOString() };
      ledger.save(record);
    }
    items.push({ taskId: task.id, landedCommit, fromCommit: task.currentCommit, fromBase: task.baseCommit, canonicalRepoName: state.canonicalRepoName, workspaceRepoName: task.workspace.repoName, branch: task.workspace.branch, agent: task.contributor.type === "agent", policyJson: JSON.stringify(state.verificationPolicy), policyVersion: state.policyVersion, status: record.status });
  }
  return items;
}

export const rebaseExecutionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("updated"), newCommit: SHA, overlappingFiles: z.array(z.string()), verification: z.object({ status: z.enum(["passed", "failed", "deferred"]), failures: z.array(failureSchema).max(10) }).strict(), pushed: z.boolean() }).strict(),
  z.object({ kind: z.literal("conflict"), conflictingFiles: z.array(z.string()), overlappingFiles: z.array(z.string()), landedDiff: z.string().max(8000), previousDiff: z.string().max(8000), reset: z.boolean() }).strict(),
  z.object({ kind: z.literal("skipped"), reason: z.string().max(500) }).strict(),
]);
export type RebaseExecution = z.infer<typeof rebaseExecutionSchema>;

export interface RebaseRecordResult {
  record: PostLandRebaseRecord;
  /** Present when the agent should be re-run on this change; the text becomes its context. */
  revision: { comment: string } | null;
}

const short = (commit: string) => commit.slice(0, 7);
const list = (files: readonly string[]) => (files.length ? files.slice(0, 20).join(", ") + (files.length > 20 ? ` and ${files.length - 20} more` : "") : "none");

/** Applies an executed update to the change, guarded by the exact commit and base it started from. */
export function recordPostLandRebase(ledger: PostLandRebaseLedger, state: FlareGitProjectState, input: { taskId: string; landedCommit: string; fromCommit: string; execution: RebaseExecution }, now = new Date()): RebaseRecordResult {
  const execution = rebaseExecutionSchema.parse(input.execution);
  const saved = ledger.get(input.taskId, input.landedCommit);
  if (!saved || saved.fromCommit !== input.fromCommit) throw new Error("No update was planned for this change and commit");
  if (saved.status !== "pending") return { record: saved, revision: null };
  const task = state.tasks[input.taskId];
  const stamp = now.toISOString();
  const finish = (patch: Partial<PostLandRebaseRecord>, revision: RebaseRecordResult["revision"] = null): RebaseRecordResult => {
    const record = { ...saved, ...patch, ...(revision ? { revisionContext: revision.comment.slice(0, 12_000) } : {}), updatedAt: stamp };
    ledger.save(record);
    return { record, revision };
  };
  if (!task || task.currentCommit !== saved.fromCommit || task.baseCommit !== saved.fromBase || ["integrating", "verifying", "accepted", "cancelled"].includes(task.status)) return finish({ status: "skipped", reason: "The change moved while it was being updated; its newer work is kept as is" });
  if (execution.kind === "skipped") return finish({ status: "skipped", reason: execution.reason });
  const checkpoint = (commit: string, message: string, ready: boolean) => {
    task.baseCommit = input.landedCommit;
    task.currentCommit = commit;
    task.checkpoints.push({ id: `chk_${crypto.randomUUID()}`, commitHash: commit, author: "FlareGit", message, timestamp: stamp, isReadyForIntegration: ready, filesChanged: [] });
    task.updatedAt = stamp;
  };
  if (execution.kind === "updated") {
    const failures = execution.verification.failures;
    const failedText = failures.map((failure) => `${failure.description}${failure.message ? ` (${failure.message})` : ""}`).join("; ").slice(0, 300);
    if (!execution.pushed) {
      return finish({ status: "needs_author", overlappingFiles: execution.overlappingFiles, newCommit: execution.newCommit, verification: execution.verification,
        reason: execution.verification.status === "failed" ? `Updating onto ${short(input.landedCommit)} is clean but checks fail: ${failedText}. The author needs to update this change.` : `Updating onto ${short(input.landedCommit)} is clean${execution.verification.status === "passed" ? " and checks pass" : ""}. The author needs to pull the latest version into this change to re-queue it.` });
    }
    const wasReady = task.status === "ready";
    checkpoint(execution.newCommit, `Updated onto ${short(input.landedCommit)}`, wasReady && execution.verification.status !== "failed");
    if (execution.verification.status === "failed") {
      task.status = "checkpointed";
      return finish({ status: "verification_failed", overlappingFiles: execution.overlappingFiles, newCommit: execution.newCommit, verification: execution.verification, reason: `Updated onto ${short(input.landedCommit)}, but checks fail: ${failedText}. The agent is revising it.` },
        { comment: [`The accepted version moved to ${input.landedCommit}. FlareGit replayed this change on top of it (now ${execution.newCommit}), but the protected checks fail:`, ...failures.map((failure) => `- ${failure.description}${failure.message ? `: ${failure.message}` : ""}`), "Fix the change so it works on the latest version."].join("\n") });
    }
    if (!wasReady) task.status = "checkpointed";
    return finish({ status: "updated", overlappingFiles: execution.overlappingFiles, newCommit: execution.newCommit, verification: execution.verification, reason: execution.verification.status === "passed" ? `Updated onto ${short(input.landedCommit)} and checks pass` : `Updated onto ${short(input.landedCommit)}; checks run again when it lands` });
  }
  if (!execution.reset) return finish({ status: "needs_author", conflictingFiles: execution.conflictingFiles, overlappingFiles: execution.overlappingFiles, reason: `Conflicts with the latest version in ${list(execution.conflictingFiles)}. The author needs to update this change.` });
  checkpoint(input.landedCommit, `Restarted on ${short(input.landedCommit)}; previous work kept at ${short(saved.fromCommit)}`, false);
  task.status = "checkpointed";
  return finish({ status: "conflict_revising", conflictingFiles: execution.conflictingFiles, overlappingFiles: execution.overlappingFiles, reason: `Conflicts with the latest version in ${list(execution.conflictingFiles)}. The agent is redoing its change on top of it.` },
    { comment: [`The accepted version moved to ${input.landedCommit} and this change no longer applies cleanly (conflicts in ${list(execution.conflictingFiles)}).`, `Your previous version is kept at commit ${saved.fromCommit}; this branch now starts from the latest version. Redo the goal on top of it, keeping the landed behavior.`, "What landed in those files:", execution.landedDiff, "Your previous change to them:", execution.previousDiff].join("\n").slice(0, 12000) });
}

export type RevisionOutcome = { ok: true } | { ok: false; reason: string; refusal: RevisionRefusal; actorId: string };

/** Bounded backoff for automatic re-sends: 5 minutes doubling up to 6 hours, at most 12 tries; then by hand. */
export const REVISION_RETRY_LIMIT = 12;
const RETRY_BASE_MS = 5 * 60_000, RETRY_MAX_MS = 6 * 60 * 60_000, CLAIM_MS = 2 * 60_000;
export function revisionRetryDelay(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
}

const refusalText: Record<RevisionRefusal, string> = {
  budget: "The agent could not be re-run because managed agent spending is at its limit. FlareGit tries again automatically when capacity may have returned; an owner can also run it again.",
  transient: "The agent could not be re-run yet. FlareGit tries again automatically; an owner can also run it again now.",
  access: "The agent could not be re-run because the person or account that would fund it is unavailable. An owner can run it again.",
};

/** Records written before refused re-runs were kept: status "failed" after a refused re-run. */
function isLegacyRefusal(record: PostLandRebaseRecord): boolean {
  return record.status === "failed" && record.revisionWorkflowId !== null && record.reason.startsWith("The agent could not be re-run");
}
function resumeStatusOf(record: PostLandRebaseRecord): RevisionRetry["resumeStatus"] {
  if (record.revisionRetry) return record.revisionRetry.resumeStatus;
  if (record.status === "conflict_revising" || record.status === "verification_failed") return record.status;
  return record.conflictingFiles.length ? "conflict_revising" : "verification_failed";
}
function resumeReasonOf(record: PostLandRebaseRecord): string {
  if (record.revisionRetry) return record.revisionRetry.resumeReason;
  if (record.status === "conflict_revising" || record.status === "verification_failed") return record.reason;
  return resumeStatusOf(record) === "conflict_revising" ? `Conflicts with the latest version in ${list(record.conflictingFiles)}. The agent is redoing its change on top of it.` : `Updated onto ${short(record.landedCommit)}, but checks fail. The agent is revising it.`;
}

/** Saves how a re-run of the agent ended. A refusal keeps the frozen re-run so it can be sent again. */
export function markRebaseRevision(ledger: PostLandRebaseLedger, taskId: string, landedCommit: string, revisionWorkflowId: string, outcome: RevisionOutcome, now = new Date()): PostLandRebaseRecord {
  const saved = ledger.get(taskId, landedCommit);
  if (!saved) throw new Error("Unknown update");
  if (saved.revisionWorkflowId && saved.revisionWorkflowId !== revisionWorkflowId) throw new Error("This update is re-run under a different request");
  const stamp = now.toISOString();
  const { revisionRetry: previous, ...rest } = saved;
  if (outcome.ok) {
    // Once the agent runs, the change shows the status it was waiting to resume.
    const record: PostLandRebaseRecord = { ...rest, status: resumeStatusOf(saved), reason: resumeReasonOf(saved), revisionWorkflowId, updatedAt: stamp };
    ledger.save(record);
    return record;
  }
  if (saved.status !== "agent_waiting" && saved.status !== "conflict_revising" && saved.status !== "verification_failed" && !isLegacyRefusal(saved)) return saved;
  const attempts = (previous?.attempts ?? 0) + 1;
  const automatic = outcome.refusal !== "access" && attempts < REVISION_RETRY_LIMIT;
  const retry: RevisionRetry = {
    actorId: outcome.actorId,
    refusal: outcome.refusal,
    refusedReason: outcome.reason.slice(0, 500),
    resumeStatus: resumeStatusOf(saved),
    resumeReason: resumeReasonOf(saved).slice(0, 500),
    attempts,
    nextAttemptAt: automatic ? new Date(now.getTime() + revisionRetryDelay(attempts)).toISOString() : null,
    claimedUntil: null,
  };
  const record: PostLandRebaseRecord = { ...rest, status: "agent_waiting", revisionWorkflowId, revisionRetry: retry, reason: refusalText[outcome.refusal], updatedAt: stamp };
  ledger.save(record);
  return record;
}

export interface RevisionClaim { taskId: string; landedCommit: string; workflowId: string; actorId: string }
export type ManualRetry = { kind: "claimed"; claim: RevisionClaim } | { kind: "settled"; record: PostLandRebaseRecord } | { kind: "refused"; reason: string };

const RESTING: readonly Task["status"][] = ["accepted", "cancelled", "integrating", "verifying"];

/** The change still sits where the refused re-run left it; otherwise the re-run is no longer wanted. */
function stillWaiting(state: FlareGitProjectState, record: PostLandRebaseRecord): boolean {
  const task = state.tasks[record.taskId];
  const expected = resumeStatusOf(record) === "conflict_revising" ? record.landedCommit : record.newCommit;
  return Boolean(task && task.contributor.type === "agent" && !RESTING.includes(task.status) && task.baseCommit === record.landedCommit && task.currentCommit === expected);
}

function claim(ledger: PostLandRebaseLedger, record: PostLandRebaseRecord, actorId: string, now: Date): RevisionClaim {
  const retry: RevisionRetry = record.revisionRetry ?? { actorId, refusal: "transient", refusedReason: record.reason.slice(0, 500), resumeStatus: resumeStatusOf(record), resumeReason: resumeReasonOf(record).slice(0, 500), attempts: 1, nextAttemptAt: null, claimedUntil: null };
  ledger.save({ ...record, status: "agent_waiting", revisionRetry: { ...retry, actorId, claimedUntil: new Date(now.getTime() + CLAIM_MS).toISOString() }, updatedAt: now.toISOString() });
  return { taskId: record.taskId, landedCommit: record.landedCommit, workflowId: record.revisionWorkflowId!, actorId };
}

function retire(ledger: PostLandRebaseLedger, record: PostLandRebaseRecord, now: Date): PostLandRebaseRecord {
  const { revisionRetry: _dropped, ...rest } = record;
  void _dropped;
  const retired: PostLandRebaseRecord = { ...rest, status: "skipped", reason: "The change moved on after the agent could not be re-run, so nothing is re-run", updatedAt: now.toISOString() };
  ledger.save(retired);
  return retired;
}

/**
 * Claims the refused re-runs that are due to be sent again. A claim holds for two minutes so two advancers
 * never send the same re-run at once; the stable request id turns any late duplicate into a replay.
 */
export function claimDueRevisions(ledger: PostLandRebaseLedger, state: FlareGitProjectState, now = new Date()): RevisionClaim[] {
  const claims: RevisionClaim[] = [];
  for (const record of ledger.waitingRevisions()) {
    const retry = record.revisionRetry;
    if (!retry || !record.revisionWorkflowId || retry.nextAttemptAt === null || Date.parse(retry.nextAttemptAt) > now.getTime()) continue;
    if (retry.claimedUntil && Date.parse(retry.claimedUntil) > now.getTime()) continue;
    if (ledger.latestFor(record.taskId)?.landedCommit !== record.landedCommit || !stillWaiting(state, record)) { retire(ledger, record, now); continue; }
    claims.push(claim(ledger, record, retry.actorId, now));
  }
  return claims;
}

/** When the next automatic re-send is due (epoch ms), for the repository alarm. */
export function nextRevisionRetryAt(ledger: PostLandRebaseLedger): number | null {
  const due = ledger.waitingRevisions(200).flatMap((record) => record.revisionRetry?.nextAttemptAt ? [Date.parse(record.revisionRetry.nextAttemptAt)] : []);
  return due.length ? Math.min(...due) : null;
}

/** A person asks to run the agent again on the latest version of one change. Repeating the request is safe. */
export function claimManualRevision(ledger: PostLandRebaseLedger, state: FlareGitProjectState, taskId: string, actorId: string, now = new Date()): ManualRetry {
  const record = ledger.latestFor(taskId);
  if (!record || !record.revisionWorkflowId) return { kind: "refused", reason: "This change has no agent re-run to send again" };
  if (record.status === "conflict_revising" || record.status === "verification_failed") return { kind: "settled", record };
  if (record.status !== "agent_waiting" && !isLegacyRefusal(record)) return { kind: "refused", reason: "This change has no agent re-run waiting" };
  if (record.revisionRetry?.claimedUntil && Date.parse(record.revisionRetry.claimedUntil) > now.getTime()) return { kind: "settled", record };
  if (!stillWaiting(state, record)) return { kind: "settled", record: retire(ledger, record, now) };
  return { kind: "claimed", claim: claim(ledger, record, actorId, now) };
}

/** For the queue: why a change is still waiting, and whether its update for this commit has finished. */
export function rebaseUpdate(ledger: PostLandRebaseLedger, taskId: string, landedCommit: string): { reason: string; settled: boolean } | null {
  const record = ledger.get(taskId, landedCommit);
  return record ? { reason: record.reason, settled: record.status !== "pending" } : null;
}


const DIFF_LIMIT = 6000;

async function names(shell: ShellRuntime, command: string): Promise<string[]> {
  const result = await shell.exec(command);
  return result.success ? result.stdout.split("\0").filter(Boolean) : [];
}

function deferVerification(policy: Record<string, unknown>): boolean {
  return isGitIntegrityPolicy(policy) || "trustedBrowserFixture" in policy || "trustedBrowserPolicyDigest" in policy;
}

/** Replays one change onto the landed commit inside a platform container and re-runs protected checks. */
export async function executePostLandRebase(runtime: CoordinationRuntime, item: PostLandRebaseItem): Promise<RebaseExecution> {
  const shell = await runtime.shell("post-land-rebase");
  const WORK = `${runtime.workDir}/post-land-rebase`;
  try {
    const run = (command: string, env?: Record<string, string>) => shell.exec(command, env);
    const canonical = await runtime.credential(item.canonicalRepoName, "read");
    let cloned;
    try { cloned = await run(`rm -rf ${q(WORK)} && git clone --quiet --no-checkout ${q(canonical.remote)} ${q(WORK)}`, gitAuthEnv(canonical.token)); } finally { await canonical.close(); }
    if (!cloned.success) throw new Error("The accepted repository could not be read");
    await run(`git -C ${q(WORK)} config user.name FlareGit && git -C ${q(WORK)} config user.email integrator@flaregit.com && git -C ${q(WORK)} config core.hooksPath /dev/null`);
    const source = await runtime.credential(item.workspaceRepoName, "read");
    let fetched;
    try { fetched = await run(`git -C ${q(WORK)} fetch --quiet ${q(source.remote)} ${q(`+refs/heads/${item.branch}:refs/flaregit/rebase/source`)}`, gitAuthEnv(source.token)); } finally { await source.close(); }
    if (!fetched.success) return { kind: "skipped", reason: "The change's saved branch could not be read" };
    const head = (await run(`git -C ${q(WORK)} rev-parse refs/flaregit/rebase/source`)).stdout.trim();
    if (head !== item.fromCommit) return { kind: "skipped", reason: "The change's branch has newer work; it is updated after that work is saved" };
    if (!(await run(`git -C ${q(WORK)} cat-file -e ${q(`${item.landedCommit}^{commit}`)} && git -C ${q(WORK)} cat-file -e ${q(`${item.fromBase}^{commit}`)}`)).success) return { kind: "skipped", reason: "The landed commit or the change's base is unavailable" };
    const landedFiles = await names(shell, `git -C ${q(WORK)} diff --name-only -z ${q(item.fromBase)} ${q(item.landedCommit)}`);
    const ownFiles = new Set(await names(shell, `git -C ${q(WORK)} diff --name-only -z ${q(item.fromBase)} ${q(item.fromCommit)}`));
    const overlappingFiles = landedFiles.filter((file) => ownFiles.has(file)).slice(0, 200);
    const replay = await run(`git -C ${q(WORK)} -c advice.detachedHead=false checkout --quiet --detach ${q(item.fromCommit)} && git -C ${q(WORK)} rebase --quiet --onto ${q(item.landedCommit)} ${q(item.fromBase)}`);
    if (!replay.success) {
      const conflictingFiles = (await run(`git -C ${q(WORK)} diff --name-only --diff-filter=U`)).stdout.split("\n").filter(Boolean).slice(0, 200);
      await run(`git -C ${q(WORK)} rebase --abort`);
      const scope = (conflictingFiles.length ? conflictingFiles : overlappingFiles).map(q).join(" ");
      const landedDiff = (await run(`git -C ${q(WORK)} diff --no-ext-diff --no-textconv ${q(item.fromBase)} ${q(item.landedCommit)}${scope ? ` -- ${scope}` : ""}`)).stdout.slice(0, DIFF_LIMIT);
      const previousDiff = (await run(`git -C ${q(WORK)} diff --no-ext-diff --no-textconv ${q(item.fromBase)} ${q(item.fromCommit)}${scope ? ` -- ${scope}` : ""}`)).stdout.slice(0, DIFF_LIMIT);
      let reset = false;
      if (item.agent) {
        const target = await runtime.credential(item.workspaceRepoName, "write");
        try {
          // Keep the previous work under a platform ref, then restart the branch on the landed commit.
          const kept = await run(`git -C ${q(WORK)} push --quiet ${q(target.remote)} ${q(`${item.fromCommit}:refs/flaregit/preserved/${item.fromCommit}`)}`, gitAuthEnv(target.token));
          reset = kept.success && (await run(`git -C ${q(WORK)} push --quiet ${q(`--force-with-lease=refs/heads/${item.branch}:${item.fromCommit}`)} ${q(target.remote)} ${q(`${item.landedCommit}:refs/heads/${item.branch}`)}`, gitAuthEnv(target.token))).success;
        } finally { await target.close(); }
      }
      return { kind: "conflict", conflictingFiles, overlappingFiles, landedDiff, previousDiff, reset };
    }
    const newCommit = (await run(`git -C ${q(WORK)} rev-parse HEAD`)).stdout.trim();
    let verification: Extract<RebaseExecution, { kind: "updated" }>["verification"] = { status: "deferred", failures: [] };
    const policy = z.record(z.string(), z.unknown()).parse(JSON.parse(item.policyJson));
    if (!deferVerification(policy)) {
      const settings = settingsFor(policy);
      const checked = await run(`cd ${q(runtime.platformDir)} && bun src/core/verification/cli.ts ${q(settings.fixture)} ${q(WORK)} ${q(newCommit)} ${q(item.landedCommit)} ${q(String(item.policyVersion))} ${q(JSON.stringify(policy))}`);
      let evidence: VerificationEvidence | null = null;
      try { evidence = JSON.parse(checked.stdout.trim().split("\n").at(-1) ?? "") as VerificationEvidence; } catch { evidence = null; }
      if (!evidence || evidence.candidateCommit !== newCommit || (evidence.status !== "passed" && evidence.status !== "failed")) verification = { status: "failed", failures: [{ testId: "verifier", description: "Protected checks could not run on the updated change" }] };
      else verification = { status: evidence.status, failures: evidence.testResults.flatMap((suite) => suite.items).filter((test) => !test.passed).slice(0, 10).map((test) => ({ testId: test.testId.slice(0, 200), description: test.description.slice(0, 500), ...(test.message ? { message: test.message.slice(0, 500) } : {}) })) };
    }
    let pushed = false;
    if (item.agent) {
      const target = await runtime.credential(item.workspaceRepoName, "write");
      try { pushed = (await run(`git -C ${q(WORK)} push --quiet ${q(`--force-with-lease=refs/heads/${item.branch}:${item.fromCommit}`)} ${q(target.remote)} ${q(`${newCommit}:refs/heads/${item.branch}`)}`, gitAuthEnv(target.token))).success; } finally { await target.close(); }
    }
    if (item.agent && !pushed) return { kind: "skipped", reason: "The change's branch moved or could not be updated; its saved work is unchanged" };
    return { kind: "updated", newCommit, overlappingFiles, verification, pushed };
  } finally {
    await shell.close();
  }
}
