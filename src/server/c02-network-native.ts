import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {C02NetworkRuntime} from './c02-network-runtime';
import {c02NetworkProbePlanSchema,type C02NetworkProbePlan,type C02NetworkProbeScope,type C02NetworkReceiverReceipt,type C02NetworkDenialReceipt} from './c02-network-probe';
import {createC02NetworkReceiverClient} from './c02-network-receiver-client';
import {matchC02NetworkControl,forwardC02NetworkControl} from './c02-network-control';
import {c02NetworkInterceptorPropsSchema,matchC02NetworkInterception,type C02NetworkInterceptorProps} from './c02-network-interceptor';

interface NetworkEnvironment {
 C02_NETWORK_ENABLED?:string;
 C02_NETWORK_IMAGE?:string;
 C02_RECEIVER_CONTROL_SECRET?:string;
 C02_NETWORK_RECEIVER?:Fetcher;
 NETWORK_NATIVE?:DurableObjectNamespace<C02NetworkSandbox>;
}
const name='fixed-c02-network-native-v1';
interface Registration {plan:C02NetworkProbePlan;interceptor:C02NetworkInterceptorProps}
/** Dedicated native probe. Operator credentials remain in the Worker; none enter the container. */
export class C02NetworkSandbox extends DurableObject<NetworkEnvironment>{
 private registered():Registration|null{
  this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS c02_network_registration(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL)');
  const row=this.ctx.storage.sql.exec<{doc:string}>('SELECT doc FROM c02_network_registration WHERE id=1').toArray()[0];
  return row?JSON.parse(row.doc) as Registration:null;
 }
 private identity(){if(!this.env.NETWORK_NATIVE||this.env.NETWORK_NATIVE.idFromName(name).toString()!==this.ctx.id.toString())throw Error('Registered network namespace required');}
 private enabled(){this.identity();if(this.env.C02_NETWORK_ENABLED!=='true')throw Error('Network execution disabled');}
 private runtime(){const registered=this.registered();if(!registered||!this.env.C02_NETWORK_IMAGE)throw Error('Network registration unavailable');
  // This standalone canary keeps generated ambient bindings module-local.
  const exports=this.ctx.exports as Cloudflare.Exports & {C02ScopedNetworkDeny:LoopbackServiceStub<C02ScopedNetworkDeny>;C02ScopedNetworkControl:LoopbackServiceStub<C02ScopedNetworkControl>};
  const interceptor=exports.C02ScopedNetworkDeny({props:registered.interceptor});
  const controls=this.env.C02_RECEIVER_CONTROL_SECRET?{
   interceptor:exports.C02ScopedNetworkControl({props:registered.interceptor}),
   readReceipts:()=>createC02NetworkReceiverClient({operatorToken:this.env.C02_RECEIVER_CONTROL_SECRET!,fetcher:this.env.C02_NETWORK_RECEIVER?(request,options)=>this.env.C02_NETWORK_RECEIVER!.fetch(request,options):undefined}).receipts(registered.plan),
  }:undefined;
  return new C02NetworkRuntime(this.ctx.storage,()=>this.ctx.container,interceptor,this.ctx.id.toString(),this.env.C02_NETWORK_IMAGE,Date.now,controls);
 }
 prepare(plan:C02NetworkProbePlan,controls:C02NetworkReceiverReceipt[],commandId:string){
  this.enabled();plan=c02NetworkProbePlanSchema.parse(plan);if(plan.scope.instanceId!==this.ctx.id.toString())throw Error('Native instance differs');
  this.ctx.storage.transactionSync(()=>{const old=this.registered();if(old&&JSON.stringify(old.plan)!==JSON.stringify(plan))throw Error('Native registration immutable');if(!old){const registration:Registration={plan,interceptor:{scope:plan.scope,interceptorId:crypto.randomUUID()}};this.ctx.storage.sql.exec('INSERT INTO c02_network_registration VALUES(1,?)',JSON.stringify(registration));}});
  this.runtime().prepare(plan,controls,commandId);
 }
 async run(scope:C02NetworkProbeScope){this.enabled();return this.runtime().run(scope);}
 status(){this.identity();return this.registered()?this.runtime().status():null;}
 async stop(){this.identity();return this.registered()?this.runtime().stop():null;}
 override async alarm(){if(this.registered())await this.runtime().alarm();}
 /** RPC only: matched props are supplied by the scoped native interceptor. */
 recordInterception(props:C02NetworkInterceptorProps,requestUrl:string,method:string){
  this.identity();const registration=this.registered();if(!registration)return;
  const state=this.runtime().status();if(!state||state.phase!=='dispatched'||state.hookMode!=='deny')return;
  const receipt=matchC02NetworkInterception(registration.plan,registration.interceptor,props,new Request(requestUrl,{method}));if(!receipt)return;
  this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS c02_network_denial(channel TEXT PRIMARY KEY,doc TEXT NOT NULL)');
  this.ctx.storage.sql.exec('INSERT OR IGNORE INTO c02_network_denial VALUES(?,?)',receipt.channel,JSON.stringify(receipt));
 }
 controlContext(props:C02NetworkInterceptorProps,requestUrl:string,method:string):Registration|null{
  this.identity();const registration=this.registered();if(!registration)return null;
  const state=this.runtime().status();if(!state||state.phase!=='dispatched'||state.hookMode!=='control')return null;
  return matchC02NetworkControl(registration.plan,registration.interceptor,props,new Request(requestUrl,{method}))?registration:null;
 }
 denials():C02NetworkDenialReceipt[]{this.identity();this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS c02_network_denial(channel TEXT PRIMARY KEY,doc TEXT NOT NULL)');return this.ctx.storage.sql.exec<{doc:string}>('SELECT doc FROM c02_network_denial ORDER BY channel').toArray().map(row=>JSON.parse(row.doc) as C02NetworkDenialReceipt);}
}
/** Never exposed by the HTTP router. Props originate in the owning native DO. */
export class C02ScopedNetworkDeny extends WorkerEntrypoint<NetworkEnvironment,C02NetworkInterceptorProps>{
 override async fetch(request:Request){
  const props=c02NetworkInterceptorPropsSchema.parse(this.ctx.props),namespace=this.env.NETWORK_NATIVE;
  if(!namespace||namespace.idFromName(name).toString()!==props.scope.instanceId)throw Error('Native interceptor identity differs');
  await namespace.getByName(name).recordInterception(props,request.url,request.method);
  return new Response('Denied',{status:403,headers:{'Cache-Control':'no-store'}});
 }
}

/** Temporary control forwarding is limited to exact registered nonces and URLs. */
export class C02ScopedNetworkControl extends WorkerEntrypoint<NetworkEnvironment,C02NetworkInterceptorProps>{
 override async fetch(request:Request){
  const props=c02NetworkInterceptorPropsSchema.parse(this.ctx.props),namespace=this.env.NETWORK_NATIVE;
  if(!namespace||namespace.idFromName(name).toString()!==props.scope.instanceId)throw Error('Native control identity differs');
  const registration=await namespace.getByName(name).controlContext(props,request.url,request.method);
  if(!registration)return new Response('Denied',{status:403,headers:{'Cache-Control':'no-store'}});
  const result=await forwardC02NetworkControl(registration.plan,registration.interceptor,props,request,(outbound,options)=>this.env.C02_NETWORK_RECEIVER?this.env.C02_NETWORK_RECEIVER.fetch(outbound,options):fetch(outbound,options));
  return result.response;
 }
}
