import {isolatedExecutionContextSchema,type IsolatedExecutionContext,type IsolatedExecutionGrant} from "./isolated-execution-grants";
import {verifyBuildManifest,type BuildFile,type BuildManifest} from "./static-build-artifact";
import {untrustedExecutionName,type UntrustedExecutionNamespace,type UntrustedExecutionRpc} from "./untrusted-execution";
import type {TrustedGitSource} from "./trusted-git-source";

export interface IsolatedBuildGrantRpc {
  prepareIsolatedExecutionGrant(context:IsolatedExecutionContext):Promise<IsolatedExecutionGrant>;
  isolatedExecutionSnapshot(context:IsolatedExecutionContext):Promise<IsolatedExecutionContext>;
  authorizeIsolatedExecution(context:{scope:IsolatedExecutionContext["scope"];sourceDigest:string;image:string}):Promise<boolean>;
  claimIsolatedExecutionDispatch(context:IsolatedExecutionContext):Promise<IsolatedExecutionGrant>;
  sealIsolatedExecution(context:IsolatedExecutionContext):Promise<void>;
}
export interface IsolatedBuildJobDependencies {
  namespace:UntrustedExecutionNamespace;
  grants:IsolatedBuildGrantRpc;
  /** Must revalidate recorded provider identity, incarnation and immutable source provenance server-side. */
  assertSourceProvenance(context:IsolatedExecutionContext,proof:TrustedGitSource["proof"]):Promise<void>;
  cleanupTimeoutMs?:number;
  jobTimeoutMs?:number;
}
export interface IsolatedBuildArtifact {identity:{context:IsolatedExecutionContext;sourceDigest:string;outputDigest:string;executionName:string};manifest:BuildManifest;files:BuildFile[];acceptanceEvidence:false}

async function boundedCleanup<T>(operation:()=>Promise<T>,timeoutMs:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Isolated build cleanup remains unconfirmed")),timeoutMs);})]);}
  finally{if(timer)clearTimeout(timer);}
}
async function boundedWork<T>(operation:()=>Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();let abort:()=>void=()=>{};
  try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{abort=()=>reject(new Error("Isolated build deadline exceeded"));signal.addEventListener("abort",abort,{once:true});})]);}
  finally{signal.removeEventListener("abort",abort);}
}

/** Trusted orchestration only. Static build bytes are never candidate acceptance evidence. */
export async function runIsolatedBuildJob(proposed:IsolatedExecutionContext,source:TrustedGitSource,deps:IsolatedBuildJobDependencies):Promise<IsolatedBuildArtifact>{
  // Freeze identity and every byte before the first authority or digest await.
  const context=isolatedExecutionContextSchema.parse(structuredClone(proposed)),manifest=structuredClone(source.sourceManifest),proof=structuredClone(source.proof),files=source.files.map(file=>({...file,bytes:file.bytes.slice()}));
  const timeout=deps.cleanupTimeoutMs??10000,jobTimeout=deps.jobTimeoutMs??150000;
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>10000||!Number.isSafeInteger(jobTimeout)||jobTimeout<1||jobTimeout>150000||!deps.namespace||!deps.grants||!deps.assertSourceProvenance)throw new Error("Trusted isolated build dependencies required");
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),jobTimeout),work=<T>(operation:()=>Promise<T>)=>boundedWork(operation,controller.signal);
  try{
  if(manifest.kind!=="source"||manifest.digest!==context.sourceDigest||proof.sourceDigest!==manifest.digest||proof.commit!==context.scope.commit||proof.tree!==context.scope.tree||!proof.providerRepoId||!proof.canonicalRepoName)throw new Error("Exact immutable source provenance required");
  await work(()=>verifyBuildManifest(manifest,context.scope,files));
  if(proof.blobs.length!==files.length||new Set(proof.blobs.map(blob=>blob.path)).size!==proof.blobs.length)throw new Error("Complete source blob provenance required");
  for(const file of files){
    const blob=proof.blobs.find(value=>value.path===file.path);
    if(!blob||! /^[a-f0-9]{40}$/.test(blob.hash)||!['100644','100755'].includes(blob.mode))throw new Error("Source blob provenance differs");
    const header=new TextEncoder().encode(`blob ${file.bytes.byteLength}\0`),bytes=new Uint8Array(header.length+file.bytes.byteLength);bytes.set(header);bytes.set(file.bytes,header.length);
    const oid=Array.from(new Uint8Array(await work(()=>crypto.subtle.digest('SHA-1',bytes))),value=>value.toString(16).padStart(2,'0')).join('');
    if(oid!==blob.hash)throw new Error("Source bytes differ from the captured Git blob");
  }
  const current=async()=>{
    const fresh=isolatedExecutionContextSchema.parse(await work(()=>deps.grants.isolatedExecutionSnapshot(structuredClone(context))));
    if(JSON.stringify(fresh)!==JSON.stringify(context))throw new Error("Current isolated build authority changed");
    await work(()=>deps.assertSourceProvenance(structuredClone(context),structuredClone(proof)));
  };
  const allowed=async()=>{await current();if(!await work(()=>deps.grants.authorizeIsolatedExecution({scope:structuredClone(context.scope),sourceDigest:context.sourceDigest,image:context.image})))throw new Error("Funded isolated build grant unavailable");await current();};
  let job:UntrustedExecutionRpc|undefined,artifact:IsolatedBuildArtifact|undefined,grantPreparationAttempted=false;
  try{
    await current();grantPreparationAttempted=true;
    await work(()=>deps.grants.prepareIsolatedExecutionGrant(structuredClone(context)));
    await allowed();
    const name=await work(()=>untrustedExecutionName(context.scope,manifest.digest));
    await allowed();job=deps.namespace.getByName(name);
    await work(()=>job!.prepare(structuredClone(context.scope),structuredClone(manifest),files.map(file=>({...file,bytes:file.bytes.slice()})),context.image));
    await allowed();
    const claim=await work(()=>deps.grants.claimIsolatedExecutionDispatch(structuredClone(context)));
    if(claim.phase!=="dispatched"||JSON.stringify(claim.context)!==JSON.stringify(context))throw new Error("Exact one-shot build dispatch not confirmed");
    await allowed();
    const result=await work(()=>job!.run(structuredClone(context.scope),structuredClone(manifest),files.map(file=>({...file,bytes:file.bytes.slice()}))));
    // RPC buffers are untrusted and mutable too; snapshot before authority awaits.
    const outputManifest=structuredClone(result.manifest),outputFiles=result.files.map(file=>({...file,bytes:file.bytes.slice()}));
    if(result.acceptanceEvidence!==false||outputManifest.kind!=="static")throw new Error("Build output cannot authorize candidate acceptance");
    await work(()=>verifyBuildManifest(outputManifest,context.scope,outputFiles,manifest.digest));
    await allowed();
    artifact={identity:{context:structuredClone(context),sourceDigest:manifest.digest,outputDigest:outputManifest.digest,executionName:name},manifest:outputManifest,files:outputFiles,acceptanceEvidence:false};
  }finally{
    // Original saved context authorizes cleanup even after contributor authority is withdrawn.
    if(grantPreparationAttempted){
      const cleanup=await Promise.allSettled([boundedCleanup(()=>deps.grants.sealIsolatedExecution(structuredClone(context)),timeout),job?boundedCleanup(()=>job!.stop(),timeout):Promise.resolve({stopped:true})]);
      if(cleanup[0]!.status!=="fulfilled"||cleanup[1]!.status!=="fulfilled"||cleanup[1]!.value.stopped!==true)throw new Error("Isolated build cleanup remains unconfirmed; no artifact was released");
    }
  }
  if(!artifact)throw new Error("Isolated build did not produce a verified static artifact");
  // Sealing denies execution. Subsequent browser verification uses fresh authority,
  // this immutable build identity and its own separate funded verification grant.
  await current();
  return artifact;
  }finally{clearTimeout(deadline);}
}
