import { expect, test } from "bun:test";
import { selectAcceptedDeploymentJournal, confirmAcceptedDeploymentSelection, type AcceptedDeploymentContext } from "../src/server/accepted-deployment-selection";
import { RepositoryDeployments, type DeploymentRequestedEvent } from "../src/server/deployments";
import { Database } from "bun:sqlite";

const base = "a".repeat(40), commit = "b".repeat(40), tree = "c".repeat(40), later = "d".repeat(40);
const journalId = "jrnl_11111111-1111-4111-8111-111111111111", incarnation = "22222222-2222-4222-8222-222222222222";
function context(): AcceptedDeploymentContext {
  const target = { projectId: "p123456789abc", incarnation, canonicalRepoName: "owned", ref: "refs/heads/release", branch: "release", acceptedCommit: base, acceptedVersion: 0, requirements: [], policyVersion: 1, policy: {} };
  return { projectId: target.projectId, incarnation, canonicalRepoName: target.canonicalRepoName, primaryRef: "refs/heads/main", primaryHistory: [], journals: [{ id: journalId, candidateId: "candidate-owned", candidateCommit: commit, candidateTree: tree, expectedHead: base, newHead: commit, outputDigest: "digest", state: "ACCEPTED", timestamp: "2026-10-04T00:00:00Z", acceptedTarget: target }], roots: [{ projectId: target.projectId, incarnation, canonicalRepoName: target.canonicalRepoName, ref: target.ref, kind: "branch", head: later, version: 2, requirementsSnapshot: { commit: later, requirements: [] }, status: "ready", provenance: { kind: "owner-created", sourceCommit: base }, history: [{ commit, operationId: journalId, acceptance: { journalId, candidateId: "candidate-owned", evidenceId: "evidence", tree, outputDigest: "digest", participatingTaskIds: ["task"], acceptedAt: "2026-10-04T00:00:01Z" } }, { commit: later, operationId: "later-publication" }] }] };
}

test("nonprimary accepted journal selects its exact historical ref/root receipt after head advances", () => {
  const selection = selectAcceptedDeploymentJournal(context(), journalId);
  expect(selection?.target).toMatchObject({ commit, tree, acceptedRef: "refs/heads/release", acceptedRootVersion: 1, recoverableRef: `refs/flaregit/deployments/${journalId}` });
  expect(selection?.pinVerified).toBe(false); expect(selection?.target.commit).not.toBe(later);
});

test("scope drift, unaccepted journals and missing branch receipts never fall back to default", () => {
  const badScope = context(); badScope.roots = [{ ...badScope.roots[0]!, incarnation: crypto.randomUUID() }]; expect(selectAcceptedDeploymentJournal(badScope, journalId)).toBeNull();
  const missing = context(); missing.roots = []; expect(selectAcceptedDeploymentJournal(missing, journalId)).toBeNull();
  const unaccepted = context(); unaccepted.journals = [{ ...unaccepted.journals[0]!, state: "PREPARED" }]; expect(selectAcceptedDeploymentJournal(unaccepted, journalId)).toBeNull();
  const wrongTree = context(); wrongTree.roots = [{ ...wrongTree.roots[0]!, history: [{ ...wrongTree.roots[0]!.history[0]!, acceptance: { ...wrongTree.roots[0]!.history[0]!.acceptance!, tree: later } }] }]; expect(selectAcceptedDeploymentJournal(wrongTree, journalId)).toBeNull();
});

test("primary compatibility uses only its actual recorded history and explicit primary ref", () => {
  const value = context(), journal = { ...value.journals[0]!, acceptedTarget: undefined };
  value.journals = [journal]; value.roots = [];
  value.primaryHistory = [{ commit, candidateId: journal.candidateId, acceptedAt: "2026-10-04T00:00:01Z", participatingTasks: ["task"], evidenceId: "evidence", outputDigest: "digest" }];
  expect(selectAcceptedDeploymentJournal(value, journalId)?.target.acceptedRef).toBe("refs/heads/main");
  value.primaryHistory = [{ ...value.primaryHistory[0]!, acceptedTarget: context().journals[0]!.acceptedTarget }]; expect(selectAcceptedDeploymentJournal(value, journalId)).toBeNull();
});

test("trusted pin must match exact accepted scope, committed object and recoverable ref", () => {
  const selection = selectAcceptedDeploymentJournal(context(), journalId)!;
  const pin = { projectId: selection.projectId, incarnation, canonicalRepoName: selection.canonicalRepoName, ref: selection.target.recoverableRef, commit, tree, verified: true as const };
  expect(confirmAcceptedDeploymentSelection(selection, pin)).toEqual(selection.target);
  for (const changed of [{ ...pin, ref: "refs/heads/main" }, { ...pin, commit: later }, { ...pin, tree: later }, { ...pin, incarnation: crypto.randomUUID() }]) expect(() => confirmAcceptedDeploymentSelection(selection, changed)).toThrow("exact accepted target");
});

function storage(db: Database): DurableObjectStorage {
  return { sql: { exec(query: string, ...bindings: Array<string | number>) { if (query.includes("CREATE TABLE")) { db.exec(query); return { toArray: () => [] }; } const rows = db.query(query).all(...bindings); return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error("One row required"); return rows[0]; } }; } }, transactionSync<T>(fn: () => T): T { return db.transaction(fn)(); } } as unknown as DurableObjectStorage;
}
test("deployment record/outbox bind explicit nonprimary ref and reject key reuse for primary", () => {
  const db = new Database(":memory:"), selection = selectAcceptedDeploymentJournal(context(), journalId)!;
  try {
    const ledger = new RepositoryDeployments(storage(db), selection.projectId), events: DeploymentRequestedEvent[] = [];
    const created = ledger.request(selection.target, "registered-service", "staging", "owner-key", "owner", event => events.push(event));
    expect(created.deployment.target.acceptedRef).toBe("refs/heads/release"); expect(events[0]?.data.acceptedRootVersion).toBe(1); expect(events[0]?.data.acceptedRef).toBe("refs/heads/release");
    expect(ledger.request(selection.target, "registered-service", "staging", "owner-key", "owner", () => { throw new Error("Duplicate must not stage"); }).kind).toBe("duplicate");
    expect(() => ledger.request({ ...selection.target, acceptedRef: "refs/heads/main" }, "registered-service", "staging", "owner-key", "owner", () => {})).toThrow("different accepted state"); expect(events.length).toBe(1);
  } finally { db.close(); }
});
