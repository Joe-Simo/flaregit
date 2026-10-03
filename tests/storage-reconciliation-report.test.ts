import {describe,expect,test} from "bun:test";
import {storageReconciliationReport,type StorageReconciliationCallbacks,type StorageReconciliationSnapshot} from "../src/server/storage-reconciliation-report.js";
const projectId="projectabc123",incarnation="12345678-1234-1234-1234-123456789abc";
const snapshot=(count=1):StorageReconciliationSnapshot=>({scope:{projectId,incarnation,epoch:"7"},plans:[{identity:{projectId,incarnation},kind:"preview",physicalKey:`builds/${projectId}/${"a".repeat(40)}`,keys:Array.from({length:count},(_,index)=>`builds/${projectId}/${"a".repeat(40)}/${index}.html`),bytes:count,currentWriter:true,unfinishedCount:1}],legacyInventory:true,legacyEvidence:true,plansComplete:true});
function callbacks(overrides:Partial<StorageReconciliationCallbacks>={}):StorageReconciliationCallbacks{return {authorize:async()=>true,head:async()=>null,list:async()=>({objects:[],truncated:false}),...overrides};}
describe("storage reconciliation report",()=>{
 test("absence preserves unknown writers, legacy holds and excludes private keys",async()=>{
  const result=await storageReconciliationReport({snapshot:snapshot()},callbacks());
  expect(result.observations[0]?.status).toBe("absent");expect(result.plans[0]?.unfinishedCount).toBe(1);expect(result.holdsPreserved).toBe(true);expect(result.absenceConfirmsCancellation).toBe(false);
  expect(JSON.stringify(result)).not.toContain(projectId);expect(JSON.stringify(result)).not.toContain(incarnation);expect(JSON.stringify(result)).not.toContain("builds/");
 });
 test("revocation after HEAD rejects without returning observations",async()=>{
  let allowed=true,listed=0;
  await expect(storageReconciliationReport({snapshot:snapshot()},callbacks({authorize:async()=>allowed,head:async()=>{allowed=false;return null;},list:async()=>{listed++;return {objects:[],truncated:false};}}))).rejects.toThrow("Storage reconciliation unavailable");
  expect(listed).toBe(0);
 });
 test("revocation after scoped listing rejects",async()=>{
  let allowed=true;
  await expect(storageReconciliationReport({snapshot:snapshot(0)},callbacks({authorize:async()=>allowed,list:async()=>{allowed=false;return {objects:[],truncated:false};}}))).rejects.toThrow("Storage reconciliation unavailable");
 });
 test("foreign scope fails before provider details are requested",async()=>{
  const value=snapshot();value.plans[0]!.identity.incarnation="87654321-1234-1234-1234-123456789abc";let reads=0;
  await expect(storageReconciliationReport({snapshot:value},callbacks({head:async()=>{reads++;return null;}}))).rejects.toThrow("Storage reconciliation unavailable");expect(reads).toBe(0);
 });
 test("bounded pages pin snapshot and provider concurrency",async()=>{
  let active=0,maximum=0,reads=0;const value=snapshot(40);
  const provider=callbacks({head:async()=>{active++;reads++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return null;}});
  const first=await storageReconciliationReport({snapshot:value},provider);expect(reads).toBe(32);expect(maximum).toBeLessThanOrEqual(6);expect(first.complete).toBe(false);expect(first.cursor).toBeTruthy();
  const last=await storageReconciliationReport({snapshot:value,cursor:first.cursor!},provider);expect(reads).toBe(40);expect(last.cursor).toBeNull();expect(last.complete).toBe(false);expect(last.pageComplete).toBe(true);
  value.scope.epoch="8";await expect(storageReconciliationReport({snapshot:value,cursor:first.cursor!},provider)).rejects.toThrow("Storage reconciliation unavailable");expect(reads).toBe(40);
 });
 test("provider errors and unfinished snapshot pagination remain incomplete without leaking errors",async()=>{
  const value=snapshot();value.plansComplete=false;
  const result=await storageReconciliationReport({snapshot:value},callbacks({head:async()=>{throw new Error("secret-private-provider-key");},list:async()=>({objects:[],truncated:true})}));
  expect(result.complete).toBe(false);expect(result.observations[0]?.status).toBe("unknown");expect(JSON.stringify(result)).not.toContain("secret-private-provider-key");expect(result.inventory.every(item=>item.status==="incomplete")).toBe(true);
 });
});

test("generation previews use exact incarnation and generation scope, with both inventory prefixes observed",async()=>{
 const value=snapshot(),generation="22222222-2222-4222-8222-222222222222",prefix=`build-generations/${projectId}/${incarnation}/${"a".repeat(40)}/${generation}`;
 value.plans[0]!.physicalKey=prefix;value.plans[0]!.keys=[`${prefix}/assets/foo..js`,`${prefix}/index.html`];
 const listed:string[]=[];const result=await storageReconciliationReport({snapshot:value},callbacks({list:async options=>{if(!options.prefix)throw new Error("Expected scoped prefix");listed.push(options.prefix);return{objects:[],truncated:false};}}));
 expect(result.observations).toHaveLength(2);expect(result.inventory.filter(item=>item.kind==="preview")).toHaveLength(1);
 expect(listed).toEqual([`builds/${projectId}/`,`build-generations/${projectId}/${incarnation}/`,`evidence/${projectId}/${incarnation}/`,`private-recovery/${projectId}/${incarnation}/`]);
 expect(JSON.stringify(result)).not.toContain(generation);expect(result.holdsPreserved).toBe(true);
 for(const physical of [prefix.replace(incarnation,"33333333-3333-4333-8333-333333333333"),`${prefix}/extra`,prefix.replace(generation,"invalid-generation")]){const invalid=structuredClone(value);invalid.plans[0]!.physicalKey=physical;invalid.plans[0]!.keys=[`${physical}/index.html`];let reads=0;await expect(storageReconciliationReport({snapshot:invalid},callbacks({head:async()=>{reads++;return null;}}))).rejects.toThrow();expect(reads).toBe(0);}
});
test("generation inventory uncertainty and revocation do not certify absence",async()=>{
 const value=snapshot(0);const result=await storageReconciliationReport({snapshot:value},callbacks({list:async options=>{if(!options.prefix)throw new Error("Expected scoped prefix");if(options.prefix.startsWith("build-generations/"))throw new Error("private-key");return{objects:[],truncated:false};}}));
 expect(result.inventory.find(item=>item.kind==="preview")?.status).toBe("unknown");expect(result.complete).toBe(false);expect(JSON.stringify(result)).not.toContain("private-key");
 let allowed=true,lists=0;await expect(storageReconciliationReport({snapshot:value},callbacks({authorize:async()=>allowed,list:async options=>{lists++;if(!options.prefix)throw new Error("Expected scoped prefix");if(options.prefix.startsWith("build-generations/"))allowed=false;return{objects:[],truncated:false};}}))).rejects.toThrow();expect(lists).toBe(2);
});
