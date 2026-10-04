import { admitNativeCompute } from "./native-compute.js";
import type {Env} from "./env.js";
import type {AcceptedDeploymentTarget} from "./deployments.js";
import {gitAuthEnv,q} from "./shell.js";
import {isSafeRef,isSafeSha} from "../core/sanitize.js";

/** Privileged Git-only operation: pin and read back an accepted commit/tree.
 * No working tree or customer code is executed, and ref replacement uses CAS.
 */
export async function retainDeploymentTarget(env:Env,canonicalRepoName:string,target:AcceptedDeploymentTarget, accountKey: string, computeRunId: string):Promise<void>{
  if(!isSafeSha(target.commit)||!isSafeSha(target.tree)||!isSafeRef(target.recoverableRef)||!target.recoverableRef.startsWith("refs/flaregit/deployments/"))throw new Error("Invalid accepted deployment target");
  await admitNativeCompute(env, accountKey, computeRunId);
  using repository=await env.ARTIFACTS.get(canonicalRepoName);
  const sandbox=env.INTEGRATOR.getByName(computeRunId);
  let token:string|undefined;
  let verified=false;
  const execute=(command:string)=>sandbox.exec(["sh","-c",command],{env:{GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1",...(token?gitAuthEnv(token):{}),GIT_CONFIG_COUNT:token?"3":"2",[token?"GIT_CONFIG_KEY_1":"GIT_CONFIG_KEY_0"]:"core.hooksPath",[token?"GIT_CONFIG_VALUE_1":"GIT_CONFIG_VALUE_0"]:"/dev/null",[token?"GIT_CONFIG_KEY_2":"GIT_CONFIG_KEY_1"]:"http.followRedirects",[token?"GIT_CONFIG_VALUE_2":"GIT_CONFIG_VALUE_1"]:"false"}});
  try{
    const remote=(await repository.info()).remote;
    if(typeof remote!=="string"||/[\x00-\x1f\x7f\\]/.test(remote))throw new Error("Invalid deployment repository remote");
    const local=remote.startsWith("/")&&!remote.startsWith("//");
    if(!local){
      let url:URL;try{url=new URL(remote);}catch{throw new Error("Deployment repository requires an HTTPS remote or absolute local fixture path");}
      if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)throw new Error("Deployment repository requires credential-free HTTPS");
      token=(await repository.createToken("write",900)).plaintext;
    }
    const dir="/workspace/deployment-pin";
    const fetched=await execute(`git init --quiet --bare ${dir} && git -C ${dir} fetch --quiet --no-tags ${q(remote)} ${q(target.commit)}`);
    if(!fetched.success)throw new Error("Accepted deployment commit could not be recovered; no request was dispatched");
    const tree=await execute(`git -C ${dir} rev-parse ${q(`${target.commit}^{tree}`)}`);
    if(!tree.success||tree.stdout.trim()!==target.tree)throw new Error("Accepted deployment tree differs; no request was dispatched");
    const existing=await execute(`git -C ${dir} ls-remote ${q(remote)} ${q(target.recoverableRef)}`);
    if(!existing.success)throw new Error("Deployment ref could not be inspected");
    const previous=existing.stdout.trim().split(/\s+/)[0]??"";
    if(previous&&previous!==target.commit)throw new Error("Deployment retention ref already holds different work");
    if(!previous){const pushed=await execute(`git -C ${dir} push --quiet --force-with-lease=${q(`${target.recoverableRef}:`)} ${q(remote)} ${q(`${target.commit}:${target.recoverableRef}`)}`);if(!pushed.success)throw new Error("Deployment retention ref update refused; retry without dispatching");}
    const confirmed=await execute(`git -C ${dir} ls-remote ${q(remote)} ${q(target.recoverableRef)}`);
    if(!confirmed.success||confirmed.stdout.trim().split(/\s+/)[0]!==target.commit)throw new Error("Deployment ref could not be verified; no request was dispatched");
    verified=true;
  }finally{
    let cleanupFailed=false;
    if(token){try{if(!await repository.revokeToken(token)){cleanupFailed=true;console.error("Deployment pin credential revocation was not confirmed");}}catch{cleanupFailed=true;console.error("Deployment pin credential revocation unavailable");}}
    try{
      await sandbox.destroy();
      const lifetime=await sandbox.lifetimeStatus();
      if(lifetime?.state!=="stopped")throw new Error("Native stop unconfirmed");
    }catch{cleanupFailed=true;console.error("Deployment pin workspace cleanup unavailable");}
    if(verified&&cleanupFailed)throw new Error("Deployment pin cleanup could not be confirmed; no deployment request was dispatched");
  }
}
