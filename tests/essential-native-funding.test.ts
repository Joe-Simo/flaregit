import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { ManagedSpendLedger, enforceManagedBudget, type ManagedEnvelope } from "../src/server/managed-spend-ledger";
import { managedBudget } from "../src/server/projects";
const now=new Date("2026-10-04T12:00:00Z");
const caps={globalUsdMicros:200000,accountUsdMicros:108008,essentialGlobalUsdMicros:86016,essentialAccountUsdMicros:43008};
function fixture(){const db=new Database(":memory:");const storage={sql:{exec(query:string,...args:Array<string|number>){const rows=db.query(query).all(...args);return{toArray:()=>rows};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};return{db,ledger:new ManagedSpendLedger(storage as unknown as DurableObjectStorage)};}
const native=(runId:string,accountKey:string):ManagedEnvelope=>({runId,accountKey,resourceKind:"native-essential",usdMicros:43008,maxInputBytes:1,maxOutputTokens:1,maxCalls:1,maxContainerSeconds:1200});
const optional=(runId:string,accountKey:string):ManagedEnvelope=>({runId,accountKey,resourceKind:"managed-agent",usdMicros:56992,maxInputBytes:100,maxOutputTokens:10,maxCalls:2,maxContainerSeconds:30});
test("optional exhaustion cannot consume reserved essential capacity or increase total funding",()=>{
 const {ledger,db}=fixture();try{
  expect(ledger.reserve(optional("a-optional","a"),caps,now).allowed).toBe(true);expect(ledger.reserve(optional("b-optional","b"),caps,now).allowed).toBe(true);
  expect(ledger.reserve(optional("extra-optional","c"),caps,now)).toMatchObject({allowed:false,reason:"global_budget"});
  expect(ledger.reserve(native("a-core","a"),caps,now).allowed).toBe(true);expect(ledger.reserve(native("b-core","b"),caps,now).allowed).toBe(true);
  expect(ledger.used("2026-10")).toBe(200000);expect(ledger.used("2026-10",undefined,"optional")).toBe(113984);expect(ledger.used("2026-10",undefined,"essential")).toBe(86016);
  expect(ledger.reserve(native("extra-core","c"),caps,now).allowed).toBe(false);
 }finally{db.close();}
});
test("old unclassified liabilities remain charged and cannot be relabeled essential",async()=>{
 const {ledger,db}=fixture();try{
  const {resourceKind:_kind,...legacy}=native("old-native","a");
  const record={...legacy,month:"2026-10",state:"reserved",actualUsdMicros:null,evidenceId:null,calls:0,containerSeconds:0};
  db.query("INSERT INTO managed_spend VALUES(?,?,?,?,?)").run(legacy.runId,"a","2026-10",43008,JSON.stringify(record));
  expect(()=>ledger.reserve(native("old-native","a"),caps,now)).toThrow("identity changed");
  expect(ledger.reserve({...legacy,resourceKind:"native-optional"},caps,now)).toMatchObject({allowed:true,existing:true});
  expect(ledger.get(legacy.runId)?.resourceKind).toBeUndefined();expect(ledger.used("2026-10",undefined,"optional")).toBe(43008);
  expect((await ledger.attributionPage({month:"2026-10"})).entries[0]?.resourceKind).toBe("legacy-unclassified");
  expect(ledger.reserve(native("new-core","a"),caps,now).allowed).toBe(true);expect(ledger.used("2026-10")).toBe(86016);
 }finally{db.close();}
});
test("classification is immutable, native essential cannot fund model calls, and failures keep liability",()=>{
 const {ledger,db}=fixture();try{
  const input=native("core","a");ledger.reserve(input,caps,now);
  expect(()=>ledger.reserve({...input,resourceKind:"native-optional"},caps,now)).toThrow("identity changed");
  expect(()=>ledger.consume("core",1,1,0,now)).toThrow("cannot dispatch AI");
  ledger.consume("core",0,0,1200,now);expect(()=>ledger.cancelUnstarted(["core"],"a")).toThrow();expect(ledger.used("2026-10")).toBe(43008);
  expect(()=>ledger.reserve({...native("bad","a"),maxInputBytes:120000},caps,now)).toThrow("fixed native resource envelope");
 }finally{db.close();}
});
test("authoritative floors survive old caller snapshots, invalid configuration fails closed, UTC periods separate",()=>{
 const {ledger,db}=fixture();try{
  const oldCaller={accountUsdMicros:200000,globalUsdMicros:500000};expect(enforceManagedBudget(oldCaller,caps)).toEqual(caps);
  expect(ledger.reserve(native("missing","a"),{...caps,essentialGlobalUsdMicros:null},now)).toMatchObject({allowed:false,reason:"unconfigured"});
  expect(ledger.reserve(native("invalid","a"),{...caps,essentialGlobalUsdMicros:300000},now)).toMatchObject({allowed:false,reason:"unconfigured"});
  expect(ledger.reserve(native("oct","a"),caps,now).allowed).toBe(true);expect(ledger.reserve(native("nov","a"),caps,new Date("2026-11-01T00:00:00Z")).allowed).toBe(true);
  const config=managedBudget({MANAGED_GLOBAL_MONTHLY_USD_MICROS:"10000000",MANAGED_ACCOUNT_MONTHLY_USD_MICROS:"5000000",MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS:"2000000",MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS:"1000000"});
  expect(config).toEqual({globalUsdMicros:10000000,accountUsdMicros:5000000,essentialGlobalUsdMicros:2000000,essentialAccountUsdMicros:1000000});
 }finally{db.close();}
});

test("essential work borrows unused optional capacity while the aggregate ceiling remains fixed",()=>{
 const {ledger,db}=fixture();try{
  expect(ledger.reserve(native("core-one","a"),caps,now).allowed).toBe(true);
  expect(ledger.reserve(native("core-two","a"),caps,now).allowed).toBe(true);
  expect(ledger.used("2026-10","a","essential")).toBe(86016); // Above the 43,008 protected floor.
  expect(ledger.reserve(native("core-three","a"),caps,now)).toMatchObject({allowed:false,reason:"account_budget"});
  expect(ledger.reserve(native("core-b","b"),caps,now).allowed).toBe(true);
  expect(ledger.used("2026-10",undefined,"essential")).toBe(129024); // Above the 86,016 operator floor.
  expect(ledger.reserve(optional("optional-after-core","b"),caps,now).allowed).toBe(true);
  expect(ledger.used("2026-10")).toBe(186016);
  expect(ledger.reserve(native("global-exhausted","c"),caps,now)).toMatchObject({allowed:false,reason:"global_budget"});
 }finally{db.close();}
});

test("explicit model-only managed agent admission funds no VM and rejects native execution",()=>{
 const {ledger,db}=fixture();try{
  const model:ManagedEnvelope={runId:"model-only",accountKey:"a",resourceKind:"managed-agent",usdMicros:56992,maxInputBytes:100,maxOutputTokens:10,maxCalls:1,maxContainerSeconds:0};
  expect(ledger.reserve(model,caps,now).allowed).toBe(true);
  expect(ledger.get(model.runId)).toMatchObject({resourceKind:"managed-agent",maxContainerSeconds:0,containerSeconds:0});
  for(const limits of [{maxCalls:0},{maxInputBytes:0},{maxOutputTokens:0}])expect(()=>ledger.reserve({...model,...limits,runId:"invalid-model-limits"},caps,now)).toThrow();
  expect(()=>ledger.consume(model.runId,0,0,1,now)).toThrow("envelope exhausted");
  expect(ledger.get(model.runId)?.calls).toBe(0);
  expect(ledger.consume(model.runId,100,10,0,now)).toMatchObject({calls:1,containerSeconds:0});
  expect(()=>ledger.consume(model.runId,1,1,0,now)).toThrow("envelope exhausted");
  expect(ledger.used("2026-10",undefined,"essential")).toBe(0);
  expect(ledger.used("2026-10",undefined,"optional")).toBe(56992);
 }finally{db.close();}
});
test("zero container capacity cannot disguise native or unclassified execution",()=>{
 const {ledger,db}=fixture();try{
  const model={runId:"invalid-zero",accountKey:"a",usdMicros:43008,maxInputBytes:1,maxOutputTokens:1,maxCalls:1,maxContainerSeconds:0};
  for(const resourceKind of ["native-essential","native-optional","optional-unclassified"] as const)expect(()=>ledger.reserve({...model,resourceKind},caps,now)).toThrow("model-only");
  expect(()=>ledger.reserve(model,caps,now)).toThrow("model-only");expect(ledger.used("2026-10")).toBe(0);
 }finally{db.close();}
});
