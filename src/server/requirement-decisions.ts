import { z } from "zod";
import { contradictionProofPlan, contradictionProofSchema, evaluateContradictionProof, parseProbeOutput, type ContradictionProof, type ExecutedSide, type ProbeOutcome, type RequirementProbe } from "../core/decision/contradiction-proof.js";
import type { FlareGitProjectState, ProductDecision, Requirement, Task } from "../core/types.js";
import type { CoordinationRuntime } from "./coordination-runtime.js";
import { gitAuthEnv, q } from "./shell.js";

/**
 * Requirement contradictions end to end: the platform runs both sides' code on the disputed input,
 * keeps that executed proof next to the human decision, and after the choice asks the agent whose
 * requirement lost to revise its change against the winning requirement.
 */

const SHA = /^[a-f0-9]{40}$/;
export const revisionStatusSchema = z.enum(["planned", "dispatched", "revised", "needs_author", "failed"]);
export const requirementRevisionSchema = z
  .object({
    decisionId: z.string().min(1).max(120),
    taskId: z.string().min(1).max(128),
    winningRequirementId: z.string().min(1).max(200),
    losingRequirementId: z.string().min(1).max(200),
    startCommit: z.string().regex(SHA).nullable(),
    workflowId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    status: revisionStatusSchema,
    reason: z.string().max(500).optional(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type RequirementRevision = z.infer<typeof requirementRevisionSchema>;

export interface RequirementDecisionView {
  decisionId: string;
  proof: ContradictionProof | null;
  revisions: RequirementRevision[];
}

/** Durable, idempotent records kept in the repository Durable Object's SQLite storage. */
export class RequirementDecisionLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS requirement_decision_proofs(decision_id TEXT PRIMARY KEY,doc TEXT NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS requirement_decision_revisions(decision_id TEXT NOT NULL,task_id TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(decision_id,task_id))");
  }
  proof(decisionId: string): ContradictionProof | null {
    const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM requirement_decision_proofs WHERE decision_id=?", decisionId).toArray()[0];
    return row ? contradictionProofSchema.parse(JSON.parse(row.doc)) : null;
  }
  /** The first executed proof is immutable; a replay of the same decision returns it unchanged. */
  recordProof(proof: ContradictionProof): ContradictionProof {
    const existing = this.proof(proof.decisionId);
    if (existing) return existing;
    this.storage.sql.exec("INSERT INTO requirement_decision_proofs VALUES(?,?)", proof.decisionId, JSON.stringify(contradictionProofSchema.parse(proof)));
    return proof;
  }
  revisions(decisionId: string): RequirementRevision[] {
    return this.storage.sql.exec<{ doc: string }>("SELECT doc FROM requirement_decision_revisions WHERE decision_id=? ORDER BY task_id", decisionId).toArray().map((row) => requirementRevisionSchema.parse(JSON.parse(row.doc)));
  }
  revision(decisionId: string, taskId: string): RequirementRevision | null {
    const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM requirement_decision_revisions WHERE decision_id=? AND task_id=?", decisionId, taskId).toArray()[0];
    return row ? requirementRevisionSchema.parse(JSON.parse(row.doc)) : null;
  }
  saveRevision(revision: RequirementRevision): void {
    const doc = JSON.stringify(requirementRevisionSchema.parse(revision));
    this.storage.sql.exec("INSERT INTO requirement_decision_revisions VALUES(?,?,?) ON CONFLICT(decision_id,task_id) DO UPDATE SET doc=excluded.doc", revision.decisionId, revision.taskId, doc);
  }
  views(decisionIds: readonly string[]): RequirementDecisionView[] {
    return decisionIds.map((decisionId) => ({ decisionId, proof: this.proof(decisionId), revisions: this.revisions(decisionId) }));
  }
}

export interface ProofSourceSide {
  taskId: string;
  commit: string;
  workspaceRepoName: string;
  branch: string;
  requirement: Requirement;
}
export type ProofSources =
  | { decisionId: string; status: "ready"; input: Record<string, unknown>; probe: RequirementProbe; sides: [ProofSourceSide, ProofSourceSide] }
  | { decisionId: string; status: "recorded"; proof: ContradictionProof }
  | { decisionId: string; status: "unavailable"; reason: string };

function requirementOwner(decision: ProductDecision, state: FlareGitProjectState, requirementId: string): { task: Pick<Task, "id" | "currentCommit" | "workspace">; requirement: Requirement } | null {
  const participant = decision.scope?.participants.find((row) => row.conflictingRequirements.some((requirement) => requirement.id === requirementId));
  if (participant) {
    const requirement = participant.conflictingRequirements.find((value) => value.id === requirementId)!;
    return { task: { id: participant.taskId, currentCommit: participant.currentCommit, workspace: { repoName: participant.workspaceRepoName, branch: participant.workspaceBranch, remote: "" } }, requirement };
  }
  for (const task of Object.values(state.tasks)) {
    const requirement = task.requirements.find((value) => value.id === requirementId);
    if (requirement) return { task, requirement };
  }
  return null;
}

/** Inputs for an executed proof, frozen from the decision's own participants (never later checkpoints). */
export function decisionProofSources(ledger: RequirementDecisionLedger, state: FlareGitProjectState, decisionId: string): ProofSources {
  const recorded = ledger.proof(decisionId);
  if (recorded) return { decisionId, status: "recorded", proof: recorded };
  const decision = state.decisions[decisionId];
  if (!decision) return { decisionId, status: "unavailable", reason: "Unknown decision" };
  const [idA, idB] = decision.conflictingRequirementIds;
  const a = requirementOwner(decision, state, idA), b = requirementOwner(decision, state, idB);
  if (!a || !b) return { decisionId, status: "unavailable", reason: "The conflicting requirements are no longer attached to changes" };
  const plan = contradictionProofPlan(a.requirement, b.requirement);
  if (!plan) return { decisionId, status: "unavailable", reason: "The requirements do not name code that can be run on the disputed input" };
  if (!a.task.currentCommit || !b.task.currentCommit || !SHA.test(a.task.currentCommit) || !SHA.test(b.task.currentCommit)) return { decisionId, status: "unavailable", reason: "Both changes need a saved commit before their code can be run" };
  const side = (owner: NonNullable<typeof a>): ProofSourceSide => ({ taskId: owner.task.id, commit: owner.task.currentCommit!, workspaceRepoName: owner.task.workspace.repoName, branch: owner.task.workspace.branch, requirement: owner.requirement });
  return { decisionId, status: "ready", input: plan.input, probe: plan.probe, sides: [side(a), side(b)] };
}

/** Accepts only a proof that matches the decision's frozen sources, then stores it once. */
export function recordDecisionProof(ledger: RequirementDecisionLedger, state: FlareGitProjectState, raw: unknown): ContradictionProof {
  const proof = contradictionProofSchema.parse(raw);
  const sources = decisionProofSources(ledger, state, proof.decisionId);
  if (sources.status === "recorded") return sources.proof;
  if (sources.status !== "ready") throw new Error(sources.reason);
  if (JSON.stringify(sources.input) !== JSON.stringify(proof.input) || JSON.stringify(sources.probe) !== JSON.stringify(proof.probe)) throw new Error("Proof input differs from the disputed input");
  sources.sides.forEach((side, index) => {
    const recorded = proof.sides[index]!;
    if (recorded.taskId !== side.taskId || recorded.commit !== side.commit || recorded.requirementId !== side.requirement.id) throw new Error("Proof does not match the decision's changes");
  });
  return ledger.recordProof(proof);
}



/**
 * Fetches each side's exact commit into a platform container and runs the probe there. Credentials are
 * only in the environment of the fetch; the probed code runs under the isolated supervisor (probe-cli.ts).
 */
export async function executeContradictionProof(runtime: CoordinationRuntime, sources: Extract<ProofSources, { status: "ready" }>, now = () => new Date()): Promise<ContradictionProof> {
  const shell = await runtime.shell("requirement-proof");
  try {
    const executed: ExecutedSide[] = [];
    for (const [index, side] of sources.sides.entries()) {
      const dir = `${runtime.workDir}/requirement-proof-${index}`;
      let outcome: ProbeOutcome;
      const credential = await runtime.credential(side.workspaceRepoName, "read");
      let fetched;
      try {
        fetched = await shell.exec(`rm -rf ${q(dir)} && git init --quiet ${q(dir)} && git -C ${q(dir)} fetch --quiet ${q(credential.remote)} ${q(`+refs/heads/${side.branch}:refs/flaregit/proof`)}`, gitAuthEnv(credential.token));
      } finally {
        await credential.close();
      }
      if (!fetched.success) outcome = { ok: false, error: "The change's saved branch could not be read" };
      else if (!(await shell.exec(`git -C ${q(dir)} cat-file -e ${q(`${side.commit}^{commit}`)}`)).success) outcome = { ok: false, error: "The exact commit recorded with the decision is no longer on the change's branch" };
      else {
        // The platform supervisor snapshots the commit and runs it under the verification execution boundary.
        const request = JSON.stringify({ probe: sources.probe, input: sources.input });
        const run = await shell.exec(`cd ${q(runtime.platformDir)} && bun src/core/decision/probe-cli.ts ${q(dir)} ${q(side.commit)} ${q(request)}`);
        outcome = run.success ? parseProbeOutput(run.stdout) : { ok: false, error: "The isolated runner could not start" };
      }
      executed.push({ taskId: side.taskId, commit: side.commit, requirement: side.requirement, outcome });
    }
    const plan = contradictionProofPlan(sources.sides[0].requirement, sources.sides[1].requirement);
    if (!plan) throw new Error("Proof plan changed during execution");
    return evaluateContradictionProof(sources.decisionId, plan, executed as [ExecutedSide, ExecutedSide], now());
  } finally {
    await shell.close();
  }
}

export interface ProofLedgerPort {
  requirementDecisionSources(decisionId: string): Promise<ProofSources>;
  recordRequirementProof(proof: ContradictionProof): Promise<ContradictionProof>;
}

/** Workflow step body: idempotent, so a replayed step returns the stored proof without running code again. */
export async function proveRecordedContradiction(runtime: CoordinationRuntime, ledger: ProofLedgerPort, decisionId: string): Promise<{ verdict: ContradictionProof["verdict"] | "unavailable"; summary: string }> {
  const sources = await ledger.requirementDecisionSources(decisionId);
  if (sources.status === "recorded") return { verdict: sources.proof.verdict, summary: sources.proof.summary };
  if (sources.status === "unavailable") return { verdict: "unavailable", summary: sources.reason };
  const proof = await ledger.recordRequirementProof(await executeContradictionProof(runtime, sources));
  return { verdict: proof.verdict, summary: proof.summary };
}

async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stable agent workflow identity for one decision's revision of one change. */
export async function revisionWorkflowId(projectId: string, decisionId: string, taskId: string): Promise<string> {
  return `rev-${projectId}-${(await digest(`${decisionId}\n${taskId}`)).slice(0, 32)}`;
}

/**
 * After a resolved decision: every change that carried the losing requirement gets the winning requirement
 * attached (approved, so the agent prompt and verification include it). Agent changes are planned for a
 * re-run; human changes are flagged for their author. Calling it again returns the saved plan unchanged.
 */
export function planLosingRevisions(ledger: RequirementDecisionLedger, state: FlareGitProjectState, decisionId: string, workflowIds: Record<string, string>, now = new Date()): RequirementRevision[] {
  const decision = state.decisions[decisionId];
  if (!decision || decision.status !== "resolved" || !decision.selectedOptionId) throw new Error("This decision has not been resolved");
  const winnerId = decision.selectedOptionId, loserId = decision.conflictingRequirementIds.find((id) => id !== winnerId)!;
  const winner = Object.values(state.tasks).flatMap((task) => task.requirements).find((requirement) => requirement.id === winnerId) ?? decision.scope?.conflictingRequirements.find((requirement) => requirement.id === winnerId);
  if (!winner) throw new Error("The winning requirement is unavailable");
  const losers = (decision.resolvedTaskIds ?? []).map((id) => state.tasks[id]).filter((task): task is Task => Boolean(task && task.requirements.some((requirement) => requirement.id === loserId)));
  const planned: RequirementRevision[] = [];
  for (const task of losers) {
    const saved = ledger.revision(decisionId, task.id);
    if (saved) { planned.push(saved); continue; }
    if (!task.requirements.some((requirement) => requirement.id === winner.id)) task.requirements.push({ ...structuredClone(winner), status: "approved" });
    const workflowId = workflowIds[task.id];
    if (!workflowId) throw new Error("Revision workflow identity is unavailable");
    const agent = task.contributor.type === "agent" || Boolean(task.agentWorkflowInstanceId);
    const revision: RequirementRevision = {
      decisionId, taskId: task.id, winningRequirementId: winner.id, losingRequirementId: loserId, startCommit: task.currentCommit, workflowId,
      status: agent && !["accepted", "cancelled"].includes(task.status) ? "planned" : "needs_author",
      ...(agent ? {} : { reason: `"${winner.title}" was chosen. The author needs to update this change to match it.` }),
      updatedAt: now.toISOString(),
    };
    ledger.saveRevision(revision);
    planned.push(revision);
  }
  return planned;
}

/** A dispatched revision is complete once its change has new ready work. */
export function settleRevisions(ledger: RequirementDecisionLedger, state: FlareGitProjectState, now = new Date()): void {
  for (const decision of Object.values(state.decisions)) {
    if (decision.status !== "resolved") continue;
    for (const revision of ledger.revisions(decision.id)) {
      const task = state.tasks[revision.taskId];
      if (revision.status !== "dispatched" || !task || task.status !== "ready" || task.currentCommit === revision.startCommit) continue;
      ledger.saveRevision({ ...revision, status: "revised", reason: undefined, updatedAt: now.toISOString() });
    }
  }
}
