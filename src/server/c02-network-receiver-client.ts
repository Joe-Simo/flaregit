import {z} from 'zod';
import {c02NetworkChannels,c02NetworkProbePlanSchema,type C02NetworkProbePlan,type C02NetworkProbeScope,type C02NetworkReceiverReceipt} from './c02-network-probe';
const ORIGIN='https://flaregit-owned-delivery-verifier.simo-988.workers.dev';
const scopeSchema=z.object({requestId:z.uuid(),instanceId:z.string(),probeId:z.uuid()}).strict();
const receiptSchema=z.object({scope:scopeSchema,channel:z.enum(c02NetworkChannels),receiverId:z.string(),nonce:z.string().regex(/^[a-f0-9]{64}$/),receivedAt:z.number().int().positive().safe(),kind:z.enum(['control','native-probe']),source:z.literal('owned-receiver')}).strict();
const sameScope=(a:C02NetworkProbeScope,b:C02NetworkProbeScope)=>a.requestId===b.requestId&&a.instanceId===b.instanceId&&a.probeId===b.probeId;
export interface C02NetworkReceiverClient {
 register(plan:C02NetworkProbePlan):Promise<void>;
 receipts(plan:C02NetworkProbePlan):Promise<C02NetworkReceiverReceipt[]>;
 /** Only HTTP fetch controls. Raw socket controls require an independent native transport. */
 control(plan:C02NetworkProbePlan,channel:'http'|'https'):Promise<C02NetworkReceiverReceipt>;
}
export function createC02NetworkReceiverClient(options:{operatorToken:string;fetcher?:(request:RequestInfo|URL,options?:RequestInit)=>Promise<Response>;timeoutMs?:number}):C02NetworkReceiverClient{
 const timeoutMs=options.timeoutMs??5000,fetcher=options.fetcher??fetch;
 if(!options.operatorToken||/[\r\n]/.test(options.operatorToken)||options.operatorToken.length>4096||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw Error('Receiver client unavailable');
 async function request(url:string,init:RequestInit,authenticated:boolean):Promise<unknown>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(Error('Receiver request failed'));},timeoutMs);});
  try{return await Promise.race([deadline,(async()=>{
   const response=await fetcher(url,{...init,redirect:'manual',signal:controller.signal,headers:{...init.headers,...(authenticated?{Authorization:'Bearer '+options.operatorToken}:{})}});
   if(!response.ok||response.redirected||!response.body){await response.body?.cancel();throw Error('Receiver request failed');}
   const length=response.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>8192)){await response.body.cancel();throw Error('Receiver request failed');}
   reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>8192){await reader.cancel();throw Error('Receiver request failed');}chunks.push(item.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  })()]);}catch{throw Error('Receiver request failed');}finally{clearTimeout(timer);reader?.releaseLock();}
 }
 function validateReceipt(plan:C02NetworkProbePlan,value:unknown){const receipt=receiptSchema.parse(value),endpoint=plan.endpoints.find(item=>item.channel===receipt.channel);if(!endpoint||!sameScope(receipt.scope,plan.scope)||receipt.receiverId!==endpoint.receiverId||receipt.nonce!==(receipt.kind==='control'?endpoint.controlNonce:endpoint.probeNonce)||receipt.receivedAt<plan.createdAt||receipt.receivedAt>plan.deadlineAt)throw Error('Receiver response rejected');return receipt;}
 return{
  async register(input){try{const plan=c02NetworkProbePlanSchema.parse(structuredClone(input));const result=z.object({registered:z.literal(true),scope:scopeSchema}).strict().parse(await request(ORIGIN+'/c02-network/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(plan)},true));if(!sameScope(result.scope,plan.scope))throw Error();}catch{throw Error('Receiver registration failed');}},
  async receipts(input){try{const plan=c02NetworkProbePlanSchema.parse(structuredClone(input)),url=ORIGIN+'/c02-network/receipts?'+new URLSearchParams(plan.scope);const result=z.object({receipts:z.array(receiptSchema).max(8)}).strict().parse(await request(url,{method:'GET'},true));const receipts=result.receipts.map(value=>validateReceipt(plan,value));if(new Set(receipts.map(value=>value.channel+':'+value.kind)).size!==receipts.length)throw Error();return receipts;}catch{throw Error('Receiver read failed');}},
  async control(input,channel){try{const plan=c02NetworkProbePlanSchema.parse(structuredClone(input));if(channel!=='http'&&channel!=='https')throw Error();const endpoint=plan.endpoints.find(item=>item.channel===channel);if(!endpoint)throw Error();const url=new URL(endpoint.url);url.search=new URLSearchParams({...plan.scope,channel,nonce:endpoint.controlNonce}).toString();const result=z.object({acknowledged:z.literal(true),receipt:receiptSchema}).strict().parse(await request(url.href,{method:'GET',credentials:'omit'},false));const receipt=validateReceipt(plan,result.receipt);if(receipt.channel!==channel||receipt.kind!=='control')throw Error();return receipt;}catch{throw Error('Receiver control failed');}}
 };
}
