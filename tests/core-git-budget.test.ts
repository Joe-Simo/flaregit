import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { CoreGitOperationLedger } from "../src/server/core-git-budget.js";
function ledger() {
  const db=new Database(":memory:");
  const storage={sql:{exec(query:string,...bindings:Array<string|number>){const rows=db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};
  return new CoreGitOperationLedger(storage as unknown as DurableObjectStorage);
}
const now=new Date("2026-10-02T12:00:00Z"),caps={accountUsdMicros:2400,globalUsdMicros:3600};
test("Git envelope requires explicit caps and immutable identity",()=>{
  const spend=ledger();
  expect(spend.reserve("one","a",{...caps,globalUsdMicros:null},now).allowed).toBe(false);
  expect(spend.reserve("one","a",caps,now).allowed).toBe(true);
  expect(spend.reserve("one","a",caps,now)).toMatchObject({allowed:true,existing:true});
  expect(()=>spend.reserve("one","b",caps,now)).toThrow("identity changed");
  expect(()=>spend.reserve("one","a",caps,new Date("2026-11-01"))).toThrow("identity changed");
  expect(()=>spend.reserve("../bad","a",caps,now)).toThrow();
});
test("account fairness and global ceiling are atomic and failed forwards retain unknown charge",async()=>{
  const spend=ledger();
  const results=await Promise.all(["one","two","three"].map(async id=>spend.reserve(id,"a",caps,now)));
  expect(results.filter(result=>result.allowed)).toHaveLength(2);
  expect(spend.used("2026-10","a")).toBe(2400);
  expect(spend.reserve("four","b",caps,now).allowed).toBe(true);
  expect(spend.reserve("five","c",caps,now)).toEqual({allowed:false,reason:"global_budget"});
  expect(spend.used("2026-10")).toBe(3600);
  expect(spend.reserve("next_month","a",caps,new Date("2026-11-01")).allowed).toBe(true);
  expect(spend.used("2026-11")).toBe(1200);
});

test("protected repository reads share aggregate ceilings and retain legacy/core holds",()=>{
  const spend=ledger();
  const split={accountUsdMicros:4800,globalUsdMicros:7200,readAccountUsdMicros:2400,readGlobalUsdMicros:3600};
  expect(spend.reserve("core1","a",split,now).allowed).toBe(true);
  expect(spend.reserve("core2","a",split,now).allowed).toBe(true);
  expect(spend.reserve("core3","a",split,now).allowed).toBe(false);
  expect(spend.reserve("read1","a",split,now,"read").allowed).toBe(true);
  expect(spend.reserve("read2","a",split,now,"read").allowed).toBe(true);
  expect(spend.reserve("read3","a",split,now,"read").allowed).toBe(false);
  expect(spend.reserve("coreb","b",split,now).allowed).toBe(true);
  expect(spend.reserve("readb","b",split,now,"read").allowed).toBe(true);
  expect(spend.reserve("readc","c",split,now,"read").allowed).toBe(false);
  expect(spend.used("2026-10")).toBe(7200);
  expect(()=>spend.reserve("core1","a",split,now,"read")).toThrow("identity changed");
});

test("legacy holds migrate as core without releasing aggregate spending",()=>{
  const db=new Database(":memory:");
  db.exec("CREATE TABLE core_git_operations(operation_id TEXT PRIMARY KEY,account_key TEXT NOT NULL,month TEXT NOT NULL,reserved INTEGER NOT NULL)");
  db.query("INSERT INTO core_git_operations VALUES(?,?,?,?)").run("legacy","a","2026-10",3600);
  const storage={sql:{exec(query:string,...bindings:Array<string|number>){const rows=db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};
  const spend=new CoreGitOperationLedger(storage as unknown as DurableObjectStorage);
  const split={accountUsdMicros:4800,globalUsdMicros:6000,readAccountUsdMicros:2400,readGlobalUsdMicros:2400};
  expect(spend.reserve("core-new","a",split,now).allowed).toBe(false);
  expect(spend.reserve("read-new","a",split,now,"read").allowed).toBe(true);
  expect(spend.reserve("read-next","a",split,now,"read").allowed).toBe(false);
  expect(spend.used("2026-10","a")).toBe(4800);
});
