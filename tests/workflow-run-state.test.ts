import { expect, test } from "bun:test";
import { availableWorkflowAction, checkedWorkflowObservation, WORKFLOW_STATUS_LABELS } from "../src/web/workflow-run-state";
test("a workflow observation is valid only for the exact saved repository run and kind", () => {
 const reply = { instanceId: "registered-integration", kind: "integration", status: "waitingForPause", action: "pause", changed: true };
 expect(checkedWorkflowObservation(reply, "registered-integration", "integration").status).toBe("waitingForPause");
 expect(() => checkedWorkflowObservation(reply, "different-run", "integration")).toThrow("identity changed");
 expect(() => checkedWorkflowObservation(reply, "registered-integration", "agent")).toThrow("identity changed");
 for (const bad of [{ ...reply, status: "resumed" }, { ...reply, changed: "true" }, { ...reply, action: "terminate" }, { instanceId: reply.instanceId }]) expect(() => checkedWorkflowObservation(bad, reply.instanceId, "integration")).toThrow();
});
test("pause pending never grants resume and terminal or unknown observations cannot dispatch transitions", () => {
 expect(WORKFLOW_STATUS_LABELS.waitingForPause).toBe("Pause pending");
 expect(WORKFLOW_STATUS_LABELS.paused).toBe("Paused");
 expect(availableWorkflowAction("waitingForPause")).toBeNull();
 expect(availableWorkflowAction("paused")).toBe("resume");
 for (const status of ["running", "waiting", "queued"] as const) expect(availableWorkflowAction(status)).toBe("pause");
 for (const status of ["complete", "errored", "terminated", "unknown", undefined] as const) expect(availableWorkflowAction(status)).toBeNull();
});

test("saved decision recovery preserves the exact rejection or approval and excludes changed/journaled candidates", async () => {
 const { savedWorkflowDecision } = await import("../src/web/workflow-run-state");
 const commit = "a".repeat(40);
 const candidate = { id: "candidate-1", status: "failed" as const, workflowInstanceId: "saved-run", candidateCommit: commit, preservationProtocolVersion: 1 as const, review: { approved: false, by: "Original reviewer", at: "2026-10-03T00:00:00Z", note: "Keep this exact rejection note", commit } };
 expect(savedWorkflowDecision(candidate, false)).toEqual({ candidateId: candidate.id, workflowInstanceId: "saved-run", expectedCommit: commit, approved: false, note: candidate.review.note });
 expect(savedWorkflowDecision({ ...candidate, status: "verified", review: { ...candidate.review, approved: true } }, false)?.approved).toBe(true);
 expect(savedWorkflowDecision(candidate, true)).toBeNull();
 expect(savedWorkflowDecision({ ...candidate, candidateCommit: "b".repeat(40) }, false)).toBeNull();
 expect(savedWorkflowDecision({ ...candidate, status: "accepted" }, false)).toBeNull();
 expect(savedWorkflowDecision({ ...candidate, review: undefined }, false)).toBeNull();
 expect(savedWorkflowDecision({ ...candidate, workflowInstanceId: undefined }, false)).toBeNull();
 expect(savedWorkflowDecision({ ...candidate, preservationProtocolVersion: undefined, review: { ...candidate.review, approved: true } }, false)).toBeNull();
});


test("recorded run discovery deduplicates latest context and retains older paused or failed recovery access", async () => {
 const { recordedWorkflowCandidates } = await import("../src/web/workflow-run-state");
 const old = { id: "old-paused-context", workflowInstanceId: "same-run", updatedAt: "2026-01-01", attemptNumber: 1, status: "verifying" };
 const recent = { ...old, id: "newer-context", updatedAt: "2026-10-03", attemptNumber: 2, status: "failed" };
 const historical = Array.from({ length: 25 }, (_, index) => ({ ...old, id: `old-${index}`, workflowInstanceId: `old-run-${index}` }));
 const result = recordedWorkflowCandidates([old, recent, ...historical, { ...old, id: "unregistered", workflowInstanceId: undefined }]);
 expect(result.length).toBe(26); expect(result[0]?.id).toBe(recent.id); expect(result.filter(candidate => candidate.workflowInstanceId === "same-run").length).toBe(1);
 expect(result.slice(0, 10).length).toBe(10); expect([...result.slice(0, 10), ...result.slice(10)].map(candidate => candidate.id)).toEqual(result.map(candidate => candidate.id));
 expect(recordedWorkflowCandidates([old, { ...recent, status: "accepted" }])).toEqual([]);
});


test("saved approval and rejection summaries do not claim accepted history or running verification", async () => {
 const { summarizeIntegration } = await import("../src/web/integration-summary");
 const commit = "a".repeat(40);
 const candidate = { id: "candidate", attemptNumber: 1, participatingTaskIds: [], participatingCommits: {}, expectedAcceptedBase: "b".repeat(40), frozenPolicyVersion: 1, frozenVerificationPolicy: {}, frozenRequirements: [], repairAttempts: [], status: "verified" as const, candidateCommit: commit, workflowInstanceId: "saved-run", createdAt: "2026-10-03", updatedAt: "2026-10-03", review: { approved: true, by: "Synthetic reviewer", commit, at: "2026-10-03" } };
 const state = { projectId: "synthetic", projectName: "Synthetic", canonicalRepoName: "synthetic", acceptedState: { currentCommit: "b".repeat(40), acceptedAt: "2026-01-01", buildDigest: "synthetic", activeRequirements: [], history: [] }, tasks: {}, candidates: { candidate }, evidence: {}, decisions: {}, journal: [], policyVersion: 1, verificationPolicy: {} };
 expect(summarizeIntegration(state)).toMatchObject({ stage: "review_saved", message: "Approval saved; integration pending" });
 expect(summarizeIntegration({ ...state, candidates: { candidate: { ...candidate, status: "failed", review: { ...candidate.review, approved: false } } } })).toMatchObject({ stage: "review_saved", message: "Rejection saved" });
 expect(summarizeIntegration({ ...state, candidates: { candidate: { ...candidate, status: "failed", review: undefined } } })).toMatchObject({ stage: "blocked", message: "Integration failed" });
 expect(summarizeIntegration({ ...state, candidates: { candidate: { ...candidate, status: "accepted" } } }).stage).toBe("accepted");
});
