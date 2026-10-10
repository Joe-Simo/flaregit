import { z } from "zod";

const micros = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const runIdentifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const orderIdentifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);

export const autoRechargeSchema = z.object({
  enabled: z.boolean(),
  /** Recharge is prompted once the spendable balance falls below this many cents. */
  thresholdCents: z.number().int().min(0).max(100_000),
  /** Amount of the one-click top-up checkout, in cents. */
  amountCents: z.number().int().min(100).max(1_000_000),
}).strict();
export type AutoRecharge = z.infer<typeof autoRechargeSchema>;
export interface RechargePrompt { amountCents: number; balanceMicros: number; at: string }
export interface CreditUsage { runId: string; heldMicros: number; debitedMicros: number; state: "held" | "settled" | "released"; at: string }
export interface CreditSummary { balanceMicros: number; heldMicros: number; owedMicros: number; autoRecharge: AutoRecharge | null; rechargePrompt: RechargePrompt | null; recent: CreditUsage[] }
export type CreditHold = { allowed: true } | { allowed: false; reason: "insufficient_credit" | "payment_reversed"; balanceMicros: number; requiredMicros: number };

/** Prepaid credit balance for one account, stored in that account's Durable Object.
 * Spendable balance = deposits - clawbacks - settled debits - active holds, and never goes below zero:
 * a hold needs the full balance up front, a debit never exceeds its hold, and a refund only claws back
 * what is spendable (the remainder is owed and blocks new runs until a later deposit covers it). */
export class CreditLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS credit_orders(order_id TEXT PRIMARY KEY, paid_micros INTEGER NOT NULL, refunded_micros INTEGER NOT NULL, clawed_micros INTEGER NOT NULL, created_at TEXT NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS credit_holds(run_id TEXT PRIMARY KEY, held_micros INTEGER NOT NULL, debited_micros INTEGER NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, settled_at TEXT)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS credit_settings(id INTEGER PRIMARY KEY CHECK(id=1), auto_recharge TEXT, prompt TEXT)");
  }
  private total(query: string): number {
    return micros.parse(this.storage.sql.exec<{ total: number }>(query).toArray()[0]?.total ?? 0);
  }
  private heldMicros(): number { return this.total("SELECT COALESCE(SUM(held_micros),0) AS total FROM credit_holds WHERE state='held'"); }
  private owedMicros(): number { return this.total("SELECT COALESCE(SUM(refunded_micros-clawed_micros),0) AS total FROM credit_orders"); }
  balance(): number {
    const value = this.total("SELECT COALESCE(SUM(paid_micros-clawed_micros),0) AS total FROM credit_orders") - this.total("SELECT COALESCE(SUM(debited_micros),0) AS total FROM credit_holds WHERE state='settled'") - this.heldMicros();
    if (value < 0) throw new Error("Credit ledger invariant violated");
    return value;
  }
  /** Applies a verified paid/refunded order snapshot. Idempotent per order id; refund totals are cumulative. */
  applyOrder(input: { orderId: string; paidMicros: number; refundedMicros: number; paid: boolean }, now = new Date()): { balanceMicros: number; owedMicros: number } {
    orderIdentifier.parse(input.orderId); micros.parse(input.paidMicros); micros.parse(input.refundedMicros);
    return this.storage.transactionSync(() => {
      const row = this.storage.sql.exec<{ paid_micros: number; refunded_micros: number }>("SELECT paid_micros, refunded_micros FROM credit_orders WHERE order_id=?", input.orderId).toArray()[0];
      if (!row) {
        if (!input.paid) return { balanceMicros: this.balance(), owedMicros: this.owedMicros() };
        this.storage.sql.exec("INSERT INTO credit_orders VALUES (?,?,0,0,?)", input.orderId, input.paidMicros, now.toISOString());
        this.storage.sql.exec("INSERT INTO credit_settings(id,prompt) VALUES (1,NULL) ON CONFLICT(id) DO UPDATE SET prompt=NULL");
      }
      const paid = row?.paid_micros ?? input.paidMicros;
      const refunded = Math.min(paid, Math.max(row?.refunded_micros ?? 0, input.refundedMicros));
      this.storage.sql.exec("UPDATE credit_orders SET refunded_micros=? WHERE order_id=?", refunded, input.orderId);
      this.collectOwed();
      return { balanceMicros: this.balance(), owedMicros: this.owedMicros() };
    });
  }
  /** Claws refunded amounts back from the spendable balance, oldest order first, never below zero. */
  private collectOwed(): void {
    const owed = this.storage.sql.exec<{ order_id: string; due: number }>("SELECT order_id, refunded_micros-clawed_micros AS due FROM credit_orders WHERE refunded_micros>clawed_micros ORDER BY created_at, order_id").toArray();
    for (const order of owed) {
      const take = Math.min(order.due, this.balance());
      if (take <= 0) return;
      this.storage.sql.exec("UPDATE credit_orders SET clawed_micros=clawed_micros+? WHERE order_id=?", take, order.order_id);
    }
  }
  /** Holds each run's full reserved envelope before dispatch. All-or-nothing; replaying identical holds is free. */
  hold(runIds: string[], envelopeMicros: number, now = new Date()): CreditHold {
    micros.parse(envelopeMicros);
    if (runIds.length < 1 || runIds.length > 20 || new Set(runIds).size !== runIds.length) throw new Error("Invalid credit hold batch");
    runIds.forEach((id) => runIdentifier.parse(id));
    return this.storage.transactionSync(() => {
      const fresh = runIds.filter((id) => {
        const row = this.storage.sql.exec<{ held_micros: number; state: string }>("SELECT held_micros, state FROM credit_holds WHERE run_id=?", id).toArray()[0];
        if (row && (row.held_micros !== envelopeMicros || row.state !== "held")) throw new Error("Credit hold identity changed");
        return !row;
      });
      const required = fresh.length * envelopeMicros, balance = this.balance();
      if (fresh.length && this.owedMicros() > 0) return { allowed: false, reason: "payment_reversed", balanceMicros: balance, requiredMicros: required };
      if (required > balance) return { allowed: false, reason: "insufficient_credit", balanceMicros: balance, requiredMicros: required };
      for (const id of fresh) this.storage.sql.exec("INSERT INTO credit_holds VALUES (?,?,0,'held',?,NULL)", id, envelopeMicros, now.toISOString());
      return { allowed: true };
    });
  }
  /** Returns holds for runs that were never dispatched. Settled holds are unaffected. */
  release(runIds: string[], now = new Date()): void {
    this.storage.transactionSync(() => {
      for (const id of runIds) this.storage.sql.exec("UPDATE credit_holds SET state='released', settled_at=? WHERE run_id=? AND state='held'", now.toISOString(), runIdentifier.parse(id));
    });
  }
  /** Debits the run's actual cost and releases the rest of its hold. Idempotent; a different replayed cost is refused. */
  settle(runId: string, actualMicros: number, now = new Date()): { debitedMicros: number; balanceMicros: number; rechargePrompt: RechargePrompt | null } | null {
    runIdentifier.parse(runId); micros.parse(actualMicros);
    return this.storage.transactionSync(() => {
      const row = this.storage.sql.exec<{ held_micros: number; debited_micros: number; state: string }>("SELECT held_micros, debited_micros, state FROM credit_holds WHERE run_id=?", runId).toArray()[0];
      // A released hold was never dispatched (the spend ledger refuses to settle it), so nothing is owed.
      if (!row || row.state === "released") return null;
      const debit = Math.min(actualMicros, row.held_micros);
      if (row.state === "settled") {
        if (row.debited_micros !== debit) throw new Error("Settled credit debit changed");
        return { debitedMicros: debit, balanceMicros: this.balance(), rechargePrompt: this.prompt() };
      }
      this.storage.sql.exec("UPDATE credit_holds SET state='settled', debited_micros=?, settled_at=? WHERE run_id=?", debit, now.toISOString(), runId);
      this.collectOwed();
      const balance = this.balance(), settings = this.autoRecharge();
      if (settings?.enabled && balance < settings.thresholdCents * 10_000 && !this.prompt()) {
        const prompt: RechargePrompt = { amountCents: settings.amountCents, balanceMicros: balance, at: now.toISOString() };
        this.storage.sql.exec("INSERT INTO credit_settings(id,prompt) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET prompt=excluded.prompt", JSON.stringify(prompt));
      }
      return { debitedMicros: debit, balanceMicros: balance, rechargePrompt: this.prompt() };
    });
  }
  autoRecharge(): AutoRecharge | null {
    const doc = this.storage.sql.exec<{ auto_recharge: string | null }>("SELECT auto_recharge FROM credit_settings WHERE id=1").toArray()[0]?.auto_recharge;
    return doc ? autoRechargeSchema.parse(JSON.parse(doc)) : null;
  }
  setAutoRecharge(value: AutoRecharge): AutoRecharge {
    const parsed = autoRechargeSchema.parse(value);
    this.storage.sql.exec("INSERT INTO credit_settings(id,auto_recharge) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET auto_recharge=excluded.auto_recharge", JSON.stringify(parsed));
    return parsed;
  }
  prompt(): RechargePrompt | null {
    const doc = this.storage.sql.exec<{ prompt: string | null }>("SELECT prompt FROM credit_settings WHERE id=1").toArray()[0]?.prompt;
    return doc ? JSON.parse(doc) as RechargePrompt : null;
  }
  dismissPrompt(): void { this.storage.sql.exec("UPDATE credit_settings SET prompt=NULL WHERE id=1"); }
  summary(): CreditSummary {
    const recent = this.storage.sql.exec<{ run_id: string; held_micros: number; debited_micros: number; state: CreditUsage["state"]; at: string }>("SELECT run_id, held_micros, debited_micros, state, COALESCE(settled_at, created_at) AS at FROM credit_holds ORDER BY rowid DESC LIMIT 20").toArray()
      .map((row) => ({ runId: row.run_id, heldMicros: row.held_micros, debitedMicros: row.debited_micros, state: row.state, at: row.at }));
    return { balanceMicros: this.balance(), heldMicros: this.heldMicros(), owedMicros: this.owedMicros(), autoRecharge: this.autoRecharge(), rechargePrompt: this.prompt(), recent };
  }
}
