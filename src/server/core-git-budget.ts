import { z } from "zod";
import type { Env } from "./env.js";
import { accountKeyFor, accountOf, globalOf } from "./projects.js";

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const cap = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CORE_GIT_REQUEST_USD_MICROS = 1200;
export interface CoreGitBudget { accountUsdMicros: number | null; globalUsdMicros: number | null; readAccountUsdMicros?: number | null; readGlobalUsdMicros?: number | null }
export type CoreGitAdmission = { allowed: true; existing: boolean; basis: "conservative_operation_envelope" } | { allowed: false; reason: "unconfigured" | "account_budget" | "global_budget" };
/** Native Git transport envelope: eight provider operations at $0.15/1,000.
 * This is reserved capacity, not observed invoice cost or a customer fee.
 * Failed or interrupted forwards retain reservations because usage is unknown. */
export class CoreGitOperationLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS core_git_operations(operation_id TEXT PRIMARY KEY, account_key TEXT NOT NULL, month TEXT NOT NULL, reserved INTEGER NOT NULL)");
    const columns=storage.sql.exec<{name:string}>("PRAGMA table_info(core_git_operations)").toArray();
    if(!columns.some(column=>column.name==="category"))storage.sql.exec("ALTER TABLE core_git_operations ADD COLUMN category TEXT NOT NULL DEFAULT 'core'");
    storage.sql.exec("CREATE INDEX IF NOT EXISTS core_git_operations_month ON core_git_operations(month,account_key)");
  }
  reserve(operationId: string, accountKey: string, budget: CoreGitBudget, now = new Date(), category: "core" | "read" = "core"): CoreGitAdmission {
    identifier.parse(operationId); identifier.parse(accountKey); z.enum(["core","read"]).parse(category);
    const accountCap = budget.accountUsdMicros === null ? null : cap.parse(budget.accountUsdMicros);
    const globalCap = budget.globalUsdMicros === null ? null : cap.parse(budget.globalUsdMicros);
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid Git budget period");
    const month = now.toISOString().slice(0,7);
    return this.storage.transactionSync(() => {
      const existing = this.storage.sql.exec<{account_key:string;month:string;category:string}>("SELECT account_key,month,category FROM core_git_operations WHERE operation_id=?",operationId).toArray()[0];
      if (existing) {
        if(existing.account_key!==accountKey || existing.month!==month || existing.category!==category) throw new Error("Git operation identity changed");
        return {allowed:true,existing:true,basis:"conservative_operation_envelope"};
      }
      if(accountCap===null||globalCap===null)return {allowed:false,reason:"unconfigured"};
      if(CORE_GIT_REQUEST_USD_MICROS>accountCap-this.used(month,accountKey))return {allowed:false,reason:"account_budget"};
      if(CORE_GIT_REQUEST_USD_MICROS>globalCap-this.used(month))return {allowed:false,reason:"global_budget"};
      const readAccount=budget.readAccountUsdMicros??0,readGlobal=budget.readGlobalUsdMicros??0;
      cap.parse(readAccount);cap.parse(readGlobal);
      const categoryAccount=category==="read"?Math.min(accountCap,readAccount):Math.max(0,accountCap-readAccount);
      const categoryGlobal=category==="read"?Math.min(globalCap,readGlobal):Math.max(0,globalCap-readGlobal);
      if(CORE_GIT_REQUEST_USD_MICROS>categoryAccount-this.categoryUsed(month,category,accountKey))return {allowed:false,reason:"account_budget"};
      if(CORE_GIT_REQUEST_USD_MICROS>categoryGlobal-this.categoryUsed(month,category))return {allowed:false,reason:"global_budget"};
      this.storage.sql.exec("INSERT INTO core_git_operations(operation_id,account_key,month,reserved,category) VALUES(?,?,?,?,?)",operationId,accountKey,month,CORE_GIT_REQUEST_USD_MICROS,category);
      return {allowed:true,existing:false,basis:"conservative_operation_envelope"};
    });
  }
  private categoryUsed(month:string,category:string,accountKey?:string):number {
    const query="SELECT COALESCE(SUM(reserved),0) AS total FROM core_git_operations WHERE month=? AND category=?";
    return cap.parse(this.storage.sql.exec<{total:number}>(query+(accountKey?" AND account_key=?":""),month,category,...(accountKey?[accountKey]:[])).toArray()[0]?.total??0);
  }
  used(month:string,accountKey?:string):number {
    if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))throw new Error("Invalid Git budget period");
    if(accountKey)identifier.parse(accountKey);
    const row=accountKey?this.storage.sql.exec<{total:number}>("SELECT COALESCE(SUM(reserved),0) AS total FROM core_git_operations WHERE month=? AND account_key=?",month,accountKey).toArray()[0]:this.storage.sql.exec<{total:number}>("SELECT COALESCE(SUM(reserved),0) AS total FROM core_git_operations WHERE month=?",month).toArray()[0];
    return cap.parse(row?.total??0);
  }
}
export function configuredGitCap(value:string|undefined):number|null {
  if(!value||!/^(0|[1-9][0-9]*)$/.test(value))return null;
  const parsed=Number(value);return Number.isSafeInteger(parsed)?parsed:null;
}
/** Caller must authenticate and authorize repository access before admission.
 * Generate a new operationId for each actual forwarded HTTP request, including retries. */
export async function admitGitOperation(env:Env,userId:string,operationId:string):Promise<Response|{finish?:()=>Promise<void>}> {
  const accountKey=await accountKeyFor(userId);
  if(await accountOf(env,accountKey).accountLifecycle()!=="active")return new Response("Account is unavailable",{status:403});
  const result=await globalOf(env).reserveCoreGitOperation(operationId,accountKey,{accountUsdMicros:configuredGitCap(env.CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS),globalUsdMicros:configuredGitCap(env.CORE_GIT_GLOBAL_MONTHLY_USD_MICROS)});
  if(!result.allowed)return new Response(result.reason==="account_budget"?"Native Git transport account capacity reached for this month. Repository browsing and review remain available.":"Native Git transport operator capacity is unavailable. Repository browsing and review remain available.",{status:429,headers:{"Cache-Control":"no-store"}});
  return {};
}
