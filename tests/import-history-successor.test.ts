import {test,expect} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";
test("native successor preserves old frozen scope and graph, requires terminal stopped authority and reuses its identity",async()=>{
 if(await workerdChild("tests/import-history-successor.test.ts"))return;
 const file=`/tmp/flaregit-history-successor-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,"build","tests/support/import-history-successor-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});if(await build.exited)throw new Error(await new Response(build.stderr).text());
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"successor",modules:true,script:await Bun.file(file).text(),compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{REPOSITORY_CONTROLLER:{className:"HistorySuccessorFixture",useSQLite:true}}}]}));
 try{const worker=await mf.getWorker("successor");for(const mode of ["success","possible","provider-running","generation","expired"]){const response=await worker.fetch(`https://fixture/?mode=${mode}`);expect(response.status).toBe(200);const value=await response.json() as {error:boolean;oldBranch:string;scopeChanged:boolean;successorId:string|null;duplicateId:string|null;nextBranch:string|null;oldRowsUnchanged:boolean;operationCount:number};expect(value.error).toBe(mode!=="success");expect(value.oldBranch).toBe("main");expect(value.scopeChanged).toBe(true);expect(value.oldRowsUnchanged).toBe(true);expect(value.operationCount).toBe(mode==="success"?2:1);if(mode==="success"){expect(value.successorId).toBe(value.duplicateId);expect(value.nextBranch).toBe("codex/selected");}}}
 finally{await mf.dispose();await Bun.file(file).delete();}
},30000);
