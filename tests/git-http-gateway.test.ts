import { expect, test } from "bun:test";
import { gitHttpCredential, parseGitHttpRoute, proxyGitHttp } from "../src/server/git-http-gateway";
const url = "https://flaregit.test/git/p123/canonical.git/info/refs?service=git-upload-pack";
test("Git routes reject query smuggling and canonical write is recognizable", () => {
  expect(parseGitHttpRoute(new Request(url))?.write).toBe(false);
  expect(() => parseGitHttpRoute(new Request(`${url}&service=git-receive-pack`))).toThrow();
  expect(parseGitHttpRoute(new Request("https://flaregit.test/git/p123/tasks/task-one.git/info/refs?service=git-receive-pack"))?.taskId).toBe("task-one");
  expect(parseGitHttpRoute(new Request("https://flaregit.test/git/p123/canonical.git/objects/abc"))).toBeNull();
});
test("Basic and Bearer transport credentials never accept query or cookie credentials", () => {
  expect(gitHttpCredential(new Request(url,{headers:{Authorization:`Basic ${btoa("flaregit:fgg_test")}`}}))).toBe("fgg_test");
  expect(gitHttpCredential(new Request(url,{headers:{Authorization:"Bearer fgg_test"}}))).toBe("fgg_test");
  expect(gitHttpCredential(new Request(`${url}&token=fgg_test`,{headers:{Cookie:"token=fgg_test"}}))).toBeNull();
});
test("transport allowlists headers, streams, disposes once and suppresses provider credentials", async () => {
  let ended=0;
  const request = new Request(url,{headers:{Authorization:"Bearer user-token",Cookie:"private-cookie","Git-Protocol":"version=2"}});
  const response = await proxyGitHttp(request,parseGitHttpRoute(request)!,{remote:"https://provider.test/repo.git",providerOrigin:"https://provider.test",providerToken:"server-only",writeAllowed:false,maxRequestBytes:100,maxResponseBytes:100,timeoutMs:1000,finish:async()=>{ended++;},fetcher:async(input,init)=>{
    expect(String(input)).toBe("https://provider.test/repo.git/info/refs?service=git-upload-pack");
    const headers=new Headers(init?.headers); expect(headers.get("Authorization")).toBe("Bearer server-only"); expect(headers.has("Cookie")).toBe(false); expect(init?.redirect).toBe("manual");
    return new Response("0000",{headers:{"Content-Type":"application/x-git-upload-pack-advertisement","Set-Cookie":"secret"}});
  }});
  expect(await response.text()).toBe("0000"); expect(ended).toBe(1); expect(response.headers.has("Set-Cookie")).toBe(false);
});
test("redirect and error bodies cannot leak provider credentials", async () => {
  let ended=0; const request=new Request(url);
  const response=await proxyGitHttp(request,parseGitHttpRoute(request)!,{remote:"https://provider.test/repo.git",providerOrigin:"https://provider.test",providerToken:"server-only",writeAllowed:false,maxRequestBytes:100,maxResponseBytes:100,timeoutMs:1000,finish:async()=>{ended++;},fetcher:async()=>new Response("server-only",{status:302,headers:{Location:"https://evil.test"}})});
  expect(response.status).toBe(502); expect(await response.text()).not.toContain("server-only"); expect(ended).toBe(1);
});
test("oversize response fails its stream and finishes exactly once", async () => {
  let ended=0;const request=new Request(url);
  const response=await proxyGitHttp(request,parseGitHttpRoute(request)!,{remote:"https://provider.test/repo.git",providerOrigin:"https://provider.test",providerToken:"server-only",writeAllowed:false,maxRequestBytes:100,maxResponseBytes:3,timeoutMs:1000,finish:async()=>{ended++;},fetcher:async()=>new Response("0000",{headers:{"Content-Type":"application/x-git-upload-pack-advertisement"}})});
  await expect(response.text()).rejects.toThrow("Git transfer interrupted");
  await new Promise(resolve=>setTimeout(resolve,5));expect(ended).toBe(1);
});
test("write admission refuses canonical receive before provider fetch", async () => {
  let ended=0,called=0;const request=new Request(url.replace("git-upload-pack","git-receive-pack"));
  const response=await proxyGitHttp(request,parseGitHttpRoute(request)!,{remote:"https://provider.test/repo.git",providerOrigin:"https://provider.test",providerToken:"server-only",writeAllowed:true,maxRequestBytes:100,maxResponseBytes:100,timeoutMs:1000,finish:async()=>{ended++;},fetcher:async()=>{called++;return new Response();}});
  expect(response.status).toBe(403);expect(called).toBe(0);expect(ended).toBe(1);
});

test("revocation while upstream headers open withholds private response and cleans once",async()=>{
 let active=true,ended=0,cancelled=false;const request=new Request(url);
 const response=await proxyGitHttp(request,parseGitHttpRoute(request)!,{remote:"https://provider.test/repo.git",providerOrigin:"https://provider.test",providerToken:"server-only",writeAllowed:false,maxRequestBytes:100,maxResponseBytes:100,timeoutMs:1000,finish:async()=>{ended++;},authorize:async()=>active,fetcher:async()=>{active=false;return new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true;}}),{headers:{"Content-Type":"application/x-git-upload-pack-advertisement"}});}});
 expect(response.status).toBe(403);expect(await response.text()).not.toContain("server-only");expect(cancelled).toBe(true);expect(ended).toBe(1);
});

test("authority loss midstream cancels before the next bounded chunk and releases once",async()=>{
 let chunks=0,ended=0,cancelled=false;const request=new Request(url);
 const response=await proxyGitHttp(request,parseGitHttpRoute(request)!,{remote:"https://provider.test/repo.git",providerOrigin:"https://provider.test",providerToken:"server-only",writeAllowed:false,maxRequestBytes:100,maxResponseBytes:200000,timeoutMs:1000,finish:async()=>{ended++;},authorize:async(phase,bytes)=>phase!=="chunk"||(bytes<=65536&&++chunks===1),fetcher:async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(150000));},cancel(){cancelled=true;}}),{headers:{"Content-Type":"application/x-git-upload-pack-advertisement"}})});
 const reader=response.body!.getReader();expect((await reader.read()).value?.byteLength).toBe(65536);await expect(reader.read()).rejects.toThrow("Git transfer interrupted");expect(cancelled).toBe(true);expect(ended).toBe(1);
});

test("already cancelled requests do not contact the provider",async()=>{
 const signal=new AbortController();signal.abort();const request=new Request(url,{signal:signal.signal});let called=0,ended=0;
 const response=await proxyGitHttp(request,parseGitHttpRoute(request)!,{remote:"https://provider.test/repo.git",providerOrigin:"https://provider.test",providerToken:"server-only",writeAllowed:false,maxRequestBytes:100,maxResponseBytes:100,timeoutMs:1000,finish:async()=>{ended++;},fetcher:async()=>{called++;return new Response();}});
 expect(response.status).toBe(499);expect(called).toBe(0);expect(ended).toBe(1);
});

test("Git task routes preserve long saved identities and reject unsafe or out-of-bound names",()=>{
 const id="agent-a-discount-197cc1b2-588c-4a7c-bd8a-731e21894ec1";
 const request=(task:string)=>new Request(`https://flaregit.test/git/p123/tasks/${task}.git/info/refs?service=git-upload-pack`);
 for(const task of [id,"a".repeat(101)])expect(parseGitHttpRoute(request(task))?.taskId).toBe(task);
 for(const task of ["ab","a".repeat(102),"-bad","bad_name","bad%2Fname","bad..name"])expect(parseGitHttpRoute(request(task))).toBeNull();
});
