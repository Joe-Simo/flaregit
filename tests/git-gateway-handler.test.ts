import { expect,test } from "bun:test";
import { Miniflare,convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
test("workerd Git handler authenticates native Basic and prevents scoped-token tenant escape",async()=>{
 if(await workerdChild("tests/git-gateway-handler.test.ts"))return;
 const path=`/tmp/flaregit-githandler-${crypto.randomUUID()}.js`;const build=Bun.spawn([process.execPath,"build","tests/support/git-capability-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:crypto",`--outfile=${path}`],{stdout:"ignore",stderr:"pipe"});if(await build.exited)throw new Error(await new Response(build.stderr).text());const script=await Bun.file(path).text();await Bun.file(path).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"git-handler",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{TEST:{className:"GitFixture",useSQLite:true},REPOSITORY_CONTROLLER:{className:"GitFixture",useSQLite:true}},outboundService:"git-provider"},{name:"git-provider",modules:true,compatibilityDate:"2026-10-02",script:`let calls=0;export default {fetch(request){if(new URL(request.url).pathname==='/stats')return Response.json({calls});calls++;if(request.headers.get('Authorization')!=='Bearer fixture-provider-secret')return new Response('denied',{status:401});return new Response('0000',{headers:{'Content-Type':'application/x-git-upload-pack-advertisement'}});}};`}]}));
 try{
 const worker=await mf.getWorker("git-handler"),base="http://test/git/p123456789abc/canonical.git/info/refs?service=git-upload-pack";
 expect((await worker.fetch(base)).status).toBe(401);
 const {token,personal,personalId,capability,parentId}=await(await worker.fetch("http://test/handler-setup")).json() as {token:string;personal:string;personalId:string;capability:string;parentId:string};const headers={Authorization:`Basic ${btoa(`flaregit:${token}`)}`};
 const allowed=await worker.fetch(base,{headers});expect(allowed.status).toBe(200);expect(await allowed.text()).toBe("0000");
 expect((await worker.fetch(base.replace("p123456789abc","p999999999999"),{headers})).status).toBe(403);
 expect((await worker.fetch(base.replace("git-upload-pack","git-receive-pack"),{headers})).status).toBe(403);
 expect((await worker.fetch(base,{headers:{Authorization:`Basic ${btoa(`flaregit:${personal}`)}`,"X-Fixture-Revoke-On-Mint":personalId}})).status).toBe(403);
 expect((await worker.fetch(base,{headers:{Authorization:`Basic ${btoa(`flaregit:${capability}`)}`,"X-Fixture-Revoke-On-Mint":parentId}})).status).toBe(403);
 await worker.fetch("http://test/handler-delete");expect((await worker.fetch(base,{headers})).status).toBe(403);
 const provider=await mf.getWorker("git-provider");expect(await(await provider.fetch("http://test/stats")).json()).toEqual({calls:1});
 }finally{await mf.dispose();}
},30_000);
