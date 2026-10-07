import {c02NetworkProbePlanSchema,type C02NetworkProbePlan,type C02NetworkProbeScope,type C02NetworkReceiverReceipt} from './c02-network-probe';

/** Adapter must make the entire callback atomic and persist successful writes.
 * Construct this ledger only behind the authenticated operator/receiver boundary;
 * registration and receipt timestamps must never come from request bodies. */
export interface C02NetworkReceiverStore {
 transaction<T>(operation:(state:C02NetworkReceiverState)=>T):Promise<T>;
}
export interface C02NetworkReceiverState {
 plan:C02NetworkProbePlan|null;
 receipts:C02NetworkReceiverReceipt[];
}
export interface C02NetworkReceiverObservation {
 scope:C02NetworkProbeScope;
 channel:C02NetworkProbePlan['endpoints'][number]['channel'];
 receiverId:string;
 nonce:string;
 /** Actual request origin/path as observed by the trusted receiver handler. */
 endpointUrl:string;
}
const sameScope=(a:C02NetworkProbeScope,b:C02NetworkProbeScope)=>a.requestId===b.requestId&&a.instanceId===b.instanceId&&a.probeId===b.probeId;
function clockTime(now:number){if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid receiver clock');return now;}
function samePlan(a:C02NetworkProbePlan,b:C02NetworkProbePlan){return JSON.stringify(a)===JSON.stringify(b);}

/** One durable ledger per probe. Never reuse a completed ledger for another scope. */
export class C02NetworkReceiverLedger {
 constructor(private readonly store:C02NetworkReceiverStore,private readonly clock:()=>number=Date.now){}
 async register(input:C02NetworkProbePlan):Promise<C02NetworkProbePlan>{
  const plan=c02NetworkProbePlanSchema.parse(structuredClone(input)),now=clockTime(this.clock());
  return this.store.transaction(state=>{
   if(state.plan){if(!samePlan(state.plan,plan))throw Error('Receiver registration is immutable');return structuredClone(state.plan);}
   if(state.receipts.length!==0)throw Error('Receiver ledger has receipts without registration');
   if(now<plan.createdAt||now>=plan.deadlineAt)throw Error('Receiver registration expired or not yet valid');
   state.plan=structuredClone(plan);return structuredClone(plan);
  });
 }
 async observe(input:C02NetworkReceiverObservation):Promise<C02NetworkReceiverReceipt>{
  const observation=structuredClone(input),now=clockTime(this.clock());
  return this.store.transaction(state=>{
   const plan=state.plan;if(!plan||!sameScope(plan.scope,observation.scope))throw Error('Receiver scope mismatch');
   const endpoint=plan.endpoints.find(value=>value.channel===observation.channel);
   if(!endpoint||endpoint.receiverId!==observation.receiverId||endpoint.url!==observation.endpointUrl)throw Error('Receiver endpoint mismatch');
   const kind=observation.nonce===endpoint.controlNonce?'control':observation.nonce===endpoint.probeNonce?'native-probe':null;
   if(!kind)throw Error('Receiver nonce mismatch');
   if(now<plan.createdAt||now>plan.deadlineAt)throw Error('Receiver observation expired or not yet valid');
   const existing=state.receipts.find(value=>value.channel===endpoint.channel&&value.kind===kind);
   if(existing)return structuredClone(existing);
   if(state.receipts.length>=plan.endpoints.length*2)throw Error('Receiver receipt bound exceeded');
   const receipt:C02NetworkReceiverReceipt={scope:structuredClone(plan.scope),channel:endpoint.channel,receiverId:endpoint.receiverId,nonce:observation.nonce,receivedAt:now,kind,source:'owned-receiver'};
   state.receipts.push(receipt);return structuredClone(receipt);
  });
 }
 async receipts(scope:C02NetworkProbeScope):Promise<C02NetworkReceiverReceipt[]>{
  return this.store.transaction(state=>{if(!state.plan||!sameScope(state.plan.scope,scope))throw Error('Receiver scope mismatch');return structuredClone(state.receipts);});
 }
}

/** Supply DO storage.transactionSync and storage.sql.exec, or equivalent Bun
 * SQLite operations. The transaction callback must roll back on exceptions. */
export interface C02NetworkReceiverSql {
 transactionSync<T>(operation:()=>T):T;
 exec(query:string,...bindings:(string|number|null)[]):Iterable<Record<string,unknown>>;
}
export class C02NetworkReceiverSqlStore implements C02NetworkReceiverStore {
 constructor(private readonly sql:C02NetworkReceiverSql){
  sql.exec('CREATE TABLE IF NOT EXISTS c02_network_receiver_ledger (id INTEGER PRIMARY KEY CHECK(id = 1), state TEXT NOT NULL)');
 }
 async transaction<T>(operation:(state:C02NetworkReceiverState)=>T):Promise<T>{
  return this.sql.transactionSync(()=>{
   const row=Array.from(this.sql.exec('SELECT state FROM c02_network_receiver_ledger WHERE id = 1'))[0];
   const state:C02NetworkReceiverState=row?JSON.parse(String(row.state)):{plan:null,receipts:[]};
   const result=operation(state);
   this.sql.exec('INSERT INTO c02_network_receiver_ledger (id, state) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state',JSON.stringify(state));
   return result;
  });
 }
}
