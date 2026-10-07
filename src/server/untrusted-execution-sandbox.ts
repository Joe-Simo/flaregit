import {DurableObject} from "cloudflare:workers";
import {z} from "zod";
import {ContainerLifetime} from "./container-lifetime";
import {verifyBuildManifest,type BuildFile,type BuildManifest,type StaticBuildScope} from "./static-build-artifact";
import {UntrustedExecutionRuntime,untrustedExecutionName,type CompletedUntrustedOutputArtifact} from "./untrusted-execution";

export interface UntrustedExecutionEnvironment {
 UNTRUSTED_EXECUTION?:DurableObjectNamespace<UntrustedExecutionSandbox>;
 UNTRUSTED_EGRESS?:Fetcher;
 EXECUTION_AUTHORITY?:Fetcher;
}
const CHUNK_BYTES=65536,MAX_MANIFEST_BYTES=524288;
const outputHeaderSchema=z.object({version:z.literal(1),manifestLength:z.number().int().min(1).max(MAX_MANIFEST_BYTES),manifestChunks:z.number().int().min(1).max(MAX_MANIFEST_BYTES/CHUNK_BYTES),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
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
 protected runtime():Pick<UntrustedExecutionRuntime,"prepare"|"run"|"stop">{return new UntrustedExecutionRuntime(this.ctx.storage,()=>this.ctx.container,this.env.UNTRUSTED_EGRESS,()=>this.authorize());}
 async prepare(scope:StaticBuildScope,source:BuildManifest,files:BuildFile[],image:string){
  source=structuredClone(source);files=files.map(file=>({...file,bytes:file.bytes.slice()}));
  const context={scope:structuredClone(scope),sourceDigest:source.digest,image};
  const verified=await verifyBuildManifest(source,context.scope,files);context.scope=verified.scope;
  if(source.kind!=="source"||!/^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/.test(image))throw Error("Pinned execution source and image required");
  await this.ctx.storage.transaction(async storage=>{const previous=await storage.get<BindingContext>("execution-context");if(previous&&JSON.stringify(previous)!==JSON.stringify(context))throw Error("Execution binding context changed");await storage.put("execution-context",context);});
  await this.runtime().prepare(context.scope,source,files,image);
 }
 private stoppedContext(){
  if(!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='untrusted_execution'").toArray().length)return null;
  const row=this.ctx.storage.sql.exec<{doc:string}>('SELECT doc FROM untrusted_execution WHERE id=1').toArray()[0];
  if(!row)return null;const parsed=z.object({scope:z.object({attemptId:z.uuid(),projectId:z.string(),incarnation:z.uuid(),commit:z.string(),tree:z.string(),policyDigest:z.string()}).strict(),sourceDigest:z.string(),image:z.string(),phase:z.literal('stopped'),commandSettled:z.literal(true),nativeStopped:z.literal(true)}).safeParse(JSON.parse(row.doc));return parsed.success?parsed.data:null;
 }
 private sameScope(left:StaticBuildScope,right:StaticBuildScope){return ["attemptId","projectId","incarnation","commit","tree","policyDigest"].every(key=>Reflect.get(left,key)===Reflect.get(right,key));}
 async run(scope:StaticBuildScope,source:BuildManifest,files:BuildFile[]){
  scope=structuredClone(scope);source=structuredClone(source);files=files.map(file=>({...file,bytes:file.bytes.slice()}));
  const output=await this.runtime().run(scope,source,files),manifest=structuredClone(output.manifest),bytes=output.files.map(file=>({...file,bytes:file.bytes.slice()}));
  const verified=await verifyBuildManifest(manifest,scope,bytes,source.digest);if(verified.kind!=="static")throw Error("Completed static output required");
  const context=await this.ctx.storage.get<BindingContext>("execution-context"),native=this.stoppedContext();if(!context||!native||!this.sameScope(context.scope,verified.scope)||!this.sameScope(native.scope,verified.scope)||native.image!==context.image||native.sourceDigest!==source.digest||context.sourceDigest!==source.digest)throw Error("Completed native shutdown proof required");
  const encoded=new TextEncoder().encode(JSON.stringify(manifest));if(encoded.byteLength>MAX_MANIFEST_BYTES)throw Error("Completed manifest exceeds durable bound");const header=outputHeaderSchema.parse({version:1,manifestLength:encoded.byteLength,manifestChunks:Math.ceil(encoded.byteLength/CHUNK_BYTES),digest:manifest.digest});
  const existing=await this.ctx.storage.get("completed-artifact");if(existing){const recovered=await this.outputArtifact(scope,source.digest);if(!recovered||JSON.stringify(recovered.manifest)!==JSON.stringify(manifest))throw Error("Completed output identity changed");return{manifest:structuredClone(recovered.manifest),files:recovered.files,acceptanceEvidence:false as const};}
  await this.ctx.storage.transaction(async storage=>{
   const assertStopped=async()=>{const current=await storage.get<BindingContext>("execution-context"),state=this.stoppedContext();if(!current||JSON.stringify(current)!==JSON.stringify(context)||!state||JSON.stringify(state)!==JSON.stringify(native))throw Error("Completed output scope changed");};await assertStopped();
   if(await storage.get("completed-artifact"))throw Error("Completed output was already recorded");
   for(let index=0;index<header.manifestChunks;index++)await storage.put(`completed-manifest-${index}`,encoded.slice(index*CHUNK_BYTES,(index+1)*CHUNK_BYTES));
   const byPath=new Map(bytes.map(file=>[file.path,file.bytes]));for(let index=0;index<manifest.files.length;index++){const file=manifest.files[index]!,data=byPath.get(file.path)!;for(let part=0;part<Math.ceil(data.byteLength/CHUNK_BYTES);part++)await storage.put(`completed-file-${index}-${part}`,data.slice(part*CHUNK_BYTES,(part+1)*CHUNK_BYTES));}
   await assertStopped();await storage.put("completed-artifact",header);
  });
  return{manifest,files:bytes,acceptanceEvidence:false as const};
 }
 async outputArtifact(scope:StaticBuildScope,sourceDigest:string):Promise<CompletedUntrustedOutputArtifact|null>{
  scope=structuredClone(scope);const signal=AbortSignal.timeout(10000),read=<T>(key:string)=>beforeDeadline(this.ctx.storage.get<T>(key),signal);
  const context=await read<BindingContext>("execution-context"),native=this.stoppedContext(),raw=await read("completed-artifact");if(!context||!native||!raw||!this.sameScope(context.scope,scope)||!this.sameScope(native.scope,scope)||context.sourceDigest!==sourceDigest||native.sourceDigest!==sourceDigest||native.image!==context.image)return null;
  if(!this.env.UNTRUSTED_EXECUTION||this.env.UNTRUSTED_EXECUTION.idFromName(await untrustedExecutionName(scope,sourceDigest)).toString()!==this.ctx.id.toString())return null;
  const header=outputHeaderSchema.parse(raw);if(header.manifestChunks!==Math.ceil(header.manifestLength/CHUNK_BYTES))throw Error("Completed manifest chunk identity differs");
  const encoded=new Uint8Array(header.manifestLength);for(let index=0;index<header.manifestChunks;index++){const chunk=await read<Uint8Array>(`completed-manifest-${index}`);const length=Math.min(CHUNK_BYTES,header.manifestLength-index*CHUNK_BYTES);if(!(chunk instanceof Uint8Array)||chunk.byteLength!==length)throw Error("Completed manifest chunk missing or corrupt");encoded.set(chunk,index*CHUNK_BYTES);}
  const parsed=z.object({version:z.literal(1),kind:z.literal("static"),scope:z.object({attemptId:z.uuid(),projectId:z.string(),incarnation:z.uuid(),commit:z.string(),tree:z.string(),policyDigest:z.string()}).strict(),files:z.array(z.object({path:z.string().max(256),size:z.number().int().min(0).max(4194304),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(512),totalBytes:z.number().int().min(0).max(16777216),sourceDigest:z.string(),digest:z.string()}).strict().parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(encoded)));
  if(parsed.digest!==header.digest||!this.sameScope(parsed.scope,scope)||parsed.sourceDigest!==sourceDigest||parsed.files.reduce((size,file)=>size+file.size,0)!==parsed.totalBytes)throw Error("Completed manifest scope differs");
  const files:BuildFile[]=[];for(let index=0;index<parsed.files.length;index++){const file=parsed.files[index]!,bytes=new Uint8Array(file.size);for(let part=0;part<Math.ceil(file.size/CHUNK_BYTES);part++){const chunk=await read<Uint8Array>(`completed-file-${index}-${part}`),length=Math.min(CHUNK_BYTES,file.size-part*CHUNK_BYTES);if(!(chunk instanceof Uint8Array)||chunk.byteLength!==length)throw Error("Completed file chunk missing or corrupt");bytes.set(chunk,part*CHUNK_BYTES);}files.push({path:file.path,kind:"file",bytes});}
  const manifest=await beforeDeadline(verifyBuildManifest(parsed,scope,files,sourceDigest),signal);if(JSON.stringify(await read("execution-context"))!==JSON.stringify(context)||JSON.stringify(this.stoppedContext())!==JSON.stringify(native)||JSON.stringify(await read("completed-artifact"))!==JSON.stringify(header))throw Error("Completed artifact changed during recovery");
  return{scope:structuredClone(context.scope),sourceDigest,image:context.image,manifest,files,cleanup:"confirmed",acceptanceEvidence:false};
 }
 async outputReceipt(scope:StaticBuildScope,sourceDigest:string){
  const artifact=await this.outputArtifact(scope,sourceDigest);if(artifact){const{files:_files,...receipt}=artifact;return receipt;}
  // Existing manifest-only receipts remain readable, but never fabricate lost bytes.
  const context=await this.ctx.storage.get<BindingContext>('execution-context'),manifest=await this.ctx.storage.get<BuildManifest>('completed-output'),state=this.stoppedContext();if(!context||!manifest||!state||!this.sameScope(context.scope,scope)||!this.sameScope(state.scope,scope)||context.image!==state.image||context.sourceDigest!==sourceDigest||state.sourceDigest!==sourceDigest||manifest.sourceDigest!==sourceDigest||!this.sameScope(manifest.scope,scope))return null;
  if(!this.env.UNTRUSTED_EXECUTION||this.env.UNTRUSTED_EXECUTION.idFromName(await untrustedExecutionName(scope,sourceDigest)).toString()!==this.ctx.id.toString())return null;
  return{scope:structuredClone(context.scope),sourceDigest,image:context.image,manifest:structuredClone(manifest),cleanup:'confirmed' as const,acceptanceEvidence:false as const};
 }
 async stop(){return this.runtime().stop();}
 override async alarm(){await new ContainerLifetime(this.ctx.storage,()=>this.ctx.container,120000).alarm();}
}
