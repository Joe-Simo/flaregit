import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { RebaseRecoveryLedger, RebaseRecoveryError, verifyRebaseRecovery, type RebaseRecoverySnapshot, type RebaseRecoveryProof } from "../src/server/rebase-recovery";
import { RetainedInputs, type RetainedInput } from "../src/server/retained-inputs";
import { retainedGitInputRef } from "../src/server/retained-git-input";
import type { RepositoryReadCapability } from "../src/server/repository-read-budget";
const owner = { userId: "current-owner", displayName: "Current maintainer", viaToken: false };
function fixture() {
  const db = new Database(":memory:");
  const storage = { sql: { exec(query: string, ...bindings: Array<string | number>) { const rows = db.query(query).all(...bindings); return { toArray: () => rows }; } }, transactionSync<T>(callback: () => T) { return db.transaction(callback)(); } };
  const durable = storage as unknown as DurableObjectStorage, inputs = new RetainedInputs(durable), ledger = new RebaseRecoveryLedger(durable);
  const incarnation = crypto.randomUUID();
  const input: RetainedInput = { id: crypto.randomUUID(), projectId: "p123456789abc", incarnation, taskId: "working", commit: "b".repeat(40), base: "a".repeat(40), workspaceRepoName: "workspace", canonicalRepoName: "canonical", branch: "task/working", workflowId: "original-workflow", candidateId: "original-candidate", actorId: "original-actor-who-left", ownerId: "old-owner", accountKey: "1".repeat(12), protectedRef: retainedGitInputRef(incarnation, "working", "b".repeat(40)), protectedBaseRef: retainedGitInputRef(incarnation, "working", "a".repeat(40)), dependsOn: "parent", version: 1 };
  inputs.record(input, { commit: input.commit, base: input.base });
  const application = inputs.prepareApplication(input, "d".repeat(40), "c".repeat(40), true);
  const snapshot: RebaseRecoverySnapshot = { projectId: input.projectId, incarnation, canonicalRepoName: input.canonicalRepoName, accepted: true, task: { id: input.taskId, currentCommit: input.commit, baseCommit: input.base, workspaceRepoName: input.workspaceRepoName, branch: input.branch, dependsOn: input.dependsOn, status: "blocked" } };
  const proof: RebaseRecoveryProof = { original: input.commit, originalBase: input.base, result: application.commit, targetBase: application.base, workspaceHead: application.commit };
  db.exec("CREATE TABLE task(doc TEXT NOT NULL)");
  db.query("INSERT INTO task VALUES(?)").run(JSON.stringify({ ...snapshot.task, blockedReason: "An unrelated policy blocker", checkpoints: ["unchanged"], goal: "Unchanged purpose" }));
  // SQL mutation belongs to the real recovery transaction; no actor/workflow substitution.
  const mutate = (plan: { commit: string; base: string; dependsOn?: string }) => {
    inputs.remoteVerified(input.id, plan.commit);
    inputs.applyApplication(input.id, () => {
      const row = db.query("SELECT doc FROM task").get() as { doc: string };
      const task = JSON.parse(row.doc) as Record<string, unknown>;
      task.currentCommit = plan.commit; task.baseCommit = plan.base;
      if (plan.dependsOn) task.dependsOn = plan.dependsOn; else delete task.dependsOn;
      db.query("UPDATE task SET doc=?").run(JSON.stringify(task));
    });
  };
  return { db, ledger, inputs, input, application, snapshot, proof, mutate, close: () => db.close() };
}
test("current-owner reconciliation atomically records a separate actor and preserves provenance and unrelated state", () => {
  const f = fixture(); try {
    const report = f.ledger.observe(f.application, f.snapshot);
    expect(report.version).toBe(0); expect(report.status).toBe("unavailable"); expect(report.canReconcile).toBe(true);
    const idempotencyKey = crypto.randomUUID();
    const receipt = f.ledger.reconcile({ application: f.application, snapshot: f.snapshot, proof: f.proof, actor: owner, expectedVersion: 0, idempotencyKey }, f.mutate);
    expect(receipt.actor).toEqual(owner); expect(receipt.status).toBe("reconciled"); expect(receipt.version).toBe(1);
    const row = f.db.query("SELECT doc FROM task").get() as { doc: string }; const task = JSON.parse(row.doc);
    expect(task).toMatchObject({ currentCommit: f.application.commit, baseCommit: f.application.base, status: "blocked", blockedReason: "An unrelated policy blocker", checkpoints: ["unchanged"], goal: "Unchanged purpose" }); expect(task.dependsOn).toBeUndefined();
    expect(f.inputs.application(f.input.id)?.input.actorId).toBe("original-actor-who-left"); expect(f.inputs.application(f.input.id)?.input.workflowId).toBe("original-workflow");
    expect(f.ledger.replay(idempotencyKey, f.input.id, { ...owner, displayName: "Changed profile name" }, 0)).toEqual(receipt);
    expect(() => f.ledger.replay(idempotencyKey, f.input.id, { ...owner, userId: "another-owner" }, 0)).toThrow("another operation");
    const next = { ...f.snapshot, task: { ...f.snapshot.task, currentCommit: f.application.commit, baseCommit: f.application.base, dependsOn: undefined } };
    expect(f.ledger.observe(f.inputs.application(f.input.id)!, next).version).toBe(1);
  } finally { f.close(); }
});
test("old, newer, missing protected history and changed metadata never mutate or save success receipts", () => {
  for (const variant of ["old", "newer", "missing", "changed", "busy"] as const) {
    const f = fixture(); try {
      const before = f.db.query("SELECT doc FROM task").get(); f.ledger.observe(f.application, f.snapshot);
      const proof = { ...f.proof, ...(variant === "old" ? { workspaceHead: f.input.commit } : variant === "newer" ? { workspaceHead: "e".repeat(40) } : variant === "missing" ? { result: null } : {}) };
      const snapshot = variant === "changed" ? { ...f.snapshot, task: { ...f.snapshot.task, dependsOn: "another-parent" } } : variant === "busy" ? { ...f.snapshot, task: { ...f.snapshot.task, busy: true } } : f.snapshot;
      let mutations = 0;
      expect(() => f.ledger.reconcile({ application: f.application, snapshot, proof, actor: owner, expectedVersion: 0, idempotencyKey: crypto.randomUUID() }, () => { mutations++; })).toThrow(RebaseRecoveryError);
      expect(mutations).toBe(0); expect(f.db.query("SELECT doc FROM task").get()).toEqual(before); expect(f.db.query("SELECT COUNT(*) AS n FROM rebase_recovery_receipts").get()).toEqual({ n: 0 });
    } finally { f.close(); }
  }
});
test("exact new-head partial metadata is repairable while a transaction failure rolls back receipts and metadata", () => {
  const f = fixture(); try {
    const snapshot = { ...f.snapshot, task: { ...f.snapshot.task, currentCommit: f.application.commit } };
    f.ledger.observe(f.application, snapshot); const before = f.db.query("SELECT doc FROM task").get();
    expect(() => f.ledger.reconcile({ application: f.application, snapshot, proof: f.proof, actor: owner, expectedVersion: 0, idempotencyKey: crypto.randomUUID() }, plan => { f.mutate(plan); throw new Error("Synthetic interrupted metadata save"); })).toThrow("interrupted");
    expect(f.db.query("SELECT doc FROM task").get()).toEqual(before); expect(f.inputs.application(f.input.id)?.status).toBe("intent");
    expect(f.ledger.reconcile({ application: f.application, snapshot, proof: f.proof, actor: owner, expectedVersion: 0, idempotencyKey: crypto.randomUUID() }, f.mutate).status).toBe("reconciled");
  } finally { f.close(); }
});
test("final synchronous authority rejection precedes mutation", () => {
  const f = fixture(); try {
    f.ledger.observe(f.application, f.snapshot); let writes = 0;
    expect(() => f.ledger.reconcile({ application: f.application, snapshot: f.snapshot, proof: f.proof, actor: owner, expectedVersion: 0, idempotencyKey: crypto.randomUUID() }, () => { writes++; }, () => { throw new Error("Owner revoked during provider await"); })).toThrow("Owner revoked");
    expect(writes).toBe(0);
  } finally { f.close(); }
});
test("read verifier proves all protected refs and the workspace head, and denied funding prevents any lookup", async () => {
  const f = fixture(); let gets = 0, writes = 0; const requested: string[] = [];
  const refs = new Map([[f.input.protectedRef, f.input.commit], [f.input.protectedBaseRef, f.input.base], [retainedGitInputRef(f.input.incarnation, f.input.taskId, f.application.commit), f.application.commit], [retainedGitInputRef(f.input.incarnation, f.input.taskId, f.application.base), f.application.base], [`refs/heads/${f.input.branch}`, f.application.commit]]);
  const binding = { async get(name: string) { gets++; if (!["canonical", "workspace"].includes(name)) throw new Error("Wrong synthetic namespace"); return { log: async ({ ref }: { ref: string }) => { requested.push(ref); const hash = refs.get(ref); return hash ? [{ hash, treeHash: "f".repeat(40), message: "Synthetic proof", author: { name: "Fixture", email: "private@example.test" }, parents: [], authoredAt: 1, committedAt: 1 }] : []; }, createToken: () => { writes++; throw new Error("No token issuance permitted"); }, [Symbol.dispose]() {} } as unknown as RepositoryReadCapability; } };
  try {
    const options = { authorize: async () => {}, reserveGroup: async () => ({ allowed: true as const, existing: false, basis: "conservative_operation_envelope" as const }) };
    expect(await verifyRebaseRecovery(binding, f.application, options)).toEqual(f.proof); expect(gets).toBe(2); expect(requested.length).toBe(5); expect(writes).toBe(0);
    gets = 0;
    await expect(verifyRebaseRecovery(binding, f.application, { ...options, reserveGroup: async () => ({ allowed: false as const, reason: "account_budget" as const }) })).rejects.toMatchObject({ status: 429 }); expect(gets).toBe(0);
  } finally { f.close(); }
});


test("recreated and foreign repository scopes never project old private application metadata", () => {
  const f = fixture(); try {
    for (const snapshot of [{ ...f.snapshot, incarnation: crypto.randomUUID() }, { ...f.snapshot, projectId: "another-project" }, { ...f.snapshot, canonicalRepoName: "another-canonical" }]) {
      let failure: unknown;
      try { f.ledger.observe(f.application, snapshot); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(RebaseRecoveryError);
      if (!(failure instanceof RebaseRecoveryError)) throw new Error("Expected scoped recovery failure");
      expect(failure.report).toBeUndefined();
      expect(f.db.query("SELECT COUNT(*) AS n FROM rebase_recovery_versions").get()).toEqual({ n: 0 });
    }
  } finally { f.close(); }
});


test("audit capacity blocks new requests before provider proof but preserves existing replay and every row", () => {
  const f = fixture(); try {
    f.ledger.observe(f.application, f.snapshot);
    const key = crypto.randomUUID();
    const receipt = f.ledger.reconcile({ application: f.application, snapshot: f.snapshot, proof: f.proof, actor: owner, expectedVersion: 0, idempotencyKey: key }, f.mutate);
    const insert = f.db.prepare("INSERT INTO rebase_recovery_receipts VALUES(?,?,?)");
    f.db.transaction(() => { for (let i = 1; i < 10_000; i++) insert.run(`synthetic-capacity-${i}`, "synthetic-other-operation", "{}"); })();
    expect(f.ledger.preflight(key, f.input.id, owner, 0)).toEqual(receipt);
    const before = f.db.query("SELECT doc FROM task").get();
    let providerCalls = 0, failure: unknown;
    try { f.ledger.preflight(crypto.randomUUID(), f.input.id, owner, 1); providerCalls++; } catch (error) { failure = error; }
    expect(failure).toMatchObject({ status: 429 }); expect(providerCalls).toBe(0);
    expect(() => f.ledger.reconcile({ application: f.inputs.application(f.input.id)!, snapshot: f.snapshot, proof: f.proof, actor: owner, expectedVersion: 1, idempotencyKey: crypto.randomUUID() }, () => { throw new Error("Must never mutate at capacity"); })).toThrow("audit capacity");
    expect(f.db.query("SELECT COUNT(*) AS n FROM rebase_recovery_receipts").get()).toEqual({ n: 10_000 });
    expect(f.db.query("SELECT doc FROM task").get()).toEqual(before);
    expect(f.ledger.replay(key, f.input.id, owner, 0)).toEqual(receipt);
  } finally { f.close(); }
});
