import { z } from "zod";

export interface ImportHistoryAttempt {
  operationId: string;
  generation: number;
  workflowId: string;
  nativeRunId: string;
  dispatch: "saved" | "unknown" | "observed";
  terminal: "complete" | "errored" | "terminated" | null;
  nativeState: "unallocated" | "possible" | "stopped";
  createdAt: string;
  deliveryUntil: string;
}
const operation = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const generation = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
/** Trusted orchestration only: callers must verify the frozen inspection authority.
 * Missing handles never prove termination; unknown dispatch and VM stop retain the attempt. */
export class ImportHistoryAttempts {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS history_attempts(op TEXT PRIMARY KEY,doc TEXT NOT NULL)");
  }
  get(operationId: string): ImportHistoryAttempt | null {
    operation.parse(operationId);
    const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM history_attempts WHERE op=?", operationId).toArray()[0];
    return row ? JSON.parse(row.doc) as ImportHistoryAttempt : null;
  }
  start(operationId: string, expectedGeneration: number, now = Date.now()): ImportHistoryAttempt {
    operation.parse(operationId); generation.parse(expectedGeneration);
    if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 - 86400_000) throw new Error("Invalid attempt timestamp");
    return this.storage.transactionSync(() => {
      const previous = this.get(operationId);
      if (previous && previous.generation === expectedGeneration + 1) return previous;
      if ((previous?.generation ?? 0) !== expectedGeneration) throw new Error("Inspection attempt changed");
      if (previous && (!previous.terminal || previous.nativeState === "possible")) throw new Error("Previous attempt termination and native stop are unconfirmed");
      const id = crypto.randomUUID();
      const attempt: ImportHistoryAttempt = { operationId, generation: expectedGeneration + 1, workflowId: previous ? `import-history-${id}` : operationId, nativeRunId: `native-${crypto.randomUUID()}`, dispatch: "saved", terminal: null, nativeState: "unallocated", createdAt: new Date(now).toISOString(), deliveryUntil: new Date(now + 86400_000).toISOString() };
      this.save(attempt); return attempt;
    });
  }
  private save(attempt: ImportHistoryAttempt): void {
    this.storage.sql.exec("INSERT INTO history_attempts VALUES(?,?) ON CONFLICT(op) DO UPDATE SET doc=excluded.doc", attempt.operationId, JSON.stringify(attempt));
  }
  private mutate(operationId: string, expectedGeneration: number, update: (attempt: ImportHistoryAttempt) => void): ImportHistoryAttempt {
    generation.parse(expectedGeneration);
    return this.storage.transactionSync(() => {
      const attempt = this.get(operationId);
      if (!attempt || attempt.generation !== expectedGeneration) throw new Error("Inspection attempt changed");
      update(attempt); this.save(attempt); return attempt;
    });
  }
  dispatchUnknown(operationId: string, expectedGeneration: number): ImportHistoryAttempt {
    return this.mutate(operationId, expectedGeneration, attempt => { if (attempt.dispatch === "saved") attempt.dispatch = "unknown"; });
  }
  observed(operationId: string, expectedGeneration: number, status: "queued" | "running" | "waiting" | "complete" | "errored" | "terminated"): ImportHistoryAttempt {
    if (!["queued", "running", "waiting", "complete", "errored", "terminated"].includes(status)) throw new Error("Known workflow observation required");
    return this.mutate(operationId, expectedGeneration, attempt => {
      const terminal = status === "complete" || status === "errored" || status === "terminated" ? status : null;
      if (attempt.terminal && terminal !== attempt.terminal) throw new Error("Terminal observation changed");
      attempt.dispatch = "observed"; attempt.terminal = terminal;
    });
  }
  nativeAllocationIntent(operationId: string, expectedGeneration: number): ImportHistoryAttempt {
    return this.mutate(operationId, expectedGeneration, attempt => {
      if (attempt.terminal || attempt.nativeState === "stopped") throw new Error("Native attempt is closed");
      attempt.nativeState = "possible";
    });
  }
  nativeStopped(operationId: string, expectedGeneration: number, nativeRunId: string): ImportHistoryAttempt {
    return this.mutate(operationId, expectedGeneration, attempt => {
      if (attempt.nativeRunId !== nativeRunId) throw new Error("Native stop identity changed");
      attempt.nativeState = "stopped";
    });
  }
}
