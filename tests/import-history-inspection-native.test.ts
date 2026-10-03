import {test,expect} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child.js";
import type {HistoryInspectionSnapshot} from "../src/server/import-history-inspection.js";
test("native Workerd SQLite preserves chunk replay fault fences and scoped final comparison",async()=>{
 if(await workerdChild("tests/import-history-inspection-native.test.ts"))return;
 const path=`/tmp/flaregit-history-native-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,"build","tests/support/import-history-inspection-worker.ts","--target=browser","--external=cloudflare:workers",`--outfile=${path}`],{stdout:"ignore",stderr:"pipe"});const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code)throw new Error(error);
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"history-ledger",modules:true,script:await Bun.file(path).text(),compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{TEST:{className:"HistoryInspectionFixture",useSQLite:true}}}]}));
 try{const worker=await mf.getWorker("history-ledger");for(const mode of ["fault","stale"]){const body=await(await worker.fetch(`http://test/?mode=${mode}`)).json() as HistoryInspectionSnapshot;expect(body.source).toEqual({revision:0,count:0,pending:1});expect(body.result).toBeNull();}for(const mode of ["complete","mismatch"]){const body=await(await worker.fetch(`http://test/?mode=${mode}`)).json() as {first:string;replay:string;finished:HistoryInspectionSnapshot;bytes:number;receiptLength:number};expect(body.first).toBe("applied");expect(body.replay).toBe("duplicate");expect(body.finished.status).toBe(mode==="complete"?"verified":"mismatch");expect(body.finished.result?.commitsCompared).toBe(mode==="complete"?2:0);expect(body.finished.result?.scope).toBe("selected-ref-reachable-commit-history");expect(body.receiptLength).toBe(64);expect(body.bytes).toBeLessThan(8*1024*1024);}}
 finally{await mf.dispose();await Bun.file(path).delete();}
});
