import {configuredGitCap} from "./core-git-budget";
import type {ImportJob,ImportReadiness} from "./import-job";
import {inspectImport} from "./import-job";
import {inspectNativeImport,type ImportNativeSnapshot} from "./import-native-readiness";
import type {Env} from "./env";
import {accountKeyFor,accountOf,globalOf,projectOf} from "./projects";
import {admitNativeCompute,claimNativeCompute} from "./native-compute";
import {gitAuthEnv} from "./shell";
export interface ImportReadScope {job:ImportJob;incarnation:string;projectDigest:string}
/** Real native Git reads with saved ownership, durable read credential cleanup and confirmed stop. */
export async function inspectSavedImport(env:Env,job:ImportJob,credentialHash?:string,sessionExpiresAt?:number):Promise<ImportReadiness>{
 const accountKey=await accountKeyFor(job.ownerId),account=accountOf(env,accountKey),project=projectOf(env,job.id);
 try{
 const scope=await project.prepareImportReadScope(job),key=`import-read-${job.id}`,token=await claimNativeCompute(env,key);
 if(!token)return{status:"pending",detail:"This saved import already has a native inspection in progress; repository data is preserved"};
 const nativeId=`native-${token}`;let credential:Awaited<ReturnType<typeof account.createImportReadCredential>>|undefined,nativeStarted=false,stopped=false;
 const authorize=async()=>{if(credential&&Date.now()>=credential.expiresAt)throw new Error("Import read credential expired");await account.assertImportReadScope(scope,credentialHash,sessionExpiresAt);if(credential&&Date.now()>=credential.expiresAt)throw new Error("Import read credential expired");};
 const fund=async()=>{await authorize();const admission=await globalOf(env).reserveCoreGitOperation(`import-ref-${crypto.randomUUID()}`,accountKey,{accountUsdMicros:configuredGitCap(env.CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS),globalUsdMicros:configuredGitCap(env.CORE_GIT_GLOBAL_MONTHLY_USD_MICROS),readAccountUsdMicros:configuredGitCap(env.REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS),readGlobalUsdMicros:configuredGitCap(env.REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS)});if(!admission.allowed)throw new Error("Import read capacity unavailable");await authorize();};
 let proof:ImportNativeSnapshot|undefined,readiness:ImportReadiness;
 try{
  await authorize();await admitNativeCompute(env,accountKey,nativeId,"native-essential");await authorize();
  credential=await account.createImportReadCredential(scope,credentialHash,sessionExpiresAt);await authorize();
  const sandbox=env.INTEGRATOR.getByName(nativeId);
  const witness=async(remote:string,branch:string)=>{
   if(remote!==credential!.remote)throw new Error("Import remote changed");
   proof=await inspectNativeImport({exec:async command=>{await fund();nativeStarted=true;const result=await sandbox.exec(["sh","-c",command],{env:gitAuthEnv(credential!.token),timeoutMs:30000});await authorize();return result;}},remote,branch,`/tmp/flaregit-import-ready-${token}`);
   return proof;
  };
  await fund();readiness=await inspectImport(env.ARTIFACTS,job.canonicalRepoName,witness,job.branch);await authorize();
 }finally{
  let credentialsClean=true;
  if(credential)credentialsClean=await account.revokeImportReadCredential(credential.id).catch(()=>false);
  if(nativeStarted){const sandbox=env.INTEGRATOR.getByName(nativeId);await sandbox.destroy();stopped=(await sandbox.lifetimeStatus())?.state==="stopped";}else stopped=true;
  if(stopped)await globalOf(env).finishNativeCompute(key,token);
  if(!stopped||!credentialsClean)throw new Error("Import inspection cleanup is unconfirmed");
 }
 await authorize();
 if(readiness.status==="ready"&&proof)await project.recordImportReadProof(scope,proof);
 return readiness;
 }catch{return{status:"pending",detail:"Native import inspection or cleanup is unavailable; the saved import and repository are preserved for recovery"};}
}
