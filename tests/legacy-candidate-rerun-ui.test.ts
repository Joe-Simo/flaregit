import { afterEach, expect, test } from "bun:test";
import { abandonLegacyRerun, legacyRerunDraft, requestLegacyRerun, type LegacyRerunReport } from "../src/web/legacy-candidate-rerun";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const report: LegacyRerunReport = { candidateId: "old", expectedCommit: "a".repeat(40), inputs: { task: { commit: "b".repeat(40), base: "c".repeat(40) } }, eligible: true, detail: "Eligible" };
test("lost acknowledgements reuse exact frozen input request; persisted operation resumes after refresh", async () => {
  const draft = legacyRerunDraft(null, "repository", report);
  globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toEqual({ expectedCommit: report.expectedCommit, expectedInputs: report.inputs, requestId: draft.requestId });
    throw new Error("lost acknowledgement");
  }, { preconnect: originalFetch.preconnect });
  await expect(requestLegacyRerun("repository", "old", draft)).rejects.toThrow("lost acknowledgement");
  expect(legacyRerunDraft(draft, "repository", report)).toBe(draft);
  expect(legacyRerunDraft(null, "repository", { ...report, operation: { id: draft.requestId, phase: "prepared", successorWorkflowId: "saved" } }).requestId).toBe(draft.requestId);
  expect(legacyRerunDraft(draft, "different-repository", report).requestId).not.toBe(draft.requestId);
  expect(legacyRerunDraft(draft, "repository", { ...report, inputs: { task: { ...report.inputs.task!, base: "d".repeat(40) } } }).requestId).not.toBe(draft.requestId);
  expect(draft.expectedInputs).toEqual(report.inputs);
});

test("abandonment sends explicit confirmation and abandoned identity cannot become a new intent", async () => {
  const draft = legacyRerunDraft(null, "repository", report);
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    expect(url).toBe("/api/p/repository/candidates/old/rerun/abandon");
    expect(JSON.parse(String(init?.body))).toEqual({ requestId: draft.requestId, confirm: "abandon pending rerun" });
    return Response.json({ id: draft.requestId, phase: "abandoned", dispatch: "not_started" });
  }, { preconnect: originalFetch.preconnect });
  expect(await abandonLegacyRerun("repository", "old", draft.requestId)).toMatchObject({ phase: "abandoned" });
  expect(legacyRerunDraft(draft, "repository", { ...report, operation: { id: draft.requestId, phase: "abandoned", dispatch: "not_started", successorWorkflowId: "old" } }).requestId).not.toBe(draft.requestId);
});
test("incomplete candidate rebuild retains null SHA without inventing a commit", async () => {
  const incomplete = { ...report, expectedCommit: null };
  const draft = legacyRerunDraft(null, "repository", incomplete);
  expect(draft.expectedCommit).toBeNull();
  globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.expectedCommit).toBeNull();
    expect(body.expectedInputs).toEqual(report.inputs);
    return Response.json({ id: draft.requestId, phase: "prepared", dispatch: "not_started", successorWorkflowId: "saved" }, { status: 202 });
  }, { preconnect: originalFetch.preconnect });
  await requestLegacyRerun("repository", "old", draft);
});
