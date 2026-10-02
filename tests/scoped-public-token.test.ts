import{expect,test}from"bun:test";
import{Miniflare,convertV4MiniflareOptions}from"miniflare";
import{workerdChild}from"./support/workerd-child";

test("real stored pinned tokens match public participation exactly and account deletion blocks residual membership",async()=>{
  if(await workerdChild("tests/scoped-public-token.test.ts"))return;
  const output=`/tmp/flaregit-scoped-public-${crypto.randomUUID()}.js`;
  const build=Bun.spawn([process.execPath,"build","tests/support/scoped-public-token-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${output}`],{stdout:"ignore",stderr:"pipe"});
  let script:string;
  try {
    const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);
    if(code!==0)throw new Error(error);
    script=await Bun.file(output).text();
  } finally {if(await Bun.file(output).exists())await Bun.file(output).delete();}
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"scoped-public",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],unsafeDirectSockets:[{host:"127.0.0.1"}],durableObjects:{REPOSITORY_CONTROLLER:{className:"ScopedAccountFixture",useSQLite:true}}}]}));
  try{
    const base=await mf.unsafeGetDirectURL("scoped-public");
    const call=(path:string,method="GET",token?:string,body?:unknown)=>fetch(new URL(path,base),{method,headers:{Connection:"close",...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const tokens=await(await call("/fixture")).json() as Record<string,string>;
    const same="/api/public/abcdef123456/community/posts",other="/api/public/abcdef123457/community/posts";
    expect((await call(same,"GET",tokens.pinned)).status).toBe(200);
    expect((await call(other,"GET",tokens.pinned)).status).toBe(403);
    const post={scope:"issues",title:"Scoped contribution",body:"Only the pinned repository",idempotencyKey:"scoped-post-fixture"};
    expect((await call(same,"POST",tokens.pinned,post)).status).toBe(201);
    expect((await call(other,"POST",tokens.pinned,post)).status).toBe(403);
    expect((await call(same,"GET",tokens.read)).status).toBe(200);
    expect((await call(same,"POST",tokens.read,post)).status).toBe(403);
    await call("/pending-registry");
    const accountView=await(await call("/api/account","GET",tokens.full)).json() as{projects:unknown[]};
    expect(accountView.projects).toEqual([]);
    expect(await(await call("/registry")).json<unknown>()).toEqual([{id:"abcdef123457",name:"Pending registration",role:"member",kind:"demo",created_at:expect.any(String)}]);
    await call("/deleting");
    expect(await(await call("/residual-role")).json<unknown>()).toBe("member");
    expect((await call(same,"GET",tokens.pinned)).status).toBe(403);
    await call("/deleted");
    expect((await call(same,"GET",tokens.pinned)).status).toBe(401);
  }finally{await mf.dispose();}
},30000);
