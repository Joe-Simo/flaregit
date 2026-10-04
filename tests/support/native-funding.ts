import { Database } from "bun:sqlite";
import { ManagedSpendLedger } from "../../src/server/managed-spend-ledger.js";
import { PreviewStorageLedger } from "../../src/server/preview-storage.js";
import { EvidenceStorageLedger } from "../../src/server/evidence-storage.js";
import { PreviewStorageWriters } from "../../src/server/preview-storage-writers.js";
import type { Env } from "../../src/server/env.js";

export function nativeFunding() {
  const db=new Database(":memory:");
  const storage={sql:{exec(query:string,...bindings:Array<string|number>){if(query.includes(";")){db.exec(query);return{toArray:()=>[],one:()=>({})};}const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};
  const spend=new ManagedSpendLedger(storage as unknown as DurableObjectStorage);
  const previews=new PreviewStorageLedger(storage as unknown as DurableObjectStorage),evidence=new EvidenceStorageLedger(storage as unknown as DurableObjectStorage),writers=new PreviewStorageWriters(storage as unknown as DurableObjectStorage);
  const budget={globalBytes:64*1024*1024,accountBytes:64*1024*1024};
  const active=new Map<string,string>(),failures=new Set<string>(),failureReasons=new Map<string,string>();
  return {MANAGED_ACCOUNT_MONTHLY_USD_MICROS:"5000000",MANAGED_GLOBAL_MONTHLY_USD_MICROS:"10000000",MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS:"2000000",MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS:"1000000",REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:(name:string)=>name==="global"?{
    nativeComputeFailure:async(key:string)=>failures.has(key),
    nativeComputeFailureReason:async(key:string)=>failureReasons.get(key)??null,
    setNativeComputeFailureReason:async(key:string,reason:string)=>{failures.add(key);failureReasons.set(key,reason);},
    previewStorageWriterState:async(key:string)=>{
      if(!/^builds\/[a-z0-9]{12,16}\/[a-f0-9]{40}$/.test(key))throw new Error("Invalid preview scope");
      const rows=db.query<{closed:number;pending:string},[string]>("SELECT closed,pending FROM preview_copy_writers WHERE physical_key=?").all(key);
      return{unfinished:rows.some(row=>!row.closed||(JSON.parse(row.pending) as unknown[]).length>0)};
    },
    reservePreviewStorage:async(manifest:Parameters<PreviewStorageLedger["reserve"]>[0])=>{previews.reserve(manifest,budget);return{allowed:true};},
    reserveEvidenceStorage:async(...args:Parameters<EvidenceStorageLedger["reserve"]> extends [...infer T,unknown]?T:never)=>{evidence.reserve(...args,budget);return{allowed:true};},
    reservePreviewWriter:async(key:string,id:string)=>{writers.registerPreview(key);writers.begin(key,id);},
    beginPreviewPut:async(key:string,id:string,path:string)=>writers.dispatch(key,id,path?`${key}/${path}`:key),
    finishPreviewPut:async(key:string,id:string,path:string)=>writers.settled(key,id,path?`${key}/${path}`:key),
    finishPreviewWriter:async(key:string,id:string)=>writers.finish(key,id),
    registerPreviewEvidenceCopy:async(identity:Parameters<PreviewStorageWriters["registerEvidence"]>[0],id:string,size:number,hash:string,writer:string)=>{const key=writers.registerEvidence(identity,id,size,hash);writers.begin(key,writer);return key;},
    setNativeComputeFailure:async(key:string,failed:boolean)=>{if(failed)failures.add(key);else failures.delete(key);},
    reserveManagedSpend:async(input:Parameters<ManagedSpendLedger["reserve"]>[0],budget:Parameters<ManagedSpendLedger["reserve"]>[1])=>spend.reserve(input,budget),
    consumeManagedSpend:async(...args:Parameters<ManagedSpendLedger["consume"]>)=>spend.consume(...args),
    claimNativeCompute:async(key:string)=>{if(active.has(key))return null;const token=crypto.randomUUID();active.set(key,token);return token;},
    nativeComputeStatus:async(key:string)=>active.has(key)?{active:true,token:active.get(key),sandboxName:`native-${active.get(key)}`,deadline:Date.now()+1200000}:null,
    finishNativeCompute:async(key:string,token:string)=>{if(active.get(key)===token)active.delete(key);},
  }:{accountLifecycle:async()=>"active",getWorkflowRun:async()=>({actorId:"fixture-human"}),roleOf:async()=>"owner",previewStorageScope:async(commit:string)=>({projectId:"p123456789abc",incarnation:"11111111-1111-4111-8111-111111111111",commit,accountKey:"b".repeat(12)}),logActivity:async()=>{}}}} as unknown as Pick<Env,"REPOSITORY_CONTROLLER"|"MANAGED_ACCOUNT_MONTHLY_USD_MICROS"|"MANAGED_GLOBAL_MONTHLY_USD_MICROS"|"MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS"|"MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS">;
}
