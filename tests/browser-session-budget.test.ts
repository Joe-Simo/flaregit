import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { BrowserSessionBudget, type BrowserSessionScope, type BrowserSessionClosure } from "../src/server/browser-session-budget";
import { ManagedSpendLedger } from "../src/server/managed-spend-ledger";
const now=new Date("2026-10-04T12:00:00Z");
function scope():BrowserSessionScope{return{leaseId:crypto.randomUUID(),attemptId:crypto.randomUUID(),projectId:"abcdef123456",incarnation:crypto.randomUUID(),accountKey:"owner",actorId:"user_owner",candidateId:"candidate",canonicalRepoName:"canonical",targetRef:"refs/heads/main",expectedBase:"a".repeat(40),acceptedVersion:1,commit:"b".repeat(40),tree:"c".repeat(40),policyVersion:1,policyDigest:"d".repeat(64),buildDigest:"e".repeat(64),sourceDigest:"f".repeat(64),maxSeconds:120};}
function fixture(){
 const db=new Database(":memory:"),queries:string[]=[];
 const storage={sql:{exec(query:string,...args:Array<string|number>){queries.push(query);const rows=db.query(query).all(...args);return{toArray:()=>rows};}},transactionSync<T>(fn:()=>T):T{return db.transaction(fn)();}};
 let allowed=true,reservation:number|null=100000,expected:BrowserSessionScope|null=null;let closure:BrowserSessionClosure|null=null;let fundingCalls=0;const closureIds:string[]=[];
 const callbacks={authorize:async(input:BrowserSessionScope)=>{const validate=()=>{if(!allowed||expected&&(input.accountKey!==expected.accountKey||input.expectedBase!==expected.expectedBase||input.acceptedVersion!==expected.acceptedVersion||input.policyDigest!==expected.policyDigest||input.policyVersion!==expected.policyVersion))throw Error("Current browser authority changed");};validate();return validate;},funding:()=>{fundingCalls++;return{reservationUsdMicros:reservation,budget:{globalUsdMicros:10000000,accountUsdMicros:5000000,essentialGlobalUsdMicros:2000000,essentialAccountUsdMicros:1000000}};},attestClosure:async(id:string)=>{closureIds.push(id);return closure;}};
 const ledger=new BrowserSessionBudget(storage as unknown as DurableObjectStorage,callbacks),managed=new ManagedSpendLedger(storage as unknown as DurableObjectStorage);
 return{db,storage,callbacks,ledger,managed,queries,closureIds,setAllowed:(value:boolean)=>{allowed=value;},setReservation:(value:number|null)=>{reservation=value;},setExpected:(value:BrowserSessionScope)=>{expected=value;},setClosure:(value:BrowserSessionClosure|null)=>{closure=value;},fundingCalls:()=>fundingCalls};
}
test("one global browser is funded atomically once and lost acknowledgment uses recorded readback",async()=>{
 const f=fixture(),input=scope();try{
  const first=await f.ledger.admit(input,now);expect(first.phase).toBe("funded");
  expect(await f.ledger.admit(input,now)).toEqual(first);expect(f.fundingCalls()).toBe(1);
  expect(f.managed.used("2026-10")).toBe(100000);expect(f.managed.get(first.fundingRunId)).toMatchObject({resourceKind:"optional-unclassified",calls:1,containerSeconds:0});
  await expect(f.ledger.admit({...scope(),accountKey:"other"},now)).rejects.toThrow("capacity is held");
  expect(await f.ledger.beginAcquire(input,now)).toBe(true);expect(await f.ledger.beginAcquire(input,now)).toBe(false);
  const recreated=new BrowserSessionBudget(f.storage as unknown as DurableObjectStorage,f.callbacks);expect(recreated.get(input.leaseId)?.phase).toBe("acquire_possible");expect(await recreated.beginAcquire(input,now)).toBe(false);
  expect(f.managed.used("2026-10")).toBe(100000);
 }finally{f.db.close();}
});
test("unknown acquisition and cleanup hold capacity across deadlines and late identity is cleanup only",async()=>{
 const f=fixture(),input=scope(),session=crypto.randomUUID();try{
  await f.ledger.admit(input,now);await f.ledger.beginAcquire(input,now);
  const unresolved=await f.ledger.close(input);expect(unresolved.phase).toBe("cleanup_pending");expect(f.closureIds).toEqual([]);
  await expect(f.ledger.admit(scope(),new Date(now.getTime()+86400000))).rejects.toThrow("capacity is held");
  f.ledger.recordAcquired(input,session);expect(f.ledger.get(input.leaseId)?.phase).toBe("cleanup_pending");
  await expect(f.ledger.beforeWork(input,now)).rejects.toThrow("unavailable");
  f.setClosure({sessionId:crypto.randomUUID(),observation:"closed",observedAt:now.getTime()});expect((await f.ledger.close(input)).phase).toBe("cleanup_pending");
  f.setClosure({sessionId:session,observation:"closed",observedAt:now.getTime()});expect((await f.ledger.close(input)).phase).toBe("closed");expect(f.closureIds).toEqual([session,session]);
  await expect(f.ledger.admit(input,now)).rejects.toThrow("UUID is consumed");expect((await f.ledger.admit(scope(),now)).phase).toBe("funded");expect(f.managed.used("2026-10")).toBe(200000);
 }finally{f.db.close();}
});
test("every work step requires current account base and policy, cleanup survives withdrawn authority",async()=>{
 const f=fixture(),input=scope(),session=crypto.randomUUID();try{
  f.setExpected(input);await f.ledger.admit(input,now);await f.ledger.beginAcquire(input,now);f.ledger.recordAcquired(input,session);await f.ledger.beforeWork(input,now);
  f.setExpected({...input,expectedBase:"9".repeat(40)});await expect(f.ledger.beforeWork(input,now)).rejects.toThrow("authority changed");
  f.setExpected(input);await expect(f.ledger.beforeWork({...input,buildDigest:"0".repeat(64)},now)).rejects.toThrow("context changed");
  f.setAllowed(false);f.setClosure({sessionId:session,observation:"absent",observedAt:now.getTime()});expect((await f.ledger.close(input)).phase).toBe("closed");
  expect(f.managed.used("2026-10")).toBe(100000);
 }finally{f.db.close();}
});
test("explicit operator funding is required and denied admissions do not leak a slot or native floor",async()=>{
 const f=fixture();try{
  f.setReservation(null);await expect(f.ledger.admit(scope(),now)).rejects.toThrow();
  expect(f.managed.used("2026-10")).toBe(0);expect(f.db.query("SELECT COUNT(*) AS n FROM browser_session_leases").get()).toEqual({n:0});
  f.setReservation(99999);await expect(f.ledger.admit(scope(),now)).rejects.toThrow();
  f.setReservation(100000);const input=scope();f.setAllowed(false);await expect(f.ledger.admit(input,now)).rejects.toThrow("authority changed");expect(f.fundingCalls()).toBe(2);
  f.setAllowed(true);await f.ledger.admit(input,now);expect(f.managed.used("2026-10",undefined,"essential")).toBe(0);
 }finally{f.db.close();}
});
test("cancel before acquire derives never-acquired fact while acquire/close races never free unknown sessions",async()=>{
 const f=fixture(),input=scope();try{
  await f.ledger.admit(input,now);const [closed,acquire]=await Promise.all([f.ledger.close(input),f.ledger.beginAcquire(input,now)]);
  expect(closed.phase).toBe("closed");expect(closed.closure?.observation).toBe("never-acquired");expect(acquire).toBe(false);expect(f.closureIds).toEqual([]);expect(f.managed.used("2026-10")).toBe(100000);
  const second=scope();await f.ledger.admit(second,now);expect(await f.ledger.beginAcquire(second,now)).toBe(true);expect((await f.ledger.close(second)).phase).toBe("cleanup_pending");
  await expect(f.ledger.admit(scope(),now)).rejects.toThrow("capacity is held");
 }finally{f.db.close();}
});

test("bounded authority and cleanup callbacks cannot release capacity after timeout",async()=>{
 const f=fixture(),input=scope();try{
  const blocked=new BrowserSessionBudget(f.storage as unknown as DurableObjectStorage,{...f.callbacks,authorize:()=>new Promise<()=>void>(()=>{})},{authorityMs:5,cleanupMs:5});
  await expect(blocked.admit(input,now)).rejects.toThrow("deadline");expect(f.managed.used("2026-10")).toBe(0);
  await f.ledger.admit(input,now);await f.ledger.beginAcquire(input,now);const session=crypto.randomUUID();f.ledger.recordAcquired(input,session);
  let complete:((value:BrowserSessionClosure)=>void)|undefined;
  const cleanup=new BrowserSessionBudget(f.storage as unknown as DurableObjectStorage,{...f.callbacks,attestClosure:()=>new Promise<BrowserSessionClosure>(resolve=>{complete=resolve;})},{cleanupMs:5});
  expect((await cleanup.close(input)).phase).toBe("cleanup_pending");
  complete?.({sessionId:session,observation:"closed",observedAt:Date.now()});await Promise.resolve();
  expect(f.ledger.get(input.leaseId)?.phase).toBe("cleanup_pending");await expect(f.ledger.admit(scope(),now)).rejects.toThrow("capacity is held");
 }finally{f.db.close();}
});
test("async authority fences are rejected atomically and cannot fund or acquire",async()=>{
 const f=fixture();try{
  const ledger=new BrowserSessionBudget(f.storage as unknown as DurableObjectStorage,{...f.callbacks,authorize:async()=>async()=>{await Promise.resolve();}});
  await expect(ledger.admit(scope(),now)).rejects.toThrow("must be synchronous");expect(f.managed.used("2026-10")).toBe(0);expect(f.fundingCalls()).toBe(0);
 }finally{f.db.close();}
});
test("native closure rejects extra caller-like flags and browser work has a real admission deadline",async()=>{
 const f=fixture(),input=scope(),session=crypto.randomUUID();try{
  await f.ledger.admit(input,now);await f.ledger.beginAcquire(input,now);f.ledger.recordAcquired(input,session);
  await expect(f.ledger.beforeWork(input,new Date(now.getTime()+120001))).rejects.toThrow("deadline");
  const extra={sessionId:session,observation:"closed" as const,observedAt:Date.now(),closed:true};f.setClosure(extra);
  expect((await f.ledger.close(input)).phase).toBe("cleanup_pending");
  f.setClosure({sessionId:session,observation:"closed",observedAt:Date.now()});expect((await f.ledger.close(input)).phase).toBe("closed");
 }finally{f.db.close();}
});

test("racing different admissions produce only one funded browser lease",async()=>{
 const f=fixture();try{
  const outcomes=await Promise.allSettled([f.ledger.admit(scope(),now),f.ledger.admit(scope(),now)]);
  expect(outcomes.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(outcomes.filter(result=>result.status==="rejected")).toHaveLength(1);
  expect(f.managed.used("2026-10")).toBe(100000);expect(f.fundingCalls()).toBe(1);
 }finally{f.db.close();}
});
test("browser admission cannot spend the protected essential floor",async()=>{
 const f=fixture();try{
  for(const [runId,accountKey] of [["optional-owner","owner"],["optional-other","other"]])expect(f.managed.reserve({runId:runId!,accountKey:accountKey!,resourceKind:"managed-agent",usdMicros:4000000,maxInputBytes:100,maxOutputTokens:10,maxCalls:1,maxContainerSeconds:1},{globalUsdMicros:10000000,accountUsdMicros:5000000,essentialGlobalUsdMicros:2000000,essentialAccountUsdMicros:1000000},now).allowed).toBe(true);
  await expect(f.ledger.admit(scope(),now)).rejects.toThrow("funding unavailable");expect(f.db.query("SELECT COUNT(*) AS n FROM browser_session_leases").get()).toEqual({n:0});
  expect(f.managed.used("2026-10")).toBe(8000000);expect(f.managed.used("2026-10",undefined,"essential")).toBe(0);
 }finally{f.db.close();}
});
