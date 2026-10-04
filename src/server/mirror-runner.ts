import type {Env} from "./env";
import {executeMirror,type MirrorExecutionRecord,type MirrorExecutionScope,type MirrorExecutionJournal} from "./mirror-execution";
import {readMirrorTarget} from "./mirror-read-target";
import {sealAndStopInitializer} from "./readme-repository";
export interface MirrorRunnerAuthority {
 authorize(mode:"dispatch"|"reconcile"):Promise<void>;
 admit():Promise<void>;
 access(mode:"dispatch"|"reconcile"):Promise<{githubToken:string;canonicalRepoName:string;readConfigDigest:string}>;
 assertReadAccess(digest:string):Promise<void>;
 fund():Promise<void>;
 recordCredential(token:string,expiry:number,scope:unknown):Promise<void>;
 journal:MirrorExecutionJournal;
}
/** Shared server-only manual/registered-workflow transport. Every key stays in the backend. */
export async function runMirrorExecution(env:Env,scope:MirrorExecutionScope,authority:MirrorRunnerAuthority){
 const saved:MirrorExecutionRecord=await authority.journal.get();
 if(JSON.stringify(saved.scope)!==JSON.stringify(scope))throw Error("Original mirror execution scope differs");
 if(saved.phase==="observed"&&saved.credentialRevoked&&saved.nativeStopped){await authority.authorize("reconcile");return{status:"complete" as const,...(saved.result?{result:saved.result}:{})};}
 const mode=saved.phase==="push_unknown"||saved.phase==="observed"?"reconcile":"dispatch",access=await authority.access(mode);
 let canonicalRemote="";
 if(mode==="dispatch"){await authority.authorize(mode);await authority.fund();await authority.authorize(mode);using repo=await env.ARTIFACTS.get(access.canonicalRepoName);await authority.authorize(mode);await authority.fund();const info=await repo.info();await authority.authorize(mode);if(info.name!==scope.canonicalRepoName)throw Error("Original mirror source differs");canonicalRemote=info.remote;}
 const name=`mirror-${scope.id}`;
 return executeMirror(scope,{
   authorize:authority.authorize,admit:authority.admit,canonicalRemote,githubToken:access.githubToken,
   journal:{...authority.journal,recordCredential:(token,expiry,scope)=>authority.recordCredential(token,expiry,scope)},
   issue:async()=>{await authority.authorize("dispatch");await authority.fund();await authority.authorize("dispatch");using repo=await env.ARTIFACTS.get(scope.canonicalRepoName);await authority.fund();await authority.authorize("dispatch");const issued=await repo.createToken("read",60);await authority.recordCredential(issued.plaintext,Date.parse(issued.expiresAt),issued.scope);return issued;},
   revoke:async(token)=>{await authority.fund();using repo=await env.ARTIFACTS.get(scope.canonicalRepoName);await authority.fund();const positive=await repo.revokeToken(token);return positive;},
   stop:async(nativeName)=>{const sandbox=env.INTEGRATOR.getByName(nativeName);const stopped=await sealAndStopInitializer(sandbox);return{sealed:stopped,stopped};},
   exec:async(command,environment)=>env.INTEGRATOR.getByName(name).exec(["sh","-c",command],{env:environment}),
   readTarget:async(ref,target)=>{const readAccess=await authority.access("reconcile");return readMirrorTarget({ref,target,githubToken:readAccess.githubToken,authorize:()=>authority.assertReadAccess(readAccess.readConfigDigest),fund:authority.fund});},
 });
}
