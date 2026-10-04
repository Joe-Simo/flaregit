import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { MAX_WEBHOOK_BLOCKED_DEFERRALS as maximum, WebhookBlockedDeferrals } from "../src/server/webhook-blocked-deferrals";
function fixture() {
  const db = new Database(":memory:");
  const storage = { sql: { exec(query: string, ...args: Array<string | number>) { const rows = db.query(query).all(...args); return { toArray: () => rows }; } }, transactionSync<T>(callback: () => T): T { return db.transaction(callback)(); } };
  return { db, ledger: new WebhookBlockedDeferrals(storage as unknown as DurableObjectStorage), storage };
}
test("ordering waits terminate durably without inferring receiver success", () => {
  const { ledger, storage } = fixture();
  for (let sequence = 0; sequence < maximum; sequence++) expect(ledger.defer("delivery", "event", 1, sequence).kind).toBe("reserved");
  expect(ledger.defer("delivery", "event", 1, maximum)).toMatchObject({ kind: "paused", record: { count: maximum, paused: true } });
  expect(new WebhookBlockedDeferrals(storage as unknown as DurableObjectStorage).defer("delivery", "event", 1, maximum).kind).toBe("paused");
});
test("duplicate work cannot multiply resends or reset a replay generation", () => {
  const { ledger, db } = fixture();
  expect(ledger.defer("delivery", "event", 1, 0).kind).toBe("reserved");
  expect(ledger.defer("delivery", "event", 1, 0)).toMatchObject({ kind: "duplicate", record: { count: 1 } });
  ledger.replay("delivery", "event", 1, 2);
  ledger.defer("delivery", "event", 2, 0);
  expect(ledger.replay("delivery", "event", 1, 2).count).toBe(1);
  expect(() => ledger.defer("delivery", "event", 1, 1)).toThrow("generation changed");
  expect(db.query("SELECT count(*) AS n FROM webhook_blocked_deferrals").get()).toEqual({ n: 2 });
});
test("identity changes, sequence gaps and skipped generations cannot allocate waits", () => {
  const { ledger } = fixture();
  expect(() => ledger.defer("delivery", "event", 1, 2)).toThrow();
  ledger.defer("delivery", "event", 1, 0);
  expect(() => ledger.defer("delivery", "other", 1, 1)).toThrow();
  expect(() => ledger.defer("delivery", "event", 1, 3)).toThrow();
  expect(() => ledger.replay("delivery", "event", 1, 3)).toThrow();
});
