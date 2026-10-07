import {expect,test} from "bun:test";
import {apiJson,ApiError,bindApiSession,clearVerifiedApiSession,StaleRepositoryReadError} from "../src/web/api";
import {repositoryRefreshFailure} from "../src/web/repository-refresh-error";
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

test("a failed mutation supersedes its earlier GET without turning the local cancellation into lost access",async()=>{
 const original=globalThis.fetch,network=deferred<Response>(),started=deferred<void>();
 const release=bindApiSession("synthetic-owner-session",async()=>"synthetic-owner-token");
 try{
  globalThis.fetch=Object.assign(async(_input:Parameters<typeof fetch>[0],init?:RequestInit)=>{if(init?.method==="POST")return new Response("Synthetic mark-ready action was denied",{status:403});started.resolve();return network.promise;},{preconnect:original.preconnect});
  const read=apiJson<{status:string}>("/p/p123456789abc/state");const result=read.then(()=>{throw Error("Expected superseded GET");},(cause:unknown)=>cause);
  await started.promise;
  const action=await apiJson("/p/p123456789abc/tasks/synthetic/ready",{method:"POST"}).then(()=>{throw Error("Expected action error");},(cause:unknown)=>cause);
  expect(action).toBeInstanceOf(ApiError);if(!(action instanceof ApiError))throw action;expect(action.message).toBe("Synthetic mark-ready action was denied");
  network.resolve(Response.json({status:"earlier snapshot"}));const stale=await result;expect(stale).toBeInstanceOf(StaleRepositoryReadError);if(!(stale instanceof StaleRepositoryReadError))throw stale;expect(stale.name).toBe("AbortError");expect(repositoryRefreshFailure(stale)).toBe("superseded");
  globalThis.fetch=Object.assign(async()=>Response.json({status:"fresh snapshot"}),{preconnect:original.preconnect});expect(await apiJson<{status:string}>("/p/p123456789abc/state")).toEqual({status:"fresh snapshot"});
 }finally{globalThis.fetch=original;release();clearVerifiedApiSession();}
});
test("a real session switch still fails closed and is never classified as expected repository invalidation",async()=>{
 const original=globalThis.fetch,network=deferred<Response>(),started=deferred<void>();let release=bindApiSession("synthetic-original-owner",async()=>"synthetic-original-token");
 try{
  globalThis.fetch=Object.assign(async()=>{started.resolve();return network.promise;},{preconnect:original.preconnect});
  const read=apiJson("/p/p123456789abc/state");const result=read.then(()=>{throw Error("Expected session rejection");},(cause:unknown)=>cause);await started.promise;release();release=bindApiSession("synthetic-new-owner",async()=>"synthetic-new-token");network.resolve(Response.json({private:"synthetic original-owner data"}));const cause=await result;expect(cause).not.toBeInstanceOf(StaleRepositoryReadError);expect(repositoryRefreshFailure(cause)).toBe("access");
 }finally{globalThis.fetch=original;release();clearVerifiedApiSession();}
});
test("generic AbortErrors and forbidden/not-found responses remain access failures, including copied sentinel text",()=>{
 expect(repositoryRefreshFailure(new DOMException(new StaleRepositoryReadError().message,"AbortError"))).toBe("access");
 for(const status of [401,403,404])expect(repositoryRefreshFailure(new ApiError("Unavailable",status,null))).toBe("access");
 expect(repositoryRefreshFailure(new ApiError("Temporary provider failure",503,null))).toBe("unavailable");
});
