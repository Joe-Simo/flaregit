import {z} from 'zod';
import {c02NetworkProbePlanSchema,c02NetworkProbeScopeSchema,type C02NetworkProbePlan,type C02NetworkDenialReceipt} from './c02-network-probe';

const identifier=z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const c02NetworkInterceptorPropsSchema=z.object({scope:c02NetworkProbeScopeSchema,interceptorId:identifier}).strict();
export type C02NetworkInterceptorProps=z.infer<typeof c02NetworkInterceptorPropsSchema>;
const keys=['requestId','instanceId','probeId','channel','nonce'] as const;
/** Props must originate from the registered native interceptor, never request
 * headers/body. The persisted registration is supplied by its trusted owner. */
export function matchC02NetworkInterception(input:C02NetworkProbePlan,registered:C02NetworkInterceptorProps,props:unknown,request:Request,now=Date.now()):C02NetworkDenialReceipt|null{
 const plan=c02NetworkProbePlanSchema.safeParse(input),registration=c02NetworkInterceptorPropsSchema.safeParse(registered),context=c02NetworkInterceptorPropsSchema.safeParse(props);
 if(!plan.success||!registration.success||!context.success||!Number.isSafeInteger(now)||now<plan.data.createdAt||now>=plan.data.deadlineAt||request.method!=='GET')return null;
 const scope=plan.data.scope;
 for(const candidate of [registration.data,context.data])if(candidate.scope.requestId!==scope.requestId||candidate.scope.instanceId!==scope.instanceId||candidate.scope.probeId!==scope.probeId)return null;
 if(context.data.interceptorId!==registration.data.interceptorId)return null;
 let url:URL;try{url=new URL(request.url);}catch{return null;}
 if(url.username||url.password||url.hash||[...url.searchParams.keys()].length!==keys.length||keys.some(key=>url.searchParams.getAll(key).length!==1)||[...url.searchParams.keys()].some(key=>!keys.includes(key as typeof keys[number])))return null;
 if(url.searchParams.get('requestId')!==scope.requestId||url.searchParams.get('instanceId')!==scope.instanceId||url.searchParams.get('probeId')!==scope.probeId)return null;
 const endpoint=plan.data.endpoints.find(item=>item.channel===url.searchParams.get('channel'));if(!endpoint||url.searchParams.get('nonce')!==endpoint.probeNonce)return null;
 const expected=new URL(endpoint.url);if(url.origin!==expected.origin||url.pathname!==expected.pathname)return null;
 return{scope:structuredClone(scope),channel:endpoint.channel,nonce:endpoint.probeNonce,receivedAt:now,source:'registered-native-interceptor',interceptorId:registration.data.interceptorId};
}
