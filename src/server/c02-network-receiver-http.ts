import {z} from 'zod';
import {c02NetworkChannels,c02NetworkProbePlanSchema,c02NetworkProbeScopeSchema} from './c02-network-probe';
import {type C02NetworkReceiverLedger} from './c02-network-receiver';

const MAX_BODY_BYTES=8192;
const observationSchema=c02NetworkProbeScopeSchema.extend({channel:z.enum(c02NetworkChannels),nonce:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const response=(status:number,data:object)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function query(url:URL,keys:readonly string[]){
 if(url.search.length>1024)throw Error('Invalid query');
 const values:Record<string,string>={};
 for(const [key,value] of url.searchParams){if(!keys.includes(key)||Object.hasOwn(values,key))throw Error('Invalid query');values[key]=value;}
 if(Object.keys(values).length!==keys.length)throw Error('Invalid query');return values;
}
async function boundedJson(request:Request,timeoutMs:number){
 if(request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw Error('Invalid body');
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY_BYTES))throw Error('Invalid body');
 if(!request.body)throw Error('Invalid body');
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(Error('Body deadline exceeded'));void reader.cancel().catch(()=>{});},timeoutMs);});
 try{for(;;){const result=await Promise.race([reader.read(),deadline]);if(result.done)break;size+=result.value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();throw Error('Invalid body');}chunks.push(result.value);}}
 finally{clearTimeout(timer);reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export interface C02NetworkReceiverHttpOptions {
 ledger:C02NetworkReceiverLedger;
 /** Trusted operator authentication. Errors fail closed; never use query tokens. */
 authorizeOperator:(request:Request)=>Promise<boolean>|boolean;
 /** This receiver's configured identity, never read from untrusted input. */
 receiverId:string;
 /** Bounded body deadline; shorter values may be used by a test/operator. */
 bodyReadTimeoutMs?:number;
}
/** Mount under /c02-network/. Registration/readback are operator-only; the
 * observation endpoint intentionally accepts an exact pre-registered nonce. */
export function createC02NetworkReceiverHttpHandler(options:C02NetworkReceiverHttpOptions){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(options.receiverId))throw Error('Invalid receiver identity');
 const timeoutMs=options.bodyReadTimeoutMs??5000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw Error('Invalid body deadline');
 return async(request:Request):Promise<Response>=>{
  try{
   const url=new URL(request.url);
   if(url.pathname==='/c02-network/register'||url.pathname==='/c02-network/receipts'){
    if(!await options.authorizeOperator(request))return response(401,{error:'Unauthorized'});
    if(url.pathname==='/c02-network/register'){
     if(request.method!=='POST')return response(405,{error:'Method not allowed'});
     if(url.search)throw Error('Invalid query');
     const plan=c02NetworkProbePlanSchema.parse(await boundedJson(request,timeoutMs));
     if(plan.endpoints.some(endpoint=>endpoint.receiverId!==options.receiverId||new URL(endpoint.url).pathname==='/c02-network/register'||new URL(endpoint.url).pathname==='/c02-network/receipts'))throw Error('Invalid receiver registration');
     await options.ledger.register(plan);return response(200,{registered:true,scope:plan.scope});
    }
    if(request.method!=='GET')return response(405,{error:'Method not allowed'});
    const scope=c02NetworkProbeScopeSchema.parse(query(url,['requestId','instanceId','probeId']));
    return response(200,{receipts:await options.ledger.receipts(scope)});
   }
   if(!url.pathname.startsWith('/c02-network/'))return response(404,{error:'Not found'});
   if(request.method!=='GET')return response(405,{error:'Method not allowed'});
   if(url.username||url.password||url.hash)throw Error('Invalid endpoint');
   const input=observationSchema.parse(query(url,['requestId','instanceId','probeId','channel','nonce']));
   const receipt=await options.ledger.observe({scope:{requestId:input.requestId,instanceId:input.instanceId,probeId:input.probeId},channel:input.channel,nonce:input.nonce,receiverId:options.receiverId,endpointUrl:url.origin+url.pathname});
   return response(200,{acknowledged:true,receipt});
  }catch{return response(400,{error:'Receiver request rejected'});}
 };
}
