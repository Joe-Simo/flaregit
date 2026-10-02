import { expect, test } from "bun:test";
import { applyExternalCheckReport, externalCheckGate, freezeExternalChecks, registerExternalCheckRun, type ExternalCheckReport } from "../src/core/external-checks.js";

const fixture = () => registerExternalCheckRun(freezeExternalChecks({ repositoryId: "repo", candidateId: "candidate", commit: "a".repeat(40), tree: "b".repeat(40), policy: { version: 2, mode: "external", checks: [{ id: "tests", providerId: "ci", required: true }, { id: "review", providerId: "reviewer", required: false }] } }, ["ci", "reviewer"]), "tests", "run-1");
const report = (patch: Partial<ExternalCheckReport> = {}): ExternalCheckReport => ({ eventId: "event-1", runId: "run-1", checkId: "tests", providerId: "ci", repositoryId: "repo", candidateId: "candidate", commit: "a".repeat(40), tree: "b".repeat(40), policyVersion: 2, sequence: 0, status: "passed", ...patch });

test("frozen configuration rejects unregistered providers and cannot change through caller mutation", () => {
  const original = { repositoryId: "repo", candidateId: "candidate", commit: "a".repeat(40), tree: "b".repeat(40), policy: { version: 1, mode: "augment" as const, checks: [{ id: "tests", providerId: "ci", required: true }] } };
  expect(() => freezeExternalChecks(original, [])).toThrow("unregistered");
  const frozen = freezeExternalChecks(original, ["ci"]);
  original.policy.checks[0]!.required = false;
  expect(frozen.frozen.policy.checks[0]!.required).toBe(true);
});
test("required evidence gates acceptance while optional failure stays visible without blocking", () => {
  const initial = fixture();
  expect(externalCheckGate(initial)).toBe("pending");
  const passed = applyExternalCheckReport(initial, report(), "ci");
  expect(passed.kind).toBe("applied");
  const review = registerExternalCheckRun(passed.state, "review", "review-run");
  const failedOptional = applyExternalCheckReport(review, report({ eventId: "review-event", runId: "review-run", checkId: "review", providerId: "reviewer", status: "failed" }), "reviewer");
  expect(failedOptional.state.runs["review-run"]!.status).toBe("failed");
  expect(externalCheckGate(failedOptional.state)).toBe("passed");
});
test("duplicate receipts are identifiable and altered duplicate events refused", () => {
  const first = applyExternalCheckReport(fixture(), report(), "ci");
  expect(applyExternalCheckReport(first.state, report(), "ci").kind).toBe("duplicate");
  expect(applyExternalCheckReport(first.state, report({ status: "failed" }), "ci").kind).toBe("rejected");
  expect(externalCheckGate(first.state)).toBe("passed");
});
test("cross-repository, stale policy/tree/commit and impersonation reports preserve state", () => {
  const initial = fixture();
  for (const patch of [{ repositoryId: "other" }, { candidateId: "other" }, { commit: "c".repeat(40) }, { tree: "c".repeat(40) }, { policyVersion: 1 }, { providerId: "impostor" }]) {
    const result = applyExternalCheckReport(initial, report(patch), "ci");
    expect(result.kind).toBe("rejected"); expect(result.state).toBe(initial);
  }
  expect(applyExternalCheckReport(initial, report(), "impostor").kind).toBe("rejected");
});
test("registered retry makes checks pending and late previous run reports cannot overwrite it", () => {
  const failed = applyExternalCheckReport(fixture(), report({ status: "failed" }), "ci").state;
  expect(externalCheckGate(failed)).toBe("failed");
  const retry = registerExternalCheckRun(failed, "tests", "run-2");
  expect(externalCheckGate(retry)).toBe("pending");
  expect(applyExternalCheckReport(retry, report({ eventId: "late", sequence: 1 }), "ci").kind).toBe("rejected");
  const saved = applyExternalCheckReport(retry, report({ eventId: "retry", runId: "run-2" }), "ci");
  expect(externalCheckGate(saved.state)).toBe("passed");
  expect(saved.state.runs["run-1"]!.status).toBe("failed");
});
test("out-of-order reports and inherited object names cannot forge receipts", () => {
  const running = applyExternalCheckReport(fixture(), report({ sequence: 2, status: "running" }), "ci").state;
  expect(applyExternalCheckReport(running, report({ eventId: "old", sequence: 1 }), "ci").kind).toBe("rejected");
  expect(applyExternalCheckReport(fixture(), report({ eventId: "constructor" }), "ci").kind).toBe("applied");
  expect(applyExternalCheckReport(fixture(), report({ runId: "constructor" }), "ci").kind).toBe("rejected");
});
