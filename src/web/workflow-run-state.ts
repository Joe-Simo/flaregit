export const WORKFLOW_STATUS_LABELS = { queued: "Queued", running: "Running", waiting: "Waiting", waitingForPause: "Pause pending", paused: "Paused", complete: "Completed", errored: "Failed", terminated: "Terminated", unknown: "Unknown" } as const;
export type WorkflowStatus = keyof typeof WORKFLOW_STATUS_LABELS;
export interface WorkflowObservation { instanceId: string; kind: "agent" | "integration" | "scenario"; status: WorkflowStatus; action: "status" | "pause" | "resume"; changed: boolean }
export type WorkflowRunAction = WorkflowObservation["action"];
function isWorkflowStatus(value: unknown): value is WorkflowStatus { return typeof value === "string" && Object.hasOwn(WORKFLOW_STATUS_LABELS, value); }
export function checkedWorkflowObservation(value: unknown, instanceId: string, kind: WorkflowObservation["kind"]): WorkflowObservation {
  if (typeof value !== "object" || value === null || !("instanceId" in value) || !("kind" in value) || !("status" in value) || !("action" in value) || !("changed" in value) || typeof value.instanceId !== "string" || !isWorkflowStatus(value.status) || (value.kind !== "agent" && value.kind !== "integration" && value.kind !== "scenario") || (value.action !== "status" && value.action !== "pause" && value.action !== "resume") || typeof value.changed !== "boolean") throw new Error("Run status could not be verified.");
  if (value.instanceId !== instanceId || value.kind !== kind) throw new Error("Run identity changed. Refresh the exact saved workflow before continuing.");
  return { instanceId: value.instanceId, kind: value.kind, status: value.status, action: value.action, changed: value.changed };
}
export function availableWorkflowAction(status: WorkflowStatus | undefined): "pause" | "resume" | null {
  if (status === "paused") return "resume";
  return status && ["running", "waiting", "queued"].includes(status) ? "pause" : null;
}

export type SavedWorkflowDecision = { candidateId: string; workflowInstanceId: string; expectedCommit: string; approved: boolean; note?: string };
export function savedWorkflowDecision(candidate: Pick<import("@/core/types").CandidateGeneration, "id" | "status" | "workflowInstanceId" | "candidateCommit" | "review" | "preservationProtocolVersion">, journaled: boolean): SavedWorkflowDecision | null {
  const review = candidate.review;
  if (journaled || !candidate.workflowInstanceId || !review || !["verified", "failed"].includes(candidate.status) || review.commit !== candidate.candidateCommit || !/^[a-f0-9]{40}$/.test(review.commit) || (review.approved && candidate.preservationProtocolVersion !== 1)) return null;
  return { candidateId: candidate.id, workflowInstanceId: candidate.workflowInstanceId, expectedCommit: review.commit, approved: review.approved, ...(review.note !== undefined ? { note: review.note } : {}) };
}

/** One latest candidate context per recorded workflow; this is not provider inventory. */
export function recordedWorkflowCandidates<T extends { id: string; workflowInstanceId?: string; updatedAt: string; attemptNumber: number; status: string }>(candidates: Iterable<T>): T[] {
  const runs = new Map<string, T>();
  for (const candidate of candidates) {
    if (!candidate.workflowInstanceId) continue;
    const previous = runs.get(candidate.workflowInstanceId);
    if (!previous || candidate.updatedAt > previous.updatedAt || (candidate.updatedAt === previous.updatedAt && candidate.attemptNumber > previous.attemptNumber)) runs.set(candidate.workflowInstanceId, candidate);
  }
  return [...runs.values()].filter(candidate => candidate.status !== "accepted").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.attemptNumber - a.attemptNumber || a.id.localeCompare(b.id));
}
