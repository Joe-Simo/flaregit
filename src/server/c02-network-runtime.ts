import {z} from 'zod';
import {ContainerLifetime} from './container-lifetime';
import {C02_NETWORK_PROBE_PROGRAM,c02NetworkControlInput,c02NetworkProbeInput,c02NetworkProbePlanSchema,c02NetworkProbeScopeSchema,type C02NetworkProbePlan,type C02NetworkProbeScope,type C02NetworkReceiverReceipt} from './c02-network-probe';
type Storage=Pick<DurableObjectStorage,'sql'|'transactionSync'|'setAlarm'|'deleteAlarm'>;
type Native=Pick<Container,'running'|'start'|'exec'|'destroy'|'inspect'|'interceptAllOutboundHttp'|'interceptOutboundHttps'>;
export interface C02NetworkRuntimeState{plan:C02NetworkProbePlan;input:ReturnType<typeof c02NetworkProbeInput>|null;controlSettled:boolean;controlExitCode:number|null;hookMode:'control'|'deny';image:string;commandId:string;phase:'prepared'|'dispatched'|'held'|'stopped';commandSettled:boolean;nativeStopped:boolean;exitCode:number|null}
const imageSchema=z.string().regex(/^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/);
/** Trusted owner constructs this for one registered native instance. Native stdout
 * never enters its evidence ledger. Unknown dispatches are permanently consumed. */
export class C02NetworkRuntime{
 constructor(private readonly storage:Storage,private readonly container:()=>Native|undefined,private readonly interceptor:Fetcher|undefined,private readonly instanceId:string,private readonly pinnedImage:string,private readonly now=()=>Date.now(),private readonly controls?:{interceptor:Fetcher;readReceipts:()=>Promise<C02NetworkReceiverReceipt[]>}){
  imageSchema.parse(pinnedImage);storage.sql.exec('CREATE TABLE IF NOT EXISTS c02_network_runtime(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL)');
 }
 status():C02NetworkRuntimeState|null{const row=this.storage.sql.exec<{doc:string}>('SELECT doc FROM c02_network_runtime WHERE id=1').toArray()[0];return row?JSON.parse(row.doc) as C02NetworkRuntimeState:null;}
 private save(state:C02NetworkRuntimeState){this.storage.sql.exec('INSERT INTO c02_network_runtime VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc',JSON.stringify(state));}
 private lifetime(){const state=this.status();return new ContainerLifetime(this.storage,this.container,state?state.plan.deadlineAt-state.plan.createdAt:120000,this.now);}
 prepare(plan:C02NetworkProbePlan,controls:C02NetworkReceiverReceipt[],commandId:string):void{
  const parsed=c02NetworkProbePlanSchema.parse(structuredClone(plan));z.uuid().parse(commandId);if(parsed.scope.instanceId!==this.instanceId)throw Error('Registered network instance differs');
  const input=this.controls?null:c02NetworkProbeInput(parsed,structuredClone(controls),this.now());if(this.controls)c02NetworkControlInput(parsed,this.now());const state:C02NetworkRuntimeState={plan:parsed,input,controlSettled:!this.controls,controlExitCode:null,hookMode:this.controls?'control':'deny',image:this.pinnedImage,commandId,phase:'prepared',commandSettled:true,nativeStopped:false,exitCode:null};
  this.storage.transactionSync(()=>{const previous=this.status();if(previous){if(previous.phase!=='prepared'||JSON.stringify(previous)!==JSON.stringify(state))throw Error('Network attempt differs or is consumed');return;}this.save(state);});
 }
 async stop():Promise<C02NetworkRuntimeState|null>{const state=this.status();if(!state)return null;this.save({...state,phase:'held'});const lifetime=this.lifetime();lifetime.seal();await lifetime.stop();const current=this.status()!;const nativeStopped=lifetime.status()?.state==='stopped';this.save({...current,nativeStopped,phase:nativeStopped&&current.commandSettled?'stopped':'held'});return this.status();}
 async alarm():Promise<void>{const state=this.status();if(!state)return;if(this.now()<state.plan.deadlineAt&&state.phase==='dispatched'){await this.storage.setAlarm(state.plan.deadlineAt);return;}await this.stop();}
 async run(scope:C02NetworkProbeScope):Promise<C02NetworkRuntimeState>{
  scope=c02NetworkProbeScopeSchema.parse(scope);const container=this.container(),state=this.status();if(!container||!this.interceptor)throw Error('Native network bindings unavailable');
  if(!state||state.phase!=='prepared'||JSON.stringify(state.plan.scope)!==JSON.stringify(scope)||scope.instanceId!==this.instanceId||state.image!==this.pinnedImage||this.now()>=state.plan.deadlineAt)throw Error('Network attempt unavailable or consumed');
  this.storage.transactionSync(()=>{if(this.status()?.phase!=='prepared')throw Error('Network dispatch already consumed');this.save({...state,phase:'dispatched',commandSettled:false});});
  const lifetime=this.lifetime(),signal=AbortSignal.timeout(Math.max(1,state.plan.deadlineAt-this.now()));
  const bounded=async<T>(operation:()=>Promise<T>):Promise<T>=>{signal.throwIfAborted();let cancel=()=>{};try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{cancel=()=>reject(Error('Network execution deadline'));signal.addEventListener('abort',cancel,{once:true});})]);}finally{signal.removeEventListener('abort',cancel);}};
  const allowed=()=>{signal.throwIfAborted();lifetime.assertWorkAllowed();if(this.now()>=state.plan.deadlineAt||this.status()?.phase!=='dispatched')throw Error('Network dispatch sealed');};
  let issued=false;
  const execute=async(input:ReturnType<typeof c02NetworkProbeInput>)=>{allowed();issued=true;const process=await bounded(()=>container.exec(['/usr/local/bin/bun','-e',C02_NETWORK_PROBE_PROGRAM],{stdin:new Response(JSON.stringify(input)).body!,stdout:'ignore',stderr:'ignore',signal,env:{CI:'1'}}));const exit=await bounded(()=>process.exitCode);if(!Number.isSafeInteger(exit))throw Error('Native command settlement invalid');return exit;};
  try{
   await bounded(()=>lifetime.beforeWork());await this.storage.setAlarm(state.plan.deadlineAt);allowed();
   const firstInterceptor=this.controls?.interceptor??this.interceptor;
   await bounded(()=>container.interceptAllOutboundHttp(firstInterceptor));allowed();await bounded(()=>container.interceptOutboundHttps('*',firstInterceptor));allowed();
   if(container.running||await bounded(()=>container.inspect())!==null)throw Error('Fresh network instance required');allowed();
   container.start({image:state.image,entrypoint:['sleep','infinity'],enableInternet:false});allowed();
   let input=state.input;
   if(this.controls){
    const controlExitCode=await execute(c02NetworkControlInput(state.plan,this.now()));
    this.save({...this.status()!,controlSettled:true,controlExitCode});issued=false;
    if(controlExitCode!==0)throw Error('Native control command failed');
    const receipts=await bounded(()=>this.controls!.readReceipts());allowed();input=c02NetworkProbeInput(state.plan,receipts,this.now());
    this.save({...this.status()!,input});
    await bounded(()=>container.interceptAllOutboundHttp(this.interceptor!));allowed();await bounded(()=>container.interceptOutboundHttps('*',this.interceptor!));allowed();
    this.save({...this.status()!,hookMode:'deny'});
   }
   if(!input)throw Error('Network probe admission unavailable');
   const exitCode=await execute(input);this.save({...this.status()!,commandSettled:true,exitCode});
  }finally{if(!issued)this.save({...this.status()!,commandSettled:true});await this.stop();}
  const completed=this.status()!;if(completed.phase!=='stopped')throw Error('Network cleanup unconfirmed');return completed;
 }
}
