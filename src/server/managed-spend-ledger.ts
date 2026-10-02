import { z } from "zod";

const micros = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const envelopeSchema = z.object({ runId: identifier, accountKey: identifier, usdMicros: micros.positive(), maxInputBytes: z.number().int().positive().max(1_000_000), maxOutputTokens: z.number().int().positive().max(32_768), maxCalls: z.number().int().positive().max(100), maxContainerSeconds: z.number().int().positive().max(3600) }).strict();
export type ManagedEnvelope = z.infer<typeof envelopeSchema>;
export interface ManagedReservation extends ManagedEnvelope { month: string; state: "reserved" | "reconciled" | "released"; actualUsdMicros: number | null; evidenceId: string | null; calls: number; containerSeconds: number; dispatchAttempted?: boolean; }
export interface ManagedBudget { accountUsdMicros: number | null; globalUsdMicros: number | null; }
export type ManagedAdmission = { allowed: true; reservation: ManagedReservation; existing: boolean } | { allowed: false; reason: "unconfigured" | "account_budget" | "global_budget" | "released" };

/** One global Durable Object owns both counters. Reserved bounds remain charged
 * after failure/interruption; only trusted billing evidence can reconcile them.
 * This bounds configured managed execution, not unrelated infrastructure bills. */
export class ManagedSpendLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS managed_spend(run_id TEXT PRIMARY KEY, account_key TEXT NOT NULL, month TEXT NOT NULL, charged INTEGER NOT NULL, doc TEXT NOT NULL)");
  }
  get(runId: string): ManagedReservation | null {
    identifier.parse(runId);
    const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM managed_spend WHERE run_id=?", runId).toArray()[0];
    return row ? JSON.parse(row.doc) as ManagedReservation : null;
  }
  reserve(input: ManagedEnvelope, budget: ManagedBudget, now = new Date()): ManagedAdmission {
    const value = envelopeSchema.parse(input);
    const accountCap = budget.accountUsdMicros === null ? null : micros.parse(budget.accountUsdMicros);
    const globalCap = budget.globalUsdMicros === null ? null : micros.parse(budget.globalUsdMicros);
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid budget period");
    const month = now.toISOString().slice(0, 7);
    return this.storage.transactionSync(() => {
      const existing = this.get(value.runId);
      if (existing) {
        if (Object.entries(value).some(([key, item]) => existing[key as keyof ManagedEnvelope] !== item)) throw new Error("Managed reservation identity changed");
        if (existing.state === "released") return { allowed: false, reason: "released" };
        return { allowed: true, reservation: existing, existing: true };
      }
      if (accountCap === null || globalCap === null) return { allowed: false, reason: "unconfigured" };
      const globalUsed = this.used(month), accountUsed = this.used(month, value.accountKey);
      if (value.usdMicros > accountCap - accountUsed) return { allowed: false, reason: "account_budget" };
      if (value.usdMicros > globalCap - globalUsed) return { allowed: false, reason: "global_budget" };
      const reservation: ManagedReservation = { ...value, month, state: "reserved", actualUsdMicros: null, evidenceId: null, calls: 0, containerSeconds: 0 };
      this.storage.sql.exec("INSERT INTO managed_spend VALUES (?,?,?,?,?)", value.runId, value.accountKey, month, value.usdMicros, JSON.stringify(reservation));
      return { allowed: true, reservation, existing: false };
    });
  }
  reserveBatch(inputs: ManagedEnvelope[], budget: ManagedBudget, now = new Date()): ManagedAdmission[] {
    if (inputs.length < 1 || inputs.length > 20) throw new Error("Invalid managed reservation batch");
    const ids = new Set(inputs.map((input) => input.runId));
    if (ids.size !== inputs.length) throw new Error("Duplicate managed batch identity");
    const rejected: { result?: ManagedAdmission } = {};
    try {
      return this.storage.transactionSync(() => inputs.map((input) => {
        const result = this.reserve(input, budget, now);
        if (!result.allowed) { rejected.result = result; throw new Error("Managed batch refused"); }
        return result;
      }));
    } catch (error) {
      if (rejected.result) return [rejected.result];
      throw error;
    }
  }
  markDispatchAttempted(runIds: string[], accountKey: string): void {
    if (runIds.length < 1 || runIds.length > 20) throw new Error("Invalid dispatch batch");
    this.storage.transactionSync(() => {
      for (const id of runIds) {
        const run = this.get(id);
        if (!run || run.accountKey !== accountKey || run.state !== "reserved") throw new Error("Dispatch reservation unavailable");
        run.dispatchAttempted = true;
        this.storage.sql.exec("UPDATE managed_spend SET doc=? WHERE run_id=?", JSON.stringify(run), id);
      }
    });
  }
  /** Only a caller that knows dispatch was never attempted may cancel. This is
   * not an elapsed-time recovery or a refund for unknown provider outcomes. */
  cancelUnstarted(runIds: string[], accountKey: string): void {
    identifier.parse(accountKey);
    if (runIds.length < 1 || runIds.length > 20 || new Set(runIds).size !== runIds.length) throw new Error("Invalid cancellation batch");
    this.storage.transactionSync(() => {
      const runs = runIds.map((id) => this.get(id));
      if (runs.some((run) => !run || run.accountKey !== accountKey || run.state === "reconciled" || run.dispatchAttempted || run.calls !== 0 || run.containerSeconds !== 0)) throw new Error("Reservation has dispatch activity or belongs to another account");
      for (const run of runs) {
        run!.state = "released";
        this.storage.sql.exec("UPDATE managed_spend SET charged=0,doc=? WHERE run_id=?", JSON.stringify(run), run!.runId);
      }
    });
  }
  used(month: string, accountKey?: string): number {
    const row = accountKey ? this.storage.sql.exec<{ total: number }>("SELECT COALESCE(SUM(charged),0) AS total FROM managed_spend WHERE month=? AND account_key=?", month, accountKey).toArray()[0] : this.storage.sql.exec<{ total: number }>("SELECT COALESCE(SUM(charged),0) AS total FROM managed_spend WHERE month=?", month).toArray()[0];
    return micros.parse(row?.total ?? 0);
  }
  /** Acquire each real dispatch attempt before provider invocation. Workflow
   * retries consume another slot; replay of a reservation itself costs nothing. */
  consume(runId: string, inputBytes: number, outputTokens: number, containerSeconds: number, now = new Date()): ManagedReservation {
    micros.parse(inputBytes); micros.parse(outputTokens); micros.parse(containerSeconds);
    return this.storage.transactionSync(() => {
      const run = this.get(runId);
      if (!run || run.state !== "reserved") throw new Error("Managed reservation unavailable");
      if (!Number.isFinite(now.getTime()) || now.toISOString().slice(0, 7) !== run.month) throw new Error("Managed reservation period expired");
      if (inputBytes > run.maxInputBytes || outputTokens > run.maxOutputTokens || run.calls >= run.maxCalls || containerSeconds > run.maxContainerSeconds - run.containerSeconds) throw new Error("Managed execution envelope exhausted");
      run.calls += 1; run.containerSeconds += containerSeconds;
      this.storage.sql.exec("UPDATE managed_spend SET doc=? WHERE run_id=?", JSON.stringify(run), runId);
      return run;
    });
  }
  /** Server-only reconciler contract. Never accept client-reported cost. Unknown
   * usage must not call this method; do not release on elapsed time or failure. */
  reconcile(runId: string, actualUsdMicros: number, evidenceId: string): ManagedReservation {
    micros.parse(actualUsdMicros); identifier.parse(evidenceId);
    return this.storage.transactionSync(() => {
      const run = this.get(runId);
      if (!run) throw new Error("Managed reservation unavailable");
      if (run.state === "released") throw new Error("Released reservation has no provider billing authority");
      if (run.state === "reconciled") {
        if (run.actualUsdMicros !== actualUsdMicros || run.evidenceId !== evidenceId) throw new Error("Billing evidence changed");
        return run;
      }
      run.state = "reconciled"; run.actualUsdMicros = actualUsdMicros; run.evidenceId = evidenceId;
      this.storage.sql.exec("UPDATE managed_spend SET charged=?,doc=? WHERE run_id=?", actualUsdMicros, JSON.stringify(run), runId);
      return run;
    });
  }
}
