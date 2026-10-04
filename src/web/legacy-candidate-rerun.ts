import { apiJson } from "./api";
export interface LegacyRerunOperation { id: string; phase: "prepared" | "stopped" | "reassigned" | "attached" | "abandoned" | "awaiting_decision"; dispatch?: "not_started" | "unknown" | "observed"; successorWorkflowId: string; successorCandidateId?: string; successorDecisionId?: string }
export interface LegacyInputObservation {taskId:string;expectedCommit:string;ref:string;observedCommit:string|null;namedBranchObservedCommit:string|null;expectedObjectAvailable:boolean|null;status:'observed'|'unavailable'}
export interface LegacyInputObservations {status:'observed'|'unavailable';checkedAt:string;rows:LegacyInputObservation[]}
export interface LegacyRerunReport { candidateId: string; expectedCommit: string | null; inputs: Record<string, { commit: string; base: string }>; eligible: boolean; detail: string; inputObservations?:LegacyInputObservations|null; operation?: LegacyRerunOperation }
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

/** Diagnostic branch reads never replace the saved mutation input or request identity. */
export function checkedLegacyInputObservations(report:LegacyRerunReport):LegacyInputObservations|null{
 const value=report.inputObservations;if(value===undefined||value===null)return null;
 if(!value||!['observed','unavailable'].includes(value.status)||!Number.isFinite(Date.parse(value.checkedAt))||!Array.isArray(value.rows)||value.rows.length>8)throw Error('Saved input observations were not confirmed.');
 const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
 const seen=new Set<string>();
 if(!(value.status==='unavailable'&&value.rows.length===0)&&value.rows.length!==Object.keys(report.inputs).length)throw Error('Saved input observations are incomplete.');
 for(const row of value.rows){if(!row||seen.has(row.taskId)||report.inputs[row.taskId]?.commit!==row.expectedCommit||!sha(row.expectedCommit)||typeof row.ref!=='string'||!row.ref.startsWith('refs/heads/')||/[\\\x00-\x20\x7f]/.test(row.ref)||(row.observedCommit!==null&&!sha(row.observedCommit))||(row.namedBranchObservedCommit!==null&&!sha(row.namedBranchObservedCommit))||![true,false,null].includes(row.expectedObjectAvailable)||!['observed','unavailable'].includes(row.status))throw Error('Saved input observation identity changed.');seen.add(row.taskId);}
 if(value.status==='observed'&&value.rows.some(row=>row.status!=='observed'))throw Error('Saved input observations are incomplete.');
 return value;
}
