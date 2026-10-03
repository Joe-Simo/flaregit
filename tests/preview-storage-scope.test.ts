import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import type { FlareGitProjectState } from "../src/core/types";
test("production preview scope binds current owner and retains verification when optional storage fails",async()=>{
 if(await workerdChild("tests/preview-storage-scope.test.ts"))return;
 const file=`/tmp/preview-scope-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,"build","tests/support/preview-storage-scope-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code)throw new Error(error);const script=await Bun.file(file).text();await Bun.file(file).delete();
 for(const capacity of ["0","1000"]) {
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"scope",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{PREVIEW_STORAGE_GLOBAL_BYTES:capacity,PREVIEW_STORAGE_ACCOUNT_BYTES:"1000"},durableObjects:{REPOSITORY_CONTROLLER:{className:"PreviewScopeFixture",useSQLite:true}}}]}));
 const call=async(path:string)=>(await mf.getWorker("scope")).fetch(`http://fixture${path}`);
 const state=async()=>await(await call("/state")).json() as FlareGitProjectState;
 try {
 const keys=await(await call("/seed")).json() as {ownerKey:string;requesterKey:string};
 const ownerScope=await(await call("/scope?requester=requester")).json() as {accountKey:string;incarnation:string};expect(ownerScope.accountKey).toBe(keys.ownerKey);expect(ownerScope.accountKey).not.toBe(keys.requesterKey);expect(ownerScope.incarnation).toMatch(/^[a-f0-9-]{36}$/);
 expect((await call(`/scope?commit=${"c".repeat(40)}`)).status).toBe(409);expect((await call("/scope?repo=other-repo")).status).toBe(409);expect((await call(`/scope?commit=${"b".repeat(40)}`)).status).toBe(409);
 expect((await call("/verify")).status).toBe(200);expect((await call(`/scope?commit=${"b".repeat(40)}`)).status).toBe(200);
 const verified=await state();const failure=await call("/upload");expect(failure.status).toBe(409);expect(await failure.text()).toContain(capacity==="0"?"storage capacity":"Optional preview upload failed");expect(await state()).toEqual(verified);expect(verified.candidates.one?.status).toBe("verified");expect(verified.evidence.proof?.status).toBe("passed");
 await call("/demote");expect((await call("/scope")).status).toBe(409);await call("/promote");expect((await call("/scope")).status).toBe(200);await call("/seal");expect((await call("/scope")).status).toBe(409);
 }finally{await mf.dispose();}
 }
},30000);
