import { expect, test } from "bun:test";
import { acceptanceStateSchema, requireAcceptedCommit } from "../src/cli/acceptance";
const empty = { tasks: {}, candidates: {}, evidence: {}, decisions: {} };
test("unborn repository can be observed but cannot produce accepted Git proof", () => {
  const state = acceptanceStateSchema.parse({ ...empty, acceptedState: { kind: "unborn", currentCommit: null } });
  expect(state.acceptedState.currentCommit).toBeNull();
  expect(() => requireAcceptedCommit(state)).toThrow("no accepted commit");
  expect(acceptanceStateSchema.safeParse({ ...empty, acceptedState: { currentCommit: null } }).success).toBe(false);
});
test("legacy committed acceptance remains supported", () => {
  const commit = "a".repeat(40);
  expect(requireAcceptedCommit(acceptanceStateSchema.parse({ ...empty, acceptedState: { currentCommit: commit } }))).toBe(commit);
});
test("null candidate base requires recorded unborn target and checkpoint remains a real hash", () => {
  const candidate = { status: "verified", candidateCommit: "b".repeat(40), expectedAcceptedBase: null, repairAttempts: [] };
  const input = { ...empty, acceptedState: { kind: "unborn", currentCommit: null }, candidates: { c: candidate } };
  expect(acceptanceStateSchema.safeParse(input).success).toBe(false);
  const acceptedTarget = { kind: "unborn", acceptedCommit: null, acceptedVersion: 0, requirements: [] };
  expect(acceptanceStateSchema.safeParse({ ...input, candidates: { c: { ...candidate, acceptedTarget } } }).success).toBe(true);
  expect(acceptanceStateSchema.safeParse({ ...input, candidates: { c: { ...candidate, acceptedTarget, candidateCommit: null } } }).success).toBe(false);
});
