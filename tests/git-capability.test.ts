import { expect,test } from "bun:test";
import { Miniflare,convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
test("real SQLite Git capabilities bind exact users, tasks and live membership",async()=>{
 if(await workerdChild("tests/git-capability.test.ts"))return;
 const path=`/tmp/flaregit-gitcap-${crypto.randomUUID()}.js`;const build=Bun.spawn([process.execPath,"build","tests/support/git-capability-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:crypto",`--outfile=${path}`],{stdout:"ignore",stderr:"pipe"});if(await build.exited)throw new Error(await new Response(build.stderr).text());const script=await Bun.file(path).text();await Bun.file(path).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"gitcap",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{TEST:{className:"GitFixture",useSQLite:true}}}]}));const call=async(route:string,body?:string)=>(await mf.getWorker("gitcap")).fetch(`http://test${route}`,body?{method:"POST",body}:undefined);
 try{
 await call("/seed");await call("/task");
 expect(await(await call("/can?user=author-full-user&task=task-one&write=true")).json()).toBe(true);
 expect(await(await call("/can?user=another-full-user&task=task-one&write=true")).json()).toBe(false);
 expect(await(await call("/can?user=another-full-user&task=task-one")).json()).toBe(true);
 expect(await(await call("/can?user=owner&write=true")).json()).toBe(false);
 const cap=await(await call("/mint?user=author-full-user&task=task-one&write=true")).json() as {token:string};expect(cap.token.startsWith("fgg_p123456789abc_")).toBe(true);
 expect(await(await call("/verify?task=task-one&write=true",cap.token)).json()).toEqual({userId:"author-full-user",parentTokenHash:null});
 expect(await(await call("/verify?task=other-task&write=true",cap.token)).json()).toBeNull();
 expect(await(await call("/verify?repo=other&task=task-one&write=true",cap.token)).json()).toBeNull();
 const own=await(await call("/mint?user=owner")).json() as {token:string};await call("/revoke?user=owner");expect(await(await call("/verify",own.token)).json()).toBeNull();expect(await(await call("/verify?task=task-one&write=true",cap.token)).json()).not.toBeNull();
 await call("/remove?user=author-full-user");expect(await(await call("/verify?task=task-one&write=true",cap.token)).json()).toBeNull();
 await call("/seed?repo=legacy");await call("/task?repo=legacy&legacy=true");expect(await(await call("/can?repo=legacy&user=author-full-user&task=task-one&write=true")).json()).toBe(false);expect(await(await call("/can?repo=legacy&user=owner&task=task-one&write=true")).json()).toBe(true);
 await call("/cancel?repo=legacy");expect(await(await call("/can?repo=legacy&user=owner&task=task-one&write=true")).json()).toBe(false);
 }finally{await mf.dispose();}
},30_000);
