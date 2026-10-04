import type {CoreGitAdmission} from "./core-git-budget.js";
export type RepositoryReadCapability=Pick<ArtifactsRepo,"info"|"log"|"readCommit"|"readTree"|"readBlob"|"readFile"|typeof Symbol.dispose>;
export type RepositoryReadReason="authorization"|"account_budget"|"global_budget"|"unconfigured"|"provider_limit"|"deadline"|"metadata_capacity"|"blob_capacity";
export class RepositoryReadError extends Error {
 constructor(public readonly status:429|413|503,public readonly reason:RepositoryReadReason){super(reason==="authorization"?"Repository read authorization is unavailable; reload before retrying":reason==="deadline"?"Repository inspection reached its time bound; no complete response was returned":reason==="provider_limit"||reason==="metadata_capacity"||reason==="blob_capacity"?"Repository inspection exceeds this request's supported work bound; no complete response was returned":"Repository read capacity is unavailable; retry when the allowance is restored");this.name="RepositoryReadError";}
}
export interface RepositoryReadOptions {repoName:string;authorize():Promise<void>;reserveGroup(operationId:string):Promise<CoreGitAdmission>;limits?:{maxProviderCalls?:number;maxMetadataBytes?:number;maxBlobBytes?:number;deadlineMs?:number}}
const HASH=/^[a-f0-9]{40}$/;
/** Request-local immutable cache, never a persistent private cache or authority grant.
 * Eight logical provider attempts share one conservative funded reservation.
 * Unknown outcomes retain admission; no invoice or zero-cost claim is made. */
export async function openRepositoryRead(env:{ARTIFACTS:{get(name:string):Promise<RepositoryReadCapability>}},options:RepositoryReadOptions):Promise<RepositoryReadCapability>{
 const caps={maxProviderCalls:options.limits?.maxProviderCalls??512,maxMetadataBytes:options.limits?.maxMetadataBytes??4*1024*1024,maxBlobBytes:options.limits?.maxBlobBytes??16*1024*1024,deadlineMs:options.limits?.deadlineMs??10_000};
 if(Object.values(caps).some(value=>!Number.isSafeInteger(value)||value<1)||caps.maxProviderCalls>10016||caps.maxMetadataBytes>32*1024*1024||caps.maxBlobBytes>32*1024*1024||caps.deadlineMs>120_000)throw new RepositoryReadError(413,"provider_limit");
 const deadline=Date.now()+caps.deadlineMs;
 let closed=false,calls=0,slots=0,metadataBytes=0,blobBytes=0;
 let admissionTail:Promise<void>=Promise.resolve();
 const memo=new Map<string,Promise<unknown>>();
 const checkTime=()=>{if(closed||Date.now()>=deadline)throw new RepositoryReadError(503,"deadline");};
 const authorize=async()=>{checkTime();try{await bounded(options.authorize());}catch(error){if(error instanceof RepositoryReadError)throw error;throw new RepositoryReadError(503,"authorization");}checkTime();};
 const bounded=async<T>(operation:Promise<T>):Promise<T>=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new RepositoryReadError(503,"deadline")),Math.max(1,deadline-Date.now()));})]);}finally{if(timer!==undefined)clearTimeout(timer);}};
 const reserve=async()=>{
  const previous=admissionTail;let release:()=>void=()=>{};admissionTail=new Promise<void>(resolve=>{release=resolve;});
  await previous;
  try{
   checkTime();if(calls>=caps.maxProviderCalls)throw new RepositoryReadError(413,"provider_limit");
   if(!slots){const result=await bounded(options.reserveGroup(`read-${crypto.randomUUID()}`));if(!result.allowed)throw new RepositoryReadError(result.reason==="unconfigured"?503:429,result.reason);slots=8;}
   slots--;calls++;
  }finally{release();}
 };
 const invoke=async<T>(operation:()=>Promise<T>):Promise<T>=>{await authorize();await reserve();await authorize();const value=await bounded(operation());await authorize();return value;};
 let raw:RepositoryReadCapability|undefined;
 const pendingGet=invoke(async()=>{const value=await env.ARTIFACTS.get(options.repoName);if(closed||Date.now()>=deadline){value[Symbol.dispose]();throw new RepositoryReadError(503,"deadline");}raw=value;return value;});
 try{raw=await pendingGet;}catch(error){closed=true;raw?.[Symbol.dispose]();throw error;}
 const repository=raw;
 const read=async<T>(key:string|null,operation:()=>Promise<T>):Promise<T>=>{
  const cached=key?memo.get(key) as Promise<T>|undefined:undefined;
  if(cached){await authorize();const value=await bounded(cached);await authorize();return value;}
  const pending=invoke(operation);if(key)memo.set(key,pending);
  return pending;
 };
 const metadata=async<T>(key:string|null,operation:()=>Promise<T>):Promise<T>=>{const value=await read(key,operation);const serialized=JSON.stringify(value);if(serialized===undefined)throw new RepositoryReadError(413,"metadata_capacity");metadataBytes+=new TextEncoder().encode(serialized).length;if(metadataBytes>caps.maxMetadataBytes)throw new RepositoryReadError(413,"metadata_capacity");return structuredClone(value);};
 const countBlob=(bytes:number)=>{blobBytes+=bytes;if(blobBytes>caps.maxBlobBytes)throw new RepositoryReadError(413,"blob_capacity");};
 class GuardedBlob extends Blob {
  constructor(private readonly original:Blob){super();}
  override get size(){return this.original.size;}
  override get type(){return this.original.type;}
  override async arrayBuffer():Promise<ArrayBuffer>{await authorize();if(this.original.size>caps.maxBlobBytes-blobBytes)throw new RepositoryReadError(413,"blob_capacity");countBlob(this.original.size);const bytes=await bounded(this.original.arrayBuffer());await authorize();if(bytes.byteLength!==this.original.size)throw new RepositoryReadError(413,"blob_capacity");return bytes;}
  override async text(){return new TextDecoder().decode(await this.arrayBuffer());}
  override async bytes(){return new Uint8Array(await this.arrayBuffer());}
  override slice(start?:number,end?:number,type?:string){return new GuardedBlob(this.original.slice(start,end,type));}
  override stream():ReadableStream<Uint8Array<ArrayBuffer>>{
   const reader=this.original.stream().getReader();
   return new ReadableStream({pull:async controller=>{try{await authorize();const value=await bounded(reader.read());await authorize();if(value.done){controller.close();return;}countBlob(value.value.byteLength);controller.enqueue(value.value);}catch(error){await reader.cancel().catch(()=>{});controller.error(error);}},cancel:reason=>reader.cancel(reason)});
  }
 }
 const blob=async(key:string|null,operation:()=>Promise<Blob|null>)=>{const value=await read(key,operation);return value?new GuardedBlob(value):null;};
 const hash=(value:string)=>{if(!HASH.test(value))throw new RepositoryReadError(413,"provider_limit");return value;};
 return{
  info:()=>metadata(null,()=>repository.info()),
  log:options=>metadata(options?.ref&&HASH.test(options.ref)?`log:${JSON.stringify(options)}`:null,()=>repository.log(options)),
  readCommit:value=>metadata(`commit:${hash(value)}`,()=>repository.readCommit(value)),
  readTree:value=>metadata(`tree:${hash(value)}`,()=>repository.readTree(value)),
  readBlob:value=>blob(`blob:${hash(value)}`,()=>repository.readBlob(value)),
  readFile:args=>blob(HASH.test(args.ref)?`file:${args.ref}:${args.path}`:null,()=>repository.readFile(args)),
  [Symbol.dispose]:()=>{if(closed)return;closed=true;memo.clear();repository[Symbol.dispose]();},
 };
}
