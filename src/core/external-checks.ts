/** Provider-neutral evidence. Caller authorization belongs to the API; provider identity is authenticated separately from report contents. */
export type ExternalCheckStatus = "queued" | "running" | "passed" | "failed" | "cancelled";
export interface ExternalCheckDefinition { id: string; providerId: string; required: boolean }
export interface ExternalCheckPolicy { version: number; mode: "augment" | "external"; checks: ExternalCheckDefinition[] }
export interface FrozenExternalChecks {
  repositoryId: string; candidateId: string; commit: string; tree: string;
  policy: ExternalCheckPolicy;
}
export interface ExternalCheckRun { id: string; checkId: string; sequence: number; status: ExternalCheckStatus }
export interface ExternalCheckReport {
  eventId: string; runId: string; checkId: string; providerId: string;
  repositoryId: string; candidateId: string; commit: string; tree: string;
  policyVersion: number; sequence: number; status: ExternalCheckStatus;
}
export interface ExternalCheckState {
  frozen: FrozenExternalChecks;
  runs: Record<string, ExternalCheckRun>;
  selectedRuns: Record<string, string>;
  receipts: Record<string, ExternalCheckReport>;
}
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
function validId(value: string): boolean { return typeof value === "string" && identifier.test(value); }
function terminal(status: ExternalCheckStatus): boolean { return ["passed", "failed", "cancelled"].includes(status); }

/** Freeze owner-configured requirements. External mode replaces customer CI, never native Git integrity or human review. */
export function freezeExternalChecks(input: FrozenExternalChecks, registeredProviders: readonly string[]): ExternalCheckState {
  if (![input.repositoryId, input.candidateId].every(validId) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.commit) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.tree)) throw new Error("Invalid candidate identity");
  if (!Number.isSafeInteger(input.policy.version) || input.policy.version < 1 || !["augment", "external"].includes(input.policy.mode) || input.policy.checks.length > 100) throw new Error("Invalid external check policy");
  const ids = new Set<string>();
  for (const check of input.policy.checks) {
    if (!validId(check.id) || !validId(check.providerId) || typeof check.required !== "boolean" || ids.has(check.id) || !registeredProviders.includes(check.providerId)) throw new Error("Invalid or unregistered check provider");
    ids.add(check.id);
  }
  if (input.policy.mode === "external" && !input.policy.checks.some((check) => check.required)) throw new Error("External CI mode requires a required check");
  return { frozen: structuredClone(input), runs: {}, selectedRuns: {}, receipts: {} };
}

/** Authorized dispatch/retry selects a run explicitly; reports cannot register or select arbitrary runs. */
export function registerExternalCheckRun(state: ExternalCheckState, checkId: string, runId: string): ExternalCheckState {
  if (!validId(runId) || !state.frozen.policy.checks.some((check) => check.id === checkId)) throw new Error("Unknown check or invalid run");
  const existing = Object.hasOwn(state.runs, runId) ? state.runs[runId] : undefined;
  if (existing) {
    if (existing.checkId !== checkId) throw new Error("Run identity already belongs to another check");
    return state;
  }
  return { ...state, runs: { ...state.runs, [runId]: { id: runId, checkId, sequence: -1, status: "queued" } }, selectedRuns: { ...state.selectedRuns, [checkId]: runId } };
}

export type ReportResult = { kind: "applied" | "duplicate"; state: ExternalCheckState } | { kind: "rejected"; reason: string; state: ExternalCheckState };
export function applyExternalCheckReport(state: ExternalCheckState, report: ExternalCheckReport, authenticatedProviderId: string): ReportResult {
  const reject = (reason: string): ReportResult => ({ kind: "rejected", reason, state });
  const frozen = state.frozen;
  const check = frozen.policy.checks.find((item) => item.id === report.checkId);
  if (!check || authenticatedProviderId !== check.providerId || report.providerId !== authenticatedProviderId) return reject("Provider is not registered for this check");
  if (report.repositoryId !== frozen.repositoryId || report.candidateId !== frozen.candidateId || report.commit !== frozen.commit || report.tree !== frozen.tree || report.policyVersion !== frozen.policy.version) return reject("Report does not match the frozen candidate and policy");
  if (!validId(report.eventId) || !validId(report.runId) || !Number.isSafeInteger(report.sequence) || report.sequence < 0 || !["queued", "running", "passed", "failed", "cancelled"].includes(report.status)) return reject("Invalid report");
  const previous = Object.hasOwn(state.receipts, report.eventId) ? state.receipts[report.eventId] : undefined;
  if (previous) {
    const same = (Object.keys(previous) as Array<keyof ExternalCheckReport>).every((key) => previous[key] === report[key]);
    return same ? { kind: "duplicate", state } : reject("Event identity reused with different contents");
  }
  const run = Object.hasOwn(state.runs, report.runId) ? state.runs[report.runId] : undefined;
  if (!run || run.checkId !== check.id || state.selectedRuns[check.id] !== run.id) return reject("Report belongs to an unknown or superseded run");
  if (report.sequence <= run.sequence || terminal(run.status)) return reject("Report is stale or the run already finished");
  if (run.status === "running" && report.status === "queued") return reject("Run cannot return to queued");
  return { kind: "applied", state: { ...state, runs: { ...state.runs, [run.id]: { ...run, sequence: report.sequence, status: report.status } }, receipts: { ...state.receipts, [report.eventId]: structuredClone(report) } } };
}

/** Only required checks gate acceptance. Browsing/review consumes visible statuses independently. */
export function externalCheckGate(state: ExternalCheckState): "passed" | "pending" | "failed" {
  const statuses = state.frozen.policy.checks.filter((check) => check.required).map((check) => state.runs[state.selectedRuns[check.id] ?? ""]?.status ?? "queued");
  if (statuses.some((status) => status === "failed" || status === "cancelled")) return "failed";
  return statuses.every((status) => status === "passed") ? "passed" : "pending";
}
