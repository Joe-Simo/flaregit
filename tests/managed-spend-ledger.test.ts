import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { ManagedSpendLedger, type ManagedEnvelope } from "../src/server/managed-spend-ledger.js";

function ledger() {
  const db = new Database(":memory:");
  const storage = { sql: { exec(query: string, ...bindings: Array<string | number>) {
    const statement = db.query(query);
    const rows = statement.all(...bindings);
    return { toArray: () => rows };
  } }, transactionSync<T>(callback: () => T): T { return db.transaction(callback)(); } };
  // The adapter implements the exact SQL and synchronous transaction surface used here.
  return new ManagedSpendLedger(storage as unknown as DurableObjectStorage);
}
const envelope: ManagedEnvelope = { runId: "workflow_1", accountKey: "account_a", usdMicros: 40, maxInputBytes: 100, maxOutputTokens: 10, maxCalls: 2, maxContainerSeconds: 30 };
const now = new Date("2026-10-02T12:00:00Z");
const caps = { accountUsdMicros: 80, globalUsdMicros: 100 };

test("both operator caps required; zero is an explicit deny cap", () => {
  const spend = ledger();
  expect(spend.reserve(envelope, { ...caps, globalUsdMicros: null }, now)).toEqual({ allowed: false, reason: "unconfigured" });
  expect(spend.reserve(envelope, { ...caps, accountUsdMicros: 0 }, now)).toEqual({ allowed: false, reason: "account_budget" });
});
test("immutable retry reservation charges once and remains in its original period", () => {
  const spend = ledger();
  expect(spend.reserve(envelope, caps, now).allowed).toBe(true);
  expect(spend.reserve(envelope, caps, new Date("2026-11-01")).allowed).toBe(true);
  expect(spend.used("2026-10")).toBe(40);
  expect(spend.used("2026-11")).toBe(0);
  expect(() => spend.reserve({ ...envelope, accountKey: "another" }, caps, now)).toThrow("identity changed");
});
test("account and global limits jointly protect parallel admissions", () => {
  const spend = ledger();
  spend.reserve(envelope, caps, now);
  spend.reserve({ ...envelope, runId: "workflow_2" }, caps, now);
  expect(spend.reserve({ ...envelope, runId: "workflow_3" }, caps, now)).toEqual({ allowed: false, reason: "account_budget" });
  expect(spend.reserve({ ...envelope, runId: "workflow_4", accountKey: "account_b" }, caps, now)).toEqual({ allowed: false, reason: "global_budget" });
  expect(spend.used("2026-10")).toBe(80);
});
test("dispatch bounds fail atomically and interrupted execution keeps its charge", () => {
  const spend = ledger(); spend.reserve(envelope, caps, now);
  expect(() => spend.consume(envelope.runId, 101, 10, 10, now)).toThrow();
  expect(spend.get(envelope.runId)?.calls).toBe(0);
  spend.consume(envelope.runId, 100, 10, 20, now);
  expect(() => spend.consume(envelope.runId, 100, 10, 11, now)).toThrow();
  spend.consume(envelope.runId, 100, 10, 10, now);
  expect(() => spend.consume(envelope.runId, 1, 1, 0, now)).toThrow();
  expect(spend.used("2026-10")).toBe(40);
  expect(spend.get(envelope.runId)?.actualUsdMicros).toBeNull();
});
test("trusted reconciliation is immutable, records overages, and disables new dispatch", () => {
  const spend = ledger(); spend.reserve(envelope, caps, now);
  spend.reconcile(envelope.runId, 110, "billing_receipt");
  expect(spend.used("2026-10")).toBe(110);
  expect(() => spend.consume(envelope.runId, 1, 1, 0, now)).toThrow();
  expect(() => spend.reconcile(envelope.runId, 0, "different")).toThrow("evidence changed");
  expect(spend.reserve({ ...envelope, runId: "new_run", accountKey: "new_account" }, caps, now)).toEqual({ allowed: false, reason: "global_budget" });
});

test("old month authority cannot dispatch against a fresh billing period", () => {
  const spend = ledger(); spend.reserve(envelope, caps, now);
  expect(() => spend.consume(envelope.runId, 1, 1, 1, new Date("2026-11-01"))).toThrow("period expired");
  expect(spend.get(envelope.runId)?.calls).toBe(0);
  expect(spend.used("2026-10")).toBe(40);
});

test("parallel scenario reservation is all-or-none before either agent starts", () => {
  const spend = ledger();
  const results = spend.reserveBatch([envelope, { ...envelope, runId: "parallel" }], { ...caps, globalUsdMicros: 60 }, now);
  expect(results).toEqual([{ allowed: false, reason: "global_budget" }]);
  expect(spend.used("2026-10")).toBe(0);
  expect(spend.get(envelope.runId)).toBeNull();
});

test("known unstarted cancellation recovers reserved budget and tombstone cannot resurrect", () => {
  const spend = ledger(); spend.reserve(envelope, caps, now);
  expect(() => spend.cancelUnstarted([envelope.runId], "wrong_account")).toThrow();
  expect(spend.used("2026-10")).toBe(40);
  spend.cancelUnstarted([envelope.runId], envelope.accountKey);
  expect(spend.used("2026-10")).toBe(0);
  expect(spend.reserve(envelope, caps, now)).toEqual({ allowed: false, reason: "released" });
  expect(spend.get(envelope.runId)?.actualUsdMicros).toBeNull();
});
test("consumed or dispatch-attempted unknown outcomes cannot refund a batch", () => {
  const spend = ledger(); spend.reserveBatch([envelope, { ...envelope, runId: "second" }], caps, now);
  spend.markDispatchAttempted([envelope.runId], envelope.accountKey);
  expect(() => spend.cancelUnstarted([envelope.runId, "second"], envelope.accountKey)).toThrow();
  expect(spend.used("2026-10")).toBe(80);
  spend.consume("second", 1, 1, 0, now);
  expect(() => spend.cancelUnstarted(["second"], envelope.accountKey)).toThrow();
});
