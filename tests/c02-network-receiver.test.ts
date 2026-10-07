import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {C02NetworkReceiverLedger,C02NetworkReceiverSqlStore,type C02NetworkReceiverState,type C02NetworkReceiverStore} from '../src/server/c02-network-receiver';
import {deriveC02NetworkProbeResults,type C02NetworkProbePlan} from '../src/server/c02-network-probe';
function fixture(){
 const state:C02NetworkReceiverState={plan:null,receipts:[]};let now=1000;
 const store:C02NetworkReceiverStore={async transaction(operation){const next=structuredClone(state);const result=operation(next);Object.assign(state,next);return result;}};
 const plan:C02NetworkProbePlan={scope:{requestId:'00000000-0000-4000-8000-000000000001',instanceId:'native-1',probeId:'00000000-0000-4000-8000-000000000002'},createdAt:1000,deadlineAt:121000,maxContainers:1,maxNativeSeconds:120,endpoints:[{channel:'https',receiverId:'owned-1',url:'https://flaregit-owned-delivery-verifier.simo-988.workers.dev/c02-network/probe',controlNonce:'a'.repeat(64),probeNonce:'b'.repeat(64)}]};
 const ledger=new C02NetworkReceiverLedger(store,()=>now),endpoint=plan.endpoints[0]!;
 const observation={scope:plan.scope,channel:endpoint.channel,receiverId:endpoint.receiverId,endpointUrl:endpoint.url,nonce:endpoint.controlNonce};
 return{state,plan,ledger,observation,setNow:(value:number)=>{now=value;},store};
}
test('registration is immutable, idempotent and detached from caller objects',async()=>{const f=fixture();await f.ledger.register(f.plan);await f.ledger.register(f.plan);const altered=structuredClone(f.plan);altered.deadlineAt--;await expect(f.ledger.register(altered)).rejects.toThrow('immutable');f.plan.scope.instanceId='mutated';expect(f.state.plan?.scope.instanceId).toBe('native-1');});
test('receiver distinguishes control and actual leaked probe nonce and preserves first timestamp',async()=>{const f=fixture();await f.ledger.register(f.plan);const control=await f.ledger.observe(f.observation);f.setNow(2000);expect(await f.ledger.observe(f.observation)).toEqual(control);const leaked=await f.ledger.observe({...f.observation,nonce:f.plan.endpoints[0]!.probeNonce});expect(leaked.kind).toBe('native-probe');const receipts=await f.ledger.receipts(f.plan.scope);expect(receipts).toHaveLength(2);expect(deriveC02NetworkProbeResults(f.plan,{receiver:receipts,denials:[],native:null}).find(item=>item.channel==='https')?.status).toBe('receiver-reached');receipts.length=0;expect(await f.ledger.receipts(f.plan.scope)).toHaveLength(2);});
test('rejects mismatched scope, transport, path, receiver and nonce without writes',async()=>{const f=fixture();await f.ledger.register(f.plan);for(const observation of [{...f.observation,scope:{...f.plan.scope,instanceId:'other'}},{...f.observation,channel:'http' as const},{...f.observation,endpointUrl:f.observation.endpointUrl+'/other'},{...f.observation,receiverId:'other'},{...f.observation,nonce:'c'.repeat(64)}])await expect(f.ledger.observe(observation)).rejects.toThrow();expect(f.state.receipts).toHaveLength(0);await expect(f.ledger.receipts({...f.plan.scope,probeId:'00000000-0000-4000-8000-000000000003'})).rejects.toThrow();});
test('trusted clock bounds receipt admission including duplicates, but retains historical evidence',async()=>{const f=fixture();await f.ledger.register(f.plan);await f.ledger.observe(f.observation);f.setNow(121001);await expect(f.ledger.observe(f.observation)).rejects.toThrow('expired');expect(await f.ledger.receipts(f.plan.scope)).toHaveLength(1);f.setNow(999);await expect(f.ledger.observe(f.observation)).rejects.toThrow('not yet');f.setNow(NaN);await expect(f.ledger.observe(f.observation)).rejects.toThrow('clock');});
test('fresh expired registration fails and restart uses persisted exact ledger',async()=>{const f=fixture();f.setNow(121000);await expect(f.ledger.register(f.plan)).rejects.toThrow();expect(f.state.plan).toBeNull();f.setNow(1000);await f.ledger.register(f.plan);await f.ledger.observe(f.observation);const restarted=new C02NetworkReceiverLedger(f.store,()=>2000);expect(await restarted.receipts(f.plan.scope)).toEqual(f.state.receipts);await expect(restarted.register({...f.plan,scope:{...f.plan.scope,instanceId:'other'}})).rejects.toThrow('immutable');});

test('SQLite retains receipts across connection restart and rolls back failed transactions',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'flaregit-receiver-')),path=join(directory,'ledger.sqlite');
 let db=new Database(path);
 const adapter=()=>({transactionSync:<T>(operation:()=>T)=>db.transaction(operation)(),exec:(query:string,...bindings:(string|number|null)[])=>db.query(query).all(...bindings) as Record<string,unknown>[]});
 try{
  const f=fixture(),store=new C02NetworkReceiverSqlStore(adapter()),ledger=new C02NetworkReceiverLedger(store,()=>1000);
  await ledger.register(f.plan);await ledger.observe(f.observation);
  await expect(store.transaction(state=>{state.receipts=[];throw Error('rollback');})).rejects.toThrow('rollback');
  db.close();db=new Database(path);
  const restarted=new C02NetworkReceiverLedger(new C02NetworkReceiverSqlStore(adapter()),()=>2000);
  expect(await restarted.receipts(f.plan.scope)).toHaveLength(1);
  expect((await restarted.observe(f.observation)).receivedAt).toBe(1000);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
