import { apiJson } from "./api";
export interface LegacyRerunOperation { id: string; phase: "prepared" | "stopped" | "reassigned" | "attached" | "abandoned" | "awaiting_decision"; dispatch?: "not_started" | "unknown" | "observed"; successorWorkflowId: string; successorCandidateId?: string; successorDecisionId?: string }
export interface LegacyRerunReport { candidateId: string; expectedCommit: string | null; inputs: Record<string, { commit: string; base: string }>; eligible: boolean; detail: string; operation?: LegacyRerunOperation }
export interface LegacyRerunDraft { scope: string; expectedCommit: string | null; expectedInputs: LegacyRerunReport["inputs"]; requestId: string }
export function legacyRerunDraft(previous: LegacyRerunDraft | null, projectId: string, report: LegacyRerunReport): LegacyRerunDraft {
  const inputs = Object.fromEntries(Object.entries(report.inputs).sort(([a], [b]) => a.localeCompare(b)));
  const scope = JSON.stringify([projectId, report.candidateId, report.expectedCommit, inputs]);
  if (previous?.scope === scope && report.operation?.phase !== "abandoned" && (!report.operation || previous.requestId === report.operation.id)) return previous;
  return { scope, expectedCommit: report.expectedCommit, expectedInputs: structuredClone(inputs), requestId: (report.operation?.phase !== "abandoned" ? report.operation?.id : undefined) ?? crypto.randomUUID() };
}
export function requestLegacyRerun(projectId: string, candidateId: string, draft: LegacyRerunDraft): Promise<LegacyRerunOperation> {
  return apiJson(`/p/${projectId}/candidates/${candidateId}/rerun`, { method: "POST", json: { expectedCommit: draft.expectedCommit, expectedInputs: draft.expectedInputs, requestId: draft.requestId }, signal: AbortSignal.timeout(30_000) });
}

export function abandonLegacyRerun(projectId: string, candidateId: string, requestId: string): Promise<Pick<LegacyRerunOperation, "id" | "phase" | "dispatch">> {
  return apiJson(`/p/${projectId}/candidates/${candidateId}/rerun/abandon`, { method: "POST", json: { requestId, confirm: "abandon pending rerun" }, signal: AbortSignal.timeout(30_000) });
}
