import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { HealthProbeBudget, HEALTH_PROBE_USD_MICROS } from "../src/server/health-probe-budget.js";
function fixture(){const db=new Database(":memory:");const storage={sql:{exec(query:string,...bindings:Array<string|number>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};return {db,ledger:new HealthProbeBudget(storage as unknown as DurableObjectStorage)};}
test("same scheduled interval cannot dispatch twice after uncertain outcome",()=>{const {ledger}=fixture();const date=new Date("2026-10-03T00:00:00Z");expect(ledger.reserve(date)).toEqual({kind:"accepted",allowed:true,bucket:Math.floor(date.getTime()/300000),reservedUsdMicros:HEALTH_PROBE_USD_MICROS});expect(ledger.reserve(new Date(date.getTime()+1000))).toEqual({kind:"duplicate",allowed:false,reason:"already_attempted"});expect(ledger.reserve(new Date(date.getTime()+300000)).allowed).toBe(true);});
test("operator monthly allowance exhaustion is explicit and next period is separate",()=>{const {ledger,db}=fixture();db.query("INSERT INTO health_probe_spend VALUES(?,?,?)").run(1,"2026-10",100000);expect(ledger.reserve(new Date("2026-10-03"))).toEqual({kind:"exhausted",allowed:false,reason:"budget_exhausted"});expect(ledger.reserve(new Date("2026-11-01")).allowed).toBe(true);});

import { runProbes } from "../src/server/status.js";
import type { Env } from "../src/server/env.js";
test("duplicate scheduled AI probe records neither artificial success nor outage",async()=>{
  const records:string[]=[];let aiCalls=0;
  const unavailable=async()=>{throw new Error("fixture unavailable");};
  const env={REPOSITORY_CONTROLLER:{idFromName:()=>"global",get:()=>({usageToday:async()=>0,reserveHealthProbe:async()=>({kind:"duplicate",allowed:false,reason:"already_attempted"}),recordProbe:async(component:string)=>{records.push(component);}})},ASSETS:{fetch:unavailable},ARTIFACTS:{list:unavailable},EVIDENCE_BUCKET:{put:unavailable,delete:async()=>{}},INTEGRATION_WORKFLOW:{get:unavailable},INTEGRATION_QUEUE:{send:async()=>{}},AI:{run:async()=>{aiCalls++;return{data:[1]};}}} as unknown as Env;
  await runProbes(env);
  expect(aiCalls).toBe(0);
  expect(records).not.toContain("ai");
  expect(records).toContain("ledger");
});
