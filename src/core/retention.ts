/** F19 slice: retention windows and expiry decisions. Pure: callers pass `now` from their injected clock. */

export type RetentionKind = "audit" | "deleted_repository" | "job_log" | "backup";

export interface RetainedRecord {
  readonly id: string;
  readonly kind: RetentionKind;
  readonly createdAt: number;
  readonly legal_hold?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const RETENTION_DAYS: Readonly<Record<RetentionKind, number>> = {
  audit: 365,
  deleted_repository: 30,
  job_log: 90,
  backup: 35,
};

export function retentionFor(kind: RetentionKind): number {
  return RETENTION_DAYS[kind];
}

/**
 * Returns ids whose retention window has ended at `now`. A record expires at exactly
 * createdAt + retention. Records under a legal hold are never returned, whatever their age.
 */
export function expiredRecords(records: readonly RetainedRecord[], now: number): string[] {
  return records
    .filter((record) => record.legal_hold !== true && now >= record.createdAt + retentionFor(record.kind) * DAY_MS)
    .map((record) => record.id);
}
