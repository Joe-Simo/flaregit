import {DurableObject} from "cloudflare:workers";
import {z} from "zod";
import {ContainerLifetime} from "./container-lifetime";
import {verifyBuildManifest,type BuildFile,type BuildManifest,type StaticBuildScope} from "./static-build-artifact";
import {UntrustedExecutionRuntime,untrustedExecutionName} from "./untrusted-execution";

export interface UntrustedExecutionEnvironment {
 UNTRUSTED_EXECUTION?:DurableObjectNamespace<UntrustedExecutionSandbox>;
 UNTRUSTED_EGRESS?:Fetcher;
 EXECUTION_AUTHORITY?:Fetcher;
}
interface BindingContext {scope:StaticBuildScope;sourceDigest:string;image:string}
const approval=z.object({allowed:z.literal(true),contextDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
async function beforeDeadline<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 signal.throwIfAborted();let cancel=()=>{};
 try{return await Promise.race([operation,new Promise<never>((_,reject)=>{cancel=()=>reject(Error("Execution authority deadline"));signal.addEventListener("abort",cancel,{once:true});})]);}
 finally{signal.removeEventListener("abort",cancel);}
}
export async function authorityBody(response:Response,signal:AbortSignal){
 const reader=response.body?.getReader();if(!reader)throw Error("Execution authority receipt missing");
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const next=await beforeDeadline(reader.read(),signal);if(next.done)break;size+=next.value.byteLength;if(size>1024)throw Error("Execution authority receipt exceeds bound");chunks.push(next.value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
 catch(error){void reader.cancel().catch(()=>{});throw error;}
}

/** Inactive until explicitly bound: a separate job namespace, never the integrator.
 * Its authority service must verify the current owner, exact attempt and reserved
 * budget. Neither that service binding nor its credentials enter the container. */
export class UntrustedExecutionSandbox extends DurableObject<UntrustedExecutionEnvironment> {
 private async authorize(){
  const context=await this.ctx.storage.get<BindingContext>("execution-context");
  const namespace=this.env.UNTRUSTED_EXECUTION,authority=this.env.EXECUTION_AUTHORITY;
  if(!context||!namespace||!authority||!this.env.UNTRUSTED_EGRESS)throw Error("Execution authority bindings unavailable");
  const name=await untrustedExecutionName(context.scope,context.sourceDigest);
  if(namespace.idFromName(name).toString()!==this.ctx.id.toString())throw Error("Execution namespace identity differs");
  const payload=JSON.stringify(context),digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload))),value=>value.toString(16).padStart(2,"0")).join("");
  const signal=AbortSignal.timeout(10000);
  const response=await beforeDeadline(authority.fetch(new Request("https://execution-authority.invalid/allow",{method:"POST",headers:{"Content-Type":"application/json"},body:payload,signal})),signal);
  if(!response.ok)throw Error("Execution authority refused");
  const text=await authorityBody(response,signal);
  const receipt=approval.parse(JSON.parse(text));
  if(receipt.contextDigest!==digest||JSON.stringify(await this.ctx.storage.get("execution-context"))!==payload)throw Error("Execution authority context changed");
 }
 private runtime(){return new UntrustedExecutionRuntime(this.ctx.storage,()=>this.ctx.container,this.env.UNTRUSTED_EGRESS,()=>this.authorize());}
 async prepare(scope:StaticBuildScope,source:BuildManifest,files:BuildFile[],image:string){
  source=structuredClone(source);files=files.map(file=>({...file,bytes:file.bytes.slice()}));
  const context={scope:structuredClone(scope),sourceDigest:source.digest,image};
  const verified=await verifyBuildManifest(source,context.scope,files);context.scope=verified.scope;
  if(source.kind!=="source"||!/^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/.test(image))throw Error("Pinned execution source and image required");
  await this.ctx.storage.transaction(async storage=>{const previous=await storage.get<BindingContext>("execution-context");if(previous&&JSON.stringify(previous)!==JSON.stringify(context))throw Error("Execution binding context changed");await storage.put("execution-context",context);});
  await this.runtime().prepare(context.scope,source,files,image);
 }
 async run(scope:StaticBuildScope,source:BuildManifest,files:BuildFile[]){
  const output=await this.runtime().run(scope,source,files);
  // Persist only after the runtime positively confirms both command settlement
  // and native shutdown. A lost reply can recover this identity without rerunning.
  const manifest=structuredClone(output.manifest);
  await this.ctx.storage.transaction(async storage=>{
   const previous=await storage.get<BuildManifest>('completed-output');
   if(previous&&JSON.stringify(previous)!==JSON.stringify(manifest))throw Error('Completed output identity changed');
   await storage.put('completed-output',manifest);
  });
  return output;
 }
 async outputReceipt(scope:StaticBuildScope,sourceDigest:string){
  const context=await this.ctx.storage.get<BindingContext>('execution-context');
  const manifest=await this.ctx.storage.get<BuildManifest>('completed-output');
  if(!context||!manifest||!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='untrusted_execution'").toArray().length)return null;
  const rows=this.ctx.storage.sql.exec<{doc:string}>('SELECT doc FROM untrusted_execution WHERE id=1').toArray();
  const state=rows[0]?z.object({phase:z.literal('stopped'),commandSettled:z.literal(true),nativeStopped:z.literal(true)}).safeParse(JSON.parse(rows[0].doc)):null;
  if(!context||!manifest||!state?.success||JSON.stringify(context.scope)!==JSON.stringify(scope)||context.sourceDigest!==sourceDigest||manifest.sourceDigest!==sourceDigest||JSON.stringify(manifest.scope)!==JSON.stringify(scope))return null;
  return {scope:structuredClone(context.scope),sourceDigest,image:context.image,manifest:structuredClone(manifest),cleanup:'confirmed' as const,acceptanceEvidence:false as const};
 }
 async stop(){return this.runtime().stop();}
 override async alarm(){await new ContainerLifetime(this.ctx.storage,()=>this.ctx.container,120000).alarm();}
}
