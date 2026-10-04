import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { PreviewMonthlyReadAdmission, previewReadAttemptCap } from "../src/server/preview-monthly-read-admission";
function fixture() {
 const db=new Database(":memory:");
 const storage={sql:{exec(query:string,...args:Array<string|number>){const rows=db.query(query).all(...args);return{toArray:()=>rows};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};
 return {db,storage,ledger:new PreviewMonthlyReadAdmission(storage as unknown as DurableObjectStorage)};
}
const now=new Date("2026-10-31T23:59:59Z"),caps={globalAttempts:3,ownerAttempts:2};
test("optional preview read caps require strict explicit configuration",()=>{
 expect(previewReadAttemptCap("100000")).toBe(100000);
 expect(previewReadAttemptCap("0")).toBe(0);
 for(const raw of [undefined,"","-1","01","1.5","9007199254740992"])expect(previewReadAttemptCap(raw)).toBeNull();
 const {ledger,db}=fixture();
 expect(ledger.admit("owner",{globalAttempts:null,ownerAttempts:2},now)).toMatchObject({allowed:false,reason:"unconfigured"});
 expect(ledger.admit("owner",{globalAttempts:3,ownerAttempts:NaN},now)).toMatchObject({allowed:false,reason:"unconfigured"});
 expect(db.query("SELECT count(*) AS n FROM preview_read_admissions").get()).toEqual({n:0});
});
test("actual attempts including misses retain charge and cannot exceed owner/global allowance",async()=>{
 const {ledger,storage}=fixture();
 const attempts=await Promise.all([1,2,3].map(async()=>ledger.admit("owner",caps,now)));
 expect(attempts.filter(value=>value.allowed)).toHaveLength(2);
 expect(attempts[2]).toMatchObject({allowed:false,reason:"owner_capacity"});
 expect(new PreviewMonthlyReadAdmission(storage as unknown as DurableObjectStorage).admit("owner",caps,now)).toMatchObject({allowed:false,reason:"owner_capacity"});
 expect(ledger.admit("other",caps,now).allowed).toBe(true);
 expect(ledger.admit("third",caps,now)).toMatchObject({allowed:false,reason:"global_capacity"});
});
test("UTC rollover restores only a fresh period and preserves historical usage",()=>{
 const {ledger,db}=fixture();
 ledger.admit("owner",{globalAttempts:1,ownerAttempts:1},now);
 expect(ledger.admit("owner",{globalAttempts:1,ownerAttempts:1},new Date("2026-11-01T00:00:00Z"))).toMatchObject({allowed:true,month:"2026-11",globalAttempts:1,ownerAttempts:1});
 expect(db.query("SELECT SUM(attempts) AS n FROM preview_read_admissions").get()).toEqual({n:2});
 expect(()=>ledger.admit("owner",caps,new Date(NaN))).toThrow("Invalid preview read period");
 expect(()=>ledger.admit("../unsafe",caps,now)).toThrow();
});

test("global counter backfills historical owner charges once without per-read scans",()=>{
 const {ledger,db,storage}=fixture();
 db.query("INSERT INTO preview_read_admissions VALUES(?,?,?)").run("2026-10","historical",2);
 const queries:string[]=[],exec=storage.sql.exec.bind(storage.sql);
 storage.sql.exec=(query,...args)=>{queries.push(query);return exec(query,...args);};
 expect(ledger.admit("new",{globalAttempts:4,ownerAttempts:2},now)).toMatchObject({allowed:true,globalAttempts:3});
 expect(ledger.admit("new",{globalAttempts:4,ownerAttempts:2},now)).toMatchObject({allowed:true,globalAttempts:4});
 expect(ledger.admit("another",{globalAttempts:4,ownerAttempts:2},now)).toMatchObject({allowed:false,reason:"global_capacity"});
 expect(queries.filter(query=>query.includes("SUM(attempts)"))).toHaveLength(1);
 expect(db.query("SELECT attempts FROM preview_read_global_admissions WHERE month='2026-10'").get()).toEqual({attempts:4});
});
