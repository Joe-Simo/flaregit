import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { PrivateRecoveryOperations, type PrivateRecoveryOperation, type PrivateRecoveryReceipt } from "../src/server/private-recovery";
function storage(db: Database): DurableObjectStorage {
  return { sql: { exec(query: string, ...bindings: Array<string | number>) { if (query.includes("CREATE TABLE")) { db.exec(query); return { toArray: () => [] }; } const rows = db.query(query).all(...bindings); return { toArray: () => rows, one: () => rows[0] }; } }, transactionSync<T>(fn: () => T): T { return db.transaction(fn)(); } } as unknown as DurableObjectStorage;
}
function operation(): PrivateRecoveryOperation {
  return { id: crypto.randomUUID(), projectId: "p123456789abc", incarnation: crypto.randomUUID(), commit: "a".repeat(40), tree: "b".repeat(40), journalId: "accepted-journal", canonicalRepoName: "owned", ownerId: "owner", accountKey: "account", status: "pending", uploadState: "not-started", createdAt: "2026-10-04T00:00:00Z", acceptedRef: "refs/heads/release/staging", acceptedRootVersion: 3 };
}
function receipt(op: PrivateRecoveryOperation): PrivateRecoveryReceipt {
  return { projectId: op.projectId, incarnation: op.incarnation, commit: op.commit, tree: op.tree!, journalId: op.journalId, size: 123, sha256: "c".repeat(64), objectCount: 4, objectScope: "exact-accepted-reachable-closure", createdAt: op.createdAt, ...(op.acceptedRef ? { acceptedRef: op.acceptedRef } : {}), ...(op.acceptedRootVersion !== undefined ? { acceptedRootVersion: op.acceptedRootVersion } : {}) };
}
function close(ledger: PrivateRecoveryOperations, op: PrivateRecoveryOperation) { ledger.beginUpload(op.id); ledger.saveUpload(op.id, "upload-owned"); ledger.closeUpload(op.id, "upload-owned"); }

test("SQLite recovery operation and receipt preserve exact nonprimary branch/root version", () => {
  const db = new Database(":memory:"), ledger = new PrivateRecoveryOperations(storage(db)), op = operation();
  try {
    ledger.create(op); expect(ledger.create(op)).toEqual(op);
    expect(() => ledger.create({ ...op, acceptedRef: "refs/heads/main" })).toThrow("retry identity changed");
    expect(() => ledger.create({ ...op, acceptedRootVersion: 4 })).toThrow("retry identity changed");
    close(ledger, op);
    expect(() => ledger.complete(op.id, { ...receipt(op), acceptedRef: "refs/heads/main" })).toThrow("scope mismatch");
    expect(() => ledger.complete(op.id, { ...receipt(op), acceptedRootVersion: undefined })).toThrow("scope mismatch");
    expect(ledger.get(op.id)?.status).toBe("pending");
    ledger.complete(op.id, receipt(op)); expect(ledger.get(op.id)?.receipt).toEqual(receipt(op)); expect(ledger.get(op.id)?.status).toBe("ready");
  } finally { db.close(); }
});

test("legacy unbound recovery stays unbound and rejects fabricated branch history on retry", () => {
  const db = new Database(":memory:"), ledger = new PrivateRecoveryOperations(storage(db));
  const { acceptedRef: _ref, acceptedRootVersion: _version, ...op } = operation();
  try {
    ledger.create(op); close(ledger, op); ledger.complete(op.id, receipt(op));
    expect(ledger.get(op.id)?.acceptedRef).toBeUndefined(); expect(ledger.get(op.id)?.receipt?.acceptedRef).toBeUndefined();
    expect(() => ledger.create({ ...op, acceptedRef: "refs/heads/main" })).toThrow("retry identity changed");
    expect(() => ledger.create({ ...operation(), acceptedRef: undefined })).toThrow("branch binding");
  } finally { db.close(); }
});
