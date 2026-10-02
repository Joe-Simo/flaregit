import { Database } from "bun:sqlite";
import { ManagedSpendLedger } from "../../src/server/managed-spend-ledger.js";
import type { Env } from "../../src/server/env.js";

export function nativeFunding() {
  const db=new Database(":memory:");
  const storage={sql:{exec(query:string,...bindings:Array<string|number>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};
  const spend=new ManagedSpendLedger(storage as unknown as DurableObjectStorage);
  const active=new Map<string,string>(),failures=new Set<string>();
  return {MANAGED_ACCOUNT_MONTHLY_USD_MICROS:"5000000",MANAGED_GLOBAL_MONTHLY_USD_MICROS:"10000000",REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:(name:string)=>name==="global"?{
    nativeComputeFailure:async(key:string)=>failures.has(key),
    setNativeComputeFailure:async(key:string,failed:boolean)=>{if(failed)failures.add(key);else failures.delete(key);},
    reserveManagedSpend:async(input:Parameters<ManagedSpendLedger["reserve"]>[0],budget:Parameters<ManagedSpendLedger["reserve"]>[1])=>spend.reserve(input,budget),
    consumeManagedSpend:async(...args:Parameters<ManagedSpendLedger["consume"]>)=>spend.consume(...args),
    claimNativeCompute:async(key:string)=>{if(active.has(key))return null;const token=crypto.randomUUID();active.set(key,token);return token;},
    nativeComputeStatus:async(key:string)=>active.has(key)?{active:true,token:active.get(key),sandboxName:`native-${active.get(key)}`,deadline:Date.now()+1200000}:null,
    finishNativeCompute:async(key:string,token:string)=>{if(active.get(key)===token)active.delete(key);},
  }:{accountLifecycle:async()=>"active",getWorkflowRun:async()=>({actorId:"fixture-human"}),roleOf:async()=>"owner",logActivity:async()=>{}}}} as unknown as Pick<Env,"REPOSITORY_CONTROLLER"|"MANAGED_ACCOUNT_MONTHLY_USD_MICROS"|"MANAGED_GLOBAL_MONTHLY_USD_MICROS">;
}
