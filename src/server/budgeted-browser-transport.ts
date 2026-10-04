import {z} from "zod";
import {browserSessionScopeSchema,type BrowserSessionScope,type BrowserSessionLease} from "./browser-session-budget";
import {CloudflareBrowserTransport,cloudflareBrowserSdk,retireBrowserSession,type BrowserSessionRetirement,type CloudflareBrowserTransportOptions,type BrowserSdkPort,type BrowserSessionControl} from "./cloudflare-browser-transport";
import type {BrowserVerificationTransport,BrowserAction,BrowserQuery} from "./external-browser-verifier";

export interface VerificationBrowserBudgetRpc {
 admitVerificationBrowser(scope:BrowserSessionScope):Promise<BrowserSessionLease>;
 beginVerificationBrowserAcquire(scope:BrowserSessionScope):Promise<boolean>;
 recordVerificationBrowserAcquired(scope:BrowserSessionScope,sessionId:string):Promise<void>;
 beforeVerificationBrowserWork(scope:BrowserSessionScope):Promise<void>;
 closeVerificationBrowser(scope:BrowserSessionScope):Promise<BrowserSessionLease>;
}
export interface BudgetedBrowserDependencies {
 binding:CloudflareBrowserTransportOptions["binding"];
 sessionControl:BrowserSessionControl;
 budget:VerificationBrowserBudgetRpc;
 /** Derived from the recorded build/candidate and current authority, never a request-body allowed flag. */
 expectedScope():Promise<BrowserSessionScope>;
 /** Production must retain late fact capture/cleanup through its execution context. */
 retainBackground(work:Promise<unknown>):void;
 sdk?:BrowserSdkPort;
 callbackTimeoutMs?:number;
 cleanupTimeoutMs?:number;
}

async function bounded<T>(operation:()=>Promise<T>,timeoutMs:number,signal?:AbortSignal):Promise<T>{
 signal?.throwIfAborted();const timer=new AbortController(),timeout=setTimeout(()=>timer.abort(),timeoutMs),combined=signal?AbortSignal.any([timer.signal,signal]):timer.signal;let abort:()=>void=()=>{};
 try{combined.throwIfAborted();return await Promise.race([operation(),new Promise<never>((_,reject)=>{abort=()=>reject(new Error("Budgeted browser operation deadline"));combined.addEventListener("abort",abort,{once:true});})]);}
 finally{clearTimeout(timeout);combined.removeEventListener("abort",abort);}
}

/** Exactly one durable browser lease; opaque acquisition failures never release global capacity. */
export class BudgetedBrowserTransport implements BrowserVerificationTransport {
 private readonly scope:BrowserSessionScope;
 private readonly transport:CloudflareBrowserTransport;
 private readonly callbackMs:number;
 private readonly cleanupMs:number;
 private signal:AbortSignal|undefined;
 private started=false;
 private closing=false;
 private acquiredId:string|null=null;
 private acquiredRecorded=false;
 private nativeRetirement:BrowserSessionRetirement|null=null;
 constructor(proposed:BrowserSessionScope,private readonly deps:BudgetedBrowserDependencies){
  this.scope=Object.freeze(browserSessionScopeSchema.parse(structuredClone(proposed)));
  this.callbackMs=deps.callbackTimeoutMs??5000;this.cleanupMs=deps.cleanupTimeoutMs??8000;
  if(!Number.isInteger(this.callbackMs)||this.callbackMs<1||this.callbackMs>8000||!Number.isInteger(this.cleanupMs)||this.cleanupMs<1||this.cleanupMs>8000||!deps.expectedScope||!deps.retainBackground||!deps.sessionControl)throw new Error("Trusted funded browser dependencies required");
  const sdk=deps.sdk??cloudflareBrowserSdk;
  this.transport=new CloudflareBrowserTransport({binding:deps.binding,sessionControl:deps.sessionControl,cleanupMs:this.cleanupMs,authorize:()=>this.current(),funding:async()=>{
   if(this.acquiredRecorded)await this.work(()=>deps.budget.beforeVerificationBrowserWork(structuredClone(this.scope)));
   else{const lease=await this.work(()=>deps.budget.admitVerificationBrowser(structuredClone(this.scope)));this.exactLease(lease);if(!["funded","acquire_possible"].includes(lease.phase))throw new Error("Browser funding is unavailable");}
  },sdk:{
   acquire:async(binding,options)=>{
    await this.current();
    const expected=[`${this.scope.leaseId}.verification.invalid`];
    if(JSON.stringify(options.guardrails?.allowedDomains)!==JSON.stringify(expected))throw new Error("Exact verification origin guardrail required");
    if(!await this.work(()=>deps.budget.beginVerificationBrowserAcquire(structuredClone(this.scope))))throw new Error("Browser acquisition is already consumed or unknown");
    await this.current();
    const acquired=sdk.acquire(binding,options).then(async result=>{
     // Capture provider identity before any authority/connect await, including late replies.
     const id=z.uuid().parse(result.sessionId);this.acquiredId=id;
     try{await bounded(()=>deps.budget.recordVerificationBrowserAcquired(structuredClone(this.scope),id),this.cleanupMs);this.acquiredRecorded=true;}
     catch{await this.retireKnown();throw new Error("Browser acquisition receipt remains unconfirmed");}
     if(this.closing||this.signal?.aborted){await this.retireKnown();throw new Error("Browser acquisition completed after cancellation");}
     return result;
    });
    deps.retainBackground(acquired.catch(()=>undefined));
    return this.work(()=>acquired);
   },
   connect:async(binding,id)=>{
    if(id!==this.acquiredId||!this.acquiredRecorded)throw new Error("Stored browser acquisition required before connecting");
    await this.work(()=>deps.budget.beforeVerificationBrowserWork(structuredClone(this.scope)));await this.current();
    const connecting=sdk.connect(binding,id).then(async browser=>{if(this.closing||this.signal?.aborted){try{await bounded(()=>browser.close(),this.cleanupMs);}catch{/* Native retirement below is authoritative. */}await this.retireKnown();throw new Error("Browser connected after cancellation");}return browser;});
    deps.retainBackground(connecting.catch(()=>undefined));return this.work(()=>connecting);
   },
  }});
 }
 private exactLease(lease:BrowserSessionLease){if(JSON.stringify(lease.scope)!==JSON.stringify(this.scope))throw new Error("Browser lease scope changed");}
 private work<T>(operation:()=>Promise<T>){return bounded(operation,this.callbackMs,this.signal);}
 private async current(){if(this.closing)throw new Error("Browser lease closing");const expected=browserSessionScopeSchema.parse(await this.work(()=>this.deps.expectedScope()));if(JSON.stringify(expected)!==JSON.stringify(this.scope))throw new Error("Current browser candidate/build scope changed");}
 private cleanupWork<T>(operation:()=>Promise<T>,deadline:number):Promise<T>{
  const remaining=Math.floor(deadline-performance.now());if(remaining<1)return Promise.reject(new Error("Browser cleanup deadline"));
  const actual=Promise.resolve().then(operation);this.deps.retainBackground(actual.catch(()=>undefined));return bounded(()=>actual,remaining);
 }
 private async retireKnown(deadline=performance.now()+this.cleanupMs):Promise<boolean>{
  const id=this.acquiredId;if(!id)return false;
  // Cleanup uses original identity, independently of current work authority.
  if(!this.acquiredRecorded)try{await this.cleanupWork(()=>this.deps.budget.recordVerificationBrowserAcquired(structuredClone(this.scope),id),deadline);this.acquiredRecorded=true;}catch{/* Unknown durable fact keeps the budget held. */}
  if(!this.nativeRetirement){
   const remaining=Math.min(8000,Math.floor(deadline-performance.now()));if(remaining<1)return false;
   try{this.nativeRetirement=await this.cleanupWork(()=>retireBrowserSession(this.deps.sessionControl,id,{timeoutMs:remaining}),deadline);}catch{return false;}
  }
  if(this.nativeRetirement?.sessionId!==id)return false;
  try{const lease=await this.cleanupWork(()=>this.deps.budget.closeVerificationBrowser(structuredClone(this.scope)),deadline);this.exactLease(lease);return lease.phase==="closed"&&lease.sessionId===id;}catch{return false;}
 }
 async allocate(options:Parameters<BrowserVerificationTransport["allocate"]>[0]):Promise<void>{
  if(this.started||options.leaseId!==this.scope.leaseId||options.origin!==`https://${this.scope.leaseId}.verification.invalid`||options.isolation!=="fresh-no-credentials")throw new Error("Exact unused browser lease required");
  this.started=true;this.signal=AbortSignal.any([options.signal,AbortSignal.timeout(this.scope.maxSeconds*1000)]);
  await this.current();const lease=await this.work(()=>this.deps.budget.admitVerificationBrowser(structuredClone(this.scope)));this.exactLease(lease);if(lease.phase!=="funded")throw new Error("Browser acquisition outcome is held or consumed");
  await this.work(()=>this.transport.allocate({...options,signal:this.signal!}));
 }
 async act(id:string,action:BrowserAction,signal:AbortSignal){if(id!==this.scope.leaseId)throw new Error("Browser lease identity differs");await this.current();await this.work(()=>this.deps.budget.beforeVerificationBrowserWork(structuredClone(this.scope)));return this.work(()=>this.transport.act(id,action,AbortSignal.any([this.signal!,signal])));}
 async observe(id:string,query:BrowserQuery,signal:AbortSignal){if(id!==this.scope.leaseId)throw new Error("Browser lease identity differs");await this.current();await this.work(()=>this.deps.budget.beforeVerificationBrowserWork(structuredClone(this.scope)));return this.work(()=>this.transport.observe(id,query,AbortSignal.any([this.signal!,signal])));}
 async close(id:string):Promise<{leaseId:string;closed:boolean}>{
  if(id!==this.scope.leaseId)return{leaseId:id,closed:false};this.closing=true;
  const deadline=performance.now()+this.cleanupMs;
  const cleanup=(async()=>{
   const native=this.cleanupWork(()=>this.transport.close(id),deadline).catch(()=>({leaseId:id,closed:false}));
   const known=this.acquiredId?this.retireKnown(deadline):this.cleanupWork(()=>this.deps.budget.closeVerificationBrowser(structuredClone(this.scope)),deadline).then(lease=>{this.exactLease(lease);return lease.phase==="closed"&&lease.closure?.observation==="never-acquired";}).catch(()=>false);
   const [local,retired]=await Promise.all([native,known]);
   return{leaseId:id,closed:local.closed&&retired};
  })();
  this.deps.retainBackground(cleanup.catch(()=>undefined));
  try{return await bounded(()=>cleanup,this.cleanupMs);}catch{return{leaseId:id,closed:false};}
 }
}

export interface BudgetedBrowserRouterDependencies extends Omit<BudgetedBrowserDependencies,"expectedScope"> {
 deriveScope(leaseId:string):Promise<BrowserSessionScope>;
 maxLeases?:number;
}
/** A verification case gets its own UUID and durable lease; consumed IDs are never recycled. */
export class BudgetedBrowserTransportRouter implements BrowserVerificationTransport {
 private readonly leases=new Map<string,{job?:BudgetedBrowserTransport;pending:Promise<void>;closing:boolean;controller:AbortController}>();
 private readonly maximum:number;
 private readonly callbackMs:number;
 private readonly cleanupMs:number;
 constructor(private readonly deps:BudgetedBrowserRouterDependencies){
  this.maximum=deps.maxLeases??32;this.callbackMs=deps.callbackTimeoutMs??5000;this.cleanupMs=deps.cleanupTimeoutMs??8000;
  if(!Number.isInteger(this.maximum)||this.maximum<1||this.maximum>32||!deps.deriveScope||!Number.isInteger(this.callbackMs)||this.callbackMs<1||this.callbackMs>8000||!Number.isInteger(this.cleanupMs)||this.cleanupMs<1||this.cleanupMs>8000)throw new Error("Bounded trusted browser router dependencies required");
 }
 async allocate(options:Parameters<BrowserVerificationTransport["allocate"]>[0]):Promise<void>{
  if(!z.uuid().safeParse(options.leaseId).success||options.origin!==`https://${options.leaseId}.verification.invalid`||options.isolation!=="fresh-no-credentials"||this.leases.has(options.leaseId)||this.leases.size>=this.maximum)throw new Error("Fresh bounded browser case lease required");
  const entry:{job?:BudgetedBrowserTransport;pending:Promise<void>;closing:boolean;controller:AbortController}={pending:Promise.resolve(),closing:false,controller:new AbortController()};
  this.leases.set(options.leaseId,entry);
  const signal=AbortSignal.any([options.signal,entry.controller.signal]);
  entry.pending=Promise.resolve().then(async()=>{
   const scope=browserSessionScopeSchema.parse(await bounded(()=>this.deps.deriveScope(options.leaseId),this.callbackMs,signal));
   signal.throwIfAborted();if(entry.closing||scope.leaseId!==options.leaseId)throw new Error("Browser case scope changed during admission");
   entry.job=new BudgetedBrowserTransport(scope,{...this.deps,expectedScope:()=>this.deps.deriveScope(options.leaseId)});
   await entry.job.allocate({...options,signal});
  });
  return entry.pending;
 }
 private active(id:string){const entry=this.leases.get(id);if(!entry?.job||entry.closing)throw new Error("Admitted active browser case required");return entry.job;}
 act(id:string,action:BrowserAction,signal:AbortSignal){return this.active(id).act(id,action,signal);}
 observe(id:string,query:BrowserQuery,signal:AbortSignal){return this.active(id).observe(id,query,signal);}
 async close(id:string):Promise<{leaseId:string;closed:boolean}>{
  const entry=this.leases.get(id);if(!entry)return{leaseId:id,closed:false};
  entry.closing=true;entry.controller.abort();
  const cleanup=(async()=>{
   const deadline=performance.now()+this.cleanupMs;
   if(entry.job)return entry.job.close(id);
   try{await bounded(()=>entry.pending.catch(()=>{}),Math.max(1,Math.floor(deadline-performance.now())));}catch{return{leaseId:id,closed:false};}
   if(entry.job){const remaining=Math.floor(deadline-performance.now());if(remaining<1)return{leaseId:id,closed:false};return bounded(()=>entry.job!.close(id),remaining);}
   return{leaseId:id,closed:true};
  })();this.deps.retainBackground(cleanup.catch(()=>undefined));
  try{return await bounded(()=>cleanup,this.cleanupMs);}catch{return{leaseId:id,closed:false};}
 }
}
