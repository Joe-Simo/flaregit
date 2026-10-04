import { z } from "zod";

const micros = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
export const managedResourceKinds=["native-essential","native-optional","managed-agent","optional-unclassified"] as const;
export type ManagedResourceKind=typeof managedResourceKinds[number];
export type NativeComputeKind=Extract<ManagedResourceKind,"native-essential"|"native-optional">;
const envelopeSchema = z.object({ resourceKind:z.enum(managedResourceKinds).optional(), runId: identifier, accountKey: identifier, usdMicros: micros.positive(), maxInputBytes: z.number().int().positive().max(1_000_000), maxOutputTokens: z.number().int().positive().max(32_768), maxCalls: z.number().int().positive().max(100), maxContainerSeconds: z.number().int().positive().max(3600) }).strict();
export type ManagedEnvelope = z.infer<typeof envelopeSchema>;
export interface ManagedReservation extends ManagedEnvelope { month: string; state: "reserved" | "reconciled" | "released"; actualUsdMicros: number | null; evidenceId: string | null; calls: number; containerSeconds: number; dispatchAttempted?: boolean; }
export interface ManagedBudget { accountUsdMicros: number | null; globalUsdMicros: number | null; essentialAccountUsdMicros?:number|null; essentialGlobalUsdMicros?:number|null; }
/** Current operator floors win over older caller snapshots; stricter aggregate
 * caps remain strict. No caller can spend the essential floor as optional. */
export function enforceManagedBudget(requested:ManagedBudget,current:ManagedBudget):ManagedBudget{
 const smaller=(a:number|null,b:number|null)=>a===null||b===null?null:Math.min(micros.parse(a),micros.parse(b));
 return {accountUsdMicros:smaller(requested.accountUsdMicros,current.accountUsdMicros),globalUsdMicros:smaller(requested.globalUsdMicros,current.globalUsdMicros),essentialAccountUsdMicros:current.essentialAccountUsdMicros??null,essentialGlobalUsdMicros:current.essentialGlobalUsdMicros??null};
}
export type ManagedAdmission = { allowed: true; reservation: ManagedReservation; existing: boolean } | { allowed: false; reason: "unconfigured" | "account_budget" | "global_budget" | "released" };

/** One global Durable Object owns both counters. Reserved bounds remain charged
 * after failure/interruption; only trusted billing evidence can reconcile them.
 * This bounds configured managed execution, not unrelated infrastructure bills. */
export class ManagedSpendLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS managed_spend(run_id TEXT PRIMARY KEY, account_key TEXT NOT NULL, month TEXT NOT NULL, charged INTEGER NOT NULL, doc TEXT NOT NULL)");
    storage.sql.exec("CREATE INDEX IF NOT EXISTS managed_spend_month ON managed_spend(month)");
  }
  get(runId: string): ManagedReservation | null {
    identifier.parse(runId);
    const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM managed_spend WHERE run_id=?", runId).toArray()[0];
    return row ? JSON.parse(row.doc) as ManagedReservation : null;
  }
  reserve(input: ManagedEnvelope, budget: ManagedBudget, now = new Date()): ManagedAdmission {
    const parsed = envelopeSchema.parse(input),value={...parsed,resourceKind:parsed.resourceKind??"optional-unclassified" as const};
    if(value.resourceKind==="native-essential"&&(value.usdMicros!==43008||value.maxInputBytes!==1||value.maxOutputTokens!==1||value.maxCalls!==1||value.maxContainerSeconds!==1200))throw Error("Essential native capacity requires the fixed native resource envelope");
    const accountCap = budget.accountUsdMicros === null ? null : micros.parse(budget.accountUsdMicros);
    const globalCap = budget.globalUsdMicros === null ? null : micros.parse(budget.globalUsdMicros);
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid budget period");
    const month = now.toISOString().slice(0, 7);
    return this.storage.transactionSync(() => {
      const existing = this.get(value.runId);
      if (existing) {
        if ((existing.resourceKind===undefined&&value.resourceKind==="native-essential")||Object.entries(value).some(([key,item])=>key==="resourceKind"&&existing.resourceKind===undefined?false:existing[key as keyof ManagedEnvelope]!==item)) throw new Error("Managed reservation identity changed");
        if (existing.state === "released") return { allowed: false, reason: "released" };
        return { allowed: true, reservation: existing, existing: true };
      }
      if (accountCap === null || globalCap === null) return { allowed: false, reason: "unconfigured" };
      const explicitFloor=budget.essentialGlobalUsdMicros!==undefined||budget.essentialAccountUsdMicros!==undefined;
      if(explicitFloor&&(budget.essentialGlobalUsdMicros===null||budget.essentialAccountUsdMicros===null||budget.essentialGlobalUsdMicros===undefined||budget.essentialAccountUsdMicros===undefined))return{allowed:false,reason:"unconfigured"};
      if(value.resourceKind==="native-essential"&&!explicitFloor)return{allowed:false,reason:"unconfigured"};
      const essentialGlobal=micros.parse(budget.essentialGlobalUsdMicros??0),essentialAccount=micros.parse(budget.essentialAccountUsdMicros??0);
      if(essentialGlobal>globalCap||essentialAccount>accountCap)return{allowed:false,reason:"unconfigured"};
      const globalUsed = this.used(month), accountUsed = this.used(month, value.accountKey);
      if (value.usdMicros > accountCap - accountUsed) return { allowed: false, reason: "account_budget" };
      if (value.usdMicros > globalCap - globalUsed) return { allowed: false, reason: "global_budget" };
      // The essential allocation is a protected floor, not a core ceiling.
      // Core work may use unused optional funding while staying within totals.
      if(value.resourceKind!=="native-essential"){
        if(value.usdMicros>accountCap-essentialAccount-this.used(month,value.accountKey,"optional"))return{allowed:false,reason:"account_budget"};
        if(value.usdMicros>globalCap-essentialGlobal-this.used(month,undefined,"optional"))return{allowed:false,reason:"global_budget"};
      }
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
  /** Stable membership snapshot; counters are current when each page is read.
   * Run/account/context identities stay inside the actor and never enter export. */
  async attributionPage(input: { month: string; cursor?: string }) {
    const month = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/).parse(input.month);
    const cursorSchema = z.object({ version: z.literal(1), month: z.literal(month), after: micros, through: micros }).strict();
    let cursor: z.infer<typeof cursorSchema>;
    if (input.cursor !== undefined) {
      if (input.cursor.length > 512) throw new Error("Invalid reservation cursor");
      try { cursor = cursorSchema.parse(JSON.parse(atob(input.cursor))); } catch { throw new Error("Invalid reservation cursor"); }
      if (cursor.after > cursor.through) throw new Error("Invalid reservation cursor");
    } else {
      const row = this.storage.sql.exec<{last:number}>("SELECT COALESCE(MAX(rowid),0) AS last FROM managed_spend WHERE month=?", month).toArray()[0];
      cursor = { version:1,month,after:0,through:micros.parse(row?.last ?? 0) };
    }
    const rows = this.storage.sql.exec<{sequence:number;doc:string}>("SELECT rowid AS sequence,doc FROM managed_spend WHERE month=? AND rowid>? AND rowid<=? ORDER BY rowid LIMIT 26",month,cursor.after,cursor.through).toArray();
    const digest = async (value:string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,"0")).join("");
    const entries = await Promise.all(rows.slice(0,25).map(async row => {
      const run = JSON.parse(row.doc) as ManagedReservation;
      return { attemptDigest:await digest(run.runId),month:run.month,reservationUsdMicros:run.usdMicros,resourceKind:run.resourceKind??"legacy-unclassified",admittedCalls:run.calls,admittedContainerSeconds:run.containerSeconds,dispatchAttempted:run.dispatchAttempted===true,accountingState:run.state,measuredUsage:null,invoiceCost:null,recordedReconciliationUsdMicros:run.state==="reconciled"?run.actualUsdMicros:null,reconciliationEvidenceDigest:run.evidenceId?await digest(run.evidenceId):null,workflowAttribution:"unattributed" as const };
    }));
    const nextCursor=rows.length>25?btoa(JSON.stringify({...cursor,after:rows[24]!.sequence})):null;
    return {month,entries,nextCursor,membership:"bounded_snapshot" as const,values:"current_at_page_read" as const,measurement:"admitted_capacity_is_not_measured_usage" as const,invoice:"unverified" as const};
  }
  used(month:string,accountKey?:string,category?:"essential"|"optional"):number{
    const clause=category===undefined?"":category==="essential"?" AND json_extract(doc,'$.resourceKind')='native-essential'":" AND COALESCE(json_extract(doc,'$.resourceKind'),'legacy-unclassified')!='native-essential'";
    const query=`SELECT COALESCE(SUM(charged),0) AS total FROM managed_spend WHERE month=?${accountKey?" AND account_key=?":""}${clause}`;
    const row=this.storage.sql.exec<{total:number}>(query,...(accountKey?[month,accountKey]:[month])).toArray()[0];return micros.parse(row?.total??0);
  }
  /** Acquire each real dispatch attempt before provider invocation. Workflow
   * retries consume another slot; replay of a reservation itself costs nothing. */
  consume(runId: string, inputBytes: number, outputTokens: number, containerSeconds: number, now = new Date()): ManagedReservation {
    micros.parse(inputBytes); micros.parse(outputTokens); micros.parse(containerSeconds);
    return this.storage.transactionSync(() => {
      const run = this.get(runId);
      if (!run || run.state !== "reserved") throw new Error("Managed reservation unavailable");
      if(run.resourceKind==="native-essential"&&(inputBytes!==0||outputTokens!==0))throw Error("Essential native capacity cannot dispatch AI");
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
