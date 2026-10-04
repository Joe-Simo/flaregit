import {Database} from "bun:sqlite";
import {expect,test} from "bun:test";
import {copyReportPage} from "../src/server/storage-reconciliation-ledger";

test("storage plan pagination shares one epoch and detects a change outside the current page",()=>{
 const db=new Database(":memory:");
 try{
  db.exec("CREATE TABLE preview_copy_plans(physical_key TEXT PRIMARY KEY,project_id TEXT,incarnation TEXT,doc TEXT)");
  const projectId="p123456789abc",incarnation="11111111-1111-4111-8111-111111111111";
  const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}}} as unknown as DurableObjectStorage;
  const plans=Array.from({length:10},(_,index)=>{const physicalKey=`builds/${projectId}/${index.toString(16).padStart(40,"0")}`;return{physicalKey,identity:{projectId,incarnation},kind:"preview",keys:[`${physicalKey}/index.html`],bytes:1};});
  for(const plan of plans)db.query("INSERT INTO preview_copy_plans VALUES(?,?,?,?)").run(plan.physicalKey,projectId,incarnation,JSON.stringify(plan));
  const first=copyReportPage(storage,projectId,incarnation),second=copyReportPage(storage,projectId,incarnation,8);
  expect(first.complete).toBe(true);expect(first.plans).toHaveLength(8);expect(second.plans).toHaveLength(2);expect(second.epoch).toBe(first.epoch);expect(second.nextCursor).toBeNull();
  const changed={...plans[9]!,bytes:2};db.query("UPDATE preview_copy_plans SET doc=? WHERE physical_key=?").run(JSON.stringify(changed),changed.physicalKey);
  expect(copyReportPage(storage,projectId,incarnation).epoch).not.toBe(first.epoch);
  expect(copyReportPage(storage,projectId,incarnation,8).epoch).toBe(copyReportPage(storage,projectId,incarnation).epoch);
 }finally{db.close();}
});
