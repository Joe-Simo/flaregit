import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";
interface Snapshot{slots:Array<{id:string;account_key:string}>;scope:string;calls:Array<{kind:string;value:string}>;spent:number;operation:{status:string;tree:string;receipt?:{commit:string;tree:string}};native:{active:boolean;token:string}}
test("real workerd recovery Workflow preserves owner authority, charges fresh actors, and reuses cache with exhausted budget",async()=>{
 if(await workerdChild("tests/private-recovery-workflow.test.ts"))return;
 const path=`/tmp/flaregit-recovery-workflow-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/private-recovery-workflow-worker.ts","--target=node","--external=cloudflare:workers","--external=node:crypto",`--outfile=${path}`],{stdout:"ignore",stderr:"pipe"});if(await build.exited!==0)throw new Error(await new Response(build.stderr).text());const script=await Bun.file(path).text();await Bun.file(path).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"recovery-fixture",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{REPOSITORY_CONTROLLER:{className:"RecoveryLedgerFixture",useSQLite:true}},r2Buckets:["EVIDENCE_BUCKET"],workflows:{RECOVERY:{name:"recovery",className:"RecoveryWorkflowFixture"}},serviceBindings:{INTEGRATOR:{name:"recovery-fixture",entrypoint:"RecoveryIntegratorFixture"}},bindings:{MANAGED_ACCOUNT_MONTHLY_USD_MICROS:"1000000",MANAGED_GLOBAL_MONTHLY_USD_MICROS:"1000000"}}]}));
 const id=crypto.randomUUID();const request=async(route:string)=>(await mf.getWorker("recovery-fixture")).fetch(`http://test${route}${route.includes("?")?"&":"?"}id=${id}`);const snapshot=async()=>await(await request("/snapshot")).json() as Snapshot;
 const settled=async(project?:string,scope?:string)=>{for(let i=0;i<200;i++){const value=await(await request(`/status?${project?`project=${project}&`:""}${scope?`scope=${scope}`:""}`)).json() as{status:string};if(value.status==="complete"||value.status==="errored")return value.status;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error("Workflow did not settle");};
 try{
 expect((await request("/seed")).status).toBe(200);expect((await request("/prepare?member=true")).status).toBe(500);expect((await request("/prepare?wrong=true")).status).toBe(500);expect((await request("/prepare")).status).toBe(200);
 await request("/flags?exec=fail&stop=fail");expect((await request("/start")).status).toBe(200);expect(await settled()).toBe("errored");const failed=await snapshot();expect(failed.spent).toBe(43008);expect(failed.native.active).toBe(true);expect(failed.operation.receipt).toBeUndefined();
 await request("/flags");
 // Reusing a client UUID in another repository and a recreated incarnation
 // must select distinct global Workflow identities, compute actors and charges.
 const other="p987654321abc",otherRequest=(route:string)=>request(`${route}${route.includes("?")?"&":"?"}project=${other}`);
 expect((await otherRequest("/seed")).status).toBe(200);expect((await otherRequest("/prepare")).status).toBe(200);
 const otherBefore=await(await otherRequest("/snapshot")).json() as Snapshot;expect(otherBefore.scope).not.toBe(failed.scope);
 expect((await otherRequest("/start")).status).toBe(200);expect(await settled(other)).toBe("complete");
 const otherComplete=await(await otherRequest("/snapshot")).json() as Snapshot;expect(otherComplete.spent).toBe(86016);expect(otherComplete.native.token).not.toBe(failed.native.token);expect((await snapshot()).operation.receipt).toBeUndefined();expect((await snapshot()).native).toEqual(failed.native);
 await request("/flags");expect((await request("/restart")).status).toBe(200);expect(await settled()).toBe("complete");const complete=await snapshot();expect(complete.spent).toBe(129024);expect(complete.native.active).toBe(false);expect(complete.native.token).not.toBe(failed.native.token);expect(complete.operation.receipt).toMatchObject({commit:"a".repeat(40),tree:"b".repeat(40)});expect(new Set(complete.calls.filter(call=>call.kind==="exec").map(call=>call.value)).size).toBe(3);expect(complete.calls.filter(call=>call.kind==="destroy").map(call=>call.value)).toContain(`native-${failed.native.token}`);

 expect((await otherRequest("/rotate")).status).toBe(200);expect((await otherRequest("/prepare")).status).toBe(200);
 const recreated=await(await otherRequest("/snapshot")).json() as Snapshot;expect(recreated.scope).not.toBe(otherComplete.scope);expect(recreated.native).toBeNull();
 expect((await otherRequest(`/restart?scope=${otherComplete.scope}`)).status).toBe(200);expect(await settled(other,otherComplete.scope)).toBe("errored");
 const afterStale=await(await otherRequest("/snapshot")).json() as Snapshot;expect(afterStale.spent).toBe(recreated.spent);expect(afterStale.calls).toEqual(recreated.calls);expect(afterStale.operation.status).toBe("pending");expect(afterStale.native).toBeNull();
 expect((await otherRequest("/start")).status).toBe(200);expect(await settled(other)).toBe("complete");const recreatedComplete=await(await otherRequest("/snapshot")).json() as Snapshot;expect(recreatedComplete.spent).toBe(172032);expect(recreatedComplete.native.token).not.toBe(otherComplete.native.token);expect((await snapshot()).operation.receipt).toEqual(complete.operation.receipt);expect((await snapshot()).native).toEqual(complete.native);
 expect((await request("/exhaust")).status).toBe(200);const beforeCache=await snapshot();expect(beforeCache.spent).toBe(1000000);
 const download=await request("/download");expect(download.status).toBe(200);expect(download.headers.get("Cache-Control")).toBe("no-store");expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([1,2,3]));expect((await snapshot()).calls).toEqual(beforeCache.calls);expect((await snapshot()).spent).toBe(beforeCache.spent);
 // Simulate interruption after complete upload but before its receipt document persists.
 expect((await request("/drop-receipt")).status).toBe(200);expect((await request("/receipt-document")).status).toBe(404);
 expect((await request("/restart")).status).toBe(200);expect(await settled()).toBe("complete");expect(await(await request("/receipt-document")).json()).toEqual(complete.operation.receipt);const cached=await snapshot();expect(cached.calls).toEqual(beforeCache.calls);expect(cached.spent).toBe(beforeCache.spent);expect(cached.operation.receipt).toEqual(complete.operation.receipt);

 // A complete object with mismatched immutable metadata must remain held for
 // confirmed cleanup, without allocating a second object or compute reservation.
 expect((await otherRequest("/reserve-current")).status).toBe(200);const beforeMalformed=await(await otherRequest("/snapshot")).json() as Snapshot;expect(beforeMalformed.slots.map(slot=>slot.id)).toContain(recreatedComplete.scope);
 expect((await otherRequest("/corrupt-object")).status).toBe(200);expect((await otherRequest("/restart")).status).toBe(200);expect(await settled(other)).toBe("errored");const malformed=await(await otherRequest("/snapshot")).json() as Snapshot;expect(malformed.slots).toEqual(beforeMalformed.slots);expect(malformed.calls).toEqual(beforeMalformed.calls);expect(malformed.spent).toBe(beforeMalformed.spent);expect(malformed.native).toEqual(beforeMalformed.native);expect((await otherRequest("/receipt-document")).status).toBe(404);
 expect((await request("/demote-owner")).status).toBe(200);
 const readerDownload=await request("/download?actor=reader");expect(readerDownload.status).toBe(200);expect(new Uint8Array(await readerDownload.arrayBuffer())).toEqual(new Uint8Array([1,2,3]));
 const preparerDownload=await request("/download?actor=owner");expect(preparerDownload.status).toBe(200);expect(new Uint8Array(await preparerDownload.arrayBuffer())).toEqual(new Uint8Array([1,2,3]));
 expect((await request("/download?actor=stranger")).status).toBe(403);
 const revoked=await request("/download?actor=reader&revoke=true");expect(revoked.status).toBe(200);expect(await revoked.arrayBuffer().then(bytes=>bytes.byteLength,()=>0)).toBe(0);expect((await request("/download?actor=reader")).status).toBe(403);
 expect((await snapshot()).calls).toEqual(beforeCache.calls);expect((await snapshot()).spent).toBe(beforeCache.spent);
 }finally{await mf.dispose();}
},30000);
