import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";
test("native workflow phases preserve review waits and immutable terminal evidence",async()=>{
 if(await workerdChild("tests/sqlite-workflow-health.test.ts"))return;
 const path=`/tmp/flaregit-health-test-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/sqlite-workflow-health-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:crypto",`--outfile=${path}`],{stdout:"ignore",stderr:"pipe"});if(await build.exited)throw new Error(await new Response(build.stderr).text());
 const script=await Bun.file(path).text();await Bun.file(path).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"health",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{TEST:{className:"RepositoryController",useSQLite:true}}}]}));
 try{const worker=await mf.getWorker("health");const phase=async(value:string)=>{const response=await worker.fetch(`http://test/?phase=${value}`,{method:"POST"});expect(response.status).toBe(200);return response.json();};
 expect(await phase("started")).toEqual([{kind:"integration",status:"started",count:1}]);
 for(const value of ["awaiting_review","started","awaiting_review"])expect(await phase(value)).toEqual([{kind:"integration",status:"awaiting_review",count:1}]);
 for(const value of ["accepted","started","awaiting_review","failed","accepted"])expect(await phase(value)).toEqual([{kind:"integration",status:"accepted",count:1}]);
 }finally{await mf.dispose();}
});
