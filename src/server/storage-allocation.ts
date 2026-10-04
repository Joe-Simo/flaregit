import type { Env } from "./env.js";
import { globalOf, accountKeyFor, accountOf, projectOf } from "./projects.js";
import type { ArtifactKind } from "./storage-admission.js";
interface InventoryReader {list(options:{limit:number;cursor?:string}):Promise<{repos:Array<{name:string}>;cursor?:string}>}
/** Complete stable two-pass inventory. No provider create/delete or credentials. */
export async function stableArtifactInventory(binding:InventoryReader):Promise<string[]>{
 const pass=async()=>{const names:string[]=[],cursors=new Set<string>();let cursor:string|undefined;for(let page=0;page<500;page++){const result=await binding.list({limit:200,...(cursor?{cursor}:{})});names.push(...result.repos.map(repo=>repo.name));if(!result.cursor){if(new Set(names).size!==names.length)throw new Error("Artifact inventory is unstable");return names.sort();}if(cursors.has(result.cursor))throw new Error("Artifact inventory cursor repeated");cursors.add(result.cursor);cursor=result.cursor;}throw new Error("Artifact inventory exceeds bounded reconciliation");};
 const first=await pass(),second=await pass();if(first.length!==second.length||first.some((name,index)=>name!==second[index]))throw new Error("Artifact inventory changed during reconciliation");return second;
}
export function artifactStorageSlots(value:string|undefined):number|null{if(!value||!/^(0|[1-9][0-9]*)$/.test(value))return null;const result=Number(value);return Number.isSafeInteger(result)?result:null;}
/** Every provider allocation must call this BEFORE allocating. Unknown outcomes
 * retain their reservation and named project manifest for later recovery. */
export async function reserveArtifactAllocation(env:Env,args:{name:string;projectId:string;userId:string;kind:ArtifactKind}):Promise<void>{
 if(!env.ARTIFACT_STORAGE_NAMESPACE)throw new Error("Storage admission namespace is unconfigured");
 const inventory=await stableArtifactInventory(env.ARTIFACTS);
 const global=globalOf(env);await global.reconcileArtifactInventory(env.ARTIFACT_STORAGE_NAMESPACE,inventory);
 const owner=await accountKeyFor(args.userId),policy={globalSlots:artifactStorageSlots(env.ARTIFACT_STORAGE_GLOBAL_SLOTS),accountSlots:artifactStorageSlots(env.ARTIFACT_STORAGE_ACCOUNT_SLOTS)};
 let result;
 try{result=await global.reserveArtifactStorage(args.name,owner,args.kind,args.projectId,policy);}
 catch(error){if(!inventory.includes(args.name))throw error;await global.claimArtifactExisting(args.name,args.userId,args.kind,args.projectId);result=await global.reserveArtifactStorage(args.name,owner,args.kind,args.projectId,policy);}
 if(!result.allowed)throw new Error(result.reason==="account_capacity"?"Retained repository workspace capacity reached. Existing history remains available.":"Operator storage capacity is unavailable. Existing repositories remain available.");
}

/** Account and project lifecycle fences remain pending across lost responses.
 * A failed admission before dispatch is settled; provider ambiguity is preserved. */
export async function allocateArtifact<T>(env:Env,args:{name:string;projectId:string;userId:string;kind:ArtifactKind},operation:()=>Promise<T>):Promise<T>{
 const accountKey=await accountKeyFor(args.userId),account=accountOf(env,accountKey),project=projectOf(env,args.projectId),operationId=crypto.randomUUID();
 const input={name:args.name,projectId:args.projectId,accountKey,operationId};let dispatched=false;
 const settle=async()=>{await project.settleArtifactAllocation(args.name,operationId);await account.settleArtifactAllocation(args.name,operationId);};
 try{
  await account.beginArtifactAllocation(input,"account");
  await project.beginArtifactAllocation(input,"project");
  await reserveArtifactAllocation(env,args);
  await account.activateArtifactAllocation(args.name,operationId,"account");
  await project.activateArtifactAllocation(args.name,operationId,"project");
  dispatched=true;const result=await operation();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([(async()=>{using repo=await env.ARTIFACTS.get(args.name);await repo.info();})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Provider allocation readiness unknown")),5000);})]);await settle();}catch{/* Retain exact pending provider outcome for explicit reconciliation. */}finally{if(timer)clearTimeout(timer);}
  return result;
 }catch(error){if(!dispatched)await settle().catch(()=>undefined);throw error;}
}
