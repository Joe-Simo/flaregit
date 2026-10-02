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
