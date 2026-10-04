import { z } from "zod";
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const owner = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
export interface PreviewReadCaps { globalAttempts: number | null; ownerAttempts: number | null }
export type PreviewReadAdmission = { allowed: true; month: string; globalAttempts: number; ownerAttempts: number } | { allowed: false; reason: "unconfigured" | "global_capacity" | "owner_capacity"; month: string };
export function previewReadAttemptCap(value: string | undefined): number | null {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
/** Operator-funded optional preview reads. Counts attempts before R2, including
 * misses and uncertain outcomes; no refunds or inferred successful reads.
 * This caps admitted reads, not incoming requests, CPU or a provider invoice. */
export class PreviewMonthlyReadAdmission {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_read_global_admissions(month TEXT PRIMARY KEY,attempts INTEGER NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_read_admissions(month TEXT NOT NULL,owner_key TEXT NOT NULL,attempts INTEGER NOT NULL,PRIMARY KEY(month,owner_key))");
  }
  admit(ownerKey: string, caps: PreviewReadCaps, now = new Date()): PreviewReadAdmission {
    owner.parse(ownerKey);
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid preview read period");
    const month = now.toISOString().slice(0, 7);
    if (caps.globalAttempts === null || caps.ownerAttempts === null || !count.safeParse(caps.globalAttempts).success || !count.safeParse(caps.ownerAttempts).success) return { allowed: false, reason: "unconfigured", month };
    const globalCap = caps.globalAttempts, ownerCap = caps.ownerAttempts;
    return this.storage.transactionSync(() => {
      const savedGlobal = this.storage.sql.exec<{ attempts: number }>("SELECT attempts FROM preview_read_global_admissions WHERE month=?", month).toArray()[0];
      // One-time atomic migration preserves old charged owner rows. Subsequent
      // reads use the month counter instead of scanning every funded owner.
      const globalAttempts = savedGlobal?.attempts ?? this.storage.sql.exec<{ total: number }>("SELECT COALESCE(SUM(attempts),0) AS total FROM preview_read_admissions WHERE month=?", month).toArray()[0]?.total ?? 0;
      if (!savedGlobal) this.storage.sql.exec("INSERT INTO preview_read_global_admissions VALUES(?,?)", month, globalAttempts);
      const ownerAttempts = this.storage.sql.exec<{ attempts: number }>("SELECT attempts FROM preview_read_admissions WHERE month=? AND owner_key=?", month, ownerKey).toArray()[0]?.attempts ?? 0;
      if (globalAttempts >= globalCap) return { allowed: false, reason: "global_capacity", month };
      if (ownerAttempts >= ownerCap) return { allowed: false, reason: "owner_capacity", month };
      this.storage.sql.exec("INSERT INTO preview_read_admissions VALUES(?,?,1) ON CONFLICT(month,owner_key) DO UPDATE SET attempts=attempts+1", month, ownerKey);
      this.storage.sql.exec("UPDATE preview_read_global_admissions SET attempts=attempts+1 WHERE month=?", month);
      return { allowed: true, month, globalAttempts: globalAttempts + 1, ownerAttempts: ownerAttempts + 1 };
    });
  }
}
