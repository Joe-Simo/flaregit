import {DurableObject} from 'cloudflare:workers';
import {z} from 'zod';
import {C02NetworkSandbox} from './c02-network-native';
import {createC02NetworkReceiverClient} from './c02-network-receiver-client';
import {c02NetworkChannels,deriveC02NetworkProbeResults,type C02NetworkProbePlan,type C02NetworkReceiverReceipt,type C02NetworkDenialReceipt} from './c02-network-probe';
import type {C02NetworkRuntimeState} from './c02-network-runtime';
import {ManagedSpendLedger} from './managed-spend-ledger';
export interface C02NetworkBatchEnvironment {
 NETWORK_NATIVE?:DurableObjectNamespace<C02NetworkSandbox>;
 C02_NETWORK_ENABLED?:string;
 C02_NETWORK_IMAGE?:string;
 C02_SOURCE_VERSION:string;
 CF_VERSION_METADATA:WorkerVersionMetadata;
 C02_RECEIVER_CONTROL_SECRET?:string;
 C02_NETWORK_RECEIVER?:Fetcher;
}
interface NetworkBatchRecord {
 requestId:string;plan:C02NetworkProbePlan;commandId:string;image:string;sourceVersion:string;workerVersion:string;
 phase:'prepared'|'native_possible'|'held'|'complete';native:C02NetworkRuntimeState|null;receiver:C02NetworkReceiverReceipt[];denials:C02NetworkDenialReceipt[];
}
const nativeName='fixed-c02-network-native-v1';
const uuid=z.uuid(),image=z.string().regex(/^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/),source=z.string().regex(/^[a-f0-9]{40}$/);
async function wait<T>(operation:Promise<T>,deadline:number):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Network provider deadline')),Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);}}
function nonce(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');}
/** Fixed security probe only. Has no repository or accepted-history capability. */
export class C02NetworkBatch extends DurableObject<C02NetworkBatchEnvironment>{
 private read():NetworkBatchRecord|null{this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS c02_network_batch(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL)');const row=this.ctx.storage.sql.exec<{doc:string}>('SELECT doc FROM c02_network_batch WHERE id=1').toArray()[0];return row?JSON.parse(row.doc) as NetworkBatchRecord:null;}
 private save(row:NetworkBatchRecord){this.ctx.storage.sql.exec('INSERT INTO c02_network_batch VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc',JSON.stringify(row));}
 private receiver(){if(!this.env.C02_RECEIVER_CONTROL_SECRET)throw Error('Receiver operator not configured');return createC02NetworkReceiverClient({operatorToken:this.env.C02_RECEIVER_CONTROL_SECRET,fetcher:this.env.C02_NETWORK_RECEIVER?(request,options)=>this.env.C02_NETWORK_RECEIVER!.fetch(request,options):undefined});}
 private job(row:NetworkBatchRecord){const namespace=this.env.NETWORK_NATIVE;if(!namespace||namespace.idFromName(nativeName).toString()!==row.plan.scope.instanceId)throw Error('Original native namespace unavailable');return namespace.getByName(nativeName);}
 private assert(row:NetworkBatchRecord){const current=this.read();if(!current||current.phase==='held'||current.phase==='complete'||current.requestId!==row.requestId||JSON.stringify(current.plan)!==JSON.stringify(row.plan)||this.env.C02_NETWORK_ENABLED!=='true'||this.env.C02_NETWORK_IMAGE!==row.image||this.env.C02_SOURCE_VERSION!==row.sourceVersion||this.env.CF_VERSION_METADATA.id!==row.workerVersion||Date.now()>=row.plan.deadlineAt)throw Error('Network batch authority unavailable');}
 status(){const row=this.read();if(!row)return{batch:null,fullC02Coverage:false,acceptanceEvidence:false};const native=row.native;const results=deriveC02NetworkProbeResults(row.plan,{receiver:row.receiver,denials:row.denials,native:native?{scope:native.plan.scope,commandId:native.commandId,commandSettled:native.commandSettled&&native.exitCode===0,stopped:native.nativeStopped}:null});return{batch:{requestId:row.requestId,originalPlan:structuredClone(row.plan),scope:row.plan.scope,sourceVersion:row.sourceVersion,workerVersion:row.workerVersion,image:row.image,phase:row.phase,deadlineAt:row.plan.deadlineAt,commandId:row.commandId,nativePhase:native?.phase??null,commandSettled:native?.commandSettled??false,controlSettled:native?.controlSettled??false,nativeCleanup:native?.nativeStopped??false,results,receiver:row.receiver,denials:row.denials},networkCoverage:results.every(item=>item.status==='denied-at-native-interceptor')?'four-http-framed-transports-denied':'incomplete',fullC02Coverage:false,acceptanceEvidence:false};}
 async start(requestId:string){uuid.parse(requestId);if(this.env.C02_NETWORK_ENABLED!=='true'||!this.env.NETWORK_NATIVE||!this.env.C02_RECEIVER_CONTROL_SECRET)throw Error('Network batch disabled or unconfigured');const old=this.read();if(old){if(old.requestId!==requestId)throw Error('Fixed network batch already consumed');return this.status();}
  const pinned=image.parse(this.env.C02_NETWORK_IMAGE),version=source.parse(this.env.C02_SOURCE_VERSION),createdAt=Date.now(),scope={requestId,instanceId:this.env.NETWORK_NATIVE.idFromName(nativeName).toString(),probeId:crypto.randomUUID()};
  const plan:C02NetworkProbePlan={scope,createdAt,deadlineAt:createdAt+120000,maxContainers:1,maxNativeSeconds:120,endpoints:c02NetworkChannels.map(channel=>({channel,receiverId:'flaregit-owned-network-v1',url:`${channel==='https'||channel==='raw-tls'?'https':'http'}://flaregit-owned-delivery-verifier.simo-988.workers.dev/c02-network/observe`,controlNonce:nonce(),probeNonce:nonce()}))};
  const row:NetworkBatchRecord={requestId,plan,commandId:crypto.randomUUID(),image:pinned,sourceVersion:version,workerVersion:this.env.CF_VERSION_METADATA.id,phase:'prepared',native:null,receiver:[],denials:[]};
  this.ctx.storage.transactionSync(()=>{if(this.read())throw Error('Fixed network batch already captured');const spend=new ManagedSpendLedger(this.ctx.storage);const admitted=spend.reserve({resourceKind:'native-optional',runId:'c02-network-'+requestId,accountKey:'c02-private-operator',usdMicros:43008,maxInputBytes:1,maxOutputTokens:1,maxCalls:1,maxContainerSeconds:120},{accountUsdMicros:43008,globalUsdMicros:43008});if(!admitted.allowed)throw Error('Network reservation unavailable');spend.consume('c02-network-'+requestId,0,0,120);this.save(row);});
  const actual=this.execute(row);this.ctx.waitUntil(actual.catch(()=>undefined));return this.status();
 }
 private async execute(row:NetworkBatchRecord){try{
  this.assert(row);await this.receiver().register(row.plan);this.assert(row);this.save({...row,phase:'native_possible'});
  const job=this.job(row);await wait(job.prepare(row.plan,[],row.commandId),row.plan.deadlineAt);this.assert(row);const native=await wait(job.run(row.plan.scope),row.plan.deadlineAt);
  const receiver=await this.receiver().receipts(row.plan),denials=await wait(job.denials(),Date.now()+8000);
  const current=this.read();if(!current||current.requestId!==row.requestId)throw Error('Original batch changed');const evidence={receiver,denials,native:{scope:native.plan.scope,commandId:native.commandId,commandSettled:native.commandSettled&&native.exitCode===0,stopped:native.nativeStopped}};
  const complete=deriveC02NetworkProbeResults(row.plan,evidence).every(item=>item.status==='denied-at-native-interceptor');this.save({...current,native,receiver,denials,phase:complete?'complete':'held'});
 }catch{const current=this.read();if(current?.requestId===row.requestId)this.save({...current,phase:'held'});}}
 /** Original-resource cleanup/readback only; never retries execution. */
 async recover(requestId:string){uuid.parse(requestId);const row=this.read();if(!row||row.requestId!==requestId)throw Error('Original network batch required');this.save({...row,phase:'held'});if(row.phase==='prepared')return this.status();const job=this.job(row);let native=row.native,receiver=row.receiver,denials=row.denials;
  try{native=await wait(job.stop(),Date.now()+8000);}catch{/* Unknown cleanup remains held. */}
  try{native=await wait(job.status(),Date.now()+8000);denials=await wait(job.denials(),Date.now()+8000);}catch{/* Original state stays retained. */}
  try{receiver=await this.receiver().receipts(row.plan);}catch{/* No absence inference. */}
  const current=this.read();if(!current||current.requestId!==requestId)throw Error('Original network batch changed');const complete=native&&deriveC02NetworkProbeResults(row.plan,{receiver,denials,native:{scope:native.plan.scope,commandId:native.commandId,commandSettled:native.commandSettled&&native.exitCode===0,stopped:native.nativeStopped}}).every(item=>item.status==='denied-at-native-interceptor');this.save({...current,native,receiver,denials,phase:complete?'complete':'held'});return this.status();
 }
}
