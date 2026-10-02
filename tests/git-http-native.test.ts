import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitHttpRoute, proxyGitHttp } from "../src/server/git-http-gateway";

test("native Git clone and workspace push traverse gateway; stale native push preserves accepted ref", async () => {
  const root=await mkdtemp(join(tmpdir(),"flaregit-native-http-"));
  const run=async(args:string[],cwd=root)=>{const process=Bun.spawn(["git",...args],{cwd,env:{...Bun.env,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_TERMINAL_PROMPT:"0"},stdout:"pipe",stderr:"pipe"});const [stdout,stderr,status]=await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited]);return{stdout,stderr,status};};
  let providerCalls=0,finished=0;
  const server=Bun.serve({port:0,async fetch(request){
    const route=parseGitHttpRoute(request);if(!route)return new Response("missing",{status:404});
    return proxyGitHttp(request,route,{remote:"https://provider.test/repo.git",providerOrigin:"https://provider.test",providerToken:"fixture-provider-secret",writeAllowed:true,maxRequestBytes:10_000_000,maxResponseBytes:10_000_000,timeoutMs:10_000,finish:async()=>{finished++;},fetcher:async(input,init)=>{
      providerCalls++;const url=new URL(String(input));expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-provider-secret");
      const process=Bun.spawn(["git","http-backend"],{env:{...Bun.env,GIT_PROJECT_ROOT:root,GIT_HTTP_EXPORT_ALL:"1",PATH_INFO:url.pathname,QUERY_STRING:url.search.slice(1),REQUEST_METHOD:init?.method??"GET",CONTENT_TYPE:new Headers(init?.headers).get("Content-Type")??"",REMOTE_USER:"fixture",GIT_PROTOCOL:new Headers(init?.headers).get("Git-Protocol")??""},stdin:"pipe",stdout:"pipe",stderr:"pipe"});
      const inputBytes=init?.body?await new Response(init.body).arrayBuffer():new ArrayBuffer(0);process.stdin.write(new Uint8Array(inputBytes));process.stdin.end();
      const [bytes,status]=await Promise.all([new Response(process.stdout).arrayBuffer(),process.exited]);if(status!==0)return new Response("backend failed",{status:502});
      const data=new Uint8Array(bytes);let boundary=-1;for(let i=0;i<data.length-3;i++)if(data[i]===13&&data[i+1]===10&&data[i+2]===13&&data[i+3]===10){boundary=i;break;}
      if(boundary<0)throw new Error("CGI headers missing");const headers=new Headers();let responseStatus=200;for(const line of new TextDecoder().decode(data.slice(0,boundary)).split("\r\n")){const colon=line.indexOf(":");if(colon<0)continue;const name=line.slice(0,colon),value=line.slice(colon+1).trim();if(name.toLowerCase()==="status")responseStatus=Number(value.split(" ")[0]);else headers.append(name,value);}
      return new Response(data.slice(boundary+4),{status:responseStatus,headers});
    }});
  }});
  try{
    expect((await run(["init","--bare","--initial-branch=main","repo.git"])).status).toBe(0);
    expect((await run(["--git-dir=repo.git","config","http.receivepack","true"])).status).toBe(0);
    const remote=`http://127.0.0.1:${server.port}/git/project/tasks/task-one.git`;
    expect((await run(["clone",remote,"first"])).status).toBe(0);
    const first=join(root,"first");await Bun.write(join(first,"README.md"),"initial\n");await run(["add","README.md"],first);expect((await run(["-c","user.name=Fixture","-c","user.email=fixture@example.test","commit","-m","Initial"],first)).status).toBe(0);
    expect((await run(["push","origin","main"],first)).status).toBe(0);
    expect((await run(["clone",remote,"second"])).status).toBe(0);
    await Bun.write(join(first,"README.md"),"first contribution\n");await run(["add","README.md"],first);await run(["-c","user.name=Fixture","-c","user.email=fixture@example.test","commit","-m","First"],first);expect((await run(["push","origin","main"],first)).status).toBe(0);
    const accepted=(await run(["--git-dir=repo.git","rev-parse","main"])).stdout.trim();
    const second=join(root,"second");await Bun.write(join(second,"README.md"),"stale contribution\n");await run(["add","README.md"],second);await run(["-c","user.name=Fixture","-c","user.email=fixture@example.test","commit","-m","Stale"],second);expect((await run(["push","origin","main"],second)).status).not.toBe(0);
    expect((await run(["--git-dir=repo.git","rev-parse","main"])).stdout.trim()).toBe(accepted);
    const canonical=`http://127.0.0.1:${server.port}/git/project/canonical.git`;expect((await run(["clone",canonical,"read-only"])).status).toBe(0);expect((await run(["push",canonical,"main"],first)).status).not.toBe(0);
    expect(providerCalls).toBeGreaterThan(0);expect(finished).toBe(providerCalls+1);
  }finally{server.stop(true);await rm(root,{recursive:true,force:true});}
},30_000);
