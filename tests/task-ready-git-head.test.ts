import {test,expect} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";
test("native task-ready exact ref proof preserves authority, funded bounds and durable credential cleanup",async()=>{
 if(await workerdChild("tests/task-ready-git-head.test.ts"))return;
 const file=`/tmp/flaregit-task-ref-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,"build","tests/support/task-ready-git-head-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});if(await build.exited)throw new Error(await new Response(build.stderr).text());
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-ref",modules:true,script:await Bun.file(file).text(),compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{REPOSITORY_CONTROLLER:{className:"TaskReadyFixture",useSQLite:true}}}]}));
 try{const worker=await mf.getWorker("task-ref");for(const mode of ["success","wrong-ref","changed-head","revoked","expired","contributor","budget","cleanup","issuance"]){const response=await worker.fetch(`https://fixture/?mode=${mode}`);expect(response.status).toBe(200);const value=await response.json() as {observed:string|null;error:boolean;issuances:number;revocations:number;statuses:string[];task:string};expect(value.task).toBe("a".repeat(40));expect(value.error).toBe(!["success","wrong-ref"].includes(mode));if(mode==="success")expect(value.observed).toBe("b".repeat(40));if(mode==="wrong-ref")expect(value.observed).toBeNull();if(["expired","contributor","budget"].includes(mode))expect(value.issuances).toBe(0);else if(mode==="issuance")expect(value.statuses).toEqual(["issuance_unknown"]);else expect(value.statuses).toEqual([mode==="cleanup"?"pending":"revoked"]);}}
 finally{await mf.dispose();await Bun.file(file).delete();}
},30000);
