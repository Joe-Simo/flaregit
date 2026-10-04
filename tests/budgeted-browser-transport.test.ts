import {expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {BudgetedBrowserTransport,BudgetedBrowserTransportRouter,type BudgetedBrowserDependencies} from "../src/server/budgeted-browser-transport";
import {BrowserSessionBudget,type BrowserSessionScope} from "../src/server/browser-session-budget";
import {retireBrowserSession,type BrowserSdkPort,type BrowserSessionControl,type CloudflareBrowserTransportOptions} from "../src/server/cloudflare-browser-transport";

function fixture(mode:"connect-fail"|"unknown"|"late"|"quota"|"record-ack"="connect-fail"){
 const db=new Database(":memory:"),storage={sql:{exec(query:string,...bindings:Array<string|number|null>){if(query.includes(";")){db.exec(query);return{toArray:()=>[]};}const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}} as unknown as DurableObjectStorage;
 const scope:BrowserSessionScope={leaseId:crypto.randomUUID(),attemptId:crypto.randomUUID(),projectId:"p123456789abc",incarnation:crypto.randomUUID(),accountKey:"account",actorId:"actor",candidateId:"candidate",canonicalRepoName:"canonical",targetRef:"refs/heads/main",expectedBase:null,acceptedVersion:0,commit:"a".repeat(40),tree:"b".repeat(40),policyVersion:1,policyDigest:"c".repeat(64),buildDigest:"d".repeat(64),sourceDigest:"e".repeat(64),maxSeconds:120};
 const sessionId=crypto.randomUUID(),events:string[]=[],background:Promise<unknown>[]=[];let retired=false,acquires=0,connects=0,ackFailed=false;
 let resolveAcquire:(value:{sessionId:string})=>void=()=>{};const pending=new Promise<{sessionId:string}>(resolve=>{resolveAcquire=resolve;});
 const control:BrowserSessionControl={closeSession:async id=>{expect(id).toBe(sessionId);events.push("native-close");retired=true;return{sessionId:id,status:"closed"};},getSession:async id=>{expect(id).toBe(sessionId);return retired?null:{sessionId:id,startTime:Date.now()};}};
 const budget=new BrowserSessionBudget(storage,{authorize:async()=>()=>{},funding:()=>({reservationUsdMicros:100000,budget:{accountUsdMicros:mode==="quota"?0:1000000,globalUsdMicros:1000000}}),attestClosure:async id=>{const proof=await retireBrowserSession(control,id);return proof;}});
 const sdk:BrowserSdkPort={acquire:async(_binding,options)=>{acquires++;events.push("sdk-acquire");expect(budget.get(scope.leaseId)?.phase).toBe("acquire_possible");expect(options.guardrails?.allowedDomains).toEqual([`${scope.leaseId}.verification.invalid`]);if(mode==="unknown")throw new Error("Opaque acquisition failure");return mode==="late"?pending:{sessionId};},connect:async(_binding,id)=>{connects++;events.push("sdk-connect");expect(id).toBe(sessionId);expect(budget.get(scope.leaseId)?.sessionId).toBe(id);throw new Error("Synthetic connection unavailable");}};
 const deps:BudgetedBrowserDependencies={binding:{} as CloudflareBrowserTransportOptions["binding"],sessionControl:control,sdk,callbackTimeoutMs:mode==="late"?10:1000,cleanupTimeoutMs:1000,expectedScope:async()=>structuredClone(scope),retainBackground:work=>{background.push(work);},budget:{admitVerificationBrowser:input=>budget.admit(input),beginVerificationBrowserAcquire:input=>budget.beginAcquire(input),recordVerificationBrowserAcquired:async(input,id)=>{budget.recordAcquired(input,id);events.push("stored-session");if(mode==="record-ack"&&!ackFailed){ackFailed=true;throw new Error("Lost record acknowledgment");}},beforeVerificationBrowserWork:input=>budget.beforeWork(input),closeVerificationBrowser:input=>budget.close(input)}};const transport=new BudgetedBrowserTransport(scope,deps);
 const allocation={leaseId:scope.leaseId,origin:`https://${scope.leaseId}.verification.invalid`,signal:new AbortController().signal,isolation:"fresh-no-credentials" as const,intercept:async()=>({abort:true as const})};
 return{scope,sessionId,budget,transport,deps,allocation,events,background,resolveAcquire,counts:()=>({acquires,connects}),close:()=>db.close()};
}

test("actual global budget records exact acquired ID before connect and closes only that session",async()=>{
 const f=fixture();try{await expect(f.transport.allocate(f.allocation)).rejects.toThrow("connection");expect(f.events.indexOf("stored-session")).toBeLessThan(f.events.indexOf("sdk-connect"));expect(await f.transport.close(f.scope.leaseId)).toEqual({leaseId:f.scope.leaseId,closed:true});expect(f.budget.get(f.scope.leaseId)?.phase).toBe("closed");expect(f.budget.get(f.scope.leaseId)?.sessionId).toBe(f.sessionId);expect(f.counts()).toEqual({acquires:1,connects:1});await expect(f.transport.allocate(f.allocation)).rejects.toThrow("unused");}finally{f.close();}
});
test("opaque acquisition keeps global capacity held and never invents a session closure",async()=>{
 const f=fixture("unknown");try{await expect(f.transport.allocate(f.allocation)).rejects.toThrow();expect((await f.transport.close(f.scope.leaseId)).closed).toBe(false);expect(f.budget.get(f.scope.leaseId)).toMatchObject({phase:"cleanup_pending",sessionId:null,closure:null});expect(f.counts().connects).toBe(0);await expect(f.budget.admit({...f.scope,leaseId:crypto.randomUUID()})).rejects.toThrow("capacity");}finally{f.close();}
});
test("lost acquisition recording acknowledgment never connects and still uses exact native cleanup",async()=>{
 const f=fixture("record-ack");try{await expect(f.transport.allocate(f.allocation)).rejects.toThrow();await f.transport.close(f.scope.leaseId);expect(f.counts().connects).toBe(0);expect(f.budget.get(f.scope.leaseId)?.phase).toBe("closed");expect(f.events).toContain("native-close");}finally{f.close();}
});
test("late acquired ID is retained after deadline and retired without reconnecting",async()=>{
 const f=fixture("late");try{await expect(f.transport.allocate(f.allocation)).rejects.toThrow();expect((await f.transport.close(f.scope.leaseId)).closed).toBe(false);expect(f.budget.get(f.scope.leaseId)?.sessionId).toBeNull();f.resolveAcquire({sessionId:f.sessionId});await Promise.allSettled(f.background);expect(f.counts().connects).toBe(0);expect(f.budget.get(f.scope.leaseId)).toMatchObject({phase:"closed",sessionId:f.sessionId});}finally{f.close();}
});
test("quota denial and incorrect verification origin never acquire a provider browser",async()=>{
 const f=fixture("quota");try{await expect(f.transport.allocate(f.allocation)).rejects.toThrow("funding");expect(f.counts().acquires).toBe(0);}finally{f.close();}
 const wrong=fixture();try{await expect(wrong.transport.allocate({...wrong.allocation,origin:"https://example.com"})).rejects.toThrow("lease");expect(wrong.counts().acquires).toBe(0);}finally{wrong.close();}
});

test("case router consumes UUIDs and enforces its finite lease bound before provider calls",async()=>{
 const f=fixture();try{const router=new BudgetedBrowserTransportRouter({...f.deps,maxLeases:1,deriveScope:async leaseId=>({...f.scope,leaseId})});await expect(router.allocate(f.allocation)).rejects.toThrow("connection");expect((await router.close(f.scope.leaseId)).closed).toBe(true);await expect(router.allocate(f.allocation)).rejects.toThrow("Fresh bounded");const leaseId=crypto.randomUUID();await expect(router.allocate({...f.allocation,leaseId,origin:`https://${leaseId}.verification.invalid`})).rejects.toThrow("Fresh bounded");expect(f.counts().acquires).toBe(1);}finally{f.close();}
});
test("case router cancellation before scope derivation cannot later launch a browser",async()=>{
 const f=fixture();try{let resolveScope:(value:BrowserSessionScope)=>void=()=>{};const scope=new Promise<BrowserSessionScope>(resolve=>{resolveScope=resolve;});const router=new BudgetedBrowserTransportRouter({...f.deps,deriveScope:()=>scope});const allocating=router.allocate(f.allocation);void allocating.catch(()=>{});expect((await router.close(f.scope.leaseId)).closed).toBe(true);resolveScope(f.scope);await expect(allocating).rejects.toThrow();expect(f.counts().acquires).toBe(0);expect(f.budget.get(f.scope.leaseId)).toBeNull();}finally{f.close();}
});
test("case router rejects a foreign derived scope before admission",async()=>{
 const f=fixture();try{const router=new BudgetedBrowserTransportRouter({...f.deps,deriveScope:async()=>({...f.scope,leaseId:crypto.randomUUID()})});await expect(router.allocate(f.allocation)).rejects.toThrow("scope changed");expect(f.counts().acquires).toBe(0);}finally{f.close();}
});

test("whole cleanup deadline returns unknown while retaining the late scoped Global closure",async()=>{
 const f=fixture();try{
  f.deps.cleanupTimeoutMs=10;const transport=new BudgetedBrowserTransport(f.scope,f.deps);
  await expect(transport.allocate(f.allocation)).rejects.toThrow("connection");
  let resolveClosure:(value:Awaited<ReturnType<typeof f.budget.close>>)=>void=()=>{};const pending=new Promise<Awaited<ReturnType<typeof f.budget.close>>>(resolve=>{resolveClosure=resolve;});
  f.deps.budget.closeVerificationBrowser=()=>pending;
  const result=await transport.close(f.scope.leaseId);expect(result.closed).toBe(false);expect(f.budget.get(f.scope.leaseId)?.phase).not.toBe("closed");
  resolveClosure(await f.budget.close(f.scope));await Promise.allSettled(f.background);expect(f.budget.get(f.scope.leaseId)?.phase).toBe("closed");expect(f.budget.get(f.scope.leaseId)?.sessionId).toBe(f.sessionId);
 }finally{f.close();}
});
test("router cleanup shares the same bound and retains unfinished scoped cleanup",async()=>{
 const f=fixture();try{
  f.deps.cleanupTimeoutMs=10;const router=new BudgetedBrowserTransportRouter({...f.deps,deriveScope:async id=>({...f.scope,leaseId:id})});await expect(router.allocate(f.allocation)).rejects.toThrow("connection");
  let resolveClosure:(value:Awaited<ReturnType<typeof f.budget.close>>)=>void=()=>{};const pending=new Promise<Awaited<ReturnType<typeof f.budget.close>>>(resolve=>{resolveClosure=resolve;});f.deps.budget.closeVerificationBrowser=()=>pending;
  expect((await router.close(f.scope.leaseId)).closed).toBe(false);resolveClosure(await f.budget.close(f.scope));await Promise.allSettled(f.background);expect(f.budget.get(f.scope.leaseId)?.phase).toBe("closed");expect(f.counts().acquires).toBe(1);
 }finally{f.close();}
});
