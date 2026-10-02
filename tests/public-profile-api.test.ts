import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";
test("unsigned profile routes preserve private identity and revoked consent",async()=>{
 if(await workerdChild("tests/public-profile-api.test.ts"))return;
 const path=`/tmp/profile-test-${crypto.randomUUID()}.js`;
 const built=Bun.spawn([process.execPath,"build","tests/support/public-profile-api-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:crypto",`--outfile=${path}`],{stdout:"ignore",stderr:"pipe"});
 if(await built.exited!==0)throw new Error(await new Response(built.stderr).text());
 const script=await Bun.file(path).text();await Bun.file(path).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"profile-test",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{TEST:{className:"PublicProfileFixture",useSQLite:true}}}]}));
 const request=async(path:string)=>(await mf.getWorker("profile-test")).fetch(`http://test${path}`,{headers:{"CF-Connecting-IP":"192.0.2.1"}});
 try{
  expect((await request("/api/profiles/contributor")).status).toBe(404);
  await request("/mode?value=public");const response=await request("/api/profiles/contributor");expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body=await response.text();expect(body).not.toContain("private-user-id");expect(body).not.toContain("PRIVATE TASK GOAL");expect(body).not.toContain("abcdef123457");expect(body).toContain("self-described");expect(body).toContain("abcdef123456");
  await request("/mode?value=revoke");expect((await request("/api/profiles/contributor")).status).toBe(409);
 }finally{await mf.dispose();}
},30000);
