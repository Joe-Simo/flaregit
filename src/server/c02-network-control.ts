import {z} from 'zod';
import {c02NetworkProbePlanSchema,c02NetworkProbeScopeSchema,c02NetworkChannels,type C02NetworkProbePlan,type C02NetworkReceiverReceipt} from './c02-network-probe';
import {c02NetworkInterceptorPropsSchema,type C02NetworkInterceptorProps} from './c02-network-interceptor';
const keys=['requestId','instanceId','probeId','channel','nonce'] as const;
const receiptSchema=z.object({scope:c02NetworkProbeScopeSchema,channel:z.enum(c02NetworkChannels),receiverId:z.string(),nonce:z.string(),receivedAt:z.number().int().positive().safe(),kind:z.literal('control'),source:z.literal('owned-receiver')}).strict();
const ackSchema=z.object({acknowledged:z.literal(true),receipt:receiptSchema}).strict();
export function matchC02NetworkControl(input:C02NetworkProbePlan,registration:C02NetworkInterceptorProps,props:unknown,request:Request,now=Date.now()){
 const parsed=c02NetworkProbePlanSchema.safeParse(input),saved=c02NetworkInterceptorPropsSchema.safeParse(registration),context=c02NetworkInterceptorPropsSchema.safeParse(props);
 if(!parsed.success||!saved.success||!context.success||!Number.isSafeInteger(now)||now<parsed.data.createdAt||now>=parsed.data.deadlineAt||request.method!=='GET')return null;
 const plan=parsed.data,scope=plan.scope;
 for(const candidate of [saved.data,context.data])if(candidate.scope.requestId!==scope.requestId||candidate.scope.instanceId!==scope.instanceId||candidate.scope.probeId!==scope.probeId)return null;
 if(saved.data.interceptorId!==context.data.interceptorId)return null;
 const url=new URL(request.url);
 if(url.username||url.password||url.hash||[...url.searchParams.keys()].length!==keys.length||keys.some(key=>url.searchParams.getAll(key).length!==1))return null;
 if(url.searchParams.get('requestId')!==scope.requestId||url.searchParams.get('instanceId')!==scope.instanceId||url.searchParams.get('probeId')!==scope.probeId)return null;
 const endpoint=plan.endpoints.find(item=>item.channel===url.searchParams.get('channel'));if(!endpoint||url.searchParams.get('nonce')!==endpoint.controlNonce)return null;
 const expected=new URL(endpoint.url);if(url.origin!==expected.origin||url.pathname!==expected.pathname)return null;
 return{plan,endpoint,url:url.href};
}
export type C02TrustedControlFetch=(request:Request,options:RequestInit)=>Promise<Response>;
/** The fetch implementation is trusted Worker code. Forwarding grants exactly
 * one registered control route; incoming headers and response headers stay out. */
export async function forwardC02NetworkControl(plan:C02NetworkProbePlan,registration:C02NetworkInterceptorProps,props:unknown,request:Request,fetcher:C02TrustedControlFetch,clock:()=>number=Date.now):Promise<{response:Response;receipt:C02NetworkReceiverReceipt|null}>{
 const refused=()=>({response:new Response('Control unavailable',{status:403,headers:{'Cache-Control':'no-store'}}),receipt:null});
 const match=matchC02NetworkControl(plan,registration,props,request,clock());if(!match)return refused();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(5000,match.plan.deadlineAt-clock()));
 let abort=()=>{};const aborted=new Promise<never>((_,reject)=>{abort=()=>reject(Error('Control deadline'));controller.signal.addEventListener('abort',abort,{once:true});});
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const upstream=await Promise.race([fetcher(new Request(match.url,{method:'GET',redirect:'manual',credentials:'omit',headers:{Accept:'application/json'},signal:controller.signal}),{redirect:'manual',credentials:'omit',signal:controller.signal}),aborted]);
  if(upstream.status!==200||upstream.redirected||!upstream.body)throw Error('Control acknowledgement unavailable');
  reader=upstream.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  for(;;){const part=await Promise.race([reader.read(),aborted]);if(part.done)break;size+=part.value.byteLength;if(size>8192)throw Error('Control acknowledgement exceeds bound');chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const receipt=ackSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))).receipt;
  const scope=match.plan.scope,now=clock();
  if(receipt.scope.requestId!==scope.requestId||receipt.scope.instanceId!==scope.instanceId||receipt.scope.probeId!==scope.probeId||receipt.channel!==match.endpoint.channel||receipt.receiverId!==match.endpoint.receiverId||receipt.nonce!==match.endpoint.controlNonce||receipt.receivedAt<match.plan.createdAt||receipt.receivedAt>=match.plan.deadlineAt||receipt.receivedAt>now||!Number.isSafeInteger(now)||now>=match.plan.deadlineAt)throw Error('Control acknowledgement identity differs');
  return{response:Response.json({acknowledged:true,receipt},{headers:{'Cache-Control':'no-store'}}),receipt};
 }catch{return refused();}finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);if(reader)void reader.cancel().catch(()=>{});}
}
