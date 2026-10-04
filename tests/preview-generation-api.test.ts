import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";

test("production recovery HTTP gates owner access and preserves unknown holds at exhausted storage allowance",async()=>{
  if(await workerdChild("tests/preview-generation-api.test.ts"))return;
  const file=`/tmp/flaregit-generation-api-${crypto.randomUUID()}.js`;
  const build=Bun.spawn([process.execPath,"build","tests/support/preview-generation-api-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
  const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0)throw new Error(error);
  const script=await Bun.file(file).text();await Bun.file(file).delete();
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[12,24].map(budget=>({name:`generation-api-${budget}`,unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],r2Buckets:["EVIDENCE_BUCKET"],bindings:{PREVIEW_STORAGE_GLOBAL_BYTES:String(budget),PREVIEW_STORAGE_ACCOUNT_BYTES:String(budget),PREVIEW_SIGNING_KEY:"test-only",CLERK_AUTHORIZED_PARTIES:"https://flaregit.com",REPOSITORY_PREVIEW_ORIGINS:JSON.stringify({abcdef123456:"https://fixture.preview.workers.dev"})},durableObjects:{REPOSITORY_CONTROLLER:{className:"GenerationApiFixture",useSQLite:true}}}))}));
  try{
    const url=await mf.unsafeGetDirectURL("generation-api-12");
    const call=(path:string,token?:string,body?:unknown)=>fetch(new URL(path,url),{method:body===undefined?"GET":"POST",headers:{Connection:"close","CF-Connecting-IP":"198.51.100.20",...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const bootstrap=await call("/fixture/bootstrap");if(!bootstrap.ok)throw new Error(await bootstrap.text());expect(bootstrap.status).toBe(200);
    const tokens=await bootstrap.json() as Record<string,string>;
    const snapshot=()=>call("/fixture/snapshot").then(response=>response.json()) as Promise<{holds:unknown[];writers:unknown[];computeCalls:number}>;
    const fundedUrl=await mf.unsafeGetDirectURL("generation-api-24");
    const fundedTokens=await(await fetch(new URL("/fixture/bootstrap",fundedUrl))).json() as Record<string,string>;
    const fundedStatus=await fetch(new URL(`/api/p/abcdef123456/preview?commit=${"a".repeat(40)}`,fundedUrl),{headers:{Authorization:`Bearer ${fundedTokens.owner}`,"CF-Connecting-IP":"198.51.100.21"}});
    expect(fundedStatus.status).toBe(200);
    expect(await fundedStatus.json()).toMatchObject({ready:false,status:"unavailable",canRetry:false,generationRecovery:{canRecover:true,expectedGeneration:null}});
    const before=await snapshot();expect(before.holds).toHaveLength(1);
    const status=await call(`/api/p/abcdef123456/preview?commit=${"a".repeat(40)}`,tokens.owner);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ready:false,status:"unavailable",canRetry:false,generationRecovery:{canRecover:false,expectedGeneration:null}});
    const body={commit:"a".repeat(40),expectedGeneration:null,idempotencyKey:"22222222-2222-4222-8222-222222222222"};
    const route="/api/p/abcdef123456/preview/recover-generation";
    expect((await call(route,tokens.outsider,body)).status).toBe(404);
    expect((await call(route,tokens.member,body)).status).toBe(403);
    expect((await call(route,tokens.owner,{...body,commit:"b".repeat(40)})).status).toBe(400);
    expect((await call(route,tokens.owner,body)).status).toBe(409);
    const duplicate=await call(route,tokens.owner,body);expect(duplicate.status).toBe(202);expect(await duplicate.json()).toMatchObject({status:"failed"});
    const after=await snapshot();expect(after.holds).toEqual(before.holds);expect(after.writers).toEqual(before.writers);expect(after.computeCalls).toBe(0);
    const fundedCall=(path:string,token?:string)=>fetch(new URL(path,fundedUrl),{headers:{"CF-Connecting-IP":"198.51.100.21",...(token?{Authorization:`Bearer ${token}`}:{})}});
    await fundedCall("/fixture/ready");
    const readyPath=`/api/p/abcdef123456/preview?commit=${"a".repeat(40)}`;
    expect(await(await fundedCall(readyPath,fundedTokens.owner)).json()).toMatchObject({ready:true,generationRecovery:{canRecover:true,expectedGeneration:null}});
    expect(await(await fundedCall(readyPath,fundedTokens.member)).json()).not.toHaveProperty("generationRecovery");
    const pending=await(await fundedCall("/fixture/pending-replacement")).json() as {active:string;latest:string};
    expect(await(await fundedCall(readyPath,fundedTokens.owner)).json()).toMatchObject({ready:true,generationId:pending.active,replacement:{generationId:pending.latest,status:"requested"},generationRecovery:{canRecover:false,expectedGeneration:pending.latest}});
    expect((await snapshot()).computeCalls).toBe(0);
  }finally{await mf.dispose();}
},30_000);
