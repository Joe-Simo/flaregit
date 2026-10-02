import{expect,test}from"bun:test";
import{Miniflare,convertV4MiniflareOptions}from"miniflare";
import{generateKeyPair,exportJWK,SignJWT}from"jose";
import{workerdChild}from"./support/workerd-child";

test("account deletion keeps durable imports while shutdown/storage are unconfirmed and permits lifecycle retries",async()=>{
  if(await workerdChild("tests/account-deletion.test.ts"))return;
  const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"deletion-fixture-key",alg:"RS256",use:"sig"};
  const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
  const output=`/tmp/flaregit-delete-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,"build","tests/support/account-deletion-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${output}`],{stdout:"ignore",stderr:"pipe"});
  let script:string;
  try{const[error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0)throw new Error(error);script=await Bun.file(output).text();}finally{if(await Bun.file(output).exists())await Bun.file(output).delete();}
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"deletion-test",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},unsafeDirectSockets:[{host:"127.0.0.1"}],durableObjects:{REPOSITORY_CONTROLLER:{className:"AccountDeletionFixture",useSQLite:true}}}]}));
  try{
    const token=await new SignJWT({azp:"http://test"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject("deletion-user").setIssuedAt().setExpirationTime("10m").sign(pair.privateKey);
    const base=await mf.unsafeGetDirectURL("deletion-test");
    const call=(path:string,method="GET",body?:unknown)=>fetch(new URL(path,base),{method,headers:{Connection:"close",Authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})});
    const deletion=()=>call("/api/account","DELETE",{confirm:"delete my account"});
    await call("/fixture");
    const unavailable=await deletion();expect(unavailable.status).toBe(202);expect(await unavailable.json<unknown>()).toMatchObject({deleted:false,status:"deleting"});
    expect((await call("/api/account")).status).toBe(403);
    let stats=await(await call("/stats")).json() as{lifecycle:string;imports:unknown[];deleteCalls:string[];terminateCalls:number};
    expect(stats.lifecycle).toBe("deleting");expect(stats.imports).toHaveLength(1);expect(stats.deleteCalls).toEqual([]);
    await call("/flags","POST",{workflowAvailable:true});expect((await deletion()).status).toBe(202);
    stats=await(await call("/stats")).json() as typeof stats;expect(stats.terminateCalls).toBe(1);expect(stats.deleteCalls).toEqual([]);
    await call("/flags","POST",{workflowAvailable:true,shutdownConfirmed:true});expect((await deletion()).status).toBe(202);
    stats=await(await call("/stats")).json() as typeof stats;expect(stats.imports).toHaveLength(1);expect(stats.deleteCalls).toEqual([]);
    await call("/flags","POST",{workflowAvailable:true,shutdownConfirmed:true,importReady:true});expect((await deletion()).status).toBe(202);
    stats=await(await call("/stats")).json() as typeof stats;expect(stats.imports).toHaveLength(1);expect(stats.deleteCalls).toEqual(["pending-import-fixture"]);
    await call("/flags","POST",{workflowAvailable:true,shutdownConfirmed:true,importReady:true,deleteConfirmed:true});
    const complete=await deletion();expect(complete.status).toBe(200);expect(await complete.json<unknown>()).toEqual({deleted:true});
    stats=await(await call("/stats")).json() as typeof stats;expect(stats.lifecycle).toBe("deleted");expect(stats.imports).toEqual([]);expect(stats.terminateCalls).toBe(1);
    expect((await call("/api/account")).status).toBe(403);expect((await deletion()).status).toBe(403);
  }finally{await mf.dispose();issuer.stop(true);}
},30000);
