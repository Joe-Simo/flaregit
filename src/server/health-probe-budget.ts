export const HEALTH_EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
// Official rate snapshot 2026-10-03: $0.0202 / million input tokens.
// https://developers.cloudflare.com/workers-ai/models/bge-small-en-v1.5/
// Reserve the full 512-token context although the immutable probe is only "ok".
export const HEALTH_PROBE_USD_MICROS = 11;
export const HEALTH_MONTHLY_USD_MICROS = 100_000;
export type HealthProbeAdmission = { kind: "accepted"; allowed: true; bucket: number; reservedUsdMicros: number } | { kind: "duplicate" | "exhausted"; allowed: false; reason: "already_attempted" | "budget_exhausted" };
/** Fixed operator allowance separate from customer compute. Every scheduled
 * bucket can dispatch once; ambiguous calls retain cost and never auto-retry. */
export class HealthProbeBudget {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS health_probe_spend(bucket INTEGER PRIMARY KEY,month TEXT NOT NULL,usd_micros INTEGER NOT NULL)");
    storage.sql.exec("CREATE INDEX IF NOT EXISTS health_probe_spend_month ON health_probe_spend(month)");
  }
  reserve(now = new Date()): HealthProbeAdmission {
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid probe period");
    const bucket = Math.floor(now.getTime() / 300_000), month = now.toISOString().slice(0, 7);
    return this.storage.transactionSync(() => {
      if (this.storage.sql.exec("SELECT bucket FROM health_probe_spend WHERE bucket=?", bucket).toArray().length) return { kind: "duplicate", allowed: false, reason: "already_attempted" };
      const used = this.storage.sql.exec<{total:number}>("SELECT COALESCE(SUM(usd_micros),0) AS total FROM health_probe_spend WHERE month=?", month).toArray()[0]?.total ?? 0;
      if (used + HEALTH_PROBE_USD_MICROS > HEALTH_MONTHLY_USD_MICROS) return { kind: "exhausted", allowed: false, reason: "budget_exhausted" };
      this.storage.sql.exec("INSERT INTO health_probe_spend VALUES(?,?,?)", bucket, month, HEALTH_PROBE_USD_MICROS);
      return { kind: "accepted", allowed: true, bucket, reservedUsdMicros: HEALTH_PROBE_USD_MICROS };
    });
  }
}
