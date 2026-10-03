import {Database} from "bun:sqlite";
import {expect,test} from "bun:test";
import {copyReportPage,ownerStorageContext,privateRecoveryReportPage} from "../src/server/storage-reconciliation-ledger";
import {storageReconciliationReport} from "../src/server/storage-reconciliation-report";
import type {PrivateRecoveryOperation} from "../src/server/private-recovery";
const projectId="p123456789abc",incarnation="11111111-1111-4111-8111-111111111111";
function fixture(){
 const db=new Database(":memory:");
 db.exec("CREATE TABLE members(user_id TEXT,role TEXT); CREATE TABLE project(id INTEGER,doc TEXT); CREATE TABLE project_workflows(instance_id TEXT,kind TEXT,actor_id TEXT)");
 db.query("INSERT INTO members VALUES(?,?)").run("owner","owner");db.query("INSERT INTO project VALUES(1,?)").run(JSON.stringify({projectId,canonicalRepoName:"canonical",evidence:{legacy:true}}));
 const queries:string[]=[];
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){queries.push(query);const rows=db.query(query).all(...bindings);return {toArray:()=>rows,one:()=>rows[0]};}}} as unknown as DurableObjectStorage;
 return {db,storage,queries};
}
test("legacy report uses SELECT only and never allocates incarnation or operational ledgers",()=>{
 const f=fixture();const tables=f.db.query("SELECT name FROM sqlite_master ORDER BY name").all();
 const context=ownerStorageContext(f.storage,"owner");expect(context?.incarnation).toBeNull();expect(context?.legacyInventory).toBe(true);expect(context?.legacyEvidence).toBe(true);
 expect(ownerStorageContext(f.storage,"stranger")).toBeNull();expect(f.db.query("SELECT name FROM sqlite_master ORDER BY name").all()).toEqual(tables);expect(f.queries.every(query=>query.startsWith("SELECT"))).toBe(true);
 f.db.close();
});
test("real durable recovery bundle plus sidecar are accepted by provider observation report",async()=>{
 const f=fixture();f.db.exec("CREATE TABLE private_recovery_operations(id TEXT PRIMARY KEY,doc TEXT)");
 const op:PrivateRecoveryOperation={id:"22222222-2222-4222-8222-222222222222",projectId,incarnation,commit:"a".repeat(40),tree:null,journalId:"journal",canonicalRepoName:"canonical",ownerId:"owner",accountKey:"b".repeat(12),status:"pending",uploadState:"active",createdAt:"2026-10-03"};
 f.db.query("INSERT INTO private_recovery_operations VALUES(?,?)").run(op.id,JSON.stringify(op));
 const page=privateRecoveryReportPage(f.storage,projectId,incarnation);const observed:string[]=[];
 const result=await storageReconciliationReport({snapshot:{scope:{projectId,incarnation,epoch:"1"},plans:page.plans,plansComplete:page.complete,legacyInventory:false,legacyEvidence:false}},{authorize:async()=>true,head:async key=>{observed.push(key);return null;},list:async()=>({objects:[],truncated:false})});
 expect(observed).toEqual(page.plans[0]!.keys);expect(observed[1]).toBe(`${observed[0]}.json`);expect(result.plans[0]?.unfinishedCount).toBe(1);expect(result.holdsPreserved).toBe(true);expect(JSON.stringify(result)).not.toContain(op.id);expect(f.queries.every(query=>query.startsWith("SELECT"))).toBe(true);f.db.close();
});
test("copy snapshots cap plans, writers and native observations and mark truncation incomplete",()=>{
 const f=fixture();f.db.exec("CREATE TABLE preview_copy_plans(physical_key TEXT PRIMARY KEY,project_id TEXT,incarnation TEXT,doc TEXT); CREATE TABLE preview_copy_writers(physical_key TEXT,writer_id TEXT,closed INTEGER,pending TEXT); CREATE TABLE native_compute(key TEXT,active INTEGER)");
 const insertPlan=f.db.query("INSERT INTO preview_copy_plans VALUES(?,?,?,?)");
 for(let index=0;index<10;index++){const physicalKey=`builds/${projectId}/${String(index).padStart(40,"a")}`;insertPlan.run(physicalKey,projectId,incarnation,JSON.stringify({identity:{projectId,incarnation},physicalKey,kind:"preview",keys:[`${physicalKey}/index.html`],bytes:1}));}
 const key=`builds/${projectId}/${String(0).padStart(40,"a")}`;
 f.db.transaction(()=>{const query=f.db.query("INSERT INTO preview_copy_writers VALUES(?,?,0,'[\"pending\"]')");for(let index=0;index<4097;index++)query.run(key,String(index));const native=f.db.query("INSERT INTO native_compute VALUES(?,1)");for(let index=0;index<257;index++)native.run(`build-${projectId}-${index}`);})();
 const first=copyReportPage(f.storage,projectId,incarnation);expect(first.plans).toHaveLength(0);expect(first.nextCursor).toBeNull();expect(first.complete).toBe(false);expect(first.native.storedActive).toBe(257);
 const second=copyReportPage(f.storage,projectId,incarnation,8);expect(second.plans).toHaveLength(0);expect(second.nextCursor).toBeNull();expect(first.plans[0]).toBeUndefined();expect(f.queries.every(query=>query.startsWith("SELECT"))).toBe(true);f.db.close();
});
test("observed writer, native and workflow changes change their durable epochs",()=>{
 const f=fixture();const before=ownerStorageContext(f.storage,"owner")!.epoch;f.db.query("INSERT INTO project_workflows VALUES('workflow','import','owner')").run();expect(ownerStorageContext(f.storage,"owner")!.epoch).not.toBe(before);
 f.db.exec("CREATE TABLE native_compute(key TEXT,active INTEGER)");const first=copyReportPage(f.storage,projectId,incarnation).epoch;f.db.query("INSERT INTO native_compute VALUES(?,1)").run(`build-${projectId}-native`);expect(copyReportPage(f.storage,projectId,incarnation).epoch).not.toBe(first);f.db.close();
});

test("oversized stored copy metadata is rejected before materializing plan bodies",()=>{
 const f=fixture();
 try{
  f.db.exec("CREATE TABLE preview_copy_plans(physical_key TEXT PRIMARY KEY,project_id TEXT,incarnation TEXT,doc TEXT)");
  f.db.query("INSERT INTO preview_copy_plans VALUES(?,?,?,?)").run(`builds/${projectId}/${"a".repeat(40)}`,projectId,incarnation,"x".repeat(4*1024*1024+1));
  const result=copyReportPage(f.storage,projectId,incarnation);
  expect(result.complete).toBe(false);expect(result.plans).toHaveLength(0);
  expect(f.queries.some(query=>query.includes("SELECT rowid,doc"))).toBe(false);
 }finally{f.db.close();}
});
