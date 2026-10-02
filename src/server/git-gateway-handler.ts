import {admitCredentialLookup} from "./lookup-admission.js";
import { authenticate } from "./access.js";
import { accountKeyFor, accountOf, projectOf, PROJECT_ID } from "./projects.js";
import { gitHttpCredential, parseGitHttpRoute, proxyGitHttp, type GitHttpRoute } from "./git-http-gateway.js";
import type { Env } from "./env.js";
import type { Ledger } from "./durable-object.js";
export const gitRemote = (origin:string,projectId:string,taskId:string|null) => `${origin}/git/${projectId}/${taskId===null?"canonical":`tasks/${taskId}`}.git`;
export async function gitParentTokenHash(request:Request):Promise<string|undefined>{
  const token=gitHttpCredential(request);if(!token?.startsWith("fgt_"))return undefined;
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export type GitAdmission = (account:Ledger,userId:string,route:GitHttpRoute,operationId:string)=>Promise<Response|{finish:()=>Promise<void>}>;
export async function handleGitGateway(request:Request,env:Env,admit:GitAdmission,lookupAlreadyAdmitted=false):Promise<Response>{
  const respond=(message:string,status:number)=>new Response(message,{status,headers:{"Cache-Control":"no-store",...(status===401?{"WWW-Authenticate":'Basic realm="FlareGit", charset="UTF-8"'}:{})}});
  if(!lookupAlreadyAdmitted){const denied=await admitCredentialLookup(request,env);if(denied)return denied;}
  let route:GitHttpRoute|null;try{route=parseGitHttpRoute(request);}catch{return respond("Invalid Git request",400);}
  if(!route||!PROJECT_ID.test(route.projectId))return respond("Not found",404);
  const secret=gitHttpCredential(request);if(!secret)return respond("Git credential required",401);
  const project=projectOf(env,route.projectId);let userId:string,parentTokenHash:string|null=null;
  if(secret.startsWith("fgg_")){
    const identity=await project.verifyGitCapability(secret,route.taskId,route.write).catch(()=>null);if(!identity)return respond("Git credential is expired, revoked or outside its scope",401);
    userId=identity.userId;parentTokenHash=identity.parentTokenHash;
  }else{
    if(!secret.startsWith("fgt_"))return respond("Use a FlareGit Git or personal API token",401);
    const auth=await authenticate(new Request(request.url,{headers:{Authorization:`Bearer ${secret}`}}),env);if(auth instanceof Response)return respond("Invalid Git credential",401);
    if((auth.tokenRepo&&auth.tokenRepo!==route.projectId)||(route.write&&auth.tokenScope==="read"))return respond("Git credential does not permit this operation",403);
    userId=auth.id;
  }
  const account=accountOf(env,await accountKeyFor(userId));
  if(await account.accountLifecycle()!=="active")return respond("Account access is unavailable",403);
  if(parentTokenHash&&!(await account.apiTokenHashActive(parentTokenHash)))return respond("The originating API credential was revoked",401);
  if(!(await project.canGitAccess(userId,route.taskId,route.write)))return respond("Not found",404);
  if(!(await env.API_LIMITER.limit({key:`git:${await accountKeyFor(userId)}`})).success)return respond("Git request limit reached; retry shortly",429);
  const admission=await admit(account,userId,route,crypto.randomUUID());if(admission instanceof Response)return admission;
  let repo:Awaited<ReturnType<Artifacts["get"]>>|undefined,providerToken:string|undefined;
  let finished=false;
  const finish=async()=>{if(finished)return;finished=true;try{if(repo&&providerToken){const revoked=await repo.revokeToken(providerToken).catch(()=>false);if(!revoked)await project.logActivity("system","git.credential-cleanup-failed","A short-lived Git transport credential could not be revoked; it expires automatically.");}}finally{repo?.[Symbol.dispose]();await admission.finish();}};
  let checkedAt=0,windowBytes=0;
  const authorize=async(phase:"dispatch"|"response"|"chunk",bytes:number):Promise<boolean>=>{
    windowBytes+=bytes;
    // At most one second or 1 MiB can pass after a header fence without another
    // authoritative check. Never cache the dispatch or response-header fence.
    if(phase==="chunk"&&Date.now()-checkedAt<1000&&windowBytes<=1_048_576)return true;
    try{
      if(secret.startsWith("fgg_")){const current=await project.verifyGitCapability(secret,route.taskId,route.write);if(!current||current.userId!==userId||current.parentTokenHash!==parentTokenHash)return false;}
      else{const current=await authenticate(new Request(request.url,{headers:{Authorization:`Bearer ${secret}`}}),env);if(current instanceof Response||current.id!==userId||(current.tokenRepo&&current.tokenRepo!==route.projectId)||(route.write&&current.tokenScope==="read"))return false;}
      if(await account.accountLifecycle()!=="active"||(parentTokenHash&&!(await account.apiTokenHashActive(parentTokenHash)))||!(await project.canGitAccess(userId,route.taskId,route.write)))return false;
      checkedAt=Date.now();windowBytes=0;return true;
    }catch{return false;}
  };
  try{
    const state=await project.getState();const repoName=route.taskId===null?state.canonicalRepoName:state.tasks[route.taskId]?.workspace.repoName;if(!repoName){await finish();return respond("Not found",404);}
    repo=await env.ARTIFACTS.get(repoName);const remote=String((await repo.info()).remote),provider=new URL(remote);
    if(provider.protocol!=="https:"||!/^[a-f0-9]{32}\.artifacts\.cloudflare\.net$/.test(provider.hostname)||provider.port||provider.username||provider.password||provider.search||provider.hash)throw new Error("Invalid provider origin");
    if(!(await project.canGitAccess(userId,route.taskId,route.write))||await account.accountLifecycle()!=="active")throw new Error("Git access changed");
    providerToken=(await repo.createToken(route.write?"write":"read",600)).plaintext;
    if(!await authorize("dispatch",0)){await finish();return respond("Git access changed before forwarding",403);}
    return await proxyGitHttp(request,route,{remote,providerOrigin:provider.origin,providerToken,writeAllowed:route.write,maxRequestBytes:100_000_000,maxResponseBytes:1_100_000_000,timeoutMs:600_000,finish,authorize});
  }catch{await finish().catch(()=>{});return respond("Git transport unavailable; inspect remote refs before retrying",503);}
}
