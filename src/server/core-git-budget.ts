import { z } from "zod";
import type { Env } from "./env.js";
import type {GitHttpRoute} from "./git-http-gateway";
import { accountKeyFor, accountOf, globalOf } from "./projects.js";

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const cap = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CORE_GIT_REQUEST_USD_MICROS = 1200;
export interface CoreGitBudget { accountUsdMicros: number | null; globalUsdMicros: number | null; readAccountUsdMicros?: number | null; readGlobalUsdMicros?: number | null }
export interface CoreGitExistingReservationProof {operationId:string;accountKey:string;month:string;category:"core";reservedUsdMicros:1200;maxProviderOperations:8;basis:"conservative_operation_envelope"}
export interface CoreGitCapacityCategory{accountCap:number|null;accountReserved:number;remainingUsdMicros:number|null;nextEnvelopeAllowed:boolean;reason:"unconfigured"|"account_budget"|"global_budget"|null}
export interface CoreGitCapacity{month:string;basis:"conservative_operation_envelope";requestUsdMicros:number;accountCap:number|null;accountReserved:number;core:CoreGitCapacityCategory;read:CoreGitCapacityCategory}
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
  /** Read the exact original paid envelope only. Caps and the wall clock do not
   * create, renew, move, refund, or expand this reservation. The cleanup owner
   * must separately bind its original group and enforce its durable call limit. */
  existingCoreReservation(operationId:string,accountKey:string,recordedMonth:string):CoreGitExistingReservationProof|null{
    const month=z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
    if(!identifier.safeParse(operationId).success||!identifier.safeParse(accountKey).success||!month.safeParse(recordedMonth).success)return null;
    const row=this.storage.sql.exec<{operation_id:string;account_key:string;month:string;category:string;reserved:number}>("SELECT operation_id,account_key,month,category,reserved FROM core_git_operations WHERE operation_id=? AND account_key=? AND month=?",operationId,accountKey,recordedMonth).toArray()[0];
    const checked=z.object({operation_id:identifier,account_key:identifier,month,category:z.literal("core"),reserved:z.literal(1200)}).strict().safeParse(row);
    if(!checked.success||checked.data.operation_id!==operationId||checked.data.account_key!==accountKey||checked.data.month!==recordedMonth)return null;
    return Object.freeze({operationId,accountKey,month:recordedMonth,category:"core",reservedUsdMicros:1200,maxProviderOperations:8,basis:"conservative_operation_envelope"});
  }
  /** Snapshot of retained reservations, never a provider invoice or a grant. */
  capacity(accountKey:string,budget:CoreGitBudget,now=new Date()):CoreGitCapacity{
    identifier.parse(accountKey);if(!Number.isFinite(now.getTime()))throw Error("Invalid Git budget period");
    const month=now.toISOString().slice(0,7),accountCap=budget.accountUsdMicros===null?null:cap.parse(budget.accountUsdMicros),globalCap=budget.globalUsdMicros===null?null:cap.parse(budget.globalUsdMicros),readAccount=cap.parse(budget.readAccountUsdMicros??0),readGlobal=cap.parse(budget.readGlobalUsdMicros??0);
    return this.storage.transactionSync(()=>{
      const accountReserved=this.used(month,accountKey),globalReserved=this.used(month);
      const category=(kind:'core'|'read'):CoreGitCapacityCategory=>{
        const own=this.categoryUsed(month,kind,accountKey),all=this.categoryUsed(month,kind);
        if(accountCap===null||globalCap===null)return{accountCap:null,accountReserved:own,remainingUsdMicros:null,nextEnvelopeAllowed:false,reason:'unconfigured'};
        const a=kind==='read'?Math.min(accountCap,readAccount):Math.max(0,accountCap-readAccount),g=kind==='read'?Math.min(globalCap,readGlobal):Math.max(0,globalCap-readGlobal);
        const reason=CORE_GIT_REQUEST_USD_MICROS>accountCap-accountReserved?'account_budget':CORE_GIT_REQUEST_USD_MICROS>globalCap-globalReserved?'global_budget':CORE_GIT_REQUEST_USD_MICROS>a-own?'account_budget':CORE_GIT_REQUEST_USD_MICROS>g-all?'global_budget':null;
        return{accountCap:a,accountReserved:own,remainingUsdMicros:Math.max(0,Math.min(accountCap-accountReserved,globalCap-globalReserved,a-own,g-all)),nextEnvelopeAllowed:reason===null,reason};
      };
      return{month,basis:'conservative_operation_envelope',requestUsdMicros:CORE_GIT_REQUEST_USD_MICROS,accountCap,accountReserved,core:category('core'),read:category('read')};
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
export function gitOperationCategory(route?:Pick<GitHttpRoute,'taskId'|'service'|'write'>):'core'|'read'{return route?.taskId===null&&route.service==='git-upload-pack'&&route.write===false?'read':'core';}
export async function admitGitOperation(env:Env,userId:string,operationId:string,route?:GitHttpRoute):Promise<Response|{finish?:()=>Promise<void>}> {
  const accountKey=await accountKeyFor(userId);
  if(await accountOf(env,accountKey).accountLifecycle()!=="active")return new Response("Account is unavailable",{status:403});
  const global=globalOf(env),category=gitOperationCategory(route);
  const result=category==="read"?await global.reserveRepositoryReadOperation(operationId,accountKey):await global.reserveCoreGitOperation(operationId,accountKey,{accountUsdMicros:configuredGitCap(env.CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS),globalUsdMicros:configuredGitCap(env.CORE_GIT_GLOBAL_MONTHLY_USD_MICROS)});
  if(!result.allowed)return new Response(category==="read"?"Repository read capacity is unavailable. Accepted Git history remains preserved.":result.reason==="account_budget"?"Native Git transport account capacity reached for this month. Repository browsing and review remain available.":"Native Git transport operator capacity is unavailable. Repository browsing and review remain available.",{status:429,headers:{"Cache-Control":"no-store"}});
  return {};
}
